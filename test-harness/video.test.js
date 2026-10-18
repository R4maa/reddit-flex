// Assertions for unit 7 (video.js, background.js, and media.js's PiP/Download buttons and floating
// memory), on fixtures shaped like Reddit's shreddit-player (checked on www.reddit.com 2026-10-12).
// Run: `await window.__vdTest()`.
window.__vdTest = async () => {
  const RF = window.RedditFlex, V = window.RedditFlexVideo, B = window.RedditFlexBackground;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const until = async (cond, ms = 2000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(30); return cond(); };
  const errorsBefore = window.__errors.length;
  // (Straight to storage: RF.save would message the fake download worker these tests put in chrome.runtime.)
  const set = async patch => { await chrome.storage.local.set({redditFlex: RF.normalize({...(await RF.read()), ...patch})}); await sleep(80); };
  const main = document.getElementById('main-content');
  const ui = document.getElementById('rf-media-ui').shadowRoot;
  const $ = id => ui.getElementById(id);

  // A player like Reddit's: the <video> inside its shadow root; play state is faked so tests can
  // tell whether something paused it.
  const mp4 = (w, h, codec, name) => ({source: {url: `https://packaged-media.redd.it/abc/pb/${name}.mp4?s=1`, dimensions: {width: w, height: h}, videoCodec: codec}});
  const PACKAGED = JSON.stringify({playbackMp4s: {permutations: [mp4(720, 1280, 'VP9', 'vp9-1280'), mp4(270, 480, 'H264', 'h264-480'), mp4(720, 1280, 'H264', 'h264-1280'), mp4(480, 854, 'H264', 'h264-854')]}});
  function player({id = 'pv1', packaged = PACKAGED, autoplay = true, playing = false} = {}) {
    const p = document.createElement('shreddit-player');
    p.setAttribute('post-id', `t3_${id}`);
    p.setAttribute('subreddit-name', 'videos');
    p.setAttribute('post-title', 'A "great" clip: part 1/2');
    if (packaged) p.setAttribute('packaged-media-json', packaged);
    if (autoplay) p.setAttribute('autoplay', '');
    p.style.cssText = 'display:block;width:560px;height:315px;background:#123';
    const inner = document.createElement('div');
    p.attachShadow({mode: 'open'}).append(inner);
    const deep = inner.attachShadow({mode: 'open'}); // a few roots down, like Reddit's
    const v = document.createElement('video');
    v.style.cssText = 'width:100%;height:100%';
    deep.append(v);
    let state = playing;
    Object.defineProperty(v, 'paused', {get: () => !state, configurable: true});
    v.play = () => { state = true; return Promise.resolve(); };
    v.pause = () => { state = false; };
    p.__video = v;
    return p;
  }
  function post(p, id) {
    const art = document.createElement('article');
    art.innerHTML = `<shreddit-post id="t3_${id}" post-title="A clip" subreddit-prefixed-name="r/videos" post-type="video" view-context="SubredditFeed" permalink="/r/videos/comments/${id}/x/"><div slot="post-media-container"></div></shreddit-post>`;
    art.querySelector('[slot]').append(p);
    return art;
  }

  // 0. Settings and helpers
  ok('autoplay defaults on', RF.defaults.autoplay === true);
  const pick = V._test.packagedMp4(player());
  ok('the largest H.264 mp4 is chosen (sound and picture, plays everywhere)', pick?.url.includes('h264-1280') && pick.complete === true, pick);
  ok('without H.264 the largest of any codec is used', V._test.packagedMp4(player({packaged: JSON.stringify({playbackMp4s: {permutations: [mp4(480, 854, 'VP9', 'a'), mp4(720, 1280, 'VP9', 'b')]}})}))?.url.includes('/b.mp4'));
  ok('broken or missing JSON gives nothing', V._test.packagedMp4(player({packaged: '{oops'})) === null && V._test.packagedMp4(player({packaged: ''})) === null);
  ok('non-https entries are ignored', V._test.packagedMp4(player({packaged: JSON.stringify({playbackMp4s: {permutations: [{source: {url: 'http://x/a.mp4', videoCodec: 'H264'}}]}})})) === null);
  ok('the file name has the subreddit, id and title', V._test.fileName(player()) === 'r-videos pv1 A "great" clip: part 1/2', V._test.fileName(player()));
  ok('the video is found through nested shadow roots', V._test.videoIn(player()) instanceof HTMLVideoElement);

  // 1. Background worker: only Reddit's video hosts, safe names, only from Reddit tabs
  ok('Reddit video hosts are allowed', B.videoUrl('https://packaged-media.redd.it/a/pb/x.mp4?s=1') && B.videoUrl('https://v.redd.it/a/DASH_720.mp4'));
  ok('other hosts, http, look-alikes and credentials are refused', [
    'http://v.redd.it/a.mp4', 'https://v.redd.it.evil.com/a.mp4', 'https://evil.com/v.redd.it/a.mp4', 'https://u:p@v.redd.it/a.mp4', 'javascript:alert(1)', 'file:///C:/x', '', null,
  ].every(u => B.videoUrl(u) === null));
  ok('file names lose characters Windows forbids', B.safeName('a<b>c:d"e/f\\g|h?i*j\u0001k') === 'a b c d e f g h i j k.mp4', B.safeName('a<b>c:d"e/f\\g|h?i*j\u0001k'));
  ok('...and leading/trailing dots and spaces, and are kept short', B.safeName('../../etc/passwd') === 'etc passwd.mp4' && B.safeName(' x. ') === 'x.mp4' && B.safeName('y'.repeat(400)).length === 124, B.safeName('../../etc/passwd'));
  ok('explicit ports on the video hosts are refused', B.videoUrl('https://packaged-media.redd.it:8443/a.mp4') === null && B.videoUrl('https://v.redd.it:443/a.mp4') === 'https://v.redd.it/a.mp4');
  ok('Windows device names are made safe', B.safeName('CON') === 'reddit CON.mp4' && B.safeName('lpt1') === 'reddit lpt1.mp4' && B.safeName('Console wars') === 'Console wars.mp4');
  ok('...also with something after a dot', B.safeName('NUL.clip') === 'reddit NUL.clip.mp4' && B.safeName('aux.cable review') === 'reddit aux.cable review.mp4' && B.safeName('com1.x') === 'reddit com1.x.mp4' && B.safeName('auxiliary.x') === 'auxiliary.x.mp4', [B.safeName('NUL.clip'), B.safeName('auxiliary.x')]);
  ok('a title already ending in .mp4 does not get it twice', B.safeName('clip.MP4') === 'clip.mp4' && B.safeName('a.mp4 ') === 'a.mp4', B.safeName('clip.MP4'));
  const emoji = B.safeName('a'.repeat(119) + '\u{1F600}\u{1F600}');
  ok('shortening never splits a character', emoji === 'a'.repeat(119) + '\u{1F600}.mp4' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji), emoji);
  ok('an empty name gets a default', B.safeName('') === 'reddit video.mp4' && B.safeName('...') === 'reddit video.mp4');
  const hadRuntime = chrome.runtime;
  chrome.runtime = {id: 'self'};
  const tab = url => ({id: 'self', tab: {url}});
  ok('messages must come from this extension on a Reddit tab', B.fromReddit(tab('https://www.reddit.com/r/x/')) && B.fromReddit(tab('https://sh.reddit.com/')) &&
    !B.fromReddit({id: 'other', tab: {url: 'https://www.reddit.com/'}}) && !B.fromReddit(tab('https://evil.com/')) && !B.fromReddit({id: 'self'}));
  const calls = [];
  const fakeDownloads = {download: async o => { calls.push(o); return 42; }};
  let reply = null;
  const later = B.onMessage({type: 'rf-download', url: 'https://v.redd.it/a/DASH_720.mp4', filename: 'my/clip'}, tab('https://www.reddit.com/'), r => { reply = r; }, fakeDownloads);
  await sleep(20);
  ok('a valid request downloads with a safe name and replies later', later === true && calls[0]?.url === 'https://v.redd.it/a/DASH_720.mp4' && calls[0]?.filename === 'my clip.mp4' && calls[0]?.conflictAction === 'uniquify' && reply?.ok && reply.id === 42, {calls, reply});
  reply = null;
  ok('a bad URL is refused at once without downloading', B.onMessage({type: 'rf-download', url: 'https://evil.com/x.mp4'}, tab('https://www.reddit.com/'), r => { reply = r; }, fakeDownloads) === false && reply?.ok === false && calls.length === 1);
  reply = null;
  B.onMessage({type: 'rf-download', url: 'https://v.redd.it/a.mp4'}, tab('https://evil.com/'), r => { reply = r; }, fakeDownloads);
  ok('a request from a non-Reddit tab is refused', reply?.ok === false && calls.length === 1);
  ok('other messages are ignored', B.onMessage({type: 'other'}, tab('https://www.reddit.com/'), () => {}, fakeDownloads) === false);
  reply = null;
  B.onMessage({type: 'rf-download', url: 'https://v.redd.it/a.mp4'}, tab('https://www.reddit.com/'), r => { reply = r; }, {download: async () => { throw new Error('Invalid filename'); }});
  await sleep(20);
  ok('a failed download reports its error', reply?.ok === false && reply.error === 'Invalid filename', reply);

  // 2. download(): packaged mp4, fallback, errors
  const sent = [];
  chrome.runtime = {id: 'self', sendMessage: async m => { sent.push(m); return {ok: true, id: 1}; }};
  const p1 = player({autoplay: false}), a1 = post(p1, 'pv1');
  main.append(a1);
  let res = await V.download(p1.parentElement);
  ok('download sends the best mp4 and a readable name', res.ok && res.complete && sent[0]?.type === 'rf-download' && sent[0].url.includes('h264-1280') && sent[0].filename === 'r-videos pv1 A "great" clip: part 1/2', {res, sent});
  const acc = window.RedditFlexAccordion, realFetch = acc.fetch, asked = [];
  const json = data => async url => { asked.push(String(url)); return new Response(JSON.stringify(data), {status: 200}); };
  const listing = rv => [{data: {children: [{data: {secure_media: rv ? {reddit_video: rv} : null}}]}}];
  const p2 = player({id: 'pv2', packaged: null, autoplay: false});
  main.append(post(p2, 'pv2'));
  acc.fetch = json(listing({fallback_url: 'https://v.redd.it/pv2/DASH_720.mp4', has_audio: true}));
  res = await V.download(p2);
  ok('without packaged mp4s the post\'s fallback_url is used, through redditFetch', res.ok && sent.at(-1).url === 'https://v.redd.it/pv2/DASH_720.mp4' && /\/comments\/pv2\.json/.test(asked[0]), {res, asked});
  ok('...and flagged as missing its sound when the video has sound', res.complete === false);
  acc.fetch = json(listing({fallback_url: 'https://v.redd.it/pv2/DASH_480.mp4', has_audio: false}));
  ok('a video with no sound track is complete', (await V.download(p2)).complete === true);
  acc.fetch = json([{data: {children: [{data: {crosspost_parent_list: [{secure_media: {reddit_video: {fallback_url: 'https://v.redd.it/orig/DASH_1080.mp4', has_audio: false}}}]}}]}}]);
  await V.download(p2);
  ok('a crosspost uses the original post\'s video', sent.at(-1).url === 'https://v.redd.it/orig/DASH_1080.mp4');
  acc.fetch = json(listing({fallback_url: 'https://v.redd.it/pv2/DASH_360.mp4'}));
  ok('when Reddit does not say whether it has sound, the download is flagged as without sound', (await V.download(p2)).complete === false);
  acc.fetch = json([{data: {children: [{data: {crosspost_parent_list: [{secure_media: null}], secure_media: {reddit_video: {fallback_url: 'https://v.redd.it/own/DASH_720.mp4', has_audio: false}}}}]}}]);
  await V.download(p2);
  ok('a crosspost whose original has no video uses its own', sent.at(-1).url === 'https://v.redd.it/own/DASH_720.mp4', sent.at(-1));
  acc.fetch = undefined;
  const realGlobalFetch = window.fetch; let rawFetches = 0;
  window.fetch = async (...a) => { rawFetches++; return realGlobalFetch(...a); };
  res = await V.download(p2);
  window.fetch = realGlobalFetch;
  ok('without redditFetch there is no unthrottled request, just an error', !res.ok && rawFetches === 0, {res, rawFetches});
  acc.fetch = json(listing(null));
  res = await V.download(p2);
  ok('no video file at all gives a clear error', !res.ok && /No downloadable file/.test(res.error), res);
  acc.fetch = async () => new Response('', {status: 404});
  res = await V.download(p2);
  ok('a failed lookup reports Reddit\'s answer', !res.ok && /404/.test(res.error), res);
  acc.fetch = async () => { const e = new Error('rate limited'); e.retryAt = Date.now() + 60000; throw e; };
  res = await V.download(p2);
  ok('being rate limited says so plainly', !res.ok && res.error === 'Reddit is limiting requests · try again shortly', res);
  acc.fetch = realFetch;
  chrome.runtime = {id: 'self', sendMessage: async () => ({ok: false, error: 'Not a Reddit video'})};
  res = await V.download(p1);
  ok('a refusal from the worker is passed on', !res.ok && res.error === 'Not a Reddit video');
  chrome.runtime = {id: 'self', sendMessage: async () => { throw new Error('Extension context invalidated.'); }};
  res = await V.download(p1);
  ok('a reloaded extension asks for a page reload', !res.ok && /Reload the page/.test(res.error));
  ok('a non-video is not downloadable', !(await V.download(document.createElement('div'))).ok && !V.has(document.createElement('div')));

  // 3. The bar: PiP and Download only on videos; Download shows what happened
  chrome.runtime = {id: 'self', sendMessage: async m => { sent.push(m); return {ok: true, id: 2}; }};
  const slot1 = p1.parentElement;
  slot1.scrollIntoView({block: 'center'}); await sleep(100);
  const hover = el => { const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerover', {bubbles: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2})); };
  hover(p1);
  ok('hovering a video shows the bar with Download', await until(() => !$('box').hidden && !$('save').hidden), {box: $('box').hidden, save: $('save').hidden});
  ok('PiP shows when the browser supports it', $('pip').hidden === !document.pictureInPictureEnabled);
  const before = sent.length;
  $('save').click();
  ok('Download says it started', await until(() => !$('msg').hidden && $('msg').textContent === 'Download started') && sent.length === before + 1, $('msg').textContent);
  ok('the button is usable again afterwards', !$('save').disabled);
  // A video only available as its picture says so.
  acc.fetch = json(listing({fallback_url: 'https://v.redd.it/pv2/DASH_720.mp4', has_audio: true}));
  p2.parentElement.scrollIntoView({block: 'center'}); await sleep(100);
  hover(p2); await until(() => !$('box').hidden && !$('save').hidden);
  $('save').click();
  ok('a download without sound says so', await until(() => !$('msg').hidden && /^Download started, without sound/.test($('msg').textContent)) && sent.at(-1).url === 'https://v.redd.it/pv2/DASH_720.mp4', $('msg').textContent);
  acc.fetch = json(listing(null));
  $('save').click();
  ok('a failure shows its reason', await until(() => /No downloadable file/.test($('msg').textContent)) && !$('save').disabled, $('msg').textContent);
  acc.fetch = realFetch;
  const plainMedia = [...document.querySelectorAll('shreddit-post [slot="post-media-container"]')].find(el => !el.querySelector('shreddit-player') && el.querySelector('img,video,gallery-carousel'));
  if (plainMedia) {
    plainMedia.scrollIntoView({block: 'center'}); await sleep(100);
    hover(plainMedia);
    // (The bar re-renders on the next frame, so wait for it to settle on the new media.)
    ok('other media get no PiP or Download', await until(() => !$('box').hidden && $('save').hidden && $('pip').hidden));
  } else ok('the mock has other media to compare with', false);

  // 4. Picture-in-picture
  const v1 = p1.__video, root1 = v1.getRootNode();
  let pipIn = 0, pipOut = 0;
  v1.requestPictureInPicture = async () => { pipIn++; };
  const realExit = document.exitPictureInPicture;
  document.exitPictureInPicture = async () => { pipOut++; };
  await V.togglePip(slot1);
  ok('PiP asks for the video inside the player', pipIn === 1 && pipOut === 0);
  // In PiP, document.pictureInPictureElement is the player host; the video's own root holds the video.
  Object.defineProperty(root1, 'pictureInPictureElement', {get: () => v1, configurable: true});
  await V.togglePip(slot1);
  ok('pressed again it leaves PiP', pipOut === 1 && pipIn === 1);
  delete root1.pictureInPictureElement;
  // Also leaves when only the document's (retargeted) value shows the player is in PiP.
  Object.defineProperty(document, 'pictureInPictureElement', {get: () => p1, configurable: true});
  await V.togglePip(slot1);
  ok('...also when only the document reports the player in PiP', pipOut === 2 && pipIn === 1);
  delete document.pictureInPictureElement;
  await V.togglePip(slot1);
  ok('not in PiP, it enters again', pipIn === 2 && pipOut === 2);
  document.exitPictureInPicture = realExit;
  ok('PiP on something without a video does nothing', (await V.togglePip(document.createElement('div'))) === false);

  // 5. The floating window remembers its width and spot; Reset media forgets them
  const stored = async () => (await chrome.storage.local.get('redditFlexFloat')).redditFlexFloat;
  slot1.scrollIntoView({block: 'center'}); await sleep(100);
  hover(p1); await until(() => !$('box').hidden);
  $('pop').click(); await sleep(150);
  const fl = () => document.querySelector('[data-rf-floating]');
  ok('Pop out floats the player', fl() === slot1);
  const r0 = slot1.getBoundingClientRect();
  hover(slot1);
  const g = $('grip').getBoundingClientRect(), po = {bubbles: true, composed: true, pointerId: 9, button: 0, isPrimary: true};
  $('grip').dispatchEvent(new PointerEvent('pointerdown', {...po, clientX: g.left + 5, clientY: g.top + 5}));
  for (let i = 1; i <= 5; i++) window.dispatchEvent(new PointerEvent('pointermove', {...po, clientX: g.left + 5 - 40 * i, clientY: g.top + 5 - 30 * i}));
  window.dispatchEvent(new PointerEvent('pointerup', {...po, clientX: g.left + 5 - 200, clientY: g.top + 5 - 150}));
  await sleep(100);
  const r1 = slot1.getBoundingClientRect(), saved = await stored();
  ok('dragging it moved it', Math.round(r0.left - r1.left) === 200 && Math.round(r0.top - r1.top) === 150, [r0.left, r1.left, r0.top, r1.top]);
  ok('where it was left is saved', saved && saved.x === Math.round(r1.left) && saved.y === Math.round(r1.top) && saved.w === Math.round(r1.width), saved);
  // Resizing from the keyboard and Ctrl + wheel are remembered too (the wheel after it settles).
  ui.querySelector('.h.se').dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, composed: true}));
  await sleep(50);
  const rk = slot1.getBoundingClientRect(), savedK = await stored();
  const shadowStyle = () => !!p1.shadowRoot.querySelector('style[data-rf-shadow]');
  ok('a resized player gets the fill style in its shadow root', shadowStyle());
  ok('a keyboard resize is saved', Math.round(rk.width) === Math.round(r1.width) + 20 && savedK?.w === Math.round(rk.width) && savedK.x === Math.round(rk.left), {rk: [rk.left, rk.width], savedK});
  const wheelAt = slot1.getBoundingClientRect();
  p1.dispatchEvent(new WheelEvent('wheel', {deltaY: -100, ctrlKey: true, bubbles: true, composed: true, cancelable: true, clientX: wheelAt.left + wheelAt.width / 2, clientY: wheelAt.top + wheelAt.height / 2}));
  await sleep(50);
  ok('...a wheel zoom is not saved at once', (await stored()).w === savedK.w);
  await sleep(400);
  const rw = slot1.getBoundingClientRect(), last = await stored();
  ok('...but once it settles', rw.width > rk.width + 50 && last.w === Math.round(rw.width) && last.x === Math.round(rw.left) && last.y === Math.round(rw.top), {rw: [rw.left, rw.top, rw.width], last});
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(100);
  ok('Esc docks it', !fl());
  const p3 = player({id: 'pv3', autoplay: false}), a3 = post(p3, 'pv3');
  p3.style.width = '400px'; p3.style.height = '400px'; // a square video this time; on Reddit the slot fits it
  a3.querySelector('[slot]').style.width = '400px';
  main.append(a3);
  p3.parentElement.scrollIntoView({block: 'center'}); await sleep(100);
  hover(p3); await until(() => !$('box').hidden);
  $('pop').click(); await sleep(150);
  const r3 = p3.parentElement.getBoundingClientRect();
  // A square video at that width is taller than the last one; it is kept inside the window (12px gap).
  ok('the next Pop out opens at the same spot and width, kept inside the window', !!last && Math.round(r3.left) === last.x && Math.round(r3.width) === last.w &&
    Math.round(r3.top) === Math.min(last.y, Math.round(innerHeight - r3.height - 12)) && r3.bottom <= innerHeight - 11, [r3.left, r3.top, r3.width, r3.height, last]);
  ok('...keeping the new video\'s own proportions', Math.abs(r3.width / r3.height - 1) < 0.02, r3.width / r3.height);
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(50);
  // Another tab moving its floating window changes where this tab's next Pop out goes.
  await chrome.storage.local.set({redditFlexFloat: {w: 300, x: 100, y: 120}}); await sleep(50);
  p3.parentElement.scrollIntoView({block: 'center'}); await sleep(100);
  hover(p3); await until(() => !$('box').hidden);
  $('pop').click(); await sleep(150);
  const rt = p3.parentElement.getBoundingClientRect();
  ok('a spot saved by another tab is used here', Math.round(rt.left) === 100 && Math.round(rt.top) === 120 && Math.round(rt.width) === 300, [rt.left, rt.top, rt.width]);
  ok('...and a broken saved value is ignored', await (async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})); await sleep(50);
    await chrome.storage.local.set({redditFlexFloat: {w: 'x', x: 1, y: 1}}); await sleep(50);
    hover(p3); await until(() => !$('box').hidden);
    $('pop').click(); await sleep(150);
    const r = p3.parentElement.getBoundingClientRect();
    return Math.round(innerWidth - r.right) === 24 && Math.round(innerHeight - r.bottom) === 24;
  })());
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(50);
  await RF.requestReset(); await sleep(100);
  ok('Reset media forgets it', (await stored()) === undefined);
  ok('...and takes the fill style out of the player again', !shadowStyle());
  p3.parentElement.scrollIntoView({block: 'center'}); await sleep(100);
  hover(p3); await until(() => !$('box').hidden);
  $('pop').click(); await sleep(150);
  const r4 = p3.parentElement.getBoundingClientRect();
  ok('...so Pop out goes back to the corner', Math.round(innerWidth - r4.right) === 24 && Math.round(innerHeight - r4.bottom) === 24, [innerWidth - r4.right, innerHeight - r4.bottom]);
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  await sleep(50);

  // 6. Autoplay
  const pA = player({id: 'pa', playing: true});
  main.append(post(pA, 'pa'));
  await set({autoplay: false});
  ok('switching autoplay off holds players already on the page', !pA.hasAttribute('autoplay') && pA.hasAttribute('data-rf-autoplay'));
  ok('...without pausing one that is playing (you may be watching it)', !pA.__video.paused);
  const pB = player({id: 'pb', playing: true});
  main.append(post(pB, 'pb'));
  ok('a new player is held as it arrives', await until(() => !pB.hasAttribute('autoplay')) && pB.hasAttribute('data-rf-autoplay'));
  ok('...and stopped if it already started by itself', pB.__video.paused);
  pB.__video.play();
  pB.setAttribute('autoplay', ''); // Reddit re-rendering the player
  ok('an autoplay attribute put back by Reddit is taken away again', await until(() => !pB.hasAttribute('autoplay')));
  ok('...without stopping a video the user started', !pB.__video.paused);
  const pC = player({id: 'pc', autoplay: false});
  main.append(post(pC, 'pc')); await sleep(50);
  ok('a player without autoplay is left alone', !pC.hasAttribute('data-rf-autoplay'));
  await set({autoplay: true});
  ok('switching autoplay on gives held players their attribute back', pA.hasAttribute('autoplay') && pB.hasAttribute('autoplay') && !document.querySelector('[data-rf-autoplay]'));
  ok('...and only to those we held', !pC.hasAttribute('autoplay'));
  const pD = player({id: 'pd', playing: true});
  main.append(post(pD, 'pd')); await sleep(50);
  ok('with autoplay on, new players are untouched', pD.hasAttribute('autoplay') && !pD.__video.paused);
  await set({autoplay: false});
  ok('(pD held)', !pD.hasAttribute('autoplay') && pD.hasAttribute('data-rf-autoplay'));
  await set({enabled: false});
  ok('turning Reddit Flex off gives held players their autoplay back', pD.hasAttribute('autoplay') && !document.querySelector('[data-rf-autoplay]'));
  const pE = player({id: 'pe', playing: true});
  main.append(post(pE, 'pe')); await sleep(50);
  ok('with Reddit Flex off, autoplay is never touched', pE.hasAttribute('autoplay') && !pE.hasAttribute('data-rf-autoplay') && !pE.__video.paused);
  await set({enabled: true});
  ok('back on, it holds them again', !pD.hasAttribute('autoplay') && !pE.hasAttribute('autoplay'));
  ok('...without pausing the one that was playing', !pE.__video.paused);
  // Page load with autoplay already off: a second copy of video.js gets its first settings by hand.
  await set({autoplay: true}); // so the running copy leaves pF alone
  const pF = player({id: 'pf', playing: true});
  main.append(post(pF, 'pf')); await sleep(50);
  ok('(pF untouched and playing)', pF.hasAttribute('autoplay') && !pF.__video.paused);
  const src = [...document.scripts].find(el => el.textContent.includes('/* Videos: autoplay control'))?.textContent;
  const realSub = RF.subscribe, realApi = window.RedditFlexVideo;
  let first = null;
  RF.subscribe = fn => { first = fn; };
  delete window.__rfVideo;
  try { (0, eval)(src); } finally { RF.subscribe = realSub; window.RedditFlexVideo = realApi; window.__rfVideo = true; }
  first?.({...(await RF.read()), enabled: true, autoplay: false});
  ok('on page load, a player that already started is held and paused', !!src && !pF.hasAttribute('autoplay') && pF.hasAttribute('data-rf-autoplay') && pF.__video.paused);
  first?.({...(await RF.read()), enabled: true, autoplay: true}); // let that copy go quiet
  ok('(released again)', pF.hasAttribute('autoplay'));
  await set({autoplay: true});

  // Clean up
  for (const id of ['pv1', 'pv2', 'pv3', 'pa', 'pb', 'pc', 'pd', 'pe', 'pf']) document.getElementById(`t3_${id}`)?.closest('article')?.remove();
  if (hadRuntime) chrome.runtime = hadRuntime; else delete chrome.runtime;
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
