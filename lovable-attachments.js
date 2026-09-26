(() => {
  if (window.__LOVABURST_LOVABLE_ATTACHMENTS__) return;
  window.__LOVABURST_LOVABLE_ATTACHMENTS__ = true;

  const core = globalThis.__LOVABURST_COMPOSER_CORE__;
  const A = globalThis.__LOVABURST_ATTACHMENTS__;
  if (!core || !A) return;

  const items = [];
  let sending = false;
  let host = null;
  let shadow = null;
  let picker = null;
  let list = null;
  let attach = null;

  function ensure() {
    host = document.getElementById("lovaburst-attachment-ui");
    if (host && !globalThis.__LOVABURST_ATTACHMENT_SHADOW__) { host.remove(); host = null; }
    if (!host) {
      host = document.createElement("div");
      host.id = "lovaburst-attachment-ui";
      shadow = host.attachShadow({ mode: "closed" });
      globalThis.__LOVABURST_ATTACHMENT_SHADOW__ = shadow;
      shadow.innerHTML = `<style>:host{all:initial}.attach{position:fixed;z-index:2147483645;width:29px;height:27px;border:1px solid rgba(148,163,184,.14);border-radius:8px;background:rgba(7,9,16,.8);color:#a7b1c3;cursor:pointer;backdrop-filter:blur(10px)}.attach:hover{border-color:rgba(103,232,249,.3);color:#e2e8f0}.attach:disabled{opacity:.45}.list{position:fixed;z-index:2147483645;display:flex;gap:6px;max-width:min(430px,calc(100vw - 24px));overflow-x:auto;padding:5px;border:1px solid rgba(103,232,249,.13);border-radius:10px;background:rgba(7,9,16,.9);backdrop-filter:blur(12px)}.item{flex:0 0 auto;width:142px;height:34px;display:grid;grid-template-columns:26px minmax(0,1fr) 20px;align-items:center;gap:5px;color:#cbd5e1;font:500 10px/1 system-ui}.item img,.icon{width:26px;height:26px;border-radius:6px;object-fit:cover}.icon{display:grid;place-items:center;background:rgba(99,102,241,.09);color:#c4b5fd}.name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.remove{width:20px;height:20px;border:0;border-radius:5px;background:transparent;color:#64748b;cursor:pointer}.remove:hover{color:#fb7185;background:rgba(251,113,133,.08)}</style><button class="attach" type="button" title="Anexar arquivo">📎</button><div class="list" hidden></div><input type="file" multiple hidden accept="image/png,image/jpeg,image/webp,application/pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.css,.html,.htm,.py">`;
      document.documentElement.appendChild(host);
      attach = shadow.querySelector(".attach");
      list = shadow.querySelector(".list");
      picker = shadow.querySelector("input");
      attach.onclick = () => picker.click();
      picker.onchange = () => {
        add(Array.from(picker.files || []));
        picker.value = "";
      };
    } else {
      shadow = globalThis.__LOVABURST_ATTACHMENT_SHADOW__ || null;
      if (!shadow) return;
      attach = shadow.querySelector(".attach");
      list = shadow.querySelector(".list");
      picker = shadow.querySelector("input");
    }
    render();
    position();
  }

  function add(files) {
    for (const file of files) {
      const error = A.validate(file, items);
      if (error) {
        toast(error);
        continue;
      }
      items.push(A.make(file));
    }
    render();
    position();
  }

  function remove(id) {
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) {
      A.release(items[index]);
      items.splice(index, 1);
      render();
      position();
    }
  }

  function render() {
    if (!list) return;
    list.hidden = !items.length;
    list.replaceChildren(...items.map((item) => {
      const element = document.createElement("div");
      element.className = "item";
      if (item.url) {
        const image = document.createElement("img");
        image.alt = "";
        image.src = item.url;
        element.appendChild(image);
      } else {
        const icon = document.createElement("span");
        icon.className = "icon";
        icon.textContent = "◇";
        element.appendChild(icon);
      }
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = item.name;
      const removeButton = document.createElement("button");
      removeButton.className = "remove";
      removeButton.type = "button";
      removeButton.textContent = "×";
      element.append(name, removeButton);
      element.querySelector("button").onclick = () => remove(item.id);
      return element;
    }));
  }

  function position() {
    if (!attach) return;
    const composer = core.state.composer;
    const composerHost = core.state.host;
    const active = core.active();
    if (!composer?.isConnected || !composerHost?.isConnected || !core.visible(composer) || !active) {
      attach.style.display = "none";
      list.style.display = "none";
      return;
    }
    const rect = composerHost.getBoundingClientRect();
    attach.style.display = "block";
    attach.style.left = `${Math.max(8, rect.left + 10)}px`;
    attach.style.top = `${Math.max(8, rect.bottom - 36)}px`;
    list.style.display = items.length ? "flex" : "none";
    list.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - list.offsetWidth - 8))}px`;
    list.style.top = `${Math.max(8, rect.top - (list.offsetHeight || 44) - 6)}px`;
  }

  function toast(text) {
    const toastElement = globalThis.__LOVABURST_COMPOSER_SHADOW__?.querySelector(".lb-toast");
    if (!toastElement) return;
    const mark = toastElement.querySelector(".lb-toast-mark");
    const heading = toastElement.querySelector(".lb-toast-heading");
    const body = toastElement.querySelector(".lb-toast-text");
    toastElement.dataset.state = "error";
    toastElement.dataset.open = "true";
    if (mark) mark.textContent = "×";
    if (heading) heading.textContent = "LovaBurst";
    if (body) body.textContent = text;
  }

  function nativeSend(target) {
    const button = target?.closest?.("button,[role='button']");
    const composer = core.state.composer;
    const composerHost = core.state.host;
    if (!button || !composer || !composerHost || host?.contains(button)) return false;
    const form = composer.closest("form");
    const sameArea = composerHost.contains(button) || (form && form.contains(button)) || button.closest("form") === form;
    if (!sameArea || !core.visible(button)) return false;
    const label = [button.getAttribute("aria-label"), button.getAttribute("title"), button.getAttribute("data-testid"), button.textContent]
      .filter(Boolean).join(" ").toLowerCase();
    if (/attach|anex|upload|paperclip|microphone|mic|voice|image|imagem|plus|add|mode/.test(label)) return false;
    return /send|enviar|submit|arrow.?up/.test(label) || button.type === "submit" || /send|submit/.test(button.getAttribute("data-testid") || "");
  }

  function isComposerTarget(target) {
    const composer = core.state.composer;
    return Boolean(composer && target instanceof Node && (target === composer || composer.contains(target)));
  }

  function isComposerForm(target) {
    const composer = core.state.composer;
    const composerHost = core.state.host;
    if (!composer || !target) return false;
    const form = composer.closest("form");
    return Boolean((form && target === form) || (composerHost && target === composerHost && composerHost.matches?.("form")));
  }

  async function submit(textOverride = "", { composerCleared = false } = {}) {
    if (sending || !core.active() || !items.length) return;
    const text = String(textOverride || core.read() || "").trim();
    sending = true;
    attach.disabled = true;
    try {
      const attachments = await A.serialize(items);
      const response = await globalThis.LovaBurstRuntime.sendMessage({
        type: "LOVABURST_SUBMIT_WITH_ATTACHMENTS",
        text,
        attachments,
        projectId: core.state.projectId,
        repository: core.repository(),
        url: location.href,
        title: document.title,
      });
      if (!response?.ok) throw new Error(response?.error || "Não foi possível enviar os anexos.");
      if (!composerCleared && core.state.composer?.isConnected && core.read() === text) core.write("");
      while (items.length) A.release(items.pop());
      render();
    } catch (error) {
      if (composerCleared && core.state.composer?.isConnected && !core.read()) core.write(text);
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      sending = false;
      attach.disabled = false;
      position();
    }
  }

  function block(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function intercept(event) {
    if (!items.length || !core.active()) return false;
    if (sending) {
      block(event);
      return true;
    }
    const text = core.read();
    block(event);
    // Clear before any Lovable/React handler can observe a send action.
    core.write("");
    void submit(text, { composerCleared: true });
    return true;
  }

  window.addEventListener("paste", (event) => {
    if (!core.active() || !isComposerTarget(event.target)) return;
    const files = A.clipboardFiles(event);
    if (!files.length) return;
    block(event);
    add(files);
  }, true);

  window.addEventListener("keydown", (event) => {
    if (!items.length || !core.active() || !isComposerTarget(event.target)) return;
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    intercept(event);
  }, true);

  const onNativePointer = (event) => {
    if (!items.length || !core.active() || !nativeSend(event.target)) return;
    intercept(event);
  };

  window.addEventListener("pointerdown", onNativePointer, true);
  window.addEventListener("pointerup", onNativePointer, true);
  window.addEventListener("mousedown", onNativePointer, true);
  window.addEventListener("mouseup", onNativePointer, true);

  window.addEventListener("click", (event) => {
    if (!items.length || !core.active() || !nativeSend(event.target)) return;
    block(event);
  }, true);

  window.addEventListener("submit", (event) => {
    if (!items.length || !core.active() || !isComposerForm(event.target)) return;
    if (sending) block(event);
    else intercept(event);
  }, true);

  addEventListener("resize", position, { passive: true });
  addEventListener("scroll", position, { passive: true, capture: true });
  const attachmentUiLoop=()=>setTimeout(()=>{ensure();position();attachmentUiLoop();},760+Math.floor(Math.random()*320)); attachmentUiLoop();
  addEventListener("pagehide", () => items.forEach(A.release), { once: true });
  ensure();
})();
