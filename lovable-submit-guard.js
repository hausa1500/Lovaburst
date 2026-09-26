(() => {
  if (globalThis.__LOVABURST_EARLY_SUBMIT_GUARD__) return;
  globalThis.__LOVABURST_EARLY_SUBMIT_GUARD__ = true;

  const MODE_KEY = "lovaburstComposerModes";
  const COMPOSER_SELECTORS = [
    "textarea[data-testid*='prompt' i]",
    "textarea[data-testid*='chat' i]",
    "textarea[placeholder*='Ask' i]",
    "textarea[placeholder*='message' i]",
    "textarea[placeholder*='mensagem' i]",
    "textarea[placeholder*='Lovable' i]",
    "[contenteditable='true'][data-testid*='prompt' i]",
    "[contenteditable='true'][data-testid*='chat' i]",
    "[contenteditable='true'][aria-label*='Ask' i]",
    "[contenteditable='true'][aria-label*='message' i]",
    "[contenteditable='true'][aria-label*='mensagem' i]",
    "[contenteditable='true'][role='textbox']",
  ];

  let globalEnabled = true;
  let modes = {};
  let lastDispatchAt = 0;
  let preserveLineBreakUntil = 0;

  function projectId() {
    return location.pathname.match(/\/projects\/([A-Za-z0-9-]+)/i)?.[1] || "";
  }

  function active() {
    const id = projectId();
    return Boolean(id && globalEnabled && modes?.[id] !== false);
  }

  function block(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function elementFromTarget(target) {
    if (target instanceof Element) return target;
    return target?.parentElement instanceof Element ? target.parentElement : null;
  }

  function hintText(element) {
    if (!(element instanceof Element)) return "";
    return [
      element.getAttribute("placeholder"),
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("name"),
      element.getAttribute("id"),
      typeof element.className === "string" ? element.className : "",
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function looksLikeComposer(element) {
    if (!(element instanceof Element)) return false;
    if (!COMPOSER_SELECTORS.some((selector) => element.matches?.(selector))) return false;
    const hints = hintText(element);
    return !/search|buscar|filter|filtro|rename|renomear|comment|coment[aá]rio/.test(hints);
  }

  function composerFromTarget(target) {
    const element = elementFromTarget(target);
    if (!element) return null;
    if (looksLikeComposer(element)) return element;
    const editable = element.closest?.("textarea,[contenteditable='true'],[role='textbox']");
    return looksLikeComposer(editable) ? editable : null;
  }

  function findComposerIn(container) {
    if (!(container instanceof Element || container instanceof Document)) return null;
    for (const selector of COMPOSER_SELECTORS) {
      for (const candidate of container.querySelectorAll(selector)) {
        if (looksLikeComposer(candidate)) return candidate;
      }
    }
    return null;
  }

  function buttonFromEvent(event) {
    for (const item of event.composedPath?.() || []) {
      if (item instanceof Element && item.matches?.("button,[role='button']")) return item;
    }
    return elementFromTarget(event.target)?.closest?.("button,[role='button']") || null;
  }

  function buttonLooksLikeSubmit(button) {
    if (!(button instanceof Element)) return false;
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.getAttribute("data-testid"),
      button.getAttribute("name"),
      button.textContent,
    ].filter(Boolean).join(" ").toLowerCase();
    if (/microphone|\bmic\b|voice|voz|audio|áudio|attach|anex|upload|paperclip|\bplus\b|adicionar|\badd\b|mode|modo|settings|config|image|imagem|camera|câmera/.test(label)) return false;
    return button.getAttribute("type") === "submit" || /send|enviar|submit|arrow.?up|seta.?cima/.test(label) || /send|submit/.test(button.getAttribute("data-testid") || "");
  }

  function composerForButton(button) {
    if (!(button instanceof Element)) return null;
    const form = button.closest("form");
    if (form) {
      const composer = findComposerIn(form);
      if (composer) return composer;
    }
    let node = button.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const composer = findComposerIn(node);
      if (composer) return composer;
    }
    return null;
  }

  function readComposer(composer) {
    if (!composer) return "";
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) return String(composer.value || "").trim();
    return String(composer.innerText || composer.textContent || "").trim();
  }

  function dispatchGuardedSubmit(source, composer) {
    const now = Date.now();
    if (now - lastDispatchAt < 850) return;
    lastDispatchAt = now;
    const detail = {
      source: String(source || "guard"),
      text: readComposer(composer).slice(0, 25000),
      projectId: projectId(),
      at: now,
    };
    try {
      globalThis.__LOVABURST_GUARD_ROUTE__?.(detail);
    } catch {}
  }

  function interceptKeydown(event) {
    if (!active() || event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    const composer = composerFromTarget(event.target);
    if (!composer) return;
    if (event.shiftKey) {
      // Preserve the user's intentional newline. Browsers commonly emit a
      // beforeinput(insertLineBreak) immediately after Shift+Enter. Without
      // this short guard that follow-up event would be mistaken for Send.
      preserveLineBreakUntil = Date.now() + 350;
      return;
    }
    block(event);
    dispatchGuardedSubmit("keydown", composer);
  }

  function interceptBeforeInput(event) {
    if (!active() || !["insertParagraph", "insertLineBreak"].includes(String(event.inputType || ""))) return;
    const composer = composerFromTarget(event.target);
    if (!composer) return;
    if (Date.now() <= preserveLineBreakUntil) {
      preserveLineBreakUntil = 0;
      return;
    }
    block(event);
    dispatchGuardedSubmit("beforeinput", composer);
  }

  function interceptPointerLike(event) {
    if (!active()) return;
    const button = buttonFromEvent(event);
    if (!button || !buttonLooksLikeSubmit(button)) return;
    const composer = composerForButton(button);
    if (!composer) return;
    block(event);
    dispatchGuardedSubmit(event.type, composer);
  }

  function interceptSubmit(event) {
    if (!active()) return;
    const form = elementFromTarget(event.target);
    if (!(form instanceof HTMLFormElement)) return;
    const composer = findComposerIn(form);
    if (!composer) return;
    block(event);
    dispatchGuardedSubmit("submit", composer);
  }

  async function refreshState() {
    try {
      const stored = await chrome.storage.local.get([MODE_KEY, "config"]);
      globalEnabled = stored.config?.enabled !== false;
      modes = stored[MODE_KEY] || {};
    } catch {
      globalEnabled = true;
      modes = {};
    }
  }

  void refreshState();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.config) globalEnabled = changes.config.newValue?.enabled !== false;
    if (changes[MODE_KEY]) modes = changes[MODE_KEY].newValue || {};
  });

  window.addEventListener("keydown", interceptKeydown, true);
  window.addEventListener("beforeinput", interceptBeforeInput, true);
  window.addEventListener("pointerdown", interceptPointerLike, { capture: true, passive: false });
  window.addEventListener("mousedown", interceptPointerLike, true);
  window.addEventListener("touchstart", interceptPointerLike, { capture: true, passive: false });
  window.addEventListener("click", interceptPointerLike, true);
  window.addEventListener("submit", interceptSubmit, true);
})();
