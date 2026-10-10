// graph.js — the v1 graph, upgraded.
//   Same feel as v1: a live spring simulation with topic boxes AND small dots for each topic's items,
//   everything connected by springs, so dragging a box stretches the graph like elastic and it all
//   swings back when you let go. Hover traces links; clicking a dot opens that link.
//   New: boxes show the full topic name + "N links" (size = max(fit-to-text, sqrt(count) scale)),
//   boxes never overlap, pan / zoom / pinch / Fit, link color strength by weight, search glow + fit,
//   click a box = pop + side panel, live updates that keep positions, Re-layout.
import { S, topics, topicById, effImp, setTopicImportance, getLocal, setLocal, UNCAT } from './data.js';
import { relations } from './categorize.js';
import { esc, norm, plural, debounce, safeHref } from './util.js';
import { $, closeMenu, impToggle, nextImp, say } from './ui.js';
import { itemRow, itemClick, sortItems, itemsOf } from './items.js';
import { openFile } from './imports.js';

// ---------- tuning ----------
const NAME_PX = 22, COUNT_PX = 14, PAD = 16, MAX_LINES = 3;
const SIZE_BASE = 100, SIZE_PER = 16, SIZE_CAP = 250;    // sqrt scale, capped
const FAN_MAX = 14, DOT = 5, RING_GAP = 15;             // up to 14 dots fan out; more go in rings
const GAP = 48;                                          // min space between topics' areas (box + its dots)
const DAMP = 0.8, GRAVITY = 0.0018;
const POP_MS = 3000;
const PANEL_PAGE = 150;

const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => reducedMQ.matches;

let root = null, cv = null, ctx = null, W = 0, H = 0, DPR = 1, ro = null;
let nodes = [], tnodes = [], byId = new Map(), edges = [];
let view = { x: 0, y: 0, k: 1 };
let loopRaf = 0, drawRaf = 0, running = false, calm = 0, tween = null;
let hover = null, kbFocus = null, pop = { id: null, start: 0 };
let matchSet = null, panelId = null, panelShown = PANEL_PAGE;
let colors = {};
const ptr = new Map();
let drag = null;

// ---------- view lifecycle ----------
export async function render(el) {
  root = el;
  pop = { id: null, start: 0 }; drag = null; ptr.clear(); tween = null; hover = null; matchSet = null;
  el.innerHTML = `
  <section class="toolbar gbar" aria-label="Graph controls">
    <input type="search" id="gq" placeholder="search topics, items, keywords…" aria-label="Search the graph" autocomplete="off">
    <span class="zoom" role="group" aria-label="Zoom">
      <button class="b" id="zin" type="button" aria-label="Zoom in">+</button><button class="b" id="zout" type="button" aria-label="Zoom out">−</button><button class="b" id="fit" type="button">Fit</button>
    </span>
    <button class="b" id="relayout" type="button" title="Shake everything up and lay the graph out again">Re-layout</button>
    <span class="count" id="gcount" aria-live="polite"></span>
  </section>
  <div class="gwrap win" id="gwrap">
    <canvas id="gc" aria-label="Graph of topics and their items. Use the topic list after this to reach topics by keyboard."></canvas>
    <p class="ghint">drag a box to stretch the graph · drag background = pan · wheel / pinch = zoom · click a box = its list · click a dot = open link</p>
    <aside class="gpanel" id="gpanel" hidden aria-labelledby="gp-h"></aside>
    <div class="gempty" id="gempty" hidden><p><b>No topics to draw yet.</b></p><p><a class="b primary" href="#setup">Set up topics</a></p></div>
  </div>
  <ul class="sr" id="gnodes" aria-label="Topics in the graph"></ul>`;

  cv = $('#gc', el);
  ctx = cv.getContext('2d');
  readColors();
  wireControls();
  ro = new ResizeObserver(resize);
  ro.observe($('#gwrap', el));
  resize();
  await fontsReady();
  if (!root) return;
  const saved = (await getLocal('graphPos').catch(() => null)) || {};
  build(saved);
  if (tnodes.every((n) => n.fresh)) scatter(nodes);
  else nodes.filter((n) => n.fresh).forEach(placeNear);
  for (const n of nodes) n.fresh = false;
  if (reduced()) settleNow(400);
  fit(tnodes.length ? tnodes : nodes, false);
  wake();
}

export function dispose() {
  savePos.flush?.();
  cancelAnimationFrame(loopRaf); cancelAnimationFrame(drawRaf);
  running = false; drawRaf = 0;
  ro?.disconnect();
  closeMenu();
  root = null; cv = null; ctx = null; nodes = []; tnodes = []; byId = new Map(); edges = []; panelId = null; matchSet = null; hover = null;
}

const liveUpdate = debounce(async () => {
  if (!root) return;
  readColors();
  await fontsReady();
  if (!root) return;
  build(null);
  nodes.filter((n) => n.fresh).forEach(placeNear);
  for (const n of nodes) n.fresh = false;
  if (panelId && !byId.has(panelId)) closePanel();
  else if (panelId) drawPanel();
  if (matchSet) runSearch($('#gq', root).value, false);
  drawNodeList();
  if (reduced()) settleNow(150);
  wake();
}, 300);

export function update(kind) {
  if (root && (kind === 'items' || kind === 'profile')) liveUpdate();
}

// ---------- data -> nodes / edges ----------
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (v) => cs.getPropertyValue(v).trim();
  colors = { ink: g('--ink'), panel: g('--panel'), muted: g('--muted'), accent: g('--accent'), line: g('--line'), imp: [g('--lo'), g('--mid'), g('--hi')] };
  // style tokens, so the graph matches Retro / Clean / Modern
  colors.fh = g('--font-head') || 'VT323, monospace';
  colors.fb = g('--font-body') || 'monospace';
  colors.hw = g('--head-weight') || '400';
  colors.hs = Math.max(0.86, parseFloat(g('--hs')) || 1);   // sans fonts run larger than VT323
  colors.retro = (document.documentElement.dataset.style || 'retro') === 'retro';
  colors.radius = Math.min(16, parseFloat(g('--radius')) || 0);
}

/** Make sure the current style's fonts are loaded before measuring text. */
function fontsReady() {
  return Promise.all([
    document.fonts.load(`${colors.hw} ${Math.round(NAME_PX * colors.hs)}px ${colors.fh}`),
    document.fonts.load(`700 ${COUNT_PX}px ${colors.fb}`),
  ]).catch(() => {});
}

const UNCAT_ID = '__uncat';

function build(saved) {
  const per = new Map();
  for (const it of S.items) { const k = it.topicId || UNCAT_ID; let a = per.get(k); if (!a) per.set(k, (a = [])); a.push(it); }
  const next = [], nextT = [], nextById = new Map();
  const keep = (id, mk) => { let n = byId.get(id); if (!n) { n = mk(); n.fresh = true; } nextById.set(id, n); next.push(n); return n; };
  const list = topics().map((t) => ({ id: t.id, name: t.name, group: t.group || '', imp: t.importance }));
  if (per.has(UNCAT_ID)) list.push({ id: UNCAT_ID, name: UNCAT.name, group: '', imp: 0, uncat: true });   // every category, Uncategorized too
  for (const t of list) {
    const n = keep(t.id, () => {
      const o = { t: 1, id: t.id, x: 0, y: 0, vx: 0, vy: 0 };
      const p = saved?.[t.id];
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) { o.x = p[0]; o.y = p[1]; o.hadPos = true; }
      return o;
    });
    if (n.hadPos) { n.fresh = false; n.hadPos = false; }
    n.name = t.name; n.group = t.group; n.imp = t.imp; n.uncat = !!t.uncat;
    n.count = per.get(t.id)?.length || 0;
    measure(n);
    nextT.push(n);
  }
  // a dot for EVERY item: up to 14 fan out on the outer side, more go in rings all around the box
  const spokes = [];
  for (const tn of nextT) {
    const items = sortItems([...(per.get(tn.id) || [])]);
    tn.dots = items.length;
    layoutDots(tn);
    items.forEach((it, slot) => {
      const n = keep('i:' + it.id, () => ({ t: 0, id: 'i:' + it.id, x: 0, y: 0, vx: 0, vy: 0, w: DOT * 2, h: DOT * 2 }));
      n.it = it; n.topic = tn; n.imp = effImp(it); n.slot = slot;
      if (tn.dots <= 40) spokes.push({ a: tn, b: n, item: true });
    });
  }
  nodes = next; tnodes = nextT; byId = nextById;
  const rel = relations(topics(), S.items);
  let maxW = 1;
  const tEdges = [];
  for (const [k, w] of Object.entries(rel)) {
    const [a, b] = k.split('|');
    if (byId.has(a) && byId.has(b)) { tEdges.push({ a: byId.get(a), b: byId.get(b), w }); maxW = Math.max(maxW, w); }
  }
  for (const t of nextT) t.deg = 0;
  for (const e of tEdges) { e.n = e.w / maxW; e.a.deg++; e.b.deg++; }
  edges = tEdges.concat(spokes);
  if (root) {
    $('#gcount', root).textContent = `${plural(tnodes.length, 'topic')} · ${plural(nodes.length - tnodes.length, 'item')} · ${plural(tEdges.length, 'link')}`;
    $('#gempty', root).hidden = tnodes.length > 0;
  }
}

/** Ring geometry for a topic with many dots, and the topic's footprint (box + dots) used for spacing. */
function layoutDots(t) {
  t.rings = [];
  if (t.dots <= FAN_MAX) {
    const halo = t.dots ? 48 + 22 + 16 : 20;
    t.fw = t.w + halo * 2; t.fh = t.h + halo * 2;
    return;
  }
  const r0 = Math.hypot(t.w, t.h) / 2 + 30;
  let left = t.dots, k = 0;
  while (left > 0) {
    const R = r0 + k * RING_GAP;
    const cap = Math.max(8, Math.floor((2 * Math.PI * R) / RING_GAP));
    const n = Math.min(cap, left);
    t.rings.push({ R, n, cap });
    left -= n; k++;
  }
  const outer = t.rings[t.rings.length - 1].R + 12;
  t.fw = t.fh = Math.max(outer * 2, t.w + 40);
}

/** Where a dot belongs right now (relative to its topic's position and the graph's middle). */
function dotTarget(n, base) {
  const t = n.topic;
  if (!t.rings.length) {
    const spread = Math.min(0.34, 3.4 / Math.max(1, t.dots));
    const ang = base + (n.slot - (t.dots - 1) / 2) * spread;
    const c = Math.cos(ang), s = Math.sin(ang);
    const edge = Math.min(t.w / 2 / Math.max(1e-6, Math.abs(c)), t.h / 2 / Math.max(1e-6, Math.abs(s)));
    const dist = edge + 48 + (n.slot % 2) * 22;
    return [t.x + c * dist, t.y + s * dist];
  }
  let i = n.slot, k = 0;
  while (k < t.rings.length - 1 && i >= t.rings[k].n) { i -= t.rings[k].n; k++; }
  const ring = t.rings[k];
  const ang = base + (i + (k % 2) * 0.5) * (2 * Math.PI / ring.n);
  return [t.x + Math.cos(ang) * ring.R, t.y + Math.sin(ang) * ring.R];
}

/** Box size = max(what the wrapped name + count needs, sqrt(count) scale). Never clips the name. */
function measure(n) {
  const side = Math.min(SIZE_CAP, SIZE_BASE + SIZE_PER * Math.sqrt(n.count));
  n.fs = Math.round(Math.max(NAME_PX, Math.min(36, NAME_PX + (side - SIZE_BASE) * 0.11)) * colors.hs);
  n.cfs = Math.round(Math.max(COUNT_PX, Math.min(19, COUNT_PX + (side - SIZE_BASE) * 0.035)));
  n.lh = Math.round(n.fs * (colors.retro ? 1.02 : 1.2));
  ctx.font = `${colors.hw} ${n.fs}px ${colors.fh}`;
  const label = colors.retro ? n.name.toUpperCase() : n.name;
  let maxText = Math.max(120, side * 1.2 - PAD * 2);
  let lines = wrap(label, maxText);
  while (lines.length > MAX_LINES) { maxText += 24; lines = wrap(label, maxText); }
  n.lines = lines;
  n.countText = `${n.count} ${n.count === 1 ? 'link' : 'links'}`;
  const nameW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  ctx.font = `700 ${n.cfs}px ${colors.fb}`;
  const countW = ctx.measureText(n.countText).width;
  const fitW = Math.max(nameW, countW) + PAD * 2;
  const fitH = PAD + lines.length * n.lh + 8 + n.cfs + PAD + 6;
  n.w = Math.ceil(Math.max(fitW, side * 1.2));
  n.h = Math.ceil(Math.max(fitH, side * 0.62));
}

function wrap(text, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (!cur || ctx.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// ---------- placement ----------
function scatter(list) {
  const groups = [...new Set(tnodes.map((n) => n.group))].sort();
  const avg = tnodes.reduce((s, n) => s + n.fw, 0) / Math.max(1, tnodes.length);
  const R = (avg * 0.75 + 60) * Math.sqrt(Math.max(1, tnodes.length));
  tnodes.forEach((n, i) => {
    const gi = groups.indexOf(n.group);
    const a = (gi / Math.max(1, groups.length)) * Math.PI * 2 + i * 0.35;
    n.x = Math.cos(a) * R * (0.6 + Math.random() * 0.5);
    n.y = Math.sin(a) * R * 0.7 * (0.6 + Math.random() * 0.5);
    n.vx = n.vy = 0;
  });
  for (const n of list) if (!n.t) placeNear(n);
}

/** New node: items next to their topic; topics near linked topics or the view center. */
function placeNear(n) {
  if (!n.t) {
    const a = Math.random() * Math.PI * 2, r = (n.topic.fw || n.topic.w) / 2;
    n.x = n.topic.x + Math.cos(a) * r; n.y = n.topic.y + Math.sin(a) * r; n.vx = n.vy = 0;
    return;
  }
  let x, y;
  const linked = edges.filter((e) => !e.item && (e.a === n || e.b === n)).map((e) => (e.a === n ? e.b : e.a)).filter((m) => !m.fresh);
  if (linked.length) { x = linked.reduce((s, m) => s + m.x, 0) / linked.length; y = linked.reduce((s, m) => s + m.y, 0) / linked.length; }
  else { x = (W / 2 - view.x) / view.k; y = (H / 2 - view.y) / view.k; }
  n.x = x + (Math.random() - 0.5) * 160; n.y = y + (Math.random() - 0.5) * 160;
  n.vx = n.vy = 0;
}

// ---------- physics (v1 style: always-on springs + repulsion, plus box collisions) ----------
function step() {
  // topics push each other apart (scaled by the area their dots need) …
  const T = tnodes.length;
  for (let i = 0; i < T; i++) {
    const a = tnodes[i];
    for (let j = i + 1; j < T; j++) {
      const b = tnodes[j];
      let dx = a.x - b.x, dy = a.y - b.y;
      if (!dx && !dy) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
      const d2 = dx * dx + dy * dy + 0.5, d = Math.sqrt(d2);
      const sz = (a.fw + b.fw) / 300;
      const f = (80000 * sz * sz) / d2;
      dx = (dx / d) * f; dy = (dy / d) * f;
      a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy;
    }
  }
  // … linked topics pull together on springs (strong links shorter and stiffer)
  for (const e of edges) {
    if (e.item) continue;
    const { a, b } = e;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.1;
    const L = (a.fw + b.fw) / 2 + 165 - 85 * e.n, k = 0.002 + 0.006 * e.n;
    const f = ((d - L) * k) / d;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  // item dots ride on springs to their spot around their own box (outer side first, then rings)
  let cx = 0, cy = 0;
  for (const t of tnodes) { cx += t.x; cy += t.y; }
  cx /= T || 1; cy /= T || 1;
  for (const t of tnodes) { const ox = t.x - cx, oy = t.y - cy; t.base = Math.hypot(ox, oy) > 1 ? Math.atan2(oy, ox) : -Math.PI / 2; }
  for (const n of nodes) {
    if (n.t) continue;
    const [tx, ty] = dotTarget(n, n.topic.base);
    n.vx += (tx - n.x) * 0.09;
    n.vy += (ty - n.y) * 0.09;
  }
  let energy = 0;
  for (const n of nodes) {
    if (n.t) { const g = n.deg ? GRAVITY : GRAVITY * 5; n.vx -= n.x * g; n.vy -= n.y * g; }   // unlinked topics (e.g. Uncategorized) stay close
    if (drag?.node === n) { n.vx = n.vy = 0; continue; }
    n.vx *= DAMP; n.vy *= DAMP;
    const sp = Math.hypot(n.vx, n.vy);
    if (sp > 40) { n.vx *= 40 / sp; n.vy *= 40 / sp; }
    n.x += n.vx; n.y += n.vy;
    energy += n.vx * n.vx + n.vy * n.vy;
  }
  collide();
  return energy / Math.max(1, nodes.length);
}

/** Topic areas (box + dots) never overlap, so boxes never overlap; stray dots are pushed out of other boxes. */
function collide() {
  for (let p = 0; p < 10; p++) {
    for (let i = 0; i < tnodes.length; i++) {
      const a = tnodes[i];
      for (let j = i + 1; j < tnodes.length; j++) push(a, tnodes[j], GAP, true);
    }
  }
  for (const n of nodes) {
    if (n.t) continue;
    for (const b of tnodes) if (b !== n.topic && Math.abs(n.x - b.x) < b.w / 2 + 10 && Math.abs(n.y - b.y) < b.h / 2 + 10) push(b, n, 4, false);
  }
}
function push(a, b, gap, area) {
  const aw = area ? a.fw : a.w, ah = area ? a.fh : a.h, bw = area ? b.fw : b.w, bh = area ? b.fh : b.h;
  const dx = b.x - a.x, dy = b.y - a.y;
  const ox = (aw + bw) / 2 + gap - Math.abs(dx);
  const oy = (ah + bh) / 2 + gap - Math.abs(dy);
  if (ox <= 0 || oy <= 0) return;
  let ma = drag?.node === a || (a.t && !b.t) ? 0 : 1;      // a box isn't shoved by a dot
  let mb = drag?.node === b ? 0 : 1;
  if (!ma && !mb) mb = 1;
  const s = ma + mb;
  if (ox < oy) { const sx = (dx >= 0 ? 1 : -1) * ox; a.x -= sx * ma / s; b.x += sx * mb / s; }
  else { const sy = (dy >= 0 ? 1 : -1) * oy; a.y -= sy * ma / s; b.y += sy * mb / s; }
}

function settleNow(n) { for (let i = 0; i < n; i++) step(); for (let i = 0; i < 30; i++) collide(); savePos(); }

/** The loop runs while things move (like v1) and sleeps once everything is still, or the tab is hidden. */
function wake() {
  calm = 0;
  if (running || !root || document.hidden) { requestDraw(); return; }
  running = true;
  const frame = () => {
    if (!root || document.hidden) { running = false; return; }
    let moving = false;
    if (!reduced() || drag) {
      const e = step();
      moving = e > 0.004 || !!drag;
      calm = moving ? 0 : calm + 1;
      if (calm === 30) savePos();
    } else calm = 30;
    if (tween) moving = stepTween() || moving;
    if (pop.id && performance.now() - pop.start < POP_MS + 300) moving = true;
    else if (pop.id) pop.id = null;
    draw();
    if (moving || calm < 30) loopRaf = requestAnimationFrame(frame);
    else running = false;
  };
  loopRaf = requestAnimationFrame(frame);
}
function requestDraw() {
  if (running || drawRaf) return;
  drawRaf = requestAnimationFrame(() => { drawRaf = 0; draw(); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && root) wake(); });

const savePos = debounce(() => {
  const o = {};
  for (const n of tnodes) o[n.id] = [Math.round(n.x), Math.round(n.y)];
  setLocal('graphPos', o).catch(() => {});
}, 400);

// ---------- view: pan / zoom / fit ----------
function resize() {
  if (!cv) return;
  const r = cv.parentElement.getBoundingClientRect();
  const oldW = W, oldH = H;
  DPR = window.devicePixelRatio || 1;
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  if (oldW) { view.x += (W - oldW) / 2; view.y += (H - oldH) / 2; }
  requestDraw();
}

const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });

function zoomAt(sx, sy, factor) {
  const k = Math.max(0.12, Math.min(4, view.k * factor));
  const w = toWorld(sx, sy);
  view.k = k;
  view.x = sx - w.x * k; view.y = sy - w.y * k;
  requestDraw();
}

function fit(list, animate = true) {
  if (!list.length || !W) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of list) {
    const w = (n.fw || n.w) / 2, h = (n.fh || n.h) / 2;
    x0 = Math.min(x0, n.x - w); y0 = Math.min(y0, n.y - h); x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
  }
  const pad = 30;
  const availW = W - (panelId ? Math.min(400, W * 0.4) : 0);
  const k = Math.max(0.12, Math.min(1.1, Math.min((availW - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1))));
  const target = { k, x: availW / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k };
  if (!animate || reduced()) { view = target; requestDraw(); return; }
  tween = { from: { ...view }, to: target, t0: performance.now(), ms: 320 };
  wake();
}
function stepTween() {
  const p = Math.min(1, (performance.now() - tween.t0) / tween.ms);
  const e = 1 - Math.pow(1 - p, 3);
  for (const k of ['x', 'y', 'k']) view[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e;
  if (p >= 1) { tween = null; return false; }
  return true;
}

// ---------- drawing ----------
function neighbors(n) {
  const s = new Set([n]);
  if (!n.t) { s.add(n.topic); return s; }
  for (const e of edges) { if (e.a === n) s.add(e.b); if (e.b === n) s.add(e.a); }
  return s;
}

function popScale(n) {
  if (pop.id !== n.id) return 1;
  if (reduced()) return 1.15;
  const t = performance.now() - pop.start;
  const up = Math.min(1, t / 160), down = t > POP_MS ? Math.max(0, 1 - (t - POP_MS) / 300) : 1;
  return 1 + 0.15 * (1 - Math.pow(1 - up, 3)) * down;
}

function draw() {
  if (!ctx) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = colors.panel;
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(DPR * view.k, 0, 0, DPR * view.k, DPR * view.x, DPR * view.y);

  const popping = pop.id && performance.now() - pop.start < POP_MS ? byId.get(pop.id) : null;
  let focusSet = null;
  if (popping) focusSet = neighbors(popping);
  else if (hover) focusSet = neighbors(hover);
  else if (matchSet) { focusSet = new Set(matchSet); for (const n of nodes) if (!n.t && matchSet.has(n.topic)) focusSet.add(n); }

  // links: weak = faint and thin, strong = dark and thick; item spokes thin
  ctx.lineCap = 'round';
  const kAdj = Math.max(0.6, Math.min(1.4, view.k));
  for (const e of edges) {
    const on = !focusSet || (focusSet.has(e.a) && focusSet.has(e.b));
    const hot = hover && (e.a === hover || e.b === hover);
    let a = e.item ? 0.3 : 0.12 + 0.8 * e.n;
    if (!on && !hot) a *= 0.1;
    ctx.globalAlpha = a;
    ctx.strokeStyle = hot ? colors.accent : colors.ink;
    ctx.lineWidth = (e.item ? 1 : 1 + 5 * e.n) / kAdj;
    ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
  }

  // item dots
  for (const n of nodes) {
    if (n.t) continue;
    ctx.globalAlpha = focusSet && !focusSet.has(n) ? 0.12 : 1;
    ctx.fillStyle = n === hover ? colors.accent : colors.imp[n.imp] || colors.ink;
    ctx.fillRect(n.x - DOT, n.y - DOT, DOT * 2, DOT * 2);
  }

  // topic boxes (the popped one last, on top)
  const order = popping ? [...tnodes.filter((n) => n !== popping), popping] : tnodes;
  for (const n of order) drawBox(n, focusSet);

  // hovered item: show its title (like v1)
  if (hover && !hover.t) {
    ctx.globalAlpha = 1;
    const fs = 14 / view.k;
    ctx.font = `700 ${fs}px ${colors.fb}`;
    const text = hover.it.title.length > 70 ? hover.it.title.slice(0, 69) + '…' : hover.it.title;
    const tw = ctx.measureText(text).width, px = 6 / view.k;
    const x = hover.x + 10 / view.k, y = hover.y - 12 / view.k;
    ctx.fillStyle = colors.ink;
    ctx.fillRect(x - px, y - fs - px / 2, tw + px * 2, fs + px * 1.6);
    ctx.fillStyle = colors.panel;
    ctx.textAlign = 'left';
    ctx.fillText(text, x, y);
  }
  ctx.globalAlpha = 1;
}

function boxPath(x, y, w, h, r) {
  ctx.beginPath();
  if (r > 0 && ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawBox(n, focusSet) {
  const s = popScale(n);
  const w = n.w * s, h = n.h * s, x = n.x - w / 2, y = n.y - h / 2;
  const dim = focusSet && !focusSet.has(n);
  ctx.globalAlpha = dim ? 0.15 : 1;
  const glow = (matchSet && matchSet.has(n) && !dim) || s > 1;
  const r = colors.radius;
  ctx.save();
  if (colors.retro) {                                   // hard offset shadow, like the page boxes
    if (glow) { ctx.shadowColor = colors.accent; ctx.shadowBlur = s > 1 ? 34 : 22; }
    ctx.fillStyle = glow ? colors.accent : colors.ink;
    ctx.fillRect(x + 5, y + 5, w, h);
  } else {                                              // soft shadow for Clean / Modern
    ctx.shadowColor = glow ? colors.accent : 'rgba(0,0,0,.22)';
    ctx.shadowBlur = glow ? (s > 1 ? 34 : 22) : 14;
    ctx.shadowOffsetY = glow ? 0 : 4;
    ctx.fillStyle = colors.panel;
    boxPath(x, y, w, h, r); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = colors.panel;
  boxPath(x, y, w, h, r); ctx.fill();
  ctx.save();
  boxPath(x, y, w, h, r); ctx.clip();
  ctx.fillStyle = colors.imp[n.imp] || colors.ink;
  ctx.fillRect(x, y, w, (colors.retro ? 7 : 6) * s);
  ctx.restore();
  ctx.lineWidth = glow ? 4 : colors.retro ? 2.5 : 1.5;
  ctx.strokeStyle = glow ? colors.accent : colors.retro ? colors.ink : colors.line;
  boxPath(x, y, w, h, r); ctx.stroke();

  ctx.save();
  ctx.translate(n.x, n.y);
  ctx.scale(s, s);
  const blockH = n.lines.length * n.lh + 8 + n.cfs;
  let ty = 3 - blockH / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = colors.ink;
  ctx.font = `${colors.hw} ${n.fs}px ${colors.fh}`;
  for (const l of n.lines) { ctx.fillText(l, 0, ty); ty += n.lh; }
  ctx.font = `700 ${n.cfs}px ${colors.fb}`;
  ctx.fillStyle = colors.muted;
  ctx.fillText(n.countText, 0, ty + 8);
  ctx.textBaseline = 'alphabetic';
  ctx.restore();

  if (kbFocus === n || hover === n) {
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.accent;
    ctx.strokeRect(x - 6, y - 6, w + 12, h + 12);
    ctx.setLineDash([]);
  }
}

// ---------- interaction ----------
function hit(sx, sy) {
  const p = toWorld(sx, sy);
  for (let i = tnodes.length - 1; i >= 0; i--) {
    const n = tnodes[i], s = popScale(n);
    if (Math.abs(p.x - n.x) <= n.w * s / 2 && Math.abs(p.y - n.y) <= n.h * s / 2) return n;
  }
  const r = (DOT + 4) / Math.min(1, view.k);
  let best = null, bd = Infinity;
  for (const n of nodes) {
    if (n.t) continue;
    const d = Math.max(Math.abs(p.x - n.x), Math.abs(p.y - n.y));
    if (d <= r && d < bd) { bd = d; best = n; }
  }
  return best;
}
const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

function wireControls() {
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = local(e);
    ptr.set(e.pointerId, p);
    if (ptr.size === 2) {
      const [a, b] = [...ptr.values()];
      drag = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    const n = hit(p.x, p.y);
    drag = n ? { mode: 'node', node: n, sx: p.x, sy: p.y, moved: false } : { mode: 'pan', sx: p.x, sy: p.y, vx: view.x, vy: view.y, moved: false };
  });
  cv.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (ptr.has(e.pointerId)) ptr.set(e.pointerId, p);
    if (!drag) {
      const n = hit(p.x, p.y);
      if (n !== hover) { hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; requestDraw(); }
      return;
    }
    if (drag.mode === 'pinch' && ptr.size === 2) {
      const [a, b] = [...ptr.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      view.x += mx - drag.mx; view.y += my - drag.my;
      zoomAt(mx, my, d / (drag.d || d));
      drag.d = d; drag.mx = mx; drag.my = my;
      return;
    }
    if (Math.hypot(p.x - drag.sx, p.y - drag.sy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (drag.mode === 'pan') {
      view.x = drag.vx + (p.x - drag.sx); view.y = drag.vy + (p.y - drag.sy);
      cv.style.cursor = 'grabbing';
      requestDraw();
    } else {
      const w = toWorld(p.x, p.y);
      drag.node.x = w.x; drag.node.y = w.y;     // the rest follows on its springs
      cv.style.cursor = 'grabbing';
      wake();
    }
  });
  const up = (e) => {
    ptr.delete(e.pointerId);
    if (!drag) return;
    const d = drag;
    if (d.mode === 'pinch') { if (ptr.size === 0) drag = null; return; }
    drag = null;
    cv.style.cursor = hover ? 'pointer' : 'grab';
    if (d.mode === 'node') {
      if (!d.moved) activate(d.node);
      wake();                                   // let go: it swings back into place
    }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => { if (!drag && hover) { hover = null; requestDraw(); } });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  $('#zin', root).onclick = () => zoomAt(W / 2, H / 2, 1.25);
  $('#zout', root).onclick = () => zoomAt(W / 2, H / 2, 0.8);
  $('#fit', root).onclick = () => fit(matchSet ? [...matchSet] : tnodes);
  $('#relayout', root).onclick = () => {
    scatter(nodes);
    settleNow(reduced() ? 400 : 120);
    fit(tnodes);
    wake();
  };
  let qt = 0;
  $('#gq', root).addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => runSearch(e.target.value, true), 150); });

  $('#gpanel', root).addEventListener('click', async (e) => {
    if (e.target.closest('#gp-close')) return closePanel();
    if (e.target.closest('#gp-more')) { panelShown += PANEL_PAGE; return drawPanel(); }
    if (e.target.closest('.gp-h [data-cycle]') && panelId && panelId !== UNCAT_ID) return setTopicImportance(panelId, nextImp(topicById(panelId).importance));
    await itemClick(e);
  });
  $('#gpanel', root).addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  const list = $('#gnodes', root);
  list.addEventListener('focusin', (e) => { const b = e.target.closest('[data-node]'); kbFocus = b ? byId.get(b.dataset.node) : null; requestDraw(); });
  list.addEventListener('focusout', () => { kbFocus = null; requestDraw(); });
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-node]'); if (b) openNode(b.dataset.node); });
  drawNodeList();
}

/** Click: a box opens its list; a dot opens its link (like v1). */
async function activate(n) {
  if (n.t) return openNode(n.id);
  const it = n.it;
  if (it.type === 'pdf' || it.type === 'movie') { try { await openFile(it); } catch (err) { say(err.message, 'error'); } return; }
  const href = safeHref(it.url);
  if (href) window.open(href, '_blank', 'noopener');
}

function drawNodeList() {
  if (!root) return;
  $('#gnodes', root).innerHTML = tnodes.map((n) => `<li><button type="button" data-node="${esc(n.id)}">${esc(n.name)}, ${esc(n.countText)}. Open its items.</button></li>`).join('');
}

// ---------- search ----------
/** Topic ids matching a query by topic name, keyword or item title (the library uses it too). */
export function matchTopics(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const has = (s) => { const h = norm(s); return words.every((w) => h.includes(w)); };
  const hits = new Set();
  for (const t of topics()) if (has(t.name) || t.keywords.some((k) => has(k.w))) hits.add(t.id);
  for (const it of S.items) { const k = it.topicId || UNCAT_ID; if (!hits.has(k) && has(it.title)) hits.add(k); }
  if (has(UNCAT.name)) hits.add(UNCAT_ID);
  return hits;
}

function runSearch(q, refit) {
  const hits = matchTopics(q);
  if (!hits) {
    matchSet = null;
    $('#gcount', root).textContent = `${plural(tnodes.length, 'topic')} · ${plural(edges.filter((e) => !e.item).length, 'link')}`;
    requestDraw();
    if (refit) fit(tnodes);
    return;
  }
  matchSet = new Set([...hits].map((id) => byId.get(id)).filter(Boolean));
  $('#gcount', root).textContent = matchSet.size ? `${plural(matchSet.size, 'topic')} match` : 'no topic matches';
  if (refit && matchSet.size) fit([...matchSet]);
  requestDraw();
}

// ---------- click: pop + side panel ----------
function openNode(id) {
  pop = { id, start: performance.now() };
  panelId = id;
  panelShown = PANEL_PAGE;
  drawPanel();
  wake();
}

function drawPanel() {
  const p = $('#gpanel', root);
  const t = panelId === UNCAT_ID ? UNCAT : topicById(panelId);
  if (!t) return closePanel();
  const items = sortItems(itemsOf(t.id));
  const wasOpen = !p.hidden;
  p.hidden = false;
  p.innerHTML = `<header class="gp-h tb"><h3 id="gp-h">${esc(t.name)}</h3><span class="n">${items.length}</span>${t.id ? impToggle(t.importance, true, 'Topic importance') : ''}
      <button type="button" class="ic gp-x" id="gp-close" aria-label="Close panel">×</button></header>
    ${items.length ? `<ul class="box-b gp-list">${items.slice(0, panelShown).map((it) => itemRow(it, { draggable: false })).join('')}</ul>` : '<p class="box-empty">No items in this topic yet.</p>'}
    ${items.length > panelShown ? `<button type="button" class="more" id="gp-more">Show more (${items.length - panelShown} hidden)</button>` : ''}`;
  if (!wasOpen) p.querySelector('#gp-close').focus({ preventScroll: true });
}

function closePanel() {
  panelId = null;
  const p = root && $('#gpanel', root);
  if (p) { p.hidden = true; p.innerHTML = ''; }
}

// test hook (used by the automated checks; harmless otherwise)
export const _debug = () => ({ nodes, tnodes, edges, view, running, matchSet, panelId, pop });
