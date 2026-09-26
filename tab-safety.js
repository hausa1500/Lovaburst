/* LovaBurst explicit tab-origin guard. Never monkey-patches Chrome native APIs. */
(() => {
  if (globalThis.LovaBurstTabSafety) return;
  if (!chrome?.tabs?.sendMessage || !chrome?.scripting?.executeScript) return;
  const rawSend = chrome.tabs.sendMessage.bind(chrome.tabs);
  const rawExecute = chrome.scripting.executeScript.bind(chrome.scripting);
  const ALLOWED = new Set(["https://chatgpt.com", "https://lovable.dev"]);
  const projectId = (raw) => { try { const u = new URL(String(raw || "")); return u.origin === "https://lovable.dev" ? (u.pathname.match(/\/projects\/([A-Za-z0-9-]{1,120})(?:\/|$)/i)?.[1] || "") : ""; } catch { return ""; } };
  async function assertAllowedTab(tabId) {
    const current = await chrome.tabs.get(Number(tabId));
    if (!current?.id) throw new Error("Aba inválida.");
    let url; try { url = new URL(String(current.url || "")); } catch { throw new Error("URL da aba inválida."); }
    if (!ALLOWED.has(url.origin)) throw new Error("Origem da aba não autorizada.");
    return current;
  }
  async function sendMessage(tabId, message, ...rest) {
    const options = rest[0];
    if (options && Number.isInteger(options.frameId) && options.frameId !== 0) throw new Error("Envio para iframe bloqueado.");
    const current = await assertAllowedTab(tabId);
    const expected = String(message?.expectedUrl || "").trim();
    if (expected && current.url !== expected) throw new Error("A conversa mudou antes do envio.");
    const claimed = String(message?.projectId || message?.lovableProjectId || "").trim();
    if (claimed && String(current.url || "").startsWith("https://lovable.dev/")) {
      const actual = projectId(current.url);
      if (!actual || actual !== claimed) throw new Error("Projeto da aba divergente.");
    }
    return rawSend(current.id, message, ...rest);
  }
  async function executeScript(injection) {
    if (injection?.target?.allFrames === true) throw new Error("Injeção em múltiplos frames bloqueada.");
    if (Array.isArray(injection?.target?.frameIds) && injection.target.frameIds.some((id) => Number(id) !== 0)) throw new Error("Injeção em iframe bloqueada.");
    const current = await assertAllowedTab(Number(injection?.target?.tabId));
    let files = Array.isArray(injection?.files) ? [...injection.files] : null;
    if (files?.some((f) => String(f).startsWith("src/content/"))) {
      if (!files.includes("src/content/content-message-guard.js")) files.unshift("src/content/content-message-guard.js");
      if (!files.includes("src/shared/secure-storage-client.js")) files.splice(1, 0, "src/shared/secure-storage-client.js");
    }
    if (files) {
      const isChat = files.some((f) => /\/chatgpt/i.test(String(f)));
      const isLovable = files.some((f) => /\/lovable/i.test(String(f)));
      if (isChat && !String(current.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba incompatível com o script.");
      if (isLovable && !String(current.url || "").startsWith("https://lovable.dev/")) throw new Error("Origem da aba incompatível com o script.");
    }
    return rawExecute({ ...injection, target: { ...injection.target, tabId: current.id }, ...(files ? { files } : {}) });
  }
  globalThis.LovaBurstTabSafety = Object.freeze({ assertAllowedTab, sendMessage, executeScript, projectIdFromUrl: projectId });
})();
