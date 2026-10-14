// Repeatable assertions for the inline comments unit (accordion.js). build.js inlines this into bundle.html.
// Run from the browser pane: `await window.__cmTest()` returns {pass, fail, failures}.
window.__cmTest = async () => {
  const RF = window.RedditFlex, acc = window.RedditFlexAccordion;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const p1 = document.getElementById('t3_abc123');
  const errorsBefore = window.__errors.length;
  const set = async patch => { await RF.save({...(await RF.read()), ...patch}); await sleep(80); };
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(50); return cond(); };
  const box = () => acc.panel(p1)?.querySelector('.rf-acc-comments');
  const top = () => [...(box()?.querySelectorAll(':scope > .rf-c:not(.rf-c-moreitem)') || [])];
  const byAuthor = name => [...(box()?.querySelectorAll('.rf-c') || [])].find(c => c.querySelector(':scope > .rf-c-head .rf-c-author')?.textContent === name);
  const fetches = pattern => window.__fetches.filter(u => pattern.test(u)).length;
  const reset = async () => {
    for (const p of document.querySelectorAll('shreddit-post')) if (acc.isOpen(p)) acc.toggle(p);
    await sleep(700);
  };

  // 0. Settings
  ok('commentSort defaults to Best', RF.defaults.commentSort === 'confidence');
  ok('invalid sort falls back', RF.normalize({commentSort: 'random'}).commentSort === 'confidence');
  ok('valid sort is kept', RF.normalize({commentSort: 'qa'}).commentSort === 'qa');
  ok('AutoMod collapse and thread colours default on', RF.defaults.collapseAutoMod === true && RF.defaults.threadColors === true);

  await reset();
  await set({commentSort: 'confidence', collapseAutoMod: true, threadColors: true, accordion: true});
  window.__rate.force429 = false;
  acc.toggle(p1, {comments: true});
  ok('comments render', await until(() => top().length >= 4), top().length);

  // 1. Upvote ratio
  const stat = acc.panel(p1).querySelector('.rf-acc-stat')?.textContent || '';
  ok('upvote ratio shown', /96% upvoted/.test(stat) && /1\.2k/.test(stat), stat);

  // 2. Sort dropdown
  const sel = acc.panel(p1).querySelector('select.rf-acc-sort');
  ok('sort dropdown shown with 6 orders', sel && sel.options.length === 6 && sel.value === 'confidence', sel?.value);
  ok('first request used the saved sort', /sort=confidence/.test(window.__fetches.find(u => /abc123.*\.json/.test(u)) || ''));

  // 3. AutoModerator collapsed
  const am = byAuthor('AutoModerator');
  ok('AutoModerator comment starts collapsed', am?.classList.contains('rf-collapsed'));
  ok('...with its reply count shown', am?.querySelector(':scope > .rf-c-head .rf-c-count')?.textContent === '+1 hidden', am?.querySelector('.rf-c-count')?.textContent);
  ok('other comments are not collapsed', !byAuthor('bob')?.classList.contains('rf-collapsed'));

  // 4. Thread colours
  const c1 = byAuthor('rndrsn9'), c2 = byAuthor('Ahchuu');
  ok('html has the thread colour class', document.documentElement.classList.contains('rf-thread-colors'));
  const line = el => getComputedStyle(el).getPropertyValue('--rf-line').trim();
  ok('depth 0 and depth 1 lines differ in colour', line(c1) && line(c1) !== line(c2), [line(c1), line(c2)]);
  const elbow = getComputedStyle(c2, '::before').borderLeftColor;
  const probe = document.createElement('div'); probe.style.color = line(c1); document.body.append(probe);
  ok('a reply\'s elbow uses its parent\'s colour', elbow === getComputedStyle(probe).color, [elbow, getComputedStyle(probe).color]);
  probe.remove();
  await set({threadColors: false});
  ok('turning colours off removes the class', !document.documentElement.classList.contains('rf-thread-colors'));
  ok('...and lines fall back to one colour', line(c1) === line(c2));
  await set({threadColors: true});

  // 5. "N more replies" loads inline, nested by parent_id
  const moreBtn = [...c1.querySelectorAll(':scope > .rf-c-content > .rf-c-kids > .rf-c-moreitem button.rf-c-more')][0];
  ok('"3 more replies" is a button', moreBtn?.textContent === '3 more replies', moreBtn?.textContent);
  const countBefore = Number(c1.dataset.count);
  const mcBefore = fetches(/morechildren/);
  const label = () => c1.querySelector(':scope > .rf-c-head .rf-c-count').textContent;
  c1.querySelector(':scope > .rf-c-head .rf-c-avatar').click(); await sleep(600);
  ok('collapsed thread shows "+3 hidden"', label() === '+3 hidden', label());
  window.__childFirst = true; // the server lists replies before their parents
  moreBtn.click();
  ok('replies load', await until(() => !!byAuthor('late_m1')));
  window.__childFirst = false;
  ok('the collapsed label counts the loaded replies', label() === '+6 hidden', label());
  c1.querySelector(':scope > .rf-c-head .rf-c-avatar').click(); await sleep(600);
  const mcUrl = window.__fetches.filter(u => /morechildren/.test(u)).pop() || '';
  ok('one morechildren request with link, ids and sort', fetches(/morechildren/) === mcBefore + 1 && /link_id=t3_abc123/.test(mcUrl) && /children=m1,m2,m3/.test(mcUrl) && /sort=confidence/.test(mcUrl), mcUrl);
  const m1 = byAuthor('late_m1'), m2 = byAuthor('late_m2'), m3 = byAuthor('late_m3');
  ok('loaded replies sit under their parent', m1?.parentElement?.closest('.rf-c') === c1 && m3?.parentElement?.closest('.rf-c') === c1);
  ok('a reply to a loaded reply nests under it', m2?.parentElement?.closest('.rf-c') === m1);
  ok('loaded replies have the next depth', m1?.dataset.depth === '1' && m2?.dataset.depth === '2');
  ok('the more button is gone', !moreBtn.isConnected);
  ok('the thread\'s hidden count grows', Number(c1.dataset.count) === countBefore + 3, [countBefore, c1.dataset.count]);

  const cont = byAuthor('bob')?.querySelector('.rf-c-moreitem a.rf-c-more');
  ok('an empty stub links to the parent comment\'s page', cont?.textContent === 'Continue thread →' && /\/c5\/$/.test(cont.href), cont?.href);

  // 6. Top-level "more comments"
  const topMore = [...box().querySelectorAll(':scope > .rf-c-moreitem button')].find(b => /more comments/.test(b.textContent));
  ok('top-level "2 more comments" button', topMore?.textContent === '2 more comments', topMore?.textContent);
  topMore?.click();
  ok('top-level comments load', await until(() => !!byAuthor('late_tB')));
  ok('they are top-level, before the thread link', byAuthor('late_tA')?.parentElement === box() && box().lastElementChild.classList.contains('rf-acc-all'));

  // 7. Rate-limited "more" keeps the button and says why
  acc.toggle(p1); await sleep(700);
  acc.toggle(p1, {comments: true});
  await until(() => !!box()?.querySelector('button.rf-c-more'));
  window.__rate.force429 = true;
  const rb = box().querySelector('button.rf-c-more');
  rb.click();
  ok('429 keeps the button with a message', await until(() => /limiting/.test(rb.textContent)) && !rb.disabled && rb.isConnected, rb.textContent);
  window.__rate.force429 = false;
  // A 429 pauses background work; foreground requests still go out, so a retry works.
  rb.click();
  ok('retrying after the limit loads the replies', await until(() => !rb.isConnected && !!byAuthor('late_m1')));

  // 8. Changing the sort refetches once, reorders, and is remembered
  const sel2 = acc.panel(p1).querySelector('select.rf-acc-sort');
  const jsonBefore = fetches(/abc123.*\.json/), newBefore = fetches(/abc123.*\.json.*sort=new/);
  sel2.value = 'new'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  ok('new order loads', await until(() => top()[0]?.querySelector('.rf-c-author')?.textContent === 'AutoModerator'), top()[0]?.querySelector('.rf-c-author')?.textContent);
  // One request the first time this sort is used in the page; none once it is cached (repeat runs).
  const expectNew = newBefore ? 0 : 1;
  ok('at most one request with sort=new', fetches(/abc123.*\.json/) - jsonBefore === expectNew && fetches(/abc123.*\.json.*sort=new/) - newBefore === expectNew);
  ok('the choice becomes the default', (await RF.read()).commentSort === 'new');
  ok('the comment box scrolls to the top', box().scrollTop === 0);
  byAuthor('rndrsn9')?.querySelector('button.rf-c-more')?.click();
  await until(() => !!byAuthor('late_m1'));
  ok('"more" requests use the panel\'s current sort', /sort=new/.test(window.__fetches.filter(u => /morechildren/.test(u)).pop() || ''));
  const jsonAfterNew = fetches(/abc123.*\.json/);
  sel2.value = 'confidence'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  await sleep(100);
  ok('switching back uses the cache', fetches(/abc123.*\.json/) === jsonAfterNew && top()[0]?.querySelector('.rf-c-author')?.textContent === 'rndrsn9');

  // 9. Sort that fails to load shows a message, not a stale list
  window.__rate.force429 = true;
  sel2.value = 'top'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  const f9 = window.__fetches.length;
  ok('failed sort explains itself', await until(() => /limiting/.test(box()?.textContent || '')), {text: box()?.textContent.slice(0, 60), selConnected: sel2.isConnected, value: sel2.value, fetched: window.__fetches.slice(f9)});
  window.__rate.force429 = false;

  // 10. Top-level paging
  window.__extraTop = 12;
  sel2.value = 'controversial'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  await until(() => top().length >= 10);
  const pageBtn = [...box().querySelectorAll(':scope > .rf-c-moreitem button')].find(b => /^Show \d+ more comments$/.test(b.textContent));
  ok('first page shows 10 comments and a "Show 6 more" button', top().length === 10 && pageBtn?.textContent === 'Show 6 more comments', [top().length, pageBtn?.textContent]);
  const pagedFetches = window.__fetches.length;
  pageBtn?.click(); await sleep(50);
  ok('the next page renders without a request', top().length === 16 && window.__fetches.filter(u => !/user_data/.test(u)).length === window.__fetches.slice(0, pagedFetches).filter(u => !/user_data/.test(u)).length, top().length);
  ok('Reddit\'s own "more" follows the last page', /2 more comments/.test(box().querySelector(':scope > .rf-c-moreitem:last-of-type button')?.textContent || ''));
  window.__extraTop = 0;

  // 10b. Exactly 10 top-level comments: no paging button, Reddit's "more" still follows
  window.__extraTop = 6;
  sel2.value = 'old'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  await until(() => top().length >= 10);
  const lastItem = box().querySelector(':scope > .rf-c-moreitem:last-of-type button')?.textContent || '';
  ok('10 comments: no "Show more", Reddit\'s "more" is last', top().length === 10 && !/^Show/.test(lastItem) && /2 more comments/.test(lastItem), [top().length, lastItem]);
  window.__extraTop = 0;

  // 10c. More than 100 hidden ids: one request of 100, the rest stay as a button
  window.__bigMore = true;
  sel2.value = 'qa'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  await until(() => !!byAuthor('rndrsn9')?.querySelector('button.rf-c-more'));
  const big = byAuthor('rndrsn9').querySelector('button.rf-c-more');
  ok('150 hidden replies', big.textContent === '150 more replies', big.textContent);
  big.click();
  await until(() => !!byAuthor('late_m1'));
  const bigUrl = window.__fetches.filter(u => /morechildren/.test(u)).pop() || '';
  const sent = (new URL(bigUrl, 'https://x').searchParams.get('children') || '').split(',');
  ok('the request carries the first 100 ids', sent.length === 100 && sent[0] === 'm1', sent.length);
  const restBtn = byAuthor('rndrsn9').querySelector('button.rf-c-more');
  ok('the remaining 50 stay as a button', restBtn?.textContent === '50 more replies', restBtn?.textContent);
  window.__bigMore = false;

  // 10d. A "more" that returns nothing says so
  window.__emptyMore = true;
  // (Not 'top': section 9 needs that sort to stay uncached across repeat runs.)
  sel2.value = 'confidence'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  await until(() => !!byAuthor('rndrsn9')?.querySelector('button.rf-c-more'));
  const emptyBtn = byAuthor('rndrsn9').querySelector('button.rf-c-more');
  emptyBtn.click();
  ok('an empty answer leaves a disabled note', await until(() => emptyBtn.textContent === 'No more replies to show') && emptyBtn.disabled);
  window.__emptyMore = false;

  // 11. AutoMod option off
  await set({collapseAutoMod: false});
  sel2.value = 'new'; sel2.dispatchEvent(new Event('change', {bubbles: true}));
  await until(() => !!byAuthor('AutoModerator'));
  ok('with the option off, AutoModerator is expanded', !byAuthor('AutoModerator')?.classList.contains('rf-collapsed'));
  await set({collapseAutoMod: true});

  // 12. Hiding comments removes the dropdown too
  acc.toggle(p1, {comments: true}); await sleep(700);
  ok('hide comments removes the sort dropdown', !acc.panel(p1)?.querySelector('.rf-acc-sort') && !box());

  // 13. No upvote_ratio in the response: no stat
  window.__noRatio = true;
  const art = document.createElement('article');
  art.innerHTML = `<shreddit-post id="t3_tmp${Date.now()}" post-type="text" view-context="SubredditFeed" permalink="/r/test/comments/tmp${Date.now()}/x/"><a slot="title" href="#">tmp</a></shreddit-post>`;
  p1.closest('article').after(art);
  const tmp = art.firstElementChild;
  acc.toggle(tmp);
  await until(() => !!acc.panel(tmp)?.querySelector('.rf-acc-actions'));
  ok('no ratio, no upvote stat', !acc.panel(tmp)?.querySelector('.rf-acc-stat'));
  acc.toggle(tmp); await sleep(700); art.remove();
  window.__noRatio = false;

  // 14. The grip under the comment box sets the height of every box
  const savedH = (await RF.read()).commentsHeight;
  await set({commentsHeight: 1000});
  acc.toggle(p1, {comments: true});
  await until(() => top().length >= 4);
  const grip = acc.panel(p1).querySelector('.rf-acc-grip');
  const gripAt = () => { const r = grip.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + 7}; };
  const pointer = (type, target, y, x = gripAt().x) => target.dispatchEvent(new PointerEvent(type, {bubbles: true, composed: true, cancelable: true, pointerId: 7, button: 0, isPrimary: true, clientX: x, clientY: y}));
  ok('fixture: the thread is shorter than its 1000px cap', box().getBoundingClientRect().height < 900, box().getBoundingClientRect().height);
  let at = gripAt();
  pointer('pointerdown', grip, at.y); pointer('pointerup', grip, at.y); await sleep(150);
  ok('a click on the grip leaves the height alone', (await RF.read()).commentsHeight === 1000, (await RF.read()).commentsHeight);
  at = gripAt();
  pointer('pointerdown', grip, at.y); pointer('pointermove', grip, at.y + 25); pointer('pointermove', grip, at.y + 50); pointer('pointerup', grip, at.y + 50); await sleep(150);
  ok('dragging down 50px adds 50px', (await RF.read()).commentsHeight === 1050, (await RF.read()).commentsHeight);
  grip.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, composed: true})); await sleep(150);
  ok('double-click resets to the default', (await RF.read()).commentsHeight === RF.defaults.commentsHeight, (await RF.read()).commentsHeight);
  grip.focus();
  ok('the grip takes keyboard focus', document.activeElement === grip || grip.getRootNode().activeElement === grip);
  const key = (k, opts = {}) => grip.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, composed: true, cancelable: true, ...opts}));
  const heightAfter = async (k, opts) => { key(k, opts); await sleep(120); return (await RF.read()).commentsHeight; };
  const d = RF.defaults.commentsHeight, [minH, maxH] = RF.RANGES.commentsHeight;
  ok('ArrowDown adds 20px', await heightAfter('ArrowDown') === d + 20);
  ok('Shift+ArrowUp takes 100px', await heightAfter('ArrowUp', {shiftKey: true}) === d - 80);
  ok('Home goes to the minimum', await heightAfter('Home') === minH);
  ok('End goes to the maximum', await heightAfter('End') === maxH);
  ok('aria-valuenow follows the height', grip.getAttribute('aria-valuenow') === String(maxH), grip.getAttribute('aria-valuenow'));
  ok('Ctrl+ArrowUp is left alone', await heightAfter('ArrowUp', {ctrlKey: true}) === maxH);
  grip.blur();
  acc.toggle(p1, {comments: true}); await sleep(700);
  await set({commentsHeight: savedH});

  // 15. Loaded posts are cached for reopening, but only so many (least recently opened go first)
  await reset();
  const was = acc._test.setCacheMax(2);
  const n = Date.now(), tmps = ['tmpa', 'tmpb', 'tmpc'].map(t => {
    const a = document.createElement('article');
    a.innerHTML = `<shreddit-post id="t3_${t}${n}" post-type="text" view-context="SubredditFeed" permalink="/r/test/comments/${t}${n}/x/"><a slot="title" href="#">${t}</a></shreddit-post>`;
    p1.closest('article').after(a);
    return a.firstElementChild;
  });
  const openClose = async p => { acc.toggle(p); await until(() => !!acc.panel(p)?.querySelector('.rf-acc-actions')); acc.toggle(p); await sleep(700); };
  for (const p of tmps) await openClose(p);
  const loads = t => fetches(new RegExp(`${t}${n}.*\\.json`));
  ok('each post loaded once', ['tmpa', 'tmpb', 'tmpc'].every(t => loads(t) === 1), ['tmpa', 'tmpb', 'tmpc'].map(loads));
  await openClose(tmps[2]);
  ok('the newest stays cached', loads('tmpc') === 1, loads('tmpc'));
  await openClose(tmps[0]);
  ok('the oldest past the limit is loaded again', loads('tmpa') === 2, loads('tmpa'));
  acc._test.setCacheMax(was);
  for (const p of tmps) p.closest('article').remove();

  await reset();
  await set({commentSort: 'confidence'});
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
