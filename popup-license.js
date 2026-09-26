/*
 * LovaBurst — embedded rights notice (fragment D).
 * The modification authorization covers source, implementation logic, configuration, scripts, assets, documentation, tests, internal APIs, architecture and code organization, subject to applicable law and separate agreements.
 * Original authorship/copyright must not be falsely claimed.
 * This fragment is integrity-covered by the runtime guard.
 */
(() => {
  const gate = document.getElementById("licenseGate");
  const shell = document.querySelector(".app-shell");
  const form = document.getElementById("licenseForm");
  const input = document.getElementById("licenseKeyInput");
  const button = document.getElementById("licenseActivateButton");
  const feedback = document.getElementById("licenseFeedback");
  const releaseLink = document.getElementById("licenseReleaseLink");
  const summary = document.getElementById("licenseDetailsSummary");
  const statusText = document.getElementById("licenseDetailsStatusText");
  const expiryValue = document.getElementById("licenseDetailsExpiryValue");
  const statusValue = document.getElementById("licenseDetailsStatusValue");
  const customerNameInput = document.getElementById("licenseCustomerNameInput");
  const MAX_ACTIVATION_ATTEMPTS = 10;
  let activationAttempts = 0;
  let activationInFlight = false;
  let activationSucceeded = false;
  let statusGeneration = 0;

  const attemptsMessage = () => "Muitas tentativas nesta abertura. Feche e abra a extensão para tentar novamente.";

  if (summary && expiryValue && statusValue) {
    const clientBlock = summary.firstElementChild;
    const statusLabel = summary.querySelector(".license-summary-status-label");
    const clientLabel = clientBlock?.querySelector(":scope > span");
    const clientName = clientBlock?.querySelector(":scope > strong");
    const expiryRow = document.createElement("div");
    expiryRow.className = "license-expiry-row";
    const expiryLabel = document.createElement("span");
    expiryLabel.textContent = "Expira em:";
    expiryRow.append(expiryLabel, expiryValue);
    const statusRow = document.createElement("div");
    statusRow.className = "license-status-row";
    if (statusLabel) statusRow.append(statusLabel);
    statusRow.append(statusValue);
    const left = document.createElement("div");
    left.className = "license-client-block";
    if (clientLabel) left.append(clientLabel);
    if (clientName) left.append(clientName);
    const right = document.createElement("div");
    right.className = "license-status-stack";
    right.append(expiryRow, statusRow);
    summary.replaceChildren(left, right);
  }

  const renderLicenseSummary = (status) => {
    if (!summary) return;
    const valid = Boolean(status?.valid);
    summary.hidden = !valid;
    if (valid) {
      summary.style.display = "grid";
      summary.style.visibility = "visible";
    }
    if (!valid) return;
    if (statusText) statusText.textContent = status.grace ? "OFFLINE" : "ATIVO";
    globalThis.LovaBurstStorage.get("lovaburstLicenseCustomerName").then((stored) => {
      if (stored.lovaburstLicenseCustomerName && summary) {
        const name = summary.querySelector("[data-license-name]");
        if (name) name.textContent = stored.lovaburstLicenseCustomerName;
      }
    }).catch(() => {});
    if (expiryValue) {
      const date = status.expiresAt ? new Date(status.expiresAt) : null;
      expiryValue.textContent = date && !Number.isNaN(date.getTime())
        ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
        : "—";
    }
    if (statusValue) {
      statusValue.textContent = status.grace ? "OFFLINE" : "ATIVO";
      statusValue.dataset.state = status.grace ? "warning" : "active";
    }
  };

  const setFeedback = (text, state = "error") => {
    if (!feedback) return;
    feedback.textContent = text || "";
    feedback.dataset.state = state;
  };

  const showLocked = (status) => {
    if (activationSucceeded) return;
    renderLicenseSummary({ valid: false });
    if (shell) shell.dataset.licenseLocked = "true";
    if (gate) {
      gate.hidden = false;
      gate.style.removeProperty("display");
      gate.removeAttribute("aria-hidden");
    }
    const message = status?.message || "Insira sua chave de licença para continuar.";
    setFeedback(status?.code === "license_required" ? "" : message, status?.code === "offline_grace_expired" ? "warning" : "error");
    if (releaseLink) releaseLink.hidden = status?.code !== "device_limit_reached";
  };

  const showUnlocked = (status) => {
    renderLicenseSummary(status);
    if (shell) shell.dataset.licenseLocked = "false";
    if (gate) {
      gate.hidden = true;
      gate.style.display = "none";
      gate.setAttribute("aria-hidden", "true");
    }
    if (releaseLink) releaseLink.hidden = true;
  };

  async function loadStatus(force = false) {
    const generation = ++statusGeneration;
    try {
      let response;
      try {
        response = await chrome.runtime.sendMessage({ type: "LOVABURST_LICENSE_STATUS", force });
      } catch (runtimeError) {
        if (globalThis.LovaBurstUniversalLicenseFallback?.status) response = await globalThis.LovaBurstUniversalLicenseFallback.status();
        else throw runtimeError;
      }
      if (generation !== statusGeneration || activationSucceeded) return;
      if (response?.ok && response.status?.valid) showUnlocked(response.status);
      else showLocked(response?.status || { message: response?.error });
    } catch {
      if (generation !== statusGeneration || activationSucceeded) return;
      showLocked({ code: "network_error", message: "Não foi possível verificar sua licença." });
    }
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (activationInFlight) return;
    if (activationAttempts >= MAX_ACTIVATION_ATTEMPTS) {
      button.disabled = true;
      return setFeedback(attemptsMessage());
    }
    const key = String(input?.value || "").trim().toUpperCase();
    const customerName = String(customerNameInput?.value || "").trim();
    if (!customerName) return setFeedback("Informe seu nome.");
    if (!key) return setFeedback("Informe sua chave de licença.");
    if (!/^LVB-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/i.test(key)) return setFeedback("Use uma chave no formato LVB-XXXXX-XXXXX-XXXXX.");

    activationAttempts += 1;
    activationInFlight = true;
    button.disabled = true;
    ++statusGeneration; // invalida qualquer verificação antiga ainda em voo
    await globalThis.LovaBurstStorage.set({ lovaburstLicenseCustomerName: customerName });
    setFeedback("Validando sua licença...", "warning");
    try {
      let response;
      try {
        response = await chrome.runtime.sendMessage({ type: "LOVABURST_LICENSE_ACTIVATE", key });
      } catch (runtimeError) {
        // Only use the direct mobile fallback when the extension runtime itself is
        // unavailable. If the background already returned a network_error, never
        // switch activation transports: the first request may have registered the
        // device server-side and a second identity would falsely consume the slot.
        const fallback = globalThis.LovaBurstUniversalLicenseFallback || globalThis.LovaBurstMobileLicenseFallback;
        if (fallback?.activate) response = await fallback.activate(key);
        else throw runtimeError;
      }
      if (response?.ok && response.status?.valid) {
        activationSucceeded = true;
        ++statusGeneration;
        if (input) input.value = "";
        showUnlocked(response.status);
        setFeedback("Licença ativada com sucesso.", "success");
        // Recarregar o painel garante que todos os módulos iniciem já vendo a sessão persistida.
        setTimeout(() => {
          try { globalThis.location.reload(); } catch {}
        }, 180);
      } else {
        const status = response?.status || { message: response?.error || "Não foi possível ativar a licença." };
        const base = status?.code === "activation_failed"
          ? "Licença inválida ou vinculada a uma instalação anterior. Se ela já foi usada, libere o dispositivo no painel do vendedor e tente novamente."
          : (status?.message || "Não foi possível ativar a licença.");
        setFeedback(base, status?.code === "network_error" ? "warning" : "error");
        renderLicenseSummary({ valid: false });
        if (shell) shell.dataset.licenseLocked = "true";
        if (gate) {
          gate.hidden = false;
          gate.style.removeProperty("display");
        }
      }
    } catch {
      setFeedback("Não foi possível conectar ao servidor de licenças.");
    } finally {
      activationInFlight = false;
      if (!activationSucceeded) button.disabled = activationAttempts >= MAX_ACTIVATION_ATTEMPTS;
    }
  });

  releaseLink?.addEventListener("click", (event) => {
    event.preventDefault();
    (async () => {
      try {
        let response;
        try {
          response = await chrome.runtime.sendMessage({ type: "LOVABURST_LICENSE_RELEASE" });
        } catch (runtimeError) {
          if (globalThis.LovaBurstUniversalLicenseFallback?.release) response = await globalThis.LovaBurstUniversalLicenseFallback.release();
          else throw runtimeError;
        }
        if (!response?.ok) throw new Error(response?.error || response?.status?.message || "Não foi possível liberar o dispositivo.");
        activationSucceeded = false;
        ++statusGeneration;
        setFeedback("Dispositivo liberado. Ative novamente quando quiser.", "success");
        await loadStatus(true);
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Não foi possível liberar o dispositivo.");
      }
    })();
  });

  // Se já há snapshot válido, não mantenha o cliente preso no overlay enquanto o backend é revalidado.
  globalThis.LovaBurstStorage.get("lovaburstLicenseSnapshot").then((stored) => {
    if (stored?.lovaburstLicenseSnapshot?.valid) showUnlocked(stored.lovaburstLicenseSnapshot);
  }).catch(() => {}).finally(() => loadStatus(false));
})();

(() => {
  if (document.getElementById("lovaburst-chat-lock-loader")) return;
  const script = document.createElement("script");
  script.id = "lovaburst-chat-lock-loader";
  script.src = chrome.runtime.getURL("src/popup/popup-chat-lock.js");
  document.documentElement.appendChild(script);
})();
