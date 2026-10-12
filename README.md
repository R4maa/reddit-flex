# Reddit Flex

Chrome extension that makes the Reddit desktop site more flexible: resizable feed column, stretchable and floating video players, and inline post / comment expansion.

- `reddit-flex-v2/`: the extension (load this folder via `chrome://extensions` → Load unpacked). See its README for features.
- `test-harness/`: a mock Reddit page for testing without the live site. Run `node test-harness/build.js` to produce `bundle.html`.
- Lint before committing: `npx eslint@9` (config in `eslint.config.mjs`; catches undefined variables).
- In the mock page, `window.__errors` collects any script errors during a test.
