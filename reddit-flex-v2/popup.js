'use strict';
(() => {
  const RF = RedditFlex;
  const $ = id => document.getElementById(id);
  const toggles = ['enabled', 'hideRight', 'hideLeft', 'media', 'lockRatio', 'accordion', 'allPosts', 'prefetch', 'autoComments', 'keyboard', 'collapseAutoMod', 'threadColors', 'filterPosts', 'filterComments', 'markRead', 'dimRead', 'hidePromoted', 'hideUpsells', 'hideRecommended', 'hideTrending', 'hideAwards'];
  const lists = {filterKeywords: 'keyword', filterSubs: 'name', filterUsers: 'name'};
  let s = {...RF.defaults};
  let saveTimer = 0;

  function render() {
    for (const key of toggles) $(key).checked = s[key];
    $('width').value = s.width;
    $('commentSort').value = s.commentSort;
    for (const [key, kind] of Object.entries(lists)) {
      // Never rewrite the box being typed in: normalizing would eat a fresh empty line.
      if (document.activeElement !== $(key)) $(key).value = s[key].join('\n');
      const bad = s[key].map(line => [line, RF.parsePattern(line, kind).error]).filter(([, err]) => err);
      $(`${key}Warn`).hidden = !bad.length;
      $(`${key}Warn`).textContent = bad.map(([line, err]) => `Ignored ${line}: ${err.replace(/^Invalid regular expression: .*?: (?=[^:]+$)/, '')}`).join('\n');
    }
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
  for (const key of Object.keys(lists)) {
    let typing = 0;
    const save = () => { clearTimeout(typing); commit({[key]: $(key).value.split('\n')}, true); };
    $(key).addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(save, 400); });
    $(key).addEventListener('change', save);
    $(key).addEventListener('blur', () => setTimeout(render)); // tidy the text once focus has left
  }
  // Read history lives under its own storage key, apart from the settings.
  const READ_KEY = 'redditFlexRead';
  // Counted the way the page reads it: distinct non-empty strings.
  const readCount = v => Math.min(3000, new Set((Array.isArray(v?.ids) ? v.ids : []).filter(id => typeof id === 'string' && id)).size);
  const showReadCount = n => { $('clearRead').textContent = n ? `Clear read history (${n.toLocaleString()})` : 'Read history is empty'; $('clearRead').disabled = !n; };
  chrome.storage.local.get(READ_KEY).then(r => showReadCount(readCount(r[READ_KEY])));
  $('clearRead').addEventListener('click', () => chrome.storage.local.set({[READ_KEY]: {ids: []}}));
  $('commentSort').addEventListener('change', e => commit({commentSort: e.target.value}, true));
  $('width').addEventListener('input', e => commit({width: Number(e.target.value)}));
  $('width').addEventListener('change', e => commit({width: Number(e.target.value)}, true));
  for (const b of document.querySelectorAll('[data-width]')) b.addEventListener('click', () => commit({width: Number(b.dataset.width)}, true));
  $('resetMedia').addEventListener('click', () => RF.requestReset());
  $('resetAll').addEventListener('click', () => { commit(RF.defaults, true); RF.requestReset(); });

  RF.read().then(v => { s = v; render(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.redditFlex) { s = RF.normalize(changes.redditFlex.newValue); render(); }
    if (area === 'local' && changes[READ_KEY]) showReadCount(readCount(changes[READ_KEY].newValue));
  });
})();
