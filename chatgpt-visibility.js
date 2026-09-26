const LEGACY_WORKER_KEY = "chatgptBackgroundWorker";
const LINK_KEY = "chatgptLink";
const PROJECT_CHATS_KEY = "projectChatBindings";
const WAKE_LEASES = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function validChatTab(tabId) {
  if (!Number.isInteger(Number(tabId))) return null;
  try {
    const tab = await chrome.tabs.get(Number(tabId));
    return tab?.id && tab.url?.startsWith("https://chatgpt.com/") ? tab : null;
  } catch {
    return null;
  }
}

async function restoreLegacyWorkerBinding() {
  const stored = await globalThis.LovaBurstStorage.get([LEGACY_WORKER_KEY, LINK_KEY, PROJECT_CHATS_KEY]);
  const worker = stored[LEGACY_WORKER_KEY] || null;
  const link = stored[LINK_KEY] || null;

  if (!worker && link?.worker !== true) return;

  const workerTabId = Number(worker?.tabId || (link?.worker ? link.tabId : 0)) || null;
  const sourceTabId = Number(link?.sourceTabId || worker?.sourceTabId) || null;
  const storedSourceUrl = String(
    link?.sourceUrl || worker?.sourceUrl || link?.url || worker?.url || "https://chatgpt.com/"
  ).trim();
  const sourceUrl = storedSourceUrl.startsWith("https://chatgpt.com/") ? storedSourceUrl : "https://chatgpt.com/";

  let target = await validChatTab(sourceTabId);

  if (!target) {
    const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
    target = tabs.find((tab) => tab.id && Number(tab.id) !== Number(workerTabId) && tab.url === sourceUrl) || null;
  }

  if (!target?.id) {
    const created = await chrome.tabs.create({ url: sourceUrl, active: false }).catch(() => null);
    target = created?.id ? await validChatTab(created.id) : null;
  }

  if (target?.id && link) {
    await globalThis.LovaBurstStorage.set({
      [LINK_KEY]: {
        tabId: target.id,
        url: target.url || sourceUrl,
        title: target.title || link.sourceTitle || link.title || "ChatGPT",
        linkedAt: link.linkedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const bindings = stored[PROJECT_CHATS_KEY] || {};
    let changed = false;
    const next = {};

    for (const [projectId, record] of Object.entries(bindings)) {
      const conversations = Array.isArray(record?.conversations) ? record.conversations : [];
      const updated = conversations.map((conversation) => {
        const boundToWorker =
          Number(conversation?.tabId) === Number(workerTabId) ||
          Number(conversation?.workerTabId) === Number(workerTabId) ||
          conversation?.workerWindowId != null;

        if (!boundToWorker) return conversation;
        changed = true;

        const {
          workerTabId: _workerTabId,
          workerWindowId: _workerWindowId,
          sourceTabId: _sourceTabId,
          sourceUrl: savedSourceUrl,
          ...rest
        } = conversation;

        return {
          ...rest,
          tabId: target.id,
          url: target.url || savedSourceUrl || sourceUrl,
          title: target.title || conversation.title || "ChatGPT",
        };
      });

      next[projectId] = { ...record, conversations: updated };
    }

    if (changed) await globalThis.LovaBurstStorage.set({ [PROJECT_CHATS_KEY]: next });
  }

  await globalThis.LovaBurstStorage.remove(LEGACY_WORKER_KEY);

  if (worker?.windowId && chrome.windows?.remove) {
    await chrome.windows.remove(worker.windowId).catch(() => {});
  } else if (workerTabId && workerTabId !== target?.id) {
    await chrome.tabs.remove(workerTabId).catch(() => {});
  }
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
  try {
    await chrome.windows.update(windowId, { focused: true });
  } catch {}
}

async function restoreLease(lease) {
  if (!lease || lease.restored) return;
  lease.restored = true;
  if (lease.timer) clearTimeout(lease.timer);
  WAKE_LEASES.delete(lease.token);

  if (lease.previousTabId && lease.previousTabId !== lease.tabId) {
    await chrome.tabs.update(lease.previousTabId, { active: true }).catch(() => {});
  }
  if (lease.previousWindowId && lease.previousWindowId !== lease.windowId) {
    await focusWindow(lease.previousWindowId);
  }
}

async function beginWake(tab, durationMs = 7000) {
  const currentTab = await validChatTab(tab?.id);
  if (!currentTab?.id) throw new Error("A aba do ChatGPT não está disponível.");
  tab = currentTab;

  const previous = await focusedTab();
  const token = `${tab.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const lease = {
    token,
    tabId: tab.id,
    windowId: tab.windowId,
    previousTabId: previous?.id || null,
    previousWindowId: previous?.windowId || null,
    restored: false,
    timer: null,
  };
  WAKE_LEASES.set(token, lease);

  await chrome.tabs.update(tab.id, { active: true, autoDiscardable: false }).catch(async () => {
    await chrome.tabs.update(tab.id, { active: true });
  });
  if (tab.windowId !== previous?.windowId) await focusWindow(tab.windowId);

  lease.timer = setTimeout(() => void restoreLease(lease), Math.max(1200, durationMs));
  return lease;
}

async function releaseWake(token) {
  const lease = WAKE_LEASES.get(String(token || ""));
  if (!lease) return;
  await restoreLease(lease);
}

async function wakeForResult(tab, projectId) {
  const lease = await beginWake(tab, 1800);
  try {
    await sleep(240);
    const current = await validChatTab(tab.id);
    if (!current?.id) throw new Error("A aba do ChatGPT mudou antes da verificação.");
    const response = await globalThis.LovaBurstTabSafety.sendMessage(current.id, {
      type: "LOVABURST_SCAN_RESULT_MARKERS",
      projectId: String(projectId || ""),
      wakeBypass: true,
    }).catch(() => null);
    return response || { ok: true };
  } finally {
    await sleep(80);
    await restoreLease(lease);
  }
}

globalThis.LovaBurstMessageGate.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "LOVABURST_WAKE_CHATGPT_BEGIN") {
    beginWake(sender.tab, Number(message.durationMs) || 7000)
      .then((lease) => sendResponse({ ok: true, token: lease.token }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_WAKE_CHATGPT_END") {
    releaseWake(message.token)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_WAKE_CHATGPT_FOR_RESULT") {
    wakeForResult(sender.tab, message.projectId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_KEEP_CHATGPT_READY") {
    if (sender.tab?.id) {
      chrome.tabs.update(sender.tab.id, { autoDiscardable: false }).catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

void restoreLegacyWorkerBinding().catch((error) => {
  console.warn("[LovaBurst] Não foi possível restaurar o vínculo antigo do ChatGPT:", error);
});
