// popup.js — toolbar popup: add the current page (or YouTube video / playlist) to Stash.
import { load, S, topics, topicById, findByKey, isBlocked, addItems, saveNow, matcher, UNCAT } from './data.js';
import { categorize } from './categorize.js';
import { esc, ytInfo, dedupeKey, IMP_LABEL } from './util.js';
import { YT, scrapeCurrentPage } from './youtube.js';
import { impToggle, nextImp } from './ui.js';
import { applyTheme as applyLook } from './themes.js';

const $ = (s) => document.querySelector(s);
let item = null, chosenImp = null, autoTopic = null;

function applyTheme() { applyLook(S.profile); }

function setState(text, cls = '') { const s = $('#state'); s.textContent = text; s.className = 'state ' + cls; }

let impLocked = false;
function drawImp() {
  const tid = $('#topic').value || null;
  const tImp = (topicById(tid) || UNCAT).importance;
  const eff = chosenImp ?? tImp;
  $('#imp').innerHTML = impToggle(eff, chosenImp != null, 'Importance');
  $('#imp button').disabled = impLocked;
  $('#impHint').textContent = chosenImp == null ? `From the topic. Click to cycle High → Low → Mid.` : `Set for this item. Click to cycle High → Low → Mid.`;
}

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:\/\//i.test(tab.url || '')) return null;
  const y = ytInfo(tab.url);
  let title = (tab.title || tab.url).trim(), url = tab.url, type = 'bookmark', channel = '', count;
  if (y) {
    title = title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube$/, '');
    if (y.playlist) { type = 'playlist'; url = 'https://www.youtube.com/playlist?list=' + encodeURIComponent(y.playlist); }
    else { type = 'video'; url = 'https://www.youtube.com/watch?v=' + y.video; }
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrapeCurrentPage, args: [YT] });
      const info = r?.result || {};
      channel = info.channel || '';
      if (type === 'playlist') { if (info.title) title = info.title; if (Number.isFinite(info.count)) count = info.count; }
    } catch { /* channel is optional */ }
  }
  return { type, title, url, channel, count, source: type === 'bookmark' ? 'Added from popup' : 'YouTube', folder: '' };
}

async function main() {
  await load();
  applyTheme();
  item = await readPage();
  $('#loading').hidden = true;
  if (!item) {
    $('#pop').insertAdjacentHTML('afterbegin', '<p class="state err">This page can\'t be stashed (only normal web pages and YouTube).</p>');
    return;
  }
  $('#form').hidden = false;
  $('#ptitle').textContent = item.title;
  $('#purl').textContent = item.url;
  $('#add').textContent = item.type === 'playlist' ? '+ Add playlist' : item.type === 'video' ? '+ Add video' : '+ Add to Stash';

  autoTopic = categorize(item, matcher()).topicId;
  $('#topic').innerHTML = [...topics(), UNCAT].map((t) =>
    `<option value="${esc(t.id ?? '')}" ${t.id === autoTopic ? 'selected' : ''}>${esc(t.name)}${t.id === autoTopic ? ' (auto)' : ''}</option>`).join('');
  if (!topics().length) setState('No topics yet. Open Stash to set them up; this will go to Uncategorized.', '');

  const existing = findByKey(dedupeKey(item));
  if (existing) {
    setState(`Already in Stash, in ${(topicById(existing.topicId) || UNCAT).name}.`, 'ok');
    $('#add').disabled = true;
    $('#topic').disabled = true;
    impLocked = true;
    chosenImp = existing.importance;
    $('#topic').value = existing.topicId ?? '';
  } else if (isBlocked(dedupeKey(item))) {
    setState('You deleted this before. Adding it brings it back.', '');
  }
  drawImp();

  $('#topic').addEventListener('change', drawImp);
  $('#imp').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cycle]');
    if (!b || b.disabled) return;
    const tImp = (topicById($('#topic').value || null) || UNCAT).importance;
    const next = nextImp(chosenImp ?? tImp);
    chosenImp = next === tImp ? null : next;   // back to the topic's level = follow the topic
    drawImp();
    $('#imp button').focus();
  });
  $('#add').addEventListener('click', add);
}

async function add() {
  const btn = $('#add');
  btn.disabled = true;
  const topicId = $('#topic').value || null;
  try {
    const res = addItems([{ ...item, topicId, importance: chosenImp }], { unblock: true });
    if (!res.added) { setState('Already in Stash.', 'ok'); return; }
    if ($('#alsoBm').checked) {
      const ex = await chrome.bookmarks.search({ url: item.url });
      if (!ex.length) await chrome.bookmarks.create({ title: item.title, url: item.url });
    }
    await saveNow();
    setState(`✓ Added to ${(topicById(topicId) || UNCAT).name}${topicId !== autoTopic ? ' (Stash learned from this choice)' : ''}.`, 'ok');
    btn.textContent = '✓ Added';
    $('#topic').disabled = true;
  } catch (e) {
    btn.disabled = false;
    setState('Could not add: ' + (e.message || e), 'err');
  }
}

$('#open').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('stash.html');
  const tabs = await chrome.tabs.query({ url: url + '*' }).catch(() => []);
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
});

main().catch((e) => { $('#loading').textContent = 'Stash could not load: ' + (e.message || e); });
