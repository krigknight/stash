// imports.js — Chrome bookmarks, YouTube saved playlists, Watch Later, local PDFs.
import { YT, scrapePlaylistsFeed, scrapePlaylistVideos, ytError } from './youtube.js';
import { addItems } from './data.js';
import { plural } from './util.js';

/** Summarize an addItems() result in one line. */
export function summary(res, what) {
  const parts = [`${plural(res.added, 'new ' + what)} added`];
  if (res.dup) parts.push(`${res.dup} already in Stash`);
  if (res.blocked) parts.push(`${res.blocked} skipped because you deleted them (restore in Settings → Deleted items)`);
  return parts.join(' · ');
}

// ---------- Chrome bookmarks ----------
export async function importBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const out = [];
  const walk = (n, path) => {
    if (n.url) {
      if (/^https?:/i.test(n.url)) out.push({ title: n.title || n.url, url: n.url, source: 'Chrome bookmarks', folder: path.join(' / ') });
      return;
    }
    for (const c of n.children || []) walk(c, n.title ? [...path, n.title] : path);
  };
  walk(tree[0], []);
  return { res: addItems(out), found: out.length };
}

// ---------- tab helpers ----------
function waitForComplete(tabId, ms = 30000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); reject(new Error('YouTube took too long to load.')); }, ms);
    const on = (id, info) => {
      if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    };
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then((tab) => { if (tab.status === 'complete') on(tabId, { status: 'complete' }); }).catch(() => {});
  });
}

async function backToStash(me) {
  if (!me) return;
  try {
    await chrome.windows.update(me.windowId, { focused: true });
    await chrome.tabs.update(me.id, { active: true });
  } catch { /* stash tab may be gone */ }
}

/** Run a scraper in a YouTube tab that is visible (YouTube only lazy-loads in a visible tab). */
async function runInTab({ url, existing }, func) {
  const me = await chrome.tabs.getCurrent();
  let tab = existing, opened = false;
  if (!tab) { tab = await chrome.tabs.create({ url, active: true }); opened = true; }
  else {
    await chrome.windows.update(tab.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
  }
  try {
    await waitForComplete(tab.id);
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args: [YT] });
    return r?.result;
  } finally {
    if (opened) { try { await chrome.tabs.remove(tab.id); } catch { /* already closed */ } }
    await backToStash(me);
  }
}

// ---------- YouTube saved playlists (one item each) ----------
export async function importPlaylists() {
  let r;
  try { r = await runInTab({ url: YT.playlistsFeedUrl }, scrapePlaylistsFeed); }
  catch (e) { throw new Error(e.message.includes('Cannot access') ? 'Stash could not access the YouTube tab. Check the extension still has permission for youtube.com.' : e.message); }
  if (!r?.ok) throw new Error(ytError(r, 'saved playlists'));
  const out = r.items.map((p) => ({
    type: 'playlist',
    title: p.title || 'Playlist ' + p.id,
    url: 'https://www.youtube.com/playlist?list=' + encodeURIComponent(p.id),
    source: 'YouTube playlists', folder: '',
    channel: p.channel || '',
    count: Number.isFinite(p.count) ? p.count : undefined,
  }));
  return { res: addItems(out), found: out.length };
}

// ---------- Watch Later (or any open playlist tab) as individual videos ----------
export async function importWatchLater() {
  const tabs = await chrome.tabs.query({ url: YT.playlistTabPattern });
  const pick = tabs.find((t) => /[?&]list=WL\b/.test(t.url || '')) || tabs.find((t) => t.active) || tabs[0] || null;
  let r;
  try { r = await runInTab({ url: YT.watchLaterUrl, existing: pick }, scrapePlaylistVideos); }
  catch (e) { throw new Error(e.message); }
  if (!r?.ok) throw new Error(ytError(r, 'videos'));
  const label = r.title || 'Watch later';
  const out = r.items.map((v) => ({
    type: 'video', title: v.title, url: 'https://www.youtube.com/watch?v=' + v.id,
    source: label, folder: label, channel: v.channel || '',
  }));
  return { res: addItems(out), found: out.length, label };
}

// ---------- Local PDFs ----------
const SKIP_DIR = /^(node_modules|\$recycle\.bin|system volume information|\.git|appdata|library)$/i;
export const filesSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

async function walkDir(dir, rel, out, depth) {
  if (out.length >= 10000 || depth > 6) return;
  for await (const [name, h] of dir.entries()) {
    if (name.startsWith('.')) continue;
    if (h.kind === 'directory') { if (!SKIP_DIR.test(name)) await walkDir(h, rel + name + '/', out, depth + 1); continue; }
    const ext = (name.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
    if (ext === 'pdf') out.push({ name, rel, type: 'pdf' });
  }
}

// Folder handles are kept in IndexedDB so files can be opened again after a restart.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('stash-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('roots');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbPut(key, val) {
  const db = await idb();
  await new Promise((res, rej) => { const tx = db.transaction('roots', 'readwrite'); tx.objectStore('roots').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('roots').objectStore('roots').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}

const prettyName = (n) => n.replace(/\.\w+$/, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Ask for a folder, scan it for PDFs (names only). */
export async function importFolder(onStatus = () => {}) {
  if (!filesSupported()) throw new Error("This browser can't pick folders. Use a recent Chrome or Edge.");
  let root;
  try { root = await window.showDirectoryPicker({ mode: 'read', id: 'stash-files' }); }
  catch (e) {
    if (e.name === 'AbortError') return null;
    throw new Error(`Chrome refused that folder (${e.message}). Pick a subfolder instead of a top-level one like Documents or Downloads.`);
  }
  onStatus('Scanning ' + root.name + ' …');
  const found = [];
  await walkDir(root, '', found, 0);
  try { await idbPut(root.name, root); } catch { /* opening later will ask to re-scan */ }
  const out = found.map((f) => ({
    type: f.type, title: prettyName(f.name),
    url: 'file:' + root.name + '/' + f.rel + f.name,
    source: 'PDFs',
    folder: (root.name + '/' + f.rel).replace(/\/$/, ''),
  }));
  return { res: addItems(out), found: out.length, root: root.name };
}

/** Open a scanned file (needs a click, since Chrome may ask for permission again). */
export async function openFile(item) {
  const path = item.url.replace(/^file:/, '');
  const [rootName, ...parts] = path.split('/');
  const root = await idbGet(rootName).catch(() => null);
  if (!root) throw new Error(`Stash no longer has access to "${rootName}". Use Import → PDFs and pick that folder again.`);
  if ((await root.queryPermission({ mode: 'read' })) !== 'granted' && (await root.requestPermission({ mode: 'read' })) !== 'granted') {
    throw new Error('Permission to read that folder was not given.');
  }
  let file;
  try {
    let dir = root;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    file = await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  } catch {
    throw new Error('That file was moved, renamed or deleted. Import the folder again to refresh the list.');
  }
  window.open(URL.createObjectURL(file), '_blank');
}
