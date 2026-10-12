# Reddit Flex 2.6

A Chrome extension that makes the current Reddit desktop site (www.reddit.com) more flexible to use.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. If an older Reddit Flex (1.x) is loaded, remove it or turn it off so the two don't run at the same time.
3. Click **Load unpacked** and select this `reddit-flex-v2` folder.
4. Pin the extension from the puzzle-piece menu, then refresh your Reddit tabs.

## Features

### Feed width
- Drag the **orange rails** on either side of the middle column. The edge follows your cursor, and a pill shows the width.
- The rails (and media handles) hide automatically while something covers the feed, such as Reddit's image viewer or a dialog.
- Double-click a rail to go back to the default width. With a rail focused, ←/→ change the width (hold Shift for bigger steps).
- The popup has a slider, presets (Narrow / Default / Wide / Ultra), and switches to hide the right sidebar and the left navigation. Presets and toggles animate instead of jumping.

### Videos and images
- Hover media to show the handles. Drag a **corner** or **side handle** to resize it. Inline media grows around its center and can extend **past the column**, over the sidebars. It only shifts sideways when it reaches the edge of the window.
- Proportions stay locked by default. Hold **Shift** while dragging to resize freely, or change the default in the popup.
- **Ctrl + scroll** over media zooms it smoothly.
- **✥ Move**: drag it to turn the player into a floating window you can put anywhere. Clicking it, or clicking **⧉ Pop out**, sends the player to the bottom-right corner. Resize a floating player from its corners.
- The floating player stays in place while you scroll the feed. A placeholder marks its spot in the post; click the placeholder, press **⤓ Dock**, or press **Esc** to put it back.
- **↺ Reset** (or double-clicking a handle) restores the original size.

### Posts and comments as an accordion
- Click a text post in a feed (on its title or body) and the full text expands in place, with a smooth height animation. Click again or press **Collapse** to close it.
- Clicking the post's comment count expands the post and shows its top comments. Comments are drawn as a Reddit-style tree with avatars, with a thread line and rounded elbows into each reply. Each top-level thread is set apart by a divider. Click a comment's avatar or its thread line to collapse it (hovering lights up the whole thread). A collapsed comment shows a "+N hidden" pill; click anywhere on its row to expand it.
- **Image, video, gallery and link posts** work the same way: clicking the title, the empty part of the card, or the comment count opens the top comments below the card (plus any text the post has). Clicking the image or video itself still opens Reddit's viewer or player controls, and external links still open the site. Switch this off with *Inline comments on all posts* in the popup.
- Comments open in a **scrollable sub-window** (440 px tall by default), so the posts underneath stay close. Drag the grip under the box to make it taller or shorter. That height is remembered for every post, and double-clicking the grip resets it. When you scroll past the last comment, the page keeps scrolling to the next posts.
- Posts are preloaded when you rest the pointer on them (300 ms), so they usually open instantly. Preloading is budgeted (at most 15 per minute, on-screen posts only), pauses automatically when Reddit reports your request allowance is low or returns a 429, and can be turned off in the popup (*Preload on hover*). Posts you click always load.
- Ctrl-, Shift- or middle-click still opens the post the usual way. Links inside the expanded text work as normal links.

## How it works / privacy

- The only permission is `storage`, used to save your layout settings on this device.
- Expanded posts load from Reddit's own `.json` endpoint for that post, using your normal Reddit session. If that fails, they fall back to the post page itself. The HTML is parsed inertly and reduced to an allowlist of safe tags before it's shown.
- Floating players use Chrome's Popover API (the top layer). The original element is never moved or recreated, so playback continues.
- No analytics, no remote code, and nothing is sent anywhere except Reddit.

## Limits

- Reddit changes its markup from time to time. The selectors target the current "shreddit" site. Old Reddit is not supported.
- Third-party embeds (YouTube etc.) may keep their own internal size limits.
- Narrow windows (< 960 px) fall back to Reddit's single-column layout, and the rails are hidden there.

## Files

| File | Purpose |
| --- | --- |
| `settings.js` | Shared defaults, storage and change notifications |
| `layout.js` | Column width rails and sidebar toggles |
| `media.js` | Media resize handles, floating player, Ctrl+scroll zoom |
| `accordion.js` | Inline text-post expansion and comments |
| `content.css` | Page styles for all of the above |
| `popup.html/js` | Toolbar settings popup |
