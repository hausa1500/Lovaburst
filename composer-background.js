
const PROJECT_SKILLS_KEY = "projectSkillSelections";
const PROJECT_CHATS_KEY = "projectChatBindings";
const CHATGPT_ENHANCE_BRIDGE = "src/content/chatgpt-enhance.js";
const CHATGPT_SUBMIT_BRIDGE = "src/content/chatgpt.js";
const ENHANCE_TIMEOUT_MS = 95000;

function projectIdFromLovableUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.origin !== "https://lovable.dev") return "";
    return url.pathname.match(/\/projects\/([A-Za-z0-9-]{1,120})(?:\/|$)/i)?.[1] || "";
  } catch { return ""; }
}

async function safeChatMessage(tabId, message) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!tab?.id || !String(tab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  return globalThis.LovaBurstTabSafety.sendMessage(tab.id, message);
}

async function safeLovableMessage(tabId, projectId, message) {
  const tab = await chrome.tabs.get(Number(tabId));
  const actual = projectIdFromLovableUrl(tab?.url || "");
  if (!tab?.id || !actual || actual !== String(projectId || "")) throw new Error("O projeto Lovable ativo mudou antes do envio.");
  return globalThis.LovaBurstTabSafety.sendMessage(tab.id, message);
}

const SKILL_IDS = new Set([
  "interface-premium",
  "git-safe",
  "tests-regression",
  "responsive",
  "performance",
  "security-review",
]);

async function selectedSkills(projectId) {
  if (!projectId) return [];
  const stored = await globalThis.LovaBurstStorage.get(PROJECT_SKILLS_KEY);
  const ids = Array.isArray(stored[PROJECT_SKILLS_KEY]?.[projectId]) ? stored[PROJECT_SKILLS_KEY][projectId] : [];
  return ids.filter((id) => SKILL_IDS.has(id)).slice(0, 8);
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

async function ensureEnhanceBridge(tabId) {
  const safeTab = await chrome.tabs.get(Number(tabId));
  if (!safeTab?.id || !String(safeTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  try {
    const ping = await safeChatMessage(tabId, { type: "LOVABURST_ENHANCE_PING" });
    if (ping?.ok && ping.version === "0.31.1") return true;
  } catch {}
  const recheckedTab = await chrome.tabs.get(Number(tabId));
  if (!recheckedTab?.id || !String(recheckedTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: recheckedTab.id }, files: [CHATGPT_ENHANCE_BRIDGE] });
  const ping = await safeChatMessage(tabId, { type: "LOVABURST_ENHANCE_PING" });
  return Boolean(ping?.ok && ping.version === "0.31.1");
}

async function ensureSubmitBridge(tabId) {
  const safeTab = await chrome.tabs.get(Number(tabId));
  if (!safeTab?.id || !String(safeTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  try {
    const ping = await safeChatMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
    if (ping?.ok && ping.source === "chatgpt") return true;
  } catch {}
  const recheckedTab = await chrome.tabs.get(Number(tabId));
  if (!recheckedTab?.id || !String(recheckedTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: recheckedTab.id }, files: [CHATGPT_SUBMIT_BRIDGE] });
  const ping = await safeChatMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
  return Boolean(ping?.ok && ping.source === "chatgpt");
}

async function refreshChatGptResult(projectId) {
  const id = String(projectId || "").trim();
  if (!id) throw new Error("Projeto Lovable não informado.");

  const conversation = await activeProjectConversation(id);
  const target = await resolveChatTab(conversation);
  const tab = target?.tab;
  const lockedUrl = target?.lockedUrl || "";
  if (!tab?.id) throw new Error("A conversa vinculada do ChatGPT não está disponível.");

  const sendLocked = async (message) => {
    const current = await chrome.tabs.get(tab.id);
    if (!current?.id || !String(current.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && current.url !== lockedUrl)) throw new Error("A conversa vinculada mudou durante a operação.");
    return globalThis.LovaBurstTabSafety.sendMessage(current.id, message);
  };

  try {
    const ping = await sendLocked({
      type: "LOVABURST_SCAN_RESULT_MARKERS",
      projectId: id,
    });
    return ping || { ok: true };
  } catch {
    const safeTab = await chrome.tabs.get(tab.id);
    if (!safeTab?.id || !String(safeTab.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && safeTab.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes da injeção.");
    await globalThis.LovaBurstTabSafety.executeScript({
      target: { tabId: safeTab.id },
      files: ["src/content/chatgpt-result-refresh.js"],
    });
    return sendLocked({
      type: "LOVABURST_SCAN_RESULT_MARKERS",
      projectId: id,
    });
  }
}

async function forwardComposerObjective(message, sender) {
  const objective = String(message.objective || "").trim();
  const projectId = String(message.projectId || "").trim();
  if (!objective) throw new Error("Digite o que você quer alterar.");
  if (!projectId) throw new Error("Não foi possível identificar o projeto Lovable.");
  if (!sender?.tab?.id) throw new Error("A aba do Lovable não está disponível.");

  const skills = await selectedSkills(projectId);
  const response = await safeLovableMessage(sender.tab.id, projectId, {
    type: "LOVABURST_SUBMIT_OBJECTIVE",
    objective,
    skills,
  });
  if (!response?.ok) throw new Error(response?.error || "Não foi possível enviar o pedido pela LovaBurst.");
  return response;
}

async function resolveLovableSourceTab(projectId, senderTab) {
  if (senderTab?.id && senderTab.url?.startsWith("https://lovable.dev/")) return senderTab;
  const tabs = await chrome.tabs.query({ url: ["https://lovable.dev/*"] });
  return tabs.find((item) => projectIdFromLovableUrl(item.url) === projectId) || null;
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function enhanceComposerPrompt(message, sender) {
  const text = String(message.text || "").trim();
  const projectId = String(message.projectId || "").trim();
  if (!text) throw new Error("Digite um pedido antes de usar o Boost.");
  if (!projectId) throw new Error("Não foi possível identificar o projeto Lovable.");
  const config = (await globalThis.LovaBurstStorage.get("config")).config || {};
  if (config.enabled === false || config.chatgptEnabled === false) throw new Error("A integração com o ChatGPT está desativada na LovaBurst.");

  const conversation = await activeProjectConversation(projectId);
  const target = await resolveChatTab(conversation);
  const tab = target?.tab;
  const lockedUrl = target?.lockedUrl || "";
  if (!tab?.id) throw new Error("Conecte uma conversa do ChatGPT a este projeto antes de usar o Boost.");

  const skills = await selectedSkills(projectId);
  const sourceTab = await resolveLovableSourceTab(projectId, sender?.tab || null);
  const chatWasActive = Boolean(tab.active);
  const sendLocked = async (payload) => {
    const current = await chrome.tabs.get(tab.id);
    if (!current?.id || !String(current.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && current.url !== lockedUrl)) throw new Error("A conversa vinculada mudou durante o aprimoramento.");
    return globalThis.LovaBurstTabSafety.sendMessage(current.id, payload);
  };

  try {
    if (!chatWasActive) {
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
    const beforeBridge = await chrome.tabs.get(tab.id);
    if (!beforeBridge?.id || !String(beforeBridge.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && beforeBridge.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes da injeção.");
    if (!(await ensureSubmitBridge(tab.id))) throw new Error("A ponte de envio do ChatGPT não respondeu.");
    const beforeEnhanceBridge = await chrome.tabs.get(tab.id);
    if (!beforeEnhanceBridge?.id || !String(beforeEnhanceBridge.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && beforeEnhanceBridge.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes da injeção.");
    if (!(await ensureEnhanceBridge(tab.id))) throw new Error("A ponte de aprimoramento do ChatGPT não respondeu.");

    const snapshot = await sendLocked({ type: "LOVABURST_ENHANCE_SNAPSHOT" });
    if (!snapshot?.ok || !snapshot.baseline) throw new Error("Não foi possível iniciar a verificação do prompt aprimorado.");

    const authorized = await globalThis.LovaBurstLicense?.dispatchOperation?.("enhance", { text, lovableProjectId: projectId, repository: String(message.repository || ""), title: String(message.title || sender?.tab?.title || ""), skills });
    if (!authorized?.prompt) throw new Error("O servidor não liberou o aprimoramento.");
    const dispatched = await sendLocked({ type: "LOVABURST_SUBMIT_TO_CHATGPT", prompt: authorized.prompt, expectedUrl: lockedUrl || tab.url || "" });
    if (!dispatched?.ok) throw new Error(dispatched?.error || "O ChatGPT não confirmou o envio do pedido de aprimoramento.");

    const response = await withTimeout(
      sendLocked({ type: "LOVABURST_ENHANCE_WAIT_FOR_RESPONSE", baseline: snapshot.baseline, timeoutMs: ENHANCE_TIMEOUT_MS }),
      ENHANCE_TIMEOUT_MS + 5000,
      "O ChatGPT demorou demais para devolver o prompt aprimorado.",
    );
    const enhanced = String(response?.text || "").trim();
    if (!response?.ok || !enhanced) throw new Error(response?.error || "O ChatGPT não devolveu um prompt aprimorado.");
    if (enhanced === text) throw new Error("O ChatGPT devolveu o mesmo texto sem aprimoramento. Tente novamente.");
    return { ok: true, text: enhanced };
  } finally {
    if (!chatWasActive && sourceTab?.id && sourceTab.url?.startsWith("https://lovable.dev/")) {
      await chrome.tabs.update(sourceTab.id, { active: true }).catch(() => {});
    }
  }
}

globalThis.LovaBurstMessageGate.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "LOVABURST_COMPOSER_SUBMIT") {
    forwardComposerObjective(message, sender)
      .then((response) => sendResponse({ ok: true, ...response }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_ENHANCE_PROMPT") {
    enhanceComposerPrompt(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.type === "LOVABURST_REFRESH_CHATGPT_RESULT") {
    refreshChatGptResult(message.projectId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return false;
});
