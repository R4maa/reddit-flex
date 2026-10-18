// run-suites.mjs for Firefox: runs harness suites in a throwaway headless Firefox at 1400x900.
// usage: node run-suites-firefox.mjs <bundle path or file URL> <fn> [fn...]   (exits 1 on a failure)
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './firefox.mjs';

const [target, ...fns] = process.argv.slice(2);
const url = /^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
// The keyboard suite runs with reduced motion, so its scrolls are instant: on the mock page Firefox
// leaves a smooth scroll of the inline comment box (N / P) unstarted for over a second, though the
// same box in a real Reddit post scrolls smoothly. Only the scroll behavior ('auto') differs.
const ff = await launch({prefs: fns.includes('__kbTest') ? {'ui.prefersReducedMotion': 1} : {}});
let failed = 0;
try {
  const tab = await ff.newTab(url);
  await new Promise(r => setTimeout(r, 500));
  console.log('env', JSON.stringify(await ff.evaluate(tab, '({vis: document.visibilityState, w: innerWidth, h: innerHeight})')));
  for (const fn of fns) {
    let r;
    try { r = await ff.evaluate(tab, `(async () => { const r = await window.${fn}(); return {pass: r.pass, fail: r.fail, failures: r.failures, vis: document.visibilityState}; })()`); }
    catch (e) { r = {error: e.message}; }
    console.log(fn, JSON.stringify(r));
    if (!(r?.pass > 0) || r.fail) failed++;
  }
} finally {
  await ff.close();
}
process.exit(failed ? 1 : 0);
