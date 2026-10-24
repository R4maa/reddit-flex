# Reddit Flex 3.0

A Chrome extension that makes the current Reddit desktop site (www.reddit.com) more flexible to use. This folder is the extension itself. Features, usage and privacy are described in the main README of the repository: https://github.com/R4maa/reddit-flex

## Install

Install it from the Chrome Web Store: https://chromewebstore.google.com/detail/reddit-flex/kpooncebbianoheddnmlfaefpfdfnndh

To run this folder from source instead:

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `reddit-flex-v2` folder.
3. Pin the extension from the puzzle-piece menu, then refresh your Reddit tabs.

## Permissions

- `storage`: your settings, read history and the floating player's spot, on this computer. Settings also go to Chrome sync, but only if you turn sync on in the popup.
- `downloads`: saves a Reddit video when you click **↓ Download**. Only Reddit's own video hosts are allowed.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `settings.js` | Shared defaults, validation, storage, filter matching and page helpers |
| `background.js` | Service worker: video downloads, and starts settings sync |
| `sync.js` | Mirrors the settings between this computer and Chrome sync (worker only) |
| `layout.js` | Column width rails, sidebar toggles and feed position |
| `media.js` | Media resize handles, floating player, Ctrl+scroll zoom |
| `video.js` | Autoplay control, video download, picture-in-picture |
| `accordion.js` | Inline posts and comments, Reddit requests and rate limits |
| `filters.js` | Hides matching feed posts and collapses matching comments |
| `read.js` | Remembers opened posts and dims them in feeds |
| `clutter.js` | Hides promoted posts, upsells, recommended posts, trending searches and award buttons |
| `polish.js` | Back-to-top button, header that scrolls away, exact times |
| `keyboard.js` | Keyboard shortcuts |
| `content.css` | Page styles for all of the above |
| `popup.html`, `popup.js` | Toolbar settings popup |
| `icons/` | Extension icons |
