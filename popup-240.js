"use strict";

(() => {
  if (globalThis.__LOVABURST_240__) return;
  globalThis.__LOVABURST_240__ = true;

  const $ = (selector, root = document) => root.querySelector(selector);
  const version = chrome.runtime.getManifest().version || "";
  let releaseCache = null;
  let healthInFlight = null;

  function compareVersions(a, b) {
    const pa = String(a || "").split(/[+-]/)[0].split(".").map((x) => Number(x) || 0);
    const pb = String(b || "").split(/[+-]/)[0].split(".").map((x) => Number(x) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
      const av = pa[i] || 0, bv = pb[i] || 0;
      if (av !== bv) return av > bv ? 1 : -1;
    }
    return 0;
  }

  function feedback(text, type = "") {
    if (typeof showFeedback === "function") showFeedback(text, type);
  }

  function commandInput() { return document.getElementById("commandInput"); }
  function sendButton() { return document.getElementById("sendCommandButton"); }

  function setStatusCell(root, key, state, value, detail = "") {
    const cell = root.querySelector(`[data-health="${key}"]`);
    if (!cell) return;
    cell.dataset.state = state || "idle";
    const valueNode = cell.querySelector("strong");
    const detailNode = cell.querySelector("small");
    if (valueNode) valueNode.textContent = value;
    if (detailNode) detailNode.textContent = detail;
  }

  function formatDate(value) {
    const d = value ? new Date(value) : null;
    return d && !Number.isNaN(d.valueOf()) ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
  }

  async function getReleaseInfo() {
    const response = await chrome.runtime.sendMessage({ type: "LOVABURST_AUTHORITY_RELEASE_INFO" });
    if (!response?.ok || !response.release) throw new Error(response?.error || "Update Center indisponível.");
    releaseCache = response.release;
    return releaseCache;
  }

  async function getHealth() {
    if (healthInFlight) return healthInFlight;
    healthInFlight = chrome.runtime.sendMessage({ type: "LOVABURST_AUTHORITY_HEALTH" })
      .then((response) => {
        if (!response?.ok || !response.health) throw new Error(response?.error || "Security Center indisponível.");
        return response.health;
      })
      .finally(() => { healthInFlight = null; });
    return healthInFlight;
  }

  function renderRelease(release) {
    const securityCenter = document.getElementById("lbSecurityCenter");
    if (securityCenter && release?.features?.securityCenter === false) securityCenter.hidden = true;
    const banner = document.getElementById("updateBanner");
    const title = document.getElementById("updateTitle");
    const text = document.getElementById("updateText");
    if (!banner || !title || !text || !release) return;
    if (release?.features?.updateCenter === false) { banner.hidden = true; return; }
    if (release.maintenance) {
      banner.hidden = false;
      banner.dataset.mode = "maintenance";
      title.textContent = "Manutenção de segurança";
      text.textContent = release.maintenanceMessage || "As operações premium estão temporariamente pausadas.";
      return;
    }
    const latest = String(release.latestVersion || "");
    if (latest && compareVersions(latest, version) > 0) {
      banner.hidden = false;
      banner.dataset.mode = "update";
      title.textContent = `LovaBurst v${latest} disponível`;
      text.textContent = release.releaseNotes || "Uma nova versão oficial está disponível.";
      let action = banner.querySelector("[data-update-check]");
      if (!action) {
        action = document.createElement("button");
        action.type = "button";
        action.dataset.updateCheck = "true";
        action.textContent = "Verificar agora";
        action.addEventListener("click", async (event) => {
          event.stopPropagation();
          action.disabled = true;
          try {
            if (typeof chrome.runtime.requestUpdateCheck === "function") {
              const result = await chrome.runtime.requestUpdateCheck();
              const status = typeof result === "string" ? result : result?.status;
              feedback(status === "update_available" ? "Atualização encontrada. O Chrome fará a instalação." : "Verificação de atualização concluída.");
            } else feedback("A atualização automática será verificada pelo Chrome.");
          } catch { feedback("O Chrome fará a verificação automática da atualização."); }
          finally { action.disabled = false; }
        });
        banner.append(action);
      }
      action.hidden = false;
      return;
    }
    banner.dataset.mode = "current";
    banner.querySelector("[data-update-check]")?.setAttribute("hidden", "");
    banner.hidden = true;
  }

  async function refreshSecurityCenter({ announce = false } = {}) {
    const root = document.getElementById("lbSecurityCenter");
    if (!root) return;
    const button = root.querySelector("[data-security-refresh]");
    if (button) button.disabled = true;
    root.dataset.loading = "true";
    try {
      const [releaseResult, healthResult] = await Promise.allSettled([getReleaseInfo(), getHealth()]);
      const release = releaseResult.status === "fulfilled" ? releaseResult.value : releaseCache;
      if (release) renderRelease(release);
      if (healthResult.status === "fulfilled") {
        const h = healthResult.value;
        const rel = h.release || release || {};
        setStatusCell(root, "authority", h.authorityOnline ? "ok" : "error", h.authorityOnline ? "Online" : "Offline", "Authority respondeu com sessão assinada");
        setStatusCell(root, "license", h.license?.active ? "ok" : "error", h.license?.active ? "Ativa" : "Bloqueada", h.license?.expiresAt ? `Expira ${formatDate(h.license.expiresAt)}` : "Sem expiração definida");
        setStatusCell(root, "device", h.device?.bound ? "ok" : "error", h.device?.bound ? "Vinculado" : "Não vinculado", h.device?.extensionVersion ? `Cliente v${h.device.extensionVersion}` : "Identidade ECDSA do dispositivo");
        const latest = String(rel.latestVersion || version);
        setStatusCell(root, "version", compareVersions(version, latest) >= 0 ? "ok" : "warn", `v${version}`, latest === version ? "Versão atual" : `Mais recente: v${latest}`);
        const policy = root.querySelector("[data-policy-note]");
        if (policy) policy.textContent = rel.maintenance ? (rel.maintenanceMessage || "Manutenção ativa") : rel.premiumEnabled === false ? "Operações premium pausadas pelo servidor." : "Política remota ativa · kill-switch disponível no backend.";
        if (announce) feedback("Security Center verificado com sucesso.");
      } else {
        setStatusCell(root, "authority", "error", "Indisponível", healthResult.reason?.message || "Não foi possível verificar a sessão.");
        if (announce) feedback(healthResult.reason?.message || "Não foi possível verificar o Security Center.", "error");
      }
    } finally {
      root.dataset.loading = "false";
      if (button) button.disabled = false;
    }
  }

  function buildSecurityCenter() {
    const panel = document.getElementById("lbSettingsPanel");
    if (!panel || document.getElementById("lbSecurityCenter")) return;
    const section = document.createElement("section");
    section.id = "lbSecurityCenter";
    section.className = "lb-security-center";
    section.innerHTML = `
      <div class="lb-security-head"><div><span>// SECURITY CENTER</span><strong>Proteção e autoridade</strong><small data-policy-note>Verificando política remota…</small></div><button type="button" data-security-refresh>Verificar agora</button></div>
      <div class="lb-health-grid">
        <article data-health="authority"><span>SERVIDOR</span><strong>—</strong><small>Verificando conexão</small></article>
        <article data-health="license"><span>LICENÇA</span><strong>—</strong><small>Verificando estado</small></article>
        <article data-health="device"><span>DISPOSITIVO</span><strong>—</strong><small>Verificando vínculo</small></article>
        <article data-health="version"><span>VERSÃO</span><strong>v${version}</strong><small>Verificando release</small></article>
      </div>
      <div class="lb-security-actions"><button type="button" data-repair>Reparar conexões</button><small>Revalida integrações locais e consulta novamente a autoridade.</small></div>`;
    panel.append(section);
    section.querySelector("[data-security-refresh]")?.addEventListener("click", () => void refreshSecurityCenter({ announce: true }));
    section.querySelector("[data-repair]")?.addEventListener("click", async () => {
      const button = section.querySelector("[data-repair]");
      if (button) button.disabled = true;
      try {
        document.getElementById("refreshDataButton")?.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        await refreshSecurityCenter({ announce: false });
        feedback("Conexões revalidadas.");
      } finally { if (button) button.disabled = false; }
    });
  }

  function decorateHistory() {
    const list = document.getElementById("historyList");
    if (!list) return;
    for (const row of list.querySelectorAll(".history-item")) {
      if (row.dataset.retryReady === "true") continue;
      row.dataset.retryReady = "true";
      const text = String(row.querySelector("p")?.textContent || "").trim();
      if (!text) continue;
      const actions = document.createElement("div");
      actions.className = "lb-history-actions";
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "↻ Repetir"; retry.title = "Executar novamente com uma nova autorização do servidor";
      const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Editar";
      if (releaseCache?.features?.safeRetry === false) retry.hidden = true;
      retry.addEventListener("click", () => {
        document.getElementById("chatTabButton")?.click();
        const input = commandInput(); if (!input) return;
        input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
        window.setTimeout(() => sendButton()?.click(), 80);
      });
      edit.addEventListener("click", () => {
        document.getElementById("chatTabButton")?.click();
        const input = commandInput(); if (!input) return;
        input.value = text; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
      });
      actions.append(retry, edit);
      row.append(actions);
    }
  }

  function watchHistory() {
    const panel = document.getElementById("historyPanel");
    if (!panel) return;
    const observer = new MutationObserver(decorateHistory);
    observer.observe(panel, { childList: true, subtree: true });
    decorateHistory();
  }

  async function initRelease() {
    try { renderRelease(await getReleaseInfo()); } catch {}
  }

  function init() {
    // 3.0.1 keeps advanced security in Settings and a simple Agent as the only new workflow.
    buildSecurityCenter();
    watchHistory();
    void initRelease();
    window.setInterval(() => void initRelease(), 60_000);
    const settings = document.getElementById("settingsButton");
    settings?.addEventListener("click", () => setTimeout(() => void refreshSecurityCenter({ announce: false }), 80));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
