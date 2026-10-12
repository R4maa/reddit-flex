/* Shared settings for the popup and every content module. */
(() => {
  'use strict';
  const KEY = 'redditFlex';
  const RESET_KEY = 'redditFlexReset';
  const MIN_W = 420, MAX_W = 2400;
  const RANGES = {width: [MIN_W, MAX_W], commentsHeight: [180, 1400]};
  const defaults = Object.freeze({
    enabled: true,
    width: 900,
    hideRight: false,
    hideLeft: false,
    media: true,
    lockRatio: true,
    accordion: true,
    allPosts: true,
    autoComments: false,
    commentsHeight: 440,
  });

  function normalize(value) {
    const out = {...defaults};
    if (!value || typeof value !== 'object') return out;
    for (const key of Object.keys(defaults)) {
      if (RANGES[key]) {
        const n = Number(value[key]), [min, max] = RANGES[key];
        if (Number.isFinite(n)) out[key] = Math.round(Math.min(max, Math.max(min, n)));
      } else if (typeof value[key] === 'boolean') {
        out[key] = value[key];
      }
    }
    return out;
  }

  async function read() {
    try { return normalize((await chrome.storage.local.get(KEY))[KEY]); }
    catch { return {...defaults}; }
  }

  function save(value) {
    try { return chrome.storage.local.set({[KEY]: normalize(value)}); }
    catch { return Promise.resolve(); } // extension reloaded underneath an open tab
  }

  function requestReset() {
    try { return chrome.storage.local.set({[RESET_KEY]: Date.now()}); }
    catch { return Promise.resolve(); }
  }

  // Calls onChange with the current settings now and after every change.
  function subscribe(onChange, onReset) {
    read().then(onChange);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[KEY]) onChange(normalize(changes[KEY].newValue));
        if (changes[RESET_KEY] && onReset) onReset();
      });
    } catch {}
  }

  function headerBottom() {
    const header = document.querySelector('reddit-header-large, header');
    const bottom = header?.getBoundingClientRect().bottom;
    return bottom > 0 && bottom < 200 ? bottom : 0;
  }

  // True when something (Reddit's image viewer, a dialog, a menu) sits on top of `el`.
  // Checks a few points so a small popup over one corner doesn't count.
  function isCovered(el, scope = el) {
    const r = el?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return false;
    const top = Math.max(r.top, headerBottom()), bottom = Math.min(r.bottom, innerHeight);
    if (bottom - top < 20) return false;
    const xs = [r.left + r.width * .25, r.left + r.width * .5, r.left + r.width * .75];
    const ys = [top + (bottom - top) * .3, top + (bottom - top) * .7];
    let covered = 0, total = 0;
    for (const x of xs) for (const y of ys) {
      if (x < 0 || x >= innerWidth) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      total++;
      const ours = hit.id === 'rf-media-ui' || hit.id === 'rf-layout-ui';
      if (!ours && !scope.contains(hit) && !hit.contains(scope)) covered++;
    }
    return total > 0 && covered / total > .5;
  }

  globalThis.RedditFlex = {defaults, normalize, read, save, subscribe, requestReset, headerBottom, isCovered, MIN_W, MAX_W, RANGES};
})();
