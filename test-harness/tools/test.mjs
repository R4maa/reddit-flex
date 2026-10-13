// Builds the harness pages and runs every suite, several headless Chromes at once.
// usage: node test-harness/tools/test.mjs   (RF_SYNC_RUNS=n runs the sync suite n times; exits 1 on any failure)
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const harness = fileURLToPath(new URL('..', import.meta.url)), tools = join(harness, 'tools');

await run('node', [join(harness, 'build.js')]);
const bundle = join(harness, 'bundle.html'), popup = join(harness, 'popup-bundle.html');
const groups = [
  [bundle, '__poTest', '__lyTest', '__vdTest'],
  [bundle, '__cmTest', '__ftTest', '__clTest'],
  [bundle, '__kbTest', '__rdTest'],
  [popup, '__popupTest'],
  ...Array.from({length: Number(process.env.RF_SYNC_RUNS) || 1}, () => [bundle, '__syTest']),
];
let failed = 0;
const outputs = await Promise.all(groups.map(async args => {
  try { return (await run('node', [join(tools, 'run-suites.mjs'), ...args], {timeout: 900000})).stdout; }
  catch (e) { failed++; return e.stdout || `ERROR ${args.slice(1).join(' ')}: ${e.message}`; }
}));
for (const line of outputs.join('\n').split('\n')) {
  const m = /^(__\w+) (.*)$/.exec(line);
  if (!m) { if (/^ERROR/.test(line)) console.log(line); continue; }
  let r;
  try { r = JSON.parse(m[2]); } catch { console.log(line); continue; }
  console.log(`${r.fail ? 'FAIL' : 'ok  '} ${m[1]} ${r.pass}/${r.pass + r.fail}${r.vis !== 'visible' ? ` (page ${r.vis})` : ''}`);
  for (const f of r.failures || []) console.log(`       - ${f.name}${f.info === undefined ? '' : `  ${JSON.stringify(f.info).slice(0, 300)}`}`);
}
process.exit(failed ? 1 : 0);
