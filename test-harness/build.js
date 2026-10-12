// Inlines the extension into the mock page so it can run from a data: URL preview.
const fs = require('fs'), path = require('path');
const dir = __dirname, ext = path.join(dir, '..', 'reddit-flex-v2');
let h = fs.readFileSync(path.join(dir, 'mock.html'), 'utf8');
h = h.replace('window.__clicks = [];', 'window.__clicks = [];\n  const _URL = URL; window.URL = class extends _URL { constructor(u, b) { if (b !== undefined && (String(b) === "null" || String(b).startsWith("data:"))) b = "https://www.reddit.com"; super(u, b); } };');
h = h.replace('<link rel="stylesheet" href="../reddit-flex-v2/content.css">', () => `<style>${fs.readFileSync(path.join(ext, 'content.css'), 'utf8')}</style>`);
for (const f of ['settings', 'layout', 'media', 'accordion'])
  h = h.replace(`<script src="../reddit-flex-v2/${f}.js"></script>`, () => `<script>${fs.readFileSync(path.join(ext, f + '.js'), 'utf8')}</script>`);
fs.writeFileSync(path.join(dir, 'bundle.html'), h);
console.log('built');
