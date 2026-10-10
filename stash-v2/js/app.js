// app.js — entry point for stash.html: loads data, applies the theme, routes between views.
import { load, S, onChange, setPref } from './data.js';
import * as library from './list.js';
import * as setup from './onboarding.js';
import * as settings from './settings.js';
import * as graph from './graph.js';
import { $, $$, say, closeMenu } from './ui.js';
import { applyTheme as applyLook, onSystemChange } from './themes.js';
import { initBg, configureBg } from './bg.js';

const VIEWS = { library, graph, setup, settings };
const TITLES = { library: 'Library', graph: 'Graph', setup: 'Setup', settings: 'Settings' };
const THEMES = ['light', 'dark', 'auto'];
let cur = null, curName = '', curHash = '';

function applyTheme() {
  const t = S.profile.theme;
  applyLook(S.profile);
  const b = $('#themeBtn');
  if (b) b.textContent = 'Mode: ' + (t === 'light' || t === 'dark' ? t : 'auto');
  configureBg({ enabled: S.profile.bgAnim, busy: curName === 'graph' });
}

function route() {
  const hash = location.hash.slice(1);
  let name = hash.split('/')[0];
  if (!VIEWS[name]) name = S.profile.setupDone || S.items.length ? 'library' : 'setup';
  if (name === curName && hash === curHash) return;
  cur?.dispose?.();
  closeMenu();
  curName = name; curHash = hash; cur = VIEWS[name];
  const old = $('#view');
  const fresh = old.cloneNode(false);          // a fresh element drops the old view's listeners
  old.replaceWith(fresh);
  cur.render(fresh);
  for (const a of $$('[data-nav]')) a.toggleAttribute('aria-current', a.dataset.nav === name);
  $('#setupLink').hidden = S.profile.setupDone || name === 'setup';
  document.title = `Stash · ${TITLES[name]}`;
  configureBg({ busy: name === 'graph' });
  window.scrollTo(0, 0);
}

async function start() {
  try {
    await load();
  } catch (e) {
    $('#view').innerHTML = `<div class="card"><h2>Stash couldn't load its data</h2><p>${String(e.message || e).replace(/</g, '&lt;')}</p></div>`;
    return;
  }
  initBg();
  applyTheme();
  onSystemChange(() => { if (S.profile.theme === 'auto') { applyTheme(); cur?.update?.('profile'); } });
  onChange((kind) => {
    if (kind === 'profile') { applyTheme(); $('#setupLink').hidden = S.profile.setupDone || curName === 'setup'; }
    cur?.update?.(kind);
  });
  $('#themeBtn').addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(S.profile.theme) + 1) % THEMES.length];
    setPref('theme', next);
  });
  addEventListener('hashchange', route);
  route();
  if (new URLSearchParams(location.search).has('welcome')) say('Welcome to Stash! Start by setting up your topics.', 'ok');
}

start();
