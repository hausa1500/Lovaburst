"use strict";

(() => {
  if (globalThis.__LOVABURST_300__) return;
  globalThis.__LOVABURST_300__ = true;

  const RUNNER_KEY = "lovaburstAgentRunnerStates";
  const state = { mission: null, runner: null };
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function feedback(text, type = "") {
    if (typeof showFeedback === "function") showFeedback(String(text || ""), type);
  }

  function projectId() {
    const fromWorkspace = typeof workspace !== "undefined" ? String(workspace?.lovableProjectId || "") : "";
    return (fromWorkspace || String($("#projectValue")?.textContent || "")).trim().replace(/^—$/, "");
  }

  async function projectMeta() {
    const id = projectId();
    const repository = (typeof workspace !== "undefined" ? String(workspace?.repository || "") : "") || String($("#repositoryValue")?.textContent || "");
    const sourceTitle = typeof workspace !== "undefined" ? String(workspace?.sourceTitle || "") : "";
    const sourceUrl = typeof workspace !== "undefined" ? String(workspace?.sourceUrl || "") : "";
    let supabaseStatus = "unknown", supabaseProjectRef = "";
    try {
      const stored = await globalThis.LovaBurstStorage.get("projectIntegrations");
      const supabase = stored.projectIntegrations?.[id]?.supabase || {};
      supabaseStatus = String(supabase.status || "unknown");
      supabaseProjectRef = String(supabase.projectRef || "");
    } catch {}
    return {
      projectId: id,
      repository: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.trim()) ? repository.trim() : "",
      sourceTitle,
      sourceUrl,
      supabaseStatus,
      supabaseProjectRef,
    };
  }

  async function send(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || "Agent indisponível no momento.");
    return response;
  }

  async function missionStore() {
    try {
      const stored = await globalThis.LovaBurstStorage.get("lovaburstAgentMissionIds");
      return stored.lovaburstAgentMissionIds && typeof stored.lovaburstAgentMissionIds === "object" ? stored.lovaburstAgentMissionIds : {};
    } catch { return {}; }
  }

  async function rememberMission(project, missionId) {
    if (!project) return;
    const map = await missionStore();
    if (missionId) map[project] = missionId;
    else delete map[project];
    await globalThis.LovaBurstStorage.set({ lovaburstAgentMissionIds: map }).catch(() => {});
  }

  async function loadRunner() {
    const id = projectId();
    if (!id) return null;
    try {
      const stored = await globalThis.LovaBurstStorage.get(RUNNER_KEY);
      return stored[RUNNER_KEY]?.[id] || null;
    } catch { return null; }
  }

  function runnerActive() {
    return ["preparing", "authorizing", "dispatching", "waiting", "advancing"].includes(String(state.runner?.status || ""));
  }

  function runnerLabel() {
    const status = String(state.runner?.status || "");
    const map = {
      preparing: "Preparando etapa...",
      authorizing: "Validando autorização...",
      dispatching: "Enviando ao ChatGPT...",
      waiting: "Aguardando o ChatGPT concluir esta etapa...",
      advancing: "Etapa concluída. Preparando a próxima...",
      ready: "Pronto para continuar.",
      completed: "Missão concluída com sucesso.",
      blocked: "O ChatGPT pediu uma ação antes de continuar.",
      error: state.runner?.error || state.runner?.message || "A missão encontrou um erro.",
      cancelled: "Missão cancelada.",
    };
    return map[status] || String(state.runner?.message || "");
  }

  function buildAgentCard() {
    if ($("#lb30Agent")) return;
    const anchor = $(".project-card");
    if (!anchor) return;
    const card = document.createElement("section");
    card.id = "lb30Agent";
    card.className = "lb30-agent-card";
    card.innerHTML = `
      <div class="lb30-agent-head">
        <div><span>// AGENT MODE</span><strong>LovaBurst Agent</strong><small>Descreva uma tarefa maior. O Agent executa as etapas em sequência e só avança quando a anterior terminar.</small></div>
        <b>3.0.14</b>
      </div>
      <textarea data-lb30-agent-goal rows="3" maxlength="25000" placeholder="Ex: revise o código, melhore a estrutura e valide se nada quebrou..."></textarea>
      <button class="lb30-agent-start" type="button" data-lb30-agent-start>Criar e executar missão</button>
      <div class="lb30-agent-note">Usa a conversa do ChatGPT vinculada a este projeto.</div>
      <div class="lb30-mission" data-lb30-mission><div class="lb30-empty">Nenhuma missão ativa.</div></div>`;
    anchor.after(card);
    $("[data-lb30-agent-start]", card)?.addEventListener("click", () => void startMission());
  }

  function missionDone(mission) {
    return ["completed", "cancelled"].includes(String(mission?.status || ""));
  }

  function stepState(index, current, done) {
    if (index < current) return "done";
    if (!done && index === current && runnerActive()) return "running";
    if (!done && index === current) return "current";
    return "queued";
  }

  function renderMission() {
    const root = $("[data-lb30-mission]");
    if (!root) return;
    const mission = state.mission;
    if (!mission) {
      root.innerHTML = '<div class="lb30-empty">Nenhuma missão ativa.</div>';
      return;
    }
    const steps = Array.isArray(mission.plan) ? mission.plan : [];
    const current = Math.max(0, Number(mission.current_step || 0));
    const done = missionDone(mission) || String(state.runner?.status || "") === "completed";
    const label = runnerLabel();
    const runnerStatus = String(state.runner?.status || "");
    const canRun = !done && !runnerActive();
    const runText = ["error", "blocked"].includes(runnerStatus) ? "Tentar esta etapa novamente" : current > 0 ? "Continuar missão" : "Executar missão";

    root.innerHTML = `
      <div class="lb30-mission-title">
        <div><strong>${esc(mission.title || "Missão")}</strong><small>${done ? "Finalizada" : `${Math.min(current, steps.length)}/${steps.length} etapas concluídas`}</small></div>
        <span>${done ? "DONE" : runnerActive() ? "RUNNING" : "ACTIVE"}</span>
      </div>
      ${label ? `<div class="lb30-runner-status" data-status="${esc(runnerStatus || "idle")}"><i></i><span>${esc(label)}</span></div>` : ""}
      <div class="lb30-steps">${steps.map((step, index) => {
        const s = stepState(index, current, done);
        const icon = s === "done" ? "✓" : s === "running" ? "•" : index + 1;
        const stateText = s === "done" ? "Concluída" : s === "running" ? "Executando..." : s === "current" ? "Próxima" : "Aguardando";
        return `<article data-state="${s}"><i>${icon}</i><div><strong>${esc(step.title || `Etapa ${index + 1}`)}</strong><small>${esc(step.description || "")}</small><em>${stateText}</em></div></article>`;
      }).join("")}</div>
      <div class="lb30-mission-actions">${done
        ? '<button type="button" data-agent-new>Nova missão</button>'
        : `<button type="button" data-agent-run ${canRun ? "" : "disabled"}>${esc(runnerActive() ? "Executando missão..." : runText)}</button><button type="button" data-agent-cancel>Cancelar</button>`}
      </div>`;

    $("[data-agent-run]", root)?.addEventListener("click", () => void runMission());
    $("[data-agent-cancel]", root)?.addEventListener("click", () => void cancelMission());
    $("[data-agent-new]", root)?.addEventListener("click", async () => {
      await rememberMission(projectId(), "");
      state.mission = null;
      state.runner = null;
      renderMission();
      $("[data-lb30-agent-goal]")?.focus();
    });
  }

  async function refreshRunner() {
    state.runner = await loadRunner();
    if (state.runner?.mission) state.mission = state.runner.mission;
    renderMission();
  }

  async function startMission() {
    const goal = String($("[data-lb30-agent-goal]")?.value || "").trim();
    const meta = await projectMeta();
    if (!meta.projectId) return feedback("Abra um projeto do Lovable antes de iniciar o Agent.", "error");
    if (!goal) return $("[data-lb30-agent-goal]")?.focus();
    const button = $("[data-lb30-agent-start]");
    if (button) { button.disabled = true; button.textContent = "Criando missão..."; }
    try {
      const response = await send("LOVABURST_INTELLIGENCE_AGENT_START", { ...meta, goal, title: goal.slice(0, 90) });
      state.mission = response.mission || null;
      if (state.mission?.id) await rememberMission(meta.projectId, state.mission.id);
      if ($("[data-lb30-agent-goal]")) $("[data-lb30-agent-goal]").value = "";
      renderMission();
      await runMission();
    } catch (error) {
      feedback(error.message, "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Criar e executar missão"; }
    }
  }

  async function runMission() {
    if (!state.mission?.id) return;
    const id = projectId();
    if (!id) return feedback("Abra o projeto do Lovable antes de executar a missão.", "error");
    state.runner = { ...(state.runner || {}), status: "preparing", message: "Preparando a missão..." };
    renderMission();
    try {
      const response = await send("LOVABURST_INTELLIGENCE_AGENT_RUN", { missionId: state.mission.id, projectId: id });
      state.runner = response.runner || state.runner;
      if (state.runner?.mission) state.mission = state.runner.mission;
      renderMission();
      if (state.runner?.status === "error") feedback(state.runner.error || state.runner.message, "error");
      else feedback("Missão iniciada. O Agent continuará automaticamente após cada etapa.", "success");
    } catch (error) {
      state.runner = { ...(state.runner || {}), status: "error", message: error.message, error: error.message };
      renderMission();
      feedback(error.message, "error");
    }
  }

  async function cancelMission() {
    if (!state.mission?.id) return;
    try {
      const response = await send("LOVABURST_INTELLIGENCE_AGENT_CANCEL", { missionId: state.mission.id, projectId: projectId() });
      state.mission = response.mission || { ...state.mission, status: "cancelled" };
      state.runner = { ...(state.runner || {}), status: "cancelled", message: "Missão cancelada." };
      renderMission();
      feedback("Missão cancelada.");
    } catch (error) { feedback(error.message, "error"); }
  }

  async function restoreMission() {
    const id = projectId();
    if (!id) return;
    const map = await missionStore();
    const missionId = String(map[id] || "");
    if (missionId) {
      try {
        const response = await send("LOVABURST_INTELLIGENCE_AGENT_GET", { missionId });
        state.mission = response.mission || null;
      } catch {
        await rememberMission(id, "");
      }
    }
    state.runner = await loadRunner();
    if (state.runner?.mission) state.mission = state.runner.mission;
    renderMission();
  }

  function onStorageChanged(changes, area) {
    if (area !== "local" || !changes?.[RUNNER_KEY]) return;
    const id = projectId();
    if (!id) return;
    state.runner = changes[RUNNER_KEY].newValue?.[id] || null;
    if (state.runner?.mission) state.mission = state.runner.mission;
    renderMission();
  }

  function init() {
    buildAgentCard();
    void restoreMission();
    chrome.storage.onChanged.addListener(onStorageChanged);
    window.setTimeout(buildAgentCard, 450);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
