// ai.js — copy/paste AI helpers. Everything pasted back is untrusted: parsed as JSON only,
// validated against a schema, never evaluated. Rendering code escapes every string.
import { nameKey, norm, uid, IMP } from './util.js';
import { stem, rawTokens } from './categorize.js';

const IMP_IN = { high: 2, mid: 1, medium: 1, med: 1, normal: 1, low: 0 };

export const TOPIC_SCHEMA =
  '{"version":1,"topics":[{"name":"Topic name","group":"Broader group","importance":"high","keywords":["keyword","synonym","abbreviation"],"related":["Another topic name"]}]}';
export const ASSIGN_SCHEMA = '{"assignments":[{"id":"i1","topic":"Topic name","importance":"mid"}]}';

// ---------- prompts ----------
export function topicPrompt(about) {
  const desc = String(about || '').trim().slice(0, 1500);
  return `I'm setting up Stash, a browser extension that sorts my saved bookmarks, YouTube videos and playlists, and PDFs into topics.

Use everything you already know about me (from memory or earlier conversations, if you have any) plus my description below to propose the topics my saved links and files most likely fall into.

About me, in my own words:
"""
${desc || '(no description given)'}
"""
If you know little about me, propose broadly useful topics for someone like the person described.

Rules:
- 8 to 15 topics that together cover my studies, work, interests, hobbies and entertainment, so almost anything I save fits somewhere.
- "name": short, 1 to 4 words.
- "group": a broader area; give related topics the same group so they cluster.
- "importance": exactly "high", "mid" or "low", meaning how much this topic matters to me.
- "keywords": 20 to 40 per topic, lowercase, 1 to 3 words each. They are matched against page titles, file names, folder names, YouTube channel names and URLs, so include synonyms, abbreviations and acronyms, jargon, well-known website and channel names, and transliterated or non-English terms in languages I am likely to use. Skip generic words like "video", "guide", "best", "how to".
- Do not put the same keyword in two topics.
- "related": names of other topics from your own list, written exactly the same way.

Reply with ONLY the JSON object, no explanation, no markdown, no code fences. Schema:
${TOPIC_SCHEMA}`;
}

export function fixPrompt(error, kind = 'topics') {
  return `Your previous reply could not be used. The problem: ${error}

Return only valid JSON matching this schema, with no other text, no markdown and no code fences. Keep the same content.
${kind === 'topics' ? TOPIC_SCHEMA : ASSIGN_SCHEMA}`;
}

// ---------- JSON extraction ----------
/** Pull the first JSON object out of a chat reply (ignores chat text and code fences). */
export function extractJSON(text) {
  const s = String(text || '').replace(/^﻿/, '');
  if (!s.trim()) return { error: 'Nothing pasted yet.' };
  const start = s.indexOf('{');
  if (start < 0) return { error: 'No JSON object found in the reply (no "{" at all).' };
  let depth = 0, inStr = false, escp = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (escp) escp = false;
      else if (c === '\\') escp = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return { error: 'The JSON object never closes (a "}" is missing). The reply may have been cut off.' };
  const raw = s.slice(start, end + 1);
  try {
    return { value: JSON.parse(raw) };
  } catch (e) {
    // Gentle repair: trailing commas are the most common slip.
    const fixed = raw.replace(/,\s*([}\]])/g, '$1');
    if (fixed !== raw) {
      try { return { value: JSON.parse(fixed), warning: 'Removed trailing commas from the JSON.' }; } catch { /* report original error */ }
    }
    let where = '';
    const m = /position (\d+)/.exec(e.message);
    if (m) {
      const p = +m[1];
      where = ` Near: …${raw.slice(Math.max(0, p - 30), p)}⟪here⟫${raw.slice(p, p + 30)}…`;
    }
    return { error: `Invalid JSON: ${e.message}.${where}` };
  }
}

// ---------- topic schema ----------
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');

/** Validate a topics reply. Returns {topics, warnings} or {error}. */
export function validateTopics(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'Expected a JSON object like {"version":1,"topics":[...]}.' };
  if (!Array.isArray(obj.topics)) return { error: 'The JSON has no "topics" list.' };
  const warnings = [];
  if (obj.version !== undefined && obj.version !== 1) warnings.push(`Unknown version ${JSON.stringify(obj.version)}; reading it as version 1.`);
  const out = [];
  const byKey = new Map();
  let fewKw = 0;
  obj.topics.slice(0, 40).forEach((t, i) => {
    if (!t || typeof t !== 'object') { warnings.push(`Topic #${i + 1} is not an object; skipped.`); return; }
    const name = clean(t.name, 60);
    if (!name) { warnings.push(`Topic #${i + 1} has no name; skipped.`); return; }
    let importance = IMP_IN[String(t.importance ?? '').toLowerCase().trim()];
    if (importance === undefined) {
      if (t.importance === 0 || t.importance === 1 || t.importance === 2) importance = t.importance;
      else { importance = 1; warnings.push(`"${name}": importance ${JSON.stringify(t.importance ?? null)} is not high/mid/low; using mid.`); }
    }
    const kws = [];
    const seen = new Set();
    for (const k of Array.isArray(t.keywords) ? t.keywords : []) {
      const w = clean(k, 60).toLowerCase();
      const key = norm(w);
      if (!w || seen.has(key)) continue;
      seen.add(key);
      kws.push(w);
      if (kws.length >= 80) break;
    }
    if (!Array.isArray(t.keywords)) warnings.push(`"${name}" has no "keywords" list.`);
    const related = (Array.isArray(t.related) ? t.related : []).map((r) => clean(r, 60)).filter(Boolean).slice(0, 20);
    const k = nameKey(name);
    if (byKey.has(k)) {
      const ex = byKey.get(k);
      for (const w of kws) if (!ex.keywords.includes(w)) ex.keywords.push(w);
      warnings.push(`"${name}" appears twice; merged.`);
      return;
    }
    const topic = { name, group: clean(t.group, 40), importance, keywords: kws, related };
    byKey.set(k, topic);
    out.push(topic);
  });
  if (obj.topics.length > 40) warnings.push(`Only the first 40 of ${obj.topics.length} topics were read.`);
  if (!out.length) return { error: 'The "topics" list has no usable topics.' };
  for (const t of out) if (t.keywords.length < 20) fewKw++;
  if (out.length < 8 || out.length > 15) warnings.push(`${out.length} topics (asked for 8-15). That's fine, just noting it.`);
  if (fewKw) warnings.push(`${fewKw} topic${fewKw > 1 ? 's have' : ' has'} fewer than 20 keywords; sorting may be weaker there.`);
  return { topics: out, warnings };
}

export function parseTopicsReply(text) {
  const x = extractJSON(text);
  if (x.error) return { error: x.error };
  const v = validateTopics(x.value);
  if (v.error) return v;
  if (x.warning) v.warnings.unshift(x.warning);
  return v;
}

// ---------- name similarity ----------
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const nameToks = (s) => new Set(rawTokens(nameKey(s)).filter((w) => w !== 'and').map(stem));

/** 0..1 similarity between two topic names. */
export function nameSimilarity(a, b) {
  const ka = nameKey(a), kb = nameKey(b);
  if (ka === kb) return 1;
  const ta = nameToks(a), tb = nameToks(b);
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const jac = inter / (new Set([...ta, ...tb]).size || 1);
  const lv = 1 - lev(ka, kb) / Math.max(ka.length, kb.length, 1);
  const contains = (ka.length >= 4 && kb.includes(ka)) || (kb.length >= 4 && ka.includes(kb)) ? 0.75 : 0;
  return Math.max(jac, lv, contains);
}
export const NEAR = 0.6;

// ---------- merge (MAIN + up to 2 others) ----------
/**
 * Analyze parsed replies. MAIN defines names, groups, importance and related.
 * Others may only add keywords to exactly matching MAIN topics, propose near matches
 * (you confirm) and suggest new topics (you accept or ignore).
 * @param replies array of {topics} or null, index = AI tab
 */
export function planMerge(replies, mainIdx) {
  const main = replies[mainIdx];
  const plan = { main: main.topics, mainIdx, exact: [], near: [], suggest: [] };
  const mainKeys = new Map(main.topics.map((t) => [nameKey(t.name), t]));
  const sugg = new Map();
  replies.forEach((r, ai) => {
    if (!r || ai === mainIdx) return;
    for (const t of r.topics) {
      const exact = mainKeys.get(nameKey(t.name));
      if (exact) { plan.exact.push({ ai, target: exact.name, keywords: t.keywords }); continue; }
      let best = null, bs = 0;
      for (const m of main.topics) { const s = nameSimilarity(t.name, m.name); if (s > bs) { bs = s; best = m; } }
      if (best && bs >= NEAR) { plan.near.push({ ai, name: t.name, target: best.name, score: bs, topic: t, choice: 'merge' }); continue; }
      const k = nameKey(t.name);
      if (sugg.has(k)) {
        const s = sugg.get(k);
        s.from.push(ai);
        for (const w of t.keywords) if (!s.topic.keywords.includes(w)) s.topic.keywords.push(w);
      } else {
        sugg.set(k, { from: [ai], topic: { ...t, keywords: [...t.keywords] }, accept: false });
      }
    }
  });
  plan.suggest = [...sugg.values()];
  return plan;
}

/**
 * Build the final topic list from a plan and the user's choices.
 * near[i].choice: 'merge' | 'new' | 'ignore'; suggest[i].accept: boolean.
 * Keyword conflicts: MAIN's topic keeps a keyword; otherwise the first topic to claim it keeps it.
 */
export function buildTopics(plan) {
  const final = plan.main.map((t) => ({ id: uid(), name: t.name, group: t.group, importance: t.importance, relNames: t.related, kw: [...t.keywords], added: 0 }));
  const byName = new Map(final.map((t) => [nameKey(t.name), t]));
  const owner = new Map();                      // keyword -> Set(final topics) from MAIN
  for (const t of final) for (const w of t.kw) { const k = norm(w); if (!owner.has(k)) owner.set(k, new Set()); owner.get(k).add(t); }
  const claimed = new Map();                    // keyword -> first non-MAIN claimant
  const addKw = (t, words) => {
    const have = new Set(t.kw.map(norm));
    for (const w of words) {
      const k = norm(w);
      if (have.has(k)) continue;
      const o = owner.get(k);
      if (o && !o.has(t)) continue;               // MAIN's topic keeps it
      if (claimed.has(k) && claimed.get(k) !== t) continue;
      claimed.set(k, t);
      t.kw.push(w); have.add(k); t.added++;
    }
  };
  for (const e of plan.exact) addKw(byName.get(nameKey(e.target)), e.keywords);
  const newOnes = [];
  for (const n of plan.near) {
    if (n.choice === 'merge') addKw(byName.get(nameKey(n.target)), n.topic.keywords);
    else if (n.choice === 'new') newOnes.push(n.topic);
  }
  for (const s of plan.suggest) if (s.accept) newOnes.push(s.topic);
  for (const t of newOnes) {
    if (byName.has(nameKey(t.name))) { addKw(byName.get(nameKey(t.name)), t.keywords); continue; }
    const nt = { id: uid(), name: t.name, group: t.group, importance: t.importance, relNames: t.related, kw: [], added: 0, suggested: true };
    final.push(nt);
    byName.set(nameKey(nt.name), nt);
    addKw(nt, t.keywords);
    nt.added = 0;
  }
  return final.map((t) => ({
    id: t.id, name: t.name, group: t.group || '', importance: t.importance,
    related: [...new Set((t.relNames || []).map((r) => byName.get(nameKey(r))?.id).filter((id) => id && id !== t.id))],
    keywords: t.kw.map((w) => ({ w, weight: 1 })),
    _added: t.added, _suggested: !!t.suggested,
  }));
}

// ---------- AI sort leftovers ----------
const line = (s) => String(s || '').replace(/[\r\n|]+/g, ' ').trim().slice(0, 160);

/** Prompt for up to 150 uncategorized items. Returns {prompt, map:{shortId: itemId}, count}. */
export function leftoverPrompt(items, topics) {
  const pick = items.slice(0, 150);
  const map = {};
  const rows = pick.map((it, i) => {
    const sid = 'i' + (i + 1);
    map[sid] = it.id;
    const extra = [it.channel, it.folder].filter(Boolean).join(' / ');
    return `${sid} | ${it.type} | ${line(it.title)}${extra ? ' | ' + line(extra) : ''}`;
  });
  const tl = topics.map((t) => `- ${t.name} [${IMP[t.importance]}]: ${t.keywords.filter((k) => !k.l).slice(0, 8).map((k) => k.w).join(', ')}`);
  const prompt = `Sort my saved items into my existing topics.

Topics (use these names exactly; the words after the colon are example keywords):
${tl.join('\n')}

Items (id | type | title | channel or folder):
${rows.join('\n')}

For each item choose the single best topic from the list above. If none fits, use "Uncategorized". Set "importance" to how much the item likely matters to me: "high", "mid" or "low".
Reply with ONLY this JSON, no other text, no markdown:
${ASSIGN_SCHEMA}`;
  return { prompt, map, count: pick.length };
}

/** Parse the leftover reply. Returns {list:[{itemId, topicId, importance}], notes:[]} or {error}. */
export function parseAssignments(text, map, topics) {
  const x = extractJSON(text);
  if (x.error) return { error: x.error };
  const o = x.value;
  if (!o || !Array.isArray(o.assignments)) return { error: 'The JSON has no "assignments" list.' };
  const byKey = new Map(topics.map((t) => [nameKey(t.name), t]));
  const list = [];
  let badId = 0, badTopic = 0, uncat = 0;
  const unknown = new Set();
  const used = new Set();
  for (const a of o.assignments.slice(0, 1000)) {
    if (!a || typeof a !== 'object') continue;
    const itemId = typeof a.id === 'string' && Object.prototype.hasOwnProperty.call(map, a.id) ? map[a.id] : null;
    if (!itemId || used.has(itemId)) { badId++; continue; }
    const tn = clean(a.topic, 80);
    if (!tn || nameKey(tn) === 'uncategorized') { uncat++; continue; }
    let t = byKey.get(nameKey(tn));
    if (!t) {
      const near = topics.map((x) => [x, nameSimilarity(tn, x.name)]).filter((p) => p[1] >= 0.8).sort((p, q) => q[1] - p[1]);
      t = near[0]?.[0];
    }
    if (!t) { badTopic++; unknown.add(tn); continue; }
    used.add(itemId);
    const imp = IMP_IN[String(a.importance ?? '').toLowerCase().trim()];
    list.push({ itemId, topicId: t.id, importance: imp ?? null });
  }
  const notes = [];
  if (uncat) notes.push(`${uncat} left as Uncategorized by the AI.`);
  if (badTopic) notes.push(`${badTopic} skipped: unknown topic${unknown.size > 1 ? 's' : ''} ${[...unknown].slice(0, 5).map((u) => '"' + u + '"').join(', ')}.`);
  if (badId) notes.push(`${badId} skipped: unknown or repeated item id.`);
  if (!list.length && !uncat) return { error: 'No usable assignments found. ' + notes.join(' ') };
  return { list, notes };
}
