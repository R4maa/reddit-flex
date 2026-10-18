// Repeatable assertions for the filters unit (settings.js matcher, filters.js, accordion.js inline comments).
// Run from the browser pane: `await window.__ftTest()` returns {pass, fail, failures}.
window.__ftTest = async () => {
  const RF = window.RedditFlex, acc = window.RedditFlexAccordion;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(50); return cond(); };
  const errorsBefore = window.__errors.length;
  const set = async patch => { await RF.save({...(await RF.read()), ...patch}); await sleep(200); }; // filters.js scans after 60ms
  const clear = () => set({filterKeywords: [], filterSubs: [], filterUsers: [], filterPosts: true, filterComments: true});
  const shown = id => { const p = document.getElementById(id); return getComputedStyle(p).display !== 'none' && getComputedStyle(p.closest('article')).display !== 'none'; };
  const test = (line, kind, v) => { const p = RF.parsePattern(line, kind); return p.error ? 'ERR' : p.test(v); };

  // 0. Settings and matcher
  ok('filter lists default empty, both kinds on', RF.defaults.filterKeywords.length === 0 && RF.defaults.filterPosts && RF.defaults.filterComments);
  const n = RF.normalize({filterKeywords: ['  cat ', '', 3, null, 'dog']});
  ok('lists are trimmed, blanks and non-strings dropped', JSON.stringify(n.filterKeywords) === '["cat","dog"]', n.filterKeywords);
  ok('keywords match whole words, any case', test('cat', 'keyword', 'My CAT!') === true && test('cat', 'keyword', 'education') === false);
  ok('phrases and symbols work', test('c++', 'keyword', 'I like c++ a lot') === true && test('new york', 'keyword', 'New York times') === true);
  ok('/regex/flags works', test('/^a te/i', 'keyword', 'A text') === true && test('/^a te/', 'keyword', 'A text') === false);
  const gx = RF.parsePattern('/x/g', 'keyword');
  ok('the g flag does not make one matcher flip-flop', gx.test('x') && gx.test('x') && gx.test('x'));
  ok('an invalid regex reports an error', /unterminated/i.test(RF.parsePattern('/(/', 'keyword').error || ''));
  ok('subreddit names ignore r/ and case', test('r/Pics', 'name', 'pics') === true && test('pics', 'name', 'r/PICS') === true && test('pics', 'name', 'picsart') === false);
  ok('user/name works too', test('user/Bob', 'name', 'bob') === true);
  ok('user names ignore u/ and case', test('u/Bob', 'name', 'bob') === true && test('/u/bob', 'name', 'BOB') === true && test('/u/bob/', 'name', 'bob') === true);
  ok('/r/name is a name, /regex/ still a regex in name lists', test('/r/pics', 'name', 'pics') === true && test('/^pic/', 'name', 'pics') === true);
  ok('unknown "flags" are not a regex: /x/abc is a literal keyword', test('/x/abc', 'keyword', 'see /x/abc here') === true);
  const f = RF.makeFilter({...RF.defaults, filterKeywords: ['video'], filterSubs: ['r/pics'], filterUsers: ['bob']});
  ok('makeFilter gives the reason', f.post({title: 'A video', sub: 'r/x', author: 'a'}) === 'keyword' && f.post({title: 't', sub: 'r/pics'}) === 'subreddit' && f.comment({text: 'hi', author: 'bob'}) === 'user');
  ok('subreddit lists do not apply to comments', RF.makeFilter({...RF.defaults, filterSubs: ['r/pics']}).comment({text: 'r/pics', author: 'x'}) === '');

  // 1. Feed posts
  await clear();
  ok('nothing hidden without filters', shown('t3_abc123') && shown('t3_vid1') && shown('t3_gal1'));
  await set({filterKeywords: ['video']});
  ok('keyword hides the matching post and its card', !shown('t3_vid1') && shown('t3_abc123') && shown('t3_gal1'));
  ok('the card wrapper goes too, so no empty gap is left', getComputedStyle(document.getElementById('t3_vid1').closest('article')).display === 'none');
  const hrAfter = id => { const hr = document.createElement('hr'); document.getElementById(id).closest('article').after(hr); return hr; };
  const hrVid = hrAfter('t3_vid1'), hrTxt = hrAfter('t3_abc123');
  ok('the divider after a hidden post goes too, others stay', getComputedStyle(hrVid).display === 'none' && getComputedStyle(hrTxt).display !== 'none');
  hrVid.remove(); hrTxt.remove();
  ok('the reason is recorded', document.getElementById('t3_vid1').getAttribute('data-rf-filtered') === 'keyword');
  await set({filterKeywords: [], filterSubs: ['r/pics']});
  ok('subreddit hides its post; clearing a list shows posts again', !shown('t3_gal1') && shown('t3_vid1'));
  await set({filterSubs: [], filterUsers: ['u/op_user']});
  ok('author hides their post', !shown('t3_abc123') && shown('t3_gal1'));
  await set({filterPosts: false});
  ok('"Hide matching posts" off shows everything', shown('t3_abc123'));
  await set({filterPosts: true, enabled: false});
  ok('extension off shows everything', shown('t3_abc123'));
  await set({enabled: true});
  ok('back on, the post hides again', !shown('t3_abc123'));
  await clear();

  // 2. New posts appearing later (infinite scroll) and the post's own page
  await set({filterKeywords: ['late arrival']});
  const art = document.createElement('article');
  art.innerHTML = '<shreddit-post id="t3_late1" post-title="A late arrival" subreddit-prefixed-name="r/test" author="x" post-type="text" view-context="SubredditFeed" permalink="/r/test/comments/late1/x/"></shreddit-post>';
  document.querySelector('shreddit-feed').append(art);
  ok('posts added later are filtered too', await until(() => !shown('t3_late1')));
  art.firstElementChild.setAttribute('view-context', 'CommentsPage');
  const art2 = document.createElement('article');
  art2.innerHTML = '<shreddit-post id="t3_late2" post-title="A late arrival" subreddit-prefixed-name="r/test" author="x" post-type="text" view-context="CommentsPage" permalink="/r/test/comments/late2/x/"></shreddit-post>';
  document.querySelector('shreddit-feed').append(art2);
  await sleep(200);
  ok('a post on its own page is never hidden', shown('t3_late2'));
  art.remove(); art2.remove();
  await clear();

  // 2b. Rescans only when filters change; each element is checked once per filter version
  await set({filterKeywords: ['video']});
  const vid = document.getElementById('t3_vid1');
  const realMake = RF.makeFilter;
  let makes = 0;
  RF.makeFilter = (...a) => { makes++; return realMake(...a); };
  vid.removeAttribute('data-rf-filtered'); // pretend it was never filtered
  await set({width: (await RF.read()).width === 900 ? 901 : 900});
  document.body.append(document.createElement('i')); await sleep(200); // a DOM change queues a scan
  ok('an unrelated setting change rebuilds no filter', makes === 0, makes);
  ok('an already-checked post is not checked again until filters change', !vid.hasAttribute('data-rf-filtered'));
  await set({filterKeywords: ['video', 'zzz']});
  ok('a filter change rebuilds both modules’ filters', makes === 2, makes);
  ok('...and rechecks every post', vid.getAttribute('data-rf-filtered') === 'keyword');
  RF.makeFilter = realMake;
  document.body.lastElementChild.remove();
  await set({width: 900});

  // 2c. Data that arrives after the element does
  await set({filterKeywords: ['late title']});
  const art3 = document.createElement('article');
  art3.innerHTML = '<shreddit-post id="t3_late3" post-type="text" view-context="SubredditFeed" permalink="/r/test/comments/late3/x/"></shreddit-post>';
  document.querySelector('shreddit-feed').append(art3);
  await sleep(200);
  ok('a post without attributes yet is left alone', shown('t3_late3'));
  art3.firstElementChild.setAttribute('post-title', 'A late title');
  ok('...and filtered once its title arrives', await until(() => !shown('t3_late3')));
  art3.remove();
  await set({filterUsers: ['spammer2'], filterKeywords: ['late body']});
  const lc = document.createElement('shreddit-comment'); lc.setAttribute('depth', '0');
  document.getElementById('main-content').append(lc);
  await sleep(200);
  ok('an empty comment is left alone', !lc.hasAttribute('collapsed'));
  lc.innerHTML = '<div slot="comment"><p>a late body arrives</p></div>';
  ok('...and collapsed once its text arrives', await until(() => lc.hasAttribute('collapsed')));
  lc.remove();
  await clear();

  // 3. Keyboard J/K skip hidden posts
  await set({filterKeywords: ['video'], keyboard: true});
  scrollTo(0, 0); await sleep(100);
  const press = k => document.body.dispatchEvent(new KeyboardEvent('keydown', {key: k, bubbles: true, composed: true, cancelable: true}));
  press('j'); press('j'); await sleep(50);
  ok('J skips a filtered post', document.querySelector('shreddit-post[data-rf-kbd]')?.id === 't3_gal1', document.querySelector('shreddit-post[data-rf-kbd]')?.id);
  await set({keyboard: false});
  await clear();

  // 4. Inline comments (accordion)
  const p1 = document.getElementById('t3_abc123');
  const box = () => acc.panel(p1)?.querySelector('.rf-acc-comments');
  const byAuthor = name => [...(box()?.querySelectorAll('.rf-c') || [])].find(c => c.querySelector(':scope > .rf-c-head .rf-c-author')?.textContent === name);
  const label = c => c?.querySelector(':scope > .rf-c-head .rf-c-count')?.textContent;
  for (const p of document.querySelectorAll('shreddit-post')) if (acc.isOpen(p)) acc.toggle(p);
  await sleep(700);
  await set({filterUsers: ['bob'], filterKeywords: ['kitty'], collapseAutoMod: false});
  acc.toggle(p1, {comments: true});
  await until(() => !!byAuthor('bob'));
  ok('a filtered user\'s comment is collapsed with its replies', byAuthor('bob')?.classList.contains('rf-collapsed') && label(byAuthor('bob')) === 'filtered · +1 hidden', label(byAuthor('bob')));
  ok('a keyword match collapses that comment only', byAuthor('MoonMoon14')?.classList.contains('rf-collapsed') && label(byAuthor('MoonMoon14')) === 'filtered' && !byAuthor('rndrsn9').classList.contains('rf-collapsed'), label(byAuthor('MoonMoon14')));
  ok('unmatched comments stay open', !byAuthor('dave')?.classList.contains('rf-collapsed') && !byAuthor('AutoModerator')?.classList.contains('rf-collapsed'));
  byAuthor('bob').querySelector(':scope > .rf-c-head').click(); await sleep(600);
  ok('a filtered comment still opens on click', !byAuthor('bob').classList.contains('rf-collapsed'));
  // Lists changing while the thread is open: it follows without reopening.
  await set({filterUsers: [], filterKeywords: []});
  ok('clearing the lists reopens filtered comments in an open thread', !byAuthor('MoonMoon14').classList.contains('rf-collapsed') && !byAuthor('MoonMoon14').dataset.rfFiltered);
  await set({filterUsers: ['dave']});
  ok('a new entry collapses a comment in an open thread', byAuthor('dave').classList.contains('rf-collapsed') && label(byAuthor('dave')) === 'filtered');
  await set({filterUsers: ['AutoModerator'], collapseAutoMod: true});
  await set({filterUsers: []});
  ok('AutoModerator stays collapsed by its own option when unfiltered', byAuthor('AutoModerator').classList.contains('rf-collapsed') && label(byAuthor('AutoModerator')) !== 'filtered', label(byAuthor('AutoModerator')));
  await set({collapseAutoMod: false});
  acc.toggle(p1, {comments: true}); await sleep(700);
  await set({filterComments: false});
  acc.toggle(p1, {comments: true});
  await until(() => !!byAuthor('bob'));
  ok('"Collapse matching comments" off leaves them open', !byAuthor('bob').classList.contains('rf-collapsed'));
  acc.toggle(p1); await sleep(700);
  await clear();
  await set({collapseAutoMod: true});

  // 5. Reddit's own comments on a post page
  const host = document.createElement('div');
  host.innerHTML = '<shreddit-comment author="spammer" depth="0"><div slot="comment"><p>buy now</p></div></shreddit-comment>'
    + '<shreddit-comment author="friend" depth="0"><div slot="comment"><p>nice photo of a kitty</p></div></shreddit-comment>'
    + '<shreddit-comment author="other" depth="0"><div slot="comment"><p>hello</p></div></shreddit-comment>';
  document.getElementById('main-content').append(host);
  const [spam, kit, other] = host.children;
  await set({filterUsers: ['spammer'], filterKeywords: ['kitty']});
  ok('native comment by a filtered user is collapsed', await until(() => spam.hasAttribute('collapsed')) && spam.getAttribute('data-rf-filtered') === 'user');
  ok('native comment with a keyword is collapsed', kit.hasAttribute('collapsed') && kit.getAttribute('data-rf-filtered') === 'keyword');
  ok('other native comments are untouched', !other.hasAttribute('collapsed') && !other.hasAttribute('data-rf-filtered'));
  spam.removeAttribute('collapsed'); // the user opens it
  await set({filterKeywords: ['kitty', 'hello']});
  ok('a comment the user opened stays open', !spam.hasAttribute('collapsed'));
  ok('new keywords apply to comments already on the page', other.hasAttribute('collapsed'));
  await set({filterKeywords: []});
  ok('removing a filter undoes its collapse', !kit.hasAttribute('collapsed') && !kit.hasAttribute('data-rf-filtered') && !other.hasAttribute('collapsed'));
  host.remove();
  await clear();

  // 5b. Reddit's current comment markup: shreddit-comment > details > … > [slot="comment"],
  // with replies nested inside the parent's <details>. Closing the <details> is the collapse.
  const native = (author, text, replies = '') => `<shreddit-comment author="${author}" depth="0"><details open><summary>${author}</summary>`
    + `<div><div><div slot="comment"><p>${text}</p></div></div>${replies}</div></details></shreddit-comment>`;
  const host2 = document.createElement('div');
  host2.innerHTML = native('spammer', 'buy now')
    + native('parent', 'an innocent comment', native('child', 'a kitty reply').replace('depth="0"', 'depth="1"'))
    + native('deleted', '', native('kid', 'another kitty').replace('depth="0"', 'depth="1"')).replace(/<div slot="comment">.*?<\/div>/, '');
  document.getElementById('main-content').append(host2);
  const [spam2, parent2] = host2.children, child2 = parent2.querySelector('shreddit-comment');
  const isOpen = c => c.querySelector(':scope > details').open;
  await set({filterUsers: ['spammer'], filterKeywords: ['kitty', 'innocent']});
  ok('a filtered native comment closes its <details>', await until(() => !isOpen(spam2)) && spam2.getAttribute('data-rf-filtered') === 'user' && !spam2.hasAttribute('collapsed'));
  await set({filterUsers: [], filterKeywords: ['kitty']});
  ok('a reply\'s keyword collapses the reply only', await until(() => !isOpen(child2)) && isOpen(parent2) && !parent2.hasAttribute('data-rf-filtered'));
  ok('removing a filter reopens the <details>', isOpen(spam2) && !spam2.hasAttribute('data-rf-filtered'));
  child2.querySelector(':scope > details').open = true; // the user opens it
  await set({filterKeywords: ['kitty', 'innocent']});
  ok('a reply the user opened stays open', isOpen(child2));
  ok('the parent\'s own text still matches', await until(() => !isOpen(parent2)));
  const del2 = host2.children[2], kid2 = del2.querySelector('shreddit-comment');
  ok('a comment without a body doesn\'t borrow a reply\'s text', !del2.hasAttribute('data-rf-filtered') && isOpen(del2) && !isOpen(kid2) && kid2.getAttribute('author') === 'kid');
  host2.remove();
  await clear();

  // 6. Invalid entries are ignored, not fatal
  await set({filterKeywords: ['/(/', 'video']});
  ok('an invalid regex is skipped, the rest still work', !shown('t3_vid1'));
  await clear();

  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
