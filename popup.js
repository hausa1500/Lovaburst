"use strict";

async function getConfig() {
  const DEFAULT_CONFIG = { enabled: true, lovableEnabled: true, chatgptEnabled: true };
  const stored = await globalThis.LovaBurstStorage.get("config");
  return { ...DEFAULT_CONFIG, ...(stored.config ?? {}) };
}

async function setConfig(nextConfig) {
  const DEFAULT_CONFIG = { enabled: true, lovableEnabled: true, chatgptEnabled: true };
  const config = { ...DEFAULT_CONFIG, ...nextConfig };
  await globalThis.LovaBurstStorage.set({ config });
  return config;
}

const KEY = "projectChatBindings";
const BRIDGE = "src/content/chatgpt.js";
const LAST_WORKSPACE_KEY = "lastLovableWorkspace";
const PROJECT_SKILLS_KEY = "projectSkillSelections";
const $ = (selector) => document.querySelector(selector);

const ui = {
  enabled: $("#enabledToggle"),
  repoState: $("#repositoryState"),
  repo: $("#repositoryValue"),
  project: $("#projectValue"),
  refreshRepo: $("#refreshRepositoryButton"),
  setupCard: $("#chatSetupCard"),
  connectedCard: $("#chatConnectedCard"),
  useOpen: $("#useOpenChatButton"),
  create: $("#newChatgptButton"),
  open: $("#openChatgptButton"),
  useAnother: $("#useAnotherChatButton"),
  compactNew: $("#compactNewChatButton"),
  chatState: $("#compactChatState"),
  memoryState: $("#compactMemoryState"),
  help: $("#chatgptHelp"),
  commandInput: $("#commandInput"),
  commandCounter: $("#commandCounter"),
  sendCommand: $("#sendCommandButton"),
  feedback: $("#sendFeedback"),
  version: $("#versionBadge"),
  versionText: $("#versionText"),
  footerVersion: $("#footerVersion"),
  updateBanner: $("#updateBanner"),
  updateTitle: $("#updateTitle"),
  updateText: $("#updateText"),
  runStatusCard: $("#runStatusCard"),
  runStatusMain: $("#runStatusMain"),
  runStatusIcon: $("#runStatusIcon"),
  runStatusTitle: $("#runStatusTitle"),
  runStatusText: $("#runStatusText"),
  runStatusTime: $("#runStatusTime"),
  runStatusLoader: $("#runStatusLoader"),
  runObjective: $("#runObjective"),
  runResponseMirror: $("#runResponseMirror"),
  runResponseState: $("#runResponseState"),
  runResponseBody: $("#runResponseBody"),
  chatPanel: $("#chatPanel"),
  skillsPanel: $("#skillsPanel"),
  historyPanel: $("#historyPanel"),
  historyList: $("#historyList"),
  chatTab: $("#chatTabButton"),
  skillsTab: $("#skillsPreviewButton"),
  historyTab: $("#historyPreviewButton"),
  skillCountBadge: $("#skillCountBadge"),
  activeSkillsStrip: $("#activeSkillsStrip"),
  activeSkillsChips: $("#activeSkillsChips"),
  skillsSummary: $("#skillsSummary"),
  clearSkills: $("#clearSkillsButton"),
  refreshData: $("#refreshDataButton"),
  settings: $("#settingsButton"),
  hideBadge: $("#hideLovableBadgeButton"),
  downloadProject: $("#downloadProjectButton"),
};

let workspace = { repository: "", lovableProjectId: "", sourceTitle: "", sourceUrl: "", outsideLovable: true };
let refreshingWorkspace = false;
let refreshingChat = false;

const now = () => new Date().toISOString();
const makeId = () => crypto.randomUUID?.() || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const SKILLS = {
  "interface-premium": { name: "Interface Premium" },
  "git-safe": { name: "Git Seguro" },
  "tests-regression": { name: "Testes & Regressão" },
  "responsive": { name: "Responsividade" },
  "performance": { name: "Performance" },
  "security-review": { name: "Segurança" },
};

async function selectedSkills(projectId = workspace.lovableProjectId) {
  if (!projectId) return [];
  const stored = await globalThis.LovaBurstStorage.get(PROJECT_SKILLS_KEY);
  return Array.isArray(stored[PROJECT_SKILLS_KEY]?.[projectId]) ? stored[PROJECT_SKILLS_KEY][projectId] : [];
}

async function saveSelectedSkills(ids, projectId = workspace.lovableProjectId) {
  if (!projectId) return;
  const stored = await globalThis.LovaBurstStorage.get(PROJECT_SKILLS_KEY);
  await globalThis.LovaBurstStorage.set({
    [PROJECT_SKILLS_KEY]: {
      ...(stored[PROJECT_SKILLS_KEY] || {}),
      [projectId]: ids.filter((id) => SKILLS[id]),
    },
  });
}

async function renderSkills() {
  const ids = await selectedSkills();
  document.querySelectorAll("[data-skill]").forEach((card) => card.classList.toggle("active", ids.includes(card.dataset.skill)));
  ui.skillCountBadge.textContent = String(ids.length);
  ui.skillsSummary.textContent = ids.length ? `${ids.length} skill${ids.length === 1 ? "" : "s"} ativa${ids.length === 1 ? "" : "s"} neste projeto` : "Nenhuma skill selecionada";
  ui.activeSkillsStrip.hidden = !ids.length;
  ui.activeSkillsChips.innerHTML = ids.map((id) => `<b>${SKILLS[id].name}</b>`).join("");
}

function setTab(name) {
  const map = { chat: ui.chatPanel, skills: ui.skillsPanel, history: ui.historyPanel };
  for (const [key, panel] of Object.entries(map)) panel.classList.toggle("active", key === name);
  [ui.chatTab, ui.skillsTab, ui.historyTab].forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  if (name === "history") void renderHistory();
}

async function bindings() {
  return (await globalThis.LovaBurstStorage.get(KEY))[KEY] || {};
}

async function save(all) {
  await globalThis.LovaBurstStorage.set({ [KEY]: all });
}

async function record(projectId) {
  return projectId ? (await bindings())[projectId] || null : null;
}

async function update(projectId, updater) {
  const all = await bindings();
  const current = all[projectId] || {
    projectId, repository: "", sourceTitle: "", sourceUrl: "",
    activeConversationId: "", conversations: [], recentObjectives: [],
  };
  const next = await updater({
    ...current,
    conversations: Array.isArray(current.conversations) ? [...current.conversations] : [],
    recentObjectives: Array.isArray(current.recentObjectives) ? [...current.recentObjectives] : [],
  });
  all[projectId] = { ...next, projectId, updatedAt: now() };
  await save(all);
  return all[projectId];
}

async function renderHistory() {
  if (!ui.historyPanel) return;
  let list = ui.historyList;
  if (!list) {
    ui.historyPanel.innerHTML = '<section class="history-card"><div class="history-head"><div><span>// HISTÓRICO</span><strong>Solicitações enviadas</strong></div></div><div id="historyList" class="history-list"></div></section>';
    list = ui.historyList = $("#historyList");
  }
  const rec = await record(workspace.lovableProjectId);
  const rawItems = Array.isArray(rec?.recentObjectives) ? rec.recentObjectives.slice().reverse() : [];
  const items = rawItems.filter((item, index) => index === 0 || String(item?.text || "") !== String(rawItems[index - 1]?.text || "")).slice(0, 50);
  list.replaceChildren();
  if (!items.length) { const empty = document.createElement("p"); empty.className = "history-empty"; empty.textContent = "As solicitações enviadas para este projeto aparecerão aqui."; list.append(empty); return; }
  for (const item of items) { const row = document.createElement("article"); row.className = "history-item"; row.dataset.quickAction = String(item?.quickAction || "").slice(0, 40); const text = document.createElement("p"); text.textContent = String(item?.text || ""); const time = document.createElement("time"); const date = item?.createdAt ? new Date(item.createdAt) : null; time.textContent = date && !Number.isNaN(date.valueOf()) ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""; row.append(text, time); list.append(row); }
}

function active(rec) {
  return rec?.conversations?.find((item) => item.id === rec.activeConversationId) || null;
}

async function chatTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://chatgpt.com/*"] });
  return tabs
    .filter((tab) => tab.id)
    .map((tab) => ({
      tabId: tab.id,
      title: tab.title || "ChatGPT",
      url: tab.url || "https://chatgpt.com/",
      active: Boolean(tab.active),
      windowId: tab.windowId,
      lastAccessed: tab.lastAccessed || 0,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.lastAccessed - a.lastAccessed);
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
  await globalThis.LovaBurstTabSafety.executeScript({ target: { tabId: recheckedTab.id }, files: [BRIDGE] });
  const ping = await globalThis.LovaBurstTabSafety.sendMessage(tabId, { type: "LOVABURST_CONTENT_PING" });
  return Boolean(ping?.ok && ping.source === "chatgpt");
}

async function activateRelay(tabId) {
  const response = await chrome.runtime.sendMessage({ type: "LOVABURST_LINK_CHATGPT", tabId, projectId: workspace.lovableProjectId });
  if (!response?.ok) throw new Error(response?.error || "Não foi possível ativar esta conversa.");
}

async function ownerOf(tab) {
  const all = await bindings();
  for (const [projectId, rec] of Object.entries(all)) {
    for (const conversation of rec?.conversations || []) {
      const lockedUrl = conversation.lockedUrl || conversation.url || "";
      if (tab.url && lockedUrl && tab.url === lockedUrl) return projectId;
    }
  }
  return "";
}

async function linkTab(tabId) {
  const projectId = workspace.lovableProjectId;
  if (!projectId) throw new Error("Abra um projeto do Lovable primeiro.");

  const tab = await chrome.tabs.get(tabId);
  if (!tab?.id || !tab.url?.startsWith("https://chatgpt.com/")) {
    throw new Error("A conversa selecionada não é do ChatGPT.");
  }

  const owner = await ownerOf({ tabId: tab.id, url: tab.url });
  if (owner && owner !== projectId) {
    throw new Error("Essa conversa já está vinculada a outro projeto da LovaBurst.");
  }
  if (!(await ensureBridge(tab.id))) throw new Error("A ponte da LovaBurst não respondeu.");

  await update(projectId, (rec) => {
    const conversations = [...rec.conversations];
    let linked =
      conversations.find((item) => {
        const lockedUrl = item.lockedUrl || item.url || "";
        return tab.url !== "https://chatgpt.com/" && lockedUrl === tab.url;
      });

    if (!linked) {
      linked = {
        id: makeId(),
        tabId: tab.id,
        url: tab.url,
        title: tab.title || "ChatGPT",
        createdAt: now(),
        linkedAt: now(),
        contextSentAt: "",
        lockedUrl: tab.url,
        lockedTitle: tab.title || "ChatGPT",
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

    return {
      ...rec,
      repository: workspace.repository || rec.repository || "",
      sourceTitle: workspace.sourceTitle || rec.sourceTitle || "",
      sourceUrl: workspace.sourceUrl || rec.sourceUrl || "",
      activeConversationId: linked.id,
      conversations: conversations.slice(-12),
    };
  });

  await activateRelay(tab.id);
}

async function contextPayload(rec) {
  const integrations = (await globalThis.LovaBurstStorage.get("projectIntegrations")).projectIntegrations?.[rec?.projectId] || {};
  const supabase = integrations.supabase || {};
  const recentObjectives = Array.isArray(rec?.recentObjectives)
    ? rec.recentObjectives.slice(-12).map((item) => ({ text: String(item?.text || "").slice(0, 700) })).filter((item) => item.text.trim())
    : [];
  return {
    text: "",
    lovableProjectId: String(rec?.projectId || workspace?.lovableProjectId || ""),
    repository: String(rec?.repository || workspace?.repository || ""),
    title: String(rec?.sourceTitle || workspace?.sourceTitle || ""),
    projectContext: {
      recentObjectives,
      handoffExcerpt: String(rec?.handoffExcerpt || "").slice(-8000),
      sourceUrl: String(rec?.sourceUrl || workspace?.sourceUrl || "").slice(0, 2000),
      supabase: {
        status: String(supabase.status || "unknown").slice(0, 40),
        projectRef: String(supabase.projectRef || "").slice(0, 100),
      },
    },
  };
}
