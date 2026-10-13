# Test harness

Checks for the extension in `reddit-flex-v2/`, run in a headless Chrome. They need Node 22 and Google Chrome; set `CHROME_PATH` if Chrome isn't in its usual place.

```sh
node test-harness/tools/test.mjs            # every suite on the mock Reddit page and the popup
node test-harness/tools/real-chrome.mjs     # settings sync with the extension really loaded
node test-harness/tools/check-manifest.mjs  # the manifest and the files it names
node test-harness/tools/mutate.mjs          # deliberate sync bugs the tests must catch (slow)
```

- `mock.html` is a small stand-in for Reddit's page (`shreddit-*` elements, a fake `chrome.storage` and `fetch`). `build.js` inlines the extension and the `*.test.js` suites into `bundle.html`, and the popup with `storage-stub.js` into `popup-bundle.html`. Both are generated, and Git ignores them.
- Each suite is a `window.__xxTest()` function that returns `{pass, fail, failures}`. `tools/run-suites.mjs <page> <fn>…` runs suites in one throwaway Chrome. `test.mjs` runs groups of them in parallel. `RF_SYNC_RUNS=5` repeats the sync suite.
- The page must stay visible while a suite runs, which headless Chrome does. A hidden page throttles timers and pauses animation frames, and the keyboard, read and layout suites then fail.
- `real-chrome.mjs` loads the unpacked extension into a throwaway profile over the DevTools pipe (Chrome 137+ ignores `--load-extension`). It drives two popup tabs against the real background worker and `chrome.storage.sync`, and simulates another computer by writing sync items directly.
- `mutate.mjs` copies the extension once per mutant, builds each copy into its own folder and runs the sync and popup suites, several at once (`RF_JOBS`). The real source is never touched.
