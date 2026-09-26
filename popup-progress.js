(() => {
  if (window.__LOVABURST_POPUP_PROGRESS__) return;
  window.__LOVABURST_POPUP_PROGRESS__ = true;
  const KEY = "projectRunStatuses";
  const main = document.getElementById("runStatusMain");
  const projectValue = document.getElementById("projectValue");
  if (!main || !projectValue) return;

  const monitor = document.createElement("div");
  monitor.className = "lb-run-monitor";
  monitor.innerHTML = '<div class="lb-run-activity" hidden></div><div class="lb-run-progress" aria-label="Progresso por etapas"><i></i><i></i><i></i><i></i></div><div class="lb-run-phase">Aguardando</div>';
  main.appendChild(monitor);
  const activity = monitor.querySelector(".lb-run-activity");
  const progress = monitor.querySelector(".lb-run-progress");
  const phase = monitor.querySelector(".lb-run-phase");
  const segments = [...progress.querySelectorAll("i")];

  const phaseMap = {
    sending: [1, "Enviando"],
    working: [2, "Processando"],
    done: [4, "Concluído"],
    blocked: [2, "Ação necessária"],
    error: [2, "Erro"],
  };

  function projectId() {
    return String(projectValue.textContent || "").trim().replace(/^—$/, "");
  }

  function render(run) {
    const status = String(run?.status || "idle").toLowerCase();
    const [filled, label] = phaseMap[status] || [0, "Aguardando"];
    progress.dataset.status = status;
    progress.setAttribute("aria-label", `Progresso por etapas: ${label}`);
    phase.textContent = label;
    segments.forEach((segment, index) => {
      segment.dataset.fill = String(index < filled);
      segment.dataset.current = String(status !== "done" && index === Math.max(0, filled - 1));
    });

    const text = String(run?.activityText || "").replace(/\s+/g, " ").trim().slice(0, 220);
    activity.textContent = text;
    activity.title = text;
    activity.hidden = !text || !["sending", "working", "blocked", "error"].includes(status);
  }

  async function sync() {
    const id = projectId();
    if (!id) return render(null);
    const stored = await globalThis.LovaBurstStorage.get(KEY);
    render(stored[KEY]?.[id] || null);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) void sync();
  });
  new MutationObserver(() => void sync()).observe(projectValue, { childList: true, characterData: true, subtree: true });
  void sync();
})();
