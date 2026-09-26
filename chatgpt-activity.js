(() => {
  if (window.__LOVABURST_CHATGPT_ACTIVITY_V0307__) return;
  window.__LOVABURST_CHATGPT_ACTIVITY_V0307__ = true;
  window.__LOVABURST_CHATGPT_ACTIVITY__ = true;

  const KEY = "projectRunStatuses";
  const PROJECT_RE = /LOVABLE_PROJECT:\s*([A-Za-z0-9-]+)/i;
  const PROJECT_JSON_RE = /"(?:lovableProjectId|projectId)"\s*:\s*"([A-Za-z0-9-]{1,120})"/i;
  const REQUEST_MARKERS = ["[LOVABURST_SERVER_AUTHORITY_V1]", "[LOVABURST_AGENT_SERVER_V1]", "[LOVABURST_AGENT_GITHUB_V1]", "[LOVABURST_AGENT_DIRECT_V1]", "[LOVABURST_AGENT_STEP_V1]", "[LOVABURST_REQUEST_V7]", "[LOVABURST_REQUEST_V6]", "[LOVABURST_REQUEST_V5]", "[LOVABURST_REQUEST_V4]", "[LOVABURST_REQUEST_V3]", "[LOVABURST_REQUEST_V2]", "[LOVABURST_REQUEST_V1]"];
  const isLovaBurstRequest = (text) => REQUEST_MARKERS.some((marker) => String(text || "").includes(marker));
  const ACTION_RE = /^(implementando|analisando|validando|verificando|lendo|pesquisando|atualizando|criando|editando|preparando|processando|reviewing|implementing|analyzing|analysing|validating|checking|reading|searching|updating|creating|editing|preparing|processing)\b/i;
  const SECRET_RE = /(service[_ -]?role|database password|access token|refresh token|private key|secret key|bearer\s+[a-z0-9._-]+)/i;

  let timer = null;
  let observer = null;
  let stopped = false;
  let lastSignature = "";

  function contextAvailable() {
    if (stopped) return false;
    try {
      return Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local);
    } catch {
      return false;
    }
  }

  function stopAfterContextInvalidation() {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
  }

  function runtimeFailed() {
    try {
      const message = String(globalThis.chrome?.runtime?.lastError?.message || "").toLowerCase();
      if (message.includes("extension context invalidated") || message.includes("context invalidated")) {
        stopAfterContextInvalidation();
        return true;
      }
      return Boolean(message);
    } catch {
      stopAfterContextInvalidation();
      return true;
    }
  }

  function safeStorageGet(key, callback) {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return;
    }
    try {
      globalThis.LovaBurstStorage.get(key, (stored) => {
        if (runtimeFailed() || !contextAvailable()) return;
        callback(stored || {});
      });
    } catch {
      stopAfterContextInvalidation();
    }
  }

  function safeStorageSet(value) {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return;
    }
    try {
      globalThis.LovaBurstStorage.set(value, () => {
        runtimeFailed();
      });
    } catch {
      stopAfterContextInvalidation();
    }
  }

  function visible(el) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 4 && rect.height > 4;
  }

  function latestProjectId() {
    const users = [...document.querySelectorAll('[data-message-author-role="user"]')].reverse();
    for (const el of users) {
      const text = String(el.innerText || el.textContent || "");
      if (!isLovaBurstRequest(text)) continue;
      const id = text.match(PROJECT_JSON_RE)?.[1] || text.match(PROJECT_RE)?.[1] || "";
      if (id) return id;
    }
    return "";
  }

  function hasFinalMarker(projectId, completionToken) {
    const messages = [...document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]')];
    let requestIndex = -1;
    for (let index = 0; index < messages.length; index += 1) {
      const element = messages[index];
      if (element.getAttribute("data-message-author-role") !== "user") continue;
      const text = String(element.innerText || element.textContent || "");
      const id = text.match(PROJECT_JSON_RE)?.[1] || text.match(PROJECT_RE)?.[1] || "";
      if (isLovaBurstRequest(text) && id === projectId) requestIndex = index;
    }
    if (requestIndex < 0) return false;
    return messages.slice(requestIndex + 1).some((element) => {
      if (element.getAttribute("data-message-author-role") !== "assistant") return false;
      const text = String(element.innerText || element.textContent || "");
      const token = String(completionToken || "").toLowerCase();
      return /^[a-f0-9]{64}$/.test(token) && new RegExp(`\\[LOVABURST_(?:DONE|BLOCKED|ERROR):${token}\\]`, "i").test(text);
    });
  }

  function clean(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length < 5 || text.length > 220 || SECRET_RE.test(text) || !ACTION_RE.test(text)) return "";
    return text.slice(0, 180);
  }

  function findActivity() {
    const preferred = [...document.querySelectorAll('[role="status"],[aria-live="polite"],[aria-live="assertive"]')].reverse();
    for (const el of preferred) {
      if (!visible(el) || el.closest('[data-message-author-role]') || el.closest("form")) continue;
      const text = clean(el.innerText || el.textContent);
      if (text) return text;
    }

    const candidates = [...document.querySelectorAll("main span, main p, main div")].reverse();
    let checked = 0;
    for (const el of candidates) {
      if (checked++ > 500) break;
      if (!visible(el) || el.children.length > 2 || el.closest('[data-message-author-role]') || el.closest("form")) continue;
      const text = clean(el.innerText || el.textContent);
      if (text) return text;
    }
    return "";
  }

  function scan() {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return;
    }

    const projectId = latestProjectId();
    if (!projectId) return;
    const activityText = findActivity();
    if (!activityText) return;

    safeStorageGet(KEY, (stored) => {
      const statuses = stored[KEY] || {};
      const previous = statuses[projectId] || {};
      if (hasFinalMarker(projectId, previous.completionToken)) return;
      if (!["sending", "working"].includes(String(previous.status || ""))) return;

      const signature = `${projectId}|${activityText}|${previous.status}`;
      if (signature === lastSignature || previous.activityText === activityText) return;
      lastSignature = signature;

      safeStorageSet({
        [KEY]: {
          ...statuses,
          [projectId]: {
            ...previous,
            projectId,
            activityText,
            activitySource: "chatgpt-visible-status",
            activityUpdatedAt: new Date().toISOString(),
          },
        },
      });
    });
  }

  function schedule() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, 260);
  }

  function start() {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return;
    }
    const root = document.body || document.documentElement;
    if (!root) {
      timer = setTimeout(start, 250);
      return;
    }
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    schedule();
  }

  start();
})();
