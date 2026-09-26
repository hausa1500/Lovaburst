/* LovaBurst content messaging facade.
 * Content scripts already run in Chrome's isolated world. Keep transport simple and let the
 * background enforce extension id, top-level frame, origin, project binding, schema and auth.
 */
(() => {
  if (globalThis.LovaBurstRuntime) return;
  if (window.top !== window) return;
  const rawSend = chrome.runtime.sendMessage.bind(chrome.runtime);
  const rawAddListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
  const sendMessage = (message, ...rest) => rawSend(message, ...rest);
  const addListener = (listener) => rawAddListener((message, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return false;
    return listener(message, sender, sendResponse);
  });
  globalThis.LovaBurstRuntime = Object.freeze({ sendMessage, addListener });
})();
