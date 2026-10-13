/* Settings sync, run only by the background worker (one per Chrome profile).
   Every page reads and writes chrome.storage.local, always. When sync is on, this worker mirrors
   the local settings to chrome.storage.sync and brings other computers' changes back into local.
   Pages send their saves here (see RedditFlex.save), so saves and turning sync on or off run one
   at a time, in the order they were made: nothing a page saves during a switch can be lost. */
(() => {
  'use strict';
  const RF = globalThis.RedditFlex;
  const {KEY, AREA_KEY, SYNC_ERROR_KEY} = RF;
  // The settings as last written to or read from sync: what "changed here since" is measured against.
  const BASE_KEY = 'redditFlexSyncBase';
  // Chrome allows 120 sync writes a minute and 1,800 an hour; removing stale chunks counts as one.
  const GAP = 2100;

  function start(chrome, {gap = GAP} = {}) {
    const local = chrome.storage.local, sync = chrome.storage.sync;
    const json = v => JSON.stringify(v);
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    // One job at a time, in order.
    let queue = Promise.resolve();
    const run = job => { const p = queue.then(job); queue = p.catch(() => {}); return p; };

    let nextWrite = 0, timer = 0;
    const isOn = async () => (await local.get(AREA_KEY))[AREA_KEY] === 'sync';
    const readLocal = async () => RF.normalize((await local.get(KEY))[KEY]);
    const readBase = async () => { const b = (await local.get(BASE_KEY))[BASE_KEY]; return b ? RF.normalize(b) : null; };
    const readRemote = async () => RF.fromSync(await sync.get(null));
    // Top-level settings that differ from base.
    const changedSince = (s, base) => (base ? Object.keys(s).filter(k => json(s[k]) !== json(base[k])) : []);
    // Remote settings with this computer's own changes since base on top.
    const merge = (remote, mine, base) => RF.normalize({...remote, ...Object.fromEntries(changedSince(mine, base).map(k => [k, mine[k]]))});

    // Throws (writing nothing) when s is too big for sync.
    async function writeSync(s) {
      const {items} = RF.toSync(s);
      await sleep(nextWrite - Date.now());
      const stale = Object.keys(await sync.get(null)).filter(k => (k === KEY || k.startsWith(`${KEY}.`)) && !(k in items));
      nextWrite = Date.now() + gap * (stale.length ? 2 : 1);
      await sync.set(items);
      if (stale.length) await sync.remove(stale);
    }

    async function recordError(e) {
      await local.set({[SYNC_ERROR_KEY]: {message: e?.message || String(e), at: Date.now()}});
    }
    async function clearError() {
      if ((await local.get(SYNC_ERROR_KEY))[SYNC_ERROR_KEY]) await local.remove(SYNC_ERROR_KEY);
    }

    // Uploads this computer's settings if they changed since the last sync.
    async function upload() {
      if (!(await isOn())) return;
      const mine = await readLocal(), base = await readBase();
      if (base && json(mine) === json(base)) { await clearError(); return; } // (e.g. a too-big change undone)
      // Another computer's change not brought in yet: keep it, with ours on top. (Read after the
      // wait, so it is still current when written.)
      await sleep(nextWrite - Date.now());
      const remote = await readRemote();
      const out = remote && base && json(remote) !== json(base) ? merge(remote, mine, base) : mine;
      try { await writeSync(out); }
      catch (e) { await recordError(e); return; } // stays on this computer; the next change tries again
      await local.set({[BASE_KEY]: out, ...(json(out) !== json(mine) ? {[KEY]: out} : {})});
      await clearError();
    }
    function schedule() {
      if (!timer) timer = setTimeout(() => { timer = 0; run(upload); }, Math.max(0, nextWrite - Date.now()));
    }

    // Brings in another computer's change (our own writes coming back match base and are skipped).
    async function pull() {
      if (!(await isOn())) return;
      const remote = await readRemote(), base = await readBase();
      if (!remote || (base && json(remote) === json(base))) return;
      const mine = await readLocal();
      const out = merge(remote, mine, base);
      await local.set({[BASE_KEY]: remote, ...(json(out) !== json(mine) ? {[KEY]: out} : {})});
      if (json(out) !== json(remote)) schedule();
    }

    // s: the page's settings; base: what it made them from. Only what the page changed is applied,
    // so a page that hadn't yet heard of a change (from another page or computer) can't undo it.
    async function save(s, base) {
      const next = RF.normalize(s);
      if (!base || typeof base !== 'object') { await local.set({[KEY]: next}); return; }
      const keys = changedSince(next, RF.normalize(base));
      if (!keys.length) return;
      const now = await readLocal();
      await local.set({[KEY]: RF.normalize({...now, ...Object.fromEntries(keys.map(k => [k, next[k]]))})});
    }

    // On: settings already synced from another computer are used ('adopted'), plus whatever was
    // changed here since this computer last synced ('merged'); with nothing synced yet, this
    // computer's are uploaded ('uploaded'). Off: this computer's latest change is uploaded first,
    // then it keeps its settings, and remembers the last synced ones for the next time it turns on.
    async function setSync(on) {
      if (on) {
        if (await isOn()) return 'on';
        await sleep(nextWrite - Date.now()); // (so what is read below is still current when written)
        const remote = await readRemote(), mine = await readLocal(), base = await readBase();
        if (remote) {
          // Without a base (never synced here) there is nothing to tell this computer's changes by.
          const out = base ? merge(remote, mine, base) : remote;
          const kept = json(out) !== json(remote);
          await local.set({[KEY]: out, [BASE_KEY]: remote, [AREA_KEY]: 'sync'});
          await clearError();
          if (kept) schedule();
          return kept ? 'merged' : 'adopted';
        }
        await writeSync(mine); // too big: throws, and sync stays off
        await local.set({[BASE_KEY]: mine, [AREA_KEY]: 'sync'});
        await clearError();
        return 'uploaded';
      }
      if (!(await isOn())) return 'local';
      clearTimeout(timer); timer = 0;
      await upload(); // (an error here leaves the change on this computer, where it stays)
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
      if (name === 'sync' && Object.keys(changes).some(k => k === KEY || k.startsWith(`${KEY}.`))) run(pull);
    });
    // The worker may have been stopped with a change not yet uploaded, or missed a change from afar.
    run(pull); run(upload);

    return {onMessage, save: (s, base) => run(() => save(s, base)), setSync: on => run(() => setSync(on)), idle: () => run(() => {}), BASE_KEY};
  }

  globalThis.RedditFlexSync = {start, BASE_KEY, GAP};
})();
