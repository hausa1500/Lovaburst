"use strict";

(() => {
  const BUTTON_ID = "useAnotherChatButton";
  const BINDINGS_KEY = "projectChatBindings";

  const now = () => new Date().toISOString();
  const makeId = () => crypto.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  function currentProjectId() {
    const value = String(document.getElementById("projectValue")?.textContent || "").trim();
    return value && value !== "—" ? value : "";
  }

  async function chatTabs() {
    const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
    return tabs
      .filter((tab) => Number.isInteger(tab.id))
      .sort((a, b) => Number(b.active) - Number(a.active) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
  }

  async function bindings() {
    return (await globalThis.LovaBurstStorage.get(BINDINGS_KEY))[BINDINGS_KEY] || {};
  }

  async function saveBindings(value) {
    await globalThis.LovaBurstStorage.set({ [BINDINGS_KEY]: value });
  }

  async function ensureBridge(tabId) {
    const safeTab = await chrome.tabs.get(Number(tabId));
    if (!safeTab?.id || !String(safeTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
    try {
      const ping = await globalThis.LovaBurstTabSafety.sendMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
      if (ping?.ok && ping.source === "chatgpt") return true;
    } catch {}
    const recheckedTab = await chrome.tabs.get(Number(tabId));
    if (!recheckedTab?.id || !String(recheckedTab.url || "").startsWith("https://chatgpt.com/")) throw new Error("Origem da aba não autorizada.");
    await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: recheckedTab.id }, files: ["src/content/chatgpt.js"] });
    const ping = await globalThis.LovaBurstTabSafety.sendMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
    return Boolean(ping?.ok && ping.source === "chatgpt");
  }

  async function activateRelay(tabId) {
    const response = await chrome.runtime.sendMessage({ type: "LOVABURST_LINK_CHATGPT", tabId, projectId: currentProjectId() });
    if (!response?.ok) throw new Error(response?.error || "Não foi possível ativar esta conversa.");
  }

  function closePicker(result, resolve, overlay) {
    overlay.remove();
    resolve(result);
  }

  async function chooseChatTab(projectId) {
    const tabs = await chatTabs();
    if (!tabs.length) throw new Error("Nenhuma conversa do ChatGPT está aberta.");

    const all = await bindings();
    const ownership = new Map();
    for (const [ownerProjectId, rec] of Object.entries(all)) {
      for (const item of rec?.conversations || []) {
        const lockedUrl = String(item.lockedUrl || item.url || "").trim();
        if (lockedUrl && lockedUrl !== "https://chatgpt.com/") ownership.set(lockedUrl, ownerProjectId);
      }
    }

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "lb-chat-picker";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.innerHTML = '<section class="lb-chat-picker-panel"><header><div><span>// CHATGPT</span><strong>Trocar conversa</strong><p>Escolha a conversa que ficará exclusiva deste projeto.</p></div><button type="button" data-close aria-label="Fechar">×</button></header><div class="lb-chat-picker-list"></div><button type="button" class="lb-chat-picker-cancel" data-close>Cancelar</button></section>';

      const list = overlay.querySelector(".lb-chat-picker-list");
      for (const tab of tabs) {
        const ownerProjectId = ownership.get(tab.url || "") || "";
        const unavailable = Boolean(ownerProjectId && ownerProjectId !== projectId);
        const option = document.createElement("button");
        option.type = "button";
        option.className = "lb-chat-picker-option";
        option.disabled = unavailable;

        const title = document.createElement("strong");
        title.textContent = tab.title || "ChatGPT";
        const url = document.createElement("span");
        url.textContent = tab.url === "https://chatgpt.com/" ? "Nova conversa ainda sem URL própria" : String(tab.url || "");
        const state = document.createElement("small");
        state.textContent = unavailable ? "Exclusiva de outro projeto" : (tab.active ? "Aba ativa" : "Disponível");
        option.append(title, url, state);

        if (!unavailable) option.addEventListener("click", () => closePicker(tab, resolve, overlay));
        list.append(option);
      }

      overlay.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closePicker(null, resolve, overlay)));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closePicker(null, resolve, overlay);
      });
      document.body.append(overlay);
    });
  }

  async function bindSelectedConversation(projectId, tab) {
    if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) throw new Error("Conversa inválida.");
    if (tab.url === "https://chatgpt.com/") throw new Error("Abra uma conversa específica do ChatGPT antes de vinculá-la.");

    const all = await bindings();
    for (const [ownerProjectId, rec] of Object.entries(all)) {
      if (ownerProjectId === projectId) continue;
      const used = (rec?.conversations || []).some((item) => String(item.lockedUrl || item.url || "") === tab.url);
      if (used) throw new Error("Essa conversa já está exclusiva de outro projeto.");
    }

    if (!(await ensureBridge(tab.id))) throw new Error("A ponte da LovaBurst não respondeu nesta conversa.");

    const rec = all[projectId] || {
      projectId,
      repository: "",
      sourceTitle: "",
      sourceUrl: "",
      activeConversationId: "",
      conversations: [],
      recentObjectives: [],
    };

    const conversations = Array.isArray(rec.conversations) ? [...rec.conversations] : [];
    let linked = conversations.find((item) => String(item.lockedUrl || item.url || "") === tab.url);

    if (!linked) {
      linked = {
        id: makeId(),
        tabId: tab.id,
        url: tab.url,
        title: tab.title || "ChatGPT",
        lockedUrl: tab.url,
        lockedTitle: tab.title || "ChatGPT",
        createdAt: now(),
        linkedAt: now(),
        contextSentAt: "",
      };
      conversations.push(linked);
    } else {
      linked = {
        ...linked,
        tabId: tab.id,
        url: tab.url,
        title: tab.title || linked.title || "ChatGPT",
        lockedUrl: tab.url,
        lockedTitle: tab.title || linked.lockedTitle || linked.title || "ChatGPT",
        linkedAt: now(),
        closedAt: "",
      };
      conversations[conversations.findIndex((item) => item.id === linked.id)] = linked;
    }

    all[projectId] = {
      ...rec,
      activeConversationId: linked.id,
      conversations: conversations.slice(-12),
      updatedAt: now(),
    };
    await saveBindings(all);
    await activateRelay(tab.id);
  }

  async function handleSwitch(button) {
    const projectId = currentProjectId();
    if (!projectId) throw new Error("Abra um projeto do Lovable primeiro.");
    button.disabled = true;
    try {
      const selected = await chooseChatTab(projectId);
      if (!selected) return;
      await bindSelectedConversation(projectId, selected);
      if (typeof refreshChat === "function") await refreshChat();
      if (typeof showFeedback === "function") showFeedback("Conversa selecionada e travada exclusivamente para este projeto.", "success");
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(`#${BUTTON_ID}`);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void handleSwitch(button).catch((error) => {
      if (typeof showFeedback === "function") showFeedback(error instanceof Error ? error.message : String(error), "error");
    });
  }, true);
})();
