/* LovaBurst background message firewall — stable deny-by-default gate.
 * Security boundaries: extension id, top-level sender, allowed origin, project binding,
 * payload schema, per-tab rate limit and license authorization. No fragile page challenge.
 */
(() => {
  const originalAddListener = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
  const EXTENSION_ORIGIN = `chrome-extension://${chrome.runtime.id}`;
  const EXT = [EXTENSION_ORIGIN];
  const LOVABLE = ["https://lovable.dev"];
  const CHATGPT = ["https://chatgpt.com"];
  const EXT_LOVABLE = [...EXT, ...LOVABLE];
  const INTERNAL = [...EXT, ...LOVABLE, ...CHATGPT];
  const preflightCache = new WeakMap();
  const rateState = new Map();
  const PROJECT_RE = /^[A-Za-z0-9-]{1,120}$/;
  const REPO_RE = /^[A-Za-z0-9_.-]{2,100}\/[A-Za-z0-9_.-]{2,100}$/;

  const rules = new Map([
    ["LOVABURST_LICENSE_STATUS", { origins: EXT_LOVABLE, auth: "none", limit: 60 }],
    ["LOVABURST_LICENSE_ACTIVATE", { origins: EXT, auth: "none", limit: 20 }],
    ["LOVABURST_LICENSE_RELEASE", { origins: EXT, auth: "none", limit: 8 }],
    ["LOVABURST_GET_CONFIG", { origins: EXT, auth: "none", limit: 120 }],
    ["LOVABURST_SET_CONFIG", { origins: EXT, auth: "local", limit: 40 }],
    ["LOVABURST_LIST_CHATGPT_TABS", { origins: EXT, auth: "local", limit: 60 }],
    ["LOVABURST_GET_CHATGPT_STATUS", { origins: EXT, auth: "local", limit: 60 }],
    ["LOVABURST_LINK_CHATGPT", { origins: EXT_LOVABLE, auth: "local", projectBound: true, limit: 30 }],
    ["LOVABURST_UNLINK_CHATGPT", { origins: EXT, auth: "local", limit: 30 }],
    ["LOVABURST_OPEN_LINKED_CHATGPT", { origins: EXT, auth: "local", limit: 60 }],
    ["LOVABURST_DETECT_WORKSPACE", { origins: LOVABLE, auth: "local", projectBound: true, limit: 90 }],
    ["LOVABURST_PROMPT_CAPTURED", { origins: LOVABLE, auth: "none", projectBound: true, limit: 30 }],
    ["LOVABURST_COMPOSER_SUBMIT", { origins: LOVABLE, auth: "none", projectBound: true, limit: 30 }],
    ["LOVABURST_ENHANCE_PROMPT", { origins: EXT_LOVABLE, auth: "none", projectBound: true, limit: 30 }],
    ["LOVABURST_SUBMIT_WITH_ATTACHMENTS", { origins: EXT_LOVABLE, auth: "none", projectBound: true, limit: 20 }],
    ["LOVABURST_EXECUTE_SPECIAL_OPERATION", { origins: EXT, auth: "none", limit: 20 }],
    ["LOVABURST_REFRESH_CHATGPT_RESULT", { origins: EXT_LOVABLE, auth: "authorize", projectBound: true, limit: 60 }],
    ["LOVABURST_REFRESH_CHATGPT_RESULT_V0304", { origins: LOVABLE, auth: "authorize", projectBound: true, limit: 60 }],
    ["LOVABURST_RESULT_MARKER_DETECTED", { origins: CHATGPT, auth: "local", chatBound: true, limit: 60 }],
    ["LOVABURST_WAKE_CHATGPT_BEGIN", { origins: CHATGPT, auth: "local", limit: 60 }],
    ["LOVABURST_WAKE_CHATGPT_END", { origins: CHATGPT, auth: "local", limit: 90 }],
    ["LOVABURST_WAKE_CHATGPT_FOR_RESULT", { origins: CHATGPT, auth: "local", limit: 60 }],
    ["LOVABURST_KEEP_CHATGPT_READY", { origins: CHATGPT, auth: "local", limit: 180 }],
    ["LOVABURST_INTELLIGENCE_AGENT_START", { origins: EXT, auth: "none", limit: 20 }],
    ["LOVABURST_INTELLIGENCE_AGENT_GET", { origins: EXT, auth: "none", limit: 60 }],
    ["LOVABURST_INTELLIGENCE_AGENT_NEXT", { origins: EXT, auth: "none", limit: 20 }],
    ["LOVABURST_INTELLIGENCE_AGENT_RUN", { origins: EXT, auth: "none", limit: 20 }],
    ["LOVABURST_INTELLIGENCE_AGENT_RUNNER_STATUS", { origins: EXT, auth: "none", limit: 120 }],
    ["LOVABURST_INTELLIGENCE_AGENT_CANCEL", { origins: EXT, auth: "none", limit: 20 }],
    ["LOVABURST_PING", { origins: INTERNAL, auth: "none", limit: 240 }],
  ]);

  function senderOrigin(sender) {
    if (sender?.id !== chrome.runtime.id) return "";
    const declared = String(sender?.origin || "").trim();
    if ([EXTENSION_ORIGIN, "https://lovable.dev", "https://chatgpt.com"].includes(declared)) return declared;
    const raw = String(sender?.url || sender?.tab?.url || "").trim();
    if (raw === EXTENSION_ORIGIN || raw.startsWith(`${EXTENSION_ORIGIN}/`)) return EXTENSION_ORIGIN;
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" && ["lovable.dev", "chatgpt.com"].includes(u.hostname)) return u.origin;
      if (!sender?.tab?.id && /^(?:[a-z][a-z0-9+.-]*-extension|extension):$/i.test(u.protocol)) return EXTENSION_ORIGIN;
    } catch {}
    // Some Chromium-based Android browsers omit sender.origin/sender.url for extension popups.
    // A sender without a web tab but with our runtime id is still our own extension UI.
    if (!sender?.tab?.id && (!declared || declared === "null")) return EXTENSION_ORIGIN;
    return "";
  }

  function topLevelPageSender(origin, sender) {
    if (origin === EXTENSION_ORIGIN) return true;
    if (sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id)) return false;
    try { return new URL(String(sender?.tab?.url || "")).origin === origin; } catch { return false; }
  }

  function projectIdFromLovableUrl(raw) {
    try {
      const u = new URL(String(raw || ""));
      return u.origin === "https://lovable.dev" ? (u.pathname.match(/\/projects\/([A-Za-z0-9-]{1,120})(?:\/|$)/i)?.[1] || "") : "";
    } catch { return ""; }
  }

  function messageProjectId(message) {
    return String(message?.projectId || message?.lovableProjectId || message?.payload?.lovableProjectId || "").trim();
  }

  function validString(value, max, regex = null, allowEmpty = true) {
    if (value == null) return allowEmpty;
    if (typeof value !== "string" || value.length > max || /[\u0000\u000b\u000c\u007f]/.test(value)) return false;
    const text = value.trim();
    if (!text) return allowEmpty;
    return regex ? regex.test(text) : true;
  }

  function validSkills(value) {
    return value == null || (Array.isArray(value) && value.length <= 8 && value.every((x) => typeof x === "string" && /^[a-z0-9-]{2,40}$/i.test(x)));
  }

  function attachmentSchema(message) {
    if (!validString(message.text || "", 25_000)) return false;
    if (!validString(message.projectId, 120, PROJECT_RE, false)) return false;
    if (!validString(message.repository || "", 220, REPO_RE, true)) return false;
    const files = message.attachments;
    if (!Array.isArray(files) || files.length < 1 || files.length > 5) return false;
    let totalB64 = 0;
    for (const file of files) {
      if (!file || typeof file !== "object" || Array.isArray(file)) return false;
      if (!validString(file.name, 180, null, false) || !validString(file.type || "", 100)) return false;
      if (!Number.isSafeInteger(Number(file.size)) || Number(file.size) <= 0 || Number(file.size) > 8 * 1024 * 1024) return false;
      if (typeof file.base64 !== "string" || file.base64.length > 11_200_000) return false;
      totalB64 += file.base64.length;
      if (totalB64 > 28_100_000) return false;
    }
    return true;
  }

  function schemaAllowed(message) {
    const t = message.type;
    if (typeof t !== "string" || t.length > 80) return false;
    if (t === "LOVABURST_DETECT_WORKSPACE") {
      const p = message.payload;
      return Boolean(p && typeof p === "object" && !Array.isArray(p) &&
        validString(p.lovableProjectId, 120, PROJECT_RE, false) &&
        validString(p.domRepository || "", 220, REPO_RE, true) &&
        validString(p.url || "", 2400, null, true));
    }
    if (t === "LOVABURST_PROMPT_CAPTURED") {
      const p = message.payload;
      return Boolean(p && typeof p === "object" && !Array.isArray(p) &&
        validString(p.text, 25_000, null, false) &&
        validString(p.lovableProjectId, 120, PROJECT_RE, false) &&
        validString(p.repository || "", 220, REPO_RE, true) &&
        validSkills(p.skills));
    }
    if (t === "LOVABURST_COMPOSER_SUBMIT") return validString(message.objective, 25_000, null, false) && validString(message.projectId, 120, PROJECT_RE, false);
    if (t === "LOVABURST_ENHANCE_PROMPT") return validString(message.text, 25_000, null, false) && validString(message.projectId, 120, PROJECT_RE, false) && validString(message.repository || "", 220, REPO_RE, true) && validString(message.title || "", 300);
    if (t === "LOVABURST_SUBMIT_WITH_ATTACHMENTS") return attachmentSchema(message);
    if (["LOVABURST_REFRESH_CHATGPT_RESULT", "LOVABURST_REFRESH_CHATGPT_RESULT_V0304"].includes(t)) return validString(message.projectId, 120, PROJECT_RE, false);
    if (t === "LOVABURST_RESULT_MARKER_DETECTED") return validString(message.projectId, 120, PROJECT_RE, false) && validString(message.marker, 160, null, false) && /^[a-f0-9]{64}$/i.test(String(message.completionToken || ""));
    if (t === "LOVABURST_LICENSE_ACTIVATE") return /^LVB-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/i.test(String(message.key || ""));
    if (t === "LOVABURST_EXECUTE_SPECIAL_OPERATION") {
      if (!["create-project", "analyze-project", "bootstrap-context"].includes(String(message.operation || ""))) return false;
      try { return JSON.stringify(message.payload || {}).length <= 80_000; } catch { return false; }
    }
    if (message.projectId != null && !validString(message.projectId, 120, PROJECT_RE, false)) return false;
    try { return JSON.stringify(message).length <= 500_000; } catch { return false; }
  }

  function rateAllowed(message, sender, limit) {
    const identity = Number.isInteger(sender?.tab?.id) ? `tab:${sender.tab.id}` : `ext:${sender?.documentId || "ui"}`;
    const key = `${identity}:${message.type}`;
    const now = Date.now();
    const list = (rateState.get(key) || []).filter((ts) => ts > now - 60_000);
    if (list.length >= Math.max(1, Number(limit || 60))) { rateState.set(key, list); return false; }
    list.push(now);
    rateState.set(key, list);
    return true;
  }

  async function extensionProjectAllowed(message) {
    const claimed = messageProjectId(message);
    if (!PROJECT_RE.test(claimed)) return false;
    const tabs = await chrome.tabs.query({ url: ["https://lovable.dev/*"] });
    return tabs.some((tab) => projectIdFromLovableUrl(tab.url) === claimed);
  }

  async function chatBindingAllowed(message, sender) {
    const projectId = messageProjectId(message);
    if (!PROJECT_RE.test(projectId) || !sender?.tab?.id) return false;
    const stored = await globalThis.LovaBurstStorage.get("projectChatBindings");
    const record = stored.projectChatBindings?.[projectId];
    const conversation = record?.conversations?.find((x) => x.id === record.activeConversationId);
    if (!conversation) return false;
    const locked = String(conversation.lockedUrl || conversation.url || "").trim();
    return Number(conversation.tabId) === Number(sender.tab.id) && (!locked || locked === sender.tab.url);
  }

  async function authorize(rule, type) {
    if (rule.auth === "none") return { ok: true };
    if (rule.auth === "local") { await globalThis.LovaBurstLicense?.requireValidLicense?.(); return { ok: true }; }
    if (rule.auth === "authorize") return globalThis.LovaBurstLicense?.authorizeOperation?.(type);
    throw new Error("Operação não autorizada.");
  }

  async function preflight(message, sender, rule) {
    const origin = senderOrigin(sender);
    if (!origin || !rule.origins.includes(origin) || !topLevelPageSender(origin, sender)) throw new Error("Origem não autorizada.");
    if (!schemaAllowed(message)) throw new Error("Mensagem inválida.");
    if (!rateAllowed(message, sender, rule.limit)) throw new Error("Muitas solicitações em pouco tempo.");
    if (rule.projectBound) {
      const claimed = messageProjectId(message);
      if (origin === "https://lovable.dev") {
        const actual = projectIdFromLovableUrl(sender?.tab?.url || sender?.url || "");
        if (!actual || !claimed || actual !== claimed) throw new Error("Projeto da aba divergente.");
      } else if (origin === EXTENSION_ORIGIN && !(await extensionProjectAllowed(message))) {
        throw new Error("Projeto não está aberto no Lovable.");
      }
    }
    if (rule.chatBound && !(await chatBindingAllowed(message, sender))) throw new Error("Conversa do ChatGPT não corresponde ao projeto.");
    return authorize(rule, message.type);
  }

  function addListener(listener) {
    return originalAddListener((message, sender, sendResponse) => {
      if (!message || typeof message !== "object" || typeof message.type !== "string") return false;
      const rule = rules.get(message.type);
      if (!rule) return false;
      let promise = preflightCache.get(message);
      if (!promise) { promise = preflight(message, sender, rule); preflightCache.set(message, promise); }
      promise.then((status) => {
        if (!status?.ok) return sendResponse({ ok: false, error: "Operação não autorizada." });
        return listener(message, sender, sendResponse);
      }).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Operação não autorizada." }));
      return true;
    });
  }

  globalThis.LovaBurstMessageGate = Object.freeze({ addListener });
})();
