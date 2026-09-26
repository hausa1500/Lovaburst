(() => {
  if (window.__LOVABURST_CHATGPT_ATTACHMENTS_V0324__) return;
  window.__LOVABURST_CHATGPT_ATTACHMENTS_V0324__ = true;
  window.__LOVABURST_CHATGPT_ATTACHMENTS__ = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) =>
    element instanceof HTMLElement &&
    element.isConnected &&
    element.getBoundingClientRect().width > 0 &&
    getComputedStyle(element).display !== "none";

  function composer() {
    return [
      "#prompt-textarea",
      'textarea[data-testid="prompt-textarea"]',
      'div.ProseMirror[contenteditable="true"]',
      'form [contenteditable="true"]',
    ]
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter(visible)
      .at(-1) || null;
  }

  function fileInput(element) {
    const roots = [element?.closest("form"), element?.parentElement, document].filter(Boolean);
    for (const root of roots) {
      const inputs = Array.from(root.querySelectorAll('input[type="file"]')).filter((input) => !input.disabled);
      if (inputs.length) return inputs.at(-1);
    }
    return null;
  }

  function decode(attachment) {
    const declaredSize = Number(attachment?.size || 0);
    if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > 8 * 1024 * 1024) throw new Error("Anexo fora do limite seguro.");
    const encoded = String(attachment?.base64 || "");
    if (!encoded || encoded.length > Math.ceil((8 * 1024 * 1024) / 3) * 4 + 8) throw new Error("Anexo fora do limite de transporte.");
    const binary = atob(encoded);
    if (binary.length !== declaredSize) throw new Error("Anexo com tamanho inconsistente.");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new File([bytes], attachment.name, {
      type: attachment.type || "",
      lastModified: Date.now(),
    });
  }

  function attachmentCount(element) {
    const root = element?.closest("form") || document;
    return root.querySelectorAll(
      '[data-testid*="attachment" i],[data-testid*="file" i],button[aria-label*="remove" i],button[aria-label*="remover" i]',
    ).length;
  }

  function attachmentNodes(element) {
    const root = element?.closest("form") || document;
    return Array.from(root.querySelectorAll(
      '[data-testid*="attachment" i],[data-testid*="file" i],[data-testid*="upload" i],button[aria-label*="remove" i],button[aria-label*="remover" i]',
    )).filter(visible);
  }

  function attachmentNamesPresent(element, names) {
    const root = element?.closest("form") || document;
    const text = String(root.innerText || root.textContent || "").toLowerCase();
    return names.every((name) => text.includes(String(name).toLowerCase()));
  }

  function rejectionMessage(element, names) {
    const candidates = Array.from(document.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"],[data-testid*="toast" i]')).filter(visible);
    const text = candidates.map((node) => String(node.innerText || node.textContent || "").trim()).filter(Boolean).join("\n");
    if (!text) return "";
    const lower = text.toLowerCase();
    const mentionsFile = names.some((name) => lower.includes(String(name).toLowerCase()));
    const looksLikeUploadError = /(upload|anex|arquivo|file|unsupported|suportad|failed|falhou|too large|muito grande|limit|tamanho|type|tipo)/i.test(text);
    return mentionsFile || looksLikeUploadError ? text.slice(0, 500) : "";
  }

  async function waitForComposer(timeoutMs = 9000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const element = composer();
      if (element) return element;
      await sleep(150);
    }
    return null;
  }

  async function prepareAttachments(attachments) {
    if (!attachments.length) return { ok: true, count: 0 };
    if (!Array.isArray(attachments) || attachments.length > 5) throw new Error("Quantidade de anexos inválida.");
    const total = attachments.reduce((sum, item) => sum + Number(item?.size || 0), 0);
    if (total > 20 * 1024 * 1024) throw new Error("Os anexos excedem o limite seguro total.");
    const element = await waitForComposer();
    if (!element) throw new Error("Campo de mensagem do ChatGPT não encontrado.");
    const input = fileInput(element);
    if (!input) throw new Error("O composer atual do ChatGPT não disponibilizou o seletor de arquivos.");
    const files = attachments.map(decode);
    const names = files.map((file) => String(file.name || "")).filter(Boolean);
    const baselineNodes = attachmentNodes(element).length;
    const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set; if (setter) setter.call(input, transfer.files); else input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true })); input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    const startedAt = Date.now();
    while (Date.now() - startedAt < 30000) {
      await sleep(220);
      const rejection = rejectionMessage(element, names);
      if (rejection) throw new Error(`O ChatGPT recusou o anexo: ${rejection}`);
      const nodeCount = attachmentNodes(element).length;
      if (attachmentNamesPresent(element, names) || (nodeCount >= baselineNodes + attachments.length && attachments.length > 0)) return { ok: true, count: attachments.length };
    }
    throw new Error(`Não foi possível anexar ${names[0] || "o arquivo"} ao ChatGPT. A mensagem não foi enviada.`);
  }
  globalThis.LovaBurstRuntime.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LOVABURST_ATTACHMENTS_PING") {
      sendResponse({ ok: true, source: "chatgpt-attachments", version: "0.32.4" });
      return false;
    }

    if (message?.type !== "LOVABURST_PREPARE_ATTACHMENTS") return false;

    prepareAttachments(Array.isArray(message.attachments) ? message.attachments : [])
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    return true;
  });
})();
