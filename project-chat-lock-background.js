const PROJECT_CHATS_KEY = "projectChatBindings";
const PROJECT_RUN_STATUS_KEY = "projectRunStatuses";
const PROJECT_INTEGRATIONS_KEY = "projectIntegrations";
const CHATGPT_BRIDGE_FILE = "src/content/chatgpt.js";
const QUICK_ACTION_OBJECTIVES = Object.freeze({});



function shouldOwnPromptCapture(message) { return message?.type === "LOVABURST_PROMPT_CAPTURED"; }


async function safeChatMessage(tabId, message) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!tab?.id || !String(tab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  return globalThis.LovaBurstTabSafety.sendMessage(tab.id, message);
}
async function projectRecord(projectId) {
  const stored = await globalThis.LovaBurstStorage.get(PROJECT_CHATS_KEY);
  return stored[PROJECT_CHATS_KEY]?.[projectId] || null;
}

async function activeProjectConversation(projectId) {
  const record = await projectRecord(projectId);
  return record?.conversations?.find((item) => item.id === record.activeConversationId) || null;
}

async function resolveLockedChatTab(projectId) {
  const conversation = await activeProjectConversation(projectId);
  if (!conversation?.tabId) return null;
  try {
    const tab = await chrome.tabs.get(conversation.tabId);
    const lockedUrl = String(conversation.lockedUrl || conversation.url || "").trim();
    if (tab?.id && tab.url?.startsWith("https://chatgpt.com/") && (!lockedUrl || tab.url === lockedUrl)) {
      return { tab, conversation };
    }
  } catch {}
  return null;
}

async function ensureChatGptBridge(tabId) {
  const safeTab = await chrome.tabs.get(Number(tabId));
  if (!safeTab?.id || !String(safeTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  try {
    const ping = await safeChatMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
    if (ping?.ok && ping.source === "chatgpt") return true;
  } catch {}
  const recheckedTab = await chrome.tabs.get(Number(tabId));
  if (!recheckedTab?.id || !String(recheckedTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: recheckedTab.id }, files: [CHATGPT_BRIDGE_FILE] });
  const ping = await safeChatMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
  return Boolean(ping?.ok && ping.source === "chatgpt");
}

async function setProjectRunStatus(projectId, patch) {
  if (!projectId) return;
  const stored = await globalThis.LovaBurstStorage.get(PROJECT_RUN_STATUS_KEY);
  const statuses = stored[PROJECT_RUN_STATUS_KEY] || {};
  const previous = statuses[projectId] || {};
  await globalThis.LovaBurstStorage.set({
    [PROJECT_RUN_STATUS_KEY]: {
      ...statuses,
      [projectId]: { ...previous, ...patch, projectId, updatedAt: new Date().toISOString() },
    },
  });
}

async function resolveRepository(projectId, payloadRepository) {
  const raw = String(payloadRepository || "").trim();
  const direct = /^[A-Za-z0-9_.-]{2,100}\/[A-Za-z0-9_.-]{2,100}$/.test(raw) ? raw : "";
  if (direct) return { repository: direct, source: "payload" };
  const stored = await globalThis.LovaBurstStorage.get([PROJECT_CHATS_KEY, "workspaceBindings"]);
  const rec = stored[PROJECT_CHATS_KEY]?.[projectId];
  const cached = stored.workspaceBindings?.[projectId];
  return {
    repository: String(rec?.repository || cached?.repository || "").trim(),
    source: rec?.repository ? "project-chat-binding" : cached?.source || "workspace-cache",
  };
}

async function buildProjectContext(projectId, repository) {
  const [bindingsStore, integrationsStore] = await Promise.all([
    globalThis.LovaBurstStorage.get(PROJECT_CHATS_KEY),
    globalThis.LovaBurstStorage.get(PROJECT_INTEGRATIONS_KEY),
  ]);
  const rec = bindingsStore[PROJECT_CHATS_KEY]?.[projectId] || null;
  const supabase = integrationsStore[PROJECT_INTEGRATIONS_KEY]?.[projectId]?.supabase || null;
  return {
    recentObjectives: Array.isArray(rec?.recentObjectives)
      ? rec.recentObjectives.slice(-12).map((item) => ({ text: String(item?.text || "").slice(0, 700) })).filter((item) => item.text.trim())
      : [],
    handoffExcerpt: String(rec?.handoffExcerpt || "").slice(-8000),
    sourceUrl: String(rec?.sourceUrl || "").slice(0, 2000),
    supabase: {
      status: String(supabase?.status || "unknown").slice(0, 40),
      projectRef: String(supabase?.projectRef || "").slice(0, 100),
    },
  };
}

async function sendPrompt(tabId, prompt, lockedUrl = "") {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!tab?.id || !String(tab.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && tab.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes do envio.");
  const response = await globalThis.LovaBurstTabSafety.sendMessage(tab.id, { type: "LOVABURST_SUBMIT_TO_CHATGPT", prompt, expectedUrl: lockedUrl || tab.url || "" });
  if (!response?.ok) throw new Error(response?.error || "O ChatGPT não confirmou o envio do prompt.");
}

async function dispatchProjectLockedPrompt(message, sender) {
  const payload = message.payload || {};
  const text = String(payload.text || "").trim().slice(0, 25_000);
  const quickAction = /^[a-z0-9-]{2,40}$/i.test(String(payload.quickAction || "")) ? String(payload.quickAction) : "";
  const effectiveText = text;
  const projectId = String(payload.lovableProjectId || "").trim();
  if (!effectiveText) return { ok: false, error: "Prompt vazio ou inválido." };
  if (!projectId) return { ok: false, error: "Projeto Lovable não identificado." };

  const locked = await resolveLockedChatTab(projectId);
  if (!locked?.tab?.id) {
    await setProjectRunStatus(projectId, {
      status: "error",
      marker: "[LOVABURST_ERROR]",
      objective: text.slice(0, 700),
      error: "Selecione e trave uma aba do ChatGPT para este projeto antes de enviar.",
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: "Selecione e trave uma aba do ChatGPT para este projeto antes de enviar." };
  }

  const repo = await resolveRepository(projectId, payload.repository);
  const bootstrap = await globalThis.LovaBurstProjectLockBootstrap?.state?.(projectId).catch(() => ({ required: false, key: "" })) || { required: false, key: "" };
  const pendingPrompt = {
    text: effectiveText,
    url: String(sender?.tab?.url || "").slice(0, 2000),
    title: String(sender?.tab?.title || "").slice(0, 300),
    capturedAt: new Date().toISOString(),
    source: message.source || "lovable",
    repository: repo.repository,
    repositoryDetectionSource: payload.repositoryDetectionSource || repo.source || "",
    lovableProjectId: projectId,
    projectContext: await buildProjectContext(projectId, repo.repository),
    skills: Array.isArray(payload.skills) ? payload.skills.filter((id) => typeof id === "string" && /^[a-z0-9-]{2,40}$/i.test(id)).slice(0, 8) : [],
    quickAction: /^[a-z0-9-]{2,40}$/i.test(String(payload.quickAction || "")) ? String(payload.quickAction) : "",
    accessBootstrap: bootstrap.required ? "REQUIRED" : "",
    accessBootstrapKey: bootstrap.key || "",
    status: "captured",
  };

  await globalThis.LovaBurstStorage.set({ pendingPrompt });
  await setProjectRunStatus(projectId, {
    status: "sending",
    marker: "",
    objective: text.slice(0, 700),
    startedAt: pendingPrompt.capturedAt,
    dispatchedAt: "",
    completedAt: "",
    error: "",
    liveResponse: "",
    liveResponseAt: "",
    liveResponseMessageKey: "",
    repository: pendingPrompt.repository || "",
  });

  let sourceTab = null;
  let switched = false;
  try {
    if (Number.isInteger(sender?.tab?.id)) sourceTab = await chrome.tabs.get(sender.tab.id).catch(() => null);
    const tab = locked.tab;
    if (!tab.active) {
      await chrome.tabs.update(tab.id, { active: true });
      switched = true;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    if (!(await ensureChatGptBridge(tab.id))) throw new Error("A ponte do ChatGPT não respondeu após a injeção.");

    const authorized = await globalThis.LovaBurstLicense?.dispatchOperation?.("main", pendingPrompt);
    if (!authorized?.prompt) throw new Error("O servidor não liberou a operação.");
    const completionToken = globalThis.LovaBurstCompletion?.tokenFromPrepared?.(authorized) || "";
    if (!completionToken) throw new Error("O servidor não forneceu token de conclusão válido.");
    await setProjectRunStatus(projectId, { completionToken });
    const executionPrompt = globalThis.LovaBurstExecutionPolicy?.applyMainPrompt?.(authorized.prompt, {
      repository: pendingPrompt.repository,
      projectId,
    }) || authorized.prompt;
    await sendPrompt(tab.id, executionPrompt, String(locked.conversation?.lockedUrl || locked.conversation?.url || ""));

    const dispatchedAt = new Date().toISOString();
    await globalThis.LovaBurstStorage.set({ pendingPrompt: { ...pendingPrompt, status: "dispatched", chatgptTabId: tab.id, dispatchedAt } });
    await setProjectRunStatus(projectId, { status: "working", dispatchedAt, chatgptTabId: tab.id, completionToken, error: "" });
    return { ok: true, status: "dispatched", chatgptTabId: tab.id, repository: pendingPrompt.repository, repositoryDetectionSource: pendingPrompt.repositoryDetectionSource };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const msg = error instanceof Error ? error.message : String(error);
    await globalThis.LovaBurstStorage.set({ pendingPrompt: { ...pendingPrompt, status: "error", error: msg, failedAt } });
    await setProjectRunStatus(projectId, { status: "error", marker: "[LOVABURST_ERROR]", error: msg, completedAt: failedAt });
    return { ok: false, error: msg };
  } finally {
    if (switched && sourceTab?.id && sourceTab.id !== locked.tab.id && sourceTab.url?.startsWith("https://lovable.dev/")) {
      await chrome.tabs.update(sourceTab.id, { active: true }).catch(() => {});
    }
  }
}

async function preflightAuthorizedProjectPrompt(projectId) {
  const id = String(projectId || "").trim();
  if (!id) return { ok: false, error: "Projeto Lovable não identificado." };
  const locked = await resolveLockedChatTab(id);
  if (!locked?.tab?.id) {
    return { ok: false, error: "Conecte uma conversa do ChatGPT a este projeto antes de executar o Agent." };
  }
  return { ok: true, projectId: id, chatgptTabId: locked.tab.id };
}

async function dispatchAuthorizedProjectPrompt({ projectId, authorized, objective = "Project Intelligence" } = {}) {
  const id = String(projectId || "").trim();
  const prompt = String(authorized?.prompt || "").trim();
  const completionToken = globalThis.LovaBurstCompletion?.tokenFromPrepared?.(authorized) || "";
  if (!id || !prompt) throw new Error("Operação autorizada incompleta.");
  if (!completionToken) throw new Error("O servidor não forneceu token de conclusão válido.");
  const locked = await resolveLockedChatTab(id);
  if (!locked?.tab?.id) throw new Error("Conecte uma conversa do ChatGPT a este projeto antes de usar o Project Intelligence.");
  const previous = (await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0] || null;
  let switched = false;
  try {
    if (!locked.tab.active) {
      await chrome.tabs.update(locked.tab.id, { active: true });
      switched = true;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    if (!(await ensureChatGptBridge(locked.tab.id))) throw new Error("A ponte do ChatGPT não respondeu após a injeção.");
    await setProjectRunStatus(id, {
      status: "sending", marker: "", objective: String(objective || "Project Intelligence").slice(0, 700),
      startedAt: new Date().toISOString(), dispatchedAt: "", completedAt: "", error: "", completionToken,
    });
    await sendPrompt(locked.tab.id, prompt, String(locked.conversation?.lockedUrl || locked.conversation?.url || ""));
    const dispatchedAt = new Date().toISOString();
    await setProjectRunStatus(id, { status: "working", dispatchedAt, chatgptTabId: locked.tab.id, completionToken, error: "" });
    return { ok: true, projectId: id, chatgptTabId: locked.tab.id, completionToken, dispatchedAt };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await setProjectRunStatus(id, { status: "error", marker: "[LOVABURST_ERROR]", error: msg, completedAt: new Date().toISOString() });
    throw error;
  } finally {
    if (switched && previous?.id && previous.id !== locked.tab.id && String(previous.url || "").startsWith("https://lovable.dev/")) {
      await chrome.tabs.update(previous.id, { active: true }).catch(() => {});
    }
  }
}

globalThis.LovaBurstProjectDispatcher = Object.freeze({ preflight: preflightAuthorizedProjectPrompt, dispatchAuthorized: dispatchAuthorizedProjectPrompt });

globalThis.LovaBurstMessageGate.addListener((message, sender, sendResponse) => {
  if (!shouldOwnPromptCapture(message)) return false;
  dispatchProjectLockedPrompt(message, sender).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
  });
  return true;
});

const ACCESS_BOOTSTRAP_KEY = "accessBootstrapConversationsV219";
globalThis.LovaBurstProjectLockBootstrap = {
  async state(projectId) {
    const id = String(projectId || "").trim();
    if (!id) return { required: false, key: "" };
    const stored = await globalThis.LovaBurstStorage.get([PROJECT_CHATS_KEY, ACCESS_BOOTSTRAP_KEY]);
    const record = stored[PROJECT_CHATS_KEY]?.[id];
    const conversation = record?.conversations?.find((item) => item.id === record.activeConversationId) || null;
    const identity = String(conversation?.id || record?.activeConversationId || conversation?.url || (conversation?.tabId ? `tab-${conversation.tabId}` : "")).trim();
    if (!identity) return { required: true, key: "" };
    const key = `${id}::${identity}`;
    return { required: !Boolean(stored[ACCESS_BOOTSTRAP_KEY]?.[key]), key };
  },
};
