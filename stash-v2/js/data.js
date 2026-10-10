// data.js — storage and model.
//   Items + deleted records live in chrome.storage.local (unlimitedStorage). Not synced.
//   The small profile (topics, keywords, importance, appearance, learned words, deleted-item hashes)
//   lives in chrome.storage.sync, split into chunks, kept under ~90 KB. If it does not fit or sync
//   fails, it is kept in chrome.storage.local only and the settings screen says so.
import { uid, hash, debounce, bytes, dedupeKey, nameKey, typeFromUrl, TYPES } from './util.js';
import { makeMatcher, categorize, learn, relations } from './categorize.js';

const INSTANCE = uid();
export const SYNC_BUDGET = 90 * 1024;
const CHUNK_BYTES = 7600;            // chrome.storage.sync allows 8192 bytes per key
const MAX_DEL_HASHES = 3000;         // synced deleted-item hashes (~10 bytes each)

export const UNCAT = Object.freeze({ id: null, name: 'Uncategorized', importance: 0 });

export function defaultProfile() {
  return {
    v: 2, topics: [], setupDone: false,
    theme: 'light', style: 'retro', palette: 'paper', bgAnim: true,
    delHashes: [], updatedAt: 0,
  };
}

/** Live state shared by every view. Mutate through the functions below. */
export const S = {
  items: [],
  deleted: {},                       // dedupeKey -> deleted item record (for restore)
  profile: defaultProfile(),
  rel: {},                           // topic relation weights, "idA|idB" -> w
  sync: { mode: 'sync', bytes: 0, error: '' },
  ready: false,
};

// ---------- change events ----------
const subs = new Set();
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(kind) { for (const f of subs) { try { f(kind); } catch (e) { console.error(e); } } }

// ---------- profile packing (compact form for sync) ----------
function pack(p) {
  const { topics, ...rest } = p;
  return JSON.stringify({
    ...rest,
    _by: INSTANCE,
    topics: topics.map((t) => ({
      i: t.id, n: t.name, g: t.group || undefined, m: t.importance, o: t.order,
      r: t.related?.length ? t.related : undefined,
      k: (t.keywords || []).map((k) => (k.l ? [k.w, k.weight, 1] : k.weight === 1 ? k.w : [k.w, k.weight])),
    })),
  });
}

function unpack(json) {
  const o = JSON.parse(json);
  if (Array.isArray(o.topics)) {
    o.topics = o.topics.map((t) => ('i' in t ? {
      id: t.i, name: t.n, group: t.g || '', importance: t.m, order: t.o, related: t.r || [],
      keywords: (t.k || []).map((k) => (typeof k === 'string' ? { w: k, weight: 1 } : k[2] ? { w: k[0], weight: k[1], l: 1 } : { w: k[0], weight: k[1] })),
    } : t));
  }
  return sanitizeProfile(o);
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const imp = (v) => (v === 0 || v === 1 || v === 2 ? v : null);

/** Validate a profile object coming from storage or a backup file. */
export function sanitizeProfile(o) {
  const p = defaultProfile();
  if (!o || typeof o !== 'object') return p;
  p.setupDone = !!o.setupDone;
  for (const k of ['theme', 'style', 'palette']) if (typeof o[k] === 'string' && /^[a-z-]{1,20}$/.test(o[k])) p[k] = o[k];
  p.bgAnim = o.bgAnim !== false;
  p.updatedAt = Number(o.updatedAt) || 0;
  p.delHashes = Array.isArray(o.delHashes) ? o.delHashes.filter((h) => typeof h === 'string' && h.length < 12).slice(-MAX_DEL_HASHES) : [];
  const seen = new Set();
  p.topics = (Array.isArray(o.topics) ? o.topics : []).slice(0, 200).map((t, i) => {
    if (!t || typeof t !== 'object') return null;
    const name = str(t.name, 80).trim();
    if (!name) return null;
    let id = str(t.id, 40) || uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    return {
      id, name, group: str(t.group, 60).trim(),
      importance: imp(t.importance) ?? 1,
      order: Number.isFinite(t.order) ? t.order : i,
      related: Array.isArray(t.related) ? t.related.filter((r) => typeof r === 'string').slice(0, 50) : [],
      keywords: (Array.isArray(t.keywords) ? t.keywords : []).map((k) => {
        const w = str(k?.w, 60).trim();
        if (!w) return null;
        const weight = Math.max(0.05, Math.min(5, Number(k.weight) || 1));
        return k.l ? { w, weight, l: 1 } : { w, weight };
      }).filter(Boolean).slice(0, 400),
    };
  }).filter(Boolean);
  const ids = new Set(p.topics.map((t) => t.id));
  for (const t of p.topics) t.related = t.related.filter((r) => ids.has(r) && r !== t.id);
  p.topics.sort((a, b) => a.order - b.order).forEach((t, i) => (t.order = i));
  return p;
}

/** Validate one item from storage or a backup. Returns null if unusable. */
export function sanitizeItem(r) {
  if (!r || typeof r !== 'object') return null;
  const type = TYPES.includes(r.type) ? r.type : null;
  const url = str(r.url, 4000);
  if (!type || !url) return null;
  const isFile = type === 'pdf' || type === 'movie';
  if (isFile ? !url.startsWith('file:') : !/^https?:\/\//i.test(url)) return null;
  const it = {
    id: str(r.id, 40) || uid(), type,
    title: str(r.title, 500).trim() || url,
    url, source: str(r.source, 200), folder: str(r.folder, 500),
    topicId: typeof r.topicId === 'string' ? r.topicId : null,
    importance: imp(r.importance),
    manualTopic: !!r.manualTopic,
    addedAt: Number(r.addedAt) || Date.now(),
  };
  if (r.channel) it.channel = str(r.channel, 200);
  if (Number.isFinite(r.count)) it.count = r.count;
  if (Array.isArray(r.alt)) it.alt = r.alt.filter((a) => typeof a === 'string').slice(0, 3);
  it.key = dedupeKey(it);
  return it;
}

// ---------- sync storage (chunked) ----------
function chunks(s) {
  const out = [];
  let cur = '', n = 0;
  for (const ch of s) {               // iterates by code point, so surrogate pairs stay together
    const c = ch.codePointAt(0);
    const b = c === 34 || c === 92 ? 2 : c < 32 ? 6 : c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (n + b > CHUNK_BYTES) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  if (cur) out.push(cur);
  return out;
}

async function readSync() {
  const meta = (await chrome.storage.sync.get('p_meta')).p_meta;
  if (!meta || !(meta.n > 0)) return null;
  const keys = Array.from({ length: meta.n }, (_, i) => 'p_' + i);
  const got = await chrome.storage.sync.get(keys);
  if (keys.some((k) => typeof got[k] !== 'string')) return null;   // still arriving
  try { return unpack(keys.map((k) => got[k]).join('')); } catch { return null; }
}

async function readLocalProfile() {
  const { profileLocal } = await chrome.storage.local.get('profileLocal');
  try { return profileLocal ? unpack(profileLocal) : null; } catch { return null; }
}

async function writeProfileNow() {
  const p = S.profile;
  p.updatedAt = Date.now();
  const json = pack(p);
  const size = bytes(json);
  S.sync.bytes = size;
  await chrome.storage.local.set({ profileLocal: json });
  if (size > SYNC_BUDGET) {
    S.sync.mode = 'local';
    S.sync.error = `Your settings are ${(size / 1024).toFixed(0)} KB, over the 90 KB sync limit, so they are saved on this device only. Removing topics or keywords will let them sync again.`;
    emit('sync');
    return;
  }
  const parts = chunks(json);
  const obj = { p_meta: { n: parts.length, by: INSTANCE, at: p.updatedAt } };
  parts.forEach((c, i) => (obj['p_' + i] = c));
  try {
    const prev = (await chrome.storage.sync.get('p_meta')).p_meta;
    await chrome.storage.sync.set(obj);
    if (prev?.n > parts.length) {
      await chrome.storage.sync.remove(Array.from({ length: prev.n - parts.length }, (_, i) => 'p_' + (parts.length + i)));
    }
    S.sync.mode = 'sync';
    S.sync.error = '';
  } catch (e) {
    S.sync.mode = 'local';
    S.sync.error = `Sync is unavailable right now (${e.message}). Settings are saved on this device and will sync after your next change.`;
  }
  emit('sync');
}

async function writeItemsNow() {
  S.rel = relations(S.profile.topics, S.items);
  await chrome.storage.local.set({ items: S.items, deleted: S.deleted, rel: S.rel, itemsMeta: { by: INSTANCE, at: Date.now() } });
}

let dirtyProfile = false, dirtyItems = false;
const writeProfile = debounce(() => { dirtyProfile = false; return writeProfileNow().catch(console.error); }, 500);
const writeItems = debounce(() => { dirtyItems = false; return writeItemsNow().catch((e) => console.error('Saving items failed', e)); }, 250);

// Never lose a pending write when the tab is closed or hidden.
function flushPending() {
  if (dirtyProfile) writeProfile.flush();
  if (dirtyItems) writeItems.flush();
}
if (typeof addEventListener === 'function') {
  addEventListener('pagehide', flushPending);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending(); });
}

/** Write everything immediately (popup uses this before it can be closed). */
export async function saveNow() {
  writeProfile.cancel();
  writeItems.cancel();
  dirtyProfile = dirtyItems = false;
  await Promise.all([writeProfileNow(), writeItemsNow()]);
}

export function commitItems() { dirtyItems = true; writeItems(); emit('items'); }
export function commitProfile() { _matcher = null; _topicMap = null; dirtyProfile = true; writeProfile(); emit('profile'); }

// ---------- load + live reload from other tabs / devices ----------
function pickProfile(local, synced) {
  if (synced && (!local || synced.updatedAt >= local.updatedAt)) return synced;
  return local || defaultProfile();
}

function fixOrphans() {
  const ids = new Set(S.profile.topics.map((t) => t.id));
  for (const it of S.items) {
    if (it.topicId && !ids.has(it.topicId)) { it.topicId = null; it.manualTopic = false; }
    if (it.alt) it.alt = it.alt.filter((a) => ids.has(a));
  }
}

export async function load() {
  const L = await chrome.storage.local.get(['items', 'deleted', 'rel']);
  S.items = (Array.isArray(L.items) ? L.items : []).map(sanitizeItem).filter(Boolean);
  S.deleted = L.deleted && typeof L.deleted === 'object' ? L.deleted : {};
  S.rel = L.rel || {};
  let synced = null;
  try { synced = await readSync(); } catch { /* sync unavailable */ }
  S.profile = pickProfile(await readLocalProfile(), synced);
  S.sync.bytes = bytes(pack(S.profile));
  if (S.sync.bytes > SYNC_BUDGET) { S.sync.mode = 'local'; S.sync.error = 'Your settings are over the 90 KB sync limit and are saved on this device only.'; }
  fixOrphans();
  _matcher = null; _topicMap = null;
  S.ready = true;
  return S;
}

const reloadItems = debounce(async () => {
  const L = await chrome.storage.local.get(['items', 'deleted', 'rel']);
  S.items = (Array.isArray(L.items) ? L.items : []).map(sanitizeItem).filter(Boolean);
  S.deleted = L.deleted || {};
  S.rel = L.rel || {};
  fixOrphans();
  emit('items');
}, 150);

const reloadProfile = debounce(async () => {
  let synced = null;
  try { synced = await readSync(); } catch { /* ignore */ }
  const next = pickProfile(await readLocalProfile(), synced);
  if (next.updatedAt <= S.profile.updatedAt) return;
  S.profile = next;
  _matcher = null; _topicMap = null;
  fixOrphans();
  emit('profile');
  emit('remote-profile');
}, 300);

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.itemsMeta?.newValue && ch.itemsMeta.newValue.by !== INSTANCE) reloadItems();
    if (area === 'sync' && ch.p_meta?.newValue && ch.p_meta.newValue.by !== INSTANCE) reloadProfile();
    if (area === 'local' && ch.profileLocal?.newValue) {
      try { if (JSON.parse(ch.profileLocal.newValue)._by !== INSTANCE) reloadProfile(); } catch { /* ignore */ }
    }
  });
}

// ---------- topics ----------
let _matcher = null, _topicMap = null;
export const matcher = () => (_matcher ||= makeMatcher(S.profile.topics));
export const topics = () => S.profile.topics;
export function topicById(id) {
  if (!id) return null;
  if (!_topicMap) _topicMap = new Map(S.profile.topics.map((t) => [t.id, t]));
  return _topicMap.get(id) || null;
}
export const topicOf = (it) => topicById(it.topicId) || UNCAT;
/** Effective importance: the item's own override, else its topic's. */
export const effImp = (it) => it.importance ?? topicOf(it).importance;

export function addTopic(name, importance = 1) {
  name = String(name || '').trim().slice(0, 80);
  if (!name) return { error: 'Type a topic name first.' };
  const ex = S.profile.topics.find((t) => nameKey(t.name) === nameKey(name));
  if (ex) return { error: `"${ex.name}" already exists.` };
  const t = { id: uid(), name, group: '', importance, order: S.profile.topics.length, related: [], keywords: [{ w: name, weight: 1 }] };
  S.profile.topics.push(t);
  commitProfile();
  return { topic: t };
}

export function renameTopic(id, name) {
  const t = topicById(id);
  name = String(name || '').trim().slice(0, 80);
  if (!t || !name) return { error: 'Name cannot be empty.' };
  const ex = S.profile.topics.find((x) => x.id !== id && nameKey(x.name) === nameKey(name));
  if (ex) return { error: `"${ex.name}" already exists.` };
  t.name = name;
  commitProfile();
  emit('items');
  return {};
}

export function setTopicImportance(id, importance) {
  const t = topicById(id);
  if (!t || imp(importance) == null) return;
  t.importance = importance;
  commitProfile();
  emit('items');
}

/**
 * Move a topic to an importance band and position (drag and drop in the list view).
 * beforeId = the topic it should sit in front of; null = end of that band.
 */
export function moveTopic(id, importance, beforeId = null) {
  const t = topicById(id);
  if (!t || imp(importance) == null) return;
  const all = [...S.profile.topics].sort((a, b) => a.order - b.order).filter((x) => x.id !== id);
  t.importance = importance;
  let idx = beforeId ? all.findIndex((x) => x.id === beforeId) : -1;
  if (idx < 0) {
    let last = -1;
    all.forEach((x, i) => { if (x.importance === importance) last = i; });
    idx = last >= 0 ? last + 1 : all.length;
  }
  all.splice(idx, 0, t);
  all.forEach((x, i) => (x.order = i));
  S.profile.topics = all;
  commitProfile();
  emit('items');
}

/** Delete a topic. Its items go to Uncategorized (and may be re-sorted later). */
export function deleteTopic(id) {
  const t = topicById(id);
  if (!t) return 0;
  let n = 0;
  for (const it of S.items) if (it.topicId === id) { it.topicId = null; it.manualTopic = false; n++; }
  S.profile.topics = S.profile.topics.filter((x) => x.id !== id);
  S.profile.topics.forEach((x, i) => { x.order = i; x.related = (x.related || []).filter((r) => r !== id); });
  fixOrphans();
  commitProfile();
  commitItems();
  return n;
}

// ---------- items ----------
let _delSet = null, _delSrc = null;
function delSet() {
  if (_delSrc !== S.profile.delHashes || _delSet.size !== S.profile.delHashes.length) {
    _delSrc = S.profile.delHashes;
    _delSet = new Set(_delSrc);
  }
  return _delSet;
}
export const isBlocked = (key) => !!S.deleted[key] || delSet().has(hash(key));
export const findByKey = (key) => S.items.find((i) => i.key === key) || null;
export const itemById = (id) => S.items.find((i) => i.id === id) || null;

function unblock(key) {
  delete S.deleted[key];
  const h = hash(key);
  S.profile.delHashes = S.profile.delHashes.filter((x) => x !== h);
}

/** Build a clean item from importer output. */
export function makeItem(r) {
  const type = TYPES.includes(r.type) ? r.type : typeFromUrl(r.url);
  return sanitizeItem({ ...r, type, id: uid(), topicId: null, importance: r.importance ?? null, manualTopic: false, addedAt: Date.now() });
}

/**
 * Add importer results. Skips duplicates and anything on the deleted blocklist
 * (unless opts.unblock, used when you explicitly add a page from the popup).
 */
export function addItems(raws, opts = {}) {
  const keys = new Set(S.items.map((i) => i.key));
  const res = { added: 0, dup: 0, blocked: 0, items: [] };
  const m = matcher();
  let profileChanged = false;
  for (const r of raws) {
    const it = makeItem(r);
    if (!it) continue;
    if (keys.has(it.key)) { res.dup++; continue; }
    if (isBlocked(it.key)) {
      if (!opts.unblock) { res.blocked++; continue; }
      unblock(it.key); profileChanged = true;
    }
    keys.add(it.key);
    const c = categorize(it, m);
    it.alt = c.alt;
    if (r.topicId !== undefined && (r.topicId === null || topicById(r.topicId))) {
      it.topicId = r.topicId;
      it.manualTopic = r.topicId !== c.topicId;
      if (it.manualTopic && it.topicId) { learn(topicById(it.topicId), it.title, S.profile.topics, S.items); profileChanged = true; }
    } else {
      it.topicId = c.topicId;
    }
    S.items.push(it);
    res.items.push(it);
    res.added++;
  }
  if (res.added) commitItems();
  if (profileChanged) commitProfile();
  return res;
}

/** Set (0-2) or clear (null = inherit from topic) the importance of items. */
export function setImportance(ids, value) {
  for (const id of [].concat(ids)) { const it = itemById(id); if (it) it.importance = imp(value); }
  commitItems();
}

/** Manually move an item to a topic (null = Uncategorized). Learns from its title. */
export function moveItem(id, topicId) {
  const it = itemById(id);
  if (!it || it.topicId === topicId) return;
  it.topicId = topicId && topicById(topicId) ? topicId : null;
  it.manualTopic = true;
  if (it.topicId) {
    learn(topicById(it.topicId), it.title, S.profile.topics, S.items);
    commitProfile();
  }
  commitItems();
}

/** Delete from Stash only (never from Chrome bookmarks). Returns records for undo. */
export function deleteItems(ids) {
  const set = new Set([].concat(ids));
  const recs = [];
  S.items = S.items.filter((it) => {
    if (!set.has(it.id)) return true;
    recs.push(it);
    S.deleted[it.key] = { ...it, deletedAt: Date.now() };
    const h = hash(it.key);
    if (!delSet().has(h)) S.profile.delHashes.push(h);
    return false;
  });
  if (S.profile.delHashes.length > MAX_DEL_HASHES) S.profile.delHashes = S.profile.delHashes.slice(-MAX_DEL_HASHES);
  commitItems();
  commitProfile();
  return recs;
}

/** Put deleted records back (undo, or "Restore" in settings). */
export function restoreItems(recs) {
  const keys = new Set(S.items.map((i) => i.key));
  let n = 0;
  for (const r0 of recs) {
    const r = sanitizeItem(r0);
    if (!r) continue;
    unblock(r.key);
    if (keys.has(r.key)) continue;
    if (r.topicId && !topicById(r.topicId)) { r.topicId = null; r.manualTopic = false; }
    S.items.push(r); keys.add(r.key); n++;
  }
  commitItems();
  commitProfile();
  return n;
}

/** Forget the deleted-item hashes that came from other devices (no local record to show). */
export function clearRemoteDeletes() {
  const mine = new Set(Object.keys(S.deleted).map(hash));
  S.profile.delHashes = S.profile.delHashes.filter((h) => mine.has(h));
  commitProfile();
}
export const remoteDeleteCount = () => {
  const mine = new Set(Object.keys(S.deleted).map(hash));
  return S.profile.delHashes.filter((h) => !mine.has(h)).length;
};

/** Re-evaluate only items that were not placed by hand. Returns how many changed topic. */
export function resort() {
  const m = matcher();
  let changed = 0;
  for (const it of S.items) {
    const c = categorize(it, m);
    if (it.manualTopic) {
      it.alt = [c.topicId, ...c.alt].filter((a) => a && a !== it.topicId).slice(0, 3);
      continue;
    }
    it.alt = c.alt;
    if (it.topicId !== c.topicId) { it.topicId = c.topicId; changed++; }
  }
  commitItems();
  return changed;
}

export function clearItems() { S.items = []; commitItems(); }

// ---------- snapshots (Undo for setup and bulk AI sorting) ----------
export function snapshot() {
  return {
    profile: JSON.parse(JSON.stringify(S.profile)),
    assign: S.items.map((i) => [i.id, i.topicId, i.manualTopic, i.importance]),
  };
}
export function restoreSnapshot(snap) {
  const keepDel = S.profile.delHashes;
  S.profile = sanitizeProfile(snap.profile);
  S.profile.delHashes = keepDel;
  const m = new Map(snap.assign.map((a) => [a[0], a]));
  for (const it of S.items) {
    const a = m.get(it.id);
    if (a) { it.topicId = a[1]; it.manualTopic = a[2]; it.importance = a[3]; }
  }
  fixOrphans();
  commitProfile();
  resort();
}

/**
 * Apply a new topic list (from setup). Topics whose normalized name matches an existing one keep
 * its id and its learned words, so manual placements survive re-running setup.
 */
export function applyTopics(newTopics) {
  const snap = snapshot();
  const old = new Map(S.profile.topics.map((t) => [nameKey(t.name), t]));
  const idMap = new Map();
  for (const t of newTopics) {
    const o = old.get(nameKey(t.name));
    idMap.set(t.id, o ? o.id : t.id);
    if (o) {
      const have = new Set(t.keywords.map((k) => k.w.toLowerCase()));
      for (const k of o.keywords) if (k.l && !have.has(k.w.toLowerCase())) t.keywords.push(k);
    }
  }
  newTopics.forEach((t, i) => {
    t.id = idMap.get(t.id);
    t.order = i;
    t.related = (t.related || []).map((r) => idMap.get(r)).filter((r) => r && r !== t.id);
  });
  S.profile.topics = newTopics;
  S.profile.setupDone = true;
  _matcher = null; _topicMap = null;
  fixOrphans();
  commitProfile();
  resort();
  return snap;
}

/** Apply AI leftover assignments [{itemId, topicId, importance}] and learn from them. */
export function applyAssignments(list) {
  const snap = snapshot();
  const byTopic = new Map();
  for (const a of list) {
    const it = itemById(a.itemId);
    if (!it || !topicById(a.topicId)) continue;
    it.topicId = a.topicId;
    it.manualTopic = true;
    if (a.importance != null) it.importance = a.importance;
    if (!byTopic.has(a.topicId)) byTopic.set(a.topicId, []);
    byTopic.get(a.topicId).push(it.title);
  }
  for (const [tid, titles] of byTopic) learn(topicById(tid), titles, S.profile.topics, S.items);
  commitProfile();
  commitItems();
  return snap;
}

export function setPref(key, value) {
  S.profile[key] = value;
  commitProfile();
}

// ---------- backup ----------
export function exportAll() {
  return {
    app: 'stash', format: 2, exportedAt: new Date().toISOString(),
    profile: JSON.parse(JSON.stringify(S.profile)),
    items: S.items,
    deleted: S.deleted,
  };
}

/** Validate a parsed backup. Returns {data} or {error}. Nothing is changed yet. */
export function readBackup(obj) {
  if (!obj || typeof obj !== 'object' || obj.app !== 'stash') return { error: 'This file is not a Stash backup (missing "app": "stash").' };
  if (!Array.isArray(obj.items)) return { error: 'The backup has no "items" list.' };
  const profile = sanitizeProfile(obj.profile);
  const seen = new Set();
  const items = [];
  for (const r of obj.items) {
    const it = sanitizeItem(r);
    if (!it || seen.has(it.key)) continue;
    seen.add(it.key);
    items.push(it);
  }
  const deleted = {};
  if (obj.deleted && typeof obj.deleted === 'object') {
    for (const v of Object.values(obj.deleted)) {
      const it = sanitizeItem(v);
      if (it) deleted[it.key] = { ...it, deletedAt: Number(v.deletedAt) || Date.now() };
    }
  }
  return { data: { profile, items, deleted }, skipped: obj.items.length - items.length };
}

/** Replace everything with a validated backup. */
export function replaceAll({ profile, items, deleted }) {
  S.profile = profile;
  S.items = items;
  S.deleted = deleted;
  for (const k of Object.keys(deleted)) { const h = hash(k); if (!S.profile.delHashes.includes(h)) S.profile.delHashes.push(h); }
  _matcher = null; _topicMap = null;
  fixOrphans();
  commitProfile();
  commitItems();
}

// ---------- misc local keys ----------
export async function getLocal(key) { return (await chrome.storage.local.get(key))[key]; }
export async function setLocal(key, value) { await chrome.storage.local.set({ [key]: value }); }
