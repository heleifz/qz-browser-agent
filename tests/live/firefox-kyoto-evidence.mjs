/**
 * Shared polling and smoke-gate checks for Firefox Kyoto live runs.
 */

export const KYOTO_PROMPT = "并行查京都5个经典的图片（wikipedia）";

/** @param {import("../firefox/launch.mjs").FirefoxSession} session */
export async function installDeepseekRequestCounter(session) {
  return session.extension("background", `
    if (!view.__qzDeepseekRequestCount) {
      view.__qzDeepseekRequestCount = 0;
      view.chrome.webRequest.onBeforeRequest.addListener(
        details => { if (details.url.includes("api.deepseek.com")) view.__qzDeepseekRequestCount += 1; },
        { urls: ["https://api.deepseek.com/*"] },
      );
    }
    return true;
  `);
}

/** @param {import("../firefox/launch.mjs").FirefoxSession} session */
export async function configureDeepseekLlm(session, { apiKey, model }) {
  await session.extension("background", `
    await view.chrome.storage.local.set({
      llmConfig: {
        provider: "deepseek",
        apiKey: ${JSON.stringify(apiKey)},
        model: ${JSON.stringify(model)},
        vision: true,
        contextWindow: 128000,
        trimOldToolResults: true,
        toolCalling: true,
      },
    });
    return true;
  `);
}

/** @param {import("../firefox/launch.mjs").FirefoxSession} session */
export async function waitFirefoxSidebarReady(session, { maxAttempts = 90 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const boot = await session.extension("sidebar", `
      const doc = content.document;
      const app = doc.querySelector("#app");
      doc.querySelector("[data-consent-accept]")?.click();
      const ready = app && !app.hasAttribute("data-workspace-booting") && !app.hasAttribute("data-consent-pending");
      const status = doc.querySelector("#status-text")?.textContent || "";
      return { ready: ready && !!doc.querySelector("#input"), status };
    `);
    if (boot.ready && !/Checking model settings/i.test(boot.status)) return boot;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("sidebar did not become ready");
}

/** @param {import("../firefox/launch.mjs").FirefoxSession} session */
export async function acceptDataConsent(session) {
  return session.extension("sidebar", `
    const win = Cu.waiveXrays(content);
    const response = await win.chrome.runtime.sendMessage({ type: "accept_data_consent", version: 1 });
    if (!response?.ok) throw new Error(response?.message || "accept_data_consent failed");
    return true;
  `);
}

/** @param {import("../firefox/launch.mjs").FirefoxSession} session */
export async function sendComposerPrompt(session, promptText) {
  return session.extension("sidebar", `
    const doc = content.document;
    const input = doc.querySelector("#input");
    const button = doc.querySelector("#btn-send");
    if (!input || !button) throw new Error("composer missing");
    input.focus();
    input.value = ${JSON.stringify(promptText)};
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const started = Date.now();
    while (button.disabled && Date.now() - started < 30_000) {
      await new Promise(resolve => content.setTimeout(resolve, 200));
    }
    if (button.disabled) throw new Error("send stayed disabled");
    button.click();
    return { clicked: true, valueLen: input.value.length };
  `);
}

/**
 * @param {import("../firefox/launch.mjs").FirefoxSession} session
 * @returns {Promise<Record<string, unknown>>}
 */
export async function pollKyotoAgentEvidence(session) {
  return session.extension("background", `
    const deepseekRequests = view.__qzDeepseekRequestCount || 0;
    const all = await view.chrome.storage.local.get(null);
    const sessions = all._sessions || {};
    const sessionIds = Object.keys(sessions);
    const toolCounts = {};
    let rootSessionId = "";
    const sessionRows = [];
    for (const id of sessionIds) {
      const meta = sessions[id] || {};
      const parentSessionId = String(meta.parentSessionId || "0");
      if (!parentSessionId || parentSessionId === "0") rootSessionId = rootSessionId || id;
      sessionRows.push({
        id,
        title: meta.title || "",
        parentSessionId,
        listStatus: meta.listSummary?.status || "",
      });
      const cp = all["_session_transcript_checkpoint_" + id] || {};
      const record = all["_session_" + id] || {};
      const transcript = [
        ...(Array.isArray(cp.transcript) ? cp.transcript : []),
        ...(Array.isArray(record.currentTranscript) ? record.currentTranscript : []),
      ];
      for (const entry of transcript) {
        if (entry?.type === "tool" && entry?.name) {
          toolCounts[entry.name] = (toolCounts[entry.name] || 0) + 1;
        }
      }
    }
    const childSessions = sessionRows.filter(row => row.parentSessionId && row.parentSessionId !== "0");
    const ledger = all._session_resource_ledger_v1 || {};
    const galleryArtifacts = [];
    for (const sid of Object.keys(ledger)) {
      const items = Array.isArray(ledger[sid]) ? ledger[sid] : [];
      for (const item of items) {
        const kind = String(item?.kind || "");
        if (kind.includes("image") || kind === "image_collection") {
          galleryArtifacts.push({
            sessionId: sid,
            kind,
            title: item?.title || "",
            assetCount: item?.assetCount || item?.imageCount || 0,
            table: item?.table || "",
          });
        }
      }
    }
    const collectImagesCalls = toolCounts.collect_images || 0;
    const galleryWithImages = galleryArtifacts.some(a => (a.assetCount || 0) > 0)
      || collectImagesCalls > 0;
    let finalAssistantAnswer = "";
    if (rootSessionId) {
      const cp = all["_session_transcript_checkpoint_" + rootSessionId] || {};
      const record = all["_session_" + rootSessionId] || {};
      const transcript = [
        ...(Array.isArray(cp.transcript) ? cp.transcript : []),
        ...(Array.isArray(record.currentTranscript) ? record.currentTranscript : []),
      ];
      for (let i = transcript.length - 1; i >= 0; i -= 1) {
        const entry = transcript[i];
        if (entry?.type === "assistant" && typeof entry.content === "string" && entry.content.trim()) {
          finalAssistantAnswer = entry.content.trim();
          break;
        }
      }
    }
    const tabs = await view.chrome.tabs.query({});
    const wikipediaTabs = tabs.filter(tab => String(tab.url || "").includes("wikipedia.org"));
    const anyRunning = sessionRows.some(row => row.listStatus === "running");
    return {
      deepseekRequests,
      sessionCount: sessionIds.length,
      rootSessionId,
      sessions: sessionRows,
      childSessionCount: childSessions.length,
      toolCounts,
      wikipediaTabCount: wikipediaTabs.length,
      wikipediaUrls: wikipediaTabs.map(tab => tab.url).slice(0, 12),
      galleryArtifacts,
      galleryWithImages,
      collectImagesCalls,
      finalAssistantAnswer,
      anyRunning,
      bgErrors: (view.__qzTestErrors || []).slice(-8),
    };
  `);
}

/**
 * Strict smoke gate: 1 root + 5 children, DeepSeek, tools, ≥5 Wikipedia tabs.
 * @param {Record<string, number>} maxToolCounts
 */
export function evaluateKyotoSmokeGate({
  deepseekRequests = 0,
  childSessionCount = 0,
  sessionCount = 0,
  wikipediaTabCount = 0,
  maxToolCounts = {},
} = {}) {
  const toolKinds = Object.keys(maxToolCounts).length;
  const deepseekOk = deepseekRequests > 0;
  const childrenOk = childSessionCount >= 5 && sessionCount >= 6;
  const toolsOk = toolKinds > 0;
  const wikipediaOk = wikipediaTabCount >= 5;
  const passed = deepseekOk && childrenOk && toolsOk && wikipediaOk;
  return {
    passed,
    deepseekOk,
    childrenOk,
    toolsOk,
    wikipediaOk,
    reasons: [
      !deepseekOk && "no_deepseek_requests",
      !childrenOk && `children_${childSessionCount}_sessions_${sessionCount}`,
      !toolsOk && "no_tool_calls",
      !wikipediaOk && `wikipedia_tabs_${wikipediaTabCount}`,
    ].filter(Boolean),
  };
}

/** @param {Record<string, unknown>} evidence */
export function mergeMaxToolCounts(maxToolCounts, evidence) {
  const next = { ...maxToolCounts };
  for (const [name, count] of Object.entries(evidence.toolCounts || {})) {
    next[name] = Math.max(next[name] || 0, count);
  }
  return next;
}
