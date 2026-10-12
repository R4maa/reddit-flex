'use strict';
(() => {
  const RF = RedditFlex;
  const $ = id => document.getElementById(id);
  const toggles = ['enabled', 'hideRight', 'hideLeft', 'media', 'lockRatio', 'accordion', 'allPosts', 'autoComments'];
  let s = {...RF.defaults};
  let saveTimer = 0;

  function render() {
    for (const key of toggles) $(key).checked = s[key];
    $('width').value = s.width;
    $('widthOut').textContent = `${s.width}px`;
    for (const b of document.querySelectorAll('[data-width]')) b.classList.toggle('on', Number(b.dataset.width) === s.width);
    document.body.classList.toggle('off', !s.enabled);
  }

  function commit(patch, immediate) {
    s = RF.normalize({...s, ...patch});
    render();
    // The slider saves at ~30fps so the page follows it live without flooding storage.
    if (immediate) { clearTimeout(saveTimer); saveTimer = 0; RF.save(s); }
    else if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; RF.save(s); }, 30);
  }

  for (const key of toggles) $(key).addEventListener('change', e => commit({[key]: e.target.checked}, true));
  $('width').addEventListener('input', e => commit({width: Number(e.target.value)}));
  $('width').addEventListener('change', e => commit({width: Number(e.target.value)}, true));
  for (const b of document.querySelectorAll('[data-width]')) b.addEventListener('click', () => commit({width: Number(b.dataset.width)}, true));
  $('resetMedia').addEventListener('click', () => RF.requestReset());
  $('resetAll').addEventListener('click', () => { commit(RF.defaults, true); RF.requestReset(); });

  RF.read().then(v => { s = v; render(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.redditFlex) { s = RF.normalize(changes.redditFlex.newValue); render(); }
  });
})();
