// background.js — service worker. Its only job: open the setup screen on first install.
// All importing and sorting runs in the Stash page and the toolbar popup.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('stash.html?welcome#setup') });
});
