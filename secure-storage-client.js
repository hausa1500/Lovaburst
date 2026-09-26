/* LovaBurst storage facade — simple and reliable project/UI state.
 * License/session/device secrets are still protected separately by license-background.js.
 */
(() => {
  if (globalThis.LovaBurstStorage) return;
  const local = chrome.storage.local;
  const get = (keys, callback) => local.get(keys, callback);
  const set = (values, callback) => local.set(values, callback);
  const remove = (keys, callback) => local.remove(keys, callback);
  const clear = (callback) => local.clear(callback);
  globalThis.LovaBurstStorage = Object.freeze({ get, set, remove, clear, sensitiveKeys: new Set() });
})();
