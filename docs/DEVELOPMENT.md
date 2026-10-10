# Developing Stash

Stash is a Manifest V3 Chrome extension written in plain JavaScript, HTML and CSS. There is no build step and no dependencies: edit a file, reload the extension, refresh the Stash tab.

## Contents
- [Code layout](#code-layout)
- [How it works](#how-it-works)
- [Storage and sync](#storage-and-sync)
- [Permissions](#permissions)
- [Appearance](#appearance)
- [Testing checklist](#testing-checklist)
- [Troubleshooting](#troubleshooting)
- [Publishing](#publishing)

## Code layout

```
stash-v2/
├── manifest.json        MV3 manifest (permissions, icons, pinned extension key)
├── background.js        service worker: opens the setup screen on first install
├── stash.html           main app shell
├── popup.html           toolbar popup
├── css/
│   ├── app.css          design tokens, 3 styles, 4 palettes (light + dark), all components
│   └── popup.css        popup-only layout
├── js/
│   ├── app.js           entry point: loads data, applies the theme, routes between views
│   ├── data.js          storage and data model: items, topics, chunked sync, deleted blocklist, backup
│   ├── categorize.js    keyword scoring, light stemming, learning from manual moves, topic relations
│   ├── ai.js            AI prompts, JSON extraction, schema validation, multi-AI merge rules
│   ├── onboarding.js    setup screen and the "AI sort leftovers" dialog
│   ├── packs.js         generic starter topics for users who skip the AI step
│   ├── imports.js       Chrome bookmarks, YouTube playlists / Watch Later, local PDFs
│   ├── youtube.js       every YouTube selector (the YT object) and the page readers
│   ├── list.js          library view: High / Mid / Low bands, drag and drop, search, filters
│   ├── items.js         one item row and its actions (shared by the library and the graph panel)
│   ├── graph.js         graph view: spring simulation, pan / zoom, search, side panel
│   ├── settings.js      settings view
│   ├── themes.js        style / palette / mode switching
│   ├── bg.js            animated background
│   ├── ui.js            dialogs, undo bar, move menu, shared widgets
│   ├── popup.js         toolbar popup logic
│   └── util.js          escaping, normalizing, dedupe keys, hashing
└── assets/
    ├── fonts/           bundled OFL fonts and their license files
    ├── icons/           16 / 32 / 48 / 128 px icons
    └── img/             setup screen animation
```

## How it works

**Sorting.** Each topic has weighted keywords. An item scores points for every keyword found in its title or file name (×3), its folder, playlist or channel (×2), and its URL (×1). Matching ignores case and accents, short words (3 letters or less) must match whole words, and simple word endings are ignored (hacker = hacking = hacks). The highest score above the threshold wins; ties go to the more important topic, then topic order. Otherwise the item is Uncategorized.

**Learning.** When an item is moved by hand, 2–4 informative words from its title are added to the target topic with a small weight. Stopwords and words common across many topics are skipped; learned words are capped at 60 per topic and slowly decay. Re-sort only re-evaluates items that were not placed by hand.

**AI setup.** The setup prompt asks for JSON only. Replies are untrusted: Stash extracts the first JSON object, validates it against the schema and escapes everything it renders. It never evaluates the text. With several AIs, the MAIN reply decides topic names, groups, importance and links; the others can only add keywords to matching topics, propose near matches (the user confirms) and suggest new topics (the user accepts or ignores). If two topics claim a keyword, MAIN's topic keeps it.

**Deduplication.** Items are keyed by YouTube video id, playlist id, URL without hash and trailing slash, or file path. Deleted keys go on a blocklist so imports never bring them back; Settings → Deleted items restores them.

**Graph.** Topic boxes and item dots are connected by springs. Each topic reserves an area for its box plus its dots, and those areas never overlap. Links between topics come from the AI's `related` lists, items matching more than one topic, and bookmarks in the same folder landing in different topics.

## Storage and sync

| Data | Where | Synced |
|---|---|---|
| Items, deleted items, graph positions | `chrome.storage.local` (with `unlimitedStorage`) | No |
| Profile: topics, keywords, learned words, appearance, deleted-item hashes | `chrome.storage.sync`, split into chunks | Yes |

The profile is kept under about 90 KB. If it grows past that, or sync fails, it is saved locally and Settings → Sync says so. Export / Import in Settings backs up everything as one JSON file.

Sync only works between installs with the **same extension ID**. `manifest.json` contains a `"key"` that pins the ID (`kjoclgnnpcnhmbpokjokhjomholkjkcd`), so every Load unpacked copy shares it.

## Permissions

| Permission | Why |
|---|---|
| `bookmarks` | Read bookmarks for import; optionally save a page from the popup. Stash never edits or deletes bookmarks. |
| `scripting` | Read titles from YouTube pages (playlists, Watch Later, the current video's channel). |
| `storage`, `unlimitedStorage` | Keep thousands of items locally and sync the small settings profile. |
| `activeTab` | Lets the popup read the current page's title and URL when the icon is clicked. Used instead of `tabs`, which would show a "read your browsing history" warning. |
| `https://www.youtube.com/*` | Run the YouTube readers and find open YouTube playlist tabs. |

## Appearance

Everything visual is driven by CSS custom properties in `css/app.css`; `themes.js` only sets `data-style`, `data-palette` and `data-mode` on `<html>`.

- **Styles:** Retro (default), Clean, Modern
- **Palettes:** Paper & Ink, Phosphor Green, Amber, Ocean, each with a light and a dark version. Every text color pair has at least 4.5:1 contrast.
- **Background:** stars and shooting stars in dark mode; pixel snow (Retro), linked dots (Clean) or drifting blobs (Modern) in light mode. At most 60 particles at 30 fps, paused when the tab is hidden, reduced while the graph is open, and off with the Settings switch or the system's reduced-motion setting.

| Style | File in `assets/fonts/` | Font |
|---|---|---|
| Retro headings and the logo | `VT323-Regular.ttf` | VT323 |
| Retro text | `CourierPrime-Regular.ttf`, `CourierPrime-Bold.ttf` | Courier Prime |
| Clean | `IBMPlexSans-Variable.ttf` | IBM Plex Sans |
| Modern headings | `SpaceGrotesk-Variable.ttf` | Space Grotesk |
| Modern text | `DMSans-Variable.ttf` | DM Sans |

All fonts come from [github.com/google/fonts](https://github.com/google/fonts) under the SIL Open Font License.

## Testing checklist

**Setup and imports**
- [ ] A fresh install opens the setup screen in light mode.
- [ ] AI setup with 1–3 replies: each tab shows ✓ or an error with **Copy fix prompt**; Preview & apply shows near matches and suggestions; **Undo setup** works.
- [ ] "Skip AI" shows 14 starter topics with cycling importance.
- [ ] Chrome bookmarks import; running it again adds nothing new.
- [ ] YouTube playlists import as one item each; Watch Later imports videos one by one.
- [ ] PDFs: the permission card appears, a subfolder scans, and clicking a file opens it.

**Library and items**
- [ ] Bands show High, Mid and Low with at most 4 boxes per row; items sort High → Mid → Low, then A–Z.
- [ ] One importance button cycles High → Low → Mid; dashed means inherited from the topic.
- [ ] Dragging a box reorders it or changes its band; the ⠿ handle works with arrow keys.
- [ ] Dragging an item onto a box moves it; the ⇄ menu works by keyboard.
- [ ] × deletes with a 6-second undo; deleted items stay out of later imports and can be restored in Settings.
- [ ] Search and filters narrow the list; Clear resets them.
- [ ] AI sort leftovers assigns items and can be undone.

**Popup**
- [ ] On a web page it shows **+ Add to Stash**, on a video **+ Add video**, on a playlist **+ Add playlist**.
- [ ] A second visit says "Already in Stash"; "also save to Chrome bookmarks" works.

**Graph**
- [ ] Every topic (and Uncategorized) appears, with a dot for every item; boxes never overlap.
- [ ] Dragging a box stretches the graph and it swings back; wheel / pinch zoom, Fit and Re-layout work.
- [ ] Search glows the matches; clicking a box opens its side panel; changes appear live.

**Appearance and sync**
- [ ] All 3 styles and 4 palettes work in light and dark; the logo always uses the Retro font.
- [ ] The background animates, pauses with the Settings switch and stops with reduced motion.
- [ ] Settings changes appear on a second computer with the same Chrome profile and sync turned on.
- [ ] Export, Clear all items, then Import restores everything.

## Troubleshooting

- **"Couldn't find any playlists… YouTube may have changed its layout":** update the selectors in the `YT` object at the top of `js/youtube.js`.
- **"YouTube shows you as signed out":** sign in to YouTube in the same Chrome profile.
- **Folder refused:** Chrome blocks top-level folders like Documents, Downloads and Desktop. Pick a subfolder.
- **Settings don't sync:** check that Chrome sync is on with Extensions enabled, and that both computers show the same extension ID in `chrome://extensions`.

## Publishing

Before uploading to the Chrome Web Store, remove the `"key"` line from `manifest.json`; the store assigns its own ID. Zip the contents of `stash-v2/` (not the folder above it).
