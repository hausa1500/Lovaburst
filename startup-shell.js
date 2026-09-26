/* LovaBurst universal startup shell: desktop Side Panel + Chromium mobile popup/tab fallback. */
(() => {
  const POPUP_PATH = "src/popup/popup.html";

  async function platform() {
    try {
      if (chrome.runtime?.getPlatformInfo) {
        const info = await chrome.runtime.getPlatformInfo();
        if (info?.os) return String(info.os).toLowerCase();
      }
    } catch {}
    const ua = String(globalThis.navigator?.userAgent || "").toLowerCase();
    if (/android|mobile/.test(ua)) return "android";
    return "desktop";
  }

  function sidePanelApiAvailable() {
    return Boolean(chrome.sidePanel?.setPanelBehavior && chrome.sidePanel?.open);
  }

  async function shouldUseSidePanel() {
    const os = await platform();
    return os !== "android" && sidePanelApiAvailable();
  }

  async function setActionMode() {
    const useSidePanel = await shouldUseSidePanel();
    if (chrome.action?.setPopup) {
      try {
        await chrome.action.setPopup({ popup: useSidePanel ? "" : POPUP_PATH });
      } catch (error) {
        console.warn("[LovaBurst] Falha ao configurar UI universal:", error);
      }
    }
    if (!useSidePanel) return;
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn("[LovaBurst] Side Panel não pôde ser configurado:", error);
    }
  }

  async function openExtensionPageFallback() {
    const url = chrome.runtime.getURL(POPUP_PATH);
    try {
      const existing = await chrome.tabs.query({ url: `${url}*` });
      const tab = existing.find((item) => Number.isInteger(Number(item?.id)));
      if (tab?.id) {
        await chrome.tabs.update(tab.id, { active: true });
        if (Number.isInteger(Number(tab.windowId)) && chrome.windows?.update) {
          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
        }
        return;
      }
    } catch {}
    try { await chrome.tabs.create({ url, active: true }); }
    catch (error) { console.warn("[LovaBurst] Falha ao abrir a interface universal:", error); }
  }

  async function openFromAction(tab) {
    if (!(await shouldUseSidePanel())) {
      // Em Android o popup configurado acima é o caminho principal. Alguns navegadores
      // ainda disparam onClicked; nesse caso abrimos uma aba da extensão como último fallback.
      await openExtensionPageFallback();
      return;
    }
    const windowId = Number(tab?.windowId);
    if (!Number.isInteger(windowId)) return openExtensionPageFallback();
    try {
      await chrome.sidePanel.open({ windowId });
    } catch (error) {
      console.warn("[LovaBurst] Side Panel falhou; usando aba universal:", error);
      await openExtensionPageFallback();
    }
  }

  chrome.runtime.onInstalled.addListener(() => { void setActionMode(); });
  chrome.runtime.onStartup.addListener(() => { void setActionMode(); });
  chrome.action?.onClicked?.addListener((tab) => { void openFromAction(tab); });
  void setActionMode();
})();
