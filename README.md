<p align="center">
  <img src="docs/banner.svg" alt="Reddit Flex: your feed, your layout" width="100%">
</p>

<p align="center">
  <a href="#install"><img alt="Chrome extension" src="https://img.shields.io/badge/Chrome-extension-4285F4?logo=googlechrome&logoColor=white"></a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-ff4500">
  <img alt="Version 2.7.0" src="https://img.shields.io/badge/version-2.7.0-2ea44f">
  <img alt="Permissions: storage only" src="https://img.shields.io/badge/permissions-storage%20only-6e7681">
  <a href="https://ko-fi.com/rama2019"><img alt="Support me on Ko-fi" src="https://img.shields.io/badge/Ko--fi-support%20me-FF5E5B?logo=ko-fi&logoColor=white"></a>
</p>

<p align="center">
  <b>Make the Reddit desktop site work your way.</b><br>
  Widen or narrow the feed, stretch and float video players, and read posts and comments without leaving the page.
</p>

---

## ✨ Features

<table>
<tr>
<td width="33%" valign="top">

### ↔️ Resizable feed
Drag the orange rails beside the feed to make the middle column as narrow or as wide as you like. Double-click a rail to reset it. Presets and sidebar toggles are in the popup.

</td>
<td width="33%" valign="top">

### 🎬 Stretch & float media
Drag a corner to enlarge a video, image or gallery **past the column**. Drag **✥ Move** to pop it out into a floating window that stays put while you scroll. **Ctrl + scroll** zooms.

</td>
<td width="33%" valign="top">

### 💬 Inline posts & comments
Click a post to expand it in place. Comments open in a resizable sub-window with a Reddit-style thread tree and avatars, and threads collapse with a click.

</td>
</tr>
</table>

**Built to stay out of the way.** Controls hide when Reddit's image viewer is open. Ctrl-click and middle-click still open posts in a new tab. Preloading respects Reddit's request limits and can be turned off.

## 🚀 Install

> Reddit Flex isn't on the Chrome Web Store yet, so you load it as an unpacked extension.

1. Download this repository (**Code → Download ZIP**) and unzip it somewhere permanent.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `reddit-flex-v2` folder.
4. Pin Reddit Flex from the 🧩 menu, then refresh your Reddit tabs.

To update later, replace the files and click **↻ Reload** on the extension card.

## 🕹️ Using it

| Do this | To |
| --- | --- |
| Drag an **orange rail** beside the feed | Resize the feed column (double-click to reset; ← / → when focused) |
| Hover media, drag a **corner or side handle** | Resize it, even past the column (hold **Shift** for free proportions) |
| **Ctrl + scroll** over media | Zoom it smoothly |
| Drag **✥ Move** · click **⧉ Pop out** | Float the player anywhere / send it to the corner |
| Click the placeholder · **⤓ Dock** · **Esc** | Put a floating player back |
| Click a post's title or comment count | Expand it inline (click again or **Collapse** to close) |
| Click an **avatar** or **thread line** | Collapse that comment thread |
| Drag the **grip** under the comments | Change the comment box height (remembered) |

Everything else (column presets, sidebars, proportions, inline comments on all posts, preloading) is in the toolbar popup.

## 🔒 Privacy

- The only permission is **`storage`**, used for your layout settings on this device.
- Talks only to Reddit, using your normal session, to load the posts and comments you open.
- No analytics, no tracking, no remote code.

## 🛠️ Development

```text
reddit-flex-v2/     the extension (settings, layout, media, accordion, popup)
test-harness/       mock Reddit page: shadow-DOM cards, gallery, fake API & rate limits
docs/               README assets
```

- `node test-harness/build.js` inlines the extension into `test-harness/bundle.html` for testing without the live site. Script errors are collected in `window.__errors`.
- `npx eslint@9` lints the extension (catches undefined variables).

## ☕ Support

If Reddit Flex makes your scrolling nicer, you can buy me a coffee. It keeps the updates coming when Reddit changes its layout.

<p align="center">
  <a href="https://ko-fi.com/rama2019"><img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" alt="Buy me a coffee at ko-fi.com" height="44"></a>
</p>

<sub>Reddit Flex is an independent project and is not affiliated with or endorsed by Reddit, Inc.</sub>
