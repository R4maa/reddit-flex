/* Read posts: remember posts the user opened (inline or on their own page) and dim them in feeds. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfRead) return;
  window.__rfRead = true;

  const RF = RedditFlex;
  const KEY = 'redditFlexRead'; // {ids: [...]}, oldest first; kept apart from settings
  const MAX = 3000;
  const html = document.documentElement;
  let s = {...RF.defaults, enabled: false};
  let ids = [];
  let read = new Set();

  const idOf = post => post.id?.replace(/^t3_/, '') || (post.getAttribute('permalink') || '').match(/\/comments\/([a-z0-9]+)/i)?.[1] || '';

  function paint(post) {
    const id = idOf(post);
    post.toggleAttribute('data-rf-read', !!id && read.has(id));
  }
  const paintAll = () => { for (const p of document.querySelectorAll('shreddit-post')) paint(p); };

  // Oldest first, no duplicates (a repeat keeps its newest place), at most MAX.
  function clean(list) {
    const seen = new Set(), out = [];
    for (let i = list.length - 1; i >= 0 && out.length < MAX; i--) {
      const id = list[i];
      if (typeof id === 'string' && id && !seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out.reverse();
  }
  const merge = (base, add) => clean([...base, ...add]);

  // Writes are batched: opening several posts quickly costs one storage write. Marks not yet
  // written stay in `pending`, so a write from another tab in the meantime can't drop them,
  // and the write itself merges into what is stored now rather than replacing it.
  let saveTimer = 0, pending = [];
  function mark(id) {
    if (!id || !s.enabled || !s.markRead) return;
    pending = merge(pending, [id]);
    ids = merge(ids, [id]);
    read = new Set(ids);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    if (!pending.length) return;
    const batch = pending;
    try {
      const stored = (await chrome.storage.local.get(KEY))[KEY];
      await chrome.storage.local.set({[KEY]: {ids: merge(clean(Array.isArray(stored?.ids) ? stored.ids : []), batch)}});
      pending = pending.filter(id => !batch.includes(id)); // only once saved; later marks stay pending
    } catch {
      if (pending.length) saveTimer = setTimeout(flush, 5000); // try again later
    }
  }
  // Leaving the page within the batching delay still saves the last marks.
  // On unload there may be no time for a read-then-write, so write this tab's merged copy now.
  addEventListener('pagehide', () => {
    if (!pending.length) return;
    clearTimeout(saveTimer);
    try { chrome.storage.local.set({[KEY]: {ids}}); } catch {}
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  const load = v => { ids = merge(clean(Array.isArray(v?.ids) ? v.ids : []), pending); read = new Set(ids); paintAll(); };
  try {
    chrome.storage.local.get(KEY).then(r => load(r[KEY]));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) load(changes[KEY].newValue);
    });
  } catch {}

  // Expanding a post inline (the accordion sets data-rf-open) marks it read.
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') {
        if (r.target.hasAttribute('data-rf-open')) { mark(idOf(r.target)); paint(r.target); }
      } else {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'SHREDDIT-POST') paint(n);
          else if (n.firstElementChild) for (const p of n.querySelectorAll('shreddit-post')) paint(p);
        }
      }
    }
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-rf-open']});

  // Visiting a post's page marks it read, including through Reddit's client-side navigation.
  let path = '', loaded = false;
  function visit() {
    if (!loaded || location.pathname === path) return; // wait for the settings before deciding
    path = location.pathname;
    mark(path.match(/\/comments\/([a-z0-9]+)/i)?.[1]);
  }
  setInterval(visit, 500);

  RF.subscribe(next => {
    const wasMarking = s.enabled && s.markRead;
    s = next;
    loaded = true;
    if (!wasMarking && s.enabled && s.markRead) path = ''; // switched on while on a post page: count it
    html.classList.toggle('rf-dim-read', s.enabled && s.markRead && s.dimRead);
    visit();
  });
})();
