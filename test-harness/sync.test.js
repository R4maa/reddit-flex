// Assertions for unit 8 (settings sync: settings.js save, sync.js in the worker with toSync/fromSync).
// Most tests run the worker's sync engine on fake Chromes of their own whose storage answers late
// and in random order, like the real one, and whose sync storage enforces Chrome's quotas; some
// computers are linked through a fake cloud (each has its own sync copy, writes arrive late, the
// later write of an item wins). Pages are message senders. Run: `await window.__syTest()`.
window.__syTest = async () => {
  const RF = window.RedditFlex, SY = window.RedditFlexSync;
  const sleep = t => new Promise(r => setTimeout(r, t));
  const results = [];
  const ok = (name, cond, info) => results.push({name, pass: !!cond, ...(cond ? {} : {info})});
  const until = async (cond, ms = 4000) => { const t0 = Date.now(); while (!(await cond()) && Date.now() - t0 < ms) await sleep(20); return cond(); };
  const errorsBefore = window.__errors.length;
  const size = (k, v) => new TextEncoder().encode(k).length + new TextEncoder().encode(JSON.stringify(v)).length;
  const chunks = (items, list) => Object.keys(items).filter(k => k.startsWith(`redditFlex.${list}.`)).sort();
  const start = await RF.read();
  const GAP = 250; // the real gap is SY.GAP; shorter here to keep the suite quick

  // A fake Chrome: storage answers after `delay[area]()` ms, onChanged fires `delay.event(area)` ms later.
  // Its sync storage refuses writes over Chrome's quotas, counting what is already stored.
  function fakeChrome(delay = {}, cloud = null) {
    const stores = {local: {}, sync: {}}, stamps = {}, listeners = [], log = [];
    const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    const wait = name => sleep(delay[name] ? delay[name]() : 0);
    const fire = (changes, name) => { if (Object.keys(changes).length) setTimeout(() => listeners.forEach(fn => fn(clone(changes), name)), delay.event ? delay.event(name) : 0); };
    // Applies a write; like Chrome, only values that actually change are reported.
    const put = (data, set, removed, changes = {}) => {
      for (const [k, v] of Object.entries(set)) { if (JSON.stringify(data[k]) !== JSON.stringify(v)) changes[k] = {oldValue: data[k], newValue: clone(v)}; data[k] = clone(v); }
      for (const k of removed) if (k in data) { changes[k] = {oldValue: data[k]}; delete data[k]; }
      return changes;
    };
    const area = name => {
      const data = stores[name];
      return {
        get: async key => {
          await wait(name);
          if (key == null) return clone(data);
          const keys = typeof key === 'string' ? [key] : Array.isArray(key) ? key : Object.keys(key);
          return clone(Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])));
        },
        set: async obj => {
          await wait(name);
          if (name === 'sync') {
            const after = {...data, ...obj};
            if (Object.entries(obj).some(([k, v]) => size(k, v) > 8192)) throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
            if (Object.entries(after).reduce((sum, [k, v]) => sum + size(k, v), 0) > 102400) throw new Error('QUOTA_BYTES quota exceeded');
            if (Object.keys(after).length > 512) throw new Error('MAX_ITEMS quota exceeded');
            log.push({op: 'set', at: Date.now(), keys: Object.keys(obj)});
          }
          const changes = put(data, obj, []);
          if (name === 'sync') cloud?.send(self, obj, []);
          fire(changes, name);
        },
        remove: async key => {
          await wait(name);
          if (name === 'sync') log.push({op: 'remove', at: Date.now(), keys: [].concat(key)});
          const changes = put(data, {}, [].concat(key));
          if (name === 'sync') cloud?.send(self, {}, [].concat(key));
          fire(changes, name);
        },
      };
    };
    const self = {stores, log, storage: {local: area('local'), sync: area('sync'), onChanged: {addListener: fn => listeners.push(fn)}},
      runtime: {id: 'self', getURL: p => `chrome-extension://self/${p}`},
      // (the cloud's side) this computer's own write, and another's arriving: the later write of an item wins
      stamp: (set, removed, at) => { for (const k of [...Object.keys(set), ...removed]) stamps[k] = at; },
      receive: (set, removed, at) => {
        const newer = k => at > (stamps[k] || 0);
        const changes = put(stores.sync, Object.fromEntries(Object.entries(set).filter(([k]) => newer(k))), removed.filter(newer));
        self.stamp(set, removed, at);
        fire(changes, 'sync');
      }};
    return self;
  }
  // Chrome sync between computers: each has its own copy, a write reaches the others lag() ms later.
  function cloud(lag) {
    const members = [];
    let clock = 0;
    return {
      join: c => members.push(c),
      send: (from, set, removed) => {
        const at = ++clock, copy = JSON.parse(JSON.stringify(set));
        from.stamp(set, removed, at);
        for (const c of members) if (c !== from) setTimeout(() => c.receive(copy, removed, at), lag());
      },
    };
  }
  const jitter = (min, max) => () => min + Math.random() * (max - min);
  const POPUP = {id: 'self', url: 'chrome-extension://self/popup.html'};
  const TAB = n => ({id: 'self', url: `https://www.reddit.com/r/test${n}/`, tab: {id: n}});
  // One computer: a fake Chrome, its worker, and pages that message it.
  function computer(delay, stores, gap = GAP, link = null, retry = 10000) {
    const c = fakeChrome(delay, link);
    link?.join(c);
    if (stores) Object.assign(c.stores.local, stores.local || {}), Object.assign(c.stores.sync, stores.sync || {});
    const engine = SY.start(c, {gap, retry});
    const send = (msg, sender) => new Promise(resolve => { if (!engine.onMessage(msg, sender, resolve)) resolve({ok: false, error: 'ignored'}); });
    // As RF.save does: the page's whole settings, and the settings it made them from.
    const save = (patch, sender = TAB(1), seen = RF.normalize(c.stores.local.redditFlex || start)) => send({type: 'rf-save', settings: RF.normalize({...seen, ...patch}), base: seen}, sender);
    const setSync = on => send({type: 'rf-sync', on}, POPUP);
    const local = () => RF.normalize(c.stores.local.redditFlex);
    const synced = () => { const r = SY.fromSync(c.stores.sync); return r && RF.normalize(r.settings); };
    const settle = async () => { await sleep(gap * 2 + 200); await engine.idle(); await sleep(50); await engine.idle(); };
    return {c, engine, send, save, setSync, local, synced, settle, on: () => c.stores.local.redditFlexArea === 'sync'};
  }
  const slow = {local: jitter(0, 15), sync: jitter(5, 40)};

  // 1. Chunking and size limits (pure functions)
  const longKw = Array.from({length: 200}, (_, i) => `keyword number ${i} ${'x'.repeat(80)}`);
  const big = SY.toSync(RF.normalize({...start, filterKeywords: longKw, filterUsers: ['u/ünïcødé'.repeat(20)]})).items;
  ok('long lists are split into items under 8 KB each', chunks(big, 'filterKeywords').length >= 3 && Object.entries(big).every(([k, v]) => size(k, v) <= 8192), Object.entries(big).map(([k, v]) => [k, size(k, v)]));
  const back = SY.fromSync(big).settings;
  ok('...and come back whole and in order', JSON.stringify(back.filterKeywords) === JSON.stringify(longKw) && back.filterUsers[0] === 'u/ünïcødé'.repeat(20));
  ok('...with the other settings intact, one item each', back.width === start.width && back.commentSort === start.commentSort && big['redditFlex.width'] === start.width && !('redditFlex' in big));
  const emoji = Array.from({length: 60}, (_, i) => `${i} ${'\u{1F600}'.repeat(70)}`);
  const e = SY.toSync(RF.normalize({...start, filterKeywords: emoji})).items;
  ok('sizes are counted in bytes, not characters', chunks(e, 'filterKeywords').length >= 3 && Object.entries(e).every(([k, v]) => size(k, v) <= 8192), Object.entries(e).map(([k, v]) => [k, size(k, v)]));
  const huge = Array.from({length: 500}, (_, i) => `${i}`.padEnd(300, 'y'));
  let err = null;
  try { SY.toSync(RF.normalize({...start, filterKeywords: huge})); } catch (x) { err = x; }
  ok('settings too big for sync are refused, saying how big', /^Too much to sync: \d+ KB; the limit is \d+ KB\. Shorten the filter lists\.$/.test(err?.message), err?.message);
  const lines = n => Array.from({length: n}, (_, i) => `${i}`.padEnd(300, 'c'));
  let fits = true; try { SY.toSync(RF.normalize({...start, filterKeywords: lines(300)})); } catch { fits = false; }
  let over = false; try { SY.toSync(RF.normalize({...start, filterKeywords: lines(340)})); } catch { over = true; }
  ok('the popup\'s promise holds: about 300 long lines fit, 340 do not', fits && over, {fits, over});
  ok('nothing synced (or only the single item of an earlier version) reads as none', SY.fromSync({}) === null && SY.fromSync({redditFlex: {width: 1000}}) === null);
  const gap1 = {...big};
  delete gap1[chunks(big, 'filterKeywords')[1]];
  const half = SY.fromSync(gap1);
  ok('a list with a chunk missing reads as not there yet, the rest as usual', !('filterKeywords' in half.settings) && JSON.stringify(half.waiting) === '["filterKeywords"]' && half.settings.width === start.width && half.settings.filterUsers.length === 1, half);
  const vA = SY.toSync(RF.normalize({...start, filterKeywords: longKw}), ['filterKeywords']).items, vB = SY.toSync(RF.normalize({...start, filterKeywords: longKw.slice(0, 120).reverse()}), ['filterKeywords']).items;
  const mixed = SY.fromSync({...vB, ...vA, 'redditFlex.filterKeywords': vB['redditFlex.filterKeywords']}).settings.filterKeywords;
  ok('two versions of a list never mix', JSON.stringify(mixed) === JSON.stringify(longKw.slice(0, 120).reverse()), mixed?.length);
  ok('only the settings asked for become items', JSON.stringify(Object.keys(SY.toSync(start, ['width', 'hideLeft']).items)) === '["redditFlex.width","redditFlex.hideLeft"]');
  ok('writes are spaced to stay under Chrome\'s 1,800 an hour', SY.GAP * 1800 > 3600 * 1000, SY.GAP);

  // 2. Pages: saves go to the worker; without one they write local storage themselves
  {
    const had = chrome.runtime, sent = [];
    chrome.runtime = {id: 'self', sendMessage: async m => { sent.push(m); return {ok: true}; }};
    await RF.save({...start, width: 1010});
    ok('a page sends its save to the worker', sent.length === 1 && sent[0].type === 'rf-save' && sent[0].settings.width === 1010 && (await RF.read()).width !== 1010, sent);
    chrome.runtime = {id: 'self', sendMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); }};
    await RF.save({...start, width: 1011});
    ok('...and writes it itself when no worker answers', (await RF.read()).width === 1011);
    chrome.runtime = {id: 'self', sendMessage: async () => { throw new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'); }};
    await RF.save({...(await RF.read()), width: 1013});
    ok('...or when the worker stopped before saying it was done', (await RF.read()).width === 1013);
    // Its own write applies only what it changed: another page's change it hadn't heard of stays.
    const mine = await RF.read();
    window.__silentSet({redditFlex: RF.normalize({...mine, commentSort: 'new'})}); // (another page; no event yet)
    await RF.save({...mine, width: 1014});
    ok('...applying only its own changes', (await RF.read()).width === 1014 && (await RF.read()).commentSort === 'new', (await RF.read()).commentSort);
    chrome.runtime = {id: 'self', sendMessage: async () => { throw new Error('Extension context invalidated.'); }};
    let threw = false;
    try { await RF.save({...start, width: 1012}); } catch { threw = true; }
    ok('...and never rejects (extension reloaded under the page)', !threw);
    chrome.runtime = {id: 'self', sendMessage: async () => ({ok: false, error: 'Too much to sync: 143 KB; the limit is 98 KB. Shorten the filter lists.'})};
    let msg = null;
    try { await RF.setSync(true); } catch (x) { msg = x.message; }
    ok('turning sync on passes on the worker\'s refusal', /^Too much to sync/.test(msg), msg);
    if (had) chrome.runtime = had; else delete chrome.runtime;
    await RF.save(start);
  }

  // 2b. Pages of their own (each its own copy of settings.js), with no worker answering
  {
    const page = c => { const g = {}; new Function('globalThis', 'chrome', window.__settingsSrc)(g, c); return g.RedditFlex; };
    const noWorker = c => ({storage: c.storage, runtime: {id: 'self', sendMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); }}});
    const fails = [];
    for (let round = 0; round < 8; round++) {
      const c = fakeChrome({local: jitter(0, 15)});
      c.stores.local.redditFlex = RF.normalize({...start, width: 700, hideLeft: false, commentSort: 'confidence'});
      const pages = [0, 1, 2].map(() => page(noWorker(c)));
      const seen = await Promise.all(pages.map(p => p.read()));
      await Promise.all([pages[0].save({...seen[0], width: 1000}), pages[1].save({...seen[1], hideLeft: true}), pages[2].save({...seen[2], commentSort: 'new'})]);
      const out = RF.normalize(c.stores.local.redditFlex);
      if (out.width !== 1000 || out.hideLeft !== true || out.commentSort !== 'new') fails.push({round, width: out.width, hideLeft: out.hideLeft, commentSort: out.commentSort});
    }
    ok('pages saving at once with no worker answering each keep their change', !fails.length, fails);
    // One page switching a setting on and straight back off, no worker: the last click wins.
    const flips = [];
    for (let round = 0; round < 20; round++) {
      const c = fakeChrome({local: jitter(0, 15)});
      c.stores.local.redditFlex = RF.normalize({...start, hideLeft: false});
      const p = page(noWorker(c));
      const s0 = await p.read();
      const on = p.save({...s0, hideLeft: true});
      await sleep(round * 5);
      await Promise.all([on, p.save({...s0, hideLeft: false})]);
      if (RF.normalize(c.stores.local.redditFlex).hideLeft !== false) flips.push(round * 5);
    }
    ok('one page switching a setting on and straight back off (no worker) ends off', !flips.length, flips);
    const c = fakeChrome({local: jitter(0, 5)});
    c.stores.local.redditFlex = RF.normalize({...start, commentSort: 'new'});
    await page(noWorker(c)).save({...RF.defaults, width: 1234}); // (before its first read: it started from the defaults)
    ok('a page saving before its first read applies only what it changed from the defaults', RF.normalize(c.stores.local.redditFlex).width === 1234 && RF.normalize(c.stores.local.redditFlex).commentSort === 'new', c.stores.local.redditFlex);
  }

  // 3. Off by default
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700})}});
    await A.save({width: 710}); await A.settle();
    ok('off: saves stay on this computer', A.local().width === 710 && !Object.keys(A.c.stores.sync).length && !A.on());
    const r = await A.send({type: 'rf-sync', on: true}, TAB(1));
    ok('only the extension\'s own pages can switch sync', r.ok === false && !A.on());
    const r3 = await A.send({type: 'rf-sync', on: false}, {id: 'self', url: 'chrome-extension://self/popup.html', tab: {id: 9}});
    ok('...including the popup open in a tab', r3.ok === true && r3.result === 'local', r3);
    const r2 = await A.send({type: 'rf-save', settings: {width: 1}}, {id: 'other', tab: {id: 1}});
    ok('messages from other extensions are ignored', r2.ok === false && A.local().width === 710);
  }

  // 4. Turning on uploads; writes are spaced and collapse; only settings sync
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 720, filterKeywords: longKw}), redditFlexRead: {t3_a: 1}, redditFlexFloat: {x: 1}}});
    let r = await A.setSync(true);
    ok('with nothing synced yet, turning on uploads this computer\'s settings', r.ok && r.result === 'uploaded' && A.synced()?.width === 720 && A.synced().filterKeywords.length === 200 && A.on(), r);
    ok('only settings go to sync', Object.keys(A.c.stores.sync).every(k => Object.hasOwn(RF.defaults, k.slice(11)) || /^redditFlex\.filter(Keywords|Subs|Users)\.[a-z0-9]+\.\d+$/.test(k)), Object.keys(A.c.stores.sync));
    r = await A.setSync(true);
    ok('turning on twice changes nothing', r.ok && r.result === 'on');
    await A.settle(); A.c.log.length = 0;
    for (let i = 0; i < 10; i++) A.save({width: 1100 + i * 10}, TAB(i));
    await A.settle();
    const sets = A.c.log.filter(l => l.op === 'set');
    ok('changes made together collapse into few writes, ending with the latest', sets.length <= 2 && A.synced().width === 1190 && A.local().width === 1190, {sets: sets.length, w: A.synced().width});
    A.c.log.length = 0;
    for (let i = 0; i < 4; i++) { A.save({width: 1200 + i}); await sleep(GAP / 2); }
    await A.settle();
    const at = A.c.log.map(l => l.at);
    ok('writes are spaced by the gap', at.every((t, i) => !i || t - at[i - 1] >= GAP - 30) && A.synced().width === 1203, at.map((t, i) => (i ? t - at[i - 1] : 0)));
    await A.save({filterKeywords: ['one']}); await A.settle();
    ok('shrinking a list removes its old chunks', chunks(A.c.stores.sync, 'filterKeywords').length === 1 && JSON.stringify(A.synced().filterKeywords) === '["one"]', chunks(A.c.stores.sync, 'filterKeywords'));
    A.c.log.length = 0;
    await A.save({hideLeft: !start.hideLeft}); await A.settle();
    ok('a change writes only that setting', JSON.stringify(A.c.log.map(l => [l.op, l.keys])) === '[["set",["redditFlex.hideLeft"]]]', A.c.log);
  }

  // 5. Blocker 1 (round 4): a save made while turning on is never overwritten by the older settings
  {
    const fails = [];
    for (const offset of [0, 1, 2, 3, 5, 8, 13, 20, 35, 60]) {
      const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700})}});
      const on = A.setSync(true);
      await sleep(offset);
      const saved = A.save({width: 1234});
      await on; await saved; await A.settle();
      if (A.local().width !== 1234 || A.synced()?.width !== 1234) fails.push({offset, local: A.local().width, sync: A.synced()?.width});
    }
    ok('a save made while turning on (at any moment) ends up here and in sync', !fails.length, fails);
  }

  // 6. Blocker 2: adopting another computer's settings keeps a save made meanwhile
  {
    const fails = [];
    for (const offset of [0, 1, 3, 8, 20, 50]) {
      const remote = SY.toSync(RF.normalize({...start, width: 900, hideLeft: false})).items;
      const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, hideLeft: false})}, sync: remote});
      const on = A.setSync(true);
      await sleep(offset);
      const saved = A.save({hideLeft: true}); // (made from the page's settings before adoption)
      const r = await on; await saved; await A.settle();
      if (r.result !== 'adopted' || A.local().hideLeft !== true || A.synced().hideLeft !== true || A.local().width !== 900) fails.push({offset, r, local: [A.local().hideLeft, A.local().width], sync: A.synced().hideLeft});
    }
    ok('a save made while adopting synced settings is kept and synced', !fails.length, fails);
    const remote = SY.toSync(RF.normalize({...start, width: 900})).items;
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700})}, sync: remote});
    const r = await A.setSync(true);
    ok('turning on with settings already synced uses those', r.result === 'adopted' && A.local().width === 900 && A.on());
  }

  // 7. Blocker 3: other pages' saves during turning on and off
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, hideLeft: false})}});
    const on = A.setSync(true);
    const other = A.save({hideLeft: true}, TAB(2));
    await on; await other; await A.settle();
    ok('another page\'s save during turning on is kept and synced', A.local().hideLeft === true && A.synced().hideLeft === true, [A.local().hideLeft, A.synced().hideLeft]);
    await A.save({width: 801}, TAB(2));   // written at once
    await sleep(GAP / 4);
    const queued = A.save({width: 802}, TAB(2)); // waits for the gap
    await sleep(10);
    const off = A.setSync(false);
    const after = A.save({width: 803}, TAB(3)); // made after the switch was pressed
    const r = await off; await queued; await after; await A.settle();
    ok('turning off uploads the latest change made before it', r.result === 'local' && A.synced().width === 802, A.synced().width);
    ok('...a save made after it stays on this computer only', A.local().width === 803 && A.synced().width === 802 && !A.on(), [A.local().width, A.synced().width]);
    ok('...the error is cleared and the last synced settings kept for next time', SY.BASE_KEY in A.c.stores.local && !('redditFlexSyncError' in A.c.stores.local));
    const r2 = await A.setSync(false);
    ok('turning off twice does not copy sync over this computer', r2.result === 'local' && A.local().width === 803);
  }

  // 8. Another computer's changes
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700})}});
    await A.setSync(true); await A.settle();
    await A.c.storage.sync.set(SY.toSync(RF.normalize({...start, width: 1333, filterUsers: ['u/far']}), ['width', 'filterUsers']).items);
    ok('a change from another computer arrives here', await until(() => A.local().width === 1333 && A.local().filterUsers[0] === 'u/far'), A.local().width);
    A.c.log.length = 0; await A.settle();
    ok('...without being written back', !A.c.log.length, A.c.log);
    // A change here not uploaded yet, and one from afar at the same moment: both are kept.
    await sleep(GAP);
    await A.save({width: 1334});
    ok('(written)', await until(() => A.synced().width === 1334));
    const afar = RF.normalize({...A.synced(), commentSort: 'new'});
    A.save({hideRight: !start.hideRight}); // waits for the gap
    await sleep(10);
    await A.c.storage.sync.set(SY.toSync(afar, ['commentSort']).items);
    await A.settle(); await A.settle();
    ok('changes made here and on another computer at once are both kept', A.local().hideRight === !start.hideRight && A.local().commentSort === 'new' && A.synced().hideRight === !start.hideRight && A.synced().commentSort === 'new', [A.local().hideRight, A.local().commentSort, A.synced().hideRight, A.synced().commentSort]);
    // The same setting: the change made here, not uploaded yet, is the later one and wins.
    await sleep(GAP);
    await A.save({width: 1400});
    ok('(written)', await until(() => A.synced().width === 1400));
    A.save({width: 1401}); // waits for the gap
    await sleep(10);
    await A.c.storage.sync.set(SY.toSync(RF.normalize({...start, width: 1500}), ['width']).items);
    await A.settle(); await A.settle();
    ok('a setting changed here and not uploaded yet wins over a change from afar to the same setting', A.local().width === 1401 && A.synced().width === 1401, [A.local().width, A.synced().width]);
  }

  // 8a. Chrome tells of the change from afar late: an upload in between still keeps it
  {
    const A = computer({...slow, event: name => (name === 'sync' ? GAP * 3 : 0)}, {local: {redditFlex: RF.normalize({...start, width: 700, commentSort: 'confidence'})}});
    await A.setSync(true); await sleep(GAP * 2);
    await A.c.storage.sync.set(SY.toSync(RF.normalize({...start, commentSort: 'new'}), ['commentSort']).items);
    await A.save({hideRight: !start.hideRight});
    await sleep(GAP * 8); await A.settle();
    ok('an upload keeps a change from afar it hasn\'t been told of yet', A.synced().commentSort === 'new' && A.synced().hideRight === !start.hideRight && A.local().commentSort === 'new', [A.synced().commentSort, A.synced().hideRight, A.local().commentSort]);
  }

  // 7b. Switching right after a write still keeps the gap
  for (const on of [true, false]) {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700})}});
    await A.setSync(true); // written now
    if (on) { await A.setSync(false); for (const k of Object.keys(A.c.stores.sync)) delete A.c.stores.sync[k]; } // (so turning on uploads again)
    const before = A.c.log.filter(l => l.op === 'set').at(-1).at;
    A.c.log.length = 0;
    await A.save({width: 702});
    await A.setSync(on);
    const next = A.c.log.find(l => l.op === 'set')?.at;
    ok(`turning ${on ? 'on' : 'off'} right after a write waits for the gap`, next - before >= GAP - 30 && A.synced()?.width === 702, {gap: next - before, w: A.synced()?.width});
  }

  // 8b. Saves carry only what the page changed
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, commentSort: 'confidence'})}});
    const view = A.local(); // a page's settings, before anything below
    await A.setSync(true); await A.settle();
    await A.c.storage.sync.set(SY.toSync(RF.normalize({...start, commentSort: 'new'}), ['commentSort']).items);
    await until(() => A.local().commentSort === 'new');
    await A.save({hideRight: !start.hideRight}, TAB(1), view); // that page hadn't heard of 'new' yet
    await A.settle();
    ok('a page that hadn\'t heard of a change from afar doesn\'t undo it', A.local().commentSort === 'new' && A.local().hideRight === !start.hideRight && A.synced().commentSort === 'new' && A.synced().hideRight === !start.hideRight, [A.local().commentSort, A.synced().commentSort]);
    const v0 = A.local();
    const v1 = RF.normalize({...v0, hideLeft: !v0.hideLeft});
    A.send({type: 'rf-save', settings: v1, base: v0}, TAB(1));
    await A.send({type: 'rf-save', settings: v0, base: v1}, TAB(1)); // and straight back
    await A.settle();
    ok('a setting changed and changed straight back ends where it started', A.local().hideLeft === v0.hideLeft && A.synced().hideLeft === v0.hideLeft);
    await A.send({type: 'rf-save', settings: RF.normalize({...RF.defaults, width: 777})}, TAB(1)); await A.settle();
    ok('a save without a base applies only what differs from the defaults (every page starts from them)', A.local().width === 777 && A.local().commentSort === 'new', [A.local().width, A.local().commentSort]);
  }
  {
    const had = chrome.runtime, sent = [];
    chrome.runtime = {id: 'self', sendMessage: async m => { sent.push(m); return {ok: true}; }};
    const s0 = await RF.read();
    await RF.save({...s0, hideLeft: !s0.hideLeft});
    await RF.save(s0);
    ok('a page sends each save with what it was made from', sent.length === 2 && sent[0].base?.hideLeft === s0.hideLeft && sent[1].base?.hideLeft === !s0.hideLeft, sent.map(m => m.base?.hideLeft));
    if (had) chrome.runtime = had; else delete chrome.runtime;
  }

  // 8c. Another computer uploads while this one waits out the gap before its last write on turning off
  {
    const A = computer({...slow, event: name => (name === 'sync' ? GAP * 4 : 0)}, {local: {redditFlex: RF.normalize({...start, width: 700, commentSort: 'confidence'})}});
    await A.setSync(true); await sleep(GAP * 2);
    await A.save({width: 701}); // written now; the next write waits
    await until(() => A.synced()?.width === 701);
    await A.save({width: 702});
    const off = A.setSync(false); // its upload waits for the gap
    await sleep(GAP / 3);
    await A.c.storage.sync.set(SY.toSync(RF.normalize({...start, commentSort: 'new'}), ['commentSort']).items); // inside the wait
    await off; await sleep(GAP * 5);
    ok('turning off keeps a change from afar made while it waited to write', A.synced().width === 702 && A.synced().commentSort === 'new' && A.local().commentSort === 'new', [A.synced().width, A.synced().commentSort, A.local().commentSort]);
  }

  // 8d. Turning on again keeps what changed here while sync was off
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, hideLeft: false, commentSort: 'confidence'})}});
    await A.setSync(true); await A.settle();
    let r = await A.setSync(false);
    r = await A.setSync(true);
    ok('off and on again with nothing changed: the synced settings, as they are', r.result === 'adopted' && A.local().width === 700, r);
    await A.setSync(false);
    await A.save({hideLeft: true}); // here, while off
    await A.c.storage.sync.set(SY.toSync(RF.normalize({...start, commentSort: 'new'}), ['commentSort']).items); // another computer, meanwhile
    r = await A.setSync(true); await A.settle();
    ok('turning on again keeps changes made here while off, and those made elsewhere', r.result === 'merged' && A.local().hideLeft === true && A.local().commentSort === 'new' && A.synced().hideLeft === true && A.synced().commentSort === 'new', [r.result, A.local().hideLeft, A.local().commentSort, A.synced().hideLeft]);
    await A.setSync(false);
    const queued = A.save({width: 777}); // made just before turning on
    r = await A.setSync(true); await queued; await A.settle();
    ok('...including a save made just before turning on', A.local().width === 777 && A.synced().width === 777, [A.local().width, A.synced().width]);
  }

  // 8e. A change made here while off, nothing changed elsewhere: it goes up when sync turns on again
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, hideLeft: false})}});
    await A.setSync(true); await A.settle(); await A.setSync(false);
    await A.save({hideLeft: true}); await sleep(GAP * 2); // (its upload timer runs out while off)
    const r = await A.setSync(true); await A.settle();
    ok('a change made here while off alone is uploaded on turning on', r.result === 'merged' && A.synced().hideLeft === true, [r.result, A.synced().hideLeft]);
  }

  // 8f. Turning on again within the gap: another computer's upload during the wait is used, not overwritten
  {
    const A = computer({...slow, event: name => (name === 'sync' ? 4000 : 0)}, {local: {redditFlex: RF.normalize({...start, width: 700, commentSort: 'confidence'})}}, 1000);
    await A.setSync(true); // written now
    await A.setSync(false);
    await A.c.storage.sync.remove(Object.keys(A.c.stores.sync)); // (sync emptied, as from another computer's reset)
    const on = A.setSync(true); // waits for the gap before looking at sync
    await sleep(300);
    Object.assign(A.c.stores.sync, SY.toSync(RF.normalize({...start, width: 950, commentSort: 'new'})).items); // another computer, inside the wait (its event comes late)
    const r = await on; await A.settle();
    ok('turning on within the gap uses an upload from afar made during the wait', r.result !== 'uploaded' && A.synced().commentSort === 'new' && A.local().commentSort === 'new', [r.result, A.synced().commentSort, A.local().commentSort]);
  }

  // 9. Too big while syncing: recorded, kept here, nothing half-written; the next good save clears it
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, filterKeywords: ['one']})}});
    await A.setSync(true); await A.settle();
    await A.save({filterKeywords: huge}); await A.settle();
    const rec = A.c.stores.local.redditFlexSyncError;
    ok('a save too big for sync is recorded as an error', /^Too much to sync/.test(rec?.message) && JSON.stringify(A.synced().filterKeywords) === '["one"]', rec);
    ok('...and the change is kept on this computer', A.local().filterKeywords.length === 500);
    await A.save({filterKeywords: ['two'], width: 1340}); await A.settle();
    ok('the next good save clears it and syncs again', !A.c.stores.local.redditFlexSyncError && A.synced().width === 1340 && JSON.stringify(A.synced().filterKeywords) === '["two"]');
    await A.save({filterKeywords: huge}); await A.settle();
    await A.save({filterKeywords: ['two']}); await A.settle(); // undone: the same as what is synced
    ok('undoing a change too big to sync clears the error', !A.c.stores.local.redditFlexSyncError, A.c.stores.local.redditFlexSyncError);
    const B = computer(slow, {local: {redditFlex: RF.normalize({...start, filterKeywords: huge})}});
    const r = await B.setSync(true);
    ok('turning on with too much refuses and changes nothing', !r.ok && /^Too much to sync/.test(r.error) && !B.on() && !Object.keys(B.c.stores.sync).length, r);
    // Sync already holds settings, and a list made here while off is too long: refused all the same.
    const C = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, filterKeywords: ['one']})}});
    await C.setSync(true); await C.settle(); await C.setSync(false);
    await C.save({filterKeywords: huge}); await C.settle();
    const syncBefore = JSON.stringify(C.c.stores.sync), baseBefore = JSON.stringify(C.c.stores.local[SY.BASE_KEY]);
    const r2 = await C.setSync(true); await C.settle();
    ok('turning on again with too much made here while off refuses and changes nothing', !r2.ok && /^Too much to sync/.test(r2.error) && !C.on() && C.local().filterKeywords.length === 500 && JSON.stringify(C.c.stores.sync) === syncBefore && JSON.stringify(C.c.stores.local[SY.BASE_KEY]) === baseBefore && !C.c.stores.local.redditFlexSyncError, [r2, C.on(), C.c.stores.local.redditFlexSyncError]);
  }

  // 9a. A page writing local storage itself (its worker didn't answer) during an upload: its change
  // is neither undone nor left out of sync
  {
    // ...while the upload on turning off waits out the gap
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, hideLeft: false})}});
    await A.setSync(true); // written now: the next write waits
    await A.save({width: 702});
    const off = A.setSync(false);
    await sleep(GAP / 3);
    await A.c.storage.local.set({redditFlex: RF.normalize({...A.local(), hideLeft: true})}); // (no worker answered that page)
    const r = await off; await A.settle();
    ok('turning off uploads a page\'s own write made while it waited for the gap', r.result === 'local' && A.synced().width === 702 && A.synced().hideLeft === true && A.local().hideLeft === true, [A.synced().width, A.synced().hideLeft, A.local().hideLeft]);
    // ...while an upload that brings in a change from afar writes to sync
    const B = computer({...slow, event: name => (name === 'sync' ? GAP * 4 : 0)}, {local: {redditFlex: RF.normalize({...start, width: 700, commentSort: 'confidence', hideLeft: false})}});
    await B.setSync(true); await sleep(GAP * 2);
    await B.c.storage.sync.set(SY.toSync(RF.normalize({...start, commentSort: 'new'}), ['commentSort']).items); // from afar, told late
    const set = B.c.storage.sync.set;
    let direct = true;
    B.c.storage.sync.set = async items => {
      if (direct) { direct = false; await B.c.storage.local.set({redditFlex: RF.normalize({...B.local(), hideLeft: true})}); }
      return set(items);
    };
    await B.save({width: 701});
    await sleep(GAP * 6); await B.settle();
    ok('an upload bringing in a change from afar keeps a page\'s own write made during it', !direct && B.local().hideLeft === true && B.local().commentSort === 'new' && B.local().width === 701 && B.synced().hideLeft === true && B.synced().commentSort === 'new' && B.synced().width === 701, [B.local().hideLeft, B.local().commentSort, B.synced().hideLeft, B.synced().commentSort]);
  }

  // 10. The worker was stopped: a change not uploaded yet goes out when it starts again
  {
    const base = RF.normalize({...start, width: 700});
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 760}), redditFlexArea: 'sync', [SY.BASE_KEY]: base}, sync: SY.toSync(base).items});
    await A.settle();
    ok('a change left over from a stopped worker is uploaded', A.synced().width === 760, A.synced().width);
    const B = computer(slow, {local: {redditFlex: base, redditFlexArea: 'sync', [SY.BASE_KEY]: base}, sync: SY.toSync(RF.normalize({...base, width: 990})).items});
    await B.settle();
    ok('a change from afar missed while stopped is brought in', B.local().width === 990, B.local().width);
    // A setting this computer never synced (sync didn't have it when it turned on), not uploaded yet
    // when the worker stopped; meanwhile another computer wrote it: this computer's, the later, wins.
    const noLeft = Object.fromEntries(Object.entries(base).filter(([k]) => k !== 'hideLeft'));
    const C = computer(slow, {local: {redditFlex: RF.normalize({...base, hideLeft: true}), redditFlexArea: 'sync', [SY.BASE_KEY]: noLeft}, sync: SY.toSync(RF.normalize({...base, hideLeft: false})).items});
    await C.settle();
    ok('a setting never synced here, not uploaded yet, wins over the same setting from afar', C.local().hideLeft === true && C.synced().hideLeft === true, [C.local().hideLeft, C.synced().hideLeft]);
    // A setting a newer version added: never synced here and left at its default here, while another
    // computer set it. That is taken; this computer's default doesn't go up over it.
    const noTrend = Object.fromEntries(Object.entries(base).filter(([k]) => k !== 'hideTrending'));
    const D = computer(slow, {local: {redditFlex: RF.normalize({...base, hideTrending: false}), redditFlexArea: 'sync', [SY.BASE_KEY]: noTrend}, sync: SY.toSync(RF.normalize({...base, hideTrending: true})).items});
    await D.settle();
    ok('a setting never synced here and left at its default takes the one from afar', D.local().hideTrending === true && D.synced().hideTrending === true, [D.local().hideTrending, D.synced().hideTrending]);
  }

  // 11. Stress: many pages saving at random while sync goes on and off; the last save always wins
  {
    const fails = [];
    for (let round = 0; round < 6; round++) {
      const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 600})}, ...(round % 2 ? {sync: SY.toSync(RF.normalize({...start, width: 650})).items} : {})});
      const jobs = [];
      let last = 0;
      for (let i = 0; i < 25; i++) {
        if (i % 7 === 3) jobs.push(A.setSync(i % 2 === 1));
        last = 600 + i;
        jobs.push(A.save({width: last}, TAB(i % 4)));
        await sleep(Math.random() * 25);
      }
      await Promise.all(jobs); await A.settle();
      if (A.local().width !== last) fails.push({round, local: A.local().width, last});
      if (A.on() && A.synced()?.width !== last) fails.push({round, sync: A.synced()?.width, last});
    }
    ok('saves from many pages while switching: the last one always ends up here (and in sync when on)', !fails.length, fails);
  }

  // 9b. A write that failed for another reason (say, too many writes for now) is tried again by itself
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700})}}, GAP, null, 400);
    await A.setSync(true); await A.settle();
    const set = A.c.storage.sync.set;
    let failed = false;
    A.c.storage.sync.set = async items => { if (!failed) { failed = true; throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'); } return set(items); };
    await A.save({width: 701});
    ok('(it failed)', await until(() => /MAX_WRITE/.test(A.c.stores.local.redditFlexSyncError?.message)), A.c.stores.local.redditFlexSyncError);
    ok('a write that failed for another reason is tried again by itself', await until(() => A.synced().width === 701 && !A.c.stores.local.redditFlexSyncError, 3000), [A.synced().width, A.c.stores.local.redditFlexSyncError]);
    A.c.storage.sync.set = set;
  }

  // 13. Chrome counts old chunks still stored against the quota: they go first when they'd push a write over
  {
    const subs = n => Array.from({length: n}, (_, i) => `r/sub${i}`.padEnd(300, 's'));
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, filterKeywords: lines(266), filterSubs: subs(50)})}});
    const r = await A.setSync(true); await A.settle();
    ok('(nearly full)', r.ok && A.synced()?.filterKeywords.length === 266, r);
    let refused = false;
    try { await A.c.storage.sync.set({'x.filler': 'z'.repeat(8000)}); } catch { refused = true; }
    ok('(the fake refuses a write over the quota)', refused);
    await A.save({filterKeywords: lines(150), filterSubs: subs(88)}); await A.settle();
    ok('shrinking one list and growing another fits, though with the old chunks still stored it would not', A.synced().filterKeywords.length === 150 && A.synced().filterSubs.length === 88 && !A.c.stores.local.redditFlexSyncError, [A.synced().filterKeywords.length, A.synced().filterSubs.length, A.c.stores.local.redditFlexSyncError]);
    const heads = Object.fromEntries(['filterKeywords', 'filterSubs', 'filterUsers'].map(l => [l, A.c.stores.sync[`redditFlex.${l}`].id]));
    ok('...and only the new chunks are left', Object.keys(A.c.stores.sync).filter(k => /\.\d+$/.test(k)).every(k => k.split('.')[2] === heads[k.split('.')[1]]), Object.keys(A.c.stores.sync));
    // The write fails after the old chunks went (here: too many writes): they are put back.
    const set = A.c.storage.sync.set;
    let failed = false;
    A.c.storage.sync.set = async items => { if (!failed && 'redditFlex.filterKeywords' in items) { failed = true; throw new Error('MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded'); } return set(items); };
    await A.save({filterKeywords: lines(266), filterSubs: subs(50)}); await A.settle();
    ok('a write failing after the old chunks went puts them back', failed && A.synced().filterKeywords.length === 150 && !SY.fromSync(A.c.stores.sync).waiting.length && /MAX_WRITE/.test(A.c.stores.local.redditFlexSyncError?.message), [A.synced().filterKeywords.length, SY.fromSync(A.c.stores.sync).waiting, A.c.stores.local.redditFlexSyncError]);
    A.c.storage.sync.set = async items => { if (failed !== 'quota') { failed = 'quota'; throw new Error('QUOTA_BYTES quota exceeded'); } return set(items); };
    await A.save({hideLeft: !start.hideLeft}); await A.settle();
    const quotaMsg = A.c.stores.local.redditFlexSyncError?.message;
    A.c.storage.sync.set = set;
    ok('Chrome refusing a write over the quota is reported in the same words', /^Too much to sync: \d+ KB; the limit is \d+ KB\. Shorten the filter lists\.$/.test(quotaMsg), quotaMsg);
    await A.save({hideLeft: start.hideLeft}); await A.settle();
    ok('...and the next write sends what was held back', A.synced().filterKeywords.length === 266 && A.synced().filterSubs.length === 50 && !A.c.stores.local.redditFlexSyncError, [A.synced().filterKeywords.length, A.c.stores.local.redditFlexSyncError]);
  }
  {
    // Sync also holds what this computer's settings don't account for (here: a list version that lost
    // to another computer's): a write that can't fit even without the old chunks touches nothing.
    const subs = n => Array.from({length: n}, (_, i) => `r/sub${i}`.padEnd(300, 's'));
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, filterKeywords: lines(139), filterSubs: subs(50)})}});
    await A.setSync(true); await A.settle();
    Object.assign(A.c.stores.sync, Object.fromEntries(Array.from({length: 5}, (_, i) => [`redditFlex.filterUsers.lost.${i}`, ['o'.repeat(7900)]])));
    A.c.log.length = 0;
    await A.save({filterKeywords: lines(200)}); await A.settle();
    const now = SY.fromSync(A.c.stores.sync);
    ok('a write that can\'t fit even without the old chunks leaves sync as it was, saying why', !A.c.log.length && now.settings.filterKeywords?.length === 139 && !now.waiting.length && /^Too much to sync: \d+ KB; the limit is \d+ KB\. Shorten the filter lists\.$/.test(A.c.stores.local.redditFlexSyncError?.message) && A.local().filterKeywords.length === 200, [A.c.log, now.waiting, A.c.stores.local.redditFlexSyncError]);
  }

  {
    // Chrome allows 512 items: a write that would take sync over touches nothing, saying why.
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, filterKeywords: ['one']})}});
    await A.setSync(true); await A.settle();
    Object.assign(A.c.stores.sync, Object.fromEntries(Array.from({length: 511 - Object.keys(A.c.stores.sync).length}, (_, i) => [`other.${i}`, 1])));
    A.c.log.length = 0;
    await A.save({filterKeywords: longKw}); await A.settle();
    ok('a write that would take sync over Chrome\'s 512 items touches nothing, saying why', !A.c.log.length && /^Too much to sync: \d+ items; the limit is 512\. Shorten the filter lists\.$/.test(A.c.stores.local.redditFlexSyncError?.message) && JSON.stringify(A.synced().filterKeywords) === '["one"]', [A.c.log, A.c.stores.local.redditFlexSyncError]);
  }

  // 14. A list from afar that arrives in pieces is taken only once all of it is here
  {
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, filterKeywords: ['mine']})}});
    await A.setSync(true); await A.settle();
    const v = SY.toSync(RF.normalize({...start, filterKeywords: longKw}), ['filterKeywords']).items;
    const [first, ...rest] = chunks(v, 'filterKeywords');
    await A.c.storage.sync.set({'redditFlex.filterKeywords': v['redditFlex.filterKeywords'], [first]: v[first]});
    await A.settle();
    ok('a list from afar arriving in pieces is not taken half', JSON.stringify(A.local().filterKeywords) === '["mine"]', A.local().filterKeywords.length);
    await A.c.storage.sync.set(Object.fromEntries(rest.map(k => [k, v[k]])));
    ok('...and is taken whole once all of it is here', await until(() => JSON.stringify(A.local().filterKeywords) === JSON.stringify(longKw)), A.local().filterKeywords.length);
    // Turning on meanwhile: the rest is used; this computer's list stays (and isn't uploaded over it) until it's all here.
    const w = SY.toSync(RF.normalize({...start, width: 950, filterKeywords: longKw})).items;
    const missing = chunks(w, 'filterKeywords')[0], partial = {...w};
    delete partial[missing];
    const B = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700, filterKeywords: ['mine']})}, sync: partial});
    const r = await B.setSync(true); await B.settle();
    ok('turning on while a list is still arriving uses the rest and keeps this computer\'s list for now, without uploading it', r.result === 'adopted' && B.local().width === 950 && JSON.stringify(B.local().filterKeywords) === '["mine"]' && B.c.stores.sync['redditFlex.filterKeywords'].id === w['redditFlex.filterKeywords'].id, [r.result, B.local().width, B.local().filterKeywords.length]);
    await B.c.storage.sync.set({[missing]: w[missing]});
    ok('...then takes the list once it is all here', await until(() => B.local().filterKeywords.length === 200), B.local().filterKeywords.length);
  }

  // 15. Computers linked through Chrome sync, whose writes reach each other late
  {
    const same = (...cs) => cs.every(c => JSON.stringify(c.local()) === JSON.stringify(cs[0].local()) && JSON.stringify(c.synced()) === JSON.stringify(cs[0].local()));
    const link = cloud(jitter(300, 700));
    const A = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 700})}}, GAP, link);
    const B = computer(slow, {local: {redditFlex: RF.normalize({...start, width: 800})}}, GAP, link);
    await A.setSync(true); await sleep(900);
    const r = await B.setSync(true); await A.settle(); await B.settle();
    ok('a second computer turning on uses the first one\'s settings', r.result === 'adopted' && B.local().width === 700 && same(A, B), [r, B.local().width]);
    A.save({width: 1000}); await sleep(50); B.save({hideLeft: true});
    ok('two computers changing different settings at once: both changes end up on both', await until(() => A.local().width === 1000 && A.local().hideLeft === true && same(A, B), 8000), [A.local().width, A.local().hideLeft, B.local().width, B.local().hideLeft]);
    A.save({commentSort: 'new'}); await sleep(30); B.save({commentSort: 'top'});
    ok('...the same setting changed on both at once: one of the two, the same on both', await until(() => same(A, B) && ['new', 'top'].includes(A.local().commentSort), 8000), [A.local().commentSort, B.local().commentSort]);
    A.save({filterKeywords: longKw}); await sleep(30); B.save({filterSubs: ['r/one', 'r/two']});
    ok('...different lists changed at once: both kept, whole', await until(() => A.local().filterKeywords.length === 200 && A.local().filterSubs.length === 2 && same(A, B), 8000), [A.local().filterKeywords.length, B.local().filterKeywords.length, A.local().filterSubs.length]);
    A.save({filterUsers: ['u/a1', 'u/a2']}); await sleep(30); B.save({filterUsers: longKw.slice(0, 150)});
    ok('...the same list changed on both at once: one version, whole, the same on both', await until(() => same(A, B) && [2, 150].includes(A.local().filterUsers.length), 8000), [A.local().filterUsers.length, B.local().filterUsers.length]);
  }
  {
    // Three computers, each changing its own settings at random moments: every last change reaches all.
    const link = cloud(jitter(100, 900));
    const cs = [600, 700, 800].map(w => computer(slow, {local: {redditFlex: RF.normalize({...start, width: w})}}, GAP, link));
    await cs[0].setSync(true); await sleep(1000);
    for (const c of cs.slice(1)) await c.setSync(true);
    await sleep(1000);
    const own = [['width', i => 1000 + i], ['hideLeft', i => i % 2 === 0], ['filterKeywords', i => longKw.slice(0, 10 + i * 15)]];
    const last = {};
    for (let i = 0; i < 15; i++) {
      const [key, value] = own[i % 3];
      cs[i % 3].save({[key]: value(i)}); last[key] = value(i);
      await sleep(Math.random() * 400);
    }
    const done = () => cs.every(c => own.every(([k]) => JSON.stringify(c.local()[k]) === JSON.stringify(last[k])));
    ok('three computers changing their own settings at random moments all end with every last change', await until(() => done() && cs.every(c => JSON.stringify(c.synced()) === JSON.stringify(cs[0].local())), 15000), cs.map(c => [c.local().width, c.local().hideLeft, c.local().filterKeywords.length]));
  }

  // 16. The worker sends downloads to their own handler, everything else to sync
  {
    const BG = window.RedditFlexBackground, had = chrome.runtime, calls = [];
    chrome.runtime = {id: 'self'};
    const stub = {onMessage: m => { calls.push(m.type); return true; }};
    const dl = BG.route({type: 'rf-download', url: 'https://evil.com/x.mp4'}, {id: 'self', tab: {url: 'https://www.reddit.com/'}}, () => {}, stub, {download: async () => 1});
    const sv = BG.route({type: 'rf-save', settings: {}}, {id: 'self'}, () => {}, stub);
    ok('the worker sends downloads to their handler and settings messages to sync', dl === false && sv === true && JSON.stringify(calls) === '["rf-save"]', calls);
    ok('...and leaves settings messages unanswered when sync didn\'t start (pages then save on their own)', BG.route({type: 'rf-save', settings: {}}, {id: 'self'}, () => {}, null) === false);
    const got = [];
    const later = BG.route({type: 'rf-download', url: 'https://v.redd.it/a/DASH_720.mp4', filename: 'clip'}, {id: 'self', tab: {url: 'https://www.reddit.com/'}}, () => {}, null, {download: async o => { got.push(o.url); return 1; }});
    ok('...while downloads still work then', later === true && JSON.stringify(got) === '["https://v.redd.it/a/DASH_720.mp4"]', got);
    if (had) chrome.runtime = had; else delete chrome.runtime;
  }

  // 12. The page follows changes the worker brings in (on this mock page's own storage)
  {
    const engine = window.__rfSyncEngine ||= SY.start(chrome, {gap: GAP});
    const cssWidth = () => parseFloat(document.documentElement.style.getPropertyValue('--rf-width'));
    await chrome.storage.local.set({redditFlexArea: 'sync', [SY.BASE_KEY]: start}); await engine.idle();
    await chrome.storage.sync.set(SY.toSync(RF.normalize({...start, width: 1444})).items);
    ok('the page follows a change from another computer', await until(() => cssWidth() === 1444), cssWidth());
    await engine.setSync(false);
    await chrome.storage.sync.remove(Object.keys(await chrome.storage.sync.get(null)));
    await RF.save(start); await sleep(100);
  }

  ok('no script errors', window.__errors.length === errorsBefore, window.__errors.slice(errorsBefore));
  const fail = results.filter(r => !r.pass);
  return {pass: results.length - fail.length, fail: fail.length, failures: fail};
};
