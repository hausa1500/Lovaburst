(() => {
  if (globalThis.__LOVABURST_COMPOSER_CORE__) return;

  const MODE_KEY = "lovaburstComposerModes";
  const RUN_KEY = "projectRunStatuses";
  const selectors = [
    "textarea[data-testid*='prompt' i]", "textarea[data-testid*='chat' i]",
    "textarea[placeholder*='Ask' i]", "textarea[placeholder*='message' i]",
    "textarea[placeholder*='mensagem' i]", "textarea[placeholder*='Lovable' i]",
    "[contenteditable='true'][data-testid*='prompt' i]",
    "[contenteditable='true'][data-testid*='chat' i]",
    "[contenteditable='true'][aria-label*='Ask' i]",
    "[contenteditable='true'][aria-label*='message' i]",
    "[contenteditable='true'][aria-label*='mensagem' i]",
    "[contenteditable='true'][role='textbox']",
  ];
  const state = {
    composer: null, host: null, projectId: "", projectEnabled: true, globalEnabled: true, repository: "",
  };

  function visible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  }

  function hints(element) {
    return [element.getAttribute("placeholder"), element.getAttribute("aria-label"), element.getAttribute("data-testid"), element.getAttribute("name"), element.getAttribute("id"), element.className]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function score(element) {
    if (!visible(element)) return -Infinity;
    const rect = element.getBoundingClientRect();
    if (rect.width < 160 || rect.height < 28) return -Infinity;
    const text = hints(element);
    if (/search|buscar|filter|filtro|rename|renomear|comment|coment[aá]rio/.test(text)) return -Infinity;
    let value = 0;
    if (/prompt|ask|message|mensagem|chat|lovable/.test(text)) value += 80;
    if (element.matches("textarea")) value += 22;
    if (element.getAttribute("contenteditable") === "true") value += 18;
    if (element.getAttribute("role") === "textbox") value += 10;
    if (element.closest("form")) value += 28;
    if (rect.width > 360) value += 20;
    if (rect.height > 50) value += 12;
    value += Math.min(35, Math.max(0, rect.bottom / Math.max(innerHeight, 1) * 35));
    return value;
  }

  function findComposer() {
    const candidates = new Set();
    for (const selector of selectors) for (const element of document.querySelectorAll(selector)) candidates.add(element);
    return [...candidates].map((element) => ({ element, score: score(element) }))
      .filter((entry) => Number.isFinite(entry.score)).sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function findHost(input) {
    if (!input) return null;
    const form = input.closest("form");
    if (form && visible(form)) return form;
    let node = input.parentElement;
    for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= input.getBoundingClientRect().width && node.querySelectorAll("button,[role='button']").length > 0 && rect.height < 420) return node;
    }
    return input.parentElement;
  }

  function scan() {
    const input = findComposer();
    state.composer = input;
    state.host = input ? findHost(input) : null;
    return input;
  }

  function read() {
    const input = state.composer;
    if (!input) return "";
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return input.value.trim();
    return (input.innerText || input.textContent || "").trim();
  }

  function write(text) {
    const input = state.composer;
    if (!input?.isConnected) return;
    input.focus();
    if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(input, text); else input.value = text;
    } else {
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection?.removeAllRanges(); selection?.addRange(range);
      try {
        document.execCommand("delete", false);
        if (text && !document.execCommand("insertText", false, text)) input.textContent = text;
        if (!text) input.textContent = "";
      } catch { input.textContent = text; }
    }
    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: text ? "insertText" : "deleteContentBackward", data: text || null }));
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  async function loadMode() {
    state.projectId = location.pathname.match(/\/projects\/([A-Za-z0-9-]+)/i)?.[1] || "";
    const stored = await globalThis.LovaBurstStorage.get([MODE_KEY, "config", "workspaceBindings"]);
    state.globalEnabled = stored.config?.enabled !== false;
    state.projectEnabled = state.projectId ? stored[MODE_KEY]?.[state.projectId] !== false : false;
    state.repository = state.projectId ? String(stored.workspaceBindings?.[state.projectId]?.repository || "") : "";
    return state;
  }

  async function setMode(enabled) {
    if (!state.projectId) return;
    const stored = await globalThis.LovaBurstStorage.get(MODE_KEY);
    await globalThis.LovaBurstStorage.set({ [MODE_KEY]: { ...(stored[MODE_KEY] || {}), [state.projectId]: Boolean(enabled) } });
    state.projectEnabled = Boolean(enabled);
  }

  function active() { return Boolean(state.projectId && state.globalEnabled && state.projectEnabled); }
  function repository() {
    return state.repository || "";
  }
  async function runStatus() {
    if (!state.projectId) return null;
    const stored = await globalThis.LovaBurstStorage.get(RUN_KEY);
    return stored[RUN_KEY]?.[state.projectId] || null;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.workspaceBindings || !state.projectId) return;
    state.repository = String(changes.workspaceBindings.newValue?.[state.projectId]?.repository || "");
  });

  globalThis.__LOVABURST_COMPOSER_CORE__ = { MODE_KEY, RUN_KEY, state, visible, scan, read, write, loadMode, setMode, active, repository, runStatus };
})();
