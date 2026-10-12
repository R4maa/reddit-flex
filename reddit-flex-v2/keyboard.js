/* Keyboard navigation: J/K between posts, Enter/C to expand, ←/→ for galleries, N/P comments. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfKeyboard) return;
  window.__rfKeyboard = true;

  const RF = RedditFlex;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let s = {...RF.defaults, keyboard: false}; // stays off until the saved settings have loaded
  let current = null;

  const SHORTCUTS = [
    ['J / K', 'Next / previous post'],
    ['Enter', 'Expand or collapse the post inline'],
    ['C', 'Show or hide the post’s comments inline'],
    ['← / →', 'Previous / next gallery image'],
    ['N / P', 'Next / previous top-level comment (open comments or a post page)'],
    ['?', 'Show or hide this help'],
  ];

  const isElement = n => n instanceof Element;
  const behavior = () => (reduceMotion.matches ? 'auto' : 'smooth');
  const visible = el => el.isConnected && el.getClientRects().length > 0;

  // Text-like inputs only: after clicking a checkbox or slider the keys should still work.
  const EDITABLE = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="color"], [type="file"]), textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]';
  const editable = n => isElement(n) && !!n.closest(EDITABLE);

  // The event target stops at a closed shadow root's host, so also follow the focused element
  // down through shadow roots (Reddit's composers live several shadow roots deep).
  // Content scripts can open closed shadow roots through chrome.dom.
  const rootOf = el => (globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) ?? el.shadowRoot);
  function deepActive() {
    let a = document.activeElement;
    for (let r; a && (r = rootOf(a))?.activeElement;) a = r.activeElement;
    return a;
  }
  function typingIn(target) {
    const a = deepActive();
    return editable(target) || editable(a) || !!a?.isContentEditable;
  }
  // Reddit's dropdown menus (e.g. a post's "…" menu) open next to their button inside the post's
  // shadow DOM and take focus, so they don't cover the feed; their own keys must win.
  const MENU = '[role="menu"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="listbox"], [role="option"], faceplate-menu';
  const inMenu = () => !!deepActive()?.closest?.(MENU);

  // Posts in page order, skipping ones that are hidden (e.g. filtered out).
  function posts() {
    return [...document.querySelectorAll('shreddit-post')].filter(visible);
  }

  // Keyboard moves show an outline; a mouse click only updates the selection silently.
  function select(post, scroll = true, outline = true) {
    if (current && current !== post) current.removeAttribute('data-rf-kbd');
    current = post;
    if (!post) return;
    post.toggleAttribute('data-rf-kbd', outline);
    if (scroll) {
      const top = post.getBoundingClientRect().top + scrollY - RF.headerBottom() - 12;
      scrollTo({top: Math.max(0, top), behavior: behavior()});
    }
  }

  // Returns false when there is nothing to move to, so the key isn't swallowed.
  function step(dir) {
    const list = posts();
    if (!list.length) return false;
    const i = current && list.includes(current) ? list.indexOf(current) : -1;
    if (i === -1) {
      // Start from whatever is at the top of the screen.
      const top = topIndex(list);
      select(list[top >= 0 && dir < 0 ? Math.max(0, top - 1) : top < 0 ? list.length - 1 : top]);
      return true;
    }
    select(list[Math.min(list.length - 1, Math.max(0, i + dir))]);
    return true;
  }

  function topIndex(list) {
    const hb = RF.headerBottom();
    return list.findIndex(p => p.getBoundingClientRect().bottom > hb + 40); // -1: all above the screen
  }

  // The post Enter/C act on, without selecting it yet (an unhandled key must not move anything).
  function targetPost() {
    if (current && visible(current)) return current;
    const list = posts();
    return list.length ? list.at(topIndex(list)) : null; // .at(-1): the last post
  }

  // A held key (repeat) toggles nothing, but is swallowed exactly when the first press was handled.
  function togglePost(opts, repeat = false) {
    const post = targetPost(), acc = globalThis.RedditFlexAccordion;
    if (repeat) return !!post && !!acc?.canExpand(post);
    if (!post || !acc?.toggle(post, opts)) return false;
    if (post !== current) select(post);
    return true;
  }

  // Gallery arrows live inside the carousel (often in its shadow DOM); click Reddit's own button.
  function galleryButton(post, dir) {
    const carousel = post.querySelector('gallery-carousel');
    if (!carousel) return null;
    const want = dir > 0 ? /next|forward|right/i : /prev|back|left/i;
    const roots = [carousel, rootOf(carousel)].filter(Boolean);
    for (const root of roots) {
      for (const b of root.querySelectorAll('button, [role="button"]')) {
        const label = `${b.getAttribute('aria-label') || ''} ${b.id || ''} ${b.getAttribute('slot') || ''} ${b.closest('[slot]')?.getAttribute('slot') || ''}`;
        if (want.test(label) && !b.disabled && visible(b)) return b;
      }
    }
    return null;
  }

  // Top-level comments: inside the open inline comment box, or Reddit's own on a post page.
  function jumpComment(dir) {
    const post = current && visible(current) ? current : null;
    const box = post && globalThis.RedditFlexAccordion?.panel(post)?.querySelector('.rf-acc-comments');
    if (box) {
      const items = [...box.querySelectorAll(':scope > .rf-c')];
      const boxTop = box.getBoundingClientRect().top;
      const tops = items.map(c => c.getBoundingClientRect().top - boxTop);
      // "Next" means the next comment below the one at the top (anything within 40px counts as there).
      // "Previous" means the start of the comment being read when it is scrolled into, otherwise the
      // one before it, like Gmail/RES: from the middle of a long comment, P first goes back to its top.
      const target = dir > 0 ? items[tops.findIndex(t => t > 40)] : items[tops.findLastIndex(t => t < -6)] || items[0];
      if (target) box.scrollTo({top: box.scrollTop + target.getBoundingClientRect().top - boxTop - 4, behavior: behavior()});
      return !!target;
    }
    // Reddit's own top-level comments (they only exist on post pages).
    const native = [...document.querySelectorAll('shreddit-comment[depth="0"]')].filter(visible);
    if (!native.length) return false;
    const hb = RF.headerBottom() + 12;
    const tops = native.map(c => c.getBoundingClientRect().top - hb);
    const target = dir > 0 ? native[tops.findIndex(t => t > 40)] : native[tops.findLastIndex(t => t < -6)] || native[0];
    if (target) scrollTo({top: Math.max(0, scrollY + target.getBoundingClientRect().top - hb), behavior: behavior()});
    return !!target;
  }

  // Light-DOM dialogs are checked directly. Reddit's dialogs and viewers that live in shadow roots
  // are caught by the second check: something covering most of the feed counts as an overlay.
  function overlayOpen() {
    for (const d of document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')) {
      if (visible(d) && getComputedStyle(d).visibility !== 'hidden') return true;
    }
    const main = document.getElementById('main-content');
    return !!main && RF.isCovered(main, main, {ignoreFloating: true});
  }

  // ---- help overlay -----------------------------------------------------------------------
  let help = null, lastFocus = null;
  function toggleHelp(force) {
    if (!help && force === false) return;
    if (!help) {
      help = document.createElement('div');
      help.id = 'rf-keyboard-help';
      const root = help.attachShadow({mode: 'open'});
      root.innerHTML = `<style>
        :host { all: initial; position: fixed; inset: 0; z-index: 2147483600; display: grid; place-items: center; background: rgba(0,0,0,.45); font: 14px/1.5 system-ui, sans-serif; }
        .card { background: #1a1a1b; color: #e8eaed; border: 1px solid #343536; border-radius: 14px; padding: 20px 24px; min-width: 320px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
        h2 { margin: 0 0 12px; font-size: 15px; }
        table { border-collapse: collapse; }
        td { padding: 5px 0; vertical-align: top; }
        td:first-child { padding-right: 18px; white-space: nowrap; }
        kbd { font: 600 12px/1 ui-monospace, Consolas, monospace; background: #2a2b2d; border: 1px solid #444; border-bottom-width: 2px; border-radius: 6px; padding: 3px 7px; }
        p { margin: 12px 0 0; font-size: 12px; opacity: .65; }
      </style>
      <div class="card" role="dialog" aria-modal="true" aria-label="Reddit Flex keyboard shortcuts" tabindex="-1">
        <h2>Reddit Flex keyboard shortcuts</h2>
        <table>${SHORTCUTS.map(([k, d]) => `<tr><td>${k.split(' / ').map(x => `<kbd>${x}</kbd>`).join(' / ')}</td><td>${d}</td></tr>`).join('')}</table>
        <p>Press ? or Esc to close. Shortcuts are off while you type.</p>
      </div>`;
      // Clicking the dimmed backdrop closes it; clicks on the card itself don't.
      help.addEventListener('click', e => { if (e.composedPath()[0] === help) toggleHelp(false); });
    }
    const show = force ?? !help.isConnected;
    if (show === help.isConnected) return;
    if (show) {
      lastFocus = deepActive();
      document.body.append(help);
      help.shadowRoot.querySelector('.card').focus({preventScroll: true});
    } else {
      help.remove();
      if (lastFocus?.isConnected) lastFocus.focus?.({preventScroll: true});
      lastFocus = null;
    }
  }

  // ---- key handling -----------------------------------------------------------------------
  addEventListener('keydown', e => {
    if (!s.enabled || !s.keyboard || e.defaultPrevented || e.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // browser shortcuts always pass
    if (help?.isConnected) {
      // The help is modal: ? and Esc close it, and no other key (Tab, Enter, Space...) reaches the page.
      if (e.key === 'Escape' || e.key === '?') toggleHelp(false);
      e.preventDefault(); e.stopImmediatePropagation();
      return;
    }
    if (typingIn(e.composedPath()[0])) return;
    if (inMenu() || overlayOpen()) return; // leave Reddit's own dialogs, menus and image viewer alone

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    switch (key) {
      case 'j': handled = step(1); break;
      case 'k': handled = step(-1); break;
      case 'Enter': {
        // Enter on a focused link or button keeps its normal meaning.
        // Checks the deep focused element too: the event target stops at closed shadow roots.
        // A post's own title link doesn't count: clicking it expands the post (and leaves it focused).
        const control = n => isElement(n) && n.closest('a, button, [role="button"], summary') &&
          !n.closest('a[slot="title"], a[slot="full-post-link"]');
        if ([e.composedPath()[0], deepActive()].some(control)) { handled = false; break; }
        handled = togglePost(undefined, e.repeat); // holding Enter doesn't flap the post open and shut
        break;
      }
      case 'c': handled = togglePost({comments: true}, e.repeat); break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const b = current && visible(current) && !e.shiftKey ? galleryButton(current, key === 'ArrowRight' ? 1 : -1) : null;
        if (b) b.click(); else handled = false; // otherwise keep normal horizontal scrolling
        break;
      }
      case 'n': handled = jumpComment(1); break;
      case 'p': handled = jumpComment(-1); break;
      case '?': toggleHelp(); break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // Clicking a post makes it the keyboard selection, so N/P and Enter act on it.
  // pointerdown, not click: the accordion stops card clicks before they reach any other listener.
  addEventListener('pointerdown', e => {
    if (!s.enabled || !s.keyboard || e.button !== 0) return;
    const post = e.composedPath().find(n => isElement(n) && n.tagName === 'SHREDDIT-POST');
    if (post && post !== current) select(post, false, false); // (our own gallery clicks keep the outline)
  }, true);

  RF.subscribe(next => {
    s = next;
    if (!s.enabled || !s.keyboard) { select(null); toggleHelp(false); }
  });
})();
