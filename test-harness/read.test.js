// Assertions for read.js (mark as read, dim read posts). Run: `await window.__rdTest()`.
window.__rdTest = async () => {
  const RF = window.RedditFlex, acc = window.RedditFlexAccordion;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(50); return cond(); };
  const errorsBefore = window.__errors.length;
  const KEY = 'redditFlexRead';
  const set = async patch => { await RF.save({...(await RF.read()), ...patch}); await sleep(100); };
  const stored = async () => (await chrome.storage.local.get(KEY))[KEY]?.ids || [];
  const writeIds = async ids => { await chrome.storage.local.set({[KEY]: {ids}}); await sleep(100); };
  const p1 = document.getElementById('t3_abc123'), vid = document.getElementById('t3_vid1');
  const opacity = el => Number(getComputedStyle(el).opacity);
  for (const p of document.querySelectorAll('shreddit-post')) if (acc.isOpen(p)) acc.toggle(p);
  await sleep(700);
  await set({markRead: true, dimRead: true, enabled: true, accordion: true});
  await writeIds([]);

  ok('both options default on', RF.defaults.markRead === true && RF.defaults.dimRead === true);
  ok('nothing is read at first', !p1.hasAttribute('data-rf-read') && opacity(p1) === 1);

  // 1. Expanding inline marks the post read; it is dimmed only once closed again
  acc.toggle(p1); await sleep(100);
  ok('expanding marks it read', p1.hasAttribute('data-rf-read'));
  ok('an open post is not dimmed', opacity(p1) === 1, opacity(p1));
  ok('the save is batched, not immediate', !(await stored()).includes('abc123'));
  await sleep(600);
  ok('then the id is saved', (await stored()).includes('abc123'), await stored());
  acc.toggle(p1); await sleep(800);
  ok('closed again, it is dimmed', opacity(p1) < 1, opacity(p1));
  ok('unread posts are not dimmed', opacity(vid) === 1);

  // 2. Options
  await set({dimRead: false});
  ok('"Dim them" off: full strength, still remembered', opacity(p1) === 1 && p1.hasAttribute('data-rf-read'));
  await set({dimRead: true, markRead: false});
  ok('"Remember" off: nothing is dimmed', opacity(p1) === 1);
  acc.toggle(vid); await sleep(100); acc.toggle(vid); await sleep(800);
  ok('"Remember" off: opening does not mark', !(await stored()).includes('vid1') && !vid.hasAttribute('data-rf-read'));
  await set({markRead: true});
  await set({enabled: false});
  ok('extension off: nothing is dimmed', opacity(p1) === 1);
  vid.setAttribute('data-rf-open', ''); await sleep(50); vid.removeAttribute('data-rf-open'); // as if expanded
  await sleep(700);
  ok('extension off: an expanded post is not marked', !vid.hasAttribute('data-rf-read') && !(await stored()).includes('vid1'), await stored());
  await set({enabled: true});

  // 3. Other tabs and the popup's Clear button change storage; the page follows
  await writeIds(['abc123', 'vid1']);
  ok('ids written elsewhere mark posts here', vid.hasAttribute('data-rf-read') && opacity(vid) < 1);
  await writeIds([]);
  ok('clearing the history undims everything', !p1.hasAttribute('data-rf-read') && !vid.hasAttribute('data-rf-read') && opacity(p1) === 1);

  // 4. History is capped at 3000, oldest dropped, re-reading moves an id to the newest end
  const many = Array.from({length: 3000}, (_, i) => 'old' + i);
  await writeIds(many);
  acc.toggle(p1); await sleep(100); acc.toggle(p1); await sleep(800);
  const after = await stored();
  ok('capped at 3000 with the newest kept', after.length === 3000 && after.at(-1) === 'abc123' && after[0] === 'old1', [after.length, after[0], after.at(-1)]);
  await writeIds(['abc123', 'vid1', 'zzz']);
  acc.toggle(p1); await sleep(100); acc.toggle(p1); await sleep(800);
  ok('re-reading moves the id to the end without duplicates', JSON.stringify(await stored()) === '["vid1","zzz","abc123"]', await stored());

  // 5. Posts that appear later (infinite scroll) are dimmed if read
  await writeIds(['late9']);
  const art = document.createElement('article');
  art.innerHTML = '<shreddit-post id="t3_late9" post-title="x" post-type="text" view-context="SubredditFeed" permalink="/r/test/comments/late9/x/"></shreddit-post>';
  document.querySelector('shreddit-feed').append(art);
  ok('a read post added later is dimmed', await until(() => art.firstElementChild.hasAttribute('data-rf-read')) && opacity(art.firstElementChild) < 1);
  // A read post shown on its own page (not a feed) keeps full strength.
  art.firstElementChild.setAttribute('view-context', 'CommentsPage');
  await sleep(300); // let the opacity transition finish
  ok('not dimmed outside feeds', opacity(art.firstElementChild) === 1);
  art.remove();

  // 5b. Exceptions to dimming: a floating player inside, or the keyboard cursor on it
  await writeIds(['abc123']); await sleep(300);
  ok('(read and dimmed)', opacity(p1) < 1);
  const fl = document.createElement('div'); fl.setAttribute('data-rf-floating', ''); p1.append(fl);
  await sleep(300);
  ok('a post playing in a floating window is not dimmed', opacity(p1) === 1, opacity(p1));
  fl.remove(); await sleep(300);
  ok('...and is dimmed again once docked', opacity(p1) < 1);
  p1.setAttribute('data-rf-kbd', ''); await sleep(300);
  ok('the keyboard cursor’s post is not dimmed', opacity(p1) === 1);
  p1.removeAttribute('data-rf-kbd');

  // 6. Another tab writing while a mark is still waiting to be saved: neither is lost
  await writeIds([]);
  acc.toggle(p1); await sleep(100); acc.toggle(p1);         // marks abc123 (pending)
  await chrome.storage.local.set({[KEY]: {ids: ['fromOtherTab']}}); await sleep(50);
  ok('a pending mark survives another tab’s write', p1.hasAttribute('data-rf-read'));
  await sleep(800);
  const both = await stored();
  ok('after saving, storage has both tabs’ marks', both.includes('fromOtherTab') && both.includes('abc123'), both);
  // The other tab's change notice hasn't arrived when this tab saves: the save still merges.
  await writeIds([]);
  acc.toggle(vid); await sleep(100); acc.toggle(vid);
  window.__silentSet({[KEY]: {ids: ['silentTab']}});
  await sleep(800);
  const merged = await stored();
  ok('saving merges with what is stored now, not this tab’s copy', merged.includes('silentTab') && merged.includes('vid1'), merged);

  // 6b. A failed write keeps the marks pending; the next save includes them
  await writeIds([]);
  const realSet = chrome.storage.local.set;
  let failures = 1;
  chrome.storage.local.set = async obj => { if (KEY in obj && failures-- > 0) throw new Error('QUOTA_BYTES quota exceeded'); return realSet(obj); };
  acc.toggle(p1); await sleep(100); acc.toggle(p1); await sleep(800);
  ok('(the write failed)', !(await stored()).includes('abc123') && failures === 0);
  ok('the mark is still shown', p1.hasAttribute('data-rf-read'));
  acc.toggle(vid); await sleep(100); acc.toggle(vid); await sleep(800);
  const retried = await stored();
  ok('the next save carries the failed mark too', retried.includes('abc123') && retried.includes('vid1'), retried);
  chrome.storage.local.set = realSet;

  // 7. Malformed storage is cleaned when read
  await chrome.storage.local.set({[KEY]: {ids: [1, null, 'abc123', '', 'x', 'abc123']}}); await sleep(100);
  ok('strings only, duplicates collapse to their newest place', p1.hasAttribute('data-rf-read'));
  acc.toggle(vid); await sleep(100); acc.toggle(vid); await sleep(800);
  ok('...as the next save shows', JSON.stringify(await stored()) === '["x","abc123","vid1"]', await stored());
  await writeIds(Array.from({length: 3050}, (_, i) => 'old' + i));
  acc.toggle(p1); await sleep(100); acc.toggle(p1); await sleep(800);
  const capped = await stored();
  ok('an oversized stored list is cut to the newest 3000', capped.length === 3000 && capped[0] === 'old51' && capped.at(-1) === 'abc123', [capped.length, capped[0]]);
  await chrome.storage.local.set({[KEY]: 'junk'}); await sleep(100);
  ok('junk storage means nothing is read', !p1.hasAttribute('data-rf-read'));

  await writeIds([]);
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
