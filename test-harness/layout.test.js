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

  // Clean up
  await nav(null);
  await RF.save(start); await sleep(80);
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
