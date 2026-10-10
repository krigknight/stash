// util.js — small shared helpers: escaping, normalizing, ids, hashing, dedupe keys.

/** Escape any value for safe insertion into HTML text or attribute values. */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

/** Only http(s) URLs may become clickable links. Anything else returns ''. */
export function safeHref(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : '';
  } catch { return ''; }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Lowercase + strip Latin diacritics (é → e). Other scripts are kept as they are. */
export const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Normalized topic-name key used for matching names across AIs ("AI & ML" ≈ "ai ml"). */
export const nameKey = (s) => norm(s).replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** 32-bit FNV-1a hash as a short base36 string (for the synced deleted-items list). */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const IMP = ['low', 'mid', 'high'];           // index = importance 0..2
export const IMP_LABEL = ['Low', 'Mid', 'High'];
export const TYPES = ['bookmark', 'video', 'playlist', 'pdf', 'movie'];

const YT_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;

/** Parse a YouTube URL. Returns {video} or {playlist} ids, or null. */
export function ytInfo(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? { video: id } : null;
  }
  if (!YT_HOSTS.test(host)) return null;
  const list = u.searchParams.get('list');
  if (u.pathname === '/playlist' && list) return { playlist: list };
  const v = u.searchParams.get('v');
  if (u.pathname === '/watch' && v && /^[\w-]{11}$/.test(v)) return { video: v };
  const m = u.pathname.match(/^\/(shorts|live|embed)\/([\w-]{11})/);
  if (m) return { video: m[2] };
  return null;
}

/** Item type implied by a URL (bookmarks pointing at YouTube become video/playlist). */
export function typeFromUrl(url) {
  const y = ytInfo(url);
  return y?.video ? 'video' : y?.playlist ? 'playlist' : 'bookmark';
}

/**
 * Dedupe key: YouTube video id, playlist id, URL without hash and trailing slash, or file path.
 */
export function dedupeKey(item) {
  if (item.type === 'pdf' || item.type === 'movie') return 'file:' + norm(item.url.replace(/^file:/, ''));
  const y = ytInfo(item.url);
  if (y?.video) return 'yt:' + y.video;
  if (y?.playlist) return 'ytpl:' + y.playlist;
  let s = String(item.url).replace(/#.*$/, '');
  try {
    const u = new URL(s);
    s = u.protocol + '//' + u.host.toLowerCase() + u.pathname + u.search;
  } catch { /* keep raw */ }
  return 'u:' + s.replace(/\/+$/, '');
}

export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Byte length of a string as UTF-8 (what chrome.storage.sync counts). */
export const bytes = (s) => new TextEncoder().encode(s).length;
