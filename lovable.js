(() => {
  if (window.__LOVABURST_LOVABLE_BRIDGE__) return;
  window.__LOVABURST_LOVABLE_BRIDGE__ = true;

  const SOURCE = "lovable";
  const BUTTON_ID = "lovaburst-capture-button";
  const STYLE_ID = "lovaburst-capture-style";
  const COMPOSER_SELECTORS = [
    "textarea[data-testid*='prompt']",
    "textarea[placeholder*='Ask' i]",
    "textarea[placeholder*='message' i]",
    "textarea[placeholder*='mensagem' i]",
    "textarea",
    "[contenteditable='true'][data-testid*='prompt']",
    "[contenteditable='true'][role='textbox']",
    "[contenteditable='true']",
  ];

  let composer = null;
  let observer = null;
  let scanTimer = null;
  let speechRecognition = null;

  function announceReady() {
    globalThis.LovaBurstRuntime.sendMessage({ type: "LOVABURST_PING", source: SOURCE }).catch(() => {});
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function readComposerText(element) {
    if (!element) return "";
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return element.value.trim();
    }
    return (element.innerText || element.textContent || "").trim();
  }

  function findComposer() {
    for (const selector of COMPOSER_SELECTORS) {
      const candidates = Array.from(document.querySelectorAll(selector));
      const candidate = candidates.find((element) => isVisible(element));
      if (candidate) return candidate;
    }
    return null;
  }

  function extractLovableProjectId() {
    return window.location.pathname.match(/\/projects\/([A-Za-z0-9-]+)/i)?.[1] || "";
  }

  function normalizeRepository(value) {
    const text = String(value || "").trim();
    const match = text.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
    if (!match) return "";

    const blocked = new Set([
      "settings", "marketplace", "features", "topics", "collections", "login", "signup",
      "projects", "project", "lovable", "api", "assets", "src", "public", "blob", "tree",
      "en", "docs", "terms", "privacy", "policy", "policies", "security", "support",
      "github-terms", "github-terms-of-service", "site-policy", "site-policies",
    ]);

    const owner = match[1];
    const repo = match[2];
    const ownerLower = owner.toLowerCase();
    const repoLower = repo.toLowerCase();
    if (blocked.has(ownerLower) || blocked.has(repoLower)) return "";
    if (ownerLower.startsWith("github-terms") || repoLower.startsWith("github-terms")) return "";
    if (owner.length < 2 || repo.length < 2) return "";
    return `${owner}/${repo}`;
  }

  function normalizeGithubRepository(value) {
    if (!value) return "";
    const raw = String(value).trim();

    const ssh = raw.match(/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/i);
    if (ssh) return normalizeRepository(`${ssh[1]}/${ssh[2]}`);

    let url;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      return "";
    }

    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return "";

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    return normalizeRepository(`${parts[0]}/${parts[1]}`);
  }

  function repositoryFromShortText(value) {
    const text = String(value || "").trim();
    if (!text || text.length > 220) return "";
    return normalizeGithubRepository(text) || normalizeRepository(text);
  }

  function visibleText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function detectGithubConnectionState() {
    const bodyText = visibleText(document.body?.innerText || "").slice(0, 180000);
    const disconnectedCopy =
      (bodyText.includes("connect project") && bodyText.includes("github account") && bodyText.includes("sync this project")) ||
      (bodyText.includes("conectar projeto") && bodyText.includes("github") && (bodyText.includes("sincron") || bodyText.includes("conta")));

    const headings = Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
      .filter((element) => isVisible(element))
      .map((element) => visibleText(element.textContent || ""));
    const connectHeading = headings.some((text) => text === "connect project" || text === "conectar projeto");

    if (disconnectedCopy || connectHeading) return "disconnected";

    const disconnectControl = Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter((element) => isVisible(element))
      .some((element) => /^(disconnect|desconectar)( project| projeto)?$/i.test(String(element.textContent || "").trim()));
    if (disconnectControl) return "connected";

    return "unknown";
  }

  function detectGithubRepository(connectionState = detectGithubConnectionState()) {
    if (connectionState === "disconnected") return "";
    const scored = new Map();
    const add = (value, score) => {
      const repo = repositoryFromShortText(value);
      if (!repo) return;
      scored.set(repo, Math.max(scored.get(repo) || 0, score));
    };
    const collect = (value, score) => {
      const text = String(value || "").slice(0, 220000);
      if (!text) return;
      for (const match of text.match(/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/gi) || []) add(match, score);
      for (const match of text.match(/git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/gi) || []) add(match, score);
      for (const match of text.match(/(?:repository|reposit[oó]rio|github)\s*[:\-]?\s*([A-Za-z0-9_.-]{2,100}\/[A-Za-z0-9_.-]{2,100})/gi) || []) {
        const candidate = match.match(/([A-Za-z0-9_.-]{2,100}\/[A-Za-z0-9_.-]{2,100})\s*$/)?.[1] || "";
        add(candidate, score - 10);
      }
    };

    for (const anchor of document.querySelectorAll('a[href*="github.com/"], a[href^="git@github.com:"]')) {
      const href = String(anchor.getAttribute("href") || anchor.href || "");
      const label = `${anchor.textContent || ""} ${anchor.getAttribute("aria-label") || ""} ${anchor.getAttribute("title") || ""}`.toLowerCase();
      const noise = `${href} ${label}`.toLowerCase();
      if (/github-terms|terms-of-service|privacy|site-policy|site-policies|\/docs(?:\/|$)|documentation|termos|privacidade/.test(noise)) continue;
      let score = 100;
      if (/repo|repository|repositório|github/.test(label)) score += 20;
      if (isVisible(anchor)) score += 10;
      add(href, score);
    }

    // Lovable's Git settings often renders the clone URL in a readonly input rather than an anchor.
    for (const element of document.querySelectorAll('input, textarea, code, pre, [data-testid*="github" i], [data-testid*="repo" i], [aria-label*="github" i], [aria-label*="repo" i], [title*="github" i], [title*="repo" i]')) {
      collect(element.value || element.textContent || "", 115);
      add(element.getAttribute?.("href"), 115);
      add(element.getAttribute?.("data-repository"), 120);
      add(element.getAttribute?.("data-repo"), 120);
    }

    for (const meta of document.querySelectorAll('meta[name*="github" i][content], meta[name*="repo" i][content], meta[property*="github" i][content], meta[property*="repo" i][content]')) {
      collect(meta.content, 90);
    }

    // Inspect visible text only to extract repository-shaped values. Raw page text is never persisted.
    collect(document.body?.innerText || "", 75);

    const allowedStorageKey = /^(?:github(?:repository|repo|url)?|repository|repo(?:sitory)?url|workspace(?:repository|repo))$/i;
    const scanStorage = (storage, score) => {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = String(storage.key(index) || "");
          if (!allowedStorageKey.test(key.replace(/[-_.:]/g, ""))) continue;
          const value = String(storage.getItem(key) || "");
          if (value.length > 1200) continue;
          collect(value, score);
          add(value, score);
        }
      } catch {}
    };
    scanStorage(localStorage, 105);
    scanStorage(sessionStorage, 100);

    return [...scored.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "";
  }

  async function resolveWorkspace() {
    const lovableProjectId = extractLovableProjectId();
    const githubConnectionState = detectGithubConnectionState();
    const domRepository = detectGithubRepository(githubConnectionState);
    const localSource = githubConnectionState === "disconnected" ? "lovable-git-disconnected" : domRepository ? "isolated-dom" : "none";

    try {
      const response = await globalThis.LovaBurstRuntime.sendMessage({
        type: "LOVABURST_DETECT_WORKSPACE",
        payload: {
          lovableProjectId,
          url: window.location.href,
          domRepository,
          githubConnectionState,
        },
      });

      return {
        lovableProjectId,
        repository: response?.repository || "",
        detectionSource: response?.source || localSource,
        githubConnectionState: response?.githubConnectionState || githubConnectionState,
        apiDiagnostics: [],
      };
    } catch {
      return {
        lovableProjectId,
        repository: githubConnectionState === "disconnected" ? "" : domRepository,
        detectionSource: localSource,
        githubConnectionState,
        apiDiagnostics: [],
      };
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        z-index: 2147483646;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 34px;
        padding: 0 12px;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 10px;
        background: #111318;
        color: #fff;
        box-shadow: 0 8px 28px rgba(0,0,0,.24);
        font: 600 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        cursor: pointer;
        transition: transform .15s ease, opacity .15s ease, border-color .15s ease;
      }
      #${BUTTON_ID}:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.35); }
      #${BUTTON_ID}:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      #${BUTTON_ID}[disabled] { opacity: .55; cursor: not-allowed; transform: none; }
      #${BUTTON_ID}[data-state="sent"] { border-color: rgba(126,231,135,.6); }
      #${BUTTON_ID}[data-state="error"] { border-color: rgba(255,123,114,.7); }
    `;
    document.documentElement.appendChild(style);
  }

  function positionButton(button) {
    if (!composer || !isVisible(composer)) {
      button.hidden = true;
      return;
    }

    const rect = composer.getBoundingClientRect();
    button.hidden = false;
    button.style.left = `${Math.max(8, Math.min(window.innerWidth - button.offsetWidth - 8, rect.right - button.offsetWidth))}px`;
    button.style.top = `${Math.max(8, rect.top - button.offsetHeight - 8)}px`;
  }

  function resetButton(button) {
    button.dataset.state = "";
    button.textContent = "Enviar via LovaBurst";
    button.title = "";
    button.disabled = false;
  }

  async function rememberObjectiveForProject(workspace, text, quickAction = "") {
    const projectId = workspace?.lovableProjectId || "";
    if (!projectId || !text) return;

    const stored = await globalThis.LovaBurstStorage.get("projectChatBindings");
    const bindings = stored.projectChatBindings || {};
    const current = bindings[projectId] || {
      projectId,
      activeConversationId: "",
      conversations: [],
      recentObjectives: [],
    };
    const recentObjectives = Array.isArray(current.recentObjectives)
      ? [...current.recentObjectives]
      : [];
    const last = recentObjectives[recentObjectives.length - 1];

    if (!last || last.text !== text) {
      recentObjectives.push({ text: text.slice(0, 700), quickAction: String(quickAction || "").slice(0, 40), capturedAt: new Date().toISOString() });
    }

    bindings[projectId] = {
      ...current,
      projectId,
      repository: workspace.repository || current.repository || "",
      sourceTitle: document.title || current.sourceTitle || "",
      sourceUrl: window.location.href,
      recentObjectives: recentObjectives.slice(-12),
      updatedAt: new Date().toISOString(),
    };
    await globalThis.LovaBurstStorage.set({ projectChatBindings: bindings });
  }

  async function activateProjectChat(workspace) {
    const projectId = workspace?.lovableProjectId || "";
    if (!projectId) throw new Error("Não foi possível identificar o projeto Lovable.");

    const stored = await globalThis.LovaBurstStorage.get("projectChatBindings");
    const record = stored.projectChatBindings?.[projectId];
    const conversation = record?.conversations?.find(
      (item) => item.id === record.activeConversationId,
    );

    if (!conversation?.tabId) {
      throw new Error(
        "Este projeto ainda não possui uma conversa ativa do ChatGPT. Abra o painel da LovaBurst e vincule ou crie uma conversa.",
      );
    }

    const response = await globalThis.LovaBurstRuntime.sendMessage({
      type: "LOVABURST_LINK_CHATGPT",
      tabId: conversation.tabId,
      projectId,
    });

    if (!response?.ok) {
      throw new Error(
        response?.error ||
          "A conversa deste projeto não está disponível. Abra o painel da LovaBurst e selecione outra conversa.",
      );
    }
  }

  async function capturePrompt(button) {
    const text = readComposerText(composer);
    if (!text) {
      button.textContent = "Digite um prompt primeiro";
      button.disabled = true;
      window.setTimeout(() => resetButton(button), 1400);
      return;
    }

    button.disabled = true;
    button.textContent = "Detectando projeto…";

    try {
      const workspace = await resolveWorkspace();
      button.textContent = workspace.repository ? `Enviando · ${workspace.repository}` : "Enviando ao ChatGPT…";

      await rememberObjectiveForProject(workspace, text);
      await activateProjectChat(workspace);

      const response = await globalThis.LovaBurstRuntime.sendMessage({
        type: "LOVABURST_PROMPT_CAPTURED",
        source: SOURCE,
        payload: {
          text,
          url: window.location.href,
          title: document.title,
          capturedAt: new Date().toISOString(),
          repository: workspace.repository,
          lovableProjectId: workspace.lovableProjectId,
          repositoryDetectionSource: workspace.detectionSource,
          apiDiagnostics: workspace.apiDiagnostics,
        },
      });

      if (!response?.ok) throw new Error(response?.error || "Falha ao enviar o prompt.");

      button.dataset.state = "sent";
      button.textContent = workspace.repository ? `Enviado · ${workspace.repository} ✓` : "Enviado ao ChatGPT ✓";
      window.setTimeout(() => resetButton(button), 2200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const needsChat =
        message.includes("ainda não possui uma conversa ativa do ChatGPT") ||
        message.includes("conversa deste projeto não está disponível");

      if (needsChat) {
        button.dataset.state = "needs-chat";
        button.textContent = "Conecte o ChatGPT";
        button.title = "Abra o painel da LovaBurst para criar ou conectar uma conversa a este projeto.";
        window.setTimeout(() => resetButton(button), 4200);
        return;
      }

      button.dataset.state = "error";
      button.textContent = "Falha no envio";
      button.title = message;
      console.error("[LovaBurst] Falha inesperada ao enviar o prompt:", error);
      window.setTimeout(() => resetButton(button), 2600);
    }
  }

  function ensureCaptureButton() {
    ensureStyles();
    let button = document.getElementById(BUTTON_ID);

    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.textContent = "Enviar via LovaBurst";
      button.setAttribute("aria-label", "Enviar este prompt ao ChatGPT pela LovaBurst");
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        capturePrompt(button);
      });
      document.documentElement.appendChild(button);
    }

    positionButton(button);
  }

  function scanForComposer() {
    const nextComposer = findComposer();
    if (nextComposer !== composer) composer = nextComposer;
    ensureCaptureButton();
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scanForComposer, 120);
  }

  function startObserver() {
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleScan, { passive: true });
    window.addEventListener("scroll", scheduleScan, { passive: true, capture: true });
    scanForComposer();
  }

  async function startSpeechDictation() {
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, error: "unsupported-media" };
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) return { ok: false, error: "unsupported-speech" };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      return { ok: false, error: String(error?.name || "media-error") };
    }

    return new Promise((resolve) => {
      try { speechRecognition?.stop?.(); } catch {}
      const recognition = new Recognition();
      speechRecognition = recognition;
      recognition.lang = "pt-BR";
      recognition.continuous = false;
      recognition.interimResults = true;
      let transcript = "";
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        if (speechRecognition === recognition) speechRecognition = null;
        resolve(payload);
      };
      recognition.onresult = (event) => {
        let current = "";
        for (let index = 0; index < event.results.length; index += 1) current += `${event.results[index][0]?.transcript || ""} `;
        transcript = current.trim();
      };
      recognition.onerror = (event) => {
        const code = String(event?.error || "speech-error");
        if (code === "aborted" && transcript) finish({ ok: true, transcript });
        else finish({ ok: false, error: code, transcript });
      };
      recognition.onend = () => finish({ ok: Boolean(transcript), transcript, error: transcript ? "" : "no-speech" });
      try { recognition.start(); } catch (error) { finish({ ok: false, error: String(error?.name || error?.message || "start-error") }); }
    });
  }

  function stopSpeechDictation() {
    try { speechRecognition?.stop?.(); } catch {}
    return { ok: true };
  }

  globalThis.LovaBurstRuntime.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LOVABURST_SPEECH_STOP") {
      sendResponse(stopSpeechDictation());
      return false;
    }

    if (message?.type === "LOVABURST_SPEECH_DICTATE") {
      startSpeechDictation().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
      return true;
    }

    if (message?.type === "LOVABURST_FORCE_REPOSITORY_REFRESH") {
      document.dispatchEvent(new CustomEvent("lovaburst-force-repository-refresh"));
      window.setTimeout(() => {
        resolveWorkspace()
          .then((workspace) => sendResponse({ ok: true, ...workspace }))
          .catch((error) => sendResponse({ ok: false, error: String(error) }));
      }, 850);
      return true;
    }

    if (message?.type === "LOVABURST_CONTENT_PING") {
      resolveWorkspace()
        .then((workspace) => sendResponse({
          ok: true,
          source: SOURCE,
          url: window.location.href,
          composerDetected: Boolean(composer),
          repository: workspace.repository,
          repositoryDetectionSource: workspace.detectionSource,
          githubConnectionState: workspace.githubConnectionState || "unknown",
          lovableProjectId: workspace.lovableProjectId,
        }))
        .catch(() => sendResponse({
          ok: true,
          source: SOURCE,
          url: window.location.href,
          composerDetected: Boolean(composer),
          repository: detectGithubRepository(),
          githubConnectionState: detectGithubConnectionState(),
          lovableProjectId: extractLovableProjectId(),
        }));
      return true;
    }

    if (message?.type === "LOVABURST_SUBMIT_OBJECTIVE") {
      const objective = String(message.objective || "").trim();
      const quickAction = /^[a-z0-9-]{2,40}$/i.test(String(message.quickAction || "")) ? String(message.quickAction) : "";
      const skills = Array.isArray(message.skills)
        ? message.skills.filter((skill) => typeof skill === "string" && /^[a-z0-9-]{2,40}$/i.test(skill)).slice(0, 8)
        : [];

      if (!objective) {
        sendResponse({ ok: false, error: "Digite o que você quer alterar." });
        return false;
      }

      Promise.resolve()
        .then(async () => {
          const workspace = await resolveWorkspace();

          await rememberObjectiveForProject(workspace, objective, quickAction);
          await activateProjectChat(workspace);

          const response = await globalThis.LovaBurstRuntime.sendMessage({
            type: "LOVABURST_PROMPT_CAPTURED",
            source: SOURCE,
            payload: {
              text: objective,
              url: window.location.href,
              title: document.title,
              capturedAt: new Date().toISOString(),
              repository: workspace.repository,
              lovableProjectId: workspace.lovableProjectId,
              repositoryDetectionSource: workspace.detectionSource,
              apiDiagnostics: workspace.apiDiagnostics,
              skills,
              quickAction,
            },
          });

          if (!response?.ok) {
            throw new Error(response?.error || "Falha ao enviar o prompt.");
          }

          return response;
        })
        .then(() => sendResponse({ ok: true }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        );

      return true;
    }

    return false;
  });

  announceReady();
  startObserver();
})();
