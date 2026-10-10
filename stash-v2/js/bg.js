// bg.js — animated background on a canvas behind the page. It follows the theme:
//   dark (any style) → slowly falling, twinkling stars + an occasional shooting star
//   light Retro      → pixel snow in the palette colors + a slow scanline
//   light Clean      → floating dots that link up with thin lines when they drift close
//   light Modern     → soft colored blobs drifting, with a few rising bubbles
// At most 60 particles, at most 30 fps, paused while the tab is hidden, fewer and slower while the
// graph is open, off with the Settings switch, and off when the system asks for reduced motion.
import { isDark, styleId } from './themes.js';

const MAX = 60, FPS = 30, BUSY_MAX = 24, BUSY_FPS = 15;
const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');

let cv = null, ctx = null, W = 0, H = 0, DPR = 1;
let parts = [], shooters = [], nextShot = 0, kind = '', raf = 0, last = 0, scan = 0;
let enabled = true, busy = false, col = {};

export function initBg() {
  cv = document.createElement('canvas');
  cv.id = 'bgfx';
  cv.setAttribute('aria-hidden', 'true');
  document.body.prepend(cv);
  ctx = cv.getContext('2d');
  addEventListener('resize', size);
  document.addEventListener('visibilitychange', restart);
  reducedMQ.addEventListener('change', restart);
  size();
}

/** enabled: the Settings switch. busy: the graph is open (draw less). Call after theme changes too. */
export function configureBg(opts = {}) {
  if ('enabled' in opts) enabled = !!opts.enabled;
  if ('busy' in opts) busy = !!opts.busy;
  const k = isDark() ? 'stars' : ({ retro: 'pixels', clean: 'net', modern: 'blobs' }[styleId()] || 'pixels');
  readColors();
  if (k !== kind) { kind = k; parts = []; shooters = []; }
  restart();
}

const active = () => cv && enabled && !reducedMQ.matches && !document.hidden;

function restart() {
  cancelAnimationFrame(raf);
  raf = 0;
  if (!cv) return;
  if (!active()) { ctx.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; return; }
  cv.hidden = false;
  fill();
  last = 0;
  raf = requestAnimationFrame(tick);
}

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  const g = (v) => cs.getPropertyValue(v).trim();
  col = { ink: g('--ink'), accent: g('--accent'), mid: g('--mid'), hi: g('--hi'), lo: g('--lo'), line: g('--line') };
}

function size() {
  if (!cv) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const target = () => {
  if (kind === 'blobs') return busy ? 10 : 22;              // 7 blobs + bubbles
  if (kind === 'net') return busy ? 20 : 46;
  return busy ? BUSY_MAX : MAX;
};

function spawn(anywhere, i = 0) {
  const p = { x: rnd(0, W), y: anywhere ? rnd(0, H) : -12, t: rnd(0, Math.PI * 2) };
  if (kind === 'stars') {
    p.r = rnd(0.8, 2); p.vy = rnd(0.06, 0.25); p.vx = rnd(-0.03, 0.03); p.tw = rnd(0.6, 2); p.c = Math.random() < 0.18 ? col.accent : col.ink;
  } else if (kind === 'pixels') {
    p.s = pick([3, 4, 4, 5, 6]); p.vy = rnd(0.25, 0.7); p.vx = rnd(-0.2, 0.2); p.a = rnd(0.28, 0.55);
    p.c = pick([col.accent, col.mid, col.hi, col.ink, col.lo]);
  } else if (kind === 'net') {
    p.r = rnd(2.2, 4); p.vx = rnd(-0.35, 0.35); p.vy = rnd(-0.35, 0.35); p.a = rnd(0.35, 0.6); p.c = Math.random() < 0.35 ? col.accent : col.ink;
  } else {
    p.blob = i < 7;
    if (p.blob) { p.r = rnd(180, 340); p.vx = rnd(-0.35, 0.35); p.vy = rnd(-0.25, 0.25); p.c = pick([col.accent, col.mid, col.hi, col.lo]); }
    else { p.r = rnd(6, 16); p.vx = rnd(-0.15, 0.15); p.vy = rnd(-0.6, -0.25); p.a = rnd(0.25, 0.45); p.c = pick([col.accent, col.mid]); if (!anywhere) p.y = H + 20; }
  }
  return p;
}
function fill() {
  const n = target();
  while (parts.length < n) parts.push(spawn(true, parts.length));
  if (parts.length > n) parts.length = n;
}

function shoot(now) {
  // a streak from the upper part of the screen, heading down and sideways
  const fromLeft = Math.random() < 0.5;
  const speed = rnd(9, 14);
  const ang = rnd(0.35, 0.65) * (fromLeft ? 1 : -1);
  shooters.push({ x: fromLeft ? rnd(-50, W * 0.6) : rnd(W * 0.4, W + 50), y: rnd(-40, H * 0.35), vx: Math.sin(ang) * speed, vy: Math.cos(ang) * speed * 0.55, life: 0, max: rnd(45, 75), len: rnd(120, 220) });
  nextShot = now + rnd(busy ? 6000 : 2500, busy ? 12000 : 6500);
}

function tick(now) {
  if (!active()) { raf = 0; return; }
  raf = requestAnimationFrame(tick);
  const fps = busy ? BUSY_FPS : FPS;
  if (last && now - last < 1000 / fps - 1) return;
  const dt = last ? Math.min(3, (now - last) / (1000 / 60)) : 1;   // move in "60 fps frames"
  last = now;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  fill();

  if (kind === 'blobs') drawBlobs(dt);
  else if (kind === 'net') drawNet(dt);
  else {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.t += 0.05 * dt;
      if (p.y > H + 20 || p.x < -30 || p.x > W + 30) { parts[i] = spawn(false); continue; }
      if (kind === 'stars') {
        ctx.globalAlpha = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(p.t * p.tw));
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, p.r * 1.6, p.r * 1.6);
      } else {                                   // pixel snow, swaying a little
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.c;
        ctx.fillRect(Math.round(p.x + Math.sin(p.t) * 6), Math.round(p.y), p.s, p.s);
      }
    }
  }

  if (kind === 'stars') {                        // shooting stars
    if (!nextShot) nextShot = now + rnd(1200, 3000);
    if (now > nextShot && shooters.length < 2) shoot(now);
    shooters = shooters.filter((s) => s.life < s.max);
    for (const s of shooters) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life += dt;
      const fade = Math.min(1, s.life / 8) * Math.max(0, 1 - s.life / s.max);
      const k = s.len / Math.hypot(s.vx, s.vy);
      const tx = s.x - s.vx * k, ty = s.y - s.vy * k;
      const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, col.ink); g.addColorStop(0.25, col.accent); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.85 * fade;
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = col.ink;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
  }

  if (kind === 'pixels') {                       // the slow retro scanline
    scan = (scan + 0.9 * dt) % (H + 160);
    const g = ctx.createLinearGradient(0, scan - 80, 0, scan + 80);
    g.addColorStop(0, 'transparent'); g.addColorStop(0.5, col.accent); g.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = g;
    ctx.fillRect(0, scan - 80, W, 160);
  }
  ctx.globalAlpha = 1;
}

function drawNet(dt) {
  for (const p of parts) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.x < -10) p.x = W + 10; else if (p.x > W + 10) p.x = -10;
    if (p.y < -10) p.y = H + 10; else if (p.y > H + 10) p.y = -10;
  }
  const R = 150;
  ctx.lineWidth = 1;
  ctx.strokeStyle = col.ink;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > R) continue;
      ctx.globalAlpha = 0.22 * (1 - d / R);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  for (const p of parts) {
    ctx.globalAlpha = p.a;
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBlobs(dt) {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.t += 0.01 * dt;
    if (p.blob) {
      if (p.x < -p.r) p.vx = Math.abs(p.vx); if (p.x > W + p.r) p.vx = -Math.abs(p.vx);
      if (p.y < -p.r) p.vy = Math.abs(p.vy); if (p.y > H + p.r) p.vy = -Math.abs(p.vy);
      const r = p.r * (0.9 + 0.1 * Math.sin(p.t * 3));
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, p.c); g.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = g;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    } else {
      if (p.y < -30) { parts[i] = spawn(false, i); continue; }
      ctx.globalAlpha = p.a;
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x + Math.sin(p.t * 8) * 10, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
    }
  }
}
