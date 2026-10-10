// settings.js — sync status, theme, topics (rename / importance / delete / add), setup,
// backup export/import, deleted items (restore), clear all.
import {
  S, SYNC_BUDGET, topics, addTopic, renameTopic, setTopicImportance, deleteTopic, exportAll, readBackup, replaceAll,
  restoreItems, clearRemoteDeletes, remoteDeleteCount, clearItems, setPref, getLocal, setLocal, restoreSnapshot,
} from './data.js';
import { esc, plural } from './util.js';
import { $, say, confirmDialog, promptDialog, download, impToggle, nextImp } from './ui.js';
import { openLeftovers } from './onboarding.js';
import { STYLES, PALETTES } from './themes.js';

let root = null;
const DEL_SHOWN = 300;

export function render(el) {
  root = el;
  el.innerHTML = `<div class="settings">
    <h2 class="sr">Settings</h2>
    <section class="win" aria-labelledby="h-sync"><div class="tb"><h3 id="h-sync">Sync</h3></div><div class="wb"><div id="syncBox"></div></div></section>
    <section class="win" aria-labelledby="h-look"><div class="tb"><h3 id="h-look">Appearance</h3></div><div class="wb">
      <div class="look">
        <div class="look-ctl">
          <fieldset class="opt-group"><legend>Style</legend>
            ${STYLES.map((s) => `<label class="opt"><input type="radio" name="style" value="${s.id}"><span class="opt-name" style="font-family:${esc(s.font)}">${esc(s.name)}</span><span class="opt-desc">${esc(s.desc)}</span></label>`).join('')}
          </fieldset>
          <fieldset class="opt-group"><legend>Palette</legend>
            ${PALETTES.map((p) => `<label class="opt pal"><input type="radio" name="palette" value="${p.id}">
              <span class="sw" aria-hidden="true">${[...p.light, ...p.dark].map((c, i) => `<i style="background:${c}"${i === 3 ? ' class="sw-d"' : ''}></i>`).join('')}</span>
              <span class="opt-name">${esc(p.name)}</span></label>`).join('')}
            <p class="hint">Each palette has a light and a dark version (left: light, right: dark).</p>
          </fieldset>
          <fieldset class="opt-group"><legend>Mode</legend>
            ${['light', 'dark', 'auto'].map((v) => `<label class="radio"><input type="radio" name="theme" value="${v}"> ${v === 'auto' ? 'Match system' : v[0].toUpperCase() + v.slice(1)}</label>`).join('')}
          </fieldset>
          <label class="radio"><input type="checkbox" id="bgAnim"> Animated background</label>
          <p class="hint" id="bgNote"></p>
        </div>
        <div class="look-prev" aria-hidden="true">
          <div class="prev-label">Live preview</div>
          <section class="box">
            <header class="box-h"><h2>Preview topic</h2><span class="n">3</span><button type="button" class="ib i2 on" tabindex="-1">High</button></header>
            <ul class="box-b">
              <li class="it"><button type="button" class="ib i2 inh" tabindex="-1">High</button><div class="t"><span>A saved article</span><div class="meta">Link · example.com</div></div><span class="ic">⇄</span><span class="ic">×</span></li>
              <li class="it"><button type="button" class="ib i1 on" tabindex="-1">Mid</button><div class="t"><span>A video for later</span><div class="meta">Video · Some channel</div></div><span class="ic">⇄</span><span class="ic">×</span></li>
              <li class="it"><button type="button" class="ib i0 on" tabindex="-1">Low</button><div class="t"><span>Notes.pdf</span><div class="meta">PDF · Books</div></div><span class="ic">⇄</span><span class="ic">×</span></li>
            </ul>
          </section>
          <div class="row"><span class="b primary">Primary</span><span class="b">Button</span><input type="text" value="Text field" tabindex="-1" readonly></div>
        </div>
      </div>
    </div></section>
    <section class="win" aria-labelledby="h-topics"><div class="tb"><h3 id="h-topics">Topics</h3></div><div class="wb">
      <div id="topicsBox"></div>
      <form id="addTopic" class="row"><label class="sr" for="newTopic">New topic name</label><input id="newTopic" type="text" maxlength="80" placeholder="New topic name"><button class="b" type="submit">Add topic</button></form>
    </div></section>
    <section class="win" aria-labelledby="h-setup"><div class="tb"><h3 id="h-setup">Setup</h3></div><div class="wb">
      <div class="row"><a class="b" href="#setup">Re-run AI setup</a><a class="b" href="#setup/packs">Pick starter topics</a><button class="b" id="leftovers" type="button">AI sort leftovers</button><button class="b" id="undoSetup" type="button" hidden>Undo last setup</button></div>
    </div></section>
    <section class="win" aria-labelledby="h-backup"><div class="tb"><h3 id="h-backup">Backup</h3></div><div class="wb">
      <p>Items are stored on this computer only. A backup file holds everything: topics, settings, items and deleted items.</p>
      <div class="row"><button class="b" id="export" type="button">Export backup</button>
        <label class="b" for="importFile">Import backup…</label><input id="importFile" type="file" accept=".json,application/json" class="sr"></div>
    </div></section>
    <section class="win" aria-labelledby="h-del"><div class="tb"><h3 id="h-del">Deleted items</h3></div><div class="wb"><div id="delBox"></div></div></section>
    <section class="win" aria-labelledby="h-danger"><div class="tb"><h3 id="h-danger">Start over</h3></div><div class="wb">
      <p>Remove every item from Stash (topics and settings stay). Chrome bookmarks are not touched.</p>
      <button class="b danger" id="clearAll" type="button">Clear all items</button>
    </div></section>
    <section class="win" aria-labelledby="h-priv"><div class="tb"><h3 id="h-priv">Privacy</h3></div><div class="wb">
      <p>Everything stays on your device (and your topics sync through your own Chrome profile), unless you choose to copy a prompt into an AI.</p>
    </div></section>
  </div>`;
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  $('#addTopic', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('#newTopic', el);
    const r = addTopic(inp.value);
    if (r.error) return say(r.error, 'error');
    inp.value = '';
    say(`Added "${r.topic.name}". Move items into it and Stash learns its words.`, 'ok');
  });
  getLocal('setupUndo').then((s) => { if (s && root) $('#undoSetup', root).hidden = false; }).catch(() => {});
  draw();
}

export function update(kind) { if (root && ['items', 'profile', 'sync'].includes(kind)) draw(); }
export function dispose() { root = null; }

function draw() {
  const kb = (S.sync.bytes / 1024).toFixed(1);
  const pct = Math.min(100, (S.sync.bytes / SYNC_BUDGET) * 100);
  $('#syncBox', root).innerHTML = `
    <p>${S.sync.mode === 'sync'
      ? '✓ Topics, keywords, importance, appearance and learned words sync to other computers signed into this Chrome profile (with Chrome sync on). Items do not sync: import them on each computer, or use a backup.'
      : `<span class="err">${esc(S.sync.error || 'Saved on this device only.')}</span>`}</p>
    <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="90" aria-valuenow="${kb}" aria-label="Sync space used"><span style="width:${pct}%"></span></div>
    <p class="hint">${kb} KB of 90 KB used.</p>`;

  for (const r of root.querySelectorAll('input[name="theme"]')) r.checked = r.value === S.profile.theme;
  for (const r of root.querySelectorAll('input[name="style"]')) r.checked = r.value === (S.profile.style || 'retro');
  for (const r of root.querySelectorAll('input[name="palette"]')) r.checked = r.value === (S.profile.palette || 'paper');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#bgAnim', root).checked = S.profile.bgAnim !== false;
  $('#bgNote', root).textContent = reducedMotion ? 'Your system asks for reduced motion, so the background stays still.' : 'Stars in dark mode, dust, dots or soft blobs in light mode, depending on the style.';

  const counts = new Map();
  for (const it of S.items) counts.set(it.topicId, (counts.get(it.topicId) || 0) + 1);
  $('#topicsBox', root).innerHTML = topics().length ? `<div class="tablewrap"><table class="tbl"><thead><tr>
      <th scope="col">Topic</th><th scope="col">Importance</th><th scope="col">Items</th><th scope="col">Keywords</th><th scope="col"><span class="sr">Actions</span></th></tr></thead><tbody>
    ${topics().map((t) => {
      const learned = t.keywords.filter((k) => k.l).length;
      return `<tr data-topic="${esc(t.id)}"><th scope="row">${esc(t.name)}${t.group ? ` <span class="hint">· ${esc(t.group)}</span>` : ''}</th>
        <td>${impToggle(t.importance, true, 'Importance of ' + t.name)}</td>
        <td>${counts.get(t.id) || 0}</td>
        <td>${t.keywords.length - learned}${learned ? ` <span class="hint">+${learned} learned</span>` : ''}</td>
        <td class="acts"><button class="b sm" data-rename type="button">Rename</button><button class="b sm danger" data-del type="button">Delete</button></td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="hint">${counts.get(null) || 0} items are Uncategorized.</p>` : '<p>No topics yet. <a href="#setup">Run setup</a> or add one below.</p>';

  const recs = Object.values(S.deleted).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
  const remote = remoteDeleteCount();
  $('#delBox', root).innerHTML = (recs.length ? `
      <p>${plural(recs.length, 'item')} deleted on this computer. Imports skip them so they never come back.</p>
      <div class="row"><button class="b" id="restoreAll" type="button">Restore all</button></div>
      <ul class="dl">${recs.slice(0, DEL_SHOWN).map((r) => `<li><span class="t">${esc(r.title)} <span class="hint">· ${esc(r.type)}${r.deletedAt ? ' · ' + new Date(r.deletedAt).toLocaleDateString() : ''}</span></span>
        <button class="b sm" type="button" data-restore="${esc(r.key)}">Restore</button></li>`).join('')}</ul>
      ${recs.length > DEL_SHOWN ? `<p class="hint">Showing the newest ${DEL_SHOWN}.</p>` : ''}` : '<p>No deleted items.</p>') +
    (remote ? `<p class="hint">${plural(remote, 'more item')} were deleted on another computer (titles are not synced). They stay hidden from imports here.
      <button class="b sm" type="button" id="forgetRemote">Allow them again</button></p>` : '');
}

async function onClick(e) {
  const t = e.target;
  const row = t.closest('tr[data-topic]');
  const ib = t.closest('[data-cycle]');
  if (row && ib) return setTopicImportance(row.dataset.topic, nextImp(+ib.dataset.cycle));
  if (row && t.closest('[data-rename]')) {
    const tp = topics().find((x) => x.id === row.dataset.topic);
    const name = await promptDialog({ title: 'Rename topic', label: 'New name', value: tp.name });
    if (!name) return;
    const r = renameTopic(tp.id, name);
    return r.error ? say(r.error, 'error') : say('Renamed.', 'ok');
  }
  if (row && t.closest('[data-del]')) {
    const tp = topics().find((x) => x.id === row.dataset.topic);
    const n = S.items.filter((i) => i.topicId === tp.id).length;
    const ok = await confirmDialog({ title: `Delete "${tp.name}"?`, body: `${plural(n, 'item')} will move to Uncategorized. Nothing is removed from Chrome.`, ok: 'Delete topic', danger: true });
    if (!ok) return;
    deleteTopic(tp.id);
    return say(`Deleted "${tp.name}". Its items are in Uncategorized.`, 'ok');
  }
  if (t.closest('#leftovers')) return openLeftovers();
  if (t.closest('#undoSetup')) {
    const snap = await getLocal('setupUndo');
    if (!snap) return;
    if (!(await confirmDialog({ title: 'Undo last setup?', body: 'Your topics go back to how they were before the last setup was applied.', ok: 'Undo setup' }))) return;
    restoreSnapshot(snap);
    await setLocal('setupUndo', null);
    $('#undoSetup', root).hidden = true;
    return say('Last setup undone.', 'ok');
  }
  if (t.closest('#export')) {
    download(`stash-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportAll(), null, 1));
    return say('Backup downloaded.', 'ok');
  }
  const rs = t.closest('[data-restore]');
  if (rs) { const rec = S.deleted[rs.dataset.restore]; if (rec) { restoreItems([rec]); say('Restored.', 'ok'); } return; }
  if (t.closest('#restoreAll')) { const n = restoreItems(Object.values(S.deleted)); return say(`${plural(n, 'item')} restored.`, 'ok'); }
  if (t.closest('#forgetRemote')) { clearRemoteDeletes(); return say('Items deleted on other computers can be imported here again.', 'ok'); }
  if (t.closest('#clearAll')) {
    if (!(await confirmDialog({ title: 'Clear all items?', body: `This removes all ${plural(S.items.length, 'item')} from Stash. Topics and settings stay. Export a backup first if you might want them back.`, ok: 'Clear all items', danger: true }))) return;
    clearItems();
    return say('All items cleared.', 'ok');
  }
}

async function onChange(e) {
  const th = e.target.closest('input[name="theme"]');
  if (th) return setPref('theme', th.value);
  const st = e.target.closest('input[name="style"]');
  if (st) return setPref('style', st.value);
  const pa = e.target.closest('input[name="palette"]');
  if (pa) return setPref('palette', pa.value);
  if (e.target.id === 'bgAnim') return setPref('bgAnim', e.target.checked);
  if (e.target.id === 'importFile') {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch (err) { return say(`That file is not valid JSON: ${err.message}`, 'error', 0); }
    const r = readBackup(obj);
    if (r.error) return say(r.error, 'error', 0);
    const { profile, items, deleted } = r.data;
    const ok = await confirmDialog({
      title: 'Replace everything with this backup?',
      body: `The backup has ${plural(profile.topics.length, 'topic')}, ${plural(items.length, 'item')} and ${plural(Object.keys(deleted).length, 'deleted item')}${r.skipped ? ` (${r.skipped} unreadable entries skipped)` : ''}. Your current topics, settings and items will be replaced.`,
      ok: 'Replace', danger: true,
    });
    if (!ok) return;
    replaceAll(r.data);
    say('Backup imported.', 'ok');
  }
}
