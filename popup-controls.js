"use strict";

(() => {
  const DEFAULT_CHECK_SECONDS = 30;
  const CHECK_INTERVALS = [15, 30, 60, 120];
  const countdown = document.getElementById("runCheckCountdown");
  const pauseCheckButton = document.getElementById("runCheckPauseButton");
  const statusMain = document.getElementById("runStatusMain");
  const footer = document.querySelector(".app-footer");
  const settingsButton = document.getElementById("settingsButton");
  const input = document.getElementById("commandInput");
  const sendButton = document.getElementById("sendCommandButton");
  const feedback = document.getElementById("sendFeedback");
  let anchor = Date.now();
  let lastActive = false;
  let checkSeconds = DEFAULT_CHECK_SECONDS;
  let autoCheckPaused = false;
  let recognition = null;
  let listening = false;
  let speechBaseText = "";
  let feedbackTimer = null;

  function isCheckingState() {
    const status = String(statusMain?.dataset?.status || "").toLowerCase();
    return status === "sending" || status === "working";
  }

  function renderCountdown() {
    if (!countdown) return;
    const active = isCheckingState();
    if (active && !lastActive) anchor = Date.now();
    lastActive = active;
    if (!active) {
      countdown.hidden = true;
      if (pauseCheckButton) pauseCheckButton.hidden = true;
      return;
    }
    if (pauseCheckButton) {
      pauseCheckButton.hidden = false;
      pauseCheckButton.dataset.paused = String(autoCheckPaused);
      pauseCheckButton.textContent = autoCheckPaused ? "▶" : "⏸";
      pauseCheckButton.title = autoCheckPaused ? "Retomar checagem automática" : "Pausar checagem automática";
      pauseCheckButton.setAttribute("aria-label", pauseCheckButton.title);
    }
    if (autoCheckPaused) {
      countdown.hidden = false;
      countdown.textContent = "checagem pausada";
      countdown.title = "A checagem automática do ChatGPT está pausada.";
      return;
    }
    const elapsed = Math.floor((Date.now() - anchor) / 1000);
    const remaining = checkSeconds - (elapsed % checkSeconds);
    countdown.hidden = false;
    countdown.textContent = remaining <= 1 ? "checando…" : `checa em ${remaining}s`;
    countdown.title = `Próxima verificação do ChatGPT · intervalo ${checkSeconds}s`;
  }

  async function getCheckConfig() {
    const stored = await globalThis.LovaBurstStorage.get("config");
    const value = Number(stored.config?.chatgptCheckIntervalSeconds);
    return {
      seconds: CHECK_INTERVALS.includes(value) ? value : DEFAULT_CHECK_SECONDS,
      paused: Boolean(stored.config?.chatgptAutoCheckPaused),
    };
  }

  async function saveCheckSeconds(value) {
    if (!CHECK_INTERVALS.includes(value)) return;
    const stored = await globalThis.LovaBurstStorage.get("config");
    const config = { enabled: true, lovableEnabled: true, chatgptEnabled: true, ...(stored.config || {}), chatgptCheckIntervalSeconds: value };
    await globalThis.LovaBurstStorage.set({ config });
    checkSeconds = value;
    anchor = Date.now();
    renderCountdown();
  }

  function createSettingsPanel() {
    if (!settingsButton || document.getElementById("lbSettingsPanel")) return;
    const panel = document.createElement("section");
    panel.id = "lbSettingsPanel";
    panel.className = "lb-settings-panel";
    panel.hidden = true;
    const options = CHECK_INTERVALS.map((seconds) => {
      const label = seconds < 60 ? `${seconds} segundos` : `${seconds / 60} ${seconds === 60 ? "minuto" : "minutos"}`;
      return `<option value="${seconds}">${label}${seconds === DEFAULT_CHECK_SECONDS ? " · Padrão" : ""}</option>`;
    }).join("");
    panel.innerHTML = `<div class="lb-settings-head"><div><span>// AJUSTES</span><strong>Preferências da LovaBurst</strong></div><button id="lbSettingsClose" type="button" aria-label="Fechar ajustes">×</button></div><label class="lb-settings-field"><span>Verificar resultado do ChatGPT</span><small>Define de quanto em quanto tempo a LovaBurst checa o resultado durante uma solicitação ativa.</small><select id="lbCheckInterval">${options}</select></label>`;
    footer?.before(panel);
    const replacement = settingsButton.cloneNode(true);
    settingsButton.replaceWith(replacement);
    replacement.addEventListener("click", async () => {
      const select = panel.querySelector("#lbCheckInterval");
      const current = await getCheckConfig();
      if (select) select.value = String(current.seconds);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    panel.querySelector("#lbSettingsClose")?.addEventListener("click", () => { panel.hidden = true; });
    panel.querySelector("#lbCheckInterval")?.addEventListener("change", (event) => void saveCheckSeconds(Number(event.target.value)));
  }

  async function loadCheckConfig() {
    try {
      const current = await getCheckConfig();
      checkSeconds = current.seconds;
      autoCheckPaused = current.paused;
      anchor = Date.now();
      renderCountdown();
    } catch {}
  }

  async function toggleAutoCheck() {
    const stored = await globalThis.LovaBurstStorage.get("config");
    const nextPaused = !Boolean(stored.config?.chatgptAutoCheckPaused);
    const config = { enabled: true, lovableEnabled: true, chatgptEnabled: true, ...(stored.config || {}), chatgptAutoCheckPaused: nextPaused };
    await globalThis.LovaBurstStorage.set({ config });
    autoCheckPaused = nextPaused;
    anchor = Date.now();
    renderCountdown();
  }

  function compactFeedback() {
    if (!feedback) return;
    const text = String(feedback.textContent || "").trim();
    const temporary = /^(Dados atualizados\.|Enviado ao ChatGPT\.)$/i.test(text);
    feedback.classList.toggle("lb-feedback-temporary", temporary);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    if (temporary && !feedback.hidden) {
      feedbackTimer = setTimeout(() => {
        feedback.hidden = true;
        feedback.classList.remove("lb-feedback-temporary");
      }, 2200);
    }
  }

  function dispatchInput() {
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function hasAttachments() {
    return Boolean(document.querySelector(".lb-attachment-list")?.children.length);
  }

  function updateClearState() {
    const clearButton = document.getElementById("lbClearComposerButton");
    if (!clearButton || !input) return;
    clearButton.disabled = !input.value.trim() && !hasAttachments();
  }

  function clearComposer() {
    if (!input) return;
    if (listening && recognition) recognition.stop();
    input.value = "";
    document.querySelectorAll(".lb-attachment-remove").forEach((button) => button.click());
    const picker = document.querySelector(".lb-file-input");
    if (picker) picker.value = "";
    dispatchInput();
    updateClearState();
    input.focus();
  }

  async function enhancePrompt(button) {
    const text = String(input?.value || "").trim();
    if (!text) {
      input?.focus();
      if (typeof showFeedback === "function") showFeedback("Digite um pedido antes de aprimorar o prompt.");
      return;
    }
    const projectId = String(globalThis.workspace?.lovableProjectId || (typeof workspace !== "undefined" ? workspace?.lovableProjectId : "") || "");
    const repository = String(globalThis.workspace?.repository || (typeof workspace !== "undefined" ? workspace?.repository : "") || "");
    const title = String(globalThis.workspace?.sourceTitle || (typeof workspace !== "undefined" ? workspace?.sourceTitle : "") || "");
    if (!projectId) {
      if (typeof showFeedback === "function") showFeedback("Abra um projeto do Lovable antes de aprimorar o prompt.");
      return;
    }

    button.disabled = true;
    button.dataset.loading = "true";
    button.dataset.enhancing = "true";
    button.title = "Aprimorando prompt…";
    const idleMarkup = button.innerHTML;
    const iconMarkup = button.querySelector("svg")?.outerHTML || "✦";
    button.innerHTML = `${iconMarkup}<span class="lb-tool-label">Aprimorando...</span>`;
    const pulseAnimation = typeof button.animate === "function" ? button.animate(
      [{ opacity: 0.72, transform: "scale(1)" }, { opacity: 1, transform: "scale(1.04)" }, { opacity: 0.72, transform: "scale(1)" }],
      { duration: 1200, iterations: Infinity, easing: "ease-in-out" },
    ) : { cancel() {} };
    const timeoutMs = 95000;
    let timeoutId = null;
    try {
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("O ChatGPT demorou demais para devolver o prompt aprimorado.")), timeoutMs);
      });
      const response = await Promise.race([
        chrome.runtime.sendMessage({ type: "LOVABURST_ENHANCE_PROMPT", text, projectId, repository, title }),
        timeout,
      ]);
      const enhanced = String(response?.text || "").trim();
      if (!response?.ok || !enhanced) throw new Error(response?.error || "O ChatGPT não devolveu um prompt aprimorado.");
      input.value = enhanced;
      dispatchInput();
      input.focus();
      input.setSelectionRange?.(input.value.length, input.value.length);
      button.dataset.success = "true";
      if (typeof showFeedback === "function") showFeedback("Prompt aprimorado.");
      setTimeout(() => { delete button.dataset.success; }, 900);
    } catch (error) {
      if (typeof showFeedback === "function") showFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      pulseAnimation.cancel();
      button.innerHTML = idleMarkup;
      button.disabled = false;
      button.dataset.loading = "false";
      button.dataset.enhancing = "false";
      button.title = "Aprimorar prompt";
    }
  }

  function joinSpeech(base, transcript) {
    const left = String(base || "").trimEnd();
    const right = String(transcript || "").trim();
    if (!left) return right;
    if (!right) return left;
    return `${left}${/[\s\n]$/.test(left) ? "" : " "}${right}`;
  }

  function setupSpeech(button) {
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) {
      button.disabled = true;
      button.title = "Ditado não suportado neste navegador";
      button.dataset.supported = "false";
      return;
    }

    recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      listening = true;
      button.dataset.listening = "true";
      button.title = "Ouvindo... Clique para parar";
      speechBaseText = String(input?.value || "");
    };

    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += `${event.results[index][0]?.transcript || ""} `;
      }
      if (input) {
        input.value = joinSpeech(speechBaseText, transcript);
        dispatchInput();
      }
    };

    recognition.onerror = (event) => {
      const code = String(event?.error || "");
      if (typeof showFeedback !== "function") return;
      if (code === "not-allowed" || code === "service-not-allowed") showFeedback("Permissão do microfone não concedida.");
      else if (code === "audio-capture") showFeedback("Microfone indisponível.");
      else if (code !== "aborted" && code !== "no-speech") showFeedback("Não foi possível usar o ditado por voz.");
    };

    recognition.onend = () => {
      listening = false;
      button.dataset.listening = "false";
      button.title = "Ditado por voz";
      updateClearState();
    };

    button.addEventListener("click", () => {
      if (listening) {
        recognition.stop();
        return;
      }
      try {
        recognition.start();
      } catch (error) {
        if (typeof showFeedback === "function") showFeedback(error instanceof Error ? error.message : String(error));
      }
    });
  }

  function syncChatIndicator() {
    const pill = document.getElementById("lbChatIndicator");
    const setupCard = document.getElementById("chatSetupCard");
    const connectedCard = document.getElementById("chatConnectedCard");
    if (!pill || !setupCard || !connectedCard) return;

    if (!connectedCard.hidden) {
      pill.dataset.state = "connected";
      pill.title = "ChatGPT conectado";
      pill.setAttribute("aria-label", "ChatGPT conectado");
      return;
    }
    if (!setupCard.hidden) {
      pill.dataset.state = "disconnected";
      pill.title = "ChatGPT não conectado";
      pill.setAttribute("aria-label", "ChatGPT não conectado");
      return;
    }
    pill.dataset.state = "checking";
    pill.title = "Verificando conexão...";
    pill.setAttribute("aria-label", "Verificando conexão com o ChatGPT");
  }

  function buildComposer() {
    const card = document.querySelector(".command-card");
    const editor = input?.closest(".editor");
    const skills = document.getElementById("activeSkillsStrip");
    const attachmentZone = document.querySelector(".lb-attachment-zone");
    if (!card || !editor || !sendButton || !attachmentZone || document.getElementById("lbComposerShell")) return;

    const list = attachmentZone.querySelector(".lb-attachment-list");
    const attachButton = attachmentZone.querySelector(".lb-attach-button");
    const picker = attachmentZone.querySelector(".lb-file-input");

    const shell = document.createElement("div");
    shell.id = "lbComposerShell";
    shell.className = "lb-composer-shell";
    const previews = document.createElement("div");
    previews.className = "lb-composer-previews";
    const toolbar = document.createElement("div");
    toolbar.className = "lb-composer-toolbar";

    const enhanceButton = document.createElement("button");
    enhanceButton.id = "lbEnhancePromptButton";
    enhanceButton.className = "lb-tool-button lb-enhance-button";
    enhanceButton.type = "button";
    enhanceButton.title = "Aprimorar prompt";
    enhanceButton.setAttribute("aria-label", "Aprimorar prompt");
    enhanceButton.textContent = "✦";

    const chatIndicator = document.createElement("button");
    chatIndicator.id = "lbChatIndicator";
    chatIndicator.className = "lb-chat-indicator";
    chatIndicator.type = "button";
    chatIndicator.dataset.state = "checking";
    chatIndicator.innerHTML = '<i></i><span class="lb-chat-full">ChatGPT</span><span class="lb-chat-short">GPT</span>';

    const micButton = document.createElement("button");
    micButton.id = "lbMicButton";
    micButton.className = "lb-tool-button lb-mic-button";
    micButton.type = "button";
    micButton.title = "Ditado por voz";
    micButton.setAttribute("aria-label", "Ditado por voz");
    micButton.textContent = "🎙";

    const clearButton = document.createElement("button");
    clearButton.id = "lbClearComposerButton";
    clearButton.className = "lb-tool-button lb-clear-button";
    clearButton.type = "button";
    clearButton.title = "Limpar solicitação";
    clearButton.setAttribute("aria-label", "Limpar solicitação");
    clearButton.textContent = "🗑";

    editor.parentNode.insertBefore(shell, editor);
    shell.appendChild(editor);
    if (list) previews.appendChild(list);
    if (picker) previews.appendChild(picker);
    shell.appendChild(previews);
    if (skills) shell.appendChild(skills);

    if (attachButton) {
      attachButton.classList.add("lb-tool-button");
      attachButton.title = "Anexar arquivo";
      attachButton.setAttribute("aria-label", "Anexar arquivo");
      toolbar.appendChild(attachButton);
    }
    toolbar.appendChild(enhanceButton);
    toolbar.appendChild(chatIndicator);
    toolbar.appendChild(micButton);
    sendButton.classList.add("lb-toolbar-send");
    sendButton.title = "Enviar solicitação";
    sendButton.setAttribute("aria-label", "Enviar solicitação");
    toolbar.appendChild(sendButton);
    toolbar.appendChild(clearButton);
    shell.appendChild(toolbar);
    attachmentZone.remove();

    if (input) {
      input.placeholder = "Digite sua solicitação...";
      input.setAttribute("rows", "5");
      input.addEventListener("input", updateClearState);
    }
    enhanceButton.addEventListener("click", () => void enhancePrompt(enhanceButton));
    clearButton.addEventListener("click", clearComposer);
    chatIndicator.addEventListener("click", () => {
      const connectedCard = document.getElementById("chatConnectedCard");
      if (connectedCard && !connectedCard.hidden) {
        const open = document.getElementById("openChatgptButton");
        open?.click();
      } else {
        document.getElementById("chatSetupCard")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    setupSpeech(micButton);

    const connectedCard = document.getElementById("chatConnectedCard");
    const setupCard = document.getElementById("chatSetupCard");
    if (connectedCard) new MutationObserver(syncChatIndicator).observe(connectedCard, { attributes: true, attributeFilter: ["hidden"] });
    if (setupCard) new MutationObserver(syncChatIndicator).observe(setupCard, { attributes: true, attributeFilter: ["hidden"] });
    if (list) new MutationObserver(updateClearState).observe(list, { childList: true });

    syncChatIndicator();
    updateClearState();
  }

  if (footer) footer.dataset.compact = "true";
  createSettingsPanel();
  void loadCheckConfig();
  buildComposer();
  pauseCheckButton?.addEventListener("click", () => void toggleAutoCheck());
  function setupSpecialProjectActions() {
    const footer = document.querySelector(".app-footer");
    if (!footer || document.getElementById("createProjectButton")) return;
    const create = document.createElement("button"); create.id = "createProjectButton"; create.type = "button"; create.textContent = "＋ Criar Projeto";
    const analyze = document.createElement("button"); analyze.id = "analyzeProjectButton"; analyze.type = "button"; analyze.textContent = "⌁ Analisar Projeto";
    footer.insertBefore(create, document.getElementById("settingsButton")); footer.insertBefore(analyze, document.getElementById("settingsButton"));
    const modal = document.createElement("section"); modal.className = "lb-special-modal"; modal.id = "specialProjectModal"; modal.hidden = true; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
    modal.innerHTML = '<div class="lb-special-modal-card"><button class="lb-special-close" type="button" aria-label="Fechar">×</button><span class="mock-label">// NOVO PROJETO</span><h2>Crie a base do seu projeto</h2><p>Descreva em poucas palavras o que você quer criar. A LovaBurst vai preparar uma solicitação mínima para iniciar o projeto.</p><textarea rows="4" maxlength="500" placeholder="Um sistema de pedidos para restaurante"></textarea><div class="lb-special-actions"><button class="button-secondary" type="button">Cancelar</button><button class="button-primary" type="button">Gerar projeto</button></div><p class="lb-special-feedback" aria-live="polite"></p></div>';
    document.body.appendChild(modal);
    const input = modal.querySelector("textarea"), submit = modal.querySelector(".button-primary"), feedback = modal.querySelector(".lb-special-feedback");
    let mode = "create-project";
    const sendSpecialPromptToChatGpt = async (prompt) => {
      const text = String(prompt || "").trim();
      if (!text) throw new Error("O servidor não devolveu um prompt válido para o ChatGPT.");

      // Never route project creation through Lovable's native AI composer. A new
      // project must start in an unbound ChatGPT conversation so a remembered/old
      // Lovable project cannot accidentally receive the creation request.
      const tab = await chrome.tabs.create({ url: "https://chatgpt.com/", active: true });
      const loaded = await waitForTabComplete(tab.id, 20000);
      if (!loaded?.id) throw new Error("A nova conversa do ChatGPT não carregou.");
      await sendDirect(loaded.id, text);
    };
    const close = () => { modal.hidden = true; if (input) input.value = ""; if (feedback) feedback.textContent = ""; };
    modal.querySelector(".lb-special-close")?.addEventListener("click", close); modal.querySelector(".button-secondary")?.addEventListener("click", close);
    create.addEventListener("click", () => { mode = "create-project"; modal.querySelector(".mock-label").textContent = "// NOVO PROJETO"; modal.querySelector("h2").textContent = "Crie a base do seu projeto"; modal.querySelector("p").textContent = "Descreva em poucas palavras o que você quer criar. A LovaBurst vai preparar uma solicitação mínima para iniciar o projeto."; input.hidden = false; input.placeholder = "Um sistema de pedidos para restaurante"; submit.textContent = "Gerar projeto"; modal.hidden = false; input.focus(); });
    analyze.addEventListener("click", async () => { mode = "analyze-project"; modal.querySelector(".mock-label").textContent = "// ANALISAR PROJETO"; modal.querySelector("h2").textContent = "Analisar projeto em novo chat"; modal.querySelector("p").textContent = "A LovaBurst abrirá uma nova conversa do ChatGPT e carregará o contexto técnico do repositório. Nenhum arquivo será alterado durante a análise."; input.hidden = true; input.value = ""; submit.textContent = "Analisar projeto"; modal.hidden = false; submit.focus(); });
    submit.addEventListener("click", async () => {
      submit.disabled = true; if (feedback) feedback.textContent = "Preparando operação…";
      try {
        const currentWorkspace = typeof workspace !== "undefined" ? workspace : {};
        const payload = { lovableProjectId: currentWorkspace.lovableProjectId || "AUTO_NOT_DETECTED", repository: currentWorkspace.repository || "AUTO_NOT_DETECTED", title: currentWorkspace.sourceTitle || (mode === "create-project" ? "Novo projeto" : ""), sourceUrl: currentWorkspace.sourceUrl || "" };
        if (mode === "create-project") payload.text = String(input.value || "").trim();
        if (mode === "create-project" && !payload.text) throw new Error("Descreva o projeto antes de continuar.");
        if (mode === "analyze-project" && !/^[^/\s]+\/[^/\s]+$/.test(payload.repository)) throw new Error("Conecte o GitHub deste projeto antes de iniciar a análise profunda.");
        if (feedback) feedback.textContent = "Preparando prompt no servidor…";
        const consumed = await chrome.runtime.sendMessage({ type: "LOVABURST_EXECUTE_SPECIAL_OPERATION", operation: mode, payload });
        if (!consumed?.ok || !consumed.prompt) throw new Error(consumed?.error || "O servidor não autorizou o envio desta operação.");
        if (mode === "analyze-project") {
          if (feedback) feedback.textContent = "Abrindo um novo chat e enviando a análise…";
          await newConversation({ initialPrompt: consumed.prompt });
          if (feedback) feedback.textContent = "Análise enviada ao novo chat do ChatGPT.";
          setTimeout(close, 900);
          return;
        }
        if (feedback) feedback.textContent = "Abrindo um novo chat e enviando a criação…";
        await sendSpecialPromptToChatGpt(consumed.prompt);
        if (feedback) feedback.textContent = "Criação enviada ao ChatGPT sem consumir prompt do Lovable.";
        setTimeout(close, 900);
      } catch (error) { if (feedback) feedback.textContent = error instanceof Error ? error.message : String(error); }
      finally { submit.disabled = false; }
    });
  }
  setupSpecialProjectActions();
  renderCountdown();
  compactFeedback();
  window.setInterval(renderCountdown, 1000);
  if (statusMain) new MutationObserver(renderCountdown).observe(statusMain, { attributes: true, attributeFilter: ["data-status"] });
  if (feedback) new MutationObserver(compactFeedback).observe(feedback, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.config) void loadCheckConfig(); });
})();
