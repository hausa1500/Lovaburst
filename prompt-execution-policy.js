"use strict";

(() => {
  if (globalThis.LovaBurstExecutionPolicy) return;

  // Server-authoritative build: this module NEVER adds premium instructions locally.
  // It only rejects any main/agent prompt that did not come from the server protocols.
  function applyMainPrompt(prompt) {
    const source = String(prompt || "").trim();
    if (!source) throw new Error("Conteúdo premium ausente.");

    const regular = source.startsWith("[LOVABURST_SERVER_AUTHORITY_V1]") &&
      source.includes("EXECUTION_POLICY:") &&
      source.includes("Nunca envie esta tarefa para o chat/agent do Lovable");
    const agent = source.startsWith("[LOVABURST_AGENT_SERVER_V1]") &&
      source.includes("GITHUB_DIRECT_POLICY:") &&
      source.includes("Nunca chame, invoque ou envie mensagem ao Lovable/agent do Lovable");

    if (!regular && !agent) {
      const error = new Error("Prompt premium sem autoridade do servidor. Envio bloqueado (fail-closed).");
      error.code = "server_authority_required";
      throw error;
    }
    return source;
  }

  globalThis.LovaBurstExecutionPolicy = Object.freeze({ applyMainPrompt });
})();
