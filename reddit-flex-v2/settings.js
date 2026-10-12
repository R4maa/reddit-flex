/* Shared settings for the popup and every content module. */
(() => {
  'use strict';
  const KEY = 'redditFlex';
  const RESET_KEY = 'redditFlexReset';
  const MIN_W = 420, MAX_W = 2400;
  // Numeric settings are clamped to these ranges (nested keys use dots, e.g. 'widths.home').
  const PAGE_TYPES = ['home', 'subreddit', 'post', 'other'];
  const RANGES = {width: [MIN_W, MAX_W], commentsHeight: [180, 1400], ...Object.fromEntries(PAGE_TYPES.map(t => [`widths.${t}`, [MIN_W, MAX_W]]))};
  // Settings limited to a fixed set of values; the first one listed is the fallback.
  // commentSort uses the values of Reddit's `sort` parameter; 'confidence' is "Best".
  const ENUMS = {commentSort: ['confidence', 'top', 'new', 'controversial', 'old', 'qa']};
  const defaults = Object.freeze({
    enabled: true,
    width: 900,
    // Off: one width everywhere. On: each page type keeps its own (see pageType).
    widthPerPage: false,
    widths: Object.freeze({home: 900, subreddit: 900, post: 900, other: 900}),
    hideRight: false,
    hideLeft: false,
    media: true,
    lockRatio: true,
    autoplay: true,
    accordion: true,
    allPosts: true,
    prefetch: true,
    autoComments: false,
    commentsHeight: 440,
    keyboard: false,
    commentSort: 'confidence',
    collapseAutoMod: true,
    threadColors: true,
    filterPosts: true,
    filterComments: true,
    filterKeywords: [],
    filterSubs: [],
    filterUsers: [],
    markRead: true,
    dimRead: true,
    hidePromoted: false,
    hideUpsells: false,
    hideRecommended: false,
    hideTrending: false,
    hideAwards: false,
    scrollToTop: true,
    unstickHeader: false,
    exactTimes: true,
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

  // ---- filters ----------------------------------------------------------------------------
  // One entry per line. "/pattern/flags" is a regular expression; anything else is a word or
  // phrase (whole words, any case) or, for subreddits and users, a name with optional r/ or u/.
  // Returns {test} or {error}.
  function parsePattern(line, kind) {
    // "/u/name" and "/r/name" are names, not a regex "u" with flags "name".
    const isName = kind !== 'keyword' && /^\/?(r|u|user)\/[\w-]+\/?$/i.test(line);
    const rx = !isName && /^\/(.+)\/([dgimsuvy]*)$/.exec(line);
    if (rx) {
      try {
        const re = new RegExp(rx[1], rx[2].replace(/[gy]/g, '')); // g/y would make test() stateful
        return {test: v => re.test(v)};
      } catch (e) { return {error: e.message}; }
    }
    if (kind === 'keyword') {
      const esc = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'iu');
      return {test: v => re.test(v)};
    }
    const name = bare(line).trim().replace(/\/$/, '').toLowerCase();
    return {test: v => bare(v).trim().toLowerCase() === name};
  }
  // "r/name", "/u/name" and "user/name" all mean "name".
  const bare = v => String(v || '').replace(/^\/?(r|u|user)\//i, '');

  // Compiles the filter lists in settings `s`. post()/comment() return why something matched
  // ('keyword' | 'subreddit' | 'user') or '' when it doesn't (or that kind of filtering is off).
  function makeFilter(s) {
    const compile = (list, kind) => list.map(l => parsePattern(l, kind).test).filter(Boolean);
    const kw = compile(s.filterKeywords, 'keyword'), subs = compile(s.filterSubs, 'name'), users = compile(s.filterUsers, 'name');
    const hit = (tests, v) => !!v && tests.some(t => t(v));
    return {
      post: ({title, sub, author}) => !s.filterPosts ? ''
        : hit(users, bare(author)) ? 'user' : hit(subs, bare(sub)) ? 'subreddit' : hit(kw, title) ? 'keyword' : '',
      comment: ({text, author}) => !s.filterComments ? ''
        : hit(users, bare(author)) ? 'user' : hit(kw, text) ? 'keyword' : '',
    };
  }

  // Changes only when something that affects filtering changes (not, say, the column width).
  const FILTER_KEYS = ['filterPosts', 'filterComments', 'filterKeywords', 'filterSubs', 'filterUsers'];
  const filterKey = s => JSON.stringify(FILTER_KEYS.map(k => s[k]));

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

  // Which width a page uses when "Width per page type" is on. Front-page feeds (including
  // r/popular and r/all) are home; a post's own page is post; the rest of /r/ is subreddit.
  function pageType(path) {
    const p = String(path || '/').toLowerCase();
    if (/^\/(?:(?:r|u|user)\/[^/]+\/)?comments\//.test(p)) return 'post';
    if (/^\/(?:(?:best|hot|new|top|rising)\/?)?$/.test(p) || /^\/r\/(?:popular|all)(?:\/|$)/.test(p)) return 'home';
    if (/^\/r\/[^/]+/.test(p)) return 'subreddit';
    return 'other';
  }
  // The column width settings `s` give a page of type `type`.
  const widthFor = (s, type) => (s.widthPerPage ? s.widths[type] : s.width);

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
      // Our own UI (rails, media handles, the back-to-top button) never counts as covering.
      const ours = hit.id === 'rf-media-ui' || hit.id === 'rf-layout-ui' || hit.id === 'rf-top-ui' ||
        (ignoreFloating && !!hit.closest?.('[data-rf-floating]'));
      if (!ours && !scope.contains(hit) && !hit.contains(scope)) covered++;
    }
    return total > 0 && covered / total > .5;
  }

  globalThis.RedditFlex = {defaults, normalize, read, save, subscribe, requestReset, headerBottom, isCovered, parsePattern, makeFilter, filterKey, pageType, widthFor, PAGE_TYPES, MIN_W, MAX_W, RANGES, ENUMS};
})();
