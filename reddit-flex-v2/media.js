/* Resize media past the column, or pop it out into a floating window you can drag anywhere. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfMedia) return;
  window.__rfMedia = true;

  const RF = RedditFlex;
  const SEL = '[slot="post-media-container"]';
  const CONTENT = 'shreddit-player,shreddit-player-2,video,img,gallery-carousel,iframe,shreddit-embed';
  const MIN_W = 160, MIN_H = 90, GAP = 12;
  const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));
  const html = document.documentElement;
  const canPopover = typeof HTMLElement.prototype.showPopover === 'function';

  let s = {...RF.defaults}, active = null, floating = null, dragging = false;
  let hideTimer = 0, frame = 0, overlayFloat = null;
  const recs = new Map();

  // Overlay lives in document coordinates so it scrolls with the page without lag.
  const BASE = 'position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;background:none;overflow:visible;pointer-events:none;z-index:2147483000;';
  const host = document.createElement('div');
  host.id = 'rf-media-ui';
  host.style.cssText = BASE;
  const ui = host.attachShadow({mode: 'open'});
  ui.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    #box { position: absolute; pointer-events: none; border-radius: 10px; opacity: 0; transition: opacity .16s; }
    #box.show { opacity: 1; }
    #box.dragging { outline: 2px solid #ff4500; outline-offset: 1px; }
    .h { position: absolute; pointer-events: auto; touch-action: none; padding: 0; background: #fff; border: 3px solid #ff4500; box-shadow: 0 1px 6px rgba(0,0,0,.45); transition: transform .12s; }
    .h:hover, .h:focus-visible { transform: scale(1.25); outline: none; }
    .c { width: 16px; height: 16px; border-radius: 50%; }
    .nw { left: -8px; top: -8px; cursor: nwse-resize; } .ne { right: -8px; top: -8px; cursor: nesw-resize; }
    .sw { left: -8px; bottom: -8px; cursor: nesw-resize; } .se { right: -8px; bottom: -8px; cursor: nwse-resize; }
    .e, .w { top: 50%; width: 9px; height: 46px; margin-top: -23px; border-radius: 6px; cursor: ew-resize; }
    .e { right: -5px; } .w { left: -5px; }
    .e:hover, .w:hover { transform: scaleY(1.15); }
    #bar { position: absolute; left: 50%; top: 8px; transform: translateX(-50%); display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(18,18,20,.84); backdrop-filter: blur(8px); box-shadow: 0 2px 14px rgba(0,0,0,.4); pointer-events: auto; font: 600 12px/1 system-ui, sans-serif; color: #fff; white-space: nowrap; }
    #bar button { all: unset; cursor: pointer; padding: 7px 11px; border-radius: 999px; color: #fff; }
    #bar button:hover, #bar button:focus-visible { background: rgba(255,255,255,.16); }
    #grip { cursor: grab; touch-action: none; }
    #box.dragging #grip { cursor: grabbing; }
    #size { position: absolute; right: 10px; bottom: 12px; padding: 4px 8px; border-radius: 6px; background: rgba(0,0,0,.75); color: #fff; font: 600 11px/1 system-ui, sans-serif; opacity: 0; transition: opacity .15s; }
    #box.dragging #size { opacity: 1; }
    [hidden] { display: none !important; }
  </style>
  <div id="box" hidden>
    <div id="bar">
      <button id="grip" title="Drag to move it anywhere · click to pop out">✥ Move</button>
      <button id="pop" title="Pop out into a floating window">⧉ Pop out</button>
      <button id="dock" title="Put it back in the post" hidden>⤓ Dock</button>
      <button id="reset" title="Original size">↺ Reset</button>
    </div>
    <button class="h c nw" data-dir="nw" aria-label="Resize"></button><button class="h c ne" data-dir="ne" aria-label="Resize"></button>
    <button class="h c sw" data-dir="sw" aria-label="Resize"></button><button class="h c se" data-dir="se" aria-label="Resize"></button>
    <button class="h e" data-dir="e" aria-label="Resize width"></button><button class="h w" data-dir="w" aria-label="Resize width"></button>
    <span id="size"></span>
  </div>`;
  html.append(host);
  const $ = id => ui.getElementById(id);
  const box = $('box');

  // ---- overlay ----------------------------------------------------------------------------
  function setOverlayFloat(fl) {
    if (fl === overlayFloat) return;
    overlayFloat = fl;
    if (canPopover && host.hasAttribute('popover') && host.matches(':popover-open')) host.hidePopover();
    if (fl) {
      host.style.cssText = `${BASE}position:fixed;inset:0;width:auto;height:auto;`;
      // A top-layer floating player would cover a normal element; join the top layer after it.
      if (canPopover) {
        host.setAttribute('popover', 'manual');
        try { host.showPopover(); } catch {}
      }
    } else {
      host.removeAttribute('popover');
      host.style.cssText = BASE;
    }
  }

  function update() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  }

  function render() {
    const rec = active;
    html.classList.toggle('rf-media-active', !!rec && s.enabled && s.media);
    if (!rec || !rec.el.isConnected || !s.enabled || !s.media || document.fullscreenElement) {
      box.classList.remove('show');
      box.hidden = true;
      setOverlayFloat(false);
      return;
    }
    const fl = rec.floating;
    setOverlayFloat(fl);
    const r = rec.el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || (!fl && RF.isCovered(rec.el, rec.el.closest('shreddit-post') || rec.el))) { box.hidden = true; return; }
    const ox = fl ? 0 : scrollX, oy = fl ? 0 : scrollY;
    box.hidden = false;
    Object.assign(box.style, {left: `${r.left + ox}px`, top: `${r.top + oy}px`, width: `${r.width}px`, height: `${r.height}px`});
    const hb = fl ? 0 : RF.headerBottom();
    $('bar').style.top = `${clamp(hb - r.top + 8, 8, r.height - 44)}px`;
    $('pop').hidden = fl;
    $('dock').hidden = !fl;
    $('size').textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    box.classList.add('show');
  }

  // ---- sizing -----------------------------------------------------------------------------
  // Galleries are scaled as a whole with CSS zoom: their own layout (arrows, dots, image fit)
  // stays intact. Videos and single images are resized directly.
  function register(el) {
    const rec = {el, floating: false, w: null, h: null, shift: 0, wide: null, zoom: !!el.querySelector('gallery-carousel')};
    recs.set(el, rec);
    return rec;
  }

  function size(rec, w, h, cx) {
    const el = rec.el;
    const attr = rec.zoom ? 'data-rf-zoomed' : 'data-rf-sized';
    if (!el.hasAttribute(attr)) {
      if (rec.zoom) {
        if (!rec.bw) { const r = el.getBoundingClientRect(); rec.bw = r.width; rec.bh = r.height; } // natural size at zoom 1
        el.style.setProperty('--rf-base-w', `${rec.bw}px`);
      }
      el.setAttribute(attr, '');
      rec.wide = [];
      for (let p = el.parentElement; p && p.id !== 'main-content' && p !== document.body; p = p.parentElement) {
        p.setAttribute('data-rf-wide-ancestor', '');
        rec.wide.push(p);
        if (p.tagName === 'SHREDDIT-POST') break;
      }
      // Wrappers inside the card's shadow DOM can clip too; unclip them inline and remember how.
      rec.unclipped = [];
      for (let n = el.assignedSlot; n && !(n instanceof ShadowRoot); n = n.parentNode) {
        if (!(n instanceof HTMLElement)) continue;
        const old = {};
        for (const prop of ['overflow', 'max-height', 'max-width', 'contain']) old[prop] = [n.style.getPropertyValue(prop), n.style.getPropertyPriority(prop)];
        n.style.setProperty('overflow', 'visible', 'important');
        n.style.setProperty('max-height', 'none', 'important');
        n.style.setProperty('max-width', 'none', 'important');
        n.style.setProperty('contain', 'none', 'important');
        rec.unclipped.push([n, old]);
      }
    }
    if (rec.zoom) {
      // Zoom keeps proportions; lengths set on a zoomed element are multiplied by the zoom.
      const k = w / rec.bw;
      h = rec.bh * k;
      el.style.setProperty('--rf-zoom', String(k));
      rec.w = w; rec.h = h;
      if (!rec.floating) {
        const r = el.getBoundingClientRect();
        const naturalLeft = r.left - rec.shift;          // where it sits with no margin
        const center = naturalLeft + rec.bw / 2;          // the column's center
        const left = clamp(center - w / 2, GAP, innerWidth - GAP - w);
        rec.shift = Math.round(left - naturalLeft);
        el.style.setProperty('--rf-zoom-ml', `${rec.shift / k}px`);
      }
      return;
    }
    el.style.setProperty('--rf-media-w', `${w}px`);
    el.style.setProperty('--rf-media-h', `${h}px`);
    rec.w = w; rec.h = h;
    if (!rec.floating) {
      // Grow around the column's center, sliding sideways only when the window edge is hit.
      if (cx == null) {
        const r = el.getBoundingClientRect();
        cx = r.left + r.width / 2 - rec.shift;
      }
      const left = clamp(cx - w / 2, GAP, innerWidth - GAP - w);
      rec.shift = Math.round(left - (cx - w / 2));
      el.style.setProperty('--rf-media-shift', `${rec.shift}px`);
    }
    patchShadows(el);
  }

  function unsize(rec) {
    const el = rec.el;
    el.removeAttribute('data-rf-sized');
    el.removeAttribute('data-rf-zoomed');
    for (const name of ['--rf-media-w', '--rf-media-h', '--rf-media-shift', '--rf-zoom', '--rf-zoom-ml', '--rf-base-w']) el.style.removeProperty(name);
    for (const p of rec.wide || []) p.removeAttribute('data-rf-wide-ancestor');
    for (const [n, old] of rec.unclipped || []) {
      for (const [prop, [value, priority]] of Object.entries(old)) {
        if (value) n.style.setProperty(prop, value, priority); else n.style.removeProperty(prop);
      }
    }
    rec.wide = rec.unclipped = null; rec.w = rec.h = null; rec.shift = 0;
  }

  function place(rec, x, y) {
    const r = rec.el.getBoundingClientRect();
    const k = rec.zoom && rec.w ? rec.w / rec.bw : 1; // left/top get multiplied by zoom too
    rec.el.style.setProperty('--rf-x', `${clamp(x, GAP, innerWidth - r.width - GAP) / k}px`);
    rec.el.style.setProperty('--rf-y', `${clamp(y, GAP, innerHeight - r.height - GAP) / k}px`);
  }

  // ---- floating ---------------------------------------------------------------------------
  function floatMedia(rec, corner) {
    if (rec.floating) return;
    if (floating) dock(floating);
    const el = rec.el, r = el.getBoundingClientRect();
    rec.saved = rec.w ? {w: rec.w, h: rec.h} : null;

    const ph = document.createElement('div');
    ph.className = 'rf-placeholder';
    const slot = el.getAttribute('slot');
    if (slot) ph.setAttribute('slot', slot);
    ph.style.height = `${Math.round(r.height)}px`;
    ph.innerHTML = '<span class="rf-placeholder-btn">⤓ Playing in a floating window · click to dock</span>';
    el.before(ph);
    rec.ph = ph;

    rec.floating = true;
    floating = rec;
    rec.shift = 0;
    el.style.removeProperty('--rf-media-shift');
    el.style.removeProperty('--rf-zoom-ml');
    if (rec.zoom && !rec.bw) { rec.bw = r.width; rec.bh = r.height; } // measure before it goes fixed
    el.setAttribute('data-rf-floating', '');

    let w = r.width, h = r.height;
    if (corner) { const k = Math.min(560, innerWidth * 0.42) / w; w *= k; h *= k; }
    const fit = Math.min(1, (innerWidth - 2 * GAP) / w, (innerHeight - 2 * GAP) / h);
    w *= fit; h *= fit;
    size(rec, w, h);
    place(rec, corner ? innerWidth - w - 24 : r.left, corner ? innerHeight - h - 24 : r.top);

    rec.popover = false;
    if (canPopover) {
      // The top layer escapes every clipping/stacking context without moving the element,
      // so the player keeps playing exactly as it was.
      try { el.setAttribute('popover', 'manual'); el.showPopover(); rec.popover = true; }
      catch { el.removeAttribute('popover'); }
    }
    if (!rec.popover) {
      rec.anc = [];
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        p.setAttribute('data-rf-float-ancestor', '');
        rec.anc.push(p);
      }
    }
    overlayFloat = null; // re-raise the overlay above the new top-layer element
    active = rec;
    update();
  }

  function dock(rec) {
    if (!rec?.floating) return;
    const el = rec.el;
    if (rec.popover) {
      try { el.hidePopover(); } catch {}
      el.removeAttribute('popover');
    }
    for (const p of rec.anc || []) p.removeAttribute('data-rf-float-ancestor');
    rec.anc = null;
    el.removeAttribute('data-rf-floating');
    el.style.removeProperty('--rf-x');
    el.style.removeProperty('--rf-y');
    rec.ph?.remove();
    rec.ph = null;
    rec.floating = false;
    if (floating === rec) floating = null;
    if (rec.saved && el.isConnected) size(rec, rec.saved.w, rec.saved.h);
    else unsize(rec);
    rec.saved = null;
    update();
  }

  function reset(rec) {
    if (!rec) return;
    dock(rec);
    unsize(rec);
    update();
  }

  function resetAll() {
    for (const rec of recs.values()) reset(rec);
    active = null;
    update();
  }

  // ---- shadow DOM internals ---------------------------------------------------------------
  const innerCss = `
    :host-context([data-rf-sized]) { max-height: none !important; height: 100% !important; --gallery-initial-height: 100% !important; }
    :host-context([data-rf-sized]) video { width: 100% !important; height: 100% !important; max-height: none !important; object-fit: contain !important; }
    :host-context([data-rf-sized]) #carousel-window, :host-context([data-rf-sized]) .carousel-container, :host-context([data-rf-sized]) #carousel-list { height: 100% !important; max-height: none !important; }
    :host-context([data-rf-sized]) faceplate-carousel { height: 100% !important; max-height: none !important; }`;
  function patchShadows(el) {
    for (const node of [el, ...el.querySelectorAll('shreddit-player,shreddit-player-2,gallery-carousel,faceplate-carousel')]) {
      const sr = node.shadowRoot;
      if (!sr) continue;
      if (!sr.querySelector('style[data-rf-shadow]')) {
        const style = document.createElement('style');
        style.dataset.rfShadow = '';
        style.textContent = innerCss;
        sr.append(style);
      }
      patchShadows(sr);
    }
  }

  // ---- gestures ---------------------------------------------------------------------------
  function gesture(e, onMove, onEnd = () => {}) {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    dragging = true;
    clearTimeout(hideTimer);
    html.classList.add('rf-dragging');
    box.classList.add('dragging');
    // Listen on window: the overlay may hop into the top layer mid-drag, which can drop capture.
    const id = e.pointerId;
    const move = m => { if (m.pointerId === id) { onMove(m); update(); } };
    const end = ev => {
      if (ev.pointerId !== id) return;
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', end, true);
      removeEventListener('pointercancel', end, true);
      dragging = false;
      html.classList.remove('rf-dragging');
      box.classList.remove('dragging');
      onEnd(ev);
      update();
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', end, true);
    addEventListener('pointercancel', end, true);
  }

  for (const handle of ui.querySelectorAll('.h')) {
    const dir = handle.dataset.dir;
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !active) return;
      const rec = active, r = rec.el.getBoundingClientRect(), ratio = r.width / r.height;
      const x0 = e.clientX, y0 = e.clientY;
      const west = dir.includes('w'), north = dir.includes('n'), widthOnly = dir === 'e' || dir === 'w';
      const k = rec.floating ? 1 : 2; // inline media grows on both sides at once
      const cx = rec.floating ? null : r.left + r.width / 2 - rec.shift;
      gesture(e, m => {
        let w = r.width + (m.clientX - x0) * (west ? -1 : 1) * k;
        let h = widthOnly ? r.height : r.height + (m.clientY - y0) * (north ? -1 : 1);
        const maxW = innerWidth - 2 * GAP;
        const maxH = rec.floating ? innerHeight - 2 * GAP : 4000;
        if (s.lockRatio !== m.shiftKey) { // Shift flips the proportion lock while dragging
          if (widthOnly || Math.abs(w - r.width) >= Math.abs(h - r.height) * ratio) h = w / ratio;
          else w = h * ratio;
          w = clamp(w, MIN_W, Math.min(maxW, maxH * ratio));
          h = w / ratio;
        } else {
          w = clamp(w, MIN_W, maxW);
          h = clamp(h, MIN_H, maxH);
        }
        size(rec, w, h, cx);
        if (rec.floating) place(rec, west ? r.right - w : r.left, north ? r.bottom - h : r.top);
      });
    });
    handle.addEventListener('dblclick', () => reset(active));
    handle.addEventListener('keydown', e => {
      if (!active || !e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const r = active.el.getBoundingClientRect();
      const d = (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) * (e.shiftKey ? 80 : 20);
      const w = clamp(r.width + d, MIN_W, innerWidth - 2 * GAP);
      size(active, w, w * r.height / r.width);
      if (active.floating) place(active, r.left, r.top);
      update();
    });
  }

  $('grip').addEventListener('pointerdown', e => {
    if (e.button !== 0 || !active) return;
    const rec = active, x0 = e.clientX, y0 = e.clientY;
    let moved = false, dx = 0, dy = 0;
    gesture(e, m => {
      if (!moved) {
        if (Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
        moved = true;
        floatMedia(rec);
        const r = rec.el.getBoundingClientRect();
        dx = x0 - r.left; dy = y0 - r.top;
      }
      place(rec, m.clientX - dx, m.clientY - dy);
    }, () => { if (!moved && !rec.floating) floatMedia(rec, true); });
  });
  $('grip').addEventListener('keydown', e => {
    if (!active || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    floatMedia(active);
    const r = active.el.getBoundingClientRect(), d = e.shiftKey ? 80 : 20;
    place(active, r.left + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0), r.top + (e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0));
    update();
  });
  $('pop').addEventListener('click', () => active && floatMedia(active, true));
  $('dock').addEventListener('click', () => dock(active));
  $('reset').addEventListener('click', () => reset(active));

  // ---- page events ------------------------------------------------------------------------
  function mediaIn(path, x, y) {
    const hit = path.find(n => n instanceof Element && n.matches(SEL) && n.querySelector(CONTENT));
    if (hit || x == null) return hit;
    // The card's full-size link overlay can sit above the media; fall back to geometry.
    const post = path.find(n => n instanceof Element && n.tagName === 'SHREDDIT-POST');
    for (const el of post ? post.querySelectorAll(SEL) : []) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && el.querySelector(CONTENT)) return el;
    }
    return null;
  }

  function onHover(e) {
    if (dragging || !s.enabled || !s.media) return;
    const path = e.composedPath();
    if (path.includes(host)) { clearTimeout(hideTimer); hideTimer = 0; return; }
    const el = mediaIn(path, e.clientX, e.clientY);
    if (el) {
      clearTimeout(hideTimer);
      hideTimer = 0;
      if (active?.el !== el) { active = recs.get(el) || register(el); update(); }
    } else if (active && !hideTimer) {
      hideTimer = setTimeout(() => { hideTimer = 0; if (!dragging) { active = null; update(); } }, 450);
    }
  }
  document.addEventListener('pointerover', onHover, true);
  let lastMove = 0;
  document.addEventListener('pointermove', e => {
    if (e.timeStamp - lastMove < 60) return;
    lastMove = e.timeStamp;
    onHover(e);
  }, {capture: true, passive: true});

  // Ctrl + wheel over media zooms it smoothly.
  document.addEventListener('wheel', e => {
    if (!e.ctrlKey || !s.enabled || !s.media) return;
    const el = mediaIn(e.composedPath(), e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    const rec = recs.get(el) || register(el), r = el.getBoundingClientRect(), ratio = r.width / r.height;
    const maxH = rec.floating ? innerHeight - 2 * GAP : 4000;
    const w = clamp(r.width * Math.exp(-e.deltaY * 0.0015), MIN_W, Math.min(innerWidth - 2 * GAP, maxH * ratio));
    size(rec, w, w / ratio);
    if (rec.floating) place(rec, r.left + (r.width - w) / 2, r.top + (r.height - w / ratio) / 2);
    active = rec;
    update();
  }, {passive: false, capture: true});

  // Clicking the placeholder docks the player instead of opening the post.
  window.addEventListener('click', e => {
    const ph = e.composedPath().find(n => n instanceof Element && n.classList.contains('rf-placeholder'));
    if (!ph) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    for (const rec of recs.values()) if (rec.ph === ph) dock(rec);
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !floating || dragging || e.defaultPrevented) return;
    const t = e.composedPath()[0];
    if (t instanceof Element && t.closest('input,textarea,[contenteditable="true"],[role="textbox"]')) return;
    if (document.querySelector('dialog[open]')) return;
    dock(floating);
  });

  addEventListener('scroll', () => { if (active && !active.floating) update(); }, {passive: true});
  addEventListener('resize', () => {
    for (const rec of recs.values()) {
      if (rec.floating) {
        const r = rec.el.getBoundingClientRect();
        const f = Math.min(1, (innerWidth - 2 * GAP) / r.width, (innerHeight - 2 * GAP) / r.height);
        size(rec, r.width * f, r.height * f);
        place(rec, r.left, r.top);
      } else if (rec.w) {
        size(rec, Math.min(rec.w, innerWidth - 2 * GAP), Math.min(rec.w, innerWidth - 2 * GAP) * rec.h / rec.w);
      }
    }
    update();
  });
  document.addEventListener('fullscreenchange', update);

  let scanTimer = 0;
  function scan() {
    scanTimer = 0;
    for (const [el, rec] of recs) {
      if (!el.isConnected) {
        if (rec.floating) dock(rec);
        rec.ph?.remove();
        recs.delete(el);
        if (active === rec) active = null;
      } else if (rec.w) {
        patchShadows(el); // players can attach their shadow root late
      }
    }
    update();
  }
  new MutationObserver(() => { if (!scanTimer) scanTimer = setTimeout(scan, 250); })
    .observe(document.body, {childList: true, subtree: true});

  RF.subscribe(next => {
    s = next;
    if (!s.enabled || !s.media) resetAll();
    update();
  }, resetAll);
})();
