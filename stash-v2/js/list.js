// list.js — Library view: High / Mid / Low bands of topic boxes (max 4 per row),
// drag and drop (boxes within/between bands, items onto boxes), search and filters.
import { S, topics, topicById, effImp, UNCAT, moveItem, resort, setTopicImportance, moveTopic, itemById } from './data.js';
import { esc, norm, plural } from './util.js';
import { $, $$, say, impToggle, nextImp, closeMenu } from './ui.js';
import { importBookmarks, importPlaylists, importWatchLater, importFolder, summary, filesSupported } from './imports.js';
import { openLeftovers } from './onboarding.js';
import { itemRow, itemClick, sortItems } from './items.js';

const PAGE = 60;                       // items rendered per box before "Show more"
const BANDS = [[2, 'High'], [1, 'Mid'], [0, 'Low']];
const shown = new Map();
const filt = { q: '', imp: '', type: '' };   // kept while switching views
let root = null, raf = 0;
let dragItem = null, dragTopic = null;

export function render(el) {
  root = el;
  el.innerHTML = `
  <section class="toolbar" aria-label="Library actions">
    <span class="tl">Import:</span>
    <button class="b" data-import="bookmarks" title="Read your Chrome bookmarks (they are not changed)">Chrome bookmarks</button>
    <button class="b" data-import="playlists" title="Opens youtube.com/feed/playlists in a tab and reads your saved playlists">YouTube playlists</button>
    <button class="b" data-import="watchlater" title="Reads an open Watch Later (or other playlist) tab as single videos, or opens Watch Later for you">Watch Later</button>
    <button class="b" data-import="files">PDFs</button>
    <span class="sep" aria-hidden="true"></span>
    <button class="b" id="resort" title="Re-check every item that you did not place by hand">Re-sort</button>
    <button class="b" id="leftovers" title="Copy a prompt that lets an AI sort your uncategorized items">AI sort leftovers</button>
  </section>
  <section class="filters" role="search" aria-label="Search and filter">
    <input type="search" id="q" placeholder="search topics, items, keywords, sites, channels…" aria-label="Search topics and items" autocomplete="off">
    <select id="fImp" aria-label="Filter by importance"><option value="">any importance</option><option value="2">High</option><option value="1">Mid</option><option value="0">Low</option></select>
    <select id="fType" aria-label="Filter by type"><option value="">all types</option><option value="bookmark">Links</option><option value="video">Videos</option><option value="playlist">Playlists</option><option value="pdf">PDFs</option></select>
    <button class="b sm" id="clearF" type="button" hidden>Clear</button>
    <span class="count" id="count" aria-live="polite"></span>
  </section>
  <section id="perm" class="win perm" hidden aria-labelledby="perm-h">
    <div class="tb"><h3 id="perm-h">Permission</h3></div><div class="wb">
    <p><b>Allow Stash to look at a folder?</b></p>
    <p>Stash will list the <b>PDF files</b> in one folder you pick (and its subfolders). It reads <b>file names only</b>: nothing is opened, uploaded, moved or deleted. Chrome will ask you to confirm.</p>
    <p class="hint">Chrome refuses top-level folders like Documents, Downloads or Desktop. Pick a subfolder inside them, such as Downloads\\Books.</p>
    <div class="row"><button class="b primary" id="permYes">Allow, pick a folder</button><button class="b" id="permNo">No thanks</button></div>
  </div></section>
  <div id="bands"></div>`;

  $('#q', el).value = filt.q;
  $('#fImp', el).value = filt.imp;
  $('#fType', el).value = filt.type;
  let qt = 0;
  $('#q', el).addEventListener('input', (e) => { clearTimeout(qt); qt = setTimeout(() => { filt.q = e.target.value; draw(); }, 120); });
  $('#fImp', el).addEventListener('change', (e) => { filt.imp = e.target.value; draw(); });
  $('#fType', el).addEventListener('change', (e) => { filt.type = e.target.value; draw(); });
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey);
  el.addEventListener('dragstart', onDragStart);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);
  el.addEventListener('dragend', clearDrag);
  draw();
}

export function update(kind) {
  if (kind === 'items' || kind === 'profile') { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
}
export function dispose() { closeMenu(); cancelAnimationFrame(raf); root = null; }

// ---------- filtering ----------
const filtering = () => !!(filt.q.trim() || filt.imp !== '' || filt.type);
function matcherFn() {
  const words = norm(filt.q).split(/\s+/).filter(Boolean);
  const imp = filt.imp === '' ? null : +filt.imp;
  // a topic whose name or keywords match brings all of its items along (same search as the graph)
  const has = (s) => { const h = norm(s); return words.every((w) => h.includes(w)); };
  const topicHit = new Set(words.length ? topics().filter((t) => has(t.name) || t.keywords.some((k) => has(k.w))).map((t) => t.id) : []);
  return (it) => {
    if (imp != null && effImp(it) !== imp) return false;
    if (filt.type && it.type !== filt.type) return false;
    if (!words.length || topicHit.has(it.topicId)) return true;
    return has(`${it.title} ${it.url} ${it.source} ${it.folder} ${it.channel || ''}`);
  };
}

// ---------- drawing ----------
function draw() {
  if (!root) return;
  const host = $('#bands', root);
  const focus = rememberFocus(host);
  const active = filtering();
  $('#clearF', root).hidden = !active;

  if (!S.items.length && !topics().length) {
    host.innerHTML = `<div class="empty win"><div class="tb"><h3>Nothing here yet</h3></div><div class="wb">
      <p>You have no topics yet. <a href="#setup">Set up topics</a> first, then import your bookmarks and playlists.</p></div></div>`;
    $('#count', root).textContent = '';
    return;
  }

  const ok = matcherFn();
  const byTopic = new Map(topics().map((t) => [t.id, []]));
  const unc = [];
  let shownN = 0;
  for (const it of S.items) {
    if (!ok(it)) continue;
    shownN++;
    (byTopic.get(it.topicId) || unc).push(it);
  }
  $('#count', root).textContent = active ? `${shownN} of ${plural(S.items.length, 'item')}` : plural(S.items.length, 'item');

  const sorted = [...topics()].sort((a, b) => a.order - b.order);
  const hint = S.items.length ? '' : `<div class="note" role="status"><span>Nothing stashed yet. Use the Import buttons above, or click the Stash icon in Chrome's toolbar on any page to add it.</span></div>`;
  host.innerHTML = hint + BANDS.map(([band, label]) => {
    const list = sorted.filter((t) => t.importance === band).map((t) => [t, byTopic.get(t.id)]);
    if (band === 0 && (unc.length || !active)) list.push([UNCAT, unc]);
    const visible = active ? list.filter(([, items]) => items.length) : list;
    const nItems = list.reduce((n, [, items]) => n + items.length, 0);
    const realTopics = list.filter(([t]) => t.id).length;
    return `<section class="band band-${band}" data-band="${band}" aria-labelledby="band-${band}">
      <h2 class="band-h" id="band-${band}"><span class="band-name">${label}</span>
        <span class="band-meta">${plural(realTopics, 'topic')} · ${plural(nItems, 'item')}</span></h2>
      <div class="bgrid" data-band="${band}">
        ${visible.map(([t, items]) => box(t, items)).join('')}
        ${!visible.length ? `<p class="band-empty">${active ? 'No matches in this band.' : `Drag a topic box here to make it ${label}.`}</p>` : ''}
      </div>
    </section>`;
  }).join('');
  restoreFocus(host, focus);
}

function box(t, items) {
  sortItems(items);
  const key = t.id ?? '';
  const n = shown.get(key) ?? PAGE;
  const rest = items.length - n;
  return `<section class="box" data-topic="${esc(key)}" aria-label="${esc(t.name)}">
    <header class="box-h"${t.id ? ' draggable="true"' : ''}>
      ${t.id ? `<button type="button" class="grip" aria-label="Move topic ${esc(t.name)}. Left and right arrows reorder it, up and down change its importance." title="Drag to reorder or to another band (or focus and use arrow keys)">⠿</button>` : ''}
      <h2>${esc(t.name)}</h2><span class="n">${items.length}</span>
      ${t.id ? impToggle(t.importance, true, 'Topic importance') : ''}
    </header>
    ${items.length ? `<ul class="box-b">${items.slice(0, n).map((it) => itemRow(it)).join('')}</ul>` : `<p class="box-empty">${filtering() ? 'No matches.' : 'Empty. Drag items here or use ⇄.'}</p>`}
    ${rest > 0 ? `<button type="button" class="more" data-more="${esc(key)}">Show ${Math.min(rest, PAGE)} more (${rest} hidden)</button>` : ''}
  </section>`;
}

function rememberFocus(host) {
  const a = document.activeElement;
  if (!a || !host.contains(a)) return null;
  const row = a.closest('[data-id]');
  const box = a.closest('[data-topic]');
  const sel = a.dataset.cycle != null ? '[data-cycle]' : a.classList.contains('mv') ? '.mv' : a.classList.contains('del') ? '.del'
    : a.classList.contains('grip') ? '.grip' : a.dataset.more != null ? '.more' : null;
  return { id: row?.dataset.id, near: row?.nextElementSibling?.dataset.id || row?.previousElementSibling?.dataset.id, topic: box?.dataset.topic, sel };
}
function restoreFocus(host, f) {
  if (!f) return;
  let el = null;
  const row = (f.id && host.querySelector(`[data-id="${CSS.escape(f.id)}"]`)) || (f.near && host.querySelector(`[data-id="${CSS.escape(f.near)}"]`));
  if (row) el = (f.sel && row.querySelector(f.sel)) || row.querySelector('a, button');
  else if (f.topic != null) {
    const b = host.querySelector(`[data-topic="${CSS.escape(f.topic)}"]`);
    el = b && ((f.sel && b.querySelector(f.sel === '.more' ? '.more' : '.box-h ' + f.sel)) || b.querySelector('button'));
  }
  el?.focus({ preventScroll: false });
}

// ---------- clicks + keyboard ----------
async function onClick(e) {
  const t = e.target;
  const imp = t.closest('[data-import]');
  if (imp) return runImport(imp.dataset.import);
  if (t.closest('#resort')) {
    const n = resort();
    return say(`Re-sorted. ${plural(n, 'item')} changed topic. Items you placed by hand were left alone.`);
  }
  if (t.closest('#leftovers')) return openLeftovers();
  if (t.closest('#clearF')) {
    filt.q = ''; filt.imp = ''; filt.type = '';
    $('#q', root).value = ''; $('#fImp', root).value = ''; $('#fType', root).value = '';
    return draw();
  }
  if (t.closest('#permYes')) { $('#perm', root).hidden = true; return runImport('files-go'); }
  if (t.closest('#permNo')) { $('#perm', root).hidden = true; return say('No folder was read.'); }

  const more = t.closest('[data-more]');
  if (more) { const k = more.dataset.more; shown.set(k, (shown.get(k) ?? PAGE) + PAGE); return draw(); }

  if (await itemClick(e)) return;
  const box = t.closest('[data-topic]');
  if (t.closest('.box-h [data-cycle]') && box?.dataset.topic) {
    return setTopicImportance(box.dataset.topic, nextImp(+t.closest('[data-cycle]').dataset.cycle));
  }
}

/** Keyboard alternative to dragging a box: arrows on its ⠿ handle. */
function onKey(e) {
  const g = e.target.closest('.grip');
  if (!g || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const id = g.closest('[data-topic]').dataset.topic;
  const t = topicById(id);
  if (!t) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    const to = Math.max(0, Math.min(2, t.importance + (e.key === 'ArrowUp' ? 1 : -1)));
    if (to === t.importance) return;
    moveTopic(id, to, null);
    return say(`${t.name} moved to ${['Low', 'Mid', 'High'][to]}.`);
  }
  const band = [...topics()].filter((x) => x.importance === t.importance).sort((a, b) => a.order - b.order);
  const i = band.findIndex((x) => x.id === id);
  if (e.key === 'ArrowLeft' && i > 0) moveTopic(id, t.importance, band[i - 1].id);
  if (e.key === 'ArrowRight' && i < band.length - 1) moveTopic(id, t.importance, band[i + 2]?.id ?? null);
}

// ---------- drag and drop ----------
function onDragStart(e) {
  const row = e.target.closest?.('.it');
  if (row) {
    dragItem = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', itemById(dragItem)?.title || '');
    row.classList.add('dragging');
    root.classList.add('drag-item');
    return;
  }
  const head = e.target.closest?.('.box-h');
  const b = head?.closest('[data-topic]');
  if (b?.dataset.topic) {
    dragTopic = b.dataset.topic;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', topicById(dragTopic)?.name || '');
    b.classList.add('dragging');
    // Collapse every box to its title bar while a topic is dragged, so all three bands fit on screen.
    setTimeout(() => root?.classList.add('drag-topic'), 0);
  }
}

function clearMarks() { $$('.drop, .ins-before, .ins-after, .band.drop-band', root).forEach((x) => x.classList.remove('drop', 'ins-before', 'ins-after', 'drop-band')); }
function clearDrag() {
  dragItem = dragTopic = null;
  if (!root) return;
  clearMarks();
  $$('.dragging', root).forEach((x) => x.classList.remove('dragging'));
  root.classList.remove('drag-item', 'drag-topic');
}

/** Where would a dragged box land? {band, beforeId, target, side} */
function topicTarget(e) {
  const band = e.target.closest('.band');
  if (!band) return null;
  const bandN = +band.dataset.band;
  const boxes = $$('.bgrid > .box[data-topic]', band).filter((b) => b.dataset.topic && b.dataset.topic !== dragTopic);
  let best = null, bd = Infinity;
  for (const b of boxes) {
    const r = b.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + Math.min(r.height, 120) / 2;
    const d = Math.hypot(e.clientX - cx, (e.clientY - cy) * 1.5);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) return { band: bandN, beforeId: null, bandEl: band };
  const r = best.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  const i = boxes.indexOf(best);
  return { band: bandN, beforeId: after ? boxes[i + 1]?.dataset.topic ?? null : best.dataset.topic, target: best, side: after ? 'ins-after' : 'ins-before', bandEl: band };
}

function onDragOver(e) {
  if (dragItem) {
    const b = e.target.closest('.box');
    if (!b) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!b.classList.contains('drop')) { clearMarks(); b.classList.add('drop'); }
  } else if (dragTopic) {
    const tg = topicTarget(e);
    if (!tg) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearMarks();
    tg.bandEl.classList.add('drop-band');
    if (tg.target) tg.target.classList.add(tg.side);
  }
}
function onDragLeave(e) {
  if (!root || root.contains(e.relatedTarget)) return;
  clearMarks();
}

function onDrop(e) {
  if (dragItem) {
    const b = e.target.closest('.box');
    if (b) {
      e.preventDefault();
      const tid = b.dataset.topic || null;
      const it = itemById(dragItem);
      if (it && (it.topicId || null) !== tid) {
        moveItem(it.id, tid);
        say(`Moved "${it.title.slice(0, 50)}" to ${topicById(tid)?.name || UNCAT.name}.`);
      }
    }
  } else if (dragTopic) {
    const tg = topicTarget(e);
    if (tg) {
      e.preventDefault();
      const t = topicById(dragTopic);
      const was = t.importance;
      moveTopic(dragTopic, tg.band, tg.beforeId);
      if (was !== tg.band) say(`${t.name} is now ${['Low', 'Mid', 'High'][tg.band]}.`);
    }
  }
  clearDrag();
}

// ---------- imports ----------
let busy = false;
/** Shared with onboarding/settings. kind: bookmarks | playlists | watchlater | files */
export async function runImport(kind) {
  if (kind === 'files') {
    if (!filesSupported()) return say("This browser can't pick folders. Use a recent Chrome or Edge.", 'error');
    const card = root && $('#perm', root);
    if (card) { card.hidden = false; card.querySelector('#permYes').focus(); return; }
    location.hash = '#library';
    return;
  }
  if (busy) return say('An import is already running. Please wait.');
  busy = true;
  document.body.classList.add('busy');
  try {
    if (kind === 'bookmarks') {
      say('Reading Chrome bookmarks…', 'info', 0);
      const r = await importBookmarks();
      say(`Bookmarks: ${summary(r.res, 'item')}.`, 'ok');
    } else if (kind === 'playlists') {
      say('Opening your YouTube playlists page in a new tab to read it. Leave it open; it closes by itself when done.', 'info', 0);
      const r = await importPlaylists();
      say(`YouTube playlists: ${summary(r.res, 'playlist')}.`, 'ok');
    } else if (kind === 'watchlater') {
      say('Reading the Watch Later list in a YouTube tab. Leave it open; Stash switches back when done.', 'info', 0);
      const r = await importWatchLater();
      say(`${r.label}: ${summary(r.res, 'video')}.`, 'ok');
    } else if (kind === 'files-go') {
      const r = await importFolder((m) => say(m, 'info', 0));
      if (!r) say('No folder picked.');
      else say(`${r.root}: ${summary(r.res, 'PDF')}.`, 'ok');
    }
  } catch (err) {
    say(err.message || String(err), 'error', 0);
  } finally {
    busy = false;
    document.body.classList.remove('busy');
  }
}
