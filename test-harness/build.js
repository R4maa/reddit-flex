// Inlines the extension into the mock page so it can run from a data: URL preview.
const fs = require('fs'), path = require('path');
// RF_EXT / RF_OUT: build from another copy of the extension into another folder (parallel mutants).
const dir = __dirname, ext = process.env.RF_EXT || path.join(dir, '..', 'reddit-flex-v2'), out = process.env.RF_OUT || dir;
let h = fs.readFileSync(path.join(dir, 'mock.html'), 'utf8');
h = h.replace('window.__clicks = [];', 'window.__clicks = [];\n  const _URL = URL; window.URL = class extends _URL { constructor(u, b) { if (b !== undefined && (String(b) === "null" || String(b).startsWith("data:"))) b = "https://www.reddit.com"; super(u, b); } };');
h = h.replace('<link rel="stylesheet" href="../reddit-flex-v2/content.css">', () => `<style>${fs.readFileSync(path.join(ext, 'content.css'), 'utf8')}</style>`);
for (const f of ['settings', 'layout', 'media', 'accordion', 'video', 'filters', 'read', 'clutter', 'polish', 'keyboard', 'sync', 'background'])
  h = h.replace(`<script src="../reddit-flex-v2/${f}.js"></script>`, () => `<script>${fs.readFileSync(path.join(ext, f + '.js'), 'utf8')}</script>`);
// settings.js as text too, so tests can start more pages of their own (each with its own state).
h = h.replace('</body>', () => `<script>window.__settingsSrc = ${JSON.stringify(fs.readFileSync(path.join(ext, 'settings.js'), 'utf8')).replace(/</g, '\\u003c')};</script>\n</body>`);
for (const t of ['layout.test.js', 'sync.test.js', 'keyboard.test.js', 'comments.test.js', 'filters.test.js', 'read.test.js', 'clutter.test.js', 'video.test.js', 'polish.test.js'])
  h = h.replace('</body>', () => `<script>${fs.readFileSync(path.join(dir, t), 'utf8')}</script>\n</body>`);
fs.writeFileSync(path.join(out, 'bundle.html'), h);

// The popup on its own page, with the same storage fake.
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
let ph = read(ext, 'popup.html');
ph = ph.replace('<script src="settings.js"></script>', () => `<script>${read(dir, 'storage-stub.js')}</script><script>${read(ext, 'settings.js')}</script><script>${read(ext, 'sync.js')}</script>`);
ph = ph.replace('<script src="popup.js"></script>', () => `<script>${read(ext, 'popup.js')}</script><script>${read(dir, 'popup.test.js')}</script>`);
fs.writeFileSync(path.join(out, 'popup-bundle.html'), ph);
console.log('built');
