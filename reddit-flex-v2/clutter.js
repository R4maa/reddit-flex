/* Hide clutter: promoted posts, Premium/Advertise links, recommended posts, trending searches, award buttons. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfClutter) return;
  window.__rfClutter = true;

  const RF = RedditFlex;
  const html = document.documentElement;
  // Setting -> html class. The rules themselves are in content.css.
  const CLASSES = {
    hidePromoted: 'rf-hide-promoted',
    hideUpsells: 'rf-hide-upsells',
    hideRecommended: 'rf-hide-recommended',
    hideTrending: 'rf-hide-trending',
    hideAwards: 'rf-hide-awards',
  };

  // The search dropdown lives in reddit-search-large's shadow root, out of content.css's reach, so it
  // gets a small stylesheet of its own while the setting is on (Firefox has no :host-context(), so the
  // html class can't switch it from inside).
  // The empty-box dropdown is one flat list: each section heading is followed by its items as
  // siblings. Recent searches come wrapped in a <div>; trending searches are bare <li>s and trending
  // communities bare trackers, so these rules leave Recent alone whichever order the sections are in.
  // The typed-results list reuses #subreddit_typeahead_section, hence the container in front.
  const SEARCH_CSS = `#reddit-trending-searches-partial-container
    :is([id$="_trending_query"], [id$="_trending_query"] ~ li, #subreddit_typeahead_section, #subreddit_typeahead_section ~ search-telemetry-tracker) { display: none !important; }`;
  let trendingOff = false;
  function styleSearch() {
    const root = document.querySelector('reddit-search-large')?.shadowRoot;
    const style = root?.getElementById('rf-search-style');
    if (!root || !!style === trendingOff) return;
    if (style) { style.remove(); return; }
    const add = document.createElement('style');
    add.id = 'rf-search-style';
    add.textContent = SEARCH_CSS;
    root.append(add);
  }
  // The search box is loaded after the page and only matters once it has focus.
  addEventListener('focusin', () => { if (trendingOff) styleSearch(); }, true);

  RF.subscribe(s => {
    for (const [key, cls] of Object.entries(CLASSES)) html.classList.toggle(cls, s[key]);
    trendingOff = s.enabled && s.hideTrending;
    styleSearch();
  });
})();
