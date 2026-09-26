(() => {
  if (window.__LOVABURST_PROJECT_INTEGRATIONS_V0302__) return;
  window.__LOVABURST_PROJECT_INTEGRATIONS_V0302__ = true;
  window.__LOVABURST_PROJECT_INTEGRATIONS__ = true;

  const STORAGE_KEY = "projectIntegrations";
  const PROJECT_RE = /\/projects\/([A-Za-z0-9-]+)/i;
  const SUPABASE_URL_RE = /https?:\/\/([a-z0-9-]{8,40})\.supabase\.co\b/gi;
  const EXPECTED_MARKERS = [
    "@supabase/supabase-js",
    "vite_supabase_url",
    "next_public_supabase_url",
    "supabase_url",
    "supabase/functions",
    "supabase/functions/",
    "supabase.auth",
    "supabase.from(",
    "createclient(",
  ];

  let lastProjectId = "";
  let lastSignature = "";
  let timer = null;
  let observer = null;
  let projectInterval = null;
  let stopped = false;
  let messageListenerRegistered = false;
  let popstateListenerRegistered = false;

  function projectId() {
    return location.pathname.match(PROJECT_RE)?.[1] || "";
  }

  function contextAvailable() {
    if (stopped) return false;
    try {
      return Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.local);
    } catch {
      return false;
    }
  }

  function isContextInvalidation(error) {
    const message = String(error?.message || error || "").toLowerCase();
    return (
      message.includes("extension context invalidated") ||
      message.includes("context invalidated") ||
      message.includes("receiving end does not exist")
    );
  }

  function onPopstate() {
    schedule(80);
  }

  function stopAfterContextInvalidation() {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (projectInterval) clearInterval(projectInterval);
    projectInterval = null;
    observer?.disconnect();
    observer = null;
    if (popstateListenerRegistered) {
      removeEventListener("popstate", onPopstate);
      popstateListenerRegistered = false;
    }
    if (messageListenerRegistered) {
      try { globalThis.chrome?.runtime?.onMessage?.removeListener(onMessage); } catch {}
      messageListenerRegistered = false;
    }
  }

  async function storageGet(keys) {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return null;
    }
    try {
      return await globalThis.LovaBurstStorage.get(keys);
    } catch (error) {
      if (isContextInvalidation(error) || !contextAvailable()) {
        stopAfterContextInvalidation();
        return null;
      }
      throw error;
    }
  }

  async function storageSet(value) {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return false;
    }
    try {
      await globalThis.LovaBurstStorage.set(value);
      return true;
    } catch (error) {
      if (isContextInvalidation(error) || !contextAvailable()) {
        stopAfterContextInvalidation();
        return false;
      }
      throw error;
    }
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function connectorEvidence() {
    const connectedTerms = [
      "disconnect", "connected", "enabled", "active",
      "desconectar", "conectado", "ativado", "ativo",
      "disable for workspace", "disable for project", "desativar para workspace", "desativar para projeto",
    ];
    const disconnectedTerms = [
      "connect supabase", "enable for workspace", "enable for project", "disabled", "inactive",
      "conectar supabase", "ativar para workspace", "ativar para projeto", "desativado", "inativo",
    ];

    const chunks = [];
    const add = (value) => {
      const text = normalize(value);
      if (text && text.length <= 8000) chunks.push(text);
    };

    try {
      for (const node of document.querySelectorAll(
        '[data-testid*="supabase" i], [aria-label*="supabase" i], [title*="supabase" i], [data-testid*="connector" i], [data-testid*="integration" i], a[href*="supabase" i], button, input, code, pre'
      )) {
        add(`${node.getAttribute?.("aria-label") || ""} ${node.getAttribute?.("title") || ""} ${node.value || ""} ${node.textContent || ""}`);
      }
    } catch {}

    // Lovable may render the connector panel without stable test ids. Inspect only small
    // visible-text windows around the word "Supabase" so an unrelated "GitHub Connected"
    // elsewhere on the page cannot create a false positive.
    try {
      const body = String(document.body?.innerText || "").slice(0, 180000);
      const lower = body.toLowerCase();
      let offset = 0;
      while ((offset = lower.indexOf("supabase", offset)) !== -1) {
        add(body.slice(Math.max(0, offset - 100), Math.min(body.length, offset + 260)));
        offset += 8;
      }
    } catch {}

    for (const text of chunks) {
      if (!text.includes("supabase")) continue;
      // Explicit disconnected wording wins over generic "enabled" words elsewhere in the page.
      if (disconnectedTerms.some((term) => text.includes(term))) {
        if (!connectedTerms.some((term) => text.includes(term) && /disconnect|connected|conectado|desconectar/.test(term))) {
          return { status: "unused", source: "lovable-connector-ui", evidence: "connector-disabled" };
        }
      }
      if (connectedTerms.some((term) => text.includes(term))) {
        return { status: "connected", source: "lovable-connector-ui", evidence: "connector-enabled" };
      }
    }
    return null;
  }

  function collectSupabaseSignals() {
    const signals = [];
    const add = (value, source) => {
      const text = String(value || "").trim();
      if (!text) return;
      // The detector extracts refs/markers immediately; raw content is not persisted.
      signals.push({ text: text.slice(0, 180000), source });
    };

    try {
      for (const node of document.querySelectorAll('a[href*="supabase.co" i], link[href*="supabase.co" i], iframe[src*="supabase.co" i], script[src*="supabase.co" i], input, code, pre')) {
        add(node.getAttribute?.("href") || node.getAttribute?.("src") || node.value || node.textContent, "lovable-public-ui");
      }
    } catch {}

    try {
      for (const meta of document.querySelectorAll('meta[content]')) {
        const content = String(meta.content || "");
        if (/supabase/i.test(content)) add(content, "lovable-public-meta");
      }
    } catch {}

    try {
      for (const script of document.querySelectorAll('script')) {
        const text = String(script.textContent || "");
        if (/supabase\.co|vite_supabase_url|next_public_supabase_url|supabase_url|@supabase\/supabase-js/i.test(text)) add(text, "lovable-script-config");
      }
    } catch {}

    try {
      for (const entry of performance.getEntriesByType("resource")) {
        const name = String(entry?.name || "");
        if (/supabase/i.test(name)) add(name, "lovable-performance-resource");
      }
    } catch {}

    const scanStorage = (storage, source) => {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = String(storage.key(index) || "");
          if (!/supabase|backend|integration|connector/i.test(key)) continue;
          const value = String(storage.getItem(key) || "");
          if (value.length <= 12000) add(`${key}:${value}`, source);
        }
      } catch {}
    };
    scanStorage(localStorage, "lovable-local-storage");
    scanStorage(sessionStorage, "lovable-session-storage");

    try {
      const body = String(document.body?.innerText || "");
      if (/supabase/i.test(body)) add(body, "lovable-visible-text");
    } catch {}
    return signals;
  }

  function detectSupabase() {
    const connector = connectorEvidence();
    const signals = collectSupabaseSignals();
    let markerSource = "";

    for (const signal of signals) {
      SUPABASE_URL_RE.lastIndex = 0;
      const match = SUPABASE_URL_RE.exec(signal.text);
      const ref = String(match?.[1] || "").toLowerCase();
      if (ref && ref !== "api" && ref !== "www") {
        return { status: "connected", projectRef: ref, source: signal.source, evidence: "public-project-url" };
      }
      const lower = signal.text.toLowerCase();
      if (!markerSource && EXPECTED_MARKERS.some((marker) => lower.includes(marker))) markerSource = signal.source;
    }

    if (connector?.status === "connected") return { ...connector, projectRef: "" };
    if (connector?.evidence === "connector-disabled") return { ...connector, projectRef: "" };
    if (markerSource) return { status: "connected", projectRef: "", source: markerSource, evidence: "supabase-project-markers" };
    return { status: "unused", projectRef: "", source: "lovable-signals", evidence: "no-supabase-signals" };
  }

  async function persist(force = false) {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return null;
    }
    const id = projectId();
    if (!id) return null;

    try {
      const stored = await storageGet(STORAGE_KEY);
      if (!stored || stopped) return null;
      const current = stored[STORAGE_KEY] || {};
      const previous = current[id] || {};
      const detected = detectSupabase();
      const previousSupabase = previous.supabase || null;

      const keepConnectedCache =
        detected.status === "unused" &&
        detected.evidence === "no-supabase-signals" &&
        previousSupabase?.status === "connected";

      const supabase = keepConnectedCache
        ? {
            ...previousSupabase,
            source: previousSupabase.source || "project-cache",
            evidence: previousSupabase.evidence || "cached-connected",
          }
        : detected;

      const signature = `${id}|${supabase.status}|${supabase.projectRef || ""}|${supabase.source}|${supabase.evidence}`;
      if (!force && signature === lastSignature) return supabase;
      lastProjectId = id;
      lastSignature = signature;

      const next = {
        ...previous,
        projectId: id,
        supabase: {
          status: supabase.status,
          projectRef: String(supabase.projectRef || ""),
          source: supabase.source,
          evidence: supabase.evidence,
          detectedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      };

      const saved = await storageSet({ [STORAGE_KEY]: { ...current, [id]: next } });
      return saved ? next.supabase : null;
    } catch (error) {
      if (isContextInvalidation(error) || !contextAvailable()) {
        stopAfterContextInvalidation();
        return null;
      }
      console.warn("[LovaBurst] Falha ao atualizar integrações do projeto:", error);
      return null;
    }
  }

  function schedule(delay = 350) {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persist();
    }, delay);
  }

  function onMessage(message, _sender, sendResponse) {
    if (message?.type !== "LOVABURST_REFRESH_PROJECT_INTEGRATIONS") return false;
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      try { sendResponse({ ok: false, error: "O contexto da extensão foi recarregado. Atualize a página do Lovable." }); } catch {}
      return false;
    }
    const requested = String(message.projectId || "");
    const current = projectId();
    if (requested && current && requested !== current) {
      try { sendResponse({ ok: false, error: "O projeto Lovable ativo mudou antes da atualização das integrações." }); } catch {}
      return false;
    }
    void persist(true)
      .then((supabase) => {
        try { sendResponse({ ok: true, projectId: current, supabase }); } catch {}
      })
      .catch(() => {
        try { sendResponse({ ok: false, error: "Não foi possível atualizar as integrações do projeto." }); } catch {}
      });
    return true;
  }

  if (!contextAvailable()) {
    stopAfterContextInvalidation();
    return;
  }
  try {
    globalThis.LovaBurstRuntime.addListener(onMessage);
    messageListenerRegistered = true;
  } catch (error) {
    if (isContextInvalidation(error)) {
      stopAfterContextInvalidation();
      return;
    }
  }

  observer = new MutationObserver(() => schedule(500));
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  addEventListener("popstate", onPopstate);
  popstateListenerRegistered = true;

  projectInterval = setInterval(() => {
    if (!contextAvailable()) {
      stopAfterContextInvalidation();
      return;
    }
    const current = projectId();
    if (current && current !== lastProjectId) void persist(true);
  }, 1800);

  void persist(true);
})();
