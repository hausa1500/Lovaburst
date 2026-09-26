(() => {
  if (window.__LOVABURST_CHATGPT_RESULT_REFRESH__) return;
  window.__LOVABURST_CHATGPT_RESULT_REFRESH__ = true;

  const KEY = "projectRunStatuses";
  const REQUEST_MARKERS = ["[LOVABURST_SERVER_AUTHORITY_V1]", "[LOVABURST_AGENT_SERVER_V1]", "[LOVABURST_AGENT_GITHUB_V1]", "[LOVABURST_AGENT_DIRECT_V1]", "[LOVABURST_AGENT_STEP_V1]", "[LOVABURST_REQUEST_V7]", "[LOVABURST_REQUEST_V6]", "[LOVABURST_REQUEST_V5]", "[LOVABURST_REQUEST_V4]", "[LOVABURST_REQUEST_V3]", "[LOVABURST_REQUEST_V2]", "[LOVABURST_REQUEST_V1]"];
  const PROJECT_RE = /LOVABLE_PROJECT:\s*([A-Za-z0-9-]+)/i;
  const PROJECT_JSON_RE = /"(?:lovableProjectId|projectId)"\s*:\s*"([A-Za-z0-9-]{1,120})"/i;
  const isRequest = (text) => REQUEST_MARKERS.some((marker) => String(text || "").includes(marker));

  function markerFromText(text, completionToken) {
    const token = String(completionToken || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    const value = String(text || "");
    const matches = value.matchAll(/\[LOVABURST_(DONE|BLOCKED|ERROR):([a-f0-9\s]{64,96})\]/gi);
    for (const match of matches) {
      const actual = String(match[2] || "").replace(/\s+/g, "").toLowerCase();
      if (actual !== token) continue;
      const kind = String(match[1] || "").toUpperCase();
      const status = kind === "DONE" ? "done" : kind === "BLOCKED" ? "blocked" : "error";
      return { marker: `[LOVABURST_${kind}:${token}]`, status, completionToken: token };
    }
    return null;
  }

  function compact(text) {
    return String(text || "").replace(/\s+/g, " ").trim().slice(-1200);
  }

  function latestCandidate(projectId, completionToken) {
    const id = String(projectId || "").trim();
    if (!id) return null;

    const messages = Array.from(
      document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"]'),
    );

    let requestIndex = -1;
    for (let index = 0; index < messages.length; index += 1) {
      const element = messages[index];
      if (element.getAttribute("data-message-author-role") !== "user") continue;
      const text = String(element.innerText || element.textContent || "").trim();
      if (!isRequest(text)) continue;
      const foundProjectId = text.match(PROJECT_JSON_RE)?.[1] || text.match(PROJECT_RE)?.[1] || "";
      if (foundProjectId === id) requestIndex = index;
    }
    if (requestIndex < 0) return null;

    let candidate = null;
    for (let index = requestIndex + 1; index < messages.length; index += 1) {
      const element = messages[index];
      const role = element.getAttribute("data-message-author-role") || "";
      const text = String(element.innerText || element.textContent || "").trim();
      if (!text) continue;
      if (role === "user" && isRequest(text)) break;
      if (role !== "assistant") continue;

      const marker = markerFromText(text, completionToken);
      if (!marker) continue;

      const messageId =
        element.getAttribute("data-message-id") ||
        element.closest("[data-message-id]")?.getAttribute("data-message-id") ||
        "";

      candidate = {
        projectId: id,
        marker: marker.marker,
        status: marker.status,
        assistantMessageKey: messageId || `${index}:${marker.marker}:${text.length}`,
        text,
        completionToken,
      };
    }
    return candidate;
  }

  async function persist(candidate) {
    if (!candidate) return null;
    const stored = await globalThis.LovaBurstStorage.get(KEY);
    const statuses = stored[KEY] || {};
    const previous = statuses[candidate.projectId] || {};
    const expectedToken = String(previous.completionToken || "").toLowerCase();
    if (!expectedToken || expectedToken !== String(candidate.completionToken || "").toLowerCase()) return null;

    if (
      previous.marker === candidate.marker &&
      previous.assistantMessageKey === candidate.assistantMessageKey
    ) {
      return previous;
    }

    const now = new Date().toISOString();
    const next = {
      ...previous,
      projectId: candidate.projectId,
      status: candidate.status,
      marker: candidate.marker,
      completionToken: expectedToken,
      detectedAt: now,
      completedAt: now,
      chatUrl: location.href,
      chatTitle: document.title || "ChatGPT",
      assistantMessageKey: candidate.assistantMessageKey,
      excerpt: compact(candidate.text),
      error: candidate.status === "error" ? compact(candidate.text) : "",
      updatedAt: now,
    };

    await globalThis.LovaBurstStorage.set({
      [KEY]: {
        ...statuses,
        [candidate.projectId]: next,
      },
    });
    return next;
  }

  globalThis.LovaBurstRuntime.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "LOVABURST_SCAN_RESULT_MARKERS") return false;
    const expectedUrl = String(message.expectedUrl || "").trim();
    if (expectedUrl && window.location.href !== expectedUrl) {
      sendResponse({ ok: false, error: "A conversa vinculada mudou antes da leitura do resultado." });
      return false;
    }
    const projectId = String(message.projectId || "").trim();

    globalThis.LovaBurstStorage.get(KEY)
      .then((stored) => {
        const completionToken = String(stored[KEY]?.[projectId]?.completionToken || "").toLowerCase();
        return latestCandidate(projectId, completionToken);
      })
      .then(persist)
      .then(async (saved) => {
        if (saved) {
          sendResponse({
            ok: true,
            projectId,
            status: String(saved.status || ""),
            marker: String(saved.marker || ""),
          });
          return;
        }

        const stored = await globalThis.LovaBurstStorage.get(KEY);
        const current = stored[KEY]?.[projectId] || null;
        sendResponse({
          ok: true,
          projectId,
          status: String(current?.status || ""),
          marker: String(current?.marker || ""),
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  });
})();
