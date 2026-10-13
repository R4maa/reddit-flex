// Mutation check for settings sync: deliberate bugs, each of which a sync or popup test should catch.
// Each mutant runs on its own copy of the extension, built into its own folder, so several run at
// once and the real source is never touched.
// usage: node test-harness/tools/mutate.mjs [mutant name ...]   (RF_JOBS=n at once, default 5)
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const run = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const tools = fileURLToPath(new URL('.', import.meta.url));
const mutants = {
  'upload writes every setting': ['sync.js', 'try { await writeSync(mine, keys); }', 'try { await writeSync(mine, SETTINGS); }'],
  'stale chunks always removed after the set': ['sync.js', 'const first = stale.length > 0 && (sizeOf({...all, ...items}) > SYNC_TOTAL || Object.keys({...all, ...items}).length > MAX_ITEMS);', 'const first = false;'],
  'half-arrived list read as what is there': ['sync.js', 'if (parts.every(Array.isArray)) out[key] = parts.flat();\n      else waiting.push(key);', 'out[key] = parts.filter(Array.isArray).flat();'],
  'list chunks without a version id': ['sync.js', "const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);", "const newId = () => 'v';"],
  'list still arriving uploaded over on turn-on': ['sync.js', 'const newBase = {...remote, ...Object.fromEntries(waiting.map(k => [k, kept.includes(k) ? base[k] : mine[k]]))};', 'const newBase = {...remote};'],
  'pull lets afar win over a change made here': ['sync.js', 'const take = fromAfar.filter(k => !mineToo.includes(k));', 'const take = fromAfar;'],
  'turn-off skips the last pull': ['sync.js', "      await pull();\n      await local.set({[AREA_KEY]: 'local'});", "      await local.set({[AREA_KEY]: 'local'});"],
  'turn-on merge skips size check': ['sync.js', 'toSync(out); // too big', '// too big'],
  'turn-on adopts without keeping changes made here': ['sync.js', 'const kept = changedHere(mine, base);', 'const kept = [];'],
  'merged change not uploaded': ['sync.js', 'if (changedHere(out, newBase).length) schedule();', ''],
  'turn-off forgets base': ['sync.js', "await local.set({[AREA_KEY]: 'local'});\n      await clearError();", "await local.set({[AREA_KEY]: 'local'});\n      await local.remove([BASE_KEY, SYNC_ERROR_KEY]);"],
  'turn-on no gap wait': ['sync.js', 'await sleep(nextWrite - Date.now()); // (so what is read below', '// (so what is read below'],
  'upload reads before the gap wait': ['sync.js', 'await sleep(nextWrite - Date.now());\n      const mine = await readLocal(), keys = pending(mine);', 'const mine = await readLocal(), keys = pending(mine);\n      await sleep(nextWrite - Date.now());'],
  'undo leaves error': ['sync.js', '{ await clearError(); return; } // (e.g.', 'return; // (e.g.'],
  'base not updated after upload': ['sync.js', 'await local.set({[BASE_KEY]: {...base, ...pick(mine, keys)}});', ''],
  'downloads routed to sync': ['background.js', "if (msg?.type === 'rf-download') return onMessage", 'if (false) return onMessage'],
  // v3 round-1 fixes
  'no fit check before removing old chunks': ['sync.js', 'if (after > SYNC_TOTAL) throw tooMuch(after);', ''],
  'old chunks not put back after a failed write': ['sync.js', 'if (first) await sync.set(pick(all, stale)).catch(() => {});', ''],
  'quota refusal passed on in Chrome\'s words': ['sync.js', 'throw /QUOTA_BYTES/.test(e?.message) ? tooMuch(after) : /MAX_ITEMS/.test(e?.message) ? tooMany(count) : e;', 'throw e;'],
  'worker save without a base writes it whole': ['sync.js', "const keys = changedSince(next, RF.normalize(base && typeof base === 'object' ? base : RF.defaults));", 'if (!base) { await local.set({[KEY]: next}); return; }\n      const keys = changedSince(next, RF.normalize(base));'],
  'page fallback drops save on worker failure': ['settings.js', 'return sent.catch(() => direct()).catch(() => {});', 'return sent.catch(() => {});'],
  'popup result note replaces the ID note': ['popup.js', "$('syncNote').textContent = on", "$('syncNote').textContent = on && note ? note : on"],
  // v3 round-2 fixes
  'never-synced setting taken from afar': ['sync.js', 'const changedHere = (s, base) => (base ? SETTINGS.filter(k => json(s[k]) !== json(k in base ? base[k] : RF.defaults[k])) : []);', 'const changedHere = (s, base) => (base ? changedSince(s, base).filter(k => k in base) : []);'],
  'never-synced default pushed over afar': ['sync.js', 'const changedHere = (s, base) => (base ? SETTINGS.filter(k => json(s[k]) !== json(k in base ? base[k] : RF.defaults[k])) : []);', 'const changedHere = (s, base) => (base ? changedSince(s, base) : []);'],
  'page fallback writes the whole object': ['settings.js', 'let todo = Object.keys(s).filter(k => !same(s[k], base[k]));', 'let todo = Object.keys(s);'],
  'page fallback does not look again': ['settings.js', 'for (let i = 0; todo.length && i < 5; i++) {', 'for (let i = 0; todo.length && i < 1; i++) {'],
  'page save before its first read has no base': ['settings.js', 'base = seen || normalize(defaults);', 'base = seen;'],
  'fallback reapplies a superseded value': ['settings.js', 'todo = todo.filter(k => same(last[k], s[k]) && same(now[k], base[k]));', 'todo = todo.filter(k => same(now[k], base[k]));'],
  'no retry after other failures': ['sync.js', 'if (!/^Too much to sync/.test(e?.message)) { clearTimeout(retryTimer); retryTimer = setTimeout(schedule, retry); }', ''],
  'item limit not checked': ['sync.js', 'if (count > MAX_ITEMS) throw tooMany(count);', ''],
};
const only = process.argv.slice(2);
const jobs = Number(process.env.RF_JOBS) || 5;
const suite = async (dir, file, fn) => {
  let out;
  try { out = (await run('node', [join(tools, 'run-suites.mjs'), pathToFileURL(join(dir, file)).href, fn], {timeout: 600000})).stdout; }
  catch (e) { out = e.stdout || ''; } // (it exits 1 when a test fails: the point of a mutant)
  return JSON.parse(out.split(`${fn} `)[1]);
};
async function one(name, [file, from, to]) {
  const src = readFileSync(join(root, 'reddit-flex-v2', file), 'utf8');
  if (src.split(from).length !== 2) return `${name} PATTERN NOT UNIQUE/FOUND`;
  const dir = mkdtempSync(join(tmpdir(), 'rf-mutant-')), ext = join(dir, 'ext');
  try {
    cpSync(join(root, 'reddit-flex-v2'), ext, {recursive: true});
    writeFileSync(join(ext, file), src.replace(from, () => to));
    await run('node', [join(root, 'test-harness', 'build.js')], {env: {...process.env, RF_EXT: ext, RF_OUT: dir}});
    const [r, p] = await Promise.all([suite(dir, 'bundle.html', '__syTest'), suite(dir, 'popup-bundle.html', '__popupTest')]);
    const names = [...r.failures, ...p.failures].map(f => f.name);
    return `${names.length ? 'CAUGHT ' : 'MISSED '} ${name}  ${names.join(' | ')}`;
  } catch (e) {
    return `ERROR   ${name}  ${e.message.split('\n')[0]}`;
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
const list = Object.entries(mutants).filter(([name]) => !only.length || only.includes(name));
let next = 0;
await Promise.all(Array.from({length: Math.min(jobs, list.length)}, async () => {
  while (next < list.length) { const [name, m] = list[next++]; console.log(await one(name, m)); }
}));
