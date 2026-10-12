/* Shared settings for the popup and every content module. */
(() => {
  'use strict';
  const KEY = 'redditFlex';
  const RESET_KEY = 'redditFlexReset';
  const MIN_W = 420, MAX_W = 2400;
  // Numeric settings are clamped to these ranges (nested keys use dots, e.g. 'widths.home').
  const RANGES = {width: [MIN_W, MAX_W], commentsHeight: [180, 1400]};
  // Settings limited to a fixed set of values; the first one listed is the fallback.
  // commentSort uses the values of Reddit's `sort` parameter; 'confidence' is "Best".
  const ENUMS = {commentSort: ['confidence', 'top', 'new', 'controversial', 'old', 'qa']};
  const defaults = Object.freeze({
    enabled: true,
    width: 900,
    hideRight: false,
    hideLeft: false,
    media: true,
    lockRatio: true,
    accordion: true,
    allPosts: true,
    prefetch: true,
    autoComments: false,
    commentsHeight: 440,
    keyboard: false,
    commentSort: 'confidence',
    collapseAutoMod: true,
    threadColors: true,
  });

  // Validates one value against the type of its default: booleans, clamped numbers, enums,
  // lists of strings, and nested objects. Anything unexpected falls back to the default.
  function normalizeValue(def, value, key) {
    if (Object.hasOwn(RANGES, key)) {
      const n = Number(value), [min, max] = RANGES[key];
      return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : def;
    }
    if (Object.hasOwn(ENUMS, key)) return ENUMS[key].includes(value) ? value : def;
    if (typeof def === 'boolean') return typeof value === 'boolean' ? value : def;
    if (Array.isArray(def)) {
      if (!Array.isArray(value)) return [...def];
      return value.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 300)).filter(Boolean).slice(0, 500);
    }
    if (def && typeof def === 'object') {
      const out = {};
      for (const k of Object.keys(def)) out[k] = normalizeValue(def[k], value?.[k], `${key}.${k}`);
      return out;
    }
    if (typeof def === 'number') return Number.isFinite(value) ? value : def;
    return typeof value === typeof def ? value : def;
  }

  function normalize(value) {
    const src = value && typeof value === 'object' ? value : {};
    const out = {};
    for (const key of Object.keys(defaults)) out[key] = normalizeValue(defaults[key], src[key], key);
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
  // `ignoreFloating` treats our floating players as transparent (keyboard nav wants that;
  // the rails and inline media handles should still hide under them).
  function isCovered(el, scope = el, {ignoreFloating = false} = {}) {
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
      // Our own UI (rails, media handles) never counts as covering.
      const ours = hit.id === 'rf-media-ui' || hit.id === 'rf-layout-ui' ||
        (ignoreFloating && !!hit.closest?.('[data-rf-floating]'));
      if (!ours && !scope.contains(hit) && !hit.contains(scope)) covered++;
    }
    return total > 0 && covered / total > .5;
  }

  globalThis.RedditFlex = {defaults, normalize, read, save, subscribe, requestReset, headerBottom, isCovered, MIN_W, MAX_W, RANGES, ENUMS};
})();
