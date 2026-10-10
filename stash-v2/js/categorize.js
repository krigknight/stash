// categorize.js — keyword scoring, light stemming, learning from manual moves, topic relations.
import { norm } from './util.js';

export const THRESHOLD = 1;                    // minimum score to leave "Uncategorized"
export const MULT = { title: 3, folder: 2, url: 1 };
export const LEARN = { start: 0.5, step: 0.25, max: 1, decay: 0.97, drop: 0.15, cap: 60 };

// Stopwords + generic web/video noise. Never learned, never useful as signal.
const STOP = new Set((
  'a an and are as at be but by for from has have how i if in into is it its of on or our so than that the their them then there these ' +
  'they this to was we what when where which who why will with you your my me do does did not no yes can all any more most some such ' +
  'only own same too very just also about after again against before between both each few further here once other out over under up ' +
  'another until while am been being had having he she him her his hers itself myself ours ourselves yourself yourselves themselves those ' +
  'http https www com org net io co html htm php asp aspx index amp utm ref src id page pages home site web watch youtube youtu ' +
  'video videos official full part episode ep new best top free online vs via get got make made one two three first last ' +
  'pdf mp4 mkv avi mov webm m4v wmv flv download downloads file files copy final version ver v1 v2 hd 1080p 720p 4k x264 x265 ' +
  'de la le les el los las un una et des du en y o e da do das dos'
).split(/\s+/));

const GENERIC_FOLDERS = /^(bookmarks( bar)?|other bookmarks|mobile bookmarks|favorites( bar)?|imported|watch later|watch-later|liked videos)$/i;

/** Light English stemming; non-ASCII words are left alone. */
export function stem(w) {
  if (w.length <= 4 || !/^[a-z]+$/.test(w)) return w;
  let s = w, cut = false;
  for (const [suf, rep] of [['ingly', ''], ['edly', ''], ['ings', ''], ['ing', ''], ['ies', 'y'], ['ers', ''], ['er', ''], ['ed', ''], ['es', ''], ['ly', ''], ['s', '']]) {
    if (s.endsWith(suf) && s.length - suf.length >= 3) {
      if (suf === 's' && /(ss|us|is)$/.test(s)) break;   // "class", "virus", "analysis"
      s = s.slice(0, -suf.length) + rep;
      cut = true;
      break;
    }
  }
  if (cut && /([b-df-hj-kmnp-rtv-z])\1$/.test(s) && s.length > 3) s = s.slice(0, -1); // programm -> program
  return s;
}

/** Raw normalized tokens (keeps "c++", "c#"). */
export const rawTokens = (text) => norm(text).match(/[\p{L}\p{N}]+[+#]*/gu) || [];

function prep(text) {
  const toks = rawTokens(text).map(stem);
  return { set: new Set(toks), padded: ' ' + toks.join(' ') + ' ', raw: norm(text) };
}

const NON_SPACE_SCRIPTS = /[぀-ヿ㐀-鿿가-힯฀-๿]/; // CJK, kana, hangul, Thai

/** Compile topics' keywords into fast matchers. */
export function makeMatcher(topics) {
  return topics.map((t) => {
    const seen = new Map();
    for (const k of t.keywords || []) {
      const toks = rawTokens(k.w).map(stem);
      if (!toks.length) continue;
      const kind = toks.length > 1 ? 'phrase' : NON_SPACE_SCRIPTS.test(k.w) ? 'sub' : 'tok';
      const value = kind === 'phrase' ? ' ' + toks.join(' ') + ' ' : kind === 'sub' ? norm(k.w) : toks[0];
      const key = kind + ':' + value;
      const w = Number(k.weight) || 1;
      if (!seen.has(key) || seen.get(key).weight < w) seen.set(key, { kind, value, weight: w });
    }
    return { id: t.id, importance: t.importance ?? 1, order: t.order ?? 0, entries: [...seen.values()] };
  });
}

function fieldsOf(item) {
  let url = '';
  if (item.type === 'bookmark') {
    try {
      const u = new URL(item.url);
      let p = u.pathname;
      try { p = decodeURIComponent(p); } catch { /* keep */ }
      url = u.hostname + ' ' + p.replace(/[/_\-.]+/g, ' ');
    } catch { url = ''; }
  }
  return {
    title: prep(item.title || ''),
    folder: prep([item.folder, item.channel].filter(Boolean).join(' ')),
    url: prep(url),
  };
}

const hit = (e, f) => (e.kind === 'tok' ? f.set.has(e.value) : e.kind === 'phrase' ? f.padded.includes(e.value) : f.raw.includes(e.value));

/** Score an item against every topic. Returns [{id, score, importance, order}] sorted best first. */
export function scoreItem(item, matcher) {
  const f = fieldsOf(item);
  const out = [];
  for (const t of matcher) {
    let s = 0;
    for (const e of t.entries) {
      if (hit(e, f.title)) s += e.weight * MULT.title;
      if (hit(e, f.folder)) s += e.weight * MULT.folder;
      if (hit(e, f.url)) s += e.weight * MULT.url;
    }
    if (s > 0) out.push({ id: t.id, score: s, importance: t.importance, order: t.order });
  }
  // Highest score wins; ties go to higher importance, then topic order.
  out.sort((a, b) => b.score - a.score || b.importance - a.importance || a.order - b.order);
  return out;
}

/** Pick a topic: {topicId|null, alt:[other matching topic ids]} */
export function categorize(item, matcher) {
  const s = scoreItem(item, matcher).filter((x) => x.score >= THRESHOLD);
  return { topicId: s.length ? s[0].id : null, alt: s.slice(1, 4).map((x) => x.id) };
}

/**
 * Learning: after a manual move, add 2-4 informative title tokens to the topic with a small weight.
 * Skips stopwords, numbers, very short tokens, other topics' base keywords, and tokens that
 * show up in item titles across many topics. Existing learned words decay a little each time.
 */
export function learn(topic, titles, topics, items) {
  if (!topic) return [];
  const single = (k) => { const r = rawTokens(k.w); return r.length === 1 ? stem(r[0]) : null; };
  const topicStems = new Set((topic.keywords || []).map(single).filter(Boolean));
  const otherBase = new Set();
  for (const t of topics) if (t.id !== topic.id) for (const k of t.keywords || []) if (!k.l) { const r = rawTokens(k.w); if (r.length === 1) otherBase.add(stem(r[0])); }

  // In how many topics does each stem appear (by item titles)?
  const spread = new Map();
  for (const it of items) {
    if (!it.topicId) continue;
    for (const s of new Set(rawTokens(it.title).map(stem))) {
      let m = spread.get(s); if (!m) spread.set(s, (m = new Set())); m.add(it.topicId);
    }
  }
  const commonLimit = Math.max(3, Math.ceil(topics.length * 0.4));

  const learnedNow = [];
  const kw = topic.keywords || (topic.keywords = []);
  // decay all learned words once per learning event
  for (const k of kw) if (k.l) k.weight = +(k.weight * LEARN.decay).toFixed(3);

  // Gather candidate tokens across the given title(s), counting how many titles contain each.
  const list = [].concat(titles);
  const cands = new Map();
  for (const title of list) {
    for (const raw of new Set(rawTokens(title))) {
      const s = stem(raw);
      const latin = /^[a-z0-9+#]+$/.test(raw);
      if (STOP.has(raw) || STOP.has(s)) continue;
      if (/^\d+$/.test(raw)) continue;
      if (latin ? raw.length < 3 : raw.length < 2) continue;
      if (otherBase.has(s)) continue;
      const sp = spread.get(s)?.size || 0;
      if (sp >= commonLimit) continue;
      const c = cands.get(s);
      if (c) c.n++; else cands.set(s, { raw, s, sp, n: 1 });
    }
  }
  // One title: 2-4 words, fewest topics first, longer words first.
  // Many titles (bulk AI sort): the words shared by most titles, a few more allowed.
  const many = list.length > 1;
  const limit = many ? Math.min(10, 4 + Math.floor(list.length / 5)) : 4;
  const pick = [...cands.values()]
    .filter((c) => !many || c.n >= 2 || list.length < 4)
    .sort((a, b) => (many ? b.n - a.n : 0) || a.sp - b.sp || b.raw.length - a.raw.length)
    .slice(0, limit);
  for (const c of pick) {
    const ex = kw.find((k) => single(k) === c.s);
    if (ex) {
      if (ex.l) ex.weight = Math.min(LEARN.max, +(ex.weight + LEARN.step).toFixed(3));
      continue; // a base keyword already covers it
    }
    if (topicStems.has(c.s)) continue;
    kw.push({ w: c.raw, weight: LEARN.start, l: 1 });
    topicStems.add(c.s);
    learnedNow.push(c.raw);
  }
  // drop faded words, cap learned words per topic
  topic.keywords = kw.filter((k) => !k.l || k.weight >= LEARN.drop);
  const learned = topic.keywords.filter((k) => k.l).sort((a, b) => b.weight - a.weight);
  if (learned.length > LEARN.cap) {
    const drop = new Set(learned.slice(LEARN.cap));
    topic.keywords = topic.keywords.filter((k) => !drop.has(k));
  }
  return learnedNow;
}

/**
 * Topic relations for the graph: declared `related`, items matching 2+ topics,
 * and the same user folder landing in different topics. Returns {"idA|idB": weight}.
 */
export function relations(topics, items) {
  const ids = new Set(topics.map((t) => t.id));
  const w = {};
  const bump = (a, b, v) => {
    if (!a || !b || a === b || !ids.has(a) || !ids.has(b)) return;
    const k = a < b ? a + '|' + b : b + '|' + a;
    w[k] = +((w[k] || 0) + v).toFixed(2);
  };
  for (const t of topics) for (const r of t.related || []) bump(t.id, r, 3);
  const folders = new Map();
  for (const it of items) {
    if (!it.topicId) continue;
    for (const a of it.alt || []) bump(it.topicId, a, 1);
    const f = (it.folder || '').split(' / ').pop().trim();
    if (f && !GENERIC_FOLDERS.test(f) && (it.type === 'bookmark' || it.type === 'pdf' || it.type === 'movie')) {
      const key = it.type[0] + ':' + it.folder;
      let s = folders.get(key); if (!s) folders.set(key, (s = new Set())); s.add(it.topicId);
    }
  }
  for (const s of folders.values()) {
    const a = [...s];
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) bump(a[i], a[j], 0.5);
  }
  return w;
}
