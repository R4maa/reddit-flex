/* Settings sync, run only by the background worker (one per Chrome profile).
   Every page reads and writes chrome.storage.local, always. When sync is on, this worker mirrors
   the local settings to chrome.storage.sync and brings other computers' changes back into local.
   Pages send their saves here (see RedditFlex.save), so saves and turning sync on or off run one
   at a time, in the order they were made: nothing a page saves during a switch can be lost. */
(() => {
  'use strict';
  const RF = globalThis.RedditFlex;
  const {KEY, AREA_KEY, SYNC_ERROR_KEY} = RF;
  // The settings as last written to or read from sync, one by one: what "changed here since" is
  // measured against. A setting missing from it has never synced from or to this computer.
  const BASE_KEY = 'redditFlexSyncBase';
  // Chrome allows 120 sync writes a minute and 1,800 an hour; removing stale chunks counts as one.
  const GAP = 2100;

  // ---- the settings in chrome.storage.sync ---------------------------------------------------
  // One item per setting, redditFlex.<setting>. Chrome keeps the last write of each item, so a
  // computer that writes only the settings it changed can't undo another computer's change to a
  // different setting, even one that hasn't reached it yet.
  // A filter list can be longer than one item may be (8 KB), so its item holds {id, n} and its lines
  // are in n chunks, redditFlex.<list>.<id>.<i>. Each version of a list gets a new id, so two
  // versions never mix, and a list whose chunks haven't all arrived (or are being replaced) reads as
  // not there yet.
  const SETTINGS = Object.keys(RF.defaults);
  const LISTS = ['filterKeywords', 'filterSubs', 'filterUsers'];
  // Sync allows 8 KB per item and 100 KB in all, counted as key + JSON value in bytes.
  const SYNC_ITEM = 8192 - 64, SYNC_TOTAL = 102400 - 2048; // with some room to spare
  const MAX_ITEMS = 512;
  // A write that failed for another reason (say, too many writes for now) is tried again after this.
  const RETRY = 60000;
  const bytes = str => new TextEncoder().encode(str).length;
  const itemBytes = (key, value) => bytes(key) + bytes(JSON.stringify(value));
  const sizeOf = items => Object.entries(items).reduce((sum, [k, v]) => sum + itemBytes(k, v), 0);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Settings `keys` of s as sync items: {items, bytes}. For all of them (no keys given), throws
  // when they can't fit.
  function toSync(s, keys) {
    const items = {};
    for (const key of keys || SETTINGS) {
      if (!LISTS.includes(key)) { items[`${KEY}.${key}`] = s[key]; continue; }
      const id = newId();
      let chunk = [], n = 0;
      const flush = () => { items[`${KEY}.${key}.${id}.${n++}`] = chunk; chunk = []; };
      for (const line of s[key]) {
        if (chunk.length && itemBytes(`${KEY}.${key}.${id}.${n}`, [...chunk, line]) > SYNC_ITEM) flush();
        chunk.push(line);
      }
      if (chunk.length) flush();
      items[`${KEY}.${key}`] = {id, n};
    }
    const total = sizeOf(items);
    if (!keys && total > SYNC_TOTAL) throw tooMuch(total);
    return {items, bytes: total};
  }
  const tooMuch = total => {
    const kb = v => Math.ceil(v / 1024);
    return new Error(`Too much to sync: ${kb(total)} KB; the limit is ${kb(SYNC_TOTAL)} KB. Shorten the filter lists.`);
  };
  const tooMany = count => new Error(`Too much to sync: ${count} items; the limit is ${MAX_ITEMS}. Shorten the filter lists.`);

  // What all of chrome.storage.sync holds: {settings, waiting}, or null when it has no settings.
  // settings has only the settings that are there (checked like any other); waiting names the lists
  // whose chunks aren't all there yet.
  function fromSync(all) {
    if (!SETTINGS.some(key => `${KEY}.${key}` in all)) return null;
    const out = {}, waiting = [];
    for (const key of SETTINGS) {
      const head = all[`${KEY}.${key}`];
      if (head === undefined) continue;
      if (!LISTS.includes(key)) { out[key] = head; continue; }
      const parts = typeof head?.id === 'string' && Number.isInteger(head.n) && head.n >= 0 && head.n <= 1000
        ? Array.from({length: head.n}, (_, i) => all[`${KEY}.${key}.${head.id}.${i}`]) : [null];
      if (parts.every(Array.isArray)) out[key] = parts.flat();
      else waiting.push(key);
    }
    const checked = RF.normalize(out);
    return {settings: Object.fromEntries(Object.keys(out).map(k => [k, checked[k]])), waiting};
  }

  function start(chrome, {gap = GAP, retry = RETRY} = {}) {
    const local = chrome.storage.local, sync = chrome.storage.sync;
    const json = v => JSON.stringify(v);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    // One job at a time, in order.
    let queue = Promise.resolve();
    const run = job => { const p = queue.then(job); queue = p.catch(() => {}); return p; };
    const later = job => { run(job).catch(() => {}); }; // (nobody waits for these)

    let nextWrite = 0, timer = 0, retryTimer = 0;
    const isOn = async () => (await local.get(AREA_KEY))[AREA_KEY] === 'sync';
    const readLocal = async () => RF.normalize((await local.get(KEY))[KEY]);
    const readBase = async () => (await local.get(BASE_KEY))[BASE_KEY] || null;
    const readRemote = async () => fromSync(await sync.get(null));
    // Settings in s that differ from base (or that base doesn't have).
    const changedSince = (s, base) => SETTINGS.filter(k => json(s[k]) !== json(base?.[k]));
    // Changed here and not uploaded yet: what differs from base, and of the settings base doesn't
    // have (never synced here, e.g. one a newer version added), what this computer set to something
    // other than the default. Nothing, without a base: then this computer never synced.
    const changedHere = (s, base) => (base ? SETTINGS.filter(k => json(s[k]) !== json(k in base ? base[k] : RF.defaults[k])) : []);
    const pick = (s, keys) => Object.fromEntries(keys.map(k => [k, s[k]]));

    // Writes these settings of s, and only these. Throws, leaving sync as it was, when it can't:
    // all of s is too big, or with what else sync holds (e.g. changes from afar not brought in yet).
    async function writeSync(s, keys) {
      toSync(s);
      const {items} = toSync(s, keys);
      await sleep(nextWrite - Date.now());
      const all = await sync.get(null);
      // A list's chunks from before (any other id), and the single item an earlier version used.
      const stale = Object.keys(all).filter(k => !(k in items) && (k === KEY || keys.some(key => LISTS.includes(key) && k.startsWith(`${KEY}.${key}.`))));
      // Chrome counts everything stored, stale chunks included, when it checks a write against the
      // quota. When they'd push it over, they go first (meanwhile that list reads as not there yet),
      // and come back if the write fails after all.
      const kept = {...pick(all, Object.keys(all).filter(k => !stale.includes(k))), ...items};
      const after = sizeOf(kept), count = Object.keys(kept).length;
      if (after > SYNC_TOTAL) throw tooMuch(after);
      if (count > MAX_ITEMS) throw tooMany(count);
      const first = stale.length > 0 && (sizeOf({...all, ...items}) > SYNC_TOTAL || Object.keys({...all, ...items}).length > MAX_ITEMS);
      nextWrite = Date.now() + gap * (stale.length ? 2 : 1);
      if (first) await sync.remove(stale);
      try { await sync.set(items); }
      catch (e) {
        if (first) await sync.set(pick(all, stale)).catch(() => {});
        throw /QUOTA_BYTES/.test(e?.message) ? tooMuch(after) : /MAX_ITEMS/.test(e?.message) ? tooMany(count) : e;
      }
      // (Left over if this fails: they go with that list's next write.)
      if (stale.length && !first) await sync.remove(stale).catch(() => {});
    }

    async function recordError(e) {
      await local.set({[SYNC_ERROR_KEY]: {message: e?.message || String(e), at: Date.now()}});
    }
    async function clearError() {
      if ((await local.get(SYNC_ERROR_KEY))[SYNC_ERROR_KEY]) await local.remove(SYNC_ERROR_KEY);
    }

    // Uploads the settings changed here since they last synced.
    async function upload() {
      if (!(await isOn())) return;
      const base = await readBase(); // (only jobs in this queue change it)
      const pending = s => (base ? changedHere(s, base) : SETTINGS);
      if (!pending(await readLocal()).length) { await clearError(); return; } // (e.g. a too-big change undone)
      // Read after the wait, so it is still current when written (a page may have written local
      // itself meanwhile: RedditFlex.save without the worker).
      await sleep(nextWrite - Date.now());
      const mine = await readLocal(), keys = pending(mine);
      if (!keys.length) { await clearError(); return; }
      try { await writeSync(mine, keys); }
      catch (e) {
        // It stays on this computer. Too big: until the next change. Anything else: tried again later.
        await recordError(e);
        if (!/^Too much to sync/.test(e?.message)) { clearTimeout(retryTimer); retryTimer = setTimeout(schedule, retry); }
        return;
      }
      await local.set({[BASE_KEY]: {...base, ...pick(mine, keys)}});
      await clearError();
    }
    function schedule() {
      if (!timer) timer = setTimeout(() => { timer = 0; later(upload); }, Math.max(0, nextWrite - Date.now()));
    }

    // Brings in other computers' changes (our own writes coming back match base and are skipped). A
    // setting also changed here and not uploaded yet keeps this computer's value, which goes up next.
    async function pull() {
      if (!(await isOn())) return;
      const remote = (await readRemote())?.settings;
      if (!remote) return;
      const base = await readBase();
      const fromAfar = Object.keys(remote).filter(k => json(remote[k]) !== json(base?.[k]));
      if (!fromAfar.length) return;
      const now = await readLocal(), mineToo = changedHere(now, base);
      const take = fromAfar.filter(k => !mineToo.includes(k));
      await local.set({[BASE_KEY]: {...base, ...pick(remote, fromAfar)}, ...(take.length ? {[KEY]: RF.normalize({...now, ...pick(remote, take)})} : {})});
      if (take.length < fromAfar.length) schedule();
    }

    // s: the page's settings; base: what it made them from (without one, the defaults, which every
    // page starts from). Only what the page changed is applied, so a page that hadn't yet heard of a
    // change (from another page or computer) can't undo it.
    async function save(s, base) {
      const next = RF.normalize(s);
      const keys = changedSince(next, RF.normalize(base && typeof base === 'object' ? base : RF.defaults));
      if (!keys.length) return;
      const now = await readLocal();
      await local.set({[KEY]: RF.normalize({...now, ...pick(next, keys)})});
    }

    // On: settings already synced from another computer are used ('adopted'), except those changed
    // here since this computer last synced, which are kept and uploaded ('merged'); with nothing
    // synced yet, this computer's are uploaded ('uploaded'). Off: this computer's latest change is
    // uploaded and any change from afar already here brought in; then it keeps its settings, and
    // remembers the last synced ones for the next time it turns on.
    async function setSync(on) {
      if (on) {
        if (await isOn()) return 'on';
        await sleep(nextWrite - Date.now()); // (so what is read below is still current when written)
        const found = await readRemote(), mine = await readLocal(), base = await readBase();
        if (found) {
          const {settings: remote, waiting} = found;
          // Without a base (never synced here) there is nothing to tell this computer's changes by.
          const kept = changedHere(mine, base);
          const out = RF.normalize({...mine, ...pick(remote, Object.keys(remote).filter(k => !kept.includes(k)))});
          toSync(out); // too big (a long list made here while off): throws, and sync stays off
          // Settings sync doesn't have go up when set here (not the default). A list still arriving
          // waits for the rest of it, unless this computer changed it.
          const newBase = {...remote, ...Object.fromEntries(waiting.map(k => [k, kept.includes(k) ? base[k] : mine[k]]))};
          await local.set({[KEY]: out, [BASE_KEY]: newBase, [AREA_KEY]: 'sync'});
          await clearError();
          if (changedHere(out, newBase).length) schedule();
          return kept.some(k => json(mine[k]) !== json(remote[k])) ? 'merged' : 'adopted';
        }
        await writeSync(mine, SETTINGS); // too big: throws, and sync stays off
        await local.set({[BASE_KEY]: mine, [AREA_KEY]: 'sync'});
        await clearError();
        return 'uploaded';
      }
      if (!(await isOn())) return 'local';
      clearTimeout(timer); clearTimeout(retryTimer); timer = 0;
      await upload(); // (an error here leaves the change on this computer, where it stays)
      await pull();
      await local.set({[AREA_KEY]: 'local'});
      await clearError();
      return 'local';
    }

    // Returns true when the reply comes later (chrome.runtime.onMessage's contract).
    function onMessage(msg, sender, reply) {
      if (sender?.id !== chrome.runtime?.id) return false;
      // (The popup, or popup.html open in a tab; content scripts report the Reddit page's URL.)
      const own = String(sender.url || '').startsWith(chrome.runtime.getURL(''));
      let job;
      if (msg?.type === 'rf-save' && msg.settings && typeof msg.settings === 'object') job = () => save(msg.settings, msg.base);
      else if (msg?.type === 'rf-sync' && own) job = () => setSync(!!msg.on);
      else return false;
      run(job).then(result => reply({ok: true, result}), e => reply({ok: false, error: e?.message || String(e)}));
      return true;
    }

    chrome.storage.onChanged.addListener((changes, name) => {
      if (name === 'local' && changes[KEY]) schedule();
      if (name === 'sync' && Object.keys(changes).some(k => k === KEY || k.startsWith(`${KEY}.`))) later(pull);
    });
    // The worker may have been stopped with a change not yet uploaded, or missed a change from afar.
    later(pull); later(upload);

    return {onMessage, save: (s, base) => run(() => save(s, base)), setSync: on => run(() => setSync(on)), idle: () => run(() => {}), BASE_KEY};
  }

  globalThis.RedditFlexSync = {start, toSync, fromSync, BASE_KEY, GAP, RETRY};
})();
