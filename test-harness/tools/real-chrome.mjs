// Real-Chrome check of settings sync: a throwaway headless Chrome (own empty profile) with the
// unpacked extension loaded, its real background worker and chrome.storage.sync (Chrome's own quota
// checks), and two popup tabs. Another computer is simulated by writing chrome.storage.sync items.
// (Chrome 137+ ignores --load-extension, so the extension is loaded over the DevTools pipe.)
// usage: node test-harness/tools/real-chrome.mjs   (CHROME_PATH overrides the browser; exits 1 on a failure)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../../reddit-flex-v2', import.meta.url));
const profile = mkdtempSync(join(tmpdir(), 'rf-real-'));
const chromePath = process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || '/usr/bin/google-chrome';
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`,
  ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []), // (CI runners on Ubuntu 24.04 don't allow Chrome's sandbox)
  '--no-first-run', '--no-default-browser-check', '--window-size=1200,900', 'about:blank'], {stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']});
chrome.on('error', e => { console.log('ERROR starting Chrome:', e.message); process.exit(1); });
setTimeout(() => { console.log('ERROR timed out'); chrome.kill(); process.exit(1); }, 300000).unref();
const toChrome = chrome.stdio[3], fromChrome = chrome.stdio[4];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0, buf = '';
const waiting = new Map(), workerErrors = [];
fromChrome.on('data', d => {
  buf += d.toString();
  for (let i; (i = buf.indexOf('\0')) >= 0; buf = buf.slice(i + 1)) {
    const m = JSON.parse(buf.slice(0, i));
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result); }
    else if (m.sessionId && m.sessionId === workerSession) {
      if (m.method === 'Runtime.exceptionThrown') workerErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') workerErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    }
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = ++n;
  waiting.set(id, {res, rej});
  toChrome.write(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}) + '\0');
});
const evaluate = async (sessionId, fn) => {
  const r = await send('Runtime.evaluate', {expression: `(${fn})()`, awaitPromise: true, returnByValue: true}, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
let workerSession = null;
const results = [];
const ok = (name, cond, info) => { results.push({name, pass: !!cond}); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + JSON.stringify(info)}`); };

try {
  const {id} = await send('Extensions.loadUnpacked', {path: EXT});
  console.log('extension', id);
  const open = async () => {
    const {targetId} = await send('Target.createTarget', {url: `chrome-extension://${id}/popup.html`});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    await send('Runtime.enable', {}, sessionId);
    for (let i = 0; i < 50 && (await evaluate(sessionId, '() => document.readyState')) !== 'complete'; i++) await sleep(100);
    await sleep(300);
    // Helpers in the page: read sync's per-setting items back, wait for a condition.
    await evaluate(sessionId, `() => {
      const LISTS = ['filterKeywords', 'filterSubs', 'filterUsers'];
      window.$ = id => document.getElementById(id);
      window.T = {
        sync: () => chrome.storage.sync.get(null),
        local: async () => RedditFlex.normalize((await chrome.storage.local.get('redditFlex')).redditFlex),
        all: () => chrome.storage.local.get(null),
        synced: async () => {
          const all = await chrome.storage.sync.get(null), out = {}, waiting = [];
          for (const k of Object.keys(RedditFlex.defaults)) {
            const h = all['redditFlex.' + k];
            if (h === undefined) continue;
            if (!LISTS.includes(k)) { out[k] = h; continue; }
            const parts = Array.from({length: h.n}, (_, i) => all['redditFlex.' + k + '.' + h.id + '.' + i]);
            if (parts.every(Array.isArray)) out[k] = parts.flat(); else waiting.push(k);
          }
          return {out, waiting, keys: Object.keys(all)};
        },
        until: async (cond, ms = 8000) => { const t0 = Date.now(); while (!(await cond()) && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return !!(await cond()); },
        lines: (n, c) => Array.from({length: n}, (_, i) => (i + ' ').padEnd(300, c)),
      };
    }`);
    return sessionId;
  };
  const A = await open(), B = await open();
  const {targetInfos} = await send('Target.getTargets');
  const sw = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(id));
  if (sw) { workerSession = (await send('Target.attachToTarget', {targetId: sw.targetId, flatten: true})).sessionId; await send('Runtime.enable', {}, workerSession); }
  ok('the background worker is running', !!sw, targetInfos.map(t => [t.type, t.url]));

  const quotas = await evaluate(A, '() => [chrome.storage.sync.QUOTA_BYTES, chrome.storage.sync.QUOTA_BYTES_PER_ITEM, chrome.storage.sync.MAX_ITEMS, chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE, chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR]');
  ok('Chrome\'s sync quotas are the ones the code assumes', JSON.stringify(quotas) === '[102400,8192,512,120,1800]', quotas);

  // 1. Turning on from the popup (nothing synced yet): uploads, one item per setting
  let r = await evaluate(A, `async () => {
    $('sync').click();
    await T.until(() => !$('sync').disabled && $('sync').checked);
    const all = await T.all(), s = await T.synced();
    return {area: all.redditFlexArea, base: !!all.redditFlexSyncBase, keys: s.keys.length, width: s.out.width, note: $('syncNote').textContent, id: chrome.runtime.id};
  }`);
  ok('turning on from the popup uploads, one item per setting', r.area === 'sync' && r.base && r.keys >= 30 && r.width === 900, r);
  ok('...and the note names this extension ID', r.note.startsWith('On. Another computer shares') && r.note.includes(r.id), r.note);
  ok('the other popup tab follows', await evaluate(B, `() => T.until(() => $('sync').checked)`));

  // 2. A change in one popup goes to sync; the other popup follows
  r = await evaluate(A, `async () => { $('hideTrending').click(); return T.until(async () => (await T.synced()).out.hideTrending === true); }`);
  ok('a change made in the popup goes to sync', r);
  ok('...and the other popup shows it', await evaluate(B, `() => T.until(() => $('hideTrending').checked)`));

  // 3. Another computer changes a setting
  r = await evaluate(B, `async () => { await chrome.storage.sync.set({'redditFlex.width': 1234}); return T.until(async () => (await T.local()).width === 1234); }`);
  ok('a change from another computer arrives here', r);
  ok('...and the popup shows it', await evaluate(A, `() => T.until(() => $('widthOut').textContent === '1234px')`), await evaluate(A, `() => $('widthOut').textContent`));

  // 4. Different settings changed here and there at once: both kept
  r = await evaluate(A, `async () => {
    const s = await T.local();
    RedditFlex.save({...s, hideLeft: !s.hideLeft});
    await chrome.storage.sync.set({'redditFlex.commentSort': 'new'});
    const want = !s.hideLeft;
    const done = await T.until(async () => { const l = await T.local(), y = (await T.synced()).out; return l.hideLeft === want && l.commentSort === 'new' && y.hideLeft === want && y.commentSort === 'new'; }, 10000);
    return {done, local: await T.local(), synced: (await T.synced()).out};
  }`);
  ok('a change here and a different one from afar at once: both kept, here and in sync', r.done, [r.local.hideLeft, r.local.commentSort, r.synced.hideLeft, r.synced.commentSort]);

  // 5. The same setting: the change made here, not uploaded yet, wins
  r = await evaluate(A, `async () => {
    const tc = !(await T.local()).threadColors;
    RedditFlex.save({...(await T.local()), threadColors: tc}); // a write now...
    await T.until(async () => (await T.synced()).out.threadColors === tc);
    RedditFlex.save({...(await T.local()), width: 1001}); // ...so this upload waits for the gap
    await new Promise(r => setTimeout(r, 50));
    await chrome.storage.sync.set({'redditFlex.width': 1500});
    await new Promise(r => setTimeout(r, 6000));
    return {local: (await T.local()).width, synced: (await T.synced()).out.width};
  }`);
  ok('a setting changed here and not uploaded yet wins over the same setting from afar', r.local === 1001 && r.synced === 1001, r);

  // 6. Writes are spaced (tab A in front, so its own timers aren't throttled like a background tab's)
  await send('Page.bringToFront', {}, A);
  r = await evaluate(A, `async () => {
    const times = [], saves = [];
    chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c['redditFlex.width']) times.push(Date.now()); });
    await new Promise(r => setTimeout(r, 2500));
    for (let i = 0; i < 6; i++) { saves.push(Date.now()); RedditFlex.save({...(await T.local()), width: 1100 + i}); await new Promise(r => setTimeout(r, 300)); }
    await T.until(async () => (await T.synced()).out.width === 1105, 10000);
    await new Promise(r => setTimeout(r, 2500));
    return {gaps: times.map((t, i) => (i ? t - times[i - 1] : 0)), burst: saves.at(-1) - saves[0], synced: (await T.synced()).out.width, vis: document.visibilityState};
  }`);
  ok('changes made in a burst collapse into writes at least 2.1 s apart (one per gap at most), ending with the latest', r.synced === 1105 && r.gaps.length <= Math.ceil(r.burst / 2100) + 1 && r.gaps.slice(1).every(g => g >= 2000), r);

  // 7. Long lists are chunked under 8 KB per item and come back whole
  r = await evaluate(A, `async () => {
    const kw = Array.from({length: 200}, (_, i) => 'keyword number ' + i + ' ' + 'x'.repeat(80));
    RedditFlex.save({...(await T.local()), filterKeywords: kw});
    const done = await T.until(async () => (await T.synced()).out.filterKeywords?.length === 200, 10000);
    const all = await T.sync(), head = all['redditFlex.filterKeywords'];
    const sizes = await Promise.all(Array.from({length: head.n}, (_, i) => chrome.storage.sync.getBytesInUse('redditFlex.filterKeywords.' + head.id + '.' + i)));
    return {done, n: head.n, sizes, same: JSON.stringify((await T.synced()).out.filterKeywords) === JSON.stringify(kw)};
  }`);
  ok('a long list is split into items under 8 KB (by Chrome\'s count) and reads back whole', r.done && r.n >= 3 && r.sizes.every(b => b <= 8192) && r.same, r);

  // 8. Nearly full, then shrink one list and grow another: Chrome's own quota check passes
  r = await evaluate(A, `async () => {
    const subs = n => Array.from({length: n}, (_, i) => ('r/sub' + i).padEnd(300, 's'));
    RedditFlex.save({...(await T.local()), filterKeywords: T.lines(266, 'c'), filterSubs: subs(50)});
    const full = await T.until(async () => (await T.synced()).out.filterKeywords?.length === 266 && (await T.synced()).out.filterSubs?.length === 50, 12000);
    const before = await chrome.storage.sync.getBytesInUse(null);
    RedditFlex.save({...(await T.local()), filterKeywords: T.lines(150, 'c'), filterSubs: subs(88)});
    const done = await T.until(async () => (await T.synced()).out.filterKeywords?.length === 150 && (await T.synced()).out.filterSubs?.length === 88, 12000);
    const all = await T.sync();
    const heads = {filterKeywords: all['redditFlex.filterKeywords'].id, filterSubs: all['redditFlex.filterSubs'].id, filterUsers: all['redditFlex.filterUsers'].id};
    const leftovers = Object.keys(all).filter(k => /\\.\\d+$/.test(k) && k.split('.')[2] !== heads[k.split('.')[1]]);
    return {full, before, done, after: await chrome.storage.sync.getBytesInUse(null), error: (await T.all()).redditFlexSyncError, leftovers};
  }`);
  ok('nearly full sync: shrinking one list and growing another goes through Chrome\'s quota check', r.full && r.done && !r.error && !r.leftovers.length && r.before > 90000, r);

  // 9. Too big: refused, kept here, the popup says why; fitting again clears it
  r = await evaluate(A, `async () => {
    RedditFlex.save({...(await T.local()), filterKeywords: T.lines(500, 'y')});
    const shown = await T.until(() => !$('syncWarn').hidden, 10000);
    return {shown, warn: $('syncWarn').textContent, kept: (await T.local()).filterKeywords.length, synced: (await T.synced()).out.filterKeywords.length};
  }`);
  ok('settings too big for sync: refused, kept here, and the popup says why', r.shown && /^Not synced: Too much to sync: \d+ KB; the limit is 98 KB\. Shorten the filter lists\. Your change is kept on this computer\.$/.test(r.warn) && r.kept === 500 && r.synced === 150, r);
  ok('...the other popup shows it too', await evaluate(B, `() => T.until(() => !$('syncWarn').hidden)`));
  r = await evaluate(A, `async () => {
    RedditFlex.save({...(await T.local()), filterKeywords: T.lines(10, 'c'), filterSubs: []});
    const cleared = await T.until(async () => $('syncWarn').hidden && (await T.synced()).out.filterKeywords?.length === 10, 10000);
    return {cleared, error: (await T.all()).redditFlexSyncError};
  }`);
  ok('...a change that fits clears it and syncs again', r.cleared && !r.error, r);

  // 10. A list from afar arriving in pieces is taken only once all of it is here
  r = await evaluate(B, `async () => {
    await new Promise(r => setTimeout(r, 2500));
    await chrome.storage.sync.set({'redditFlex.filterUsers': {id: 'far', n: 2}, 'redditFlex.filterUsers.far.0': ['u/one']});
    await new Promise(r => setTimeout(r, 2500));
    const half = (await T.local()).filterUsers;
    await chrome.storage.sync.set({'redditFlex.filterUsers.far.1': ['u/two']});
    const whole = await T.until(async () => JSON.stringify((await T.local()).filterUsers) === '["u/one","u/two"]');
    return {half, whole};
  }`);
  ok('a list from afar arriving in pieces is not taken half, then taken whole', JSON.stringify(r.half) === '[]' && r.whole, r);

  // 11. Turning off from the popup; a change while off; turning on again keeps it and says so
  r = await evaluate(A, `async () => {
    await new Promise(r => setTimeout(r, 2500));
    $('sync').click();
    await T.until(() => !$('sync').disabled && !$('sync').checked);
    const all = await T.all();
    return {area: all.redditFlexArea, base: !!all.redditFlexSyncBase, note: $('syncNote').textContent, width: (await T.local()).width};
  }`);
  ok('turning off from the popup keeps the settings here and the last synced ones for next time', r.area === 'local' && r.base && /^Off/.test(r.note) && r.width === 1105, r);
  ok('...the other popup follows', await evaluate(B, `() => T.until(() => !$('sync').checked && /^Off/.test($('syncNote').textContent))`));
  r = await evaluate(B, `async () => {
    const was = $('hideRight').checked;
    $('hideRight').click();
    await new Promise(r => setTimeout(r, 3000));
    return {was, local: (await T.local()).hideRight, synced: (await T.synced()).out.hideRight};
  }`);
  ok('while off, a change stays on this computer', r.local === !r.was && r.synced === r.was, r);
  r = await evaluate(A, `async () => {
    $('sync').click();
    await T.until(() => !$('sync').disabled && $('sync').checked);
    const note = $('syncNote').textContent, want = (await T.local()).hideRight;
    return {note, up: await T.until(async () => (await T.synced()).out.hideRight === want, 8000), id: chrome.runtime.id};
  }`);
  ok('turning on again keeps the change made while off, says so, and uploads it', r.note.startsWith('On. Using the synced settings, plus what you changed here since this computer last synced.') && r.note.includes(r.id) && r.up, r);

  ok('no errors in the background worker', !workerErrors.length, workerErrors);
} catch (e) {
  console.log('ERROR', e.message);
  results.push({name: 'run', pass: false});
} finally {
  const fail = results.filter(r => !r.pass).length;
  console.log(`${results.length - fail} passed, ${fail} failed`);
  chrome.kill();
  await sleep(800);
  try { rmSync(profile, {recursive: true, force: true}); } catch {}
  process.exit(fail ? 1 : 0);
}
