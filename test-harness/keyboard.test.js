// Repeatable assertions for keyboard.js on the mock. build.js inlines this into bundle.html.
// Run from the browser pane: `await window.__kbTest()` returns {pass, fail, results}.
window.__kbTest = async () => {
  const RF = window.RedditFlex, acc = window.RedditFlexAccordion;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const press = (key, opts = {}, target = document.body) => {
    const e = new KeyboardEvent('keydown', {key, bubbles: true, composed: true, cancelable: true, ...opts});
    target.dispatchEvent(e);
    return e.defaultPrevented;
  };
  const sel = () => document.querySelector('shreddit-post[data-rf-kbd]')?.id;
  const setKb = async on => { await RF.save({...(await RF.read()), keyboard: on}); await sleep(80); };
  const post = id => document.getElementById(id);
  const errorsBefore = window.__errors.length;
  const closeAll = async () => {
    for (const p of document.querySelectorAll('shreddit-post')) if (acc.isOpen(p)) acc.toggle(p);
    await sleep(700);
  };
  await closeAll();
  scrollTo(0, 0); await sleep(100);

  // 0. normalize() groundwork
  const n = RF.normalize({width: '99999', enabled: 'yes', commentsHeight: 12.6, bogus: 1});
  ok('normalize clamps ranges', n.width === RF.MAX_W, n.width);
  ok('normalize rejects wrong types', n.enabled === RF.defaults.enabled);
  ok('normalize drops unknown keys', !('bogus' in n));
  ok('normalize keeps every default key', Object.keys(RF.defaults).every(k => k in n));

  // 1. Off by default
  ok('default setting is off', RF.normalize({}).keyboard === false);
  await setKb(false);
  ok('J ignored while off', !press('j') && !sel());

  await setKb(true);

  // 2. J / K
  ok('unhandled key with no selection selects nothing', !press('ArrowRight') && !press('n') && !sel());
  ok('J handled', press('j'));
  ok('first J selects top post', sel() === 't3_abc123', sel());
  // A hidden post (e.g. filtered out) between the first two must be skipped both ways.
  const hiddenArt = document.createElement('article');
  hiddenArt.innerHTML = '<shreddit-post id="t3_hidden" post-type="text" style="display:none"></shreddit-post>';
  post('t3_abc123').closest('article').after(hiddenArt);
  press('j'); await sleep(700);
  ok('J skips the hidden post', sel() === 't3_vid1', sel());
  const vtop = post('t3_vid1').getBoundingClientRect().top;
  ok('J scrolls the post just below the sticky header', vtop >= RF.headerBottom() && vtop < RF.headerBottom() + 40, {vtop, hb: RF.headerBottom()});
  press('k'); await sleep(700);
  ok('K skips the hidden post back', sel() === 't3_abc123', sel());
  hiddenArt.remove();
  press('k');
  ok('K at first post stays', sel() === 't3_abc123', sel());

  // 3. Modifiers and typing
  for (const m of ['ctrlKey', 'altKey', 'metaKey'])
    ok(`${m}+J passes through`, !press('j', {[m]: true}) && sel() === 't3_abc123');
  ok('Shift+ArrowRight passes through', !press('ArrowRight', {shiftKey: true}));
  const input = document.createElement('input');
  document.body.append(input); input.focus();
  ok('J ignored in a light-DOM input', !press('j', {}, input) && sel() === 't3_abc123');
  ok('? ignored in a light-DOM input', !press('?', {}, input) && !document.getElementById('rf-keyboard-help')?.isConnected);
  input.remove();
  const box2 = document.createElement('input'); box2.type = 'checkbox';
  document.body.append(box2); box2.focus();
  ok('J still works after focusing a checkbox', press('j', {}, box2) && sel() === 't3_vid1', sel());
  press('k', {}, box2); box2.remove();
  const host = document.createElement('div');
  const closed = host.attachShadow({mode: 'closed'});
  closed.innerHTML = '<div contenteditable="true">x</div>';
  document.body.append(host);
  closed.firstChild.focus();
  ok('J ignored in a closed-shadow composer', !press('j', {}, closed.firstChild) && sel() === 't3_abc123');
  host.remove();
  const tb = document.createElement('div');
  tb.setAttribute('role', 'textbox'); tb.tabIndex = 0;
  document.body.append(tb); tb.focus();
  ok('J ignored in a role=textbox', !press('j', {}, tb) && sel() === 't3_abc123');
  tb.remove();

  // 4. Enter expands / collapses, but not on a focused link
  const p1 = post('t3_abc123');
  ok('Enter handled', press('Enter')); await sleep(400);
  ok('Enter expands the post', acc.isOpen(p1));
  press('Enter'); await sleep(600);
  ok('Enter again collapses', !acc.isOpen(p1));
  ok('held Enter (repeat) does nothing', press('Enter', {repeat: true}) && !acc.isOpen(p1));
  ok('held C (repeat) does nothing', press('c', {repeat: true}) && !acc.isOpen(p1));
  const link = p1.querySelector('a[slot="actions"]');
  link.addEventListener('click', e => e.preventDefault(), {once: true});
  link.focus();
  ok('Enter on a focused link is left alone', !press('Enter', {}, link) && !acc.isOpen(p1));
  link.blur();
  const title = p1.querySelector('a[slot="title"]');
  title.focus(); // as after a mouse click on the title, which the accordion turns into an expand
  ok('Enter on the post’s own focused title toggles the post', press('Enter', {}, title)); await sleep(500);
  ok('...and expands it', acc.isOpen(p1));
  press('Enter', {}, title); await sleep(600);
  title.blur();
  ok('...and collapses it again', !acc.isOpen(p1));
  // Inline expansion off: Enter and C pass through and change nothing.
  await RF.save({...(await RF.read()), accordion: false}); await sleep(80);
  const selBefore = sel();
  ok('Enter passes through with inline expansion off', !press('Enter') && !acc.isOpen(p1) && sel() === selBefore);
  ok('C passes through with inline expansion off', !press('c') && !acc.isOpen(p1) && sel() === selBefore);
  ok('held Enter/C pass through with inline expansion off', !press('Enter', {repeat: true}) && !press('c', {repeat: true}));
  await RF.save({...(await RF.read()), accordion: true}); await sleep(80);
  const bhost = document.createElement('div');
  const broot = bhost.attachShadow({mode: 'closed'});
  broot.innerHTML = '<button>reddit button</button>';
  document.body.append(bhost); broot.firstChild.focus();
  ok('Enter on a button inside a closed shadow root is left alone', !press('Enter', {}, bhost) && !acc.isOpen(p1));
  bhost.remove(); document.activeElement?.blur?.();

  // 5. C opens with comments, N / P move inside the box (smallest box, so every comment can reach the top)
  const savedH = (await RF.read()).commentsHeight;
  await RF.save({...(await RF.read()), commentsHeight: RF.RANGES.commentsHeight[0]}); await sleep(80);
  ok('C handled', press('c')); await sleep(900);
  const box = acc.panel(p1)?.querySelector('.rf-acc-comments');
  ok('C opens comments inline', acc.isOpen(p1) && !!box);
  if (box) {
    const items = [...box.querySelectorAll(':scope > .rf-c')];
    const rel = c => c.getBoundingClientRect().top - box.getBoundingClientRect().top;
    ok('comment box is scrollable with 2+ top-level comments', items.length >= 2 && box.scrollHeight > box.clientHeight + 50,
      {n: items.length, sh: box.scrollHeight, ch: box.clientHeight});
    if (items.length >= 2) {
      box.scrollTop = 0; await sleep(50);
      ok('N handled', press('n')); await sleep(600);
      ok('N aligns the second comment at the top', Math.abs(rel(items[1]) - 4) < 3, rel(items[1]));
      press('p'); await sleep(600);
      ok('P goes back to the first comment', Math.abs(rel(items[0]) - 4) < 3 || box.scrollTop === 0, rel(items[0]));
      // Scrolled into the middle of the second comment: P returns to its start, then to the first.
      box.scrollTop += rel(items[1]) + 30; await sleep(50);
      press('p'); await sleep(600);
      ok('P mid-comment goes to the start of that comment', Math.abs(rel(items[1]) - 4) < 3, rel(items[1]));
      press('p'); await sleep(600);
      ok('P again goes to the previous comment', Math.abs(rel(items[0]) - 4) < 3 || box.scrollTop === 0, rel(items[0]));
    }
  }
  await RF.save({...(await RF.read()), commentsHeight: savedH}); await sleep(80);
  press('c'); await sleep(700);
  ok('C again hides only the comments', acc.isOpen(p1) && !acc.panel(p1)?.querySelector('.rf-acc-comments'));
  press('c'); await sleep(900);
  ok('C a third time shows them again', !!acc.panel(p1)?.querySelector('.rf-acc-comments'));
  press('Enter'); await sleep(700);
  ok('Enter closes the post', !acc.isOpen(p1));
  press('j');
  ok('N in the feed with no comment box is not swallowed', !press('n'));

  // 5b. N / P on a post page: Reddit's own depth-0 shreddit-comments, no inline box open
  const page = document.createElement('div');
  page.innerHTML = [0, 1, 2].map(i => `<shreddit-comment depth="0" style="display:block;height:500px;border-top:1px solid #555">native ${i}</shreddit-comment>`).join('');
  document.getElementById('main-content').append(page);
  const natives = [...page.children];
  const hb = () => RF.headerBottom() + 12;
  const nrel = c => c.getBoundingClientRect().top - hb();
  // (Instant, and again until it holds: a slower machine may still be settling the layout.)
  for (let i = 0; i < 10 && Math.abs(nrel(natives[0])) >= 1; i++) { scrollTo({top: scrollY + nrel(natives[0]), behavior: 'instant'}); await sleep(100); }
  ok('fixture: first native comment at the top', Math.abs(nrel(natives[0])) < 2, nrel(natives[0]));
  ok('N handled on a post page', press('n')); await sleep(700);
  ok('N aligns the next native comment', Math.abs(nrel(natives[1])) < 3, nrel(natives[1]));
  scrollTo(0, scrollY + 60); await sleep(100);
  press('p'); await sleep(700);
  ok('P mid-comment returns to its start', Math.abs(nrel(natives[1])) < 3, nrel(natives[1]));
  press('p'); await sleep(700);
  ok('P again goes to the previous native comment', Math.abs(nrel(natives[0])) < 3, nrel(natives[0]));
  page.remove(); scrollTo(0, 0); await sleep(100);

  // 6. Gallery arrows
  press('j'); await sleep(50);
  ok('selected the gallery post', sel() === 't3_gal1', sel());
  window.__gallery.length = 0;
  ok('Shift+ArrowRight on a gallery passes through', !press('ArrowRight', {shiftKey: true}) && !window.__gallery.length);
  ok('ArrowRight handled', press('ArrowRight'));
  press('ArrowLeft');
  ok('arrows click the carousel buttons', window.__gallery.join() === 'next,prev', window.__gallery.join());
  press('k'); press('k'); await sleep(50);
  ok('arrows on a non-gallery post pass through', !press('ArrowRight'));

  // 7. Help overlay is modal
  ok('? handled', press('?'));
  const help = document.getElementById('rf-keyboard-help');
  ok('help is shown', help?.isConnected);
  ok('help card has focus', help?.shadowRoot.activeElement?.classList.contains('card'));
  const before = sel();
  ok('J swallowed while help is open', press('j') && sel() === before);
  ok('Tab swallowed while help is open', press('Tab'));
  ok('Ctrl+F still passes while help is open', !press('f', {ctrlKey: true}));
  press('Escape');
  ok('Esc closes help', !help.isConnected);
  const btn = document.createElement('button'); btn.textContent = 'focus me';
  document.body.append(btn); btn.focus();
  press('?');
  ok('help takes focus', document.activeElement === help);
  press('Escape');
  ok('closing help restores focus', document.activeElement === btn);
  btn.remove();
  press('?');
  help.dispatchEvent(new MouseEvent('click', {bubbles: true, composed: true}));
  ok('clicking the backdrop closes help', !help.isConnected);
  press('?');
  help.shadowRoot.querySelector('.card').dispatchEvent(new MouseEvent('click', {bubbles: true, composed: true}));
  ok('clicking the card keeps help open', help.isConnected);
  press('Escape');
  press('?'); press('?');
  ok('? toggles help closed', !help.isConnected);

  // 8. Overlays block keys, our floating player does not
  const dlg = document.createElement('dialog');
  dlg.textContent = 'reddit dialog';
  document.body.append(dlg); dlg.show();
  ok('keys ignored under an open dialog', !press('j') && sel() === before);
  dlg.remove();
  const cover = document.createElement('div');
  cover.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000a';
  document.body.append(cover);
  ok('keys ignored when something covers the feed', !press('j'));
  cover.remove();
  // Like a post's "…" menu: inside the post's shadow root, small, holding focus on a menuitem.
  const menuHost = document.createElement('div'), sr = menuHost.attachShadow({mode: 'open'});
  sr.innerHTML = '<faceplate-menu><div role="menuitem" tabindex="0">Follow post</div></faceplate-menu>';
  document.body.append(menuHost);
  const item = sr.querySelector('[role="menuitem"]');
  item.focus();
  ok('focus is inside the fake menu', document.activeElement === menuHost && sr.activeElement === item);
  ok('keys ignored while a Reddit menu has focus', !press('j') && !press('ArrowRight') && sel() === before);
  menuHost.remove();
  ok('keys work again once the menu closes', press('j') && sel() !== before);
  press('k');
  ok('K returns to the same post', sel() === before, sel());
  const fake = document.createElement('div');
  fake.setAttribute('data-rf-floating', '');
  // Like the real floating player: top layer, so it is really on top. !important beats content.css sizing.
  for (const [k, v] of Object.entries({position: 'fixed', inset: '0', margin: '0', width: '100vw', height: '100vh', border: '0', background: '#300a', zoom: '1'}))
    fake.style.setProperty(k, v, 'important');
  fake.popover = 'manual';
  document.body.append(fake); fake.showPopover();
  ok('fake floating player covers the viewport', fake.getBoundingClientRect().width > 1000, fake.getBoundingClientRect().toJSON());
  ok('keys work over our floating player', press('j'));
  const gal = post('t3_gal1'), gm = gal.querySelector('gallery-carousel');
  gm.scrollIntoView({block: 'center'}); await sleep(100);
  ok('isCovered default still counts the floating player', RF.isCovered(gm, gal) === true);
  ok('isCovered ignoreFloating skips it', RF.isCovered(gm, gal, {ignoreFloating: true}) === false);
  fake.remove();

  // 9. A click on a post makes it the selection, without the outline
  scrollTo(0, 0); await sleep(100);
  press('j'); press('k'); press('k'); press('k'); await sleep(50); // K clamps at the first post
  ok('keyboard selection is on the first post', sel() === 't3_abc123', sel());
  const vt = post('t3_vid1').querySelector('a[slot="title"]');
  vt.addEventListener('click', e => e.preventDefault(), {once: true});
  vt.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, composed: true, button: 0}));
  vt.click(); await sleep(700); // the accordion expands it and stops the click
  ok('clicking another post moves the selection silently', !sel());
  press('j'); await sleep(50);
  ok('J continues from the clicked post', sel() === 't3_gal1', sel());

  // 10. Turning it off clears state
  press('?');
  await setKb(false);
  ok('turning off clears the selection', !sel());
  ok('turning off closes help', !document.getElementById('rf-keyboard-help')?.isConnected);

  await closeAll();
  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
