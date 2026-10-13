// Assertions for the hide-clutter unit (clutter.js + its content.css rules), on fixtures shaped like
// real Reddit markup (checked on www.reddit.com 2026-10-12). Run: `await window.__clTest()`.
window.__clTest = async () => {
  const RF = window.RedditFlex, html = document.documentElement;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const errorsBefore = window.__errors.length;
  const KEYS = ['hidePromoted', 'hideUpsells', 'hideRecommended', 'hideTrending', 'hideAwards'];
  const set = async patch => { await RF.save({...(await RF.read()), ...patch}); await sleep(100); };
  const all = on => Object.fromEntries(KEYS.map(k => [k, on]));
  const hidden = el => getComputedStyle(el).display === 'none';
  const main = document.getElementById('main-content');

  // 0. Settings
  ok('all clutter options default off', KEYS.every(k => RF.defaults[k] === false));
  ok('they normalize as booleans', RF.normalize({hideAwards: 'yes', hidePromoted: true}).hideAwards === false && RF.normalize({hidePromoted: true}).hidePromoted === true);

  // Fixtures
  const box = document.createElement('div');
  box.innerHTML = `
    <shreddit-feed id="cl-home" reload-url="/svc/shreddit/feeds/home-feed?sort=BEST">
      <article><shreddit-post id="t3_clsub" user-logged-in is-subscribed="" view-context="AggregateFeed" post-title="joined">joined</shreddit-post></article><hr id="cl-hr1">
      <article><shreddit-post id="t3_clrec" user-logged-in view-context="AggregateFeed" post-title="recommended">recommended</shreddit-post></article><hr id="cl-hr2">
      <shreddit-ad-post id="cl-ad">ad</shreddit-ad-post><hr id="cl-hr3">
      <article><shreddit-post id="t3_clout" view-context="AggregateFeed" post-title="logged out">logged out</shreddit-post></article><hr id="cl-hr4">
    </shreddit-feed>
    <shreddit-feed id="cl-out" reload-url="/svc/shreddit/feeds/popular-feed?sort=BEST">
      <article><shreddit-post id="t3_clhomeout" view-context="AggregateFeed" post-title="logged-out home">logged-out home</shreddit-post></article><hr>
    </shreddit-feed>
    <shreddit-feed id="cl-sub" reload-url="/svc/shreddit/community-more-posts/hot/?name=cats">
      <article><shreddit-post id="t3_clsubfeed" user-logged-in view-context="SubredditFeed" post-title="sub feed">sub feed</shreddit-post></article><hr id="cl-hr5">
    </shreddit-feed>
    <shreddit-sidebar-ad id="cl-sad">ad</shreddit-sidebar-ad>
    <shreddit-comments-page-ad id="cl-cpad">ad</shreddit-comments-page-ad>
    <shreddit-comment-tree-ads id="cl-ctads"><shreddit-comment-tree-ad>ad</shreddit-comment-tree-ad></shreddit-comment-tree-ads>
    <advertise-button id="cl-adv"><a id="advertise-button" href="https://ads.reddit.com/register">Advertise</a></advertise-button>
    <ul><faceplate-tracker id="cl-advm" noun="advertise_menu"><li>Advertise</li></faceplate-tracker>
      <faceplate-tracker id="cl-pro" noun="reddit_pro_menu"><li>Reddit Pro</li></faceplate-tracker>
      <faceplate-tracker id="cl-prem" noun="premium_menu"><li>Premium</li></faceplate-tracker>
      <faceplate-tracker id="cl-pop" noun="popular"><li>Popular</li></faceplate-tracker></ul>
    <shreddit-comment author="x" depth="0"><details open><summary>x</summary><div><div slot="comment">hi</div>
      <shreddit-comment-action-row><award-button id="cl-award" slot="comment-award">Award</award-button><button id="cl-reply">Reply</button></shreddit-comment-action-row></div></details></shreddit-comment>`;
  main.append(box);
  const $ = id => document.getElementById(id);
  const post = id => $(id).closest('article');

  // The search box: an open shadow root holding the empty-box dropdown (Recent, Trending, Trending
  // Communities as one flat list) and the typed-results list, which reuses the communities id.
  const search = document.createElement('reddit-search-large');
  const sr = search.attachShadow({mode: 'open'});
  sr.innerHTML = `<input id="cl-q">
    <ul id="reddit-trending-searches-partial-container"><div>
      <div id="section_0_pipeline_0_recent_query">Recent</div>
      <faceplate-loader></faceplate-loader><div class="cl-recent"><search-telemetry-tracker><recent-search-item>old search</recent-search-item></search-telemetry-tracker></div>
      <div id="section_0_pipeline_1_trending_query">Trending</div>
      <faceplate-loader></faceplate-loader><li role="presentation" class="cl-trend">Trending thing</li>
      <div id="subreddit_typeahead_section">Trending Communities</div>
      <search-telemetry-tracker class="cl-tcomm"><li>r/news</li></search-telemetry-tracker>
      <div class="cl-recent2"><recent-search-item>search after trending</recent-search-item></div>
    </div></ul>
    <div id="reddit-typeahead-results-partial-container"><div id="subreddit_typeahead_section" class="cl-typed">Communities</div>
      <search-telemetry-tracker class="cl-typedres"><li>r/cats</li></search-telemetry-tracker></div>`;
  const s$ = sel => sr.querySelector(sel);

  // 1. Everything off: nothing hidden
  await set(all(false));
  const everything = ['cl-ad', 'cl-hr3', 'cl-sad', 'cl-cpad', 'cl-ctads', 'cl-adv', 'cl-advm', 'cl-pro', 'cl-prem', 'cl-award'];
  ok('with every option off nothing is hidden', everything.every(id => !hidden($(id))) && !hidden(post('t3_clrec')), everything.filter(id => hidden($(id))));
  const CLASSES = ['rf-hide-promoted', 'rf-hide-upsells', 'rf-hide-recommended', 'rf-hide-trending', 'rf-hide-awards'];
  ok('no clutter classes on html', CLASSES.every(c => !html.classList.contains(c)), html.className);

  // 2. Promoted
  await set({hidePromoted: true});
  ok('promoted classes follow the setting', html.classList.contains('rf-hide-promoted') && !html.classList.contains('rf-hide-awards'));
  ok('feed ads and the divider after them are hidden', hidden($('cl-ad')) && hidden($('cl-hr3')));
  ok('the divider before an ad stays', !hidden($('cl-hr2')));
  ok('sidebar and comment-thread ads are hidden', hidden($('cl-sad')) && hidden($('cl-cpad')) && hidden($('cl-ctads')));
  ok('ordinary posts stay', !hidden(post('t3_clsub')) && !hidden(post('t3_clrec')));
  await set({hidePromoted: false});
  ok('switching it off shows ads again', !hidden($('cl-ad')) && !hidden($('cl-sad')));

  // 3. Upsells
  await set({hideUpsells: true});
  ok('Advertise, Reddit Pro and Premium are hidden', ['cl-adv', 'cl-advm', 'cl-pro', 'cl-prem'].every(id => hidden($(id))));
  ok('other nav items stay', !hidden($('cl-pop')));
  await set({hideUpsells: false});

  // 4. Recommended (home feed only, logged in only)
  await set({hideRecommended: true});
  ok('a recommended home post is hidden with its divider', hidden(post('t3_clrec')) && hidden($('cl-hr2')));
  ok('posts from joined communities stay', !hidden(post('t3_clsub')) && !hidden($('cl-hr1')));
  ok('logged out, home posts are never hidden', !hidden(post('t3_clout')));
  // Real logged-out Reddit: the home page's feed is the popular-feed and posts have no user-logged-in.
  ok('the real logged-out home feed is untouched', !hidden(post('t3_clhomeout')));
  ok('other feeds are untouched', !hidden(post('t3_clsubfeed')));
  // keyboard.js skips posts without a layout box, as it does for filtered ones.
  ok('a hidden post has no layout box', $('t3_clrec').getClientRects().length === 0);
  await set({hideRecommended: false});
  ok('switching it off shows them again', !hidden(post('t3_clrec')));

  // 5. Trending in search: styled lazily, through the shadow root
  await set({hideTrending: true});
  ok('no search box yet: nothing to style, no error', !sr.getElementById('rf-search-style'));
  main.append(search);
  ok('a search box that appears later is not styled before it is used', !sr.getElementById('rf-search-style'));
  // The preview pane has no window focus, so .focus() fires no events; send the one the browser would.
  const focusSearch = () => sr.getElementById('cl-q').dispatchEvent(new FocusEvent('focusin', {bubbles: true, composed: true}));
  focusSearch(); await sleep(50);
  ok('focusing the search box adds the style once', sr.querySelectorAll('#rf-search-style').length === 1);
  focusSearch(); await sleep(50);
  ok('...and only once', sr.querySelectorAll('#rf-search-style').length === 1);
  ok('the Trending heading and its items are hidden', hidden(s$('#section_0_pipeline_1_trending_query')) && hidden(s$('.cl-trend')));
  ok('Trending Communities and its items are hidden', hidden(s$('#reddit-trending-searches-partial-container #subreddit_typeahead_section')) && hidden(s$('.cl-tcomm')));
  ok('Recent stays, wherever it is in the list', !hidden(s$('#section_0_pipeline_0_recent_query')) && !hidden(s$('.cl-recent')) && !hidden(s$('.cl-recent2')));
  ok('typed results keep their Communities', !hidden(s$('.cl-typed')) && !hidden(s$('.cl-typedres')));
  await set({hideTrending: false});
  ok('switching it off shows Trending again', !hidden(s$('.cl-trend')) && !hidden(s$('#section_0_pipeline_1_trending_query')));

  // 6. Awards
  await set({hideAwards: true});
  ok('the Award button under comments is hidden', hidden($('cl-award')));
  ok('the rest of the action row stays', !hidden($('cl-reply')));
  await set({hideAwards: false});

  // 7. The master switch turns everything off
  await set({...all(true), enabled: false});
  ok('with Reddit Flex off nothing is hidden', everything.every(id => !hidden($(id))) && !hidden(post('t3_clrec')) && !hidden(s$('.cl-trend')), everything.filter(id => hidden($(id))));
  await set({enabled: true});
  ok('back on, it all hides again', everything.every(id => hidden($(id))) && hidden(post('t3_clrec')) && hidden(s$('.cl-trend')));

  await set(all(false));
  box.remove(); search.remove();
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
