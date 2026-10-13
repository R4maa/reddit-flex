// Runs harness suites in a throwaway headless Chrome (own profile) at 1400x900.
// usage: node run-suites.mjs <bundle path or file URL> <fn> [fn...]
// Exits 1 when an assertion fails or a suite can't run. CHROME_PATH overrides the browser.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const chromePath = () => process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || '/usr/bin/google-chrome';
// (CI runners on Ubuntu 24.04 don't allow Chrome's sandbox.)
const chromeFlags = () => (process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []);

const [target, ...fns] = process.argv.slice(2);
const url = /^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
const profile = mkdtempSync(join(tmpdir(), 'rf-headless-'));
const chrome = spawn(chromePath(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1400,900', ...chromeFlags(),
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
await sleep(200);
const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const waiting = new Map(); const events = [];
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } else events.push(m); });
const send = (method, params = {}) => new Promise(r => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async expr => { const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 }); return m.result?.result?.value ?? m.result?.exceptionDetails?.exception?.description ?? m; };
await send('Page.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) { if (await evaluate('document.readyState') === 'complete') break; await sleep(100); }
await sleep(500);
console.log('env', JSON.stringify(await evaluate('({vis: document.visibilityState, w: innerWidth, h: innerHeight})')));
let failed = 0;
for (const fn of fns) {
  const r = await evaluate(`(async () => { const r = await window.${fn}(); return {pass: r.pass, fail: r.fail, failures: r.failures, vis: document.visibilityState}; })()`);
  console.log(fn, JSON.stringify(r));
  if (!(r?.pass > 0) || r.fail) failed++;
}
ws.close(); chrome.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
