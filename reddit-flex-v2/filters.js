/* Filters: hide feed posts and collapse Reddit's own comments that match the user's lists. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfFilters) return;
  window.__rfFilters = true;

  const RF = RedditFlex;
  let s = {...RF.defaults, enabled: false}; // nothing is filtered until the saved settings load
  let filter = RF.makeFilter(s);
  let version = 0;                          // bumps whenever the filter changes
  const checked = new WeakMap();            // element -> filter version it was last checked with

  // A post's own page always shows it; only feeds hide posts.
  function inFeed(post) {
    const ctx = (post.getAttribute('view-context') || '').toLowerCase();
    return ctx ? ctx.includes('feed') : !/\/comments\//.test(location.pathname);
  }

  // Both checks return false when the element has no data yet (Reddit fills some in after
  // inserting them), so it is looked at again on the next change instead of being skipped.
  function checkPost(post) {
    const title = post.getAttribute('post-title') || '', sub = post.getAttribute('subreddit-prefixed-name') || '', author = post.getAttribute('author') || '';
    const reason = s.enabled && inFeed(post) ? filter.post({title, sub, author}) : '';
    if (reason) post.setAttribute('data-rf-filtered', reason);
    else post.removeAttribute('data-rf-filtered');
    return !!(title || sub || author);
  }

  // Comments are collapsed (with Reddit's own `collapsed` attribute), not removed, so a click
  // still opens one. A comment is collapsed once; if the user opens it, it stays open.
  function checkComment(c) {
    const was = c.getAttribute('data-rf-filtered');
    const text = c.querySelector(':scope > [slot="comment"]')?.textContent || '', author = c.getAttribute('author') || '';
    const reason = s.enabled ? filter.comment({text, author}) : '';
    if (reason && !was) {
      c.setAttribute('data-rf-filtered', reason);
      c.setAttribute('collapsed', '');
    } else if (!reason && was) {
      c.removeAttribute('data-rf-filtered'); // no longer matches: undo our collapse
      c.removeAttribute('collapsed');
    }
    return !!(text.trim() || author);
  }

  function scan() {
    timer = 0;
    for (const el of document.querySelectorAll('shreddit-post, shreddit-comment')) {
      if (checked.get(el) === version) continue;
      if (el.tagName === 'SHREDDIT-POST' ? checkPost(el) : checkComment(el)) checked.set(el, version);
    }
  }
  // A timer, not requestAnimationFrame: rAF never runs in a background tab.
  let timer = 0;
  const queue = () => { if (!timer) timer = setTimeout(scan, 60); };

  // New nodes, a comment whose body arrives later, and posts whose attributes change get rechecked.
  new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'attributes') checked.delete(r.target);
      else { const c = r.target.closest?.('shreddit-comment'); if (c) checked.delete(c); }
    }
    queue();
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true,
    attributeFilter: ['post-title', 'subreddit-prefixed-name', 'author', 'view-context']});
  // Reddit's client-side navigation changes the page type (feed vs post page) without new nodes.
  let path = location.pathname;
  setInterval(() => { if (location.pathname !== path) { path = location.pathname; version++; queue(); } }, 500);

  // Only filter settings matter here; dragging the width rails shouldn't rescan the page.
  let last = '';
  RF.subscribe(next => {
    s = next;
    const key = `${s.enabled}${RF.filterKey(s)}`;
    if (key === last) return;
    last = key;
    filter = RF.makeFilter(s);
    version++;
    queue();
  });
})();
