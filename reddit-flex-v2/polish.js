/* Small things: a back-to-top button, a header that scrolls away, exact times on hover. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfPolish) return;
  window.__rfPolish = true;

  const RF = RedditFlex;
  const html = document.documentElement;
  let s = {...RF.defaults, enabled: false};

  // ---- back to top ------------------------------------------------------------------------
  const host = document.createElement('div');
  host.id = 'rf-top-ui';
  host.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:2147481000;';
  const ui = host.attachShadow({mode: 'open'});
  ui.innerHTML = `<style>
    :host { all: initial; }
    button { all: unset; box-sizing: border-box; display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
      background: rgba(18,18,20,.84); color: #fff; font: 600 18px/1 system-ui, sans-serif; box-shadow: 0 2px 14px rgba(0,0,0,.4); }
    button:hover, button:focus-visible { background: #ff4500; }
    [hidden] { display: none !important; }
  </style>
  <button id="top" title="Back to top" aria-label="Back to top" hidden>↑</button>`;
  html.append(host);
  const top = ui.getElementById('top');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  top.addEventListener('click', () => scrollTo({top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth'}));
  // Shown once you are a screen and a half down.
  const showTop = () => { top.hidden = !(s.enabled && s.scrollToTop && scrollY > innerHeight * 1.5); };

  // ---- header that scrolls away -----------------------------------------------------------
  // Reddit's left navigation is fixed just below the header; it follows the header's visible
  // bottom edge instead, so no empty strip is left once the header has scrolled off.
  const headerOff = () => s.enabled && s.unstickHeader;
  const followHeader = () => { if (headerOff()) html.style.setProperty('--rf-head', `${RF.headerBottom()}px`); };

  const onScroll = () => { showTop(); followHeader(); };
  addEventListener('scroll', onScroll, {passive: true});
  addEventListener('resize', onScroll);

  // ---- exact times ------------------------------------------------------------------------
  // Reddit's own "5 hr. ago" usually has the full date as its title already; ours (inline
  // comments) and any that lack one get it. data-rf-title marks the titles we added.
  const timesOn = () => s.enabled && s.exactTimes;
  function fullDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {dateStyle: 'full', timeStyle: 'long'});
  }
  function addTitles() {
    if (!timesOn()) return;
    for (const t of document.querySelectorAll('time[datetime]:not([title])')) {
      const text = fullDate(t.getAttribute('datetime'));
      if (text) { t.title = text; t.setAttribute('data-rf-title', ''); }
    }
  }
  function removeTitles() {
    for (const t of document.querySelectorAll('time[data-rf-title]')) { t.removeAttribute('title'); t.removeAttribute('data-rf-title'); }
  }
  let timer = 0;
  new MutationObserver(() => {
    if (timer || !timesOn()) return;
    timer = setTimeout(() => { timer = 0; addTitles(); }, 300);
  }).observe(html, {childList: true, subtree: true});

  RF.subscribe(next => {
    s = next;
    // content.css lets reddit-header-large scroll away with the page.
    html.classList.toggle('rf-unstick-header', headerOff());
    if (timesOn()) addTitles(); else removeTitles();
    onScroll();
  });
})();
