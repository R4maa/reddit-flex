/* Text posts expand inline like an accordion instead of navigating away. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfAccordion) return;
  window.__rfAccordion = true;

  const RF = RedditFlex;
  let s = {...RF.defaults};
  const pending = new Map();  // post id -> Promise<data>
  const resolved = new Map(); // post id -> data
  const open = new Map();     // shreddit-post -> {panel, snippet, h0, comments}
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const TOP_LEVEL = 10;

  // ---- helpers ----------------------------------------------------------------------------
  const isElement = n => n instanceof Element;
  const postIdOf = post => (post.getAttribute('permalink') || '').match(/\/comments\/([a-z0-9]+)/i)?.[1] || post.id?.replace(/^t3_/, '');

  function isTextPost(post) {
    return ['text', 'self'].includes((post.getAttribute('post-type') || '').toLowerCase());
  }
  // Text posts expand their body; every other kind (image, video, gallery, link) expands comments.
  function eligible(post) {
    return isTextPost(post) || s.allPosts;
  }
  // Media can sit under the card's full-size link overlay, so also check the click point.
  function onMedia(post, x, y) {
    for (const m of post.querySelectorAll('[slot="post-media-container"], [slot="thumbnail"], faceplate-img, img, video')) {
      const r = m.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  }
  function inFeed(post) {
    const ctx = (post.getAttribute('view-context') || '').toLowerCase();
    if (ctx) return ctx.includes('feed');
    return !!post.closest('shreddit-feed') && !/\/comments\//.test(location.pathname);
  }
  function samePost(href, post) {
    if (!href) return false;
    try {
      const id = new URL(href, location.href).pathname.match(/\/comments\/([a-z0-9]+)/i)?.[1];
      return !!id && id === postIdOf(post);
    } catch { return false; }
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v; else node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...children.filter(c => c != null));
    return node;
  }

  function compact(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
    if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
  }
  function ago(utc) {
    const sec = Math.max(1, Date.now() / 1000 - utc);
    for (const [size, unit] of [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']]) {
      if (sec >= size) return `${Math.floor(sec / size)}${unit}`;
    }
    return 'now';
  }

  // ---- sanitizer (Reddit's HTML is parsed inertly, then reduced to an allowlist) -----------
  const ALLOWED = new Set(['P', 'A', 'EM', 'STRONG', 'B', 'I', 'U', 'DEL', 'S', 'SUP', 'SUB', 'CODE', 'PRE', 'BLOCKQUOTE', 'UL', 'OL', 'LI',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SPAN', 'DIV', 'IMG', 'FIGURE', 'FIGCAPTION']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'FORM', 'INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'LINK', 'META']);
  const KEEP_ATTR = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'align']);

  function sanitize(markup) {
    const doc = new DOMParser().parseFromString(`<div>${markup || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    for (const node of [...root.querySelectorAll('*')]) {
      const tag = node.tagName.toUpperCase();
      if (DROP.has(tag)) { node.remove(); continue; }
      if (!ALLOWED.has(tag)) { node.replaceWith(...node.childNodes); continue; }
      const spoiler = node.classList.contains('md-spoiler-text');
      for (const {name} of [...node.attributes]) if (!KEEP_ATTR.has(name)) node.removeAttribute(name);
      if (spoiler) node.className = 'md-spoiler-text';
      if (node.hasAttribute('href')) {
        try {
          const url = new URL(node.getAttribute('href'), location.origin);
          if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw 0;
          node.setAttribute('href', url.href);
          if (url.origin !== location.origin) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
        } catch { node.removeAttribute('href'); }
      }
      if (tag === 'IMG') {
        const src = node.getAttribute('src') || '';
        if (!src.startsWith('https://')) { node.remove(); continue; }
        node.loading = 'lazy';
        node.decoding = 'async';
      }
    }
    const frag = document.createDocumentFragment();
    frag.append(...document.adoptNode(root).childNodes);
    return frag;
  }

  // ---- data -------------------------------------------------------------------------------
  function load(post) {
    const id = postIdOf(post);
    if (!id) return Promise.reject(new Error('no id'));
    if (pending.has(id)) return pending.get(id);
    const permalink = post.getAttribute('permalink');
    const url = new URL(permalink, location.origin);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}.json`;
    url.search = '?raw_json=1&limit=40&depth=4&sort=confidence';
    const p = fetch(url, {credentials: 'include', headers: {accept: 'application/json'}})
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => {
        const d = json?.[0]?.data?.children?.[0]?.data;
        if (!d) throw new Error('unexpected response');
        return {html: d.selftext_html || '', author: d.author, numComments: d.num_comments || 0,
          permalink: d.permalink || permalink, comments: json?.[1]?.data?.children || [], full: true};
      })
      .catch(() => loadFromPage(permalink)) // fall back to Reddit's own post page markup
      .then(data => { resolved.set(id, data); return data; });
    pending.set(id, p);
    p.catch(() => pending.delete(id));
    return p;
  }

  async function loadFromPage(permalink) {
    const r = await fetch(new URL(permalink, location.origin), {credentials: 'include'});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const body = doc.querySelector('shreddit-post [slot="text-body"] .md, shreddit-post [slot="text-body"]');
    if (!body) throw new Error('no body');
    return {html: body.innerHTML, numComments: Number(doc.querySelector('shreddit-post')?.getAttribute('comment-count')) || 0,
      permalink, comments: [], full: false};
  }

  // ---- rendering --------------------------------------------------------------------------
  function skeleton() {
    return el('div', {class: 'rf-acc-skel', 'aria-busy': 'true'},
      ...[92, 100, 96, 70].map(w => el('div', {class: 'rf-skel', style: `width:${w}%`})));
  }

  function renderBody(panel, data, post) {
    let body = el('div', {class: 'rf-acc-body rf-md'});
    if (data.html.trim()) body.append(sanitize(data.html));
    else if (isTextPost(post)) body.append(el('p', {class: 'rf-acc-empty'}, 'This post has no body text.'));
    else body = null; // media/link posts already show their content in the card
    const actions = el('div', {class: 'rf-acc-actions'},
      data.numComments ? el('button', {type: 'button', class: 'rf-acc-btn', 'data-rf': 'comments'}, `💬 ${compact(data.numComments)} comments`) : null,
      el('a', {class: 'rf-acc-btn', href: new URL(data.permalink, location.origin).href, 'data-rf': 'thread'}, 'Open thread ↗'),
      el('button', {type: 'button', class: 'rf-acc-btn', 'data-rf': 'collapse'}, 'Collapse ▴'));
    panel.replaceChildren(...[body, actions].filter(Boolean));
    const st = open.get(post);
    if (st && (st.comments || s.autoComments)) showComments(post, false);
  }

  function renderError(panel, post) {
    panel.replaceChildren(el('div', {class: 'rf-acc-body rf-acc-empty'}, 'Couldn’t load this post. ',
      el('a', {href: new URL(post.getAttribute('permalink'), location.origin).href}, 'Open it instead →')));
  }

  // Avatars: an initial on a colour picked from the name, upgraded to the real picture once
  // one batched request for everyone in the thread comes back.
  const avatarCache = new Map(); // t2_ id -> image URL ('' = none)
  function avatar(name, uid) {
    let hue = 0;
    for (const ch of name || '?') hue = (hue * 31 + ch.charCodeAt(0)) % 360;
    const node = el('span', {class: 'rf-c-avatar', 'data-uid': uid || null, 'data-rf': 'toggle-comment', style: `--rf-hue:${hue}`, title: 'Collapse'},
      (name || '?').replace(/^[-_]+/, '').charAt(0).toUpperCase() || '?');
    const url = uid && avatarCache.get(uid);
    if (url) setAvatar(node, url);
    return node;
  }
  function setAvatar(node, url) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => node.replaceChildren(img);
    img.src = url;
  }
  async function loadAvatars(root) {
    const nodes = [...root.querySelectorAll('.rf-c-avatar[data-uid]')];
    const missing = [...new Set(nodes.map(n => n.dataset.uid))].filter(id => /^t2_[a-z0-9]+$/i.test(id) && !avatarCache.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const ids = missing.slice(i, i + 100);
      ids.forEach(id => avatarCache.set(id, ''));
      try {
        const r = await fetch(`${location.origin}/api/user_data_by_account_ids.json?ids=${ids.join(',')}`, {credentials: 'include'});
        if (!r.ok) continue;
        const json = await r.json();
        for (const [id, u] of Object.entries(json || {})) {
          const src = String(u?.profile_img || '').replace(/&amp;/g, '&');
          if (src.startsWith('https://')) avatarCache.set(id, src);
        }
      } catch {}
    }
    for (const n of nodes) { const url = avatarCache.get(n.dataset.uid); if (url && !n.querySelector('img')) setAvatar(n, url); }
  }

  function renderComment(c, depth, opName, permalink) {
    if (c.kind === 'more') {
      const n = c.data?.count || 0;
      if (!n) return null;
      const parent = (c.data.parent_id || '').replace(/^t1_/, '');
      const href = new URL(parent && c.data.parent_id.startsWith('t1_') ? `${permalink.replace(/\/?$/, '/')}${parent}/` : permalink, location.origin).href;
      return el('div', {class: 'rf-c rf-c-moreitem'}, el('a', {class: 'rf-c-more', href}, `${n} more ${n === 1 ? 'reply' : 'replies'} →`));
    }
    if (c.kind !== 't1') return null;
    const d = c.data;
    const author = d.author === '[deleted]'
      ? el('span', {class: 'rf-c-author'}, '[deleted]')
      : el('a', {class: 'rf-c-author', href: `/user/${encodeURIComponent(d.author)}/`}, d.author);
    const head = el('div', {class: 'rf-c-head', 'data-rf': 'comment-head'},
      avatar(d.author, d.author_fullname),
      author,
      d.author === opName ? el('span', {class: 'rf-c-op'}, 'OP') : null,
      d.stickied ? el('span', {class: 'rf-c-pin'}, 'pinned') : null,
      el('span', {}, '·'),
      el('span', {}, `▲ ${d.score_hidden ? '•' : compact(d.score)}`),
      el('span', {}, '·'),
      el('time', {datetime: new Date(d.created_utc * 1000).toISOString()}, ago(d.created_utc)),
      el('span', {class: 'rf-c-count', 'data-rf': 'toggle-comment'}));
    const body = el('div', {class: 'rf-c-body rf-md'});
    body.append(sanitize(d.body_html || ''));
    const kids = el('div', {class: 'rf-c-kids'});
    const replies = d.replies?.data?.children || [];
    if (depth < 4) for (const r of replies) { const n = renderComment(r, depth + 1, opName, permalink); if (n) kids.append(n); }
    else if (replies.length) kids.append(el('div', {class: 'rf-c rf-c-moreitem'}, el('a', {class: 'rf-c-more', href: new URL(d.permalink, location.origin).href}, 'Continue thread →')));
    const node = el('div', {class: 'rf-c', 'data-depth': depth},
      el('button', {type: 'button', class: 'rf-c-line', 'data-rf': 'toggle-comment', 'aria-label': 'Collapse thread', title: 'Collapse thread'}),
      head, el('div', {class: 'rf-c-content'}, body, kids.childElementCount ? kids : null));
    node.dataset.count = String(1 + kids.querySelectorAll('.rf-c:not(.rf-c-moreitem)').length);
    return node;
  }

  function showComments(post, animate = true) {
    const st = open.get(post);
    if (!st) return;
    st.comments = true;
    const data = resolved.get(postIdOf(post));
    if (!data || st.panel.querySelector('.rf-acc-comments')) return;
    morph(st.panel, animate, () => {
      const wrap = el('div', {class: 'rf-acc-comments'});
      const list = data.comments.filter(c => c.kind === 't1');
      if (!data.full) {
        wrap.append(el('a', {class: 'rf-c-more', href: new URL(data.permalink, location.origin).href}, 'Open the thread to read comments →'));
      } else if (!list.length) {
        wrap.append(el('p', {class: 'rf-acc-empty'}, 'No comments yet.'));
      } else {
        for (const c of list.slice(0, TOP_LEVEL)) { const n = renderComment(c, 0, data.author, data.permalink); if (n) wrap.append(n); }
        if (data.numComments > wrap.querySelectorAll('.rf-c').length) {
          wrap.append(el('a', {class: 'rf-acc-btn rf-acc-all', href: new URL(data.permalink, location.origin).href}, `View all ${compact(data.numComments)} comments ↗`));
        }
      }
      loadAvatars(wrap);
      st.panel.append(wrap, el('div', {class: 'rf-acc-grip', role: 'separator', 'aria-orientation': 'horizontal',
        'aria-label': 'Resize comments', title: 'Drag to resize comments · double-click to reset'}));
      st.panel.querySelector('[data-rf="comments"]')?.replaceWith(
        el('button', {type: 'button', class: 'rf-acc-btn', 'data-rf': 'hide-comments'}, 'Hide comments'));
    });
  }

  function toggleComment(c) {
    if (c.dataset.animating) return;
    const collapsing = !c.classList.contains('rf-collapsed');
    const n = Number(c.dataset.count) || 1;
    const setState = () => {
      c.classList.toggle('rf-collapsed', collapsing);
      c.querySelector(':scope > .rf-c-head .rf-c-count').textContent = collapsing ? (n > 1 ? `+${n - 1} hidden` : 'hidden') : '';
      c.querySelector(':scope > .rf-c-head .rf-c-avatar')?.setAttribute('title', collapsing ? 'Expand' : 'Collapse');
    };
    const h0 = c.getBoundingClientRect().height;
    c.dataset.animating = '1';
    let done;
    if (collapsing) {
      // Shrink to just the header row with replies still visible, then hide them.
      const head = c.querySelector(':scope > .rf-c-head');
      const h1 = head.getBoundingClientRect().bottom - c.getBoundingClientRect().top;
      done = animateHeight(c, h0, h1, true).then(setState);
    } else {
      setState();
      done = animateHeight(c, h0, c.getBoundingClientRect().height, true);
    }
    done.finally(() => delete c.dataset.animating);
    // Keep the collapsed comment's header in view inside the comment box.
    const box = c.closest('.rf-acc-comments');
    if (collapsed && box) {
      const top = c.getBoundingClientRect().top - box.getBoundingClientRect().top;
      if (top < 0) box.scrollBy({top: top - 8, behavior: reduceMotion.matches ? 'auto' : 'smooth'});
    }
  }

  function hideComments(post) {
    const st = open.get(post);
    if (!st) return;
    st.comments = false;
    const data = resolved.get(postIdOf(post));
    morph(st.panel, true, () => {
      st.panel.querySelector('.rf-acc-comments')?.remove();
      st.panel.querySelector('.rf-acc-grip')?.remove();
      st.panel.querySelector('[data-rf="hide-comments"]')?.replaceWith(
        el('button', {type: 'button', class: 'rf-acc-btn', 'data-rf': 'comments'}, `💬 ${compact(data?.numComments)} comments`));
    });
  }

  // ---- animation --------------------------------------------------------------------------
  // clipY: clip only vertically, so thread lines drawn outside the box stay visible.
  function animateHeight(node, from, to, clipY) {
    for (const a of node.getAnimations()) a.cancel();
    if (reduceMotion.matches || Math.abs(to - from) < 2) return Promise.resolve();
    if (clipY) node.style.clipPath = 'inset(0 -200px 0 -200px)'; else node.style.overflow = 'hidden';
    const duration = Math.min(460, 180 + Math.abs(to - from) * 0.22);
    const anim = node.animate([{height: `${from}px`}, {height: `${to}px`}], {duration, easing: 'cubic-bezier(.22,.8,.24,1)'});
    return anim.finished.catch(() => {}).finally(() => { node.style.overflow = ''; node.style.clipPath = ''; });
  }

  function morph(node, animate, change) {
    const h0 = node.getBoundingClientRect().height;
    change();
    if (animate) animateHeight(node, h0, node.getBoundingClientRect().height);
  }

  // ---- open / close -----------------------------------------------------------------------
  function expand(post, withComments) {
    const id = postIdOf(post);
    if (!id || !post.getAttribute('permalink')) return false;
    const text = isTextPost(post);
    if (!text) withComments = true;
    const snippet = text ? post.querySelector(':scope > [slot="text-body"]:not(.rf-acc)') : null;
    const h0 = snippet ? snippet.getBoundingClientRect().height : 0;
    const panel = el('div', {class: 'rf-acc', slot: 'text-body', role: 'region', 'aria-label': text ? 'Post text' : 'Comments'});
    const anchor = snippet || post.querySelector(':scope > [slot="title"]');
    if (anchor) anchor.after(panel);
    else post.append(panel);
    // Comments for media/link posts go under the whole card (below the image and action bar).
    // Text panels fall back there too if the card's shadow DOM has nowhere to show them.
    if (!text || (post.shadowRoot && !panel.assignedSlot)) {
      panel.removeAttribute('slot');
      panel.classList.add('rf-acc-outside');
      post.after(panel);
    }
    open.set(post, {panel, snippet, h0, comments: !!withComments});
    post.setAttribute('data-rf-open', '');
    if (snippet) snippet.style.setProperty('display', 'none', 'important');

    const cached = resolved.get(id);
    if (cached) renderBody(panel, cached, post);
    else panel.append(skeleton());
    animateHeight(panel, h0, panel.getBoundingClientRect().height);

    if (!cached) {
      load(post).then(
        data => { if (open.get(post)?.panel === panel) morph(panel, true, () => renderBody(panel, data, post)); },
        () => { if (open.get(post)?.panel === panel) morph(panel, true, () => renderError(panel, post)); });
    }
    return true;
  }

  function collapse(post) {
    const st = open.get(post);
    if (!st) return;
    open.delete(post);
    const {panel, snippet, h0} = st;
    const top = post.getBoundingClientRect().top, hb = RF.headerBottom();
    if (top < hb) scrollBy({top: top - hb - 12, behavior: reduceMotion.matches ? 'auto' : 'smooth'});
    animateHeight(panel, panel.getBoundingClientRect().height, h0).then(() => {
      panel.remove();
      if (!open.has(post)) {
        snippet?.style.removeProperty('display');
        post.removeAttribute('data-rf-open');
      }
    });
  }

  function collapseAll() { for (const post of [...open.keys()]) collapse(post); }

  // ---- events -----------------------------------------------------------------------------
  // Window capture runs before Reddit's own card navigation.
  addEventListener('click', e => {
    if (!s.enabled || !s.accordion || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const path = e.composedPath();

    const panel = path.find(n => isElement(n) && n.classList.contains('rf-acc'));
    if (panel) { onPanelClick(e, path, panel); return; }

    const post = path.find(n => isElement(n) && n.tagName === 'SHREDDIT-POST');
    if (!post || !eligible(post) || !inFeed(post)) return;
    const sel = getSelection();
    if (sel && !sel.isCollapsed && post.contains(sel.anchorNode)) return; // user is selecting text

    let comments = false;
    for (const n of path) {
      if (n === post) break;
      if (!isElement(n)) continue;
      if (n.tagName === 'A') {
        if (!samePost(n.getAttribute('href'), post)) return; // author, subreddit, external links
        const slot = n.getAttribute('slot');
        if (slot !== 'title' && slot !== 'full-post-link' && !n.id?.startsWith('post-title')) comments = true;
        continue;
      }
      if (n.matches('button,input,textarea,select,label,video,img,faceplate-img,[slot="thumbnail"],[role="button"],[role="menu"],[role="menuitem"],faceplate-dropdown-menu,shreddit-post-overflow-menu,award-button,shreddit-post-share-button,shreddit-player,shreddit-player-2,gallery-carousel,[slot="post-media-container"]')) {
        if (n.matches('[name="comments-action-button"],[data-post-click-location="comments-button"]')) { comments = true; continue; }
        return;
      }
    }
    if (!comments && onMedia(post, e.clientX, e.clientY)) return; // image viewer, video controls

    e.preventDefault();
    e.stopImmediatePropagation();
    if (open.has(post)) {
      if (comments && !open.get(post).comments) showComments(post);
      else collapse(post);
    } else {
      expand(post, comments);
    }
  }, true);

  function onPanelClick(e, path, panel) {
    const post = [...open.keys()].find(p => open.get(p).panel === panel);
    const link = path.find(n => isElement(n) && n.tagName === 'A');
    if (link) { e.stopImmediatePropagation(); return; } // let the link navigate normally
    e.stopImmediatePropagation();
    const spoiler = path.find(n => isElement(n) && n.classList.contains('md-spoiler-text'));
    if (spoiler) { spoiler.classList.toggle('rf-revealed'); return; }
    const action = path.find(n => isElement(n) && n.dataset?.rf)?.dataset.rf;
    if (!post || !action) return;
    if (action === 'collapse') collapse(post);
    else if (action === 'comments') showComments(post);
    else if (action === 'hide-comments') hideComments(post);
    else if (action === 'toggle-comment' || action === 'comment-head') {
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return;
      const c = path.find(n => isElement(n) && n.classList.contains('rf-c'));
      // A collapsed comment's whole row expands it; on an open one only the avatar/line collapse.
      if (!c || (action === 'comment-head' && !c.classList.contains('rf-collapsed'))) return;
      toggleComment(c);
    }
  }

  // Warm the cache while the pointer rests on a text post, so opening is instant.
  let hoverTimer = 0, hoverPost = null;
  document.addEventListener('pointerover', e => {
    if (!s.enabled || !s.accordion) return;
    const post = e.composedPath().find(n => isElement(n) && n.tagName === 'SHREDDIT-POST');
    if (post === hoverPost) return;
    hoverPost = post;
    clearTimeout(hoverTimer);
    if (post && eligible(post) && inFeed(post) && !pending.has(postIdOf(post))) {
      hoverTimer = setTimeout(() => load(post).catch(() => {}), isTextPost(post) ? 140 : 250);
    }
  }, true);

  // Reddit's client-side navigation can recycle cards; drop state for cards that left the page.
  let sweepTimer = 0;
  new MutationObserver(() => {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = 0;
      for (const [post, st] of open) if (!post.isConnected) { st.panel.remove(); open.delete(post); }
    }, 400);
  }).observe(document.body, {childList: true, subtree: true});

  // Drag the grip under a comment box to set how tall comment boxes are (remembered).
  const html = document.documentElement;
  const [MIN_H, MAX_H] = RF.RANGES.commentsHeight;
  const setBoxHeight = h => html.style.setProperty('--rf-comments-h', `${h}px`);
  document.addEventListener('pointerdown', e => {
    const grip = e.composedPath().find(n => isElement(n) && n.classList.contains('rf-acc-grip'));
    if (!grip || e.button !== 0) return;
    const box = grip.previousElementSibling;
    if (!box) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const y0 = e.clientY, h0 = box.getBoundingClientRect().height;
    let h = h0;
    html.classList.add('rf-dragging', 'rf-resizing-comments');
    const move = m => { h = Math.round(Math.min(MAX_H, Math.max(MIN_H, h0 + m.clientY - y0))); setBoxHeight(h); };
    const end = () => {
      removeEventListener('pointermove', move, true);
      removeEventListener('pointerup', end, true);
      removeEventListener('pointercancel', end, true);
      html.classList.remove('rf-dragging', 'rf-resizing-comments');
      s = {...s, commentsHeight: h};
      RF.save(s);
    };
    addEventListener('pointermove', move, true);
    addEventListener('pointerup', end, true);
    addEventListener('pointercancel', end, true);
  }, true);
  document.addEventListener('dblclick', e => {
    if (!e.composedPath().some(n => isElement(n) && n.classList.contains('rf-acc-grip'))) return;
    s = {...s, commentsHeight: RF.defaults.commentsHeight};
    setBoxHeight(s.commentsHeight);
    RF.save(s);
  }, true);

  RF.subscribe(next => {
    s = next;
    setBoxHeight(s.commentsHeight);
    if (!s.enabled || !s.accordion) collapseAll();
  });
})();
