// Assertions for popup.html (filters section). build.js inlines this into popup-bundle.html.
window.__popupTest = async () => {
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const $ = id => document.getElementById(id);
  const stored = async () => (await chrome.storage.local.get('redditFlex')).redditFlex || {};
  const type = (el, text) => { el.focus(); el.value = text; el.dispatchEvent(new Event('input', {bubbles: true})); };
  await sleep(100);

  ok('filter controls exist', ['filterPosts', 'filterComments', 'filterKeywords', 'filterSubs', 'filterUsers'].every(id => $(id)));
  ok('toggles start on', $('filterPosts').checked && $('filterComments').checked);

  // Typing: a fresh empty line must survive while the box has focus.
  type($('filterKeywords'), 'cat\n');
  await sleep(500);
  ok('typing saves after a pause', JSON.stringify((await stored()).filterKeywords) === '["cat"]', (await stored()).filterKeywords);
  ok('the box is not rewritten while typing', $('filterKeywords').value === 'cat\n', JSON.stringify($('filterKeywords').value));
  type($('filterKeywords'), 'cat\n  dog  \n\n/(/');
  $('filterKeywords').dispatchEvent(new Event('change', {bubbles: true}));
  $('filterKeywords').blur(); await sleep(50);
  ok('on leaving, the list is saved trimmed', JSON.stringify((await stored()).filterKeywords) === '["cat","dog","/(/"]', (await stored()).filterKeywords);
  ok('and the box is tidied', $('filterKeywords').value === 'cat\ndog\n/(/', JSON.stringify($('filterKeywords').value));
  ok('an invalid regex is flagged', !$('filterKeywordsWarn').hidden && /Ignored \/\(\/: (Unterminated group|unterminated parenthetical)/i.test($('filterKeywordsWarn').textContent), $('filterKeywordsWarn').textContent);
  type($('filterKeywords'), 'cat'); $('filterKeywords').dispatchEvent(new Event('change', {bubbles: true})); $('filterKeywords').blur(); await sleep(50);
  ok('the warning clears when fixed', $('filterKeywordsWarn').hidden);

  type($('filterSubs'), 'r/funny\nr/pics'); $('filterSubs').dispatchEvent(new Event('change', {bubbles: true})); $('filterSubs').blur();
  type($('filterUsers'), 'u/bob'); $('filterUsers').dispatchEvent(new Event('change', {bubbles: true})); $('filterUsers').blur();
  await sleep(50);
  const st = await stored();
  ok('subreddit and user lists save', JSON.stringify(st.filterSubs) === '["r/funny","r/pics"]' && JSON.stringify(st.filterUsers) === '["u/bob"]', [st.filterSubs, st.filterUsers]);
  $('filterComments').click(); await sleep(50);
  ok('the comments toggle saves', (await stored()).filterComments === false);
  $('filterComments').click(); await sleep(50);

  // Another window changing the lists updates this popup (when not typing in it).
  await chrome.storage.local.set({redditFlex: {...(await stored()), filterUsers: ['u/carol']}});
  await sleep(50);
  ok('outside changes show up', $('filterUsers').value === 'u/carol', $('filterUsers').value);

  // Read history: count on the button, Clear empties it.
  ok('read toggles exist and start on', $('markRead').checked && $('dimRead').checked);
  ok('with no history the Clear button is disabled', $('clearRead').disabled && $('clearRead').textContent === 'Read history is empty', $('clearRead').textContent);
  await chrome.storage.local.set({redditFlexRead: {ids: ['a', 'a', 1, '', 'b']}}); await sleep(50);
  ok('the count ignores duplicates and junk', $('clearRead').textContent === 'Clear read history (2)', $('clearRead').textContent);
  $('markRead').click(); $('dimRead').click(); await sleep(50);
  ok('read toggles save', (await stored()).markRead === false && (await stored()).dimRead === false);
  $('markRead').click(); $('dimRead').click(); await sleep(50);
  await chrome.storage.local.set({redditFlexRead: {ids: ['a', 'b', 'c']}}); await sleep(50);
  ok('the button shows how many posts are remembered', $('clearRead').textContent === 'Clear read history (3)' && !$('clearRead').disabled, $('clearRead').textContent);
  $('clearRead').click(); await sleep(50);
  ok('Clear empties the history', ((await chrome.storage.local.get('redditFlexRead')).redditFlexRead?.ids || ['x']).length === 0);
  ok('...and the button says so', $('clearRead').textContent === 'Read history is empty' && $('clearRead').disabled, $('clearRead').textContent);

  ok('the autoplay toggle starts on and saves', $('autoplay').checked);
  $('autoplay').click(); await sleep(30);
  ok('switching autoplay off is saved', (await stored()).autoplay === false);
  $('autoplay').click(); await sleep(30);

  // Hide clutter: five toggles, off by default, each saved on its own.
  const clutter = ['hidePromoted', 'hideUpsells', 'hideRecommended', 'hideTrending', 'hideAwards'];
  ok('clutter toggles exist and start off', clutter.every(id => $(id) && !$(id).checked));
  for (const id of clutter) {
    $(id).click(); await sleep(30);
    const st = await stored();
    ok(`${id} saves on its own`, st[id] === true && clutter.filter(k => k !== id).every(k => !st[k]), st);
    $(id).click(); await sleep(30);
  }
  $('hideAwards').click(); await sleep(30);

  // Sync (unit 8; skipped while that unit is not applied)
  if (RedditFlex.setSync) {
    const until = async (cond, ms = 2500) => { const t0 = Date.now(); while (!(await cond()) && Date.now() - t0 < ms) await sleep(30); return cond(); };
    const syncSettings = async () => window.RedditFlexSync.fromSync(await chrome.storage.sync.get(null))?.settings;
    ok('sync starts off and says so', !$('sync').checked && /^Off/.test($('syncNote').textContent) && $('syncWarn').hidden, $('syncNote').textContent);
    $('sync').click();
    ok('switching sync on uploads the settings', await until(async () => !$('sync').disabled && !!(await syncSettings())) && $('sync').checked && (await chrome.storage.local.get(RedditFlex.AREA_KEY))[RedditFlex.AREA_KEY] === 'sync');
    ok('...and explains which installs share them', /^On\. Another computer shares these settings only if its Reddit Flex has the same extension ID/.test($('syncNote').textContent), $('syncNote').textContent);
    $('hideTrending').click();
    ok('changes then go to sync', await until(async () => (await syncSettings())?.hideTrending === true, 4500));
    await chrome.storage.sync.set({'redditFlex.hideAwards': false}); // another computer
    ok('the popup shows a change brought in from another computer', await until(() => !$('hideAwards').checked) && (await stored()).hideAwards === false);
    await RedditFlex.setSync(false); // (as the popup open in another tab would)
    ok('...and follows sync being switched off elsewhere', await until(() => !$('sync').checked) && /^Off/.test($('syncNote').textContent), $('syncNote').textContent);
    await RedditFlex.setSync(true);
    ok('...and on again', await until(() => $('sync').checked) && /^On\./.test($('syncNote').textContent), $('syncNote').textContent);
    $('hideAwards').click();
    ok('(and it goes back up)', await until(async () => (await syncSettings())?.hideAwards === true, 4500));
    await chrome.storage.local.set({[RedditFlex.SYNC_ERROR_KEY]: {message: 'Too much to sync: 120 KB of 98 KB. Shorten the filter lists.', at: 1}});
    ok('a sync error is shown, saying the change is kept here', await until(() => !$('syncWarn').hidden) && $('syncWarn').textContent === 'Not synced: Too much to sync: 120 KB of 98 KB. Shorten the filter lists. Your change is kept on this computer.', $('syncWarn').textContent);
    $('sync').click();
    ok('switching off keeps the settings on this computer and clears the error', await until(() => !$('sync').disabled && !$('sync').checked) && (await stored()).hideTrending === true && $('syncWarn').hidden && /^Off/.test($('syncNote').textContent));
    $('hideTrending').click(); await sleep(30);
    ok('off again, changes stay local', (await stored()).hideTrending === false && (await syncSettings()).hideTrending === true);
    $('sync').click();
    ok('switching on again keeps what was changed here meanwhile, and says so', await until(() => !$('sync').disabled) && $('sync').checked && $('syncNote').textContent.startsWith('On. Using the synced settings, plus what you changed here since this computer last synced. Another computer shares these settings only if its Reddit Flex has the same extension ID (self).') && !$('hideTrending').checked && await until(async () => (await syncSettings())?.hideTrending === false, 4500), $('syncNote').textContent);
    $('sync').click(); await until(() => !$('sync').disabled);
    const huge = Array.from({length: 500}, (_, i) => `${i}`.padEnd(300, 'y'));
    const syncBefore = JSON.stringify(await chrome.storage.sync.get(null));
    await chrome.storage.local.set({redditFlex: {...(await stored()), filterKeywords: huge}}); await sleep(50);
    $('sync').click();
    ok('switching on with too much made here while off is refused too, changing nothing', await until(() => !$('sync').disabled) && !$('sync').checked && /^Too much to sync: \d+ KB; the limit is \d+ KB/.test($('syncWarn').textContent) && JSON.stringify(await chrome.storage.sync.get(null)) === syncBefore && (await chrome.storage.local.get(RedditFlex.AREA_KEY))[RedditFlex.AREA_KEY] !== 'sync' && !(await chrome.storage.local.get(RedditFlex.SYNC_ERROR_KEY))[RedditFlex.SYNC_ERROR_KEY], $('syncWarn').textContent);
    await chrome.storage.sync.remove(Object.keys(await chrome.storage.sync.get(null)));
    $('sync').click();
    ok('settings too big to sync are refused with the reason', await until(() => !$('sync').disabled) && !$('sync').checked && /^Too much to sync: \d+ KB; the limit is \d+ KB/.test($('syncWarn').textContent) && !(await syncSettings()) && (await chrome.storage.local.get(RedditFlex.AREA_KEY))[RedditFlex.AREA_KEY] !== 'sync', $('syncWarn').textContent);
    await chrome.storage.local.set({redditFlex: {...(await stored()), filterKeywords: [], hideTrending: false}}); await sleep(50);
    await chrome.storage.local.remove(RedditFlex.AREA_KEY);
  }

  // Page: back-to-top, header, exact times
  ok('page toggles exist with their defaults', $('scrollToTop').checked && !$('unstickHeader').checked && $('exactTimes').checked);
  for (const id of ['scrollToTop', 'unstickHeader', 'exactTimes']) {
    const was = $(id).checked;
    $(id).click(); await sleep(30);
    ok(`${id} saves`, (await stored())[id] === !was, (await stored())[id]);
    $(id).click(); await sleep(30);
  }

  // Width per page type
  const typeBtn = t => document.querySelector(`[data-type="${t}"]`);
  ok('per-page widths start off, with the type picker hidden', !$('widthPerPage').checked && $('pageTypes').hidden);
  document.querySelector('[data-width="1200"]').click(); await sleep(30);
  ok('off: presets set the global width', (await stored()).width === 1200 && $('widthOut').textContent === '1200px', $('widthOut').textContent);
  $('widthPerPage').click(); await sleep(30);
  let ws = await stored();
  ok('switching on starts every type at the current width', ws.widthPerPage === true && RedditFlex.PAGE_TYPES.every(t => ws.widths[t] === 1200), ws.widths);
  ok('...and shows the type picker, Home first', !$('pageTypes').hidden && typeBtn('home').classList.contains('on') && $('widthOut').textContent === 'Home · 1200px', $('widthOut').textContent);
  typeBtn('post').click();
  document.querySelector('[data-width="1600"]').click(); await sleep(30);
  ws = await stored();
  ok('a preset sets only the picked type', ws.widths.post === 1600 && ws.widths.home === 1200 && ws.width === 1200, ws);
  $('width').value = 700; $('width').dispatchEvent(new Event('input')); $('width').dispatchEvent(new Event('change')); await sleep(30);
  ws = await stored();
  ok('the slider sets only the picked type', ws.widths.post === 700 && ws.widths.subreddit === 1200 && ws.width === 1200 && $('widthOut').textContent === 'Post · 700px', [ws.widths, $('widthOut').textContent]);
  typeBtn('subreddit').click();
  ok('picking another type shows its width', $('width').value === '1200' && $('widthOut').textContent === 'Subreddit · 1200px');
  $('widthPerPage').click(); await sleep(30);
  ws = await stored();
  ok('switching off shows the global width again', $('pageTypes').hidden && $('widthOut').textContent === '1200px' && $('width').value === '1200');
  ok('...keeping the per-type widths', ws.widths.post === 700);
  $('widthPerPage').click(); await sleep(30);
  ok('switching back on does not overwrite them', (await stored()).widths.post === 700);
  $('widthPerPage').click(); await sleep(30);

  $('resetAll').click(); await sleep(50);
  ok('Reset all turns per-page widths off and resets them', (await stored()).widthPerPage === false && Object.values((await stored()).widths).every(w => w === 900));
  ok('Reset all empties the lists', $('filterKeywords').value === '' && (await stored()).filterKeywords.length === 0);
  ok('Reset all turns the clutter options off', !$('hideAwards').checked && (await stored()).hideAwards === false);
  // Ko-fi link at the very bottom, opening in a new tab
  const kofi = $('kofi');
  ok('a Ko-fi link sits at the bottom of the popup and opens in a new tab', kofi?.href === 'https://ko-fi.com/rama2019' && kofi.target === '_blank' && kofi.relList.contains('noopener') && kofi.closest('p') === [...document.body.children].filter(e => e.tagName !== 'SCRIPT').at(-1), kofi?.outerHTML);
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
