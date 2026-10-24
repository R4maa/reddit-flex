// Assertions for unit 6 (layout.js width per page type, settings pageType/widthFor/normalize).
// The harness page can't change its pathname, so RedditFlexLayout._test.setPath stands in for
// Reddit's in-page navigation. Run: `await window.__lyTest()`.
window.__lyTest = async () => {
  const RF = window.RedditFlex, L = window.RedditFlexLayout;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const errorsBefore = window.__errors.length;
  const html = document.documentElement;
  const cssWidth = () => parseFloat(html.style.getPropertyValue('--rf-width'));
  const stored = async () => (await chrome.storage.local.get('redditFlex')).redditFlex || {};
  const set = async patch => { await RF.save({...(await RF.read()), ...patch}); await sleep(80); };
  const nav = async path => { L._test.setPath(path); await sleep(50); };
  const rails = [...document.getElementById('rf-layout-ui').shadowRoot.querySelectorAll('.rail')];
  const key = (rail, k) => rail.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, composed: true, cancelable: true}));
  const start = await RF.read();

  // 0. Page types and settings
  const cases = {
    '/': 'home', '/best/': 'home', '/new': 'home', '/r/popular/': 'home', '/r/all/top/': 'home',
    '/r/pics/': 'subreddit', '/r/pics/new/': 'subreddit', '/r/Pics': 'subreddit', '/r/pics/wiki/index': 'subreddit',
    '/r/pics/comments/abc123/a_title/': 'post', '/comments/abc123': 'post', '/user/bob/comments/x1/y/': 'post', '/r/popular/comments/z9/': 'post',
    '/user/bob/': 'other', '/search/?q=x': 'other', '/settings/': 'other', '/r/': 'other', '/newsfeed': 'other', '': 'home',
  };
  const wrong = Object.entries(cases).filter(([p, t]) => RF.pageType(p) !== t).map(([p, t]) => [p, RF.pageType(p), t]);
  ok('paths are sorted into home, subreddit, post and other', !wrong.length, wrong);
  ok('per-page widths are off by default, every type at 900', RF.defaults.widthPerPage === false && RF.PAGE_TYPES.every(t => RF.defaults.widths[t] === 900));
  const n = RF.normalize({widths: {home: 99999, subreddit: 'x', post: 1000.4}});
  ok('stored widths are clamped and repaired', n.widths.home === RF.MAX_W && n.widths.subreddit === 900 && n.widths.post === 1000 && n.widths.other === 900, n.widths);
  ok('widthFor picks the global or the per-type width', RF.widthFor({width: 700, widthPerPage: false, widths: {post: 1300}}, 'post') === 700 && RF.widthFor({width: 700, widthPerPage: true, widths: {post: 1300}}, 'post') === 1300);

  // 1. Off: one width everywhere, as before
  await set({enabled: true, width: 800, widthPerPage: false, widths: {home: 1000, subreddit: 1200, post: 1400, other: 600}});
  await nav('/r/pics/');
  ok('off: the column uses the global width', cssWidth() === 800 && L.pageType() === 'subreddit', [cssWidth(), L.pageType()]);
  await nav('/r/pics/comments/abc/x/');
  ok('off: moving to a post keeps it', cssWidth() === 800 && L.pageType() === 'post');
  key(rails[1], 'ArrowRight'); await sleep(80);
  let st = await stored();
  ok('off: a rail changes the global width only', st.width === 820 && st.widths.post === 1400 && cssWidth() === 820, [st.width, st.widths]);

  // 2. On: each page type has its own width, following in-page navigation
  await set({widthPerPage: true});
  ok('on: the current page type\'s width applies at once', cssWidth() === 1400, cssWidth());
  await nav('/');
  ok('navigating home switches to the home width', cssWidth() === 1000 && L.pageType() === 'home', cssWidth());
  ok('...animating a big change', html.classList.contains('rf-animate'));
  await nav('/r/pics/');
  ok('...and to a subreddit, its width', cssWidth() === 1200);
  await nav('/search/?q=cats');
  ok('...and to another page, the other width', cssWidth() === 600);
  await nav('/r/pics/comments/abc/x/');
  ok('...and back to a post', cssWidth() === 1400);

  // 3. On: rails save to the current type only
  key(rails[1], 'ArrowLeft'); await sleep(80);
  st = await stored();
  ok('on: a rail saves this type\'s width', st.widths.post === 1380 && cssWidth() === 1380, st.widths);
  ok('...leaving the other types and the global width alone', st.widths.home === 1000 && st.widths.subreddit === 1200 && st.widths.other === 600 && st.width === 820, st);
  key(rails[1], 'ArrowRight'); key(rails[1], 'ArrowRight'); await sleep(80);
  st = await stored();
  ok('growing works from this type\'s width too', st.widths.post === 1420 && cssWidth() === 1420 && st.width === 820, [st.widths.post, st.width]);
  rails[0].dispatchEvent(new MouseEvent('dblclick', {bubbles: true, composed: true})); await sleep(80);
  st = await stored();
  ok('double-click resets just this type', st.widths.post === RF.defaults.width && st.widths.home === 1000 && cssWidth() === RF.defaults.width, st.widths);
  // A drag: the edge follows the pointer and the result goes to this type.
  await nav('/r/pics/');
  const main = document.getElementById('main-content'), rail = rails[1];
  rail.hidden = false;
  const rr = main.getBoundingClientRect(), po = {bubbles: true, composed: true, pointerId: 7, button: 0, isPrimary: true};
  rail.setPointerCapture = () => {};
  rail.dispatchEvent(new PointerEvent('pointerdown', {...po, clientX: rr.right + 8, clientY: 300}));
  rail.dispatchEvent(new PointerEvent('pointermove', {...po, clientX: rr.right - 92, clientY: 300}));
  rail.dispatchEvent(new PointerEvent('pointerup', {...po, clientX: rr.right - 92, clientY: 300}));
  await sleep(80);
  st = await stored();
  document.documentElement.classList.add('rf-media-active'); await sleep(250);
  ok('the rails step aside while media is hovered', getComputedStyle(rail).pointerEvents === 'none' && getComputedStyle(rail).opacity === '0', [getComputedStyle(rail).pointerEvents, getComputedStyle(rail).opacity]);
  document.documentElement.classList.remove('rf-media-active'); await sleep(250);
  ok('...and come back after', getComputedStyle(rail).pointerEvents === 'auto' && getComputedStyle(rail).opacity === '1', [getComputedStyle(rail).pointerEvents, getComputedStyle(rail).opacity]);
  ok('a drag saves to this type too', st.widths.subreddit < 1200 && st.widths.subreddit === cssWidth() && st.widths.home === 1000 && st.width === 820, [st.widths, cssWidth()]);

  // 4. Changes from the popup (or another tab) apply live to the matching type
  await set({widths: {...(await stored()).widths, subreddit: 1111}});
  ok('a new width for this type shows at once', cssWidth() === 1111);
  await set({widths: {...(await stored()).widths, home: 777}});
  ok('a new width for another type does not', cssWidth() === 1111);
  await nav('/');
  ok('...until you go there', cssWidth() === 777);

  // 5. Off again: back to the global width, per-type widths kept for later
  await set({widthPerPage: false});
  st = await stored();
  ok('switching off goes back to the global width', cssWidth() === 820 && st.widths.home === 777);
  await nav('/r/pics/');
  ok('...on every page type', cssWidth() === 820);

  // 6. Feed position: the feed on one side, the sidebars wrapped to the other
  ok('the feed is centered by default', RF.defaults.feedPosition === 'center' && RF.normalize({feedPosition: 'top'}).feedPosition === 'center' && RF.normalize({feedPosition: 'left'}).feedPosition === 'left');
  const leftNav = document.getElementById('flex-left-nav-container'), side = document.getElementById('right-sidebar-container');
  const sub = document.getElementById('subgrid-container');
  const box = el => el.getBoundingClientRect();
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const settle = async patch => { await set(patch); await sleep(450); await frames(); }; // past the glide
  const gap = parseFloat(getComputedStyle(main.parentElement).columnGap), pad = parseFloat(getComputedStyle(sub).paddingLeft);
  const near = (a, b) => Math.abs(a - b) <= 1.5;
  const apart = (...els) => els.every((a, i) => els.slice(i + 1).every(b => box(a).right <= box(b).left + 1 || box(b).right <= box(a).left + 1));
  const where = () => ({main: [box(main).left, box(main).right], nav: [box(leftNav).left, box(leftNav).right], side: [box(side).left, box(side).right]});
  await nav('/r/pics/');
  await settle({widthPerPage: false, width: 600, hideLeft: false, hideRight: false, feedPosition: 'center'});
  const navTop = box(leftNav).top;
  await settle({feedPosition: 'left'});
  ok('left: the nav keeps its place below the header', navTop > 40 && near(box(leftNav).top, navTop), [navTop, box(leftNav).top]);
  ok('left: the feed starts at the left edge', near(box(main).left, box(sub).left + pad) && near(box(sub).left, 0), where());
  ok('...the nav comes next', near(box(leftNav).left, box(main).right + gap) && html.classList.contains('rf-nav-moved'), where());
  ok('...then the right sidebar', near(box(side).left, box(leftNav).right + gap), where());
  ok('...and the pinned edge has no rail', rails[0].hidden, rails.map(r => r.hidden));
  // Reddit collapses the nav by sliding it 240px left (the window edge usually hides the rest).
  leftNav.style.transform = 'translateX(-240px)'; document.body.click(); await sleep(450); await frames();
  const feedHits = [120, 240, 360, 480, 600].map(y => document.elementFromPoint(box(main).right - 100, y));
  ok('a collapsed nav takes only the strip that shows', html.style.getPropertyValue('--rf-nav-w') === '32px' && near(box(side).left, box(leftNav).right + gap), [html.style.getPropertyValue('--rf-nav-w'), where()]);
  ok('...and its hidden part neither covers nor blocks the feed', feedHits.every(el => !leftNav.contains(el)), feedHits.map(el => el?.id || el?.tagName));
  leftNav.style.transform = ''; document.body.click(); await sleep(450); await frames();
  ok('opened again, it takes its full column', html.style.getPropertyValue('--rf-nav-w') === '272px' && near(box(side).left, box(leftNav).right + gap), where());
  // Dragging the right rail still resizes, and the nav follows the feed's edge.
  const rail1 = rails[1];
  rail1.hidden = false;
  const r1 = box(main);
  rail1.dispatchEvent(new PointerEvent('pointerdown', {...po, clientX: r1.right + 8, clientY: 300}));
  rail1.dispatchEvent(new PointerEvent('pointermove', {...po, clientX: r1.right + 108, clientY: 300}));
  rail1.dispatchEvent(new PointerEvent('pointerup', {...po, clientX: r1.right + 108, clientY: 300}));
  await sleep(80); await frames();
  st = await stored();
  ok('left: a rail drag resizes the feed', st.width >= 690 && st.width <= 710 && near(box(main).width, st.width), [st.width, box(main).width]);
  ok('...and the nav follows it', near(box(leftNav).left, box(main).right + gap), where());

  await set({feedPosition: 'right'});
  ok('a new side snaps into place, without the glide', !html.classList.contains('rf-animate') && near(box(leftNav).right + gap, box(side).left) && near(box(side).right + gap, box(main).left), [html.className, where()]);
  await settle({width: 600});
  // Switching sides in the middle of a glide (here a new width) stops the glide at once.
  await set({width: 1000});
  const midGlide = html.classList.contains('rf-animate');
  await set({feedPosition: 'left'});
  const snapped = box(main).width;
  await sleep(450);
  ok('a new side mid-glide snaps too, with the nav already beside the feed', midGlide && !html.classList.contains('rf-animate') && near(box(leftNav).left, box(main).right + gap) && near(box(main).width, snapped), [midGlide, snapped, html.className, where()]);
  await settle({width: 600, feedPosition: 'right'});
  ok('right: the feed ends at the right edge', near(box(main).right, box(sub).right - pad) && near(box(sub).right, html.clientWidth), [where(), html.clientWidth]);
  ok('...after the nav and the right sidebar', near(box(side).right + gap, box(main).left) && near(box(leftNav).right + gap, box(side).left), where());
  ok('...and the pinned edge has no rail', rails[1].hidden, rails.map(r => r.hidden));

  await settle({hideRight: true});
  ok('right, no right sidebar: nav then feed', near(box(leftNav).right + gap, box(main).left) && near(box(main).right, box(sub).right - pad), where());
  await settle({feedPosition: 'left'});
  ok('left, no right sidebar: feed then nav', near(box(leftNav).left, box(main).right + gap) && near(box(main).left, pad), where());
  await settle({hideRight: false, hideLeft: true});
  ok('left, no nav: feed then sidebar, nothing moved', !html.classList.contains('rf-nav-moved') && !html.style.getPropertyValue('--rf-nav-x') && near(box(side).left, box(main).right + gap) && near(box(main).left, pad), where());
  await settle({feedPosition: 'right'});
  ok('right, no nav: sidebar then feed', near(box(side).right + gap, box(main).left) && apart(main, side), where());

  // Reddit hides the nav's column in narrower windows (below 1200px). It must stay hidden, with
  // no column kept for it.
  await settle({hideLeft: false, feedPosition: 'left'});
  const navCol = document.getElementById('left-sidebar-container');
  navCol.style.display = 'none'; dispatchEvent(new Event('resize')); await frames(); await frames();
  ok('a nav Reddit hides stays hidden, and gets no column', !leftNav.getClientRects().length && !html.classList.contains('rf-nav-moved') && near(box(side).left, box(main).right + gap), [html.className, where()]);
  navCol.style.display = ''; dispatchEvent(new Event('resize')); await frames(); await frames();
  ok('...and comes back beside the feed when Reddit shows it again', html.classList.contains('rf-nav-moved') && near(box(leftNav).left, box(main).right + gap), where());

  // Some pages (Explore, Settings) have no right sidebar, and other items in its place.
  const extra = document.createElement('div');
  extra.textContent = 'footer links';
  side.replaceWith(extra);
  dispatchEvent(new Event('resize')); await frames(); await frames();
  ok('no sidebar on the page: left keeps feed then nav, and nothing goes under the nav', html.classList.contains('rf-no-side') && near(box(leftNav).left, box(main).right + gap) && box(extra).top >= box(main).bottom - 1 && near(box(extra).left, box(main).left), [html.className, where(), [box(extra).left, box(extra).top], box(main).bottom]);
  await settle({feedPosition: 'right'});
  ok('...and right puts the nav straight before the feed', near(box(leftNav).right + gap, box(main).left) && near(box(main).right, box(sub).right - pad) && box(extra).top >= box(main).bottom - 1 && near(box(extra).left, box(main).left), [where(), [box(extra).left, box(extra).top]]);
  extra.replaceWith(side);
  dispatchEvent(new Event('resize')); await frames(); await frames();
  ok('...and the sidebar column comes back with the sidebar', !html.classList.contains('rf-no-side') && near(box(leftNav).right + gap, box(side).left) && near(box(side).right + gap, box(main).left), where());

  // A page with Reddit's grid but no feed (#main-content) is left as Reddit lays it out.
  await settle({feedPosition: 'left'});
  const stub = document.createElement('div');
  main.replaceWith(stub);
  dispatchEvent(new Event('resize')); await frames(); await frames();
  ok('no feed on the page: nothing is rearranged, and nothing slides under the nav', !html.classList.contains('rf-nav-moved') && getComputedStyle(leftNav).left === '0px' && box(sub).left >= box(leftNav).right - 1, [html.className, box(sub).left, box(leftNav).right]);
  stub.replaceWith(main);
  dispatchEvent(new Event('resize')); await frames(); await frames();
  ok('...and the feed goes to its side again when it is back', html.classList.contains('rf-nav-moved') && near(box(main).left, box(sub).left + pad) && near(box(leftNav).left, box(main).right + gap), where());

  // A post page's back arrow sits 40px left of the post (Reddit positions it there).
  const post = main.querySelector('article'), back = document.createElement('pdp-back-button');
  back.style.cssText = 'position: absolute; left: -40px; top: 0; width: 32px; height: 32px; display: block;';
  post.style.position = 'relative'; post.prepend(back);
  await settle({width: 600, feedPosition: 'left'});
  ok('post page, left: the back arrow stays in the window, the feed keeps its width', box(back).width === 32 && box(back).left >= 0 && near(box(main).width, 600) && near(box(leftNav).left, box(main).right + gap), [box(back).left, box(main).width, where()]);
  await settle({feedPosition: 'right'});
  ok('post page, right: the back arrow clears the sidebar', box(back).width === 32 && box(back).left >= box(side).right + gap - 1 && near(box(main).width, 600) && near(box(main).right, box(sub).right - pad), [box(back).left, box(side).right, box(main).width]);
  // With the nav hidden there's no nav column, and the room still comes on top of the set width.
  await settle({feedPosition: 'left', hideLeft: true});
  ok('post page, nav hidden, left: the feed keeps its width too', box(back).width === 32 && box(back).left >= 0 && near(box(main).width, 600) && near(box(side).left, box(main).right + gap), [box(back).left, box(main).width, where()]);
  await settle({feedPosition: 'right'});
  ok('post page, nav hidden, right: the same', box(back).left >= box(side).right + gap - 1 && near(box(main).width, 600), [box(back).left, box(side).right, box(main).width]);
  await settle({hideLeft: false});
  back.remove(); post.style.position = '';
  await settle({feedPosition: 'left'});
  ok('...and other pages get no extra room', near(box(main).left, box(sub).left + pad), where());

  await settle({hideLeft: false, feedPosition: 'center'});
  ok('center again: the nav goes home', getComputedStyle(leftNav).left === '0px' && !html.classList.contains('rf-nav-moved') && !html.style.getPropertyValue('--rf-nav-w') && !html.style.getPropertyValue('--rf-nav-x'), [getComputedStyle(leftNav).left, html.className]);
  ok('...and the feed sits right of it, before its sidebar', box(main).left >= box(leftNav).right && near(box(side).left, box(main).right + gap), where());

  // Clean up
  await nav(null);
  await RF.save(start); await sleep(80);
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
