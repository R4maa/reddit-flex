/* Videos: autoplay control, downloading, picture-in-picture. media.js puts the buttons on its bar. */
(() => {
  'use strict';
  if (window.top !== window || window.__rfVideo) return;
  window.__rfVideo = true;

  const RF = RedditFlex;
  const PLAYER = 'shreddit-player, shreddit-player-2';
  let s = {...RF.defaults, enabled: false};

  // The <video> sits in the player's shadow root (sometimes a few roots down).
  function videoIn(root) {
    if (!root) return null;
    if (root instanceof HTMLVideoElement) return root;
    const sr = root.shadowRoot;
    const direct = root.querySelector?.('video') || sr?.querySelector('video');
    if (direct) return direct;
    for (const el of [...(root.querySelectorAll?.('*') || []), ...(sr ? sr.querySelectorAll('*') : [])]) {
      const v = el.shadowRoot && videoIn(el);
      if (v) return v;
    }
    return null;
  }
  const playerIn = el => (el?.matches?.(PLAYER) ? el : el?.querySelector?.(PLAYER)) || null;

  // ---- autoplay ---------------------------------------------------------------------------
  // Reddit's player starts itself when it has an `autoplay` attribute and scrolls into view.
  // With autoplay off we take the attribute away (and remember that we did), so the player waits
  // for a click on play; turning autoplay back on gives it back.
  const autoplayOff = () => s.enabled && !s.autoplay;
  function holdPlayer(p, fresh) {
    if (!p.hasAttribute('autoplay')) return;
    p.removeAttribute('autoplay');
    p.setAttribute('data-rf-autoplay', '');
    // A player that started before we got to it (it was already in view) is paused, but only when
    // we first meet it: nobody can have pressed play yet. Switching the option later leaves a video
    // the user is watching alone.
    if (fresh) { const v = videoIn(p); if (v && !v.paused) v.pause(); }
  }
  function releasePlayers() {
    for (const p of document.querySelectorAll('[data-rf-autoplay]')) {
      p.removeAttribute('data-rf-autoplay');
      p.setAttribute('autoplay', '');
    }
  }
  function holdAll(fresh) { for (const p of document.querySelectorAll(PLAYER)) holdPlayer(p, fresh); }

  new MutationObserver(records => {
    if (!autoplayOff()) return;
    for (const r of records) {
      if (r.type === 'attributes') { if (r.target.matches(PLAYER)) holdPlayer(r.target, false); continue; }
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.matches(PLAYER)) holdPlayer(n, true);
        for (const p of n.querySelectorAll(PLAYER)) holdPlayer(p, true);
      }
    }
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['autoplay']});

  // ---- download ---------------------------------------------------------------------------
  // Reddit lists ready-made mp4s (video and sound in one file) on the player as packaged-media-json.
  // H.264 plays everywhere, so the largest H.264 one is preferred. Some videos have none; then the
  // post's fallback_url is used, which is the picture only when the video has sound.
  function packagedMp4(player) {
    let list;
    try { list = JSON.parse(player.getAttribute('packaged-media-json') || 'null')?.playbackMp4s?.permutations; }
    catch { return null; }
    if (!Array.isArray(list)) return null;
    const ok = list.map(p => p?.source).filter(src => typeof src?.url === 'string' && /^https:\/\//.test(src.url));
    const area = src => (src.dimensions?.width || 0) * (src.dimensions?.height || 0);
    const pick = arr => arr.sort((a, b) => area(b) - area(a))[0];
    const best = pick(ok.filter(src => src.videoCodec === 'H264')) || pick(ok);
    return best ? {url: best.url, complete: true} : null;
  }

  async function fallbackMp4(postId) {
    // Only through redditFetch, so the request shares its rate limiting.
    const fetcher = globalThis.RedditFlexAccordion?.fetch;
    if (!fetcher) throw new Error('Could not reach Reddit');
    const r = await fetcher(`${location.origin}/comments/${postId}.json?limit=1&raw_json=1`, {headers: {accept: 'application/json'}});
    if (!r.ok) throw new Error(`Reddit answered ${r.status}`);
    const d = (await r.json())?.[0]?.data?.children?.[0]?.data;
    const rv = d?.crosspost_parent_list?.[0]?.secure_media?.reddit_video || d?.secure_media?.reddit_video;
    if (typeof rv?.fallback_url !== 'string') return null;
    // Complete only when Reddit says the video has no sound at all; unknown counts as missing sound.
    return {url: rv.fallback_url, complete: rv.has_audio === false};
  }

  async function source(el) {
    const player = playerIn(el);
    if (!player) return null;
    const packaged = packagedMp4(player);
    if (packaged) return packaged;
    const id = (player.getAttribute('post-id') || player.closest('shreddit-post')?.id || '').replace(/^t3_/, '');
    return /^[a-z0-9]+$/i.test(id) ? fallbackMp4(id) : null;
  }

  // "r-pics 1abc23 A title.mp4": readable, unique per post, and safe on every file system.
  function fileName(el) {
    const player = playerIn(el), post = el.closest?.('shreddit-post');
    const id = (player?.getAttribute('post-id') || post?.id || '').replace(/^t3_/, '');
    const sub = (player?.getAttribute('subreddit-name') || post?.getAttribute('subreddit-prefixed-name') || '').replace(/^r\//i, '');
    const title = player?.getAttribute('post-title') || post?.getAttribute('post-title') || 'video';
    return `${sub ? `r-${sub} ` : ''}${id ? `${id} ` : ''}${title}`;
  }

  // Resolves to {ok, complete, error}; complete is false when the file has no sound but the video does.
  // The background worker does the actual download.
  async function download(el) {
    let src;
    try { src = await source(el); }
    catch (e) { return {ok: false, error: e?.retryAt ? 'Reddit is limiting requests · try again shortly' : e?.message || 'Could not reach Reddit'}; }
    if (!src) return {ok: false, error: 'No downloadable file for this video'};
    try {
      const res = await chrome.runtime.sendMessage({type: 'rf-download', url: src.url, filename: fileName(el)});
      return res?.ok ? {ok: true, complete: src.complete} : {ok: false, error: res?.error || 'Download failed'};
    } catch {
      return {ok: false, error: 'Reload the page to download (the extension was updated)'};
    }
  }

  // ---- picture-in-picture -----------------------------------------------------------------
  async function togglePip(el) {
    const player = playerIn(el), v = videoIn(player || el);
    if (!v) return false;
    // document.pictureInPictureElement is retargeted to the player host; the video's own root has the video.
    const inPip = v.getRootNode().pictureInPictureElement === v || (!!player && document.pictureInPictureElement === player);
    if (inPip) await document.exitPictureInPicture();
    else await v.requestPictureInPicture();
    return true;
  }

  globalThis.RedditFlexVideo = {
    has: el => !!playerIn(el),
    canPip: () => !!document.pictureInPictureEnabled,
    togglePip, download,
    _test: {packagedMp4, fileName, videoIn},
  };

  // On page load every player is fresh, so one that already started is paused. On any later switch
  // (autoplay turned off, or Reddit Flex turned back on) none is: a playing video may be being watched.
  let first = true;
  RF.subscribe(next => {
    s = next;
    if (autoplayOff()) holdAll(first);
    else releasePlayers();
    first = false;
  });
})();
