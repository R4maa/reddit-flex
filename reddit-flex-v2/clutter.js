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
  // gets a small stylesheet of its own. :host-context() lets the html class switch it on and off.
  // The empty-box dropdown is one flat list: each section heading is followed by its items as
  // siblings. Recent searches come wrapped in a <div>; trending searches are bare <li>s and trending
  // communities bare trackers, so these rules leave Recent alone whichever order the sections are in.
  // The typed-results list reuses #subreddit_typeahead_section, hence the container in front.
  const SEARCH_CSS = `:host-context(html.rf-enabled.rf-hide-trending) #reddit-trending-searches-partial-container
    :is([id$="_trending_query"], [id$="_trending_query"] ~ li, #subreddit_typeahead_section, #subreddit_typeahead_section ~ search-telemetry-tracker) { display: none !important; }`;
  function styleSearch() {
    const root = document.querySelector('reddit-search-large')?.shadowRoot;
    if (!root || root.getElementById('rf-search-style')) return;
    const style = document.createElement('style');
    style.id = 'rf-search-style';
    style.textContent = SEARCH_CSS;
    root.append(style);
  }
  // The search box is loaded after the page and only matters once it has focus.
  addEventListener('focusin', () => { if (html.classList.contains('rf-hide-trending')) styleSearch(); }, true);

  RF.subscribe(s => {
    for (const [key, cls] of Object.entries(CLASSES)) html.classList.toggle(cls, s[key]);
    if (s.enabled && s.hideTrending) styleSearch();
  });
})();
