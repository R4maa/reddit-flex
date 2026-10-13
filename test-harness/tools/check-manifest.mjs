// Checks reddit-flex-v2/manifest.json: it parses, and every file it (or the background worker's
// importScripts) names exists. usage: node test-harness/tools/check-manifest.mjs
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ext = fileURLToPath(new URL('../../reddit-flex-v2', import.meta.url));
const m = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
const files = [
  m.background?.service_worker,
  m.action?.default_popup,
  ...Object.values(m.icons || {}),
  ...Object.values(m.action?.default_icon || {}),
  ...(m.content_scripts || []).flatMap(c => [...(c.js || []), ...(c.css || [])]),
].filter(Boolean);
const worker = m.background?.service_worker && readFileSync(join(ext, m.background.service_worker), 'utf8');
for (const [, list] of worker?.matchAll(/importScripts\(([^)]*)\)/g) || []) files.push(...[...list.matchAll(/'([^']+)'/g)].map(x => x[1]));
const missing = files.filter(f => !existsSync(join(ext, f)));
const problems = [
  ...missing.map(f => `missing file: ${f}`),
  ...(m.manifest_version === 3 ? [] : ['manifest_version is not 3']),
  ...(/^\d+(\.\d+){0,3}$/.test(m.version || '') ? [] : [`bad version: ${m.version}`]),
];
console.log(problems.length ? problems.join('\n') : `manifest ok: ${m.name} ${m.version}, ${files.length} files`);
process.exit(problems.length ? 1 : 0);
