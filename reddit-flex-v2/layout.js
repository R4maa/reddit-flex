/* Feed column width: drag rails on both sides of the middle column. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfLayout) return;
  window.__rfLayout = true;

  const RF = RedditFlex;
  const html = document.documentElement;
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  let s = {...RF.defaults}, main = null, raf = 0, dragging = false, animTimer = 0, pillTimer = 0;

  const host = document.createElement('div');
  host.id = 'rf-layout-ui';
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482000;';
  const ui = host.attachShadow({mode: 'open'});
  ui.innerHTML = `<style>
    :host { all: initial; }
    .rail { position: fixed; top: 0; width: 16px; margin-left: -8px; pointer-events: auto; cursor: col-resize; touch-action: none; outline: none; }
    .rail::before { content: ''; position: absolute; left: 7px; top: 0; bottom: 0; width: 2px; border-radius: 2px; background: #ff4500; opacity: 0; transition: opacity .18s; }
    .rail::after { content: ''; position: absolute; left: 5px; top: 50%; width: 6px; height: 46px; margin-top: -23px; border-radius: 6px; background: #ff4500; opacity: .22; transition: opacity .18s, transform .18s; }
    .rail:hover::before, .rail.active::before, .rail:focus-visible::before { opacity: .5; }
    .rail:hover::after, .rail.active::after, .rail:focus-visible::after { opacity: 1; transform: scaleY(1.2); }
    #pill { position: fixed; transform: translate(-50%, -50%); padding: 6px 11px; border-radius: 999px; background: rgba(20,20,22,.92); color: #fff; font: 600 12px/1 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.35); pointer-events: none; opacity: 0; transition: opacity .15s; white-space: nowrap; }
    #pill.show { opacity: 1; }
    :host-context(html.rf-media-active) .rail:not(.active) { opacity: 0; pointer-events: none; }
    .rail { transition: opacity .15s; }
    [hidden] { display: none !important; }
  </style>
  <div class="rail" data-side="left" tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize feed column" title="Drag to resize the feed · double-click to reset" hidden></div>
  <div class="rail" data-side="right" tabindex="0" role="separator" aria-orientation="vertical" aria-label="Resize feed column" title="Drag to resize the feed · double-click to reset" hidden></div>
  <div id="pill"></div>`;
  html.append(host);
  const rails = [...ui.querySelectorAll('.rail')];
  const pill = ui.getElementById('pill');
  const ro = new ResizeObserver(() => place());

  function setWidthVar(w) { html.style.setProperty('--rf-width', `${w}px`); }

  function animateLayout() {
    html.classList.add('rf-animate');
    clearTimeout(animTimer);
    animTimer = setTimeout(() => html.classList.remove('rf-animate'), 450);
  }

  // The page type picks the width when "Width per page type" is on. Reddit changes pages without
  // reloading, so place() (run on clicks, history changes and DOM churn) checks the path again.
  let pathOverride = null; // test harness only
  const pageType = () => RF.pageType(pathOverride ?? location.pathname);
  let type = pageType();
  const width = () => RF.widthFor(s, type);

  function checkPage() {
    const next = pageType();
    if (next === type) return;
    const before = width();
    type = next;
    if (dragging || width() === before) return;
    if (s.enabled && Math.abs(width() - before) > 60) animateLayout();
    setWidthVar(width());
  }

  function apply(next) {
    const prev = s, first = !apply.done;
    apply.done = true;
    s = next;
    if (!first && !dragging && prev.enabled && s.enabled && (Math.abs(RF.widthFor(prev, type) - width()) > 60 || prev.hideRight !== s.hideRight || prev.hideLeft !== s.hideLeft)) animateLayout();
    html.classList.toggle('rf-enabled', s.enabled);
    html.classList.toggle('rf-hide-right', s.hideRight);
    html.classList.toggle('rf-hide-left', s.hideLeft);
    html.style.setProperty('--rf-right', s.hideRight ? '0px' : '340px');
    if (!dragging) setWidthVar(width());
    place();
  }

  function place() {
    checkPage();
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const m = document.getElementById('main-content');
      if (m !== main) {
        if (main) ro.unobserve(main);
        main = m;
        if (main) ro.observe(main);
      }
      const r = main?.getBoundingClientRect();
      const ok = s.enabled && r && r.width > 100 && innerWidth >= 960 && !document.fullscreenElement &&
        !document.querySelector('dialog[open]') && !RF.isCovered(main); // e.g. Reddit's image viewer
      for (const rail of rails) rail.hidden = !ok;
      if (!ok) return;
      const top = RF.headerBottom();
      const height = `${innerHeight - top}px`;
      Object.assign(rails[0].style, {left: `${r.left - 8}px`, top: `${top}px`, height});
      Object.assign(rails[1].style, {left: `${r.right + 8}px`, top: `${top}px`, height});
    });
  }

  function showPill(text, x, y) {
    pill.textContent = text;
    pill.style.left = `${clamp(x, 50, innerWidth - 50)}px`;
    pill.style.top = `${y}px`;
    pill.classList.add('show');
    clearTimeout(pillTimer);
  }
  function hidePill(delay = 0) {
    clearTimeout(pillTimer);
    pillTimer = setTimeout(() => pill.classList.remove('show'), delay);
  }

  // Saves a new width for this page's type (per-page mode) or for every page.
  function commit(w, animate) {
    w = clamp(Math.round(w), RF.MIN_W, RF.MAX_W);
    s = s.widthPerPage ? {...s, widths: {...s.widths, [type]: w}} : {...s, width: w};
    if (animate) animateLayout();
    setWidthVar(w);
    RF.save(s);
    place();
  }

  for (const rail of rails) {
    const side = rail.dataset.side;
    const edge = () => {
      const r = main.getBoundingClientRect();
      return side === 'right' ? r.right : r.left;
    };

    rail.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !main) return;
      e.preventDefault();
      rail.setPointerCapture(e.pointerId);
      dragging = true;
      rail.classList.add('active');
      html.classList.add('rf-dragging');
      html.classList.remove('rf-animate');

      // Measure how far the edge moves per pixel of width, so the edge tracks the cursor
      // whether the column is centered alone, centered with a sidebar, or squeezed.
      const startW = main.getBoundingClientRect().width;
      setWidthVar(startW); const e0 = edge();
      setWidthVar(startW + 40); const e1 = edge();
      setWidthVar(startW);
      let factor = Math.abs(e1 - e0) / 40;
      if (!(factor > 0.15)) factor = 0.5;

      const sign = side === 'right' ? 1 : -1;
      const x0 = e.clientX;
      let w = startW;
      const move = m => {
        w = clamp(Math.round(startW + sign * (m.clientX - x0) / factor), RF.MIN_W, RF.MAX_W);
        setWidthVar(w);
        showPill(`${w}px`, m.clientX, m.clientY - 28);
        place();
      };
      const end = () => {
        rail.removeEventListener('pointermove', move);
        rail.removeEventListener('pointerup', end);
        rail.removeEventListener('pointercancel', end);
        dragging = false;
        rail.classList.remove('active');
        html.classList.remove('rf-dragging');
        hidePill(500);
        // If the window can't fit the requested width, remember what actually fits.
        const actual = Math.round(main?.getBoundingClientRect().width || w);
        commit(actual < w - 4 ? actual : w, false);
      };
      rail.addEventListener('pointermove', move);
      rail.addEventListener('pointerup', end);
      rail.addEventListener('pointercancel', end);
    });

    rail.addEventListener('dblclick', () => {
      commit(RF.defaults.width, true);
      const r = rail.getBoundingClientRect();
      showPill(`${RF.defaults.width}px`, r.left + 8, innerHeight / 2);
      hidePill(900);
    });

    rail.addEventListener('keydown', e => {
      const step = e.shiftKey ? 100 : 20;
      const grow = side === 'right' ? 'ArrowRight' : 'ArrowLeft';
      const shrink = side === 'right' ? 'ArrowLeft' : 'ArrowRight';
      let w = null;
      if (e.key === grow) w = width() + step;
      else if (e.key === shrink) w = width() - step;
      else if (e.key === 'Home') w = RF.MIN_W;
      else if (e.key === 'End') w = RF.MAX_W;
      if (w == null) return;
      e.preventDefault();
      commit(w, true);
      const r = rail.getBoundingClientRect();
      showPill(`${width()}px`, r.left + 8, innerHeight / 2);
      hidePill(700);
    });
  }

  let mutationTimer = 0;
  new MutationObserver(() => {
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => { mutationTimer = 0; place(); }, 200);
  }).observe(document.body, {childList: true, subtree: true});
  addEventListener('resize', place);
  // Overlays like the image viewer open/close on click or Escape; re-check once they've rendered.
  const recheck = () => { place(); setTimeout(place, 120); setTimeout(place, 400); };
  addEventListener('click', recheck, true);
  addEventListener('keyup', e => { if (e.key === 'Escape') recheck(); }, true);
  addEventListener('popstate', recheck);
  document.addEventListener('fullscreenchange', place);

  globalThis.RedditFlexLayout = {
    pageType: () => type,
    width,
    _test: {setPath(p) { pathOverride = p; place(); }},
  };

  RF.subscribe(apply);
})();
