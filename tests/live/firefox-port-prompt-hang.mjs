/**
 * Documents Firefox frame-script vs port prompt dispatch behavior.
 */
import { openFirefoxSidebar } from "../firefox/launch.mjs";
import { openFromToolbar } from "../firefox/driver.mjs";
import { installFirefoxLiveHarness, callFirefoxHarness } from "../firefox/live-harness.mjs";

process.env.QINGZHOU_FIREFOX_EXTENSION_DIR = process.env.QINGZHOU_FIREFOX_EXTENSION_DIR || "/workspace/dist/extension-firefox";
process.env.QINGZHOU_FIREFOX_EXTENSION_TIMEOUT_MS = "25000";

const session = await openFirefoxSidebar({ extensionDir: process.env.QINGZHOU_FIREFOX_EXTENSION_DIR });
await openFromToolbar(session);
await session.extension("sidebar", `
  const win = Cu.waiveXrays(content);
  content.document.querySelector("[data-consent-accept]")?.click();
  const response = await win.chrome.runtime.sendMessage({ type: "accept_data_consent", version: 1 });
  if (!response?.ok) throw new Error(response?.message || "consent failed");
  return true;
`);
await installFirefoxLiveHarness(session);

const created = await callFirefoxHarness(session, `
  harness.request("create_ui_session", { title: "hang-test", firstMessage: "" }, "create_ui_session_result", 20000)
`);
const sessionId = created.session.id;

const t0 = Date.now();
let phase = "sync_send";
try {
  await callFirefoxHarness(session, `
    harness.send("prompt", { sessionId: ${JSON.stringify(sessionId)}, text: "ping", clientMessageId: "hang1" });
    "sync_done"
  `);
  phase = "sync_send_returned";
} catch (error) {
  phase = `sync_send_error:${error.message}`;
}

const deferred = await callFirefoxHarness(session, `
  const started = Date.now();
  content.setTimeout(() => {
    try {
      harness.send("prompt", { sessionId: ${JSON.stringify(sessionId)}, text: "ping2", clientMessageId: "hang2" });
      win.__qzDeferredSend = "posted";
    } catch (error) {
      win.__qzDeferredSend = String(error);
    }
  }, 0);
  "deferred_scheduled"
`).catch(error => `deferred_schedule_error:${error.message}`);

await new Promise(resolve => setTimeout(resolve, 3000));
const deferredState = await callFirefoxHarness(session, `win.__qzDeferredSend || "pending"`).catch(() => "unreadable");

await session.close();
console.log(JSON.stringify({
  sessionId,
  syncPhase: phase,
  syncElapsedMs: Date.now() - t0,
  deferred,
  deferredState,
  note: "If sync_send blocks until extension script timeout, Firefox is dispatching port prompt handling synchronously into the sidebar frame-script thread.",
}, null, 2));
