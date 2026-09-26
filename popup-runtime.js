"use strict";

async function resolveTab(conversation) {
  if (!conversation) return null;
  const lockedUrl = String(conversation.lockedUrl || conversation.url || "").trim();

  if (conversation.tabId) {
    try {
      const tab = await chrome.tabs.get(conversation.tabId);
      if (tab?.url?.startsWith("https://chatgpt.com/") && (!lockedUrl || tab.url === lockedUrl)) return tab;
    } catch {}
  }

  const tabs = await chatTabs();
  if (lockedUrl && lockedUrl !== "https://chatgpt.com/") {
    const byUrl = tabs.find((tab) => tab.url === lockedUrl);
    if (byUrl?.tabId) return chrome.tabs.get(byUrl.tabId);
  }

  return null;
}

async function collectHandoffFromActiveConversation() {
  const projectId = workspace.lovableProjectId;
  const rec = await record(projectId);
  const conversation = active(rec);
  if (!projectId || !conversation) return "";

  const tab = await resolveTab(conversation);
  if (!tab?.id) return "";

  try {
    if (!(await ensureBridge(tab.id))) return "";
    const response = await globalThis.LovaBurstTabSafety.sendMessage(tab.id, {
      type: "LOVABURST_EXPORT_PROJECT_CONTEXT",
      projectId,
    });
    const excerpt = String(response?.excerpt || "").trim();

    if (excerpt) {
      await update(projectId, (next) => ({
        ...next,
        handoffExcerpt: excerpt.slice(-8000),
        handoffCapturedAt: now(),
      }));
    }
    return excerpt;
  } catch {
    return "";
  }
}

async function sendContext() {
  const projectId = workspace.lovableProjectId;
  const rec = await record(projectId);
  const conversation = active(rec);
  if (!rec || !conversation) throw new Error("Nenhuma conversa ativa para este projeto.");
  const tab = await resolveTab(conversation);
  if (!tab?.id) throw new Error("A conversa ativa não está aberta.");

  await activateRelay(tab.id);
  const payload = await contextPayload(rec);
  const executed = await chrome.runtime.sendMessage({ type: "LOVABURST_EXECUTE_SPECIAL_OPERATION", operation: "bootstrap-context", payload });
  if (!executed?.ok || !executed.prompt) throw new Error(executed?.error || "O servidor não liberou o contexto do projeto.");
  await sendDirect(tab.id, executed.prompt);
  await update(projectId, (next) => ({
    ...next,
    conversations: next.conversations.map((item) =>
      item.id === conversation.id
        ? {
            ...item,
            tabId: tab.id,
            url: tab.url || item.url,
            title: tab.title || item.title,
            lockedUrl: tab.url || item.lockedUrl || item.url,
            lockedTitle: tab.title || item.lockedTitle || item.title,
            contextSentAt: now(),
          }
        : item
    ),
  }));
}

async function waitChat(tabId, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.url?.startsWith("https://chatgpt.com/") && tab.status === "complete") return tab;
    } catch {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return chrome.tabs.get(tabId).catch(() => null);
}

async function newConversation(options = {}) {
  const projectId = workspace.lovableProjectId;
  if (!projectId) throw new Error("Abra um projeto do Lovable primeiro.");
  const initialPrompt = String(options.initialPrompt || "").trim();

  if (!initialPrompt) await collectHandoffFromActiveConversation();

  await update(projectId, (rec) => ({
    ...rec,
    repository: workspace.repository || rec.repository || "",
    sourceTitle: workspace.sourceTitle || rec.sourceTitle || "",
    sourceUrl: workspace.sourceUrl || rec.sourceUrl || "",
  }));

  const tab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: false });
  const conversation = {
    id: makeId(),
    tabId: tab.id,
    url: tab.url || "https://chatgpt.com/",
    title: "Nova conversa · ChatGPT",
    createdAt: now(),
    linkedAt: now(),
    contextSentAt: "",
    lockedUrl: "",
    lockedTitle: "Nova conversa · ChatGPT",
  };

  await update(projectId, (rec) => ({
    ...rec,
    activeConversationId: conversation.id,
    conversations: [...rec.conversations, conversation].slice(-12),
  }));

  const loaded = await waitChat(tab.id);
  if (!loaded?.id) throw new Error("A nova conversa do ChatGPT não carregou.");

  await update(projectId, (rec) => ({
    ...rec,
    conversations: rec.conversations.map((item) =>
      item.id === conversation.id
        ? {
            ...item,
            tabId: loaded.id,
            url: loaded.url || item.url,
            title: loaded.title || item.title,
            lockedUrl: loaded.url && loaded.url !== "https://chatgpt.com/" ? loaded.url : item.lockedUrl,
            lockedTitle: loaded.title || item.lockedTitle || item.title,
          }
        : item
    ),
  }));

  await activateRelay(loaded.id);
  if (initialPrompt) await sendDirect(loaded.id, initialPrompt);
  else await sendContext();
}

async function rememberLastWorkspace(nextWorkspace) {
  if (!nextWorkspace?.lovableProjectId) return nextWorkspace;
  const snapshot = {
    repository: nextWorkspace.repository || "",
    lovableProjectId: nextWorkspace.lovableProjectId,
    sourceTitle: nextWorkspace.sourceTitle || "",
    sourceUrl: nextWorkspace.sourceUrl || "",
    githubConnectionState: nextWorkspace.githubConnectionState || "unknown",
    rememberedAt: now(),
  };
  await globalThis.LovaBurstStorage.set({ [LAST_WORKSPACE_KEY]: snapshot });
  return snapshot;
}

async function lastWorkspace() {
  const stored = await globalThis.LovaBurstStorage.get(LAST_WORKSPACE_KEY);
  return stored[LAST_WORKSPACE_KEY] || null;
}

const FIRST_WORKSPACE_RELOAD_KEY = "lovaburstFirstWorkspaceReloadCompleted";

async function reloadFirstDetectedWorkspace(data) {
  if (!data?.lovableProjectId || data.remembered) return false;
  const stored = await globalThis.LovaBurstStorage.get(FIRST_WORKSPACE_RELOAD_KEY);
  if (stored[FIRST_WORKSPACE_RELOAD_KEY]) return false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.startsWith("https://lovable.dev/") || !tab.url.includes(data.lovableProjectId)) return false;
  await globalThis.LovaBurstStorage.set({
    [FIRST_WORKSPACE_RELOAD_KEY]: {
      projectId: data.lovableProjectId,
      completedAt: new Date().toISOString(),
    },
  });
  await chrome.tabs.reload(tab.id);
  return true;
}

async function currentLovable() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Leaving Lovable must not clear the selected project. The last project remains
  // active until the user opens/switches to another concrete Lovable project.
  if (!tab?.id || !tab.url?.startsWith("https://lovable.dev/")) {
    const remembered = await lastWorkspace();
    return remembered
      ? { ...remembered, outsideLovable: false, remembered: true }
      : { outsideLovable: true };
  }

  const lovableProjectId = tab.url.match(/\/projects\/([A-Za-z0-9-]+)/i)?.[1] || "";
  if (!lovableProjectId) {
    const remembered = await lastWorkspace();
    return remembered
      ? { ...remembered, outsideLovable: false, remembered: true }
      : { outsideLovable: true };
  }

  try {
    const response = await globalThis.LovaBurstTabSafety.sendMessage(tab.id, { type: "LOVABURST_CONTENT_PING" });
    if (response?.ok && response.source === "lovable") {
      return rememberLastWorkspace({
        repository: response.repository || "",
        lovableProjectId: response.lovableProjectId || lovableProjectId,
        sourceTitle: tab.title || "",
        sourceUrl: tab.url || "",
        githubConnectionState: response.githubConnectionState || "unknown",
      });
    }
  } catch {}

  const stored = await globalThis.LovaBurstStorage.get("workspaceBindings");
  return rememberLastWorkspace({
    repository: stored.workspaceBindings?.[lovableProjectId]?.repository || "",
    lovableProjectId,
    sourceTitle: tab.title || "",
    sourceUrl: tab.url || "",
    githubConnectionState: stored.workspaceBindings?.[lovableProjectId]?.githubConnectionState || "unknown",
  });
}

function renderWorkspace(data = {}) {
  workspace = {
    repository: data.repository || "",
    lovableProjectId: data.lovableProjectId || "",
    sourceTitle: data.sourceTitle || "",
    sourceUrl: data.sourceUrl || "",
    githubConnectionState: data.githubConnectionState || "unknown",
    outsideLovable: Boolean(data.outsideLovable),
  };

  ui.project.textContent = workspace.lovableProjectId || "—";
  ui.refreshRepo.disabled = !workspace.lovableProjectId;

  if (workspace.outsideLovable) {
    ui.repo.textContent = "Abra um projeto no Lovable";
    ui.repoState.textContent = "Sem projeto";
    ui.repoState.className = "state-pill is-empty";
  } else if (data.detecting) {
    ui.repo.textContent = "Detectando repositório…";
    ui.repoState.textContent = "Atualizando";
    ui.repoState.className = "state-pill";
  } else if (workspace.githubConnectionState === "disconnected") {
    ui.repo.textContent = "Projeto não conectado";
    ui.repoState.textContent = "Não conectado";
    ui.repoState.className = "state-pill is-empty";
  } else if (workspace.repository) {
    ui.repo.textContent = workspace.repository;
    ui.repoState.textContent = data.remembered ? "Projeto ativo" : "Conectado";
    ui.repoState.className = "state-pill is-connected";
  } else {
    ui.repo.textContent = "Repositório não detectado";
    ui.repoState.textContent = "Sem GitHub";
    ui.repoState.className = "state-pill is-empty";
  }
}

async function refreshWorkspace() {
  if (refreshingWorkspace) return;
  refreshingWorkspace = true;
  try {
    const detectedWorkspace = await currentLovable();
    renderWorkspace(detectedWorkspace);
    if (await reloadFirstDetectedWorkspace(detectedWorkspace)) return;
    await refreshRunStatus();
    await renderSkills();
  } finally {
    refreshingWorkspace = false;
  }
}

async function restoreActiveConversation(rec) {
  const projectId = workspace.lovableProjectId;
  const conversation = active(rec);
  if (!projectId || !conversation) return rec;

  const tab = await resolveTab(conversation);
  if (!tab?.id) return rec;

  try {
    await activateRelay(tab.id);
  } catch {}
  return rec;
}
