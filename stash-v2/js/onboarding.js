// onboarding.js — first-run setup (AI copy/paste with up to 3 replies, or starter packs),
// plus the "AI sort leftovers" dialog. One compact window in the middle of the screen;
// the merge preview opens in a dialog.
import { S, applyTopics, restoreSnapshot, getLocal, setLocal, topics, topicById, applyAssignments } from './data.js';
import { topicPrompt, fixPrompt, parseTopicsReply, planMerge, buildTopics, leftoverPrompt, parseAssignments } from './ai.js';
import { PACKS } from './packs.js';
import { esc, IMP_LABEL, debounce, uid, plural, nameKey } from './util.js';
import { $, $$, say, copyText, panelDialog, undoBar, impToggle, nextImp } from './ui.js';
import { runImport } from './list.js';

let root = null;
const st = {
  about: '', replies: ['', '', ''], main: 0, tab: 0, parsed: [null, null, null], errors: ['', '', ''],
  plan: null, built: null, snap: null, packImp: PACKS.map((p) => p.importance),
};

const saveDraft = debounce(() => setLocal('setupDraft', { about: st.about, replies: st.replies, main: st.main }).catch(() => {}), 500);

export async function render(el) {
  root = el;
  const d = await getLocal('setupDraft').catch(() => null);
  if (d && typeof d === 'object') {
    st.about = typeof d.about === 'string' ? d.about : '';
    st.replies = Array.isArray(d.replies) ? d.replies.slice(0, 3).map((r) => (typeof r === 'string' ? r : '')) : ['', '', ''];
    while (st.replies.length < 3) st.replies.push('');
    st.main = [0, 1, 2].includes(d.main) ? d.main : 0;
  }
  st.snap = null;
  el.innerHTML = `
  <div class="setup">
    <div id="remoteNote" class="note" hidden role="status">
      <span>Your settings just arrived from another computer on this Chrome profile.</span>
      <a class="b primary" href="#library">Use them</a>
    </div>
    <section class="win" aria-labelledby="setup-h">
      <div class="tb"><h2 id="setup-h">Setup // your topics</h2><button type="button" class="linkish" id="skip">skip AI → starter topics</button></div>
      <div class="wb" id="aiFlow">
        <div class="hello"><span class="hello-gif"><img src="assets/img/hello.gif" alt="Hello!" width="230" height="230"></span>
          <p class="lead">Stash sorts what you save into topics that fit you. Copy a prompt into any AI chat, paste the reply back. No account or API key.
          ${S.profile.setupDone ? '<br><span class="hint">You already have topics. Same-name topics keep their items and learned words; you can Undo.</span>' : ''}</p>
        </div>

        <div class="sstep"><span class="num" aria-hidden="true">1</span><div>
          <label class="lbl" for="about">About you <span class="hint">(optional, 2-3 lines: interests, studies, work)</span></label>
          <div class="about-row">
            <textarea id="about" rows="3" maxlength="1500" placeholder="e.g. Nursing student who likes hiking, Korean dramas and budget travel."></textarea>
            <div class="btns"><button type="button" class="b primary" id="copyPrompt">Copy prompt</button>
              <button type="button" class="b" id="togglePrompt" aria-expanded="false" aria-controls="prompt">Show</button></div>
          </div>
          <textarea id="prompt" readonly rows="8" hidden aria-label="Prompt to paste into an AI"></textarea>
        </div></div>

        <div class="sstep"><span class="num" aria-hidden="true">2</span><div>
          <div class="lbl">Paste the replies <span class="hint">(up to 3 AIs; more AIs = more keywords)</span></div>
          <div class="tabs" role="tablist" aria-label="AI replies">
            ${[0, 1, 2].map((i) => `<button type="button" role="tab" id="tab${i}" aria-controls="panel${i}" aria-selected="false" tabindex="-1" data-tab="${i}">AI ${i + 1}<span class="main-tag" data-maintag="${i}" hidden>MAIN</span><span class="dot" data-dot="${i}" aria-hidden="true"></span></button>`).join('')}
          </div>
          ${[0, 1, 2].map((i) => `<div role="tabpanel" id="panel${i}" aria-labelledby="tab${i}" hidden>
            <textarea data-reply="${i}" rows="6" spellcheck="false" aria-label="Reply from AI ${i + 1}" placeholder="Paste AI ${i + 1}'s whole reply. Extra chat text and code fences are fine."></textarea>
            <div class="panel-foot">
              <label class="main-pick" title="MAIN decides topic names, groups, importance and links. Others only add keywords and suggestions."><input type="radio" name="main" value="${i}"> Use as MAIN</label>
              <div class="status" data-status="${i}" aria-live="polite"></div>
            </div>
            <div class="fixbox" data-fixbox="${i}" hidden></div>
          </div>`).join('')}
        </div></div>

        <div class="sstep"><span class="num" aria-hidden="true">3</span><div class="setup-foot" style="border:0;padding:0">
          <span class="hint">MAIN sets names and importance; the others only add keywords and suggestions.</span>
          <button type="button" class="b primary" id="preview" disabled>Preview &amp; apply</button>
        </div></div>
      </div>

      <div class="wb" id="packs" hidden>
        <p class="lead">Tick the topics you want. Click the importance button to cycle High → Low → Mid. You can rename, add or delete topics later in Settings.</p>
        <div class="packs">${PACKS.map((p, i) => `
          <div class="pack" title="${esc(p.keywords.slice(0, 8).join(', '))}…">
            <label><input type="checkbox" data-pack="${i}" checked> ${esc(p.name)}</label>
            <span data-packimp="${i}">${impToggle(st.packImp[i], true, 'Importance of ' + p.name)}</span>
          </div>`).join('')}
        </div>
        <div class="setup-foot"><button type="button" class="b" id="backAi">← Back to AI setup</button><button type="button" class="b primary" id="usePacks">Use selected topics</button></div>
      </div>

      <div class="wb done" id="done" hidden aria-live="polite"></div>
    </section>
  </div>`;

  const about = $('#about', el);
  about.value = st.about;
  $('#prompt', el).value = topicPrompt(st.about);
  $$('[data-reply]', el).forEach((ta) => { ta.value = st.replies[+ta.dataset.reply]; });
  $(`input[name="main"][value="${st.main}"]`, el).checked = true;
  [0, 1, 2].forEach(parseOne);
  selectTab(st.main, false);

  about.addEventListener('input', () => { st.about = about.value; $('#prompt', el).value = topicPrompt(st.about); saveDraft(); });
  el.addEventListener('input', (e) => {
    const ta = e.target.closest('[data-reply]');
    if (!ta) return;
    const i = +ta.dataset.reply;
    st.replies[i] = ta.value;
    saveDraft();
    parseLater(i);
  });
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  $('.tabs', el).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    selectTab((st.tab + (e.key === 'ArrowRight' ? 1 : 2)) % 3, true);
  });
  if (location.hash === '#setup/packs') showPacks(true);
}

export function update(kind) {
  if (kind === 'remote-profile' && root && S.profile.setupDone && !st.snap) $('#remoteNote', root).hidden = false;
}
export function dispose() { root = null; }

/** Re-render into a fresh element so old listeners are dropped. */
function rerender() {
  const fresh = root.cloneNode(false);
  root.replaceWith(fresh);
  render(fresh);
}

// ---------- replies ----------
const parseTimers = [0, 0, 0];
function parseLater(i) { clearTimeout(parseTimers[i]); parseTimers[i] = setTimeout(() => parseOne(i), 250); }

function parseOne(i) {
  if (!root) return;
  const text = st.replies[i];
  const box = $(`[data-status="${i}"]`, root);
  const fixbox = $(`[data-fixbox="${i}"]`, root);
  const dot = $(`[data-dot="${i}"]`, root);
  fixbox.hidden = true;
  st.errors[i] = '';
  if (!text.trim()) {
    st.parsed[i] = null;
    box.innerHTML = `<span class="hint">${i === st.main ? 'Paste the MAIN reply here.' : 'Optional.'}</span>`;
    dot.className = 'dot';
  } else {
    const r = parseTopicsReply(text);
    if (r.error) {
      st.parsed[i] = null;
      st.errors[i] = r.error;
      box.innerHTML = '<p class="err">✗ Can\'t read this reply.</p>';
      fixbox.hidden = false;
      fixbox.innerHTML = `<p class="err" style="font-weight:400">${esc(r.error)}</p>
        <div class="row" style="margin:4px 0"><button type="button" class="b sm" data-fix="${i}">Copy fix prompt</button><span class="hint">Send it to the same AI, then paste the new reply.</span></div>`;
      dot.className = 'dot bad';
    } else {
      st.parsed[i] = r;
      const kw = r.topics.reduce((n, t) => n + t.keywords.length, 0);
      box.innerHTML = `<p class="good">✓ ${plural(r.topics.length, 'topic')}, ${plural(kw, 'keyword')}</p>` +
        (r.warnings.length ? `<details><summary>${plural(r.warnings.length, 'note')}</summary><ul class="warn">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : '');
      dot.className = 'dot good';
    }
  }
  $$('[data-maintag]', root).forEach((m) => { m.hidden = +m.dataset.maintag !== st.main; });
  $('#preview', root).disabled = !st.parsed[st.main];
}

function selectTab(i, focus) {
  st.tab = i;
  $$('[role="tab"]', root).forEach((b) => {
    const on = +b.dataset.tab === i;
    b.setAttribute('aria-selected', on);
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $$('[role="tabpanel"]', root).forEach((p, j) => { p.hidden = j !== i; });
}

// ---------- preview (dialog) ----------
function previewHTML() {
  const p = st.plan;
  st.built = buildTopics(p);
  const byId = new Map(st.built.map((t) => [t.id, t]));
  const near = p.near.length ? `<h4>Confirm near matches</h4><ul class="choices">${p.near.map((n, i) => `
    <li><span>AI ${n.ai + 1}: <b>${esc(n.name)}</b> ≈ MAIN: <b>${esc(n.target)}</b></span>
      <select data-near="${i}" aria-label="What to do with ${esc(n.name)}">
        <option value="merge" ${n.choice === 'merge' ? 'selected' : ''}>Add its keywords to ${esc(n.target)}</option>
        <option value="new" ${n.choice === 'new' ? 'selected' : ''}>Keep as a separate topic</option>
        <option value="ignore" ${n.choice === 'ignore' ? 'selected' : ''}>Ignore it</option>
      </select></li>`).join('')}</ul>` : '';
  const sugg = p.suggest.length ? `<h4>Suggested by the other AIs</h4><ul class="choices">${p.suggest.map((s, i) => `
    <li><span><b>${esc(s.topic.name)}</b> <span class="hint">${IMP_LABEL[s.topic.importance]} · ${plural(s.topic.keywords.length, 'keyword')} · AI ${s.from.map((a) => a + 1).join(' & ')}</span></span>
      <span class="seg" role="group" aria-label="${esc(s.topic.name)}">
        <button type="button" class="b sm ${s.accept ? 'on' : ''}" aria-pressed="${s.accept}" data-sugg="${i}" data-v="1">Accept</button>
        <button type="button" class="b sm ${!s.accept ? 'on' : ''}" aria-pressed="${!s.accept}" data-sugg="${i}" data-v="0">Ignore</button>
      </span></li>`).join('')}</ul>` : '';
  const rows = st.built.map((t) => `<tr>
      <th scope="row">${esc(t.name)}${t._suggested ? ' <span class="tag">suggested</span>' : ''}</th>
      <td>${esc(t.group || '—')}</td><td><span class="pill i${t.importance}">${IMP_LABEL[t.importance]}</span></td>
      <td>${t.keywords.length}${t._added ? ` <span class="hint">+${t._added}</span>` : ''}</td>
      <td>${esc(t.related.map((r) => byId.get(r)?.name).filter(Boolean).join(', ') || '—')}</td></tr>`).join('');
  return `${near}${sugg}
    <h4>${plural(st.built.length, 'topic')}</h4>
    <div class="tablewrap"><table class="tbl"><thead><tr><th scope="col">Topic</th><th scope="col">Group</th><th scope="col">Importance</th><th scope="col">Keywords</th><th scope="col">Related</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${S.items.length ? `<p class="hint">Your ${plural(S.items.length, 'item')} will be re-sorted. Items you placed by hand stay put.</p>` : ''}`;
}

function openPreview() {
  st.plan = planMerge(st.parsed, st.main);
  panelDialog(`<h2>Preview</h2><div id="pv"></div>
    <div class="row end"><button type="button" class="b" id="pv-cancel">Back</button><button type="button" class="b primary" id="pv-apply"></button></div>`,
  (d, done) => {
    const draw = () => {
      d.querySelector('#pv').innerHTML = previewHTML();
      d.querySelector('#pv-apply').textContent = `Apply ${plural(st.built.length, 'topic')}`;
    };
    draw();
    d.addEventListener('change', (e) => {
      const n = e.target.closest('[data-near]');
      if (n) { st.plan.near[+n.dataset.near].choice = n.value; draw(); }
    });
    d.addEventListener('click', (e) => {
      const sg = e.target.closest('[data-sugg]');
      if (sg) { st.plan.suggest[+sg.dataset.sugg].accept = sg.dataset.v === '1'; draw(); return; }
      if (e.target.closest('#pv-cancel')) return done(null);
      if (e.target.closest('#pv-apply')) { done(true); apply(st.built); }
    });
    setTimeout(() => d.querySelector('#pv-apply').focus());
  }, 'wide');
}

function apply(list) {
  const clean = list.map(({ _added, _suggested, ...t }) => t);
  st.snap = applyTopics(clean);
  setLocal('setupUndo', st.snap).catch(() => {});
  setLocal('setupDraft', null).catch(() => {});
  $('#aiFlow', root).hidden = true;
  $('#packs', root).hidden = true;
  $('#skip', root).hidden = true;
  const done = $('#done', root);
  done.hidden = false;
  done.innerHTML = `<h3>✓ ${plural(clean.length, 'topic')} applied</h3>
    <p>${S.items.length ? `Your ${plural(S.items.length, 'item')} were re-sorted. ` : ''}Now bring in your stuff:</p>
    <div class="row">
      <button type="button" class="b" data-run="bookmarks">+ Chrome bookmarks</button>
      <button type="button" class="b" data-run="playlists">+ YouTube playlists</button>
      <button type="button" class="b" data-run="watchlater">+ Watch Later</button>
    </div>
    <p class="hint">"AI sort leftovers" in the library sorts anything the keywords miss. Re-run this setup any time from Settings.</p>
    <div class="setup-foot"><button type="button" class="b" id="undoSetup">Undo setup</button><a class="b primary" href="#library">Go to my library →</a></div>`;
  say('Topics applied.', 'ok');
}

function showPacks(on) {
  $('#aiFlow', root).hidden = on;
  $('#packs', root).hidden = !on;
  $('#done', root).hidden = true;
  $('#skip', root).hidden = on;
  if (on) $('#packs input', root)?.focus();
}

function usePacks() {
  const chosen = PACKS.map((p, i) => ({ p, i })).filter(({ i }) => $(`[data-pack="${i}"]`, root).checked);
  if (!chosen.length) return say('Tick at least one starter topic.', 'error');
  const list = chosen.map(({ p, i }) => ({ id: uid(), name: p.name, group: p.group, importance: st.packImp[i], keywords: p.keywords.map((w) => ({ w, weight: 1 })), relNames: p.related }));
  const byName = new Map(list.map((t) => [nameKey(t.name), t.id]));
  for (const t of list) { t.related = t.relNames.map((n) => byName.get(nameKey(n))).filter(Boolean); delete t.relNames; }
  apply(list);
}

function onChange(e) {
  const r = e.target.closest('input[name="main"]');
  if (r) { st.main = +r.value; saveDraft(); [0, 1, 2].forEach(parseOne); }
}

function onClick(e) {
  const t = e.target;
  const tab = t.closest('[role="tab"]');
  if (tab) return selectTab(+tab.dataset.tab, true);
  if (t.closest('#copyPrompt')) return copyText($('#prompt', root).value, t.closest('button'));
  if (t.closest('#togglePrompt')) {
    const p = $('#prompt', root), b = t.closest('button');
    p.hidden = !p.hidden;
    b.setAttribute('aria-expanded', !p.hidden);
    b.textContent = p.hidden ? 'Show' : 'Hide';
    return;
  }
  const fix = t.closest('[data-fix]');
  if (fix) return copyText(fixPrompt(st.errors[+fix.dataset.fix] || 'invalid JSON'), fix);
  if (t.closest('#preview')) return openPreview();
  const pi = t.closest('[data-packimp]');
  if (pi && t.closest('[data-cycle]')) {
    const i = +pi.dataset.packimp;
    st.packImp[i] = nextImp(st.packImp[i]);
    pi.innerHTML = impToggle(st.packImp[i], true, 'Importance of ' + PACKS[i].name);
    pi.querySelector('button').focus();
    return;
  }
  if (t.closest('#skip')) return showPacks(true);
  if (t.closest('#backAi')) return showPacks(false);
  if (t.closest('#usePacks')) return usePacks();
  const run = t.closest('[data-run]');
  if (run) return runImport(run.dataset.run);
  if (t.closest('#undoSetup')) {
    if (!st.snap) return;
    restoreSnapshot(st.snap);
    st.snap = null;
    setLocal('setupUndo', null).catch(() => {});
    say('Setup undone. Your previous topics are back.', 'ok');
    rerender();
  }
}

// ---------- AI sort leftovers ----------
export async function openLeftovers() {
  if (!topics().length) return say('Set up some topics first (Settings → Re-run setup).', 'error');
  const unc = S.items.filter((i) => !i.topicId);
  if (!unc.length) return say('Nothing is uncategorized right now.', 'ok');
  let saved = await getLocal('leftoverPrompt').catch(() => null);
  const stillUseful = saved && saved.map && Object.values(saved.map).some((id) => unc.some((u) => u.id === id));
  if (!stillUseful) saved = await fresh(unc);

  async function fresh(list) {
    const lp = leftoverPrompt(list, topics());
    const v = { prompt: lp.prompt, map: lp.map, count: lp.count, at: Date.now() };
    await setLocal('leftoverPrompt', v);
    return v;
  }

  await panelDialog(`
    <h2>AI sort leftovers</h2>
    <p id="lo-info"></p>
    <div class="row"><button type="button" class="b primary" id="lo-copy">Copy prompt</button><button type="button" class="b" id="lo-new" title="Make a new prompt from the current uncategorized items">New prompt</button></div>
    <label class="fld" for="lo-reply">Paste the AI's reply</label>
    <textarea id="lo-reply" rows="8" spellcheck="false"></textarea>
    <div id="lo-status" aria-live="polite"></div>
    <div class="row end"><button type="button" class="b" id="lo-close">Close</button><button type="button" class="b primary" id="lo-apply" disabled>Apply</button></div>`,
  (d, done) => {
    let parsed = null;
    const info = () => {
      d.querySelector('#lo-info').textContent = `The prompt lists ${plural(saved.count, 'uncategorized item')}${unc.length > saved.count ? ` (of ${unc.length}; the rest go in the next round)` : ''} and your ${plural(topics().length, 'topic')}. Paste it into any AI chat, then paste the reply below. Made ${new Date(saved.at).toLocaleString()}.`;
    };
    info();
    const status = d.querySelector('#lo-status');
    const check = () => {
      const text = d.querySelector('#lo-reply').value;
      parsed = null;
      d.querySelector('#lo-apply').disabled = true;
      if (!text.trim()) { status.innerHTML = ''; return; }
      const r = parseAssignments(text, saved.map, topics());
      if (r.error) {
        status.innerHTML = `<p class="err">${esc(r.error)}</p><button type="button" class="b" id="lo-fix">Copy fix prompt</button>`;
        status.querySelector('#lo-fix').onclick = (ev) => copyText(fixPrompt(r.error, 'assign'), ev.currentTarget);
        return;
      }
      parsed = r;
      status.innerHTML = `<p class="good">Ready: ${plural(r.list.length, 'item')} will be placed.</p>${r.notes.length ? `<ul class="warn">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}`;
      d.querySelector('#lo-apply').disabled = !r.list.length;
    };
    d.querySelector('#lo-reply').addEventListener('input', debounce(check, 200));
    d.querySelector('#lo-copy').onclick = (ev) => copyText(saved.prompt, ev.currentTarget);
    d.querySelector('#lo-new').onclick = async () => { saved = await fresh(S.items.filter((i) => !i.topicId)); info(); check(); };
    d.querySelector('#lo-close').onclick = () => done(null);
    d.querySelector('#lo-apply').onclick = () => {
      if (!parsed) return;
      // An AI importance equal to the topic's own stays "inherit", so topic changes still flow through.
      const list = parsed.list.map((a) => ({ ...a, importance: a.importance === topicById(a.topicId)?.importance ? null : a.importance }));
      const snap = applyAssignments(list);
      setLocal('leftoverPrompt', null).catch(() => {});
      done(true);
      undoBar(`Sorted ${plural(list.length, 'item')} into topics.`, () => { restoreSnapshot(snap); say('AI sorting undone.'); });
    };
  }, 'wide');
}
