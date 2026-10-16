<p align="center">
  <img src="docs/banner.svg" alt="Reddit Flex: your feed, your layout" width="100%">
</p>

<p align="center">
  <a href="#install"><img alt="Chrome extension" src="https://img.shields.io/badge/Chrome-extension-4285F4?logo=googlechrome&logoColor=white"></a>
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-ff4500">
  <img alt="Version 3.0.0" src="https://img.shields.io/badge/version-3.0.0-2ea44f">
  <img alt="Permissions: storage and downloads" src="https://img.shields.io/badge/permissions-storage%20%2B%20downloads-6e7681">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="https://ko-fi.com/rama2019"><img alt="Support me on Ko-fi" src="https://img.shields.io/badge/Ko--fi-support%20me-FF5E5B?logo=ko-fi&logoColor=white"></a>
</p>

<p align="center">
  <b>Make the Reddit desktop site work your way.</b><br>
  Widen or narrow the feed, stretch and float video players, and read posts and comments without leaving the page.
</p>

---

## Features

<table>
<tr>
<td width="33%" valign="top">

### Resizable feed
Drag the orange rails beside the feed to make the middle column as narrow or as wide as you like. Double-click a rail to reset it. Presets, a width per page type (home, subreddit, post) and sidebar toggles are in the popup.

</td>
<td width="33%" valign="top">

### Stretch and float media
Drag a corner to enlarge a video, image or gallery **past the column**. Drag **✥ Move** to pop it out into a floating window that stays put while you scroll. **Ctrl + scroll** zooms.

</td>
<td width="33%" valign="top">

### Inline posts and comments
Click a post to expand it in place. Comments open in a resizable sub-window with a Reddit-style thread tree, avatars, your choice of sort, and AutoModerator collapsed.

</td>
</tr>
<tr>
<td width="33%" valign="top">

### Filters
Hide feed posts by keyword, subreddit or user, and collapse matching comments. Keywords match whole words; `/regex/` works too.

</td>
<td width="33%" valign="top">

### Keyboard shortcuts
**J / K** between posts, **Enter** to expand, **C** for comments, **← / →** through galleries, **N / P** between comments. Press **?** for the list. Off until you turn it on.

</td>
<td width="33%" valign="top">

### Less clutter
Optionally hide promoted posts, recommended posts on Home, trending searches, Premium and Advertise links, and award buttons.

</td>
</tr>
</table>

Also:

- **Videos:** download a video, watch it picture-in-picture, or stop videos from playing on their own.
- **Read posts:** posts you open are remembered and dimmed in feeds, on this computer only.
- **Settings sync:** optionally keep your settings the same on every computer through your Chrome account.
- **Page touches:** a back-to-top button, a header that scrolls away, and full dates on "5h ago".

**Built to stay out of the way.** Controls hide when Reddit's image viewer is open. Ctrl-click and middle-click still open posts in a new tab. Preloading respects Reddit's request limits and can be turned off.

## Install

> Reddit Flex isn't on the Chrome Web Store yet, so you load it as an unpacked extension.

1. Download this repository (**Code → Download ZIP**) and unzip it somewhere permanent.
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `reddit-flex-v2` folder.
4. Pin Reddit Flex from the extensions menu, then refresh your Reddit tabs.

To update later, replace the files and click **Reload** on the extension card.

## Using it

| Do this | To |
| --- | --- |
| Drag an **orange rail** beside the feed | Resize the feed column (double-click to reset; ← / → when focused) |
| Hover media, drag a **corner or side handle** | Resize it, even past the column (hold **Shift** for free proportions) |
| **Ctrl + scroll** over media | Zoom it smoothly |
| Drag **✥ Move** · click **⧉ Pop out** | Float the player anywhere / send it to the corner |
| Click the placeholder · **⤓ Dock** · **Esc** | Put a floating player back |
| Hover a video, click **▣ PiP** or **↓ Download** | Watch it in a small window on top / save it as an mp4 |
| Click a post's title or comment count | Expand it inline (click again or **Collapse** to close) |
| Click an **avatar** or **thread line** | Collapse that comment thread |
| Drag the **grip** under the comments | Change the comment box height (remembered; ↑ / ↓ when focused) |
| Press **?** (with keyboard shortcuts on) | See every shortcut |

Everything else (presets, sidebars, filters, read posts, clutter, sync, autoplay, preloading) is in the toolbar popup.

## Privacy

- **Permissions:** `storage` holds your settings, read history and the floating player's spot on this computer. `downloads` is used only when you click **↓ Download**, and only for Reddit's own video hosts.
- **Network:** Reddit Flex talks only to Reddit, using your normal session, to load the posts, comments, avatars and videos you open.
- **Settings sync** is off until you turn it on. When it is on, your settings (not your read history) are stored in Chrome sync, with your Google account, like any extension's synced data.
- No analytics, no tracking, no remote code.

## Limits

- Reddit Flex works on the current Reddit site (www.reddit.com). Old Reddit isn't supported, and Reddit changes its markup from time to time.
- Third-party embeds (YouTube and the like) may keep their own size limits.
- Windows narrower than 960 px fall back to Reddit's single column, and the rails hide.

## Development

```text
reddit-flex-v2/     the extension (load this folder unpacked)
test-harness/       a mock Reddit page, the test suites and their runners
docs/               README assets
```

- `npx eslint@9` lints the extension.
- `node test-harness/tools/test.mjs` runs every suite in headless Chrome; `node test-harness/tools/real-chrome.mjs` tests settings sync with the extension really loaded. See [test-harness/README.md](test-harness/README.md).
- CI runs both, plus a manifest check, on every pull request, and builds the store zip.

Bug reports and pull requests are welcome. Please run the suites before opening a pull request.

## License

Reddit Flex is released under the [MIT License](LICENSE). You're free to use, change and share it, as long as the copyright notice comes along.

## Support

If Reddit Flex makes your scrolling nicer, you can buy me a coffee. It keeps the updates coming when Reddit changes its layout.

<p align="center">
  <a href="https://ko-fi.com/rama2019"><img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" alt="Buy me a coffee at ko-fi.com" height="44"></a>
</p>

<sub>Reddit Flex is an independent project and is not affiliated with or endorsed by Reddit, Inc.</sub>
