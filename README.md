# Stash

Organize your Chrome bookmarks, YouTube playlists, Watch Later videos and PDFs by topic and importance, with a graph view of how everything connects. Set up in minutes using the AI you already use.
<img width="1917" height="972" alt="sneak_peek" src="https://github.com/user-attachments/assets/c9d9110b-6cf1-4b7a-828d-1af42bcfe7af" />

<img width="1902" height="971" alt="library" src="https://github.com/user-attachments/assets/cb3e6c4a-d7a8-44a7-bb76-d7b253924b2f" />

<img width="1897" height="967" alt="graph" src="https://github.com/user-attachments/assets/ca043540-fe7b-46e9-a755-6960ae92d235" />



## Features
- **Adapts to you:** on first run, Stash gives you a prompt to paste into your favorite AI (ChatGPT, Claude, Gemini...). Paste its reply back and Stash builds topics, keywords and priorities around your interests. You can use up to 3 AIs and pick one as the main. No AI? Pick from 14 starter topics instead.
- **Imports:** Chrome bookmarks, YouTube Watch Later videos, saved YouTube playlists (kept as playlists) and local PDFs
- **Importance:** topics and items marked High / Mid / Low; delete items with undo
- **Learns as you go:** move an item to the right topic and Stash picks up words from its title. "AI sort leftovers" lets an AI sort whatever the keywords missed.
- **Quick add:** save the current page, YouTube video or playlist from the toolbar button
- **List view:** High / Mid / Low bands with drag and drop, search and filters
- **Graph view:** every topic is a box and every item a dot around it, with zoom, search, a side panel per topic and connections between related topics
- **Your look:** 3 styles (Retro, Clean, Modern) and 4 color palettes, light and dark mode, optional animated background
- **Sync and backup:** settings sync across your computers through Chrome; back up and restore with Export / Import
- **Private:** no account and no server

## Install (Chrome, Edge, Brave)
1. Click **Code > Download ZIP** on this page, then unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked**, open the unzipped folder, and select the **`stash-v2`** folder (the one that contains `manifest.json`).
4. Pin Stash from the puzzle-piece menu.

To update later, replace the files and click the reload button on Stash's card in `chrome://extensions`.

## First run
1. The setup screen opens by itself after install (or click the Stash icon, then **Open Stash**).
2. Copy the prompt, paste it into your AI, and paste the reply back. Or skip and pick starter topics.
3. Import your bookmarks and playlists, then click the Stash icon and **+ Add to Stash** on any page you want to save.

## Known limits
- YouTube import depends on YouTube's page layout and may break when YouTube changes it. The page selectors all live in `stash-v2/js/youtube.js`.
- Chrome blocks scanning top-level folders like Documents or Downloads; pick a subfolder.
- Topic sorting uses keywords, so some items will land in the wrong place. Move them by hand and Stash learns.
- Items don't sync between computers (only settings do). Import again on the other computer, or use Export / Import.
- Tested on Windows with Chrome only.

## Privacy
Your items stay in your browser. Settings (topics, keywords, theme) sync through Chrome's built-in sync if you have it turned on. Nothing is sent to any server of mine. The only text that leaves your device is what you choose to copy into an AI.

## Project structure
```
stash-extension/
├── README.md            this file
├── LICENSE              MIT license
├── docs/
│   └── DEVELOPMENT.md   how Stash works, permissions, sync, testing and troubleshooting
└── stash-v2/            the extension (load this folder in Chrome)
    ├── manifest.json
    ├── background.js    opens the setup screen on first install
    ├── stash.html       main app: setup, library, graph, settings
    ├── popup.html       toolbar popup
    ├── css/             styles, palettes and themes
    ├── js/              app code
    └── assets/          fonts, icons and images
```
For contributors, [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) explains the code layout, how sorting and sync work, and how to test changes.

## Credits and license
Released under the [MIT License](LICENSE). Fonts: VT323, Courier Prime, IBM Plex Sans, Space Grotesk and DM Sans, all under the SIL Open Font License (license files in `stash-v2/assets/fonts/`).
