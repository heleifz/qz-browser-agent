/**
 * Prove the Firefox agent runs: one session, Kyoto prompt, DeepSeek + tools + Wikipedia.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { openFirefoxSidebar } from "../firefox/launch.mjs";
import { openFromToolbar, captureBackgroundErrors } from "../firefox/driver.mjs";
import { readTestApiKey } from "../support/local-credentials.mjs";
import {
  KYOTO_PROMPT,
  installDeepseekRequestCounter,
  configureDeepseekLlm,
  waitFirefoxSidebarReady,
  acceptDataConsent,
  sendComposerPrompt,
  pollKyotoAgentEvidence,
  evaluateKyotoSmokeGate,
  mergeMaxToolCounts,
} from "./firefox-kyoto-evidence.mjs";

const extensionDir = process.env.QINGZHOU_FIREFOX_EXTENSION_DIR || "/workspace/dist/extension-firefox";
const apiKey = String(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_TOKEN || "").trim()
  || readTestApiKey("deepseek", { required: false });
if (!apiKey) {
  console.error("Missing DEEPSEEK_TOKEN / DEEPSEEK_API_KEY");
  process.exit(2);
}
const model = process.env.QINGZHOU_DEEPSEEK_MODEL || "deepseek-flash";
const artifactDir = process.env.QINGZHOU_ARTIFACT_DIR || "/opt/cursor/artifacts/firefox-agent-smoke";
const waitMs = Number(process.env.QINGZHOU_AGENT_WAIT_MS || 8 * 60_000);

await mkdir(artifactDir, { recursive: true });
process.env.QINGZHOU_FIREFOX_EXTENSION_DIR = extensionDir;
process.env.QINGZHOU_FIREFOX_EXTENSION_TIMEOUT_MS = "120000";

const session = await openFirefoxSidebar({ extensionDir });
await captureBackgroundErrors(session);
await installDeepseekRequestCounter(session);
await openFromToolbar(session);
await configureDeepseekLlm(session, { apiKey, model });
await waitFirefoxSidebarReady(session);
await acceptDataConsent(session);

const sent = await sendComposerPrompt(session, KYOTO_PROMPT);

const deadline = Date.now() + waitMs;
let lastEvidence = null;
const timeline = [];
let maxToolCounts = {};
let maxChildSessions = 0;
let maxWikipediaTabs = 0;
let maxDeepseek = 0;
let sessionCount = 0;

while (Date.now() < deadline) {
  lastEvidence = await pollKyotoAgentEvidence(session);
  maxToolCounts = mergeMaxToolCounts(maxToolCounts, lastEvidence);
  maxChildSessions = Math.max(maxChildSessions, lastEvidence.childSessionCount || 0);
  maxWikipediaTabs = Math.max(maxWikipediaTabs, lastEvidence.wikipediaTabCount || 0);
  maxDeepseek = Math.max(maxDeepseek, lastEvidence.deepseekRequests || 0);
  sessionCount = lastEvidence.sessionCount || 0;
  timeline.push({
    at: new Date().toISOString(),
    deepseekRequests: lastEvidence.deepseekRequests,
    sessionCount,
    childSessionCount: lastEvidence.childSessionCount,
    toolCounts: lastEvidence.toolCounts,
    wikipediaTabCount: lastEvidence.wikipediaTabCount,
  });
  const gate = evaluateKyotoSmokeGate({
    deepseekRequests: maxDeepseek,
    childSessionCount: maxChildSessions,
    sessionCount,
    wikipediaTabCount: maxWikipediaTabs,
    maxToolCounts,
  });
  if (gate.passed) break;
  await new Promise(resolve => setTimeout(resolve, 10_000));
}

const gate = evaluateKyotoSmokeGate({
  deepseekRequests: maxDeepseek,
  childSessionCount: maxChildSessions,
  sessionCount,
  wikipediaTabCount: maxWikipediaTabs,
  maxToolCounts,
});

const result = {
  extensionDir,
  model,
  sent,
  deepseekRequests: maxDeepseek,
  evidence: lastEvidence,
  maxToolCounts,
  maxChildSessions,
  maxWikipediaTabs,
  smokeGate: gate,
  timeline,
  success: gate.passed,
};

await writeFile(join(artifactDir, "agent-smoke.json"), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(join(artifactDir, "sidebar.png"), await session.page.screenshot({ fullPage: true }));
await session.close();

console.log(JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
