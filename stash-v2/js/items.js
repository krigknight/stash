// items.js — one item row (used by the library and the graph side panel) and its actions:
// importance cycle, move menu, delete with 6-second undo, opening PDFs.
import { S, topicById, effImp, UNCAT, setImportance, moveItem, deleteItems, restoreItems, itemById } from './data.js';
import { esc, safeHref, hostOf, plural } from './util.js';
import { say, undoBar, moveMenu, impToggle, nextImp } from './ui.js';
import { openFile } from './imports.js';

export const TYPE_LABEL = { bookmark: 'Link', video: 'Video', playlist: 'Playlist', pdf: 'PDF', movie: 'Movie' };
export const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Items sorted High, Mid, Low, then alphabetically. */
export const sortItems = (list) => list.sort((a, b) => effImp(b) - effImp(a) || collator.compare(a.title, b.title));

export function itemRow(it, { draggable = true } = {}) {
  const imp = effImp(it);
  const isFile = it.type === 'pdf' || it.type === 'movie';
  const href = isFile ? '' : safeHref(it.url);
  const meta = [TYPE_LABEL[it.type]];
  if (it.type === 'playlist' && it.count) meta.push(plural(it.count, 'video'));
  if (it.channel) meta.push(it.channel);
  else if (isFile) meta.push(it.folder);
  else if (it.type === 'bookmark') meta.push(hostOf(it.url));
  else if (it.source) meta.push(it.source);
  const link = isFile
    ? `<a href="#" data-file="1" draggable="false" title="${esc(it.title)}">${esc(it.title)}</a>`
    : href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" draggable="false" title="${esc(it.title)}">${esc(it.title)}</a>` : `<span>${esc(it.title)}</span>`;
  return `<li class="it" data-id="${esc(it.id)}"${draggable ? ' draggable="true"' : ''}>
    ${impToggle(imp, it.importance != null, 'Importance')}
    <div class="t">${link}<div class="meta">${esc(meta.filter(Boolean).join(' · '))}${it.manualTopic ? ' · <span title="Placed by hand; Re-sort leaves it alone">pinned</span>' : ''}</div></div>
    <button type="button" class="ic mv" aria-haspopup="menu" title="Move to another topic" aria-label="Move ${esc(it.title)} to another topic">⇄</button>
    <button type="button" class="ic del" title="Remove from Stash only. Your Chrome bookmarks are never touched." aria-label="Remove ${esc(it.title)} from Stash">×</button>
  </li>`;
}

// ---------- delete with undo (several quick deletes undo together) ----------
let pending = [], pendingTimer = 0;
export function removeItem(id) {
  const it = itemById(id);
  if (!it) return;
  pending.push(...deleteItems(id));
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => (pending = []), 6000);
  const batch = pending;
  undoBar(batch.length === 1 ? `Removed "${it.title.slice(0, 60)}" from Stash.` : `Removed ${batch.length} items from Stash.`, () => {
    restoreItems(batch);
    pending = [];
    say(batch.length === 1 ? 'Item restored.' : `${batch.length} items restored.`);
  });
}

/** Cycle an item's importance High → Low → Mid. Landing on the topic's own level = inherit again. */
export function cycleItem(id) {
  const it = itemById(id);
  if (!it) return;
  const next = nextImp(effImp(it));
  setImportance(it.id, next === (topicById(it.topicId) || UNCAT).importance ? null : next);
}

/** Handle a click inside an item row. Returns true if it was an item action. */
export async function itemClick(e) {
  const t = e.target;
  const row = t.closest('.it');
  if (!row) return false;
  const it = itemById(row.dataset.id);
  if (!it) return false;
  if (t.closest('[data-cycle]')) { cycleItem(it.id); return true; }
  if (t.closest('.del')) { removeItem(it.id); return true; }
  if (t.closest('.mv')) {
    moveMenu(t.closest('.mv'), it.topicId, (tid) => {
      moveItem(it.id, tid);
      say(`Moved to ${topicById(tid)?.name || UNCAT.name}. Stash learned a few words from its title.`);
    });
    return true;
  }
  if (t.closest('a[data-file]')) {
    e.preventDefault();
    try { await openFile(it); } catch (err) { say(err.message, 'error'); }
    return true;
  }
  return false;
}

export const itemsOf = (topicId) => S.items.filter((i) => (i.topicId || null) === (topicId || null));
