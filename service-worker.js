import { getConfig, setConfig } from "../shared/storage.js";

const CHATGPT_URL_PATTERNS = ["https://chatgpt.com/*"];
const CHATGPT_BRIDGE_FILE = "src/content/chatgpt.js";

async function assertAllowedTab(tabId, allowedOrigins) {
  if (!Number.isInteger(Number(tabId))) throw new Error("Aba inválida.");
  const tab = await chrome.tabs.get(Number(tabId));
  const url = new URL(String(tab?.url || ""));
  if (!allowedOrigins.includes(url.origin)) throw new Error("Origem da aba não autorizada.");
  return tab;
}

async function sendToAllowedTab(tabId, allowedOrigins, message) {
  const tab = await assertAllowedTab(tabId, allowedOrigins);
  return globalThis.LovaBurstTabSafety.sendMessage(tab.id, message);
}

const PENDING_PROMPT_TTL_MS = 2 * 60 * 60 * 1000;
const RUN_STATUS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function timestampOf(value) {
  const n = Date.parse(String(value || ""));
  return Number.isFinite(n) ? n : 0;
}

async function pruneTransientState() {
  const stored = await globalThis.LovaBurstStorage.get(["pendingPrompt", "projectRunStatuses"]);
  const now = Date.now();
  const removals = [];
  if (stored.pendingPrompt) {
    const stamp = timestampOf(stored.pendingPrompt.dispatchedAt || stored.pendingPrompt.failedAt || stored.pendingPrompt.capturedAt);
    if (!stamp || now - stamp > PENDING_PROMPT_TTL_MS) removals.push("pendingPrompt");
  }
  const statuses = stored.projectRunStatuses && typeof stored.projectRunStatuses === "object" ? stored.projectRunStatuses : {};
  const nextStatuses = {};
  let changed = false;
  for (const [projectId, status] of Object.entries(statuses)) {
    const stamp = timestampOf(status?.updatedAt || status?.completedAt || status?.startedAt);
    if (stamp && now - stamp <= RUN_STATUS_TTL_MS) nextStatuses[projectId] = status;
    else changed = true;
  }
  if (removals.length) await globalThis.LovaBurstStorage.remove(removals);
  if (changed) await globalThis.LovaBurstStorage.set({ projectRunStatuses: nextStatuses });
}

async function configureSidePanel() {
  let os = "";
  try { os = String((await chrome.runtime.getPlatformInfo?.())?.os || "").toLowerCase(); } catch {}
  if (!os && /android|mobile/i.test(String(globalThis.navigator?.userAgent || ""))) os = "android";
  const hasSidePanel = os !== "android" && Boolean(chrome.sidePanel?.setPanelBehavior && chrome.sidePanel?.open);
  if (chrome.action?.setPopup) {
    try {
      await chrome.action.setPopup({ popup: hasSidePanel ? "" : "src/popup/popup.html" });
    } catch {}
  }
  if (!hasSidePanel) return;

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("[LovaBurst] Não foi possível configurar o painel lateral:", error);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const config = await getConfig();
  const migration = await globalThis.LovaBurstStorage.get([
    "repositoryDetectionMigrationV0400",
    "repositoryDetectionMigrationV0307",
    "workspaceBindings",
    "projectChatBindings",
    "lastLovableWorkspace",
  ]);
  const patch = { config };

  if (!migration.repositoryDetectionMigrationV0400) {
    patch.workspaceBindings = {};
    patch.repositoryDetectionMigrationV0400 = true;
  }

  // 3.0.7 intentionally invalidates repository caches once. Older detectors could
  // mistake unrelated GitHub links (terms/docs) for the project's repository.
  if (!migration.repositoryDetectionMigrationV0307) {
    const sourceBindings = patch.workspaceBindings || migration.workspaceBindings || {};
    patch.workspaceBindings = Object.fromEntries(Object.entries(sourceBindings).map(([key, value]) => [
      key,
      { ...(value || {}), repository: "", source: "repository-redetect-3.0.7", githubConnectionState: "unknown" },
    ]));

    patch.projectChatBindings = Object.fromEntries(Object.entries(migration.projectChatBindings || {}).map(([key, value]) => [
      key,
      { ...(value || {}), repository: "" },
    ]));

    if (migration.lastLovableWorkspace) {
      patch.lastLovableWorkspace = { ...migration.lastLovableWorkspace, repository: "", githubConnectionState: "unknown" };
    }
    patch.repositoryDetectionMigrationV0307 = true;
  }

  await globalThis.LovaBurstStorage.set(patch);
  await pruneTransientState();
  await configureSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  pruneTransientState().catch(() => {});
  configureSidePanel();
});

pruneTransientState().catch(() => {});
configureSidePanel();


async function listChatGptTabs() {
  const tabs = await chrome.tabs.query({ url: CHATGPT_URL_PATTERNS });
  return tabs
    .filter((tab) => tab.id)
    .map((tab) => ({
      tabId: tab.id,
      title: tab.title || "ChatGPT",
      url: tab.url || "https://chatgpt.com/",
      active: Boolean(tab.active),
      windowId: tab.windowId,
    }));
}

async function getStoredChatGptLink() {
  const stored = await globalThis.LovaBurstStorage.get("chatgptLink");
  return stored.chatgptLink || null;
}

async function clearChatGptLink() {
  await globalThis.LovaBurstStorage.remove("chatgptLink");
}

async function getLinkedChatGptTab() {
  const link = await getStoredChatGptLink();
  if (!link?.tabId) return null;

  try {
    const tab = await chrome.tabs.get(link.tabId);
    if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) {
      await clearChatGptLink();
      return null;
    }

    if (tab.url !== link.url || tab.title !== link.title) {
      await globalThis.LovaBurstStorage.set({
        chatgptLink: {
          ...link,
          url: tab.url || link.url,
          title: tab.title || link.title || "ChatGPT",
          updatedAt: new Date().toISOString(),
        },
      });
    }

    return tab;
  } catch {
    // A tab pode ter sido recriada pelo Chrome. Tentamos recuperar pela URL exata uma vez.
    const tabs = await listChatGptTabs();
    const recovered = tabs.find((tab) => link.url && tab.url === link.url);

    if (recovered?.tabId) {
      const nextLink = {
        tabId: recovered.tabId,
        url: recovered.url,
        title: recovered.title,
        linkedAt: link.linkedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await globalThis.LovaBurstStorage.set({ chatgptLink: nextLink });
      return chrome.tabs.get(recovered.tabId);
    }

    await clearChatGptLink();
    return null;
  }
}

async function linkChatGptTab(tabId) {
  if (!Number.isInteger(tabId)) {
    throw new Error("Aba do ChatGPT inválida.");
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) {
    throw new Error("A aba selecionada não é uma conversa do ChatGPT.");
  }

  const bridgeReady = await ensureChatGptBridge(tab.id);
  if (!bridgeReady) {
    throw new Error("A ponte da LovaBurst não respondeu nessa aba do ChatGPT.");
  }

  const link = {
    tabId: tab.id,
    url: tab.url || "https://chatgpt.com/",
    title: tab.title || "ChatGPT",
    linkedAt: new Date().toISOString(),
  };
  await globalThis.LovaBurstStorage.set({ chatgptLink: link });
  return link;
}

async function getChatGptStatus() {
  const tabs = await listChatGptTabs();
  const linkedTab = await getLinkedChatGptTab();
  const link = linkedTab ? await getStoredChatGptLink() : null;

  return {
    connected: Boolean(linkedTab?.id),
    link,
    tabs,
  };
}

async function sendPromptMessage(tabId, prompt) {
  const tab = await assertAllowedTab(tabId, ["https://chatgpt.com"]);
  return globalThis.LovaBurstTabSafety.sendMessage(tab.id, {
    type: "LOVABURST_SUBMIT_TO_CHATGPT",
    prompt,
    expectedUrl: tab.url || "",
  });
}

async function ensureChatGptBridge(tabId) {
  await assertAllowedTab(tabId, ["https://chatgpt.com"]);
  try {
    const ping = await sendToAllowedTab(tabId, ["https://chatgpt.com"], { type: "LOVABURST_CONTENT_PING" });
    if (ping?.ok && ping.source === "chatgpt") return true;
  } catch {}

  await assertAllowedTab(tabId, ["https://chatgpt.com"]);
  await globalThis.LovaBurstTabSafety.executeScript({
    target: { tabId },
    files: [CHATGPT_BRIDGE_FILE],
  });

  const ping = await sendToAllowedTab(tabId, ["https://chatgpt.com"], { type: "LOVABURST_CONTENT_PING" });
  return Boolean(ping?.ok && ping.source === "chatgpt");
}

async function detectLovableWorkspace(tabId, payload = {}) {
  const lovableProjectId = String(payload.lovableProjectId || "").trim();
  const workspaceKey = lovableProjectId || String(payload.url || "").trim();
  const githubConnectionState = ["connected", "disconnected", "unknown"].includes(String(payload.githubConnectionState || ""))
    ? String(payload.githubConnectionState)
    : "unknown";
  const rawDirect = String(payload.domRepository || "").trim();
  const direct = /^[A-Za-z0-9_.-]{2,100}\/[A-Za-z0-9_.-]{2,100}$/.test(rawDirect) ? rawDirect : "";

  if (tabId) await assertAllowedTab(Number(tabId), ["https://lovable.dev"]);

  // Lovable's Git settings is authoritative. If it explicitly says "Connect project",
  // any previously cached repository belongs to stale state and must be discarded.
  if (githubConnectionState === "disconnected") {
    if (workspaceKey) {
      const stored = await globalThis.LovaBurstStorage.get(["workspaceBindings", "projectChatBindings", "lastLovableWorkspace"]);
      const bindings = { ...(stored.workspaceBindings || {}) };
      bindings[workspaceKey] = {
        ...(bindings[workspaceKey] || {}),
        repository: "",
        detectedAt: new Date().toISOString(),
        source: "lovable-git-disconnected",
        githubConnectionState: "disconnected",
      };

      const chats = { ...(stored.projectChatBindings || {}) };
      if (chats[workspaceKey]) chats[workspaceKey] = { ...chats[workspaceKey], repository: "" };

      const patch = { workspaceBindings: bindings, projectChatBindings: chats };
      if (stored.lastLovableWorkspace?.lovableProjectId === workspaceKey) {
        patch.lastLovableWorkspace = { ...stored.lastLovableWorkspace, repository: "", githubConnectionState: "disconnected" };
      }
      await globalThis.LovaBurstStorage.set(patch);
    }
    return { repository: "", source: "lovable-git-disconnected", githubConnectionState, lovableProjectId };
  }

  if (direct) {
    if (workspaceKey) {
      const stored = await globalThis.LovaBurstStorage.get("workspaceBindings");
      await globalThis.LovaBurstStorage.set({
        workspaceBindings: {
          ...(stored.workspaceBindings || {}),
          [workspaceKey]: { repository: direct, detectedAt: new Date().toISOString(), source: "isolated-dom", githubConnectionState: "connected" },
        },
      });
    }
    return { repository: direct, source: "isolated-dom", githubConnectionState: "connected", lovableProjectId };
  }

  if (workspaceKey) {
    const stored = await globalThis.LovaBurstStorage.get("workspaceBindings");
    const cached = stored.workspaceBindings?.[workspaceKey]?.repository;
    if (cached) return { repository: cached, source: "workspace-cache", githubConnectionState, lovableProjectId };
  }

  return { repository: "", source: "none", githubConnectionState, lovableProjectId };
}

const sleepBackground = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function relayPromptToChatGpt(payload, sourceTabId = null) {
  const config = await getConfig();
  if (config.enabled === false || config.chatgptEnabled === false) {
    throw new Error("A integração com o ChatGPT está desativada na LovaBurst.");
  }

  const tab = await getLinkedChatGptTab();
  if (!tab?.id) {
    throw new Error("ChatGPT não está vinculado. Abra o painel da LovaBurst e vincule uma conversa do ChatGPT.");
  }

  let completionToken = "";
  let sourceTab = null;
  let activatedChatForDispatch = false;

  try {
    if (Number.isInteger(sourceTabId)) {
      sourceTab = await chrome.tabs.get(sourceTabId).catch(() => null);
    }

    // ChatGPT currently defers parts of its composer while a tab is backgrounded.
    // Briefly make the linked chat the active tab so React processes the injected
    // input/click immediately, then restore the Lovable tab after dispatch.
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true });
      activatedChatForDispatch = true;
      await sleepBackground(180);
    }

    const bridgeReady = await ensureChatGptBridge(tab.id);
    if (!bridgeReady) throw new Error("A ponte do ChatGPT não respondeu após a injeção.");

    const authorized = await globalThis.LovaBurstLicense?.dispatchOperation?.("main", payload);
    if (!authorized?.prompt) throw new Error("O servidor não liberou a operação.");
    completionToken = globalThis.LovaBurstCompletion?.tokenFromPrepared?.(authorized) || "";
    if (!completionToken) throw new Error("O servidor não forneceu token de conclusão válido.");
    if (payload?.lovableProjectId) await setProjectRunStatus(payload.lovableProjectId, { completionToken });
    const executionPrompt = globalThis.LovaBurstExecutionPolicy?.applyMainPrompt?.(authorized.prompt, {
      repository: payload?.repository,
      projectId: payload?.lovableProjectId,
    }) || authorized.prompt;
    const response = await sendPromptMessage(tab.id, executionPrompt);
    if (!response?.ok) {
      throw new Error(response?.error || "O ChatGPT não confirmou o envio do prompt.");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Não foi possível ativar a ponte da LovaBurst no ChatGPT: ${detail}`);
  } finally {
    if (
      activatedChatForDispatch &&
      sourceTab?.id &&
      sourceTab.id !== tab.id &&
      sourceTab.url?.startsWith("https://lovable.dev/")
    ) {
      await chrome.tabs.update(sourceTab.id, { active: true }).catch(() => {});
    }
  }

  return { tabId: tab.id, completionToken };
}

const PROJECT_RUN_STATUS_KEY = "projectRunStatuses";
const ACCESS_BOOTSTRAP_KEY = "accessBootstrapConversationsV219";

async function accessBootstrapState(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return { required: false, key: "" };
  const stored = await globalThis.LovaBurstStorage.get(["projectChatBindings", ACCESS_BOOTSTRAP_KEY]);
  const record = stored.projectChatBindings?.[id];
  const conversation = record?.conversations?.find((item) => item.id === record.activeConversationId) || null;
  const identity = String(conversation?.id || record?.activeConversationId || conversation?.url || (conversation?.tabId ? `tab-${conversation.tabId}` : "")).trim();
  if (!identity) return { required: true, key: "" };
  const key = `${id}::${identity}`;
  return { required: !Boolean(stored[ACCESS_BOOTSTRAP_KEY]?.[key]), key };
}

async function markAccessBootstrapComplete(key) {
  const id = String(key || "").trim();
  if (!id) return;
  const stored = await globalThis.LovaBurstStorage.get(ACCESS_BOOTSTRAP_KEY);
  const entries = stored[ACCESS_BOOTSTRAP_KEY] || {};
  await globalThis.LovaBurstStorage.set({
    [ACCESS_BOOTSTRAP_KEY]: {
      ...entries,
      [id]: { completedAt: new Date().toISOString() },
    },
  });
}

async function setProjectRunStatus(projectId, patch) {
  if (!projectId) return null;
  const stored = await globalThis.LovaBurstStorage.get(PROJECT_RUN_STATUS_KEY);
  const statuses = stored[PROJECT_RUN_STATUS_KEY] || {};
  const previous = statuses[projectId] || {};
  const next = {
    ...previous,
    ...patch,
    projectId,
    updatedAt: new Date().toISOString(),
  };
  await globalThis.LovaBurstStorage.set({
    [PROJECT_RUN_STATUS_KEY]: {
      ...statuses,
      [projectId]: next,
    },
  });
  return next;
}

async function handleCapturedPrompt(message, sender) {
  const payload = message.payload;

  if (!payload?.text || typeof payload.text !== "string" || !payload.text.trim()) {
    return { ok: false, error: "Prompt vazio ou inválido." };
  }

  let repository = /^[A-Za-z0-9_.-]{2,100}\/[A-Za-z0-9_.-]{2,100}$/.test(String(payload.repository || "").trim()) ? String(payload.repository).trim() : "";
  let repositoryDetectionSource = String(payload.repositoryDetectionSource || "").slice(0, 80);
  let lovableProjectId = String(payload.lovableProjectId || "").trim();

  if (!repository) {
    const workspace = await detectLovableWorkspace(sender?.tab?.id, {
      lovableProjectId,
      url: payload.url,
      domRepository: "",
    });
    repository = workspace.repository || "";
    repositoryDetectionSource = workspace.source || "none";
    lovableProjectId = workspace.lovableProjectId || lovableProjectId;
  }

  const bootstrap = await accessBootstrapState(lovableProjectId);

  const pendingPrompt = {
    text: payload.text.trim().slice(0, 25_000),
    url: String(sender?.tab?.url || "").slice(0, 2000),
    title: String(sender?.tab?.title || "").slice(0, 300),
    capturedAt: new Date().toISOString(),
    source: message.source || "lovable",
    repository,
    repositoryDetectionSource,
    lovableProjectId,
    skills: Array.isArray(payload.skills) ? payload.skills.filter((id) => typeof id === "string" && /^[a-z0-9-]{2,40}$/i.test(id)).slice(0, 8) : [],
    quickAction: /^[a-z0-9-]{2,40}$/i.test(String(payload.quickAction || "")) ? String(payload.quickAction) : "",
    accessBootstrap: bootstrap.required ? "REQUIRED" : "",
    accessBootstrapKey: bootstrap.key || "",
    status: "captured",
  };

  const workspaceKey = pendingPrompt.lovableProjectId || pendingPrompt.url;
  const storagePatch = { pendingPrompt };

  await setProjectRunStatus(pendingPrompt.lovableProjectId, {
    status: "sending",
    marker: "",
    objective: pendingPrompt.text.slice(0, 700),
    startedAt: pendingPrompt.capturedAt,
    dispatchedAt: "",
    completedAt: "",
    error: "",
    excerpt: "",
    repository: pendingPrompt.repository || "",
  });

  if (workspaceKey && pendingPrompt.repository) {
    const stored = await globalThis.LovaBurstStorage.get("workspaceBindings");
    storagePatch.workspaceBindings = {
      ...(stored.workspaceBindings || {}),
      [workspaceKey]: {
        repository: pendingPrompt.repository,
        detectedAt: new Date().toISOString(),
        source: pendingPrompt.repositoryDetectionSource || "captured",
      },
    };
  }

  await globalThis.LovaBurstStorage.set(storagePatch);

  try {
    const relay = await relayPromptToChatGpt(pendingPrompt, sender?.tab?.id);
    const dispatchedPrompt = {
      ...pendingPrompt,
      status: "dispatched",
      chatgptTabId: relay.tabId,
      dispatchedAt: new Date().toISOString(),
    };
    await globalThis.LovaBurstStorage.set({ pendingPrompt: dispatchedPrompt });
    await setProjectRunStatus(pendingPrompt.lovableProjectId, {
      status: "working",
      marker: "",
      dispatchedAt: dispatchedPrompt.dispatchedAt,
      chatgptTabId: relay.tabId,
      completionToken: relay.completionToken || "",
      error: "",
    });
    return {
      ok: true,
      status: "dispatched",
      chatgptTabId: relay.tabId,
      repository: pendingPrompt.repository,
      repositoryDetectionSource: pendingPrompt.repositoryDetectionSource,
    };
  } catch (error) {
    const failedPrompt = {
      ...pendingPrompt,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      failedAt: new Date().toISOString(),
    };
    await globalThis.LovaBurstStorage.set({ pendingPrompt: failedPrompt });
    await setProjectRunStatus(pendingPrompt.lovableProjectId, {
      status: "error",
      marker: "[LOVABURST_ERROR]",
      error: failedPrompt.error,
      completedAt: failedPrompt.failedAt,
    });
    return { ok: false, error: failedPrompt.error };
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const link = await getStoredChatGptLink();
  if (link?.tabId === tabId) {
    await clearChatGptLink();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const link = await getStoredChatGptLink();
  if (link?.tabId !== tabId) return;

  if (changeInfo.url && !changeInfo.url.startsWith("https://chatgpt.com/")) {
    await clearChatGptLink();
    return;
  }

  if (tab?.url?.startsWith("https://chatgpt.com/") && (changeInfo.url || changeInfo.title)) {
    await globalThis.LovaBurstStorage.set({
      chatgptLink: {
        ...link,
        url: tab.url,
        title: tab.title || link.title || "ChatGPT",
        updatedAt: new Date().toISOString(),
      },
    });
  }
});

globalThis.LovaBurstMessageGate.addListener((message, sender, sendResponse) => {
  if (message?.type === "LOVABURST_RESULT_MARKER_DETECTED") {
    const marker = String(message.marker || "");
    const projectId = String(message.projectId || "").trim();
    const completionToken = String(message.completionToken || "").toLowerCase();
    globalThis.LovaBurstStorage.get([PROJECT_RUN_STATUS_KEY, "pendingPrompt"])
      .then(async (stored) => {
        const current = stored[PROJECT_RUN_STATUS_KEY]?.[projectId] || null;
        const expected = String(current?.completionToken || "").toLowerCase();
        if (!projectId || !expected || completionToken !== expected) {
          sendResponse({ ok: false, error: "Marcador de execução inválido ou obsoleto." });
          return;
        }
        const expectedMarkers = new Set([
          `[LOVABURST_DONE:${expected}]`,
          `[LOVABURST_BLOCKED:${expected}]`,
          `[LOVABURST_ERROR:${expected}]`,
        ]);
        if (!expectedMarkers.has(marker)) {
          sendResponse({ ok: false, error: "Marcador de execução não autorizado." });
          return;
        }
        const prompt = stored.pendingPrompt;
        if (marker === `[LOVABURST_DONE:${expected}]`) {
          if (prompt?.accessBootstrapKey && String(prompt?.lovableProjectId || "") === projectId) {
            await markAccessBootstrapComplete(prompt.accessBootstrapKey);
          }
          await globalThis.LovaBurstStorage.remove("pendingPrompt");
        } else {
          await globalThis.LovaBurstStorage.remove("pendingPrompt");
        }
        await globalThis.LovaBurstAgentRunner?.onResult?.({
          projectId,
          status: String(message.status || ""),
          marker,
          completionToken: expected,
        }).catch(() => {});
        sendResponse({ ok: true, projectId, status: String(message.status || ""), marker });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }


  if (!message || typeof message !== "object") return false;
  if (message.type === "LOVABURST_EXECUTE_SPECIAL_OPERATION") {
    const operation = String(message.operation || "").trim();
    if (!["create-project", "analyze-project", "bootstrap-context"].includes(operation)) { sendResponse({ ok: false, error: "Operação inválida." }); return false; }
    globalThis.LovaBurstLicense?.dispatchOperation?.(operation, message.payload || {})
      .then((authorized) => {
        if (!authorized?.prompt) throw new Error("O servidor não liberou esta operação.");
        sendResponse({ ok: true, prompt: authorized.prompt, completionToken: authorized.completionToken || "" });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), code: error?.code || "" }));
    return true;
  }

  if (message.type === "LOVABURST_GET_CONFIG") {
    getConfig()
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_SET_CONFIG") {
    setConfig(message.config ?? {})
      .then((config) => sendResponse({ ok: true, config }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_LIST_CHATGPT_TABS") {
    listChatGptTabs()
      .then((tabs) => sendResponse({ ok: true, tabs }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_GET_CHATGPT_STATUS") {
    getChatGptStatus()
      .then((status) => sendResponse({ ok: true, ...status }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_LINK_CHATGPT") {
    linkChatGptTab(Number(message.tabId))
      .then((link) => sendResponse({ ok: true, link }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_UNLINK_CHATGPT") {
    clearChatGptLink()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_OPEN_LINKED_CHATGPT") {
    getLinkedChatGptTab()
      .then(async (tab) => {
        if (!tab?.id) {
          sendResponse({ ok: false, error: "Nenhuma conversa do ChatGPT está vinculada." });
          return;
        }
        await chrome.tabs.update(tab.id, { active: true });
        if (tab.windowId && chrome.windows?.update) await chrome.windows.update(tab.windowId, { focused: true });
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_DETECT_WORKSPACE") {
    detectLovableWorkspace(sender?.tab?.id, message.payload || {})
      .then((workspace) => sendResponse({ ok: true, ...workspace }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }


  if (message.type === "LOVABURST_PING") {
    sendResponse({ ok: true, source: "background" });
  }

  return false;
});
