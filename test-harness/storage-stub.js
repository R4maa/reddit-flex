// Working fake of chrome.storage for popup-bundle.html: values persist for the page and onChanged fires on set.
(() => {
  const stores = {local: {}, sync: {}}, data = stores.local, listeners = [];
  const area = (name, data = stores[name]) => ({
    get: async key => (key == null ? {...data} : typeof key === 'string' ? (key in data ? {[key]: data[key]} : {}) : Object.fromEntries(Object.keys(key).map(k => [k, k in data ? data[k] : key[k]]))),
    set: async obj => {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) { changes[k] = {oldValue: data[k], newValue: v}; data[k] = JSON.parse(JSON.stringify(v)); }
      await Promise.resolve();
      listeners.forEach(fn => fn(changes, name));
    },
    remove: async key => {
        const changes = {};
        for (const k of [].concat(key)) if (k in data) { changes[k] = {oldValue: data[k]}; delete data[k]; }
        await Promise.resolve();
        if (Object.keys(changes).length) listeners.forEach(fn => fn(changes, name));
      },
  });
  // A stand-in for the background worker: the real sync engine (sync.js), started on first message.
  const runtime = {id: 'self', getURL: p => `chrome-extension://self/${p}`,
    sendMessage: msg => new Promise(resolve => {
      window.__rfSyncEngine ||= window.RedditFlexSync.start(window.chrome);
      if (!window.__rfSyncEngine.onMessage(msg, {id: 'self', url: 'chrome-extension://self/popup.html'}, resolve)) resolve(undefined);
    })};
  window.chrome = {storage: {local: area('local'), sync: area('sync'), onChanged: {addListener: fn => listeners.push(fn)}}, runtime};
})();
