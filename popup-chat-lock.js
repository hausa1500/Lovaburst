(() => {
  if (window.__LOVABURST_CHAT_LOCK_V0212__) return;
  window.__LOVABURST_CHAT_LOCK_V0212__ = true;

  const KEY = "projectChatBindings";
  const INTEGRATIONS_KEY = "projectIntegrations";
  const SELECTOR_ID = "chatTabSelectorCard";
  const now = () => new Date().toISOString();

  function projectId() {
    return String(document.getElementById("projectValue")?.textContent || "").trim().replace(/^—$/, "");
  }

  function feedback(message, tone = "info") {
    const el = document.getElementById("sendFeedback") || document.getElementById("chatgptHelp");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    if (el.id === "sendFeedback") el.dataset.tone = tone;
  }

  async function bindings() {
    return (await globalThis.LovaBurstStorage.get(KEY))[KEY] || {};
  }

  async function ownerOfTab(tab) {
    const all = await bindings();
    for (const [id, rec] of Object.entries(all)) {
      for (const conversation of rec?.conversations || []) {
        if (conversation.tabId === tab.tabId) return id;
        if (tab.url && tab.url !== "https://chatgpt.com/" && conversation.url === tab.url) return id;
      }
    }
    return "";
  }

  function titleOf(tab) {
    return String(tab?.title || "ChatGPT").replace(/\s*-\s*ChatGPT\s*$/i, "").trim() || "Conversa do ChatGPT";
  }

  function ensureSelector() {
    let card = document.getElementById(SELECTOR_ID);
    if (card) return card;
    const setup = document.getElementById("chatSetupCard");
    if (!setup) return null;
    card = document.createElement("div");
    card.id = SELECTOR_ID;
    card.className = "chat-tab-selector";
    card.hidden = true;
    card.innerHTML = '<div class="chat-tab-selector-head"><strong>Escolha a aba deste projeto</strong><span>Selecione uma aba do ChatGPT e a LovaBurst trava este projeto nela.</span></div><div class="chat-tab-selector-list" id="chatTabSelectorList"></div>';
    setup.appendChild(card);
    return card;
  }

  function addStyles() {
    if (document.getElementById("lovaburst-chat-lock-style")) return;
    const style = document.createElement("style");
    style.id = "lovaburst-chat-lock-style";
    style.textContent = `
      .chat-tab-selector{margin-top:12px;border:1px solid rgba(125,211,252,.18);background:rgba(8,12,24,.62);border-radius:18px;padding:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
      .chat-tab-selector-head strong{display:block;color:#eaf6ff;font-size:12px}.chat-tab-selector-head span{display:block;margin-top:3px;color:#8f9caf;font-size:11px;line-height:1.35}.chat-tab-selector-list{display:grid;gap:8px;margin-top:10px}.chat-tab-option{width:100%;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.035);border-radius:14px;padding:10px;text-align:left;color:#e5edf7;display:grid;gap:4px;cursor:pointer}.chat-tab-option:hover:not(:disabled){border-color:rgba(34,211,238,.36);background:rgba(34,211,238,.08)}.chat-tab-option:disabled{opacity:.48;cursor:not-allowed}.chat-tab-option strong{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-tab-option small{font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.chat-tab-option span{font-size:10px;color:#67e8f9}.chat-tab-option[data-owned="other"] span{color:#fca5a5}.connected-card[data-locked="true"] .connected-badge{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.24);color:#86efac}.connected-card[data-locked="true"] #compactChatState::before{content:"🔒 ";}
    `;
    document.head.appendChild(style);
  }

  async function listTabs() {
    const response = await chrome.runtime.sendMessage({ type: "LOVABURST_LIST_CHATGPT_TABS" });
    if (!response?.ok) throw new Error(response?.error || "Não foi possível listar abas do ChatGPT.");
    return Array.isArray(response.tabs) ? response.tabs : [];
  }

  async function renderSelector() {
    addStyles();
    const card = ensureSelector();
    const list = document.getElementById("chatTabSelectorList");
    if (!card || !list) return;
    const id = projectId();
    if (!id) throw new Error("Abra um projeto do Lovable primeiro.");
    const tabs = await listTabs();
    card.hidden = false;
    list.replaceChildren();
    if (!tabs.length) {
      const empty = document.createElement("button");
      empty.type = "button";
      empty.className = "chat-tab-option";
      empty.innerHTML = "<strong>Nenhuma aba do ChatGPT aberta</strong><small>Clique em Nova conversa para criar uma aba já com contexto.</small>";
      empty.disabled = true;
      list.append(empty);
      return;
    }
    for (const tab of tabs) {
      const owner = await ownerOfTab(tab);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-tab-option";
      button.dataset.owned = owner && owner !== id ? "other" : owner === id ? "same" : "free";
      const title = document.createElement("strong");
      title.textContent = titleOf(tab);
      const url = document.createElement("small");
      url.textContent = String(tab.url || "https://chatgpt.com/");
      const state = document.createElement("span");
      state.textContent = owner && owner !== id ? "Travada em outro projeto" : owner === id ? "Já é a aba deste projeto" : "Livre para travar neste projeto";
      button.append(title, url, state);
      button.disabled = Boolean(owner && owner !== id);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          if (typeof window.linkTab !== "function") throw new Error("O vinculador do ChatGPT não está disponível.");
          await window.linkTab(tab.tabId);
          await markLocked(tab.tabId);
          card.hidden = true;
          feedback("Aba do ChatGPT travada para este projeto.", "success");
          if (typeof window.refreshChat === "function") await window.refreshChat();
        } catch (error) {
          feedback(error?.message || String(error), "error");
        } finally {
          button.disabled = false;
        }
      });
      list.append(button);
    }
  }

  async function markLocked(tabId) {
    const id = projectId();
    if (!id) return;
    const all = await bindings();
    const rec = all[id];
    if (!rec?.activeConversationId) return;
    all[id] = {
      ...rec,
      conversations: (rec.conversations || []).map((item) => item.id === rec.activeConversationId ? { ...item, tabId, locked: true, lockedAt: now() } : item),
      updatedAt: now(),
    };
    await globalThis.LovaBurstStorage.set({ [KEY]: all });
  }

  async function enrichCurrentRecordForContext() {
    const id = projectId();
    if (!id) return;
    const [bindingsStore, integrationsStore] = await Promise.all([
      globalThis.LovaBurstStorage.get(KEY),
      globalThis.LovaBurstStorage.get(INTEGRATIONS_KEY),
    ]);
    const all = bindingsStore[KEY] || {};
    const rec = all[id];
    if (!rec) return;
    const supabase = integrationsStore[INTEGRATIONS_KEY]?.[id]?.supabase || null;
    all[id] = {
      ...rec,
      integrationContext: {
        supabaseStatus: supabase?.status || "unknown",
        supabaseProjectRef: supabase?.projectRef || "",
        supabaseEvidence: supabase?.evidence || "",
        connectorHints: ["GitHub", "Lovable", "Supabase"],
        updatedAt: now(),
      },
      updatedAt: now(),
    };
    await globalThis.LovaBurstStorage.set({ [KEY]: all });
  }

  const originalUseOpen = window.useOpenConversation;
  window.useOpenConversation = async function useSelectedOpenConversation() {
    await renderSelector();
    const help = document.getElementById("chatgptHelp");
    if (help) help.textContent = "Selecione abaixo exatamente qual aba do ChatGPT deve ficar travada neste projeto.";
    return { ok: true, selecting: true };
  };

  const originalNewConversation = window.newConversation;
  if (typeof originalNewConversation === "function") {
    window.newConversation = async function projectAwareNewConversation(options = {}) {
      await enrichCurrentRecordForContext();
      const result = await originalNewConversation.call(this, options);
      const all = await bindings();
      const rec = all[projectId()];
      const active = rec?.conversations?.find((item) => item.id === rec.activeConversationId);
      if (active?.tabId) await markLocked(active.tabId);
      return result;
    };
  }


  const originalRefreshChat = window.refreshChat;
  if (typeof originalRefreshChat === "function") {
    window.refreshChat = async function refreshChatWithLockBadge() {
      const result = await originalRefreshChat.call(this);
      const id = projectId();
      const rec = id ? (await bindings())[id] : null;
      const active = rec?.conversations?.find((item) => item.id === rec.activeConversationId);
      const card = document.getElementById("chatConnectedCard");
      if (card) card.dataset.locked = active?.locked ? "true" : "false";
      const badge = card?.querySelector(".connected-badge");
      if (badge) badge.textContent = active?.locked ? "ABA TRAVADA" : "CONTEXTO ATIVO";
      const memory = document.getElementById("compactMemoryState");
      if (memory && active?.locked) memory.textContent = `${titleOf(active)} · exclusivo deste projeto`;
      return result;
    };
  }

  document.getElementById("useOpenChatButton")?.addEventListener("click", () => setTimeout(() => renderSelector().catch((error) => feedback(error?.message || String(error), "error")), 0), true);
  document.getElementById("useAnotherChatButton")?.addEventListener("click", () => setTimeout(() => renderSelector().catch((error) => feedback(error?.message || String(error), "error")), 0), true);
  setTimeout(() => window.refreshChat?.(), 250);
})();
