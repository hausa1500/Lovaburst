const PROJECT_CHATS_KEY = "projectChatBindings";
const RESULT_BRIDGE = "src/content/chatgpt-result-refresh.js";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeChatMessage(tabId, message) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!tab?.id || !String(tab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  return globalThis.LovaBurstTabSafety.sendMessage(tab.id, message);
}

async function activeProjectConversation(projectId) {
  if (!projectId) return null;
  const stored = await globalThis.LovaBurstStorage.get(PROJECT_CHATS_KEY);
  const record = stored[PROJECT_CHATS_KEY]?.[projectId];
  return record?.conversations?.find((item) => item.id === record.activeConversationId) || null;
}

async function resolveChatTab(conversation) {
  if (!conversation) return null;
  if (conversation.tabId) {
    try {
      const tab = await chrome.tabs.get(conversation.tabId);
      const lockedUrl = String(conversation.lockedUrl || conversation.url || "").trim();
      if (tab?.url?.startsWith("https://chatgpt.com/") && (!lockedUrl || tab.url === lockedUrl)) return { tab, lockedUrl };
    } catch {}
  }
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  const lockedUrl = String(conversation.lockedUrl || conversation.url || "").trim();
  if (lockedUrl && lockedUrl !== "https://chatgpt.com/") {
    const exact = tabs.find((tab) => tab.url === lockedUrl);
    if (exact?.id) return { tab: exact, lockedUrl };
  }
  return null;
}

async function focusedTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] || null;
  } catch {
    return null;
  }
}

async function focusWindow(windowId) {
  if (!Number.isInteger(windowId) || !chrome.windows?.update) return;
  try { await chrome.windows.update(windowId, { focused: true }); } catch {}
}

async function scanResult(tabId, projectId, lockedUrl = "") {
  const safeTab = await chrome.tabs.get(Number(tabId));
  if (!safeTab?.id || !String(safeTab.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && safeTab.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes da leitura do resultado.");
  const message = { type: "LOVABURST_SCAN_RESULT_MARKERS", projectId, wakeBypass: true, expectedUrl: lockedUrl || safeTab.url || "" };
  try {
    return await safeChatMessage(tabId, message);
  } catch {}
  const recheckedTab = await chrome.tabs.get(Number(tabId));
  if (!recheckedTab?.id || !String(recheckedTab.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && recheckedTab.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes da injeção.");
  await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: recheckedTab.id }, files: [RESULT_BRIDGE] });
  return safeChatMessage(tabId, message);
}

async function refreshVisibleChatGptResult(projectId) {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("Projeto Lovable não informado.");
  const conversation = await activeProjectConversation(id);
  const target = await resolveChatTab(conversation);
  const tab = target?.tab;
  const lockedUrl = target?.lockedUrl || "";
  if (!tab?.id) throw new Error("A conversa vinculada do ChatGPT não está disponível.");

  const previous = await focusedTab();
  const shouldRestore = Boolean(previous?.id && previous.id !== tab.id);
  const previousWindowId = previous?.windowId || null;

  try {
    if (!tab.active || shouldRestore) {
      await chrome.tabs.update(tab.id, { active: true, autoDiscardable: false }).catch(async () => {
        await chrome.tabs.update(tab.id, { active: true });
      });
      if (tab.windowId !== previousWindowId) await focusWindow(tab.windowId);
      await sleep(520);
    }
    const response = await scanResult(tab.id, id, lockedUrl);
    return response || { ok: true, projectId: id };
  } finally {
    if (shouldRestore) {
      await sleep(90);
      await chrome.tabs.update(previous.id, { active: true }).catch(() => {});
      if (previousWindowId !== tab.windowId) await focusWindow(previousWindowId);
    }
  }
}

globalThis.LovaBurstMessageGate.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "LOVABURST_REFRESH_CHATGPT_RESULT_V0304") return false;
  refreshVisibleChatGptResult(message.projectId)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
