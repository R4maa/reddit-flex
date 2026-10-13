'use strict';
(() => {
  const RF = RedditFlex;
  const $ = id => document.getElementById(id);
  const toggles = ['enabled', 'hideRight', 'hideLeft', 'media', 'lockRatio', 'autoplay', 'accordion', 'allPosts', 'prefetch', 'autoComments', 'keyboard', 'collapseAutoMod', 'threadColors', 'filterPosts', 'filterComments', 'markRead', 'dimRead', 'hidePromoted', 'hideUpsells', 'hideRecommended', 'hideTrending', 'hideAwards', 'scrollToTop', 'unstickHeader', 'exactTimes'];
  const lists = {filterKeywords: 'keyword', filterSubs: 'name', filterUsers: 'name'};
  let s = {...RF.defaults};
  let saveTimer = 0;
  // With "Width per page type" on, the slider and presets edit the picked type's width.
  let editType = 'home';
  const TYPE_NAMES = {home: 'Home', subreddit: 'Subreddit', post: 'Post', other: 'Other'};
  const shownWidth = () => RF.widthFor(s, editType);
  const setWidth = (w, immediate) => commit(s.widthPerPage ? {widths: {...s.widths, [editType]: w}} : {width: w}, immediate);

  function render() {
    for (const key of toggles) $(key).checked = s[key];
    $('widthPerPage').checked = s.widthPerPage;
    $('pageTypes').hidden = !s.widthPerPage;
    for (const b of document.querySelectorAll('[data-type]')) b.classList.toggle('on', b.dataset.type === editType);
    $('width').value = shownWidth();
    $('commentSort').value = s.commentSort;
    for (const [key, kind] of Object.entries(lists)) {
      // Never rewrite the box being typed in: normalizing would eat a fresh empty line.
      if (document.activeElement !== $(key)) $(key).value = s[key].join('\n');
      const bad = s[key].map(line => [line, RF.parsePattern(line, kind).error]).filter(([, err]) => err);
      $(`${key}Warn`).hidden = !bad.length;
      $(`${key}Warn`).textContent = bad.map(([line, err]) => `Ignored ${line}: ${err.replace(/^Invalid regular expression: .*?: (?=[^:]+$)/, '')}`).join('\n');
    }
    $('widthOut').textContent = s.widthPerPage ? `${TYPE_NAMES[editType]} · ${shownWidth()}px` : `${s.width}px`;
    for (const b of document.querySelectorAll('[data-width]')) b.classList.toggle('on', Number(b.dataset.width) === shownWidth());
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
  $('width').addEventListener('input', e => setWidth(Number(e.target.value)));
  $('width').addEventListener('change', e => setWidth(Number(e.target.value), true));
  for (const b of document.querySelectorAll('[data-width]')) b.addEventListener('click', () => setWidth(Number(b.dataset.width), true));
  // Switching per-page widths on for the first time starts every type at the current width.
  $('widthPerPage').addEventListener('change', e => {
    const fresh = RF.PAGE_TYPES.every(t => s.widths[t] === RF.defaults.widths[t]);
    commit(e.target.checked && fresh
      ? {widthPerPage: true, widths: Object.fromEntries(RF.PAGE_TYPES.map(t => [t, s.width]))}
      : {widthPerPage: e.target.checked}, true);
  });
  for (const b of document.querySelectorAll('[data-type]')) b.addEventListener('click', () => { editType = b.dataset.type; render(); });
  $('resetMedia').addEventListener('click', () => RF.requestReset());
  $('resetAll').addEventListener('click', () => { commit(RF.defaults, true); RF.requestReset(); });

  // Sync: on/off, which extension ID other computers need, and the last sync error.
  const extensionId = globalThis.chrome?.runtime?.id;
  async function showSync(note = '') {
    const on = await RF.syncOn();
    const err = on && (await chrome.storage.local.get(RF.SYNC_ERROR_KEY))[RF.SYNC_ERROR_KEY];
    $('sync').checked = on;
    $('syncNote').textContent = note || (on
      ? `On. Another computer shares these settings only if its Reddit Flex has the same extension ID${extensionId ? ` (${extensionId})` : ''}. Installs from the same store listing share one; unpacked copies need the same manifest key.`
      : 'Off: settings are kept on this computer only.');
    $('syncWarn').hidden = !err?.message;
    $('syncWarn').textContent = err?.message ? `Not synced: ${err.message} Your change is kept on this computer.` : '';
  }
  $('sync').addEventListener('change', async e => {
    const on = e.target.checked;
    $('sync').disabled = true;
    try {
      const result = await RF.setSync(on);
      const notes = {
        adopted: 'On. Using the settings already synced from another computer.',
        merged: 'On. Using the synced settings, plus what you changed here since this computer last synced.',
      };
      await showSync(notes[result] || '');
    } catch (err) {
      await showSync();
      $('syncWarn').hidden = false;
      $('syncWarn').textContent = err?.message || 'Could not turn sync on';
    } finally {
      $('sync').disabled = false;
    }
  });

  RF.subscribe(v => { s = v; render(); });
  showSync();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[READ_KEY]) showReadCount(readCount(changes[READ_KEY].newValue));
    // (While the switch is busy, its own handler shows the outcome.)
    if (area === 'local' && (changes[RF.SYNC_ERROR_KEY] || changes[RF.AREA_KEY]) && !$('sync').disabled) showSync();
  });
})();
