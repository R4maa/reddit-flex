// Assertions for unit 9 (polish.js: back-to-top button, header that scrolls away, exact times).
// Run: `await window.__poTest()`.
window.__poTest = async () => {
  const RF = window.RedditFlex;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (!(await cond()) && Date.now() - t0 < ms) await sleep(30); return cond(); };
  const errorsBefore = window.__errors.length;
  const set = async patch => { await RF.save({...(await RF.read()), ...patch}); await sleep(80); };
  const start = await RF.read();
  const html = document.documentElement;
  const btn = document.getElementById('rf-top-ui').shadowRoot.getElementById('top');
  const header = document.querySelector('reddit-header-large');
  // Scroll and send the scroll event at once (a hidden tab delays it).
  const go = async y => { scrollTo(0, y); dispatchEvent(new Event('scroll')); await sleep(100); };

  ok('defaults: back-to-top and exact times on, header stays', RF.defaults.scrollToTop === true && RF.defaults.exactTimes === true && RF.defaults.unstickHeader === false);
  await set({enabled: true, scrollToTop: true, unstickHeader: false, exactTimes: true});

  // 1. Back to top
  // (Make sure the page is long enough to scroll well past a screen and a half.)
  const filler = document.createElement('div');
  filler.style.height = `${innerHeight * 4}px`;
  document.getElementById('main-content').append(filler);
  await go(0);
  ok('the button is hidden at the top', btn.hidden);
  await go(innerHeight * 2);
  ok('it shows a screen and a half down', !btn.hidden && scrollY > innerHeight * 1.5, scrollY);
  // Something right under the button is not "covered" by it (rails and keys check isCovered).
  const under = document.createElement('div');
  under.style.cssText = 'position:fixed;right:24px;bottom:24px;width:40px;height:40px';
  document.body.append(under);
  ok('the button does not count as covering the page', document.elementFromPoint(html.clientWidth - 44, html.clientHeight - 44)?.id === 'rf-top-ui' && RF.isCovered(under) === false);
  under.remove();
  ok('...in the bottom-right corner, clickable', (() => { const r = btn.getBoundingClientRect(); return r.width === 40 && html.clientWidth - r.right === 24 && html.clientHeight - r.bottom === 24; })(), btn.getBoundingClientRect());
  // (A hidden tab doesn't animate smooth scrolling, so the requested scroll is completed at once.)
  const realScrollTo = window.scrollTo, scrolls = [];
  window.scrollTo = function (...a) { scrolls.push(a[0]); return realScrollTo.apply(this, a[0]?.behavior === 'smooth' ? [{...a[0], behavior: 'instant'}] : a); };
  btn.click(); dispatchEvent(new Event('scroll'));
  window.scrollTo = realScrollTo;
  ok('clicking it scrolls smoothly back to the top', scrolls.some(o => o?.top === 0 && o?.behavior === 'smooth') && await until(() => scrollY === 0), {scrolls, y: scrollY});
  ok('...and it hides again', await until(() => btn.hidden));
  await go(innerHeight * 2);
  await set({scrollToTop: false});
  ok('switched off, it is hidden even far down', btn.hidden);
  await set({scrollToTop: true});
  ok('switched back on, it shows', !btn.hidden);
  await set({enabled: false});
  ok('with Reddit Flex off it is hidden', btn.hidden);
  await set({enabled: true});

  // 2. Header that scrolls away
  // Reddit's left navigation: fixed just below the header (checked on www.reddit.com 2026-10-12).
  const nav = document.createElement('div');
  nav.id = 'flex-left-nav-container';
  nav.style.cssText = 'position:fixed;left:0;top:56px;width:20px;height:calc(100vh - 56px)';
  document.body.append(nav);
  await go(innerHeight * 2);
  ok('(header kept: the nav stays below it)', Math.round(nav.getBoundingClientRect().top) === 56);
  await go(0);
  ok('by default the header keeps Reddit\'s positioning', getComputedStyle(header).position !== 'absolute' && !html.classList.contains('rf-unstick-header'));
  await set({unstickHeader: true});
  ok('on: the header is no longer pinned', html.classList.contains('rf-unstick-header') && getComputedStyle(header).position === 'absolute', getComputedStyle(header).position);
  await go(innerHeight * 2);
  ok('...so it scrolls off and nothing reserves room for it', header.getBoundingClientRect().bottom <= 0 && RF.headerBottom() === 0, [header.getBoundingClientRect().bottom, RF.headerBottom()]);
  const rails = [...document.getElementById('rf-layout-ui').shadowRoot.querySelectorAll('.rail')];
  ok('...the feed rails follow it to the top edge, full height', await until(() => rails.every(r => !r.hidden && parseFloat(r.style.top) === 0 && parseFloat(r.style.height) === innerHeight)), rails.map(r => [r.hidden, r.style.top, r.style.height]));
  ok('...and the left navigation moves up to the top edge, full height', Math.round(nav.getBoundingClientRect().top) === 0 && Math.round(nav.getBoundingClientRect().height) === innerHeight, nav.getBoundingClientRect());
  await go(0);
  ok('...and is back at the top of the page', Math.round(header.getBoundingClientRect().top) === 0 && RF.headerBottom() > 0, header.getBoundingClientRect().top);
  ok('...with the rails just below it again', await until(() => rails.every(r => Math.round(parseFloat(r.style.top)) === Math.round(RF.headerBottom()))), rails.map(r => r.style.top));
  ok('...with the navigation just below it again', Math.round(nav.getBoundingClientRect().top) === Math.round(RF.headerBottom()), [nav.getBoundingClientRect().top, RF.headerBottom()]);
  await set({enabled: false});
  ok('with Reddit Flex off the header is left alone', !html.classList.contains('rf-unstick-header') && getComputedStyle(header).position !== 'absolute');
  await set({enabled: true, unstickHeader: false});
  ok('switched off, it is pinned again', !html.classList.contains('rf-unstick-header'));

  // 3. Exact times
  const iso = '2026-10-12T10:02:39.742Z';
  const expected = new Date(iso).toLocaleString(undefined, {dateStyle: 'full', timeStyle: 'long'});
  const box = document.createElement('div');
  box.innerHTML = `<time id="rf-t1" datetime="${iso}">6 hr. ago</time><time id="rf-t2" datetime="${iso}" title="Reddit's own title">6 hr. ago</time><time id="rf-t3" datetime="not a date">?</time><time id="rf-t4">no datetime</time>`;
  document.getElementById('main-content').append(box);
  const t = id => document.getElementById(id);
  ok('a time without a title gets the full date', await until(() => t('rf-t1').title === expected), [t('rf-t1').title, expected]);
  ok('...naming the year, so it is exact', t('rf-t1').title.includes('2026'));
  ok('Reddit\'s own title is kept', t('rf-t2').title === 'Reddit\'s own title' && !t('rf-t2').hasAttribute('data-rf-title'));
  ok('a broken or missing datetime is left alone', !t('rf-t3').hasAttribute('title') && !t('rf-t4').hasAttribute('title'));
  // Inline comments (accordion.js) render <time datetime> without a title.
  const late = document.createElement('time');
  late.setAttribute('datetime', iso); late.textContent = '6h';
  box.append(late);
  ok('times added later get it too', await until(() => late.title === expected));
  await set({exactTimes: false});
  ok('switched off, only the titles we added are removed', !t('rf-t1').hasAttribute('title') && !late.hasAttribute('title') && t('rf-t2').title === 'Reddit\'s own title');
  const later = document.createElement('time');
  later.setAttribute('datetime', iso);
  box.append(later); await sleep(500);
  ok('...and new ones are left alone', !later.hasAttribute('title'));
  await set({exactTimes: true});
  ok('switched on again, they all get it', t('rf-t1').title === expected && later.title === expected);
  await set({enabled: false});
  ok('with Reddit Flex off the added titles go', !t('rf-t1').hasAttribute('title') && t('rf-t2').title === 'Reddit\'s own title');

  // Clean up
  box.remove(); filler.remove(); nav.remove(); await go(0);
  await RF.save(start); await sleep(100);
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
