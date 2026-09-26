const SKILL_IDS = new Set([
  "interface-premium",
  "git-safe",
  "tests-regression",
  "responsive",
  "performance",
  "security-review",
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ATTACHMENT_BRIDGE_VERSION = "0.32.4";
const MAX_FILES = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(["txt","md","csv","json","js","jsx","ts","tsx","css","py"]);
const BINARY_MIME = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"], ["pdf", "application/pdf"],
]);

function extension(name) { return String(name || "").toLowerCase().match(/\.([a-z0-9]{1,10})$/)?.[1] || ""; }
function safeName(name) {
  const value = String(name || "").trim();
  return value.length > 0 && value.length <= 180 && !/[\\/\u0000-\u001f\u007f]/.test(value) ? value : "";
}
function exactDecodedSize(base64) {
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return -1;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}
function decodePrefix(base64, maxBytes = 64) {
  const chars = Math.min(base64.length, Math.ceil(maxBytes / 3) * 4);
  const slice = base64.slice(0, chars - (chars % 4));
  const raw = atob(slice);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function starts(bytes, expected) { return expected.every((value, index) => bytes[index] === value); }
function validMagic(ext, bytes) {
  if (ext === "png") return starts(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  if (ext === "jpg" || ext === "jpeg") return starts(bytes, [0xff,0xd8,0xff]);
  if (ext === "pdf") return starts(bytes, [0x25,0x50,0x44,0x46,0x2d]);
  if (ext === "webp") return starts(bytes, [0x52,0x49,0x46,0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return true;
}
function validTextSample(bytes) {
  let controls = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) controls += 1;
  }
  return controls <= Math.max(2, Math.floor(bytes.length * 0.01));
}
function validateAttachment(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Anexo inválido.");
  const name = safeName(raw.name);
  if (!name) throw new Error("Nome de anexo inválido.");
  const ext = extension(name);
  const type = String(raw.type || "").toLowerCase().trim();
  const size = Number(raw.size);
  const base64 = String(raw.base64 || "");
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) throw new Error(`${name} excede o limite seguro de 8 MB.`);
  if (base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8) throw new Error(`${name} excede o limite de transporte.`);
  const decodedSize = exactDecodedSize(base64);
  if (decodedSize !== size) throw new Error(`${name} possui tamanho inconsistente.`);
  const prefix = decodePrefix(base64, 4096);
  if (BINARY_MIME.has(ext)) {
    if (type && type !== BINARY_MIME.get(ext)) throw new Error(`${name} possui MIME incompatível.`);
    if (!validMagic(ext, prefix)) throw new Error(`${name} não corresponde ao tipo declarado.`);
    if (ext === "webp") {
      const riffSize = prefix.length >= 8 ? (prefix[4] | (prefix[5] << 8) | (prefix[6] << 16) | (prefix[7] << 24)) >>> 0 : 0;
      if (riffSize + 8 !== size) throw new Error(`${name} possui container WebP inconsistente.`);
    }
    if (ext === "pdf") {
      const binary = atob(base64);
      const probe = binary.slice(0, Math.min(binary.length, 2_000_000));
      if (/\/(?:JavaScript|JS|OpenAction|Launch|EmbeddedFile)\b/i.test(probe)) throw new Error(`${name} contém ações ativas não permitidas em PDF.`);
    }
  } else if (TEXT_EXTENSIONS.has(ext)) {
    if (type && !/^(?:text\/|application\/(?:json|javascript|x-javascript|xml)$)/i.test(type)) throw new Error(`${name} possui MIME incompatível.`);
    if (!validTextSample(prefix)) throw new Error(`${name} não parece ser um arquivo de texto válido.`);
  } else {
    throw new Error(`${name} usa uma extensão não permitida.`);
  }
  return { name, type: type || BINARY_MIME.get(ext) || "text/plain", size, base64 };
}
function validateAttachments(input) {
  if (!Array.isArray(input) || input.length > MAX_FILES) throw new Error(`Limite de ${MAX_FILES} anexos por envio.`);
  let total = 0;
  const out = input.map((item) => {
    const attachment = validateAttachment(item);
    total += attachment.size;
    if (total > MAX_TOTAL_BYTES) throw new Error("Os anexos excedem o limite seguro total de 20 MB.");
    return attachment;
  });
  return out;
}
function cleanProjectId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9-]{1,120}$/.test(id) ? id : "";
}
function cleanRepository(value) {
  const repo = String(value || "").trim();
  return /^[A-Za-z0-9_.-]{2,100}\/[A-Za-z0-9_.-]{2,100}$/.test(repo) ? repo : "";
}
async function safeChatMessage(tabId, message) {
  const tab = await chrome.tabs.get(Number(tabId));
  if (!tab?.id || !String(tab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  return globalThis.LovaBurstTabSafety.sendMessage(tab.id, message);
}

async function status(projectId, patch) {
  if (!projectId) return;
  const stored = await globalThis.LovaBurstStorage.get("projectRunStatuses");
  const all = stored.projectRunStatuses || {};
  await globalThis.LovaBurstStorage.set({
    projectRunStatuses: {
      ...all,
      [projectId]: { ...(all[projectId] || {}), ...patch, projectId, updatedAt: new Date().toISOString() },
    },
  });
}

async function skills(projectId) {
  const stored = await globalThis.LovaBurstStorage.get("projectSkillSelections");
  const ids = stored.projectSkillSelections?.[projectId] || [];
  return Array.isArray(ids) ? ids.filter((id) => SKILL_IDS.has(id)).slice(0, 8) : [];
}

async function chat(projectId) {
  const stored = await globalThis.LovaBurstStorage.get("projectChatBindings");
  const record = stored.projectChatBindings?.[projectId];
  const conversation = record?.conversations?.find((item) => item.id === record.activeConversationId);
  if (!conversation) throw new Error("Conecte uma conversa do ChatGPT antes de enviar.");
  if (conversation.tabId) {
    try {
      const tab = await chrome.tabs.get(conversation.tabId);
      const lockedUrl = String(conversation.lockedUrl || conversation.url || "").trim();
      if (tab?.url?.startsWith("https://chatgpt.com/") && (!lockedUrl || tab.url === lockedUrl)) return { tab, lockedUrl };
    } catch {}
  }
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  const lockedUrl = String(conversation.lockedUrl || conversation.url || "").trim();
  const exact = tabs.find((tab) => lockedUrl && tab.url === lockedUrl);
  if (exact) return { tab: exact, lockedUrl };
  throw new Error("A conversa vinculada do ChatGPT não está disponível.");
}

async function ensureBridges(tabId) {
  try {
    const ping = await safeChatMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
    if (!ping?.ok) throw new Error("bridge ausente");
  } catch {
    const bridgeTab = await chrome.tabs.get(Number(tabId));
    if (!bridgeTab?.id || !String(bridgeTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
    await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: bridgeTab.id }, files: ["src/content/chatgpt.js"] });
  }

  try {
    const ping = await safeChatMessage(tabId, { type: "LOVABURST_ATTACHMENTS_PING" });
    if (ping?.ok && ping.version === ATTACHMENT_BRIDGE_VERSION) return;
  } catch {}

  const attachmentTab = await chrome.tabs.get(Number(tabId));
  if (!attachmentTab?.id || !String(attachmentTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
  await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: attachmentTab.id }, files: ["src/content/chatgpt-attachments.js"] });
  const ping = await safeChatMessage(tabId, { type: "LOVABURST_ATTACHMENTS_PING" });
  if (!ping?.ok || ping.version !== ATTACHMENT_BRIDGE_VERSION) throw new Error("A ponte de anexos atual da LovaBurst não respondeu no ChatGPT.");
}

async function submit(message, sender) {
  const text = String(message.text || "").trim().slice(0, 25_000);
  const attachments = validateAttachments(Array.isArray(message.attachments) ? message.attachments : []);
  const projectId = cleanProjectId(message.projectId);
  if (!text && !attachments.length) throw new Error("Digite uma mensagem ou adicione um anexo.");
  if (!projectId) throw new Error("Não foi possível identificar o projeto Lovable.");

  const stored = await globalThis.LovaBurstStorage.get(["workspaceBindings", "config"]);
  if (stored.config?.enabled === false || stored.config?.chatgptEnabled === false) throw new Error("A integração com o ChatGPT está desativada.");

  const repository = cleanRepository(message.repository || stored.workspaceBindings?.[projectId]?.repository || "");
  const payload = {
    text,
    url: String(sender?.tab?.url || message.url || "").slice(0, 2000),
    title: String(sender?.tab?.title || message.title || "").slice(0, 300),
    capturedAt: new Date().toISOString(),
    repository,
    repositoryDetectionSource: "attachment-flow",
    lovableProjectId: projectId,
    skills: await skills(projectId),
  };

  let completionToken = "";
  const chatTarget = await chat(projectId);
  const tab = chatTarget.tab;
  const lockedUrl = chatTarget.lockedUrl || "";
  const source = sender?.tab?.id ? await chrome.tabs.get(sender.tab.id).catch(() => null) : null;
  const wasActive = Boolean(tab.active);

  await status(projectId, { status: "sending", marker: "", completionToken: "", objective: (text || attachments.map((attachment) => attachment.name).join(", ")).slice(0, 700), startedAt: payload.capturedAt, error: "" });

  try {
    if (!wasActive) { await chrome.tabs.update(tab.id, { active: true }); await sleep(220); }
    await ensureBridges(tab.id);
    const beforeAttachments = await chrome.tabs.get(tab.id);
    if (!beforeAttachments?.id || !String(beforeAttachments.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && beforeAttachments.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes do envio dos anexos.");
    const prepared = await globalThis.LovaBurstTabSafety.sendMessage(beforeAttachments.id, { type: "LOVABURST_PREPARE_ATTACHMENTS", attachments });
    if (!prepared?.ok || Number(prepared.count || 0) !== attachments.length) throw new Error(prepared?.error || `Não foi possível anexar ${attachments[0]?.name || "o arquivo"} ao ChatGPT. A mensagem não foi enviada.`);
    const beforePrompt = await chrome.tabs.get(tab.id);
    if (!beforePrompt?.id || !String(beforePrompt.url || "").startsWith("https://chatgpt.com/") || (lockedUrl && beforePrompt.url !== lockedUrl)) throw new Error("A conversa vinculada mudou antes do envio do prompt.");
    const authorizedOperation = await globalThis.LovaBurstLicense?.dispatchOperation?.("main", payload);
    if (!authorizedOperation?.prompt) throw new Error("O servidor não liberou o conteúdo protegido.");
    completionToken = globalThis.LovaBurstCompletion?.tokenFromPrepared?.(authorizedOperation) || "";
    if (!completionToken) throw new Error("O servidor não forneceu token de conclusão válido.");
    await status(projectId, { completionToken });
    const executionPrompt = globalThis.LovaBurstExecutionPolicy?.applyMainPrompt?.(authorizedOperation.prompt, {
      repository: payload.repository,
      projectId,
    }) || authorizedOperation.prompt;
    const dispatched = await globalThis.LovaBurstTabSafety.sendMessage(beforePrompt.id, { type: "LOVABURST_SUBMIT_TO_CHATGPT", prompt: executionPrompt, expectedUrl: lockedUrl || beforePrompt.url || "" });
    if (!dispatched?.ok) throw new Error(dispatched?.error || "O ChatGPT não confirmou o envio da mensagem.");
    await status(projectId, { status: "working", dispatchedAt: new Date().toISOString(), chatgptTabId: tab.id, completionToken, error: "" });
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await status(projectId, { status: "error", marker: "[LOVABURST_ERROR]", error: detail, completedAt: new Date().toISOString() });
    throw error;
  } finally {
    if (!wasActive && source?.id && source.id !== tab.id && String(source.url || "").startsWith("https://lovable.dev/")) await chrome.tabs.update(source.id, { active: true }).catch(() => {});
  }
}

globalThis.LovaBurstMessageGate.addListener((message, sender, sendResponse) => {
  if (message?.type !== "LOVABURST_SUBMIT_WITH_ATTACHMENTS") return false;
  submit(message, sender).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});
