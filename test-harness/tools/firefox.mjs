// A throwaway headless Firefox (own profile) driven over WebDriver BiDi, for the Firefox runs of the
// suites. FIREFOX_PATH overrides the browser.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const firefoxPath = () => process.env.FIREFOX_PATH || {
  win32: 'C:/Program Files/Mozilla Firefox/firefox.exe',
  darwin: '/Applications/Firefox.app/Contents/MacOS/firefox',
}[process.platform] || '/usr/bin/firefox';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// prefs: extra about:config prefs for the profile. Resolves to {send, events, newTab, newPrivilegedTab, activate, evaluate, close}.
export async function launch({prefs = {}, width = 1400, height = 900, headless = !process.env.RF_HEADFUL} = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'rf-firefox-'));
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n');
  const ff = spawn(firefoxPath(), [...(headless ? ['--headless'] : []), '--no-remote', '--remote-debugging-port=0', '--remote-allow-system-access', '--profile', profile, `--width=${width}`, `--height=${height}`, 'about:blank'],
    {stdio: ['ignore', 'ignore', 'pipe']});
  const wsUrl = await new Promise((res, rej) => {
    let err = '';
    const t = setTimeout(() => rej(new Error(`Firefox did not start: ${err.slice(-500)}`)), 60000);
    ff.on('error', rej);
    ff.stderr.on('data', d => {
      err += d;
      const m = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(err);
      if (m) { clearTimeout(t); res(m[1]); }
    });
  });
  const ws = new WebSocket(`${wsUrl}/session`);
  await new Promise((res, rej) => { ws.addEventListener('open', res, {once: true}); ws.addEventListener('error', rej, {once: true}); });
  let n = 0;
  const waiting = new Map(), events = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.type === 'error' ? w.rej(new Error(`${m.error}: ${m.message}`)) : w.res(m.result); }
    else if (m.type === 'event') events.push(m);
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++n; waiting.set(id, {res, rej}); ws.send(JSON.stringify({id, method, params})); });
  await send('session.new', {capabilities: {alwaysMatch: {webSocketUrl: true, 'moz:firefoxOptions': {}}}});

  // Runs an expression (awaited) in a tab and returns its value as JSON would.
  const evaluate = async (context, expr) => {
    const r = await send('script.evaluate', {expression: `(async () => JSON.stringify(await (${expr})))()`, target: {context}, awaitPromise: true});
    if (r.type === 'exception') throw new Error(r.exceptionDetails?.text || 'exception');
    return r.result.value === undefined ? undefined : JSON.parse(r.result.value);
  };
  const waitLoaded = async context => {
    for (let i = 0; i < 100; i++) { try { if (await evaluate(context, 'document.readyState') === 'complete') return; } catch {} await sleep(100); }
  };
  const newTab = async url => {
    const {context} = await send('browsingContext.create', {type: 'tab'});
    await send('browsingContext.setViewport', {context, viewport: {width, height}});
    await send('browsingContext.navigate', {context, url, wait: 'complete'});
    await waitLoaded(context);
    return context;
  };
  // A tab at a URL BiDi won't navigate to (moz-extension:), opened from Firefox's own window.
  let tabs = 0;
  const marks = new Map();
  const newPrivilegedTab = async url => {
    const {contexts: before} = await send('browsingContext.getTree', {});
    const {contexts: chromeWins} = await send('browsingContext.getTree', {'moz:scope': 'chrome'});
    const mark = `rf${++tabs}`;
    await send('script.evaluate', {target: {context: chromeWins[0].context}, awaitPromise: false,
      expression: `{ const t = gBrowser.addTab(${JSON.stringify(url)}, {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()}); t.setAttribute('rf-tab', '${mark}'); gBrowser.selectedTab = t; }`});
    let context;
    for (let i = 0; i < 100 && !context; i++) {
      await sleep(100);
      context = (await send('browsingContext.getTree', {})).contexts.find(c => !before.some(b => b.context === c.context) && c.url.startsWith(url.split('/').slice(0, 3).join('/')))?.context;
    }
    if (!context) throw new Error(`no tab for ${url}`);
    await waitLoaded(context);
    marks.set(context, mark);
    return context;
  };
  // Brings a tab to the front (BiDi's own browsingContext.activate refuses privileged tabs).
  const activate = async context => {
    if (!marks.has(context)) return send('browsingContext.activate', {context});
    const {contexts: chromeWins} = await send('browsingContext.getTree', {'moz:scope': 'chrome'});
    await send('script.evaluate', {target: {context: chromeWins[0].context}, awaitPromise: false,
      expression: `gBrowser.selectedTab = gBrowser.tabs.find(t => t.getAttribute('rf-tab') === '${marks.get(context)}')`});
  };
  const close = async () => {
    try { await send('session.end'); } catch {}
    ws.close(); ff.kill();
    await sleep(800);
    try { rmSync(profile, {recursive: true, force: true}); } catch {}
  };
  return {send, events, newTab, newPrivilegedTab, activate, evaluate, close, profile};
}
