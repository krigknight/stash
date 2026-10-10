// youtube.js — every YouTube selector lives in the YT config below.
// If YouTube changes its markup, this object is the only place to fix.
// The scraper functions are injected into YouTube tabs with chrome.scripting.executeScript, so each
// one must be self-contained (no imports, no outside variables); the config is passed in as an argument.

export const YT = {
  playlistsFeedUrl: 'https://www.youtube.com/feed/playlists',
  watchLaterUrl: 'https://www.youtube.com/playlist?list=WL',
  playlistTabPattern: 'https://www.youtube.com/playlist*',

  // Saved-playlists page (feed/playlists)
  playlistLink: 'a[href*="list="]',
  itemContainers: 'ytd-rich-item-renderer, yt-lockup-view-model, ytd-grid-playlist-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer, ytd-grid-show-renderer',
  itemTitle: '.yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, h3 a, h3 span[title], #video-title, a#video-title, yt-formatted-string#video-title, h3',
  itemChannel: 'a[href^="/@"], a[href*="/channel/"], a[href*="/c/"], a[href*="/user/"], ytd-channel-name a',
  skipLists: ['WL', 'LL', 'LM'],            // Watch Later, Liked videos, Liked music
  skipListPrefixes: ['RD'],                // auto-generated mixes

  // A playlist page (Watch Later or any playlist)
  videoRow: 'ytd-playlist-video-renderer',
  videoRowTitle: 'a#video-title, #video-title',
  videoRowChannel: 'ytd-channel-name a, #channel-name a, #byline a',
  anyVideoLink: 'a[href*="/watch?v="]',
  unavailableTitle: '^\\[(private|deleted|unavailable) video\\]$',

  // The current page (toolbar popup)
  watchChannel: 'ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a, ytd-video-owner-renderer #channel-name a, #upload-info #channel-name a',
  playlistHeaderTitle: 'yt-page-header-view-model h1, ytd-playlist-header-renderer .yt-dynamic-sizing-formatted-string, ytd-playlist-header-renderer #title, h1',
  playlistHeaderChannel: 'yt-page-header-view-model a[href^="/@"], ytd-playlist-header-renderer .metadata-owner a, ytd-playlist-header-renderer #owner-text a, ytd-playlist-byline-renderer a',
  playlistHeader: 'yt-page-header-view-model, ytd-playlist-header-renderer',

  signInHint: 'a[href*="ServiceLogin"], ytd-button-renderer a[href*="accounts.google.com"]',
  countRe: '(\\d[\\d,.\\s]*)\\s*(videos?|lessons?|episodes?)',

  maxScrolls: 150,
  scrollWaitMs: 900,
  stableRounds: 3,
};

/** Injected: scroll feed/playlists to the end and read every saved playlist. */
export async function scrapePlaylistsFeed(cfg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  try {
    for (let i = 0; i < 24 && !document.querySelector(cfg.playlistLink); i++) await sleep(500);
    if (!document.querySelector(cfg.playlistLink)) {
      if (document.querySelector(cfg.signInHint)) return { ok: false, error: 'signin' };
      return { ok: false, error: 'markup' };
    }
    let last = -1, stable = 0;
    for (let i = 0; i < cfg.maxScrolls; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(cfg.scrollWaitMs);
      const n = document.querySelectorAll(cfg.playlistLink).length;
      if (n === last) { if (++stable >= cfg.stableRounds) break; } else stable = 0;
      last = n;
    }
    window.scrollTo(0, 0);
    const countRe = new RegExp(cfg.countRe, 'i');
    const map = new Map();
    for (const a of document.querySelectorAll(cfg.playlistLink)) {
      let id = null;
      try { id = new URL(a.href, location.href).searchParams.get('list'); } catch { /* skip */ }
      if (!id || cfg.skipLists.includes(id) || cfg.skipListPrefixes.some((p) => id.startsWith(p))) continue;
      const box = a.closest(cfg.itemContainers);
      const e = map.get(id) || { id, title: '', channel: '', count: null };
      if (box) {
        if (!e.title) { const t = box.querySelector(cfg.itemTitle); if (t) e.title = clean(t.getAttribute('title') || t.textContent); }
        if (!e.channel) { const c = box.querySelector(cfg.itemChannel); if (c) e.channel = clean(c.textContent); }
        if (e.count == null) { const m = clean(box.textContent).match(countRe); if (m) e.count = parseInt(m[1].replace(/[,.\s]/g, ''), 10); }
      }
      if (!e.title) {
        const t = clean(a.getAttribute('title') || a.textContent);
        if (t && t.length < 200 && !/^(view full playlist|play all|\d+)$/i.test(t)) e.title = t;
      }
      map.set(id, e);
    }
    return { ok: true, items: [...map.values()] };
  } catch (err) {
    return { ok: false, error: 'exception', message: String(err && err.message || err) };
  }
}

/** Injected: scroll a playlist page (e.g. Watch Later) to the end and read every video. */
export async function scrapePlaylistVideos(cfg) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  try {
    for (let i = 0; i < 24 && !document.querySelector(cfg.anyVideoLink); i++) await sleep(500);
    if (!document.querySelector(cfg.anyVideoLink)) {
      if (document.querySelector(cfg.signInHint)) return { ok: false, error: 'signin' };
      return { ok: false, error: 'empty' };
    }
    let last = -1, stable = 0;
    for (let i = 0; i < cfg.maxScrolls; i++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(cfg.scrollWaitMs);
      const n = document.querySelectorAll(cfg.anyVideoLink).length;
      if (n === last) { if (++stable >= cfg.stableRounds) break; } else stable = 0;
      last = n;
    }
    window.scrollTo(0, 0);
    const unavailable = new RegExp(cfg.unavailableTitle, 'i');
    const vid = (href) => { try { return new URL(href, location.href).searchParams.get('v'); } catch { return null; } };
    const out = new Map();
    const rows = document.querySelectorAll(cfg.videoRow);
    if (rows.length) {
      for (const r of rows) {
        const a = r.querySelector(cfg.videoRowTitle);
        const id = a && vid(a.href);
        const title = a && clean(a.getAttribute('title') || a.textContent);
        if (!id || !title || unavailable.test(title)) continue;
        const ch = r.querySelector(cfg.videoRowChannel);
        out.set(id, { id, title, channel: ch ? clean(ch.textContent) : '' });
      }
    } else {
      // Fallback (v1 behavior): any watch link, keep the longest title per video.
      for (const a of document.querySelectorAll(cfg.anyVideoLink)) {
        const id = vid(a.href);
        const title = clean(a.getAttribute('title') || a.textContent);
        if (!id || !title || unavailable.test(title)) continue;
        if (title.length > (out.get(id)?.title.length || 0)) out.set(id, { id, title, channel: '' });
      }
    }
    const listTitle = clean(document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '')) || 'YouTube';
    return { ok: true, title: listTitle, items: [...out.values()] };
  } catch (err) {
    return { ok: false, error: 'exception', message: String(err && err.message || err) };
  }
}

/** Injected (popup): channel of the current video, or title/channel/count of the current playlist. */
export function scrapeCurrentPage(cfg) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  try {
    if (location.pathname === '/playlist') {
      const h = document.querySelector(cfg.playlistHeader);
      const t = document.querySelector(cfg.playlistHeaderTitle);
      const c = document.querySelector(cfg.playlistHeaderChannel);
      const m = h ? clean(h.textContent).match(new RegExp(cfg.countRe, 'i')) : null;
      return { title: t ? clean(t.textContent) : '', channel: c ? clean(c.textContent) : '', count: m ? parseInt(m[1].replace(/[,.\s]/g, ''), 10) : null };
    }
    const c = document.querySelector(cfg.watchChannel);
    return { channel: c ? clean(c.textContent) : '' };
  } catch {
    return {};
  }
}

/** Human-readable message for a scraper failure. */
export function ytError(r, what) {
  if (!r) return `Couldn't read the YouTube page for ${what}. Try again with the tab left open until it finishes.`;
  if (r.error === 'signin') return 'YouTube shows you as signed out. Sign in to YouTube in this browser, then try again.';
  if (r.error === 'empty') return `That YouTube page has no videos to import.`;
  if (r.error === 'markup') return `Couldn't find any ${what} on the page. If you do have some, YouTube may have changed its layout; the selectors are in js/youtube.js (the YT object at the top).`;
  return `Something went wrong reading YouTube: ${r.message || r.error}`;
}
