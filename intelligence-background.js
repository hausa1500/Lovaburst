"use strict";

(() => {
  if (globalThis.__LOVABURST_INTELLIGENCE_BG__) return;
  globalThis.__LOVABURST_INTELLIGENCE_BG__ = true;

  const RUNNER_KEY = "lovaburstAgentRunnerStates";
  const inFlightProjects = new Set();
  const license = () => globalThis.LovaBurstLicense;

  const intelligence = async (action, payload = {}) => {
    const client = license();
    if (!client?.intelligenceRequest) throw new Error("Agent não inicializado.");
    return client.intelligenceRequest(action, payload);
  };

  async function runnerMap() {
    const stored = await globalThis.LovaBurstStorage.get(RUNNER_KEY);
    return stored[RUNNER_KEY] && typeof stored[RUNNER_KEY] === "object" ? stored[RUNNER_KEY] : {};
  }

  async function runnerState(projectId) {
    const map = await runnerMap();
    return map[String(projectId || "").trim()] || null;
  }

  async function setRunnerState(projectId, patch = {}) {
    const id = String(projectId || "").trim();
    if (!id) return null;
    const map = await runnerMap();
    const previous = map[id] || {};
    const next = {
      ...previous,
      ...patch,
      projectId: id,
      updatedAt: new Date().toISOString(),
    };
    map[id] = next;
    await globalThis.LovaBurstStorage.set({ [RUNNER_KEY]: map });
    return next;
  }

  async function dispatchMissionStep({ missionId, projectId, mode = "auto" }) {
    const id = String(projectId || "").trim();
    const mission = String(missionId || "").trim();
    if (!id || !mission) throw new Error("Missão inválida.");

    await setRunnerState(id, {
      missionId: mission,
      mode,
      status: "preparing",
      message: "Preparando a próxima etapa...",
      error: "",
    });

    const preflight = await globalThis.LovaBurstProjectDispatcher?.preflight?.(id);
    if (!preflight?.ok) throw new Error(preflight?.error || "Conecte uma conversa do ChatGPT a este projeto antes de executar o Agent.");

    const next = await intelligence("agent_next", { missionId: mission });
    if (next?.completed) {
      return setRunnerState(id, {
        missionId: mission,
        mode,
        status: "completed",
        message: "Missão concluída.",
        completionToken: "",
        stepIndex: Number(next?.mission?.current_step || 0),
        stepTitle: "",
        mission: next.mission || null,
        completedAt: new Date().toISOString(),
      });
    }

    const resolvedProjectId = String(next?.mission?.project_id || id).trim();
    const stepTitle = String(next?.step?.title || "Etapa");
    const stepDescription = String(next?.step?.description || "Execute esta etapa da missão.");
    const missionGoal = String(next?.mission?.user_goal || next?.mission?.title || "").trim();

    await setRunnerState(id, {
      missionId: mission,
      mode,
      status: "authorizing",
      message: "Autorizando etapa no servidor...",
      stepIndex: Number(next?.step?.index || 0),
      stepTitle,
      mission: next?.mission || null,
    });

    // Server-authoritative Agent: Project Intelligence only advances the mission.
    // The useful execution prompt is assembled exclusively by product-authority.
    if (String(next?.executionMode || "") !== "github-direct" || String(next?.protocol || "") !== "agent-github-v1") {
      throw new Error("O servidor não confirmou o modo de execução direta do Agent.");
    }
    const authorized = await license()?.dispatchOperation?.("agent-step", {
      missionId: mission,
      projectId: resolvedProjectId,
      stepIndex: Number(next?.step?.index || 0),
    });
    const directPrompt = String(authorized?.prompt || "");
    if (!directPrompt.startsWith("[LOVABURST_AGENT_SERVER_V1]") ||
        !directPrompt.includes("GITHUB_DIRECT_POLICY:") ||
        !directPrompt.includes("Nunca chame, invoque ou envie mensagem ao Lovable/agent do Lovable")) {
      throw new Error("A etapa premium do Agent não veio da autoridade server-side.");
    }

    await setRunnerState(id, {
      missionId: mission,
      mode,
      status: "dispatching",
      message: `Enviando: ${String(next?.step?.title || "etapa")}`,
      stepIndex: Number(next?.step?.index || 0),
      stepTitle: String(next?.step?.title || "Etapa"),
      mission: next?.mission || null,
    });

    const dispatched = await globalThis.LovaBurstProjectDispatcher?.dispatchAuthorized?.({
      projectId: resolvedProjectId,
      authorized,
      objective: next?.step?.title || next?.mission?.title || "Agent Mode",
    });
    if (!dispatched?.ok) throw new Error("Não foi possível despachar a etapa do Agent.");

    return setRunnerState(id, {
      missionId: mission,
      mode,
      status: "waiting",
      message: "Etapa enviada ao ChatGPT. Aguardando a conclusão real antes de continuar...",
      stepIndex: Number(next?.step?.index || 0),
      stepTitle: String(next?.step?.title || "Etapa"),
      requiresCommit: Boolean(next?.step?.requiresCommit),
      completionToken: String(dispatched.completionToken || authorized.completionToken || "").toLowerCase(),
      mission: next?.mission || null,
      dispatchedAt: dispatched.dispatchedAt || new Date().toISOString(),
      error: "",
    });
  }

  async function beginRun(message, mode = "auto") {
    const missionId = String(message.missionId || "").trim();
    const projectId = String(message.projectId || "").trim();
    if (!missionId || !projectId) throw new Error("Missão inválida.");
    if (inFlightProjects.has(projectId)) return { ok: true, runner: await runnerState(projectId) };
    const existing = await runnerState(projectId);
    if (["preparing", "authorizing", "dispatching", "waiting", "advancing"].includes(String(existing?.status || ""))) {
      return { ok: true, runner: existing };
    }

    inFlightProjects.add(projectId);
    try {
      const runner = await dispatchMissionStep({ missionId, projectId, mode });
      return { ok: true, runner };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const runner = await setRunnerState(projectId, {
        missionId,
        mode,
        status: "error",
        message: messageText,
        error: messageText,
      });
      return { ok: false, error: messageText, runner };
    } finally {
      inFlightProjects.delete(projectId);
    }
  }

  async function cancelMission(message) {
    const missionId = String(message.missionId || "").trim();
    const projectId = String(message.projectId || "").trim();
    const result = await intelligence("agent_cancel", { missionId });
    if (projectId) {
      await setRunnerState(projectId, {
        missionId,
        status: "cancelled",
        message: "Missão cancelada.",
        completionToken: "",
        mission: result?.mission || null,
        cancelledAt: new Date().toISOString(),
      });
    }
    return result;
  }

  async function onResult({ projectId, status, completionToken } = {}) {
    const id = String(projectId || "").trim();
    if (!id || inFlightProjects.has(id)) return;
    const runner = await runnerState(id);
    if (!runner || runner.status !== "waiting") return;
    const expected = String(runner.completionToken || "").toLowerCase();
    const actual = String(completionToken || "").toLowerCase();
    if (!expected || expected !== actual) return;

    if (status === "blocked" || status === "error") {
      await setRunnerState(id, {
        status,
        message: status === "blocked" ? "O ChatGPT pediu uma ação antes de continuar a missão." : "A etapa terminou com erro.",
        error: status === "error" ? "A etapa retornou erro no ChatGPT." : "",
        completionToken: "",
      });
      return;
    }
    if (status !== "done") return;

    if (runner.requiresCommit) {
      const stored = await globalThis.LovaBurstStorage.get("projectRunStatuses");
      const result = stored.projectRunStatuses?.[id] || {};
      const responseText = `${String(result.liveResponse || "")}\n${String(result.excerpt || "")}`;
      const commitPatterns = [
        /LOVABURST_COMMIT_SHA:\s*`?([a-f0-9]{40})`?/i,
        /\bcommit(?:\s+real|\s+sha)?\s*[:：=-]\s*`?([a-f0-9]{40})`?/i,
        /\bsha(?:\s+do\s+commit)?\s*[:：=-]\s*`?([a-f0-9]{40})`?/i,
      ];
      let commitSha = "";
      for (const pattern of commitPatterns) {
        const found = responseText.match(pattern)?.[1];
        if (found) { commitSha = found.toLowerCase(); break; }
      }
      if (!commitSha) {
        await setRunnerState(id, {
          status: "blocked",
          message: "A etapa não criou um commit GitHub real. O Agent não vai avançar.",
          error: "Commit GitHub obrigatório não confirmado.",
          completionToken: "",
        });
        return;
      }
      await setRunnerState(id, { commitSha });
    }

    inFlightProjects.add(id);
    try {
      await setRunnerState(id, {
        status: "advancing",
        message: "Etapa concluída. Atualizando a missão...",
        completionToken: "",
      });
      const ack = await intelligence("agent_dispatched", {
        missionId: runner.missionId,
        stepIndex: Number(runner.stepIndex || 0),
      });
      const mission = ack?.mission || runner.mission || null;
      if (["completed", "cancelled"].includes(String(mission?.status || ""))) {
        await setRunnerState(id, {
          status: String(mission?.status || "completed"),
          message: mission?.status === "cancelled" ? "Missão cancelada." : "Missão concluída com sucesso.",
          mission,
          stepIndex: Number(mission?.current_step || 0),
          stepTitle: "",
          completedAt: new Date().toISOString(),
        });
        return;
      }
      if (runner.mode === "auto") {
        await dispatchMissionStep({ missionId: runner.missionId, projectId: id, mode: "auto" });
      } else {
        await setRunnerState(id, {
          status: "ready",
          message: "Etapa concluída. Pronto para a próxima.",
          mission,
          stepIndex: Number(mission?.current_step || 0),
          stepTitle: "",
        });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await setRunnerState(id, {
        status: "error",
        message: messageText,
        error: messageText,
        completionToken: "",
      });
    } finally {
      inFlightProjects.delete(id);
    }
  }

  const handlers = {
    LOVABURST_INTELLIGENCE_AGENT_START: (m) => intelligence("agent_start", {
      projectId: m.projectId,
      goal: String(m.goal || "").slice(0, 25_000),
      title: String(m.title || "").slice(0, 140),
      repository: m.repository || "",
      sourceTitle: m.sourceTitle || "",
      sourceUrl: m.sourceUrl || "",
      supabaseStatus: m.supabaseStatus || "unknown",
      supabaseProjectRef: m.supabaseProjectRef || "",
    }),
    LOVABURST_INTELLIGENCE_AGENT_GET: (m) => intelligence("agent_get", { missionId: m.missionId }),
    LOVABURST_INTELLIGENCE_AGENT_NEXT: (m) => beginRun(m, "single"),
    LOVABURST_INTELLIGENCE_AGENT_RUN: (m) => beginRun(m, "auto"),
    LOVABURST_INTELLIGENCE_AGENT_RUNNER_STATUS: async (m) => ({ runner: await runnerState(m.projectId) }),
    LOVABURST_INTELLIGENCE_AGENT_CANCEL: cancelMission,
  };

  globalThis.LovaBurstAgentRunner = Object.freeze({ onResult, state: runnerState });

  globalThis.LovaBurstMessageGate.addListener((message, _sender, sendResponse) => {
    const handler = handlers[message?.type];
    if (!handler) return false;
    Promise.resolve(handler(message))
      .then((data) => sendResponse({ ok: data?.ok !== false, ...data }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), code: error?.code || "" }));
    return true;
  });
})();
