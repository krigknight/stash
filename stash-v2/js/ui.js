// ui.js — shared UI pieces: status line, 6-second undo bar, dialogs, move-to-topic menu, clipboard, downloads.
import { esc } from './util.js';
import { topics, UNCAT } from './data.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- status line ----------
let msgTimer = 0;
export function say(text, kind = 'info', ms = 8000) {
  const el = $('#msg');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
  clearTimeout(msgTimer);
  if (text && ms) msgTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- undo bar ----------
let undoTimer = 0, undoFn = null;
export function undoBar(text, onUndo, ms = 6000) {
  const bar = $('#undo');
  bar.innerHTML = `<span>${esc(text)}</span><button class="b" type="button">Undo</button><span class="undo-time" aria-hidden="true"></span>`;
  bar.hidden = false;
  undoFn = onUndo;
  const time = bar.querySelector('.undo-time');
  time.style.animation = 'none';
  void time.offsetWidth;
  time.style.animation = `undo-shrink ${ms}ms linear forwards`;
  bar.querySelector('button').onclick = () => { const f = undoFn; hideUndo(); f?.(); };
  clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndo, ms);
}
export function hideUndo() { clearTimeout(undoTimer); undoFn = null; const b = $('#undo'); if (b) b.hidden = true; }

// ---------- dialogs ----------
function dialog(html, setup) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'dlg';
    d.innerHTML = html;
    document.body.append(d);
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    setup(d, done);
    d.showModal();
  });
}

export function confirmDialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return dialog(
    `<h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row end"><button class="b" data-v="0">${esc(cancel)}</button><button class="b ${danger ? 'danger' : 'primary'}" data-v="1">${esc(ok)}</button></div>`,
    (d, done) => {
      d.querySelector('[data-v="0"]').onclick = () => done(false);
      d.querySelector('[data-v="1"]').onclick = () => done(true);
      setTimeout(() => d.querySelector('[data-v="1"]').focus());
    },
  ).then((v) => !!v);
}

export function promptDialog({ title, label, value = '', ok = 'Save' }) {
  return dialog(
    `<form method="dialog"><h2>${esc(title)}</h2><label class="fld">${esc(label)}<input type="text" maxlength="80" value="${esc(value)}"></label><div class="row end"><button class="b" type="button" data-v="0">Cancel</button><button class="b primary" type="submit">${esc(ok)}</button></div></form>`,
    (d, done) => {
      const inp = d.querySelector('input');
      d.querySelector('[data-v="0"]').onclick = () => done(null);
      d.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(inp.value.trim() || null); };
      setTimeout(() => { inp.focus(); inp.select(); });
    },
  );
}

/** A modal with arbitrary content; build(d, close) wires it up. Resolves when closed. */
export function panelDialog(html, build, cls = '') {
  return dialog(html, (d, done) => { if (cls) d.classList.add(cls); build(d, done); });
}

// ---------- move-to-topic menu ----------
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }

/** Opens a keyboard-friendly menu of topics next to `anchor`. */
export function moveMenu(anchor, currentId, onPick) {
  closeMenu();
  const list = [...topics(), UNCAT];
  const m = document.createElement('div');
  m.className = 'menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = `<div class="menu-h">Move to…</div>` + list.map((t) =>
    `<button role="menuitem" type="button" data-t="${esc(t.id ?? '')}" ${t.id === currentId ? 'aria-current="true" disabled' : ''}>${esc(t.name)}</button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + scrollX + 'px';
  m.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + scrollY + 'px';
  openMenu = m;
  const items = [...m.querySelectorAll('button:not([disabled])')];
  items[0]?.focus();
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    closeMenu();
    anchor.focus();
    onPick(b.dataset.t || null);
  });
  m.addEventListener('keydown', (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); anchor.focus(); }
  });
  setTimeout(() => document.addEventListener('pointerdown', function off(e) {
    if (!m.contains(e.target)) { closeMenu(); document.removeEventListener('pointerdown', off); }
  }));
}

// ---------- clipboard + files ----------
export async function copyText(text, btn) {
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch { ok = false; }
  if (btn) {
    const old = btn.dataset.label || btn.textContent;
    btn.dataset.label = old;
    btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    setTimeout(() => { btn.textContent = old; }, 1600);
  }
  if (!ok) say('Copy failed. Select the text and press Ctrl+C (⌘C on Mac).', 'error');
  return ok;
}

export function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const IMP_TXT = ['Low', 'Mid', 'High'];
/** Next value when the importance button is clicked: High → Low → Mid → High. */
export const nextImp = (v) => (v + 1) % 3;

/**
 * ONE importance button. `value` = effective importance (0-2); `own` = set on this item
 * (solid) rather than inherited from its topic (dashed). Clicking cycles High → Low → Mid.
 */
export function impToggle(value, own, label) {
  const name = IMP_TXT[value];
  const next = IMP_TXT[nextImp(value)];
  return `<button type="button" class="ib i${value} ${own ? 'on' : 'inh'}" data-cycle="${value}" title="${esc(label)}: ${name}${own ? '' : ' (from its topic)'}. Click for ${next}." aria-label="${esc(label)}: ${name}${own ? '' : ', inherited from topic'}. Activate to change to ${next}.">${name}</button>`;
}
