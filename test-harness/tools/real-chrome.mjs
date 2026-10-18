// Real-Chrome check of settings sync (sync-scenario.mjs): a throwaway headless Chrome (own empty
// profile) with the unpacked extension loaded, its real background worker and chrome.storage.sync
// (Chrome's own quota checks), and two popup tabs.
// (Chrome 137+ ignores --load-extension, so the extension is loaded over the DevTools pipe.)
// usage: node test-harness/tools/real-chrome.mjs   (CHROME_PATH overrides the browser; exits 1 on a failure)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncScenario } from './sync-scenario.mjs';

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
  const browser = {
    open: async () => {
      const {targetId} = await send('Target.createTarget', {url: `chrome-extension://${id}/popup.html`});
      const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
      await send('Runtime.enable', {}, sessionId);
      for (let i = 0; i < 50 && (await evaluate(sessionId, '() => document.readyState')) !== 'complete'; i++) await sleep(100);
      await sleep(300);
      if (!workerSession) {
        const {targetInfos} = await send('Target.getTargets');
        const sw = targetInfos.find(t => t.type === 'service_worker' && t.url.includes(id));
        if (sw) { workerSession = (await send('Target.attachToTarget', {targetId: sw.targetId, flatten: true})).sessionId; await send('Runtime.enable', {}, workerSession); }
        ok('the background worker is running', !!sw, targetInfos.map(t => [t.type, t.url]));
        const quotas = await evaluate(sessionId, '() => [chrome.storage.sync.QUOTA_BYTES, chrome.storage.sync.QUOTA_BYTES_PER_ITEM, chrome.storage.sync.MAX_ITEMS, chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE, chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR]');
        ok("Chrome's sync quotas are the ones the code assumes", JSON.stringify(quotas) === '[102400,8192,512,120,1800]', quotas);
      }
      return sessionId;
    },
    evaluate,
    front: sessionId => send('Page.bringToFront', {}, sessionId),
  };
  await syncScenario(browser, ok);
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
