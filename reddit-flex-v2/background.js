/* Background worker: saves Reddit videos for the content scripts (they can't call chrome.downloads),
   and runs settings sync (sync.js). */
'use strict';
if (typeof importScripts === 'function') importScripts('settings.js', 'sync.js');

// Only Reddit's own video hosts, over https. Anything else a page could slip into a message is refused.
const HOSTS = ['packaged-media.redd.it', 'v.redd.it'];
const PAGES = ['www.reddit.com', 'reddit.com', 'sh.reddit.com'];

function videoUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  return url.protocol === 'https:' && HOSTS.includes(url.hostname) && !url.port && !url.username && !url.password ? url.href : null;
}

// Windows forbids <>:"/\|?* and control characters, trailing dots or spaces, and device names like
// CON; Chrome refuses a name starting with a dot. Keep it short (whole characters, not half an emoji).
function safeName(raw) {
  let name = String(raw || '').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
  name = Array.from(name).slice(0, 120).join('').replace(/\.mp4$/i, '').replace(/^[. ]+|[. ]+$/g, '');
  // "NUL.clip" is as reserved as "NUL".
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = `reddit ${name}`;
  return `${name || 'reddit video'}.mp4`;
}

function fromReddit(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab?.url) return false;
  try { return PAGES.includes(new URL(sender.tab.url).hostname); } catch { return false; }
}

// Returns true when the reply comes later (chrome.runtime.onMessage's contract).
function onMessage(msg, sender, reply, downloads = chrome.downloads) {
  if (msg?.type !== 'rf-download') return false;
  const url = videoUrl(msg.url);
  if (!fromReddit(sender) || !url) { reply({ok: false, error: 'Not a Reddit video'}); return false; }
  downloads.download({url, filename: safeName(msg.filename), conflictAction: 'uniquify'})
    .then(id => reply({ok: true, id}), e => reply({ok: false, error: e?.message || 'Download failed'}));
  return true;
}

if (globalThis.chrome?.runtime?.onMessage) {
  const settingsSync = globalThis.RedditFlexSync.start(chrome);
  chrome.runtime.onMessage.addListener((msg, sender, reply) => (msg?.type === 'rf-download' ? onMessage(msg, sender, reply) : settingsSync.onMessage(msg, sender, reply)));
}

globalThis.RedditFlexBackground = {videoUrl, safeName, fromReddit, onMessage}; // for the test harness
