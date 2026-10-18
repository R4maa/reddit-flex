// Builds the Firefox version from reddit-flex-v2: the same files with a Firefox manifest (an event
// page with background scripts instead of a service worker, a gecko id) and the popup's wording.
// Writes dist/firefox/ (to load as a temporary add-on) and reddit-flex-firefox-<version>.zip (for AMO).
// usage: node test-harness/tools/build-firefox.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = fileURLToPath(new URL('../..', import.meta.url));
const SRC = 'reddit-flex-v2';
const out = join(root, 'dist', 'firefox');
const GECKO_ID = 'reddit-flex@r4maa';

// The tracked files only, as git archive packs the Chrome zip.
const files = execFileSync('git', ['ls-files', SRC], {cwd: root, encoding: 'utf8'})
  .split('\n').filter(Boolean).map(f => f.slice(SRC.length + 1));
const contents = new Map(files.map(f => [f, readFileSync(join(root, SRC, f))]));

const m = JSON.parse(contents.get('manifest.json'));
delete m.minimum_chrome_version;
// Firefox runs no extension service workers: the worker's scripts load as an event page, in the
// order its importScripts would (background.js only calls importScripts where it exists).
const worker = contents.get(m.background.service_worker).toString();
const imported = [...(worker.match(/importScripts\(([^)]*)\)/)?.[1].matchAll(/'([^']+)'/g) || [])].map(x => x[1]);
m.background = {scripts: [...imported, m.background.service_worker]};
m.browser_specific_settings = {gecko: {
  id: GECKO_ID,
  strict_min_version: '140.0', // data_collection_permissions; popover, :has() and CSS zoom came earlier
  data_collection_permissions: {required: ['none']},
}};
contents.set('manifest.json', Buffer.from(JSON.stringify(m, null, 2) + '\n'));

const popup = contents.get('popup.html').toString();
const firefoxPopup = popup.replace('Sync settings with Chrome', 'Sync settings with Firefox')
  .replace('Through your Chrome account', 'Through your Firefox account');
if (firefoxPopup === popup) throw new Error('popup.html: the sync wording was not found');
contents.set('popup.html', Buffer.from(firefoxPopup));

rmSync(out, {recursive: true, force: true});
for (const [f, data] of contents) {
  mkdirSync(dirname(join(out, f)), {recursive: true});
  writeFileSync(join(out, f), data);
}

// A plain zip (deflate, no extras): enough for AMO and about:debugging.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const packed = deflateRawSync(data, {level: 9});
    const nameBuf = Buffer.from(name);
    const head = (sig, extra) => {
      const b = Buffer.alloc(extra);
      b.writeUInt32LE(sig, 0);
      return b;
    };
    const fields = (b, at) => {
      b.writeUInt16LE(20, at); b.writeUInt16LE(0x0800, at + 2); b.writeUInt16LE(8, at + 4); // version, utf-8 names, deflate
      b.writeUInt16LE(0, at + 6); b.writeUInt16LE(0x21, at + 8); // time 00:00, date 1980-01-01
      b.writeUInt32LE(crc32(data), at + 10); b.writeUInt32LE(packed.length, at + 14); b.writeUInt32LE(data.length, at + 18);
      b.writeUInt16LE(nameBuf.length, at + 22);
    };
    const l = head(0x04034b50, 30); fields(l, 4);
    local.push(l, nameBuf, packed);
    const c = head(0x02014b50, 46); c.writeUInt16LE(20, 4); fields(c, 6); c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += l.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}
const zipName = `reddit-flex-firefox-${m.version}.zip`;
writeFileSync(join(root, zipName), zip([...contents].sort(([a], [b]) => a.localeCompare(b))));
console.log(`firefox build ok: ${m.name} ${m.version}, ${contents.size} files -> dist/firefox, ${zipName}`);
