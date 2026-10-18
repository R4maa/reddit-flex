// Real-Firefox check of settings sync (sync-scenario.mjs): builds the Firefox version, installs it as
// a temporary add-on in a throwaway headless Firefox, and drives two popup tabs against its real
// event page and storage.sync (Firefox's own quota checks).
// usage: node test-harness/tools/real-firefox.mjs   (FIREFOX_PATH overrides the browser; exits 1 on a failure)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './firefox.mjs';
import { syncScenario } from './sync-scenario.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
execFileSync('node', ['test-harness/tools/build-firefox.mjs'], {cwd: root, stdio: 'inherit'});
const ID = 'reddit-flex@r4maa', UUID = '1b4e28ba-2fa1-11d2-883f-0016d3cca427';
const ff = await launch({prefs: {'extensions.webextensions.uuids': JSON.stringify({[ID]: UUID})}});
setTimeout(async () => { console.log('ERROR timed out'); await ff.close(); process.exit(1); }, 300000).unref();
const results = [];
const ok = (name, cond, info) => { results.push({name, pass: !!cond}); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + JSON.stringify(info)}`); };

try {
  const {extension} = await ff.send('webExtension.install', {extensionData: {type: 'path', path: fileURLToPath(new URL('../../dist/firefox', import.meta.url))}});
  console.log('extension', extension);
  await syncScenario({
    open: async () => { const tab = await ff.newPrivilegedTab(`moz-extension://${UUID}/popup.html`); await new Promise(r => setTimeout(r, 300)); return tab; },
    evaluate: (tab, fn) => ff.evaluate(tab, `(${fn})()`),
    front: tab => ff.activate(tab),
  }, ok);
} catch (e) {
  console.log('ERROR', e.message);
  results.push({name: 'run', pass: false});
} finally {
  const fail = results.filter(r => !r.pass).length;
  console.log(`${results.length - fail} passed, ${fail} failed`);
  await ff.close();
  process.exit(fail ? 1 : 0);
}
