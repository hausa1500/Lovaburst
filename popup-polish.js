"use strict";

(() => {
  const ICONS = {
    paperclip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/></svg>',
    microphone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.5 18-3.1-7.4L3 10.5 21 3Z"/><path d="m10.4 13.6 4.7-4.7"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>',
  };

  const input = document.getElementById("commandInput");
  const toolbar = document.querySelector(".lb-composer-toolbar");
  const sendButton = document.getElementById("sendCommandButton");
  if (!input || !toolbar || !sendButton) return;

  function show(message) {
    if (typeof showFeedback === "function") showFeedback(message);
  }

  function actionMarkup(icon, label) {
    return `${ICONS[icon] || ""}<span class="lb-tool-label">${label}</span>`;
  }

  function sendMarkup(sending) {
    return sending
      ? '<span class="lb-send-spinner" aria-hidden="true"></span><span class="lb-tool-label">Enviando</span>'
      : actionMarkup("send", "Enviar");
  }

  function renderSendVisual(sending) {
    const state = sending ? "sending" : "idle";
    const validMarkup = sending
      ? Boolean(sendButton.querySelector(".lb-send-spinner") && sendButton.querySelector(".lb-tool-label"))
      : Boolean(sendButton.querySelector("svg") && sendButton.querySelector(".lb-tool-label"));
    if (sendButton.dataset.visualState === state && validMarkup) return;
    sendButton.dataset.visualState = state;
    sendButton.dataset.sending = sending ? "true" : "false";
    sendButton.innerHTML = sendMarkup(sending);
  }

  function normalizeToolbar() {
    const attach = toolbar.querySelector(".lb-attach-button");
    const enhance = document.getElementById("lbEnhancePromptButton");
    const mic = document.getElementById("lbMicButton");
    const clear = document.getElementById("lbClearComposerButton");
    const chat = document.getElementById("lbChatIndicator");

    if (attach) attach.innerHTML = actionMarkup("paperclip", "Anexar");
    if (enhance) enhance.innerHTML = actionMarkup("sparkles", "Aprimorar");
    if (mic) mic.innerHTML = actionMarkup("microphone", "Ditado");
    if (clear) clear.innerHTML = actionMarkup("trash", "Limpar");
    if (chat) {
      const state = chat.dataset.state || "checking";
      chat.innerHTML = `<i></i><span class="lb-chat-name">ChatGPT</span><span class="lb-chat-chevron">${ICONS.chevron}</span>`;
      chat.dataset.state = state;
    }

    if (mic && sendButton.nextElementSibling !== mic) toolbar.insertBefore(sendButton, mic);
    sendButton.title = "Enviar";
    sendButton.setAttribute("aria-label", "Enviar");
    renderSendVisual(false);
  }

  function watchSendState() {
    new MutationObserver(() => {
      const rawText = String(sendButton.textContent || "");
      if (/Enviando/i.test(rawText)) sendButton.dataset.sending = "true";
      else if (/Enviar/i.test(rawText)) sendButton.dataset.sending = "false";
      renderSendVisual(sendButton.dataset.sending === "true");
    }).observe(sendButton, { childList: true, subtree: true, characterData: true });
  }

  function replaceMicFlow() {
    const oldButton = document.getElementById("lbMicButton");
    if (!oldButton) return;
    const button = oldButton.cloneNode(true);
    oldButton.replaceWith(button);
    button.innerHTML = actionMarkup("microphone", "Ditado");
    button.title = "Ditado por voz";
    button.setAttribute("aria-label", "Ditado por voz");

    let listening = false;

    async function lovableTab() {
      const projectId = String(document.getElementById("projectValue")?.textContent || "").trim().replace(/^—$/, "");
      const tabs = await chrome.tabs.query({ url: ["https://lovable.dev/*"] });
      return tabs.find((item) => projectId && item.url?.includes(projectId)) || tabs.find((item) => item.active) || tabs[0] || null;
    }

    async function assertLovableTab(tabId) {
      const tab = await chrome.tabs.get(Number(tabId));
      if (!tab?.id || !String(tab.url || "").startsWith("https://lovable.dev/")) throw new Error("Aba Lovable inválida.");
      return tab;
    }

    async function stopRemoteRecognition(tabId) {
      if (!tabId) return;
      await assertLovableTab(tabId);
      await globalThis.LovaBurstTabSafety.sendMessage(tabId, { type: "LOVABURST_SPEECH_STOP" }).catch(() => {});
    }

    async function dictateOnLovable(tabId) {
      await assertLovableTab(tabId);
      return globalThis.LovaBurstTabSafety.sendMessage(tabId, { type: "LOVABURST_SPEECH_DICTATE" });
    }

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const tab = await lovableTab();
      if (!tab?.id) {
        show("Abra o projeto no Lovable antes de usar o microfone.");
        return;
      }

      if (listening) {
        await stopRemoteRecognition(tab.id);
        return;
      }

      listening = true;
      button.dataset.listening = "true";
      button.title = "Ouvindo... Clique para parar";
      show("Ouvindo pelo microfone do Lovable...");
      const baseText = String(input.value || "").trimEnd();

      try {
        const result = await dictateOnLovable(tab.id);
        const transcript = String(result?.transcript || "").trim();
        if (result?.ok && transcript) {
          input.value = baseText ? `${baseText} ${transcript}` : transcript;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.focus();
          input.setSelectionRange?.(input.value.length, input.value.length);
          show("Ditado inserido.");
          return;
        }

        const error = String(result?.error || "");
        if (error === "NotAllowedError" || error === "service-not-allowed" || error === "not-allowed") {
          show("Acesso ao microfone bloqueado no Lovable. Verifique a permissão do site e tente novamente.");
        } else if (error === "NotFoundError" || error === "audio-capture") {
          show("Nenhum microfone disponível foi encontrado.");
        } else if (error === "unsupported-media" || error === "unsupported-speech") {
          show("O navegador não disponibilizou ditado por voz nesta página.");
        } else if (error !== "aborted" && error !== "no-speech") {
          show("Não foi possível iniciar o ditado por voz.");
        }
      } catch (error) {
        show(error instanceof Error ? error.message : "Não foi possível iniciar o ditado por voz.");
      } finally {
        listening = false;
        button.dataset.listening = "false";
        button.title = "Ditado por voz";
      }
    });
  }

  normalizeToolbar();
  replaceMicFlow();
  normalizeToolbar();
  watchSendState();
})();

/* LovaBurst 2.1.6 footer icon polish */
(() => {
  const footer = document.querySelector('.app-footer');
  if (!footer || footer.dataset.lbFinalPolish216 === 'true') return;
  footer.dataset.lbFinalPolish216 = 'true';
  const icons = {
    badge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16"/><path d="M7 7l10 10M17 7 7 17"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/></svg>',
    create: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/></svg>',
    analyze: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4M11 8v6M8 11h6"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.5 1a7 7 0 0 0-1.7-1L14.4 3h-4.8L9.3 6a7 7 0 0 0-1.7 1L5.1 6 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5.1 18l2.5-1a7 7 0 0 0 1.7 1l.3 3h4.8l.3-3a7 7 0 0 0 1.7-1l2.5 1 2-3.5-2-1.5a7 7 0 0 0 .1-1Z"/></svg>'
  };
  const specs = [
    ['hideLovableBadgeButton','badge','Remover marca d’água'],
    ['downloadProjectButton','download','Baixar projeto'],
    ['createProjectButton','create','Criar Projeto'],
    ['analyzeProjectButton','analyze','Analisar Projeto'],
    ['settingsButton','settings','Ajustes']
  ];
  function decorate() {
    for (const [id,icon,label] of specs) {
      const button = document.getElementById(id);
      if (!button || button.dataset.lbFinalIcon216 === 'true') continue;
      button.dataset.lbFinalIcon216 = 'true';
      button.classList.add('lb-footer-control');
      button.innerHTML = `${icons[icon]}<span class="lb-footer-label">${label}</span>`;
    }
  }
  decorate();
  new MutationObserver(decorate).observe(footer,{childList:true,subtree:true});
})();
