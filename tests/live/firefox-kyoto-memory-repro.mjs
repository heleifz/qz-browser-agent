/**
 * Live Firefox Kyoto memory repro: smoke setup, strict smoke gate, RSS sampling.
 */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readTestApiKey } from "../support/local-credentials.mjs";
import { openFirefoxSidebar } from "../firefox/launch.mjs";
import { openFromToolbar, captureBackgroundErrors } from "../firefox/driver.mjs";
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

const label = String(process.env.QINGZHOU_LIVE_LABEL || "run").trim();
const artifactRoot = resolve(process.env.QINGZHOU_ARTIFACT_DIR || `/opt/cursor/artifacts/firefox-kyoto-${label}`);
const maxMinutes = Number(process.env.QINGZHOU_LIVE_MAX_MINUTES || 15);
const rssCapRatio = Number(process.env.QINGZHOU_LIVE_RSS_CAP_RATIO || 0.7);
const pollMs = Number(process.env.QINGZHOU_LIVE_POLL_MS || 5000);

const apiKey = String(process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_TOKEN || "").trim()
  || readTestApiKey("deepseek", { required: false });
if (!apiKey) {
  console.error("Missing DeepSeek credential: set DEEPSEEK_API_KEY or DEEPSEEK_TOKEN");
  process.exit(2);
}
const model = String(process.env.QINGZHOU_DEEPSEEK_MODEL || "deepseek-flash").trim();
const extensionDir = process.env.QINGZHOU_FIREFOX_EXTENSION_DIR;
if (!extensionDir) {
  console.error("Set QINGZHOU_FIREFOX_EXTENSION_DIR to a built dist/extension-firefox directory");
  process.exit(2);
}

const report = {
  label,
  extensionDir,
  model,
  prompt: KYOTO_PROMPT,
  startedAt: new Date().toISOString(),
  memorySamples: [],
  peakByPid: {},
  agentTimeline: [],
  snapshots: [],
  maxToolCounts: {},
  maxChildSessions: 0,
  maxWikipediaTabs: 0,
  maxDeepseekRequests: 0,
  smokeGate: { passed: false, passedAt: "", reasons: [] },
  galleryWithImages: false,
  galleryArtifacts: [],
  finalAssistantAnswer: "",
  rootSessionId: "",
  stoppedReason: "",
  errors: [],
  validRun: false,
};

function redact(value) {
  return String(value ?? "").split(apiKey).join("[redacted]");
}

function sampleFirefoxRss() {
  try {
    const out = execFileSync("bash", ["-lc", "ps -eo pid,rss,comm,args | grep -E \"[f]irefox|[F]irefox\" || true"], { encoding: "utf8" });
    const rows = out.split("\n").filter(Boolean).map(line => {
      const match = /^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line.trim());
      if (!match) return null;
      return { pid: Number(match[1]), rssKiB: Number(match[2]), comm: match[3], args: match[4].slice(0, 200) };
    }).filter(Boolean);
    return { at: new Date().toISOString(), rows, totalRssKiB: rows.reduce((sum, row) => sum + row.rssKiB, 0) };
  } catch (error) {
    return { at: new Date().toISOString(), error: redact(error.message), rows: [], totalRssKiB: 0 };
  }
}

function recordPeakByPid(snap, peakByPid) {
  for (const row of snap.rows || []) {
    const prev = peakByPid[row.pid] || { rssKiB: 0, comm: row.comm };
    if (row.rssKiB >= prev.rssKiB) {
      peakByPid[row.pid] = { rssKiB: row.rssKiB, comm: row.comm, args: row.args };
    }
  }
}

let totalRamKiB = 0;
try {
  totalRamKiB = Number(execFileSync("awk", ["/MemTotal/ {print $2}", "/proc/meminfo"], { encoding: "utf8" }).trim()) || 0;
} catch { /* ignore */ }
const rssCapKiB = totalRamKiB > 0 ? Math.floor(totalRamKiB * rssCapRatio) : 0;

await mkdir(artifactRoot, { recursive: true });
const memoryLog = join(artifactRoot, "memory-rss.log");

/** @type {Awaited<ReturnType<typeof openFirefoxSidebar>> | undefined} */
let session;
let monitorTimer;

async function dumpAboutMemory(tag) {
  try {
    const snapshot = await session.chrome(`
      const win = Services.wm.getMostRecentWindow("navigator:browser") || window;
      const tab = win.gBrowser.addTrustedTab("about:memory");
      const browser = tab.linkedBrowser;
      const text = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("about:memory load timed out")), 45000);
        const finish = () => { clearTimeout(timer); resolve(browser.contentDocument?.body?.innerText || ""); };
        if (browser.contentDocument?.readyState === "complete") finish();
        else tab.addEventListener("load", finish, true);
      });
      win.gBrowser.removeTab(tab);
      return text;
    `);
    const path = join(artifactRoot, `about-memory-${tag}.txt`);
    await writeFile(path, String(snapshot || "").slice(0, 8_000_000));
    report.snapshots.push({ kind: "about:memory", tag, path });
    return path;
  } catch (error) {
    report.errors.push({ phase: `about:memory:${tag}`, message: redact(error.message) });
    return "";
  }
}

function startMemoryMonitor(onSample) {
  const tick = async () => {
    const snap = sampleFirefoxRss();
    report.memorySamples.push(snap);
    recordPeakByPid(snap, report.peakByPid);
    await appendFile(memoryLog, `${JSON.stringify(snap)}\n`);
    if (typeof onSample === "function") onSample(snap);
    if (rssCapKiB > 0 && snap.totalRssKiB >= rssCapKiB && !report.stoppedReason) {
      report.stoppedReason = `rss_cap:${snap.totalRssKiB}KiB>=${rssCapKiB}KiB`;
    }
  };
  monitorTimer = setInterval(() => { void tick(); }, pollMs);
  void tick();
}

const deadline = Date.now() + maxMinutes * 60_000;
let lastPeakDump = 0;
let peakTotalRss = 0;

try {
  process.env.QINGZHOU_FIREFOX_EXTENSION_DIR = extensionDir;
  process.env.QINGZHOU_FIREFOX_EXTENSION_TIMEOUT_MS = "120000";
  session = await openFirefoxSidebar({ extensionDir });
  await captureBackgroundErrors(session);
  await installDeepseekRequestCounter(session);

  startMemoryMonitor(async snap => {
    if (snap.totalRssKiB > peakTotalRss) {
      peakTotalRss = snap.totalRssKiB;
      if (peakTotalRss - lastPeakDump > 256 * 1024) {
        lastPeakDump = peakTotalRss;
        await dumpAboutMemory(`peak-${Math.round(peakTotalRss / 1024)}MiB`);
      }
    }
  });

  await openFromToolbar(session);
  await configureDeepseekLlm(session, { apiKey, model });
  await waitFirefoxSidebarReady(session);
  await acceptDataConsent(session);
  await dumpAboutMemory("start");

  const sent = await sendComposerPrompt(session, KYOTO_PROMPT);
  report.promptSend = sent;

  let smokeGatePassedAt = 0;
  let lastEvidence = null;

  while (Date.now() < deadline && !report.stoppedReason) {
    try {
      lastEvidence = await pollKyotoAgentEvidence(session);
    } catch (error) {
      report.errors.push({ phase: "poll", message: redact(error.message) });
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }

    report.maxToolCounts = mergeMaxToolCounts(report.maxToolCounts, lastEvidence);
    report.maxChildSessions = Math.max(report.maxChildSessions, lastEvidence.childSessionCount || 0);
    report.maxWikipediaTabs = Math.max(report.maxWikipediaTabs, lastEvidence.wikipediaTabCount || 0);
    report.maxDeepseekRequests = Math.max(report.maxDeepseekRequests, lastEvidence.deepseekRequests || 0);
    if (lastEvidence.galleryWithImages) report.galleryWithImages = true;
    if ((lastEvidence.galleryArtifacts || []).length) report.galleryArtifacts = lastEvidence.galleryArtifacts;
    if (lastEvidence.finalAssistantAnswer) report.finalAssistantAnswer = lastEvidence.finalAssistantAnswer;
    if (lastEvidence.rootSessionId) report.rootSessionId = lastEvidence.rootSessionId;

    const gate = evaluateKyotoSmokeGate({
      deepseekRequests: report.maxDeepseekRequests,
      childSessionCount: report.maxChildSessions,
      sessionCount: lastEvidence.sessionCount || 0,
      wikipediaTabCount: report.maxWikipediaTabs,
      maxToolCounts: report.maxToolCounts,
    });

    report.agentTimeline.push({
      at: new Date().toISOString(),
      deepseekRequests: lastEvidence.deepseekRequests,
      sessionCount: lastEvidence.sessionCount,
      childSessionCount: lastEvidence.childSessionCount,
      wikipediaTabCount: lastEvidence.wikipediaTabCount,
      anyRunning: lastEvidence.anyRunning,
      toolCounts: lastEvidence.toolCounts,
      smokeGatePassed: gate.passed,
    });

    if (gate.passed && !report.smokeGate.passed) {
      report.smokeGate.passed = true;
      report.smokeGate.passedAt = new Date().toISOString();
      smokeGatePassedAt = Date.now();
      await dumpAboutMemory("smoke-gate");
    }
    report.smokeGate.reasons = gate.reasons;

    if (report.smokeGate.passed && !lastEvidence.anyRunning) {
      const rootIdle = (lastEvidence.sessions || []).find(
        row => row.id === report.rootSessionId,
      )?.listStatus !== "running";
      if (rootIdle) {
        report.stoppedReason = "root_finished_idle";
        break;
      }
    }

    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  if (!report.stoppedReason && Date.now() >= deadline) report.stoppedReason = "time_cap";

  const finalGate = evaluateKyotoSmokeGate({
    deepseekRequests: report.maxDeepseekRequests,
    childSessionCount: report.maxChildSessions,
    sessionCount: lastEvidence?.sessionCount || 0,
    wikipediaTabCount: report.maxWikipediaTabs,
    maxToolCounts: report.maxToolCounts,
  });
  report.smokeGate.passed = finalGate.passed;
  report.smokeGate.reasons = finalGate.reasons;
  report.validRun = finalGate.passed && !report.errors.some(e => e.phase === "run");

  await dumpAboutMemory("end");
  await writeFile(join(artifactRoot, "sidebar.png"), await session.page.screenshot({ fullPage: true }));
} catch (error) {
  report.errors.push({ phase: "run", message: redact(error.stack || error.message) });
  report.stoppedReason = report.stoppedReason || "error";
  await dumpAboutMemory("error").catch(() => undefined);
} finally {
  clearInterval(monitorTimer);
  report.finishedAt = new Date().toISOString();
  report.peakRssKiB = report.memorySamples.reduce((max, row) => Math.max(max, row.totalRssKiB || 0), 0);
  report.peakRssMiB = Math.round((report.peakRssKiB / 1024) * 10) / 10;
  report.memTotalGiB = totalRamKiB > 0 ? Math.round((totalRamKiB / 1024 / 1024) * 100) / 100 : 0;
  report.rssCapKiB = rssCapKiB;
  await writeFile(join(artifactRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await session?.close().catch(() => undefined);
}

const summary = {
  label,
  validRun: report.validRun,
  peakRssMiB: report.peakRssMiB,
  stoppedReason: report.stoppedReason,
  smokeGate: report.smokeGate,
  maxDeepseekRequests: report.maxDeepseekRequests,
  maxChildSessions: report.maxChildSessions,
  maxWikipediaTabs: report.maxWikipediaTabs,
  maxToolCounts: report.maxToolCounts,
  galleryWithImages: report.galleryWithImages,
  finalAssistantAnswer: report.finalAssistantAnswer.slice(0, 500),
  errors: report.errors.map(item => item.message),
  artifactRoot,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(report.validRun && report.errors.length === 0 ? 0 : 1);
