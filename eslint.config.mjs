export default [{
  files: ["reddit-flex-v2/**/*.js"],
  languageOptions: {
    ecmaVersion: 2024, sourceType: 'script',
    globals: { window: 'readonly', document: 'readonly', location: 'readonly', chrome: 'readonly', RedditFlex: 'readonly', globalThis: 'readonly',
      console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
      fetch: 'readonly', URL: 'readonly', Response: 'readonly', DOMParser: 'readonly', Image: 'readonly', Element: 'readonly', HTMLElement: 'readonly', ShadowRoot: 'readonly',
      MutationObserver: 'readonly', ResizeObserver: 'readonly', PointerEvent: 'readonly', getComputedStyle: 'readonly', getSelection: 'readonly', matchMedia: 'readonly',
      addEventListener: 'readonly', removeEventListener: 'readonly', scrollBy: 'readonly', innerWidth: 'readonly', innerHeight: 'readonly', scrollX: 'readonly', scrollY: 'readonly' } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none' }] },
}];
