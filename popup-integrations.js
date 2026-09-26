(() => {
  if (window.__LOVABURST_POPUP_INTEGRATIONS_V0302__) return;
  window.__LOVABURST_POPUP_INTEGRATIONS_V0302__ = true;
  window.__LOVABURST_POPUP_INTEGRATIONS__ = true;

  const STORAGE_KEY = "projectIntegrations";
  const githubCard = document.getElementById("githubIntegrationCard");
  const githubValue = document.getElementById("repositoryValue");
  const githubState = document.getElementById("repositoryState");
  const supabaseCard = document.getElementById("supabaseIntegrationCard");
  const supabaseValue = document.getElementById("supabaseValue");
  const supabaseState = document.getElementById("supabaseState");
  const refreshButton = document.getElementById("refreshRepositoryButton");
  const refreshDataButton = document.getElementById("refreshDataButton");
  let refreshTimer = null;
  let lastRefreshProjectId = "";
  let refreshing = false;

  function loadV026Ui() {
    if (!document.getElementById("lovaburst-layout-v026")) {
      const link = document.createElement("link");
      link.id = "lovaburst-layout-v026";
      link.rel = "stylesheet";
      link.href = chrome.runtime.getURL("src/popup/popup-layout-v026.css");
      document.head.appendChild(link);
    }
    if (!document.getElementById("lovaburst-progress-v026")) {
      const script = document.createElement("script");
      script.id = "lovaburst-progress-v026";
      script.src = chrome.runtime.getURL("src/popup/popup-progress.js");
      document.documentElement.appendChild(script);
    }
  }
  loadV026Ui();

  function projectId() {
    return String(document.getElementById("projectValue")?.textContent || "").trim().replace(/^—$/, "");
  }

  function setTextIfChanged(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function setCard(card, state, valueEl, stateEl, value, label, title) {
    if (!card) return;
    if (card.dataset.state !== state) card.dataset.state = state;
    setTextIfChanged(valueEl, value);
    setTextIfChanged(stateEl, label);
    if (card.title !== (title || label)) card.title = title || label;
  }

  function syncGithub() {
    const value = String(githubValue?.textContent || "").trim();
    const rawState = String(githubState?.textContent || "").trim().toLowerCase();
    if (/detect|verific|atualiz/.test(value.toLowerCase()) || /verific|atualiz/.test(rawState)) {
      if (githubCard?.dataset.state !== "loading") githubCard.dataset.state = "loading";
      return;
    }
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
      setCard(githubCard, "connected", githubValue, githubState, value, "Repositório detectado", "Repositório detectado");
      return;
    }
    setCard(githubCard, "disconnected", githubValue, githubState, value || "Não conectado", "Não conectado", "Repositório não detectado");
  }

  async function getSupabaseRecord(id) {
    if (!id) return null;
    const stored = await globalThis.LovaBurstStorage.get(STORAGE_KEY);
    return stored[STORAGE_KEY]?.[id]?.supabase || null;
  }

  async function saveSupabaseRecord(id, supabase) {
    if (!id || !supabase) return null;
    const stored = await globalThis.LovaBurstStorage.get(STORAGE_KEY);
    const all = stored[STORAGE_KEY] || {};
    const previous = all[id] || {};
    const previousSupabase = previous.supabase || null;

    if (
      supabase.status !== "connected" &&
      supabase.evidence !== "connector-disabled" &&
      previousSupabase?.status === "connected"
    ) {
      return previousSupabase;
    }

    const now = new Date().toISOString();
    const next = {
      ...previous,
      projectId: id,
      supabase: {
        status: String(supabase.status || "unused"),
        projectRef: String(supabase.projectRef || ""),
        source: String(supabase.source || "main-world-probe"),
        evidence: String(supabase.evidence || "main-world-probe"),
        detectedAt: now,
      },
      updatedAt: now,
    };
    await globalThis.LovaBurstStorage.set({ [STORAGE_KEY]: { ...all, [id]: next } });
    return next.supabase;
  }

  async function renderSupabase({ allowLoading = true } = {}) {
    const id = projectId();
    if (!id) {
      setCard(
        supabaseCard,
        allowLoading ? "loading" : "unused",
        supabaseValue,
        supabaseState,
        allowLoading ? "Aguardando projeto" : "Não verificado",
        allowLoading ? "Verificando..." : "Opcional",
        allowLoading ? "Aguardando projeto Lovable" : "Supabase ainda não pôde ser verificado",
      );
      return null;
    }

    const supabase = await getSupabaseRecord(id);
    if (!supabase) {
      setCard(
        supabaseCard,
        allowLoading ? "loading" : "unused",
        supabaseValue,
        supabaseState,
        allowLoading ? "Verificando..." : "Não verificado",
        allowLoading ? "Verificando..." : "Opcional",
        allowLoading ? "Detectando integração Supabase" : "Supabase ainda não pôde ser verificado",
      );
      return null;
    }

    if (supabase.status === "connected") {
      const ref = String(supabase.projectRef || "").trim();
      const compact = ref ? `${ref.slice(0, 8)}${ref.length > 8 ? "…" : ""}` : "Connector ativo";
      setCard(supabaseCard, "connected", supabaseValue, supabaseState, compact, "Conectado", ref ? `Supabase conectado · ${ref}` : "Supabase conectado");
      return supabase;
    }

    if (supabase.status === "disconnected") {
      setCard(supabaseCard, "disconnected", supabaseValue, supabaseState, "Não conectado", "Integração com problema", "Há sinais de Supabase, mas a conexão do projeto não pôde ser resolvida");
      return supabase;
    }

    setCard(supabaseCard, "unused", supabaseValue, supabaseState, "Não utilizado", "Opcional", "Este projeto não apresenta sinais de integração Supabase");
    return supabase;
  }

  async function assertLovableTab(tabId) {
    const tab = await chrome.tabs.get(Number(tabId));
    if (!tab?.id || !String(tab.url || "").startsWith("https://lovable.dev/")) throw new Error("Aba Lovable inválida.");
    return tab;
  }

  async function requestSupabaseRefresh(tabId, id) {
    await assertLovableTab(tabId);
    const message = { type: "LOVABURST_REFRESH_PROJECT_INTEGRATIONS", projectId: id };
    try {
      const response = await globalThis.LovaBurstTabSafety.sendMessage(tabId, message);
      if (response?.ok) return response;
    } catch {}

    try {
      await assertLovableTab(tabId);
      await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId }, files: ["src/content/lovable-integrations.js"] });
      return await globalThis.LovaBurstTabSafety.sendMessage(tabId, message);
    } catch {
      return null;
    }
  }

  function scheduleRefresh(delay = 180) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshIntegrations();
    }, delay);
  }

  async function refreshIntegrations() {
    if (refreshing) return;
    const id = projectId();
    syncGithub();
    if (!id) {
      await renderSupabase({ allowLoading: true });
      return;
    }

    refreshing = true;
    lastRefreshProjectId = id;
    setCard(supabaseCard, "loading", supabaseValue, supabaseState, "Verificando...", "Verificando...", "Atualizando integração Supabase");
    try {
      const tabs = await chrome.tabs.query({ url: ["https://lovable.dev/*"] });
      const tab = tabs.find((item) => item.url?.includes(id));
      if (!tab?.id) {
        await renderSupabase({ allowLoading: false });
        return;
      }

      const bridgeResponse = await requestSupabaseRefresh(tab.id, id);
      if (bridgeResponse?.ok && bridgeResponse.supabase) {
        await saveSupabaseRecord(id, bridgeResponse.supabase);
      }

      await renderSupabase({ allowLoading: false });
    } finally {
      refreshing = false;
      syncGithub();
    }
  }

  const githubObserver = new MutationObserver(() => syncGithub());
  if (githubValue) githubObserver.observe(githubValue, { childList: true, characterData: true, subtree: true });
  if (githubState) githubObserver.observe(githubState, { childList: true, characterData: true, subtree: true });

  const projectValue = document.getElementById("projectValue");
  const projectObserver = new MutationObserver(() => {
    const id = projectId();
    void renderSupabase();
    if (id && id !== lastRefreshProjectId) scheduleRefresh(80);
  });
  if (projectValue) projectObserver.observe(projectValue, { childList: true, characterData: true, subtree: true });

  for (const button of [refreshButton, refreshDataButton]) {
    button?.addEventListener("click", () => scheduleRefresh(120));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) void renderSupabase({ allowLoading: false });
  });

  window.setInterval(syncGithub, 1200);
  window.setTimeout(() => scheduleRefresh(0), 250);
  window.setTimeout(() => scheduleRefresh(0), 900);
  window.setTimeout(() => scheduleRefresh(0), 2200);
})();
