// Explicit live UX measurement; owns its browser profile and MCP service.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { localFetch, resultValue } from "../../services/mcp-bridge/src/client.mjs";
import { launchIsolatedExtensionMcp, saveExtensionLlmConfig, extensionRequest } from "../support/isolated-extension-mcp.mjs";

const { values } = parseArgs({ options: {
  label: { type: "string", default: "production" }, repetitions: { type: "string", default: "2" },
  cases: { type: "string", default: "A,B,C,D,E,F,G" }, output: { type: "string", default: "tests/results/flow-script" },
} });
const key = process.env.DEEPSEEK_API_KEY;
if (!key) throw new Error("Source the authorized DeepSeek environment file before this explicit live test.");
const directory = resolve(values.output); await mkdir(directory, { recursive: true });
const tasks = {
  A: "Read the latest stable version and its release date for requests and httpx from https://pypi.org/project/requests/ and https://pypi.org/project/httpx/. Return a compact table with package, version, release date and source URL.",
  B: "Find the infobox image URL on each of these English Wikipedia pages: https://en.wikipedia.org/wiki/Kinkaku-ji , https://en.wikipedia.org/wiki/Kiyomizu-dera , https://en.wikipedia.org/wiki/Fushimi_Inari-taisha , https://en.wikipedia.org/wiki/Ginkaku-ji , https://en.wikipedia.org/wiki/Ry%C5%8Dan-ji . Return exactly five rows with temple, image URL and page URL.",
  C: "Collect the book titles from the first three catalogue pages at https://books.toscrape.com/catalogue/page-1.html (pages 1, 2 and 3). Return all 60 titles grouped by page, with the three source URLs.",
  D: "Read https://example.com/ and return its page heading and the destination URL of its More information/Learn more link.",
  E: "On the public test site https://the-internet.herokuapp.com/login, sign in with its documented demo credentials tomsmith / SuperSecretPassword!, confirm the successful Secure Area page, then log out. Report the success message after login and the final page URL and heading after logout. This is an authorized test account, not a personal account.",
  F: "Open these three book source pages in separate tabs and keep all three open: https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html , https://books.toscrape.com/catalogue/tipping-the-velvet_999/index.html , https://books.toscrape.com/catalogue/soumission_998/index.html . Return a three-row table of title, price including tax, UPC and source URL.",
  G: "From https://books.toscrape.com/ collect the first ten books in displayed order. For each, collect title, price including tax, UPC, number in stock and product page URL. Save the ten records in a Data table named flow_books. Return the same ten rows, the stored row count and the table name.",
  controller: `This is a capability probe, not a UX benchmark. Call run_flow with timeout 60 and the following code, then report the result. Code: async () => {
    const tabs = await Promise.all(['https://example.com/', 'https://example.org/'].map(url => tools.open_tab({url})));
    const tabId = tabs[0].id;
    const ax = await tools.get_ax_tree({tabId,limit:15});
    const uid = JSON.stringify(ax).match(/uid:t[0-9]+\\.[a-z0-9]+\\.[0-9]+/)?.[0];
    const watch = await tools.$watch('wait_for_navigation',{tabId,next:true,timeout:15});
    await tools.navigate({tabId,url:'https://example.net/'});
    const navigation = await watch.wait();
    const stale = uid ? await tools.$settle('inspect_element',{tabId,target:uid}) : {error:'No snapshot UID'};
    const short = await tools.$settle('inspect_element',{tabId,target:'uid:1'});
    await tools.run_script({tabId,timeout:10,mutatesPage:true,code: '() => { const input=document.createElement("input");input.type="file";input.id="flow-file";document.body.append(input);setTimeout(()=>{const p=document.createElement("p");p.id="flow-ready";p.textContent="Flow ready";document.body.append(p)},100);return true; }'});
    await tools.wait_for_element({tabId,selector:'#flow-ready',text:'Flow ready',timeout:5});
    const uploaded = await tools.upload_files({tabId,target:'css:#flow-file',files:[{name:'flow.txt',content:'synthetic flow test',mimeType:'text/plain'}]});
    const selected = await tools.run_script({tabId,timeout:10,code:'async () => ({name:document.querySelector("#flow-file").files[0].name,content:await document.querySelector("#flow-file").files[0].text()})'});
    await tools.$emit({stage:'uploaded',selected:selected.result});
    await tools.screenshot({tabId,actionable:true});
    const hovered = await tools.act_on_screen({tabId,action:'hover',x:20,y:20,returnScreenshot:false});
    await tools.close_tab({tabId:tabs[1].id});
    return {navigation,stale,short,uploaded,selected:selected.result,hovered};
  }`,
  smoke: `This is a prototype smoke test, not a UX benchmark. Call run_flow once with timeout 60 and this code, then report its result and final observation. Code: async () => {
    const tabs = await Promise.all(['https://example.com/', 'https://example.org/'].map(url => tools.open_tab({url})));
    const tabId = tabs[0].id;
    const found = await tools.find_elements({tabId, selector:'a', limit:5});
    const clicked = await tools.act_on_element({tabId, target:'css:a', action:'click'});
    await tools.navigate({tabId, url:'https://example.net/'});
    const read = await tools.run_script({tabId, target:'page', timeout:10, code:'() => ({heading:document.querySelector("h1")?.textContent ?? null,title:document.title,url:location.href})'});
    await tools.screenshot({tabId});
    await tools.close_tab({tabId:tabs[1].id});
    return {found, navigated:clicked.navigated, page:read.result};
  }`,
  timeout: "This is a timeout probe, not a UX benchmark. Call run_flow exactly once with timeout 2 and code: async () => { const t=await tools.open_tab({url:'https://example.com/'}); await tools.$emit({stage:'ready',tabId:t.id}); await new Promise(resolve=>setTimeout(resolve,10000)); await tools.navigate({tabId:t.id,url:'https://example.org/'}); return 'late navigation'; }. After the expected timeout, report the failure without retrying any action.",
  stop: "This is a cancellation smoke test. Call run_flow with timeout 0 and code: async () => { const t=await tools.open_tab({url:'https://example.com/'}); await tools.$emit({stage:'ready',tabId:t.id}); await new Promise(resolve=>setTimeout(resolve,10000)); await tools.navigate({tabId:t.id,url:'https://example.org/'}); return 'late navigation'; }. The test operator will press Stop during the wait.",
};
const report = { label: values.label, startedAt: new Date().toISOString(), extension: process.env.QINGZHOU_TEST_EXTENSION_DIR,  provider: "deepseek", model: "deepseek-flash", contextWindow: 1000000, vision: true, tasks: [] };
const redact = value => String(value).split(key).join("[REDACTED]");
let environment, client, transport, active;
const pendingResponses = new Set();
let current;
const persist = () => writeFile(`${directory}/${values.label}.json`, redact(JSON.stringify(report, null, 2)));
try {
  environment = await launchIsolatedExtensionMcp({ profilePrefix: "qz-flow-ux-", requestTimeoutSeconds: 60 });
  const clientId = environment.bridgeStatus.clients[0].clientId;
  report.browserVersion = environment.context.browser()?.version();
  await saveExtensionLlmConfig(environment.page, { provider: report.provider, apiKey: key, model: report.model,
    contextWindow: report.contextWindow, vision: true, trimOldToolResults: true, debugMode: false });
  environment.context.on("request", request => {
    if (new URL(request.url()).hostname === "api.deepseek.com" && current) {
      current.modelCalls++;
      const payload = request.postDataJSON();
      current.advertisedFlow ??= payload?.tools?.some(tool => tool.function?.name === 'run_flow');
      const system = JSON.stringify(payload?.messages?.filter(message => message.role === 'system') || []);
      current.systemPrefersFlow ??= system.includes('Prefer run_flow') || system.includes('优先使用 run_flow');
    }
  });
  environment.context.on("response", response => {
    if (new URL(response.url()).hostname !== "api.deepseek.com" || !current) return;
    const entry = current;
    const pending = (async () => {
      const body = await response.text();
      const chunks = body.startsWith("data:") ? body.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).filter(line => line !== "[DONE]") : [body];
      let usage;
      for (const chunk of chunks) { try { const value = JSON.parse(chunk); if (value.usage) usage = value.usage; } catch {} }
      entry.responses.push({ status: response.status(), usage });
      if (usage) entry.totalTokens = (entry.totalTokens || 0) + Number(usage.total_tokens || (usage.prompt_tokens + usage.completion_tokens) || 0);
    })().catch(error => entry.responses.push({ error: redact(error) }));
    pendingResponses.add(pending); void pending.finally(() => pendingResponses.delete(pending));
  });
  client = new Client({ name: "flow-ux", version: "1" });
  transport = new StreamableHTTPClientTransport(new URL(environment.bridge.mcpUrl), { fetch: localFetch });
  await client.connect(transport);
  async function mcp(name, args) {
    const result = await client.callTool({ name, arguments: { clientId, ...args } }, undefined, { timeout: 70000 });
    const value = resultValue(result); if (result.isError) throw new Error(JSON.stringify(value)); return value;
  }
  for (let repeat = 1; repeat <= Number(values.repetitions); repeat++) for (const id of values.cases.split(",")) {
    const entry = current = { id, repeat, prompt: tasks[id], modelCalls: 0, totalTokens: null, responses: [] };
    report.tasks.push(entry); const start = Date.now();
    try {
      const created = await mcp("qingzhou_create_session", { title: `Flow UX ${values.label} ${id}-${repeat}`, firstMessage: tasks[id] });
      active = created.session?.id || created.sessionId; entry.sessionId = active;
      if (!active) throw new Error("Missing created session ID");
      let snapshot;
      do {
        await delay(500);
        snapshot = await mcp("qingzhou_get_session_snapshot", { sessionId: active, compact: false, tail: false });
        if (id === 'stop' && (snapshot.transcript || []).some(item => item.name === 'run_flow' && item.result?.checkpoints?.some(checkpoint => checkpoint.value?.stage === 'ready'))) {
          await delay(2000);
          const stopping = Date.now();
          await mcp('qingzhou_stop_session', {sessionId:active});
          entry.stopAckMs = Date.now() - stopping;
          const tabsBefore = await environment.page.evaluate(() => chrome.tabs.query({}));
          await delay(11000);
          const tabsAfter = await environment.page.evaluate(() => chrome.tabs.query({}));
          entry.noLateNavigation = tabsBefore.every(tab => tabsAfter.find(after => after.id === tab.id)?.url === tab.url);
          entry.observedAfterStopMs = Date.now() - stopping;
          snapshot = await mcp('qingzhou_get_session_snapshot', {sessionId:active, compact:false, tail:false});
          break;
        }
        if (["completed", "failed", "error", "aborted", "waiting_user"].includes(snapshot.status)) break;
      } while (Date.now() - start < 300000);
      entry.wallMs = Date.now() - start; entry.status = snapshot.status;
      entry.choseFlow = (snapshot.transcript || []).some(entry => entry.type === 'tool' && entry.name === 'run_flow');
      if (id === 'timeout') {
        const before = await environment.page.evaluate(() => chrome.tabs.query({}));
        await delay(11000);
        const after = await environment.page.evaluate(() => chrome.tabs.query({}));
        entry.noLateNavigation = before.every(tab => after.find(other => other.id === tab.id)?.url === tab.url);
        entry.observedAfterCompletionMs = 11000;
      }
      entry.snapshotFile = `${values.label}-${id}-${repeat}.json`;
      if (id === 'F') entry.openSourceTabs = await environment.page.evaluate(() => chrome.tabs.query({}).then(tabs => tabs.filter(tab => ['a-light-in-the-attic_1000','tipping-the-velvet_999','soumission_998'].some(slug => tab.url === 'https://books.toscrape.com/catalogue/' + slug + '/index.html')).map(tab => ({id:tab.id,url:tab.url}))));
      if (id === 'G') entry.dataTables = await mcp('qingzhou_list_data_tables', {});
      await writeFile(`${directory}/${entry.snapshotFile}`, redact(JSON.stringify(snapshot, null, 2)));
      if (snapshot.status !== "completed") await mcp("qingzhou_stop_session", { sessionId: active });
      active = null;
    } catch (error) {
      entry.wallMs = Date.now() - start; entry.error = redact(error);
      if (active) {
        try {
          const history = await extensionRequest(environment.page, 'get_history', {sessionId:active}, 'history', 10000);
          entry.recoverySnapshotFile = `${values.label}-${id}-${repeat}-history.json`;
          await writeFile(`${directory}/${entry.recoverySnapshotFile}`, redact(JSON.stringify(history, null, 2)));
        } catch (inspectionError) { entry.inspectionError = redact(inspectionError); }
      }
    }
    await Promise.all([...pendingResponses]); current = null;
    await persist(); console.log(JSON.stringify({ ...entry, prompt: undefined, responses: undefined }));
    if (active) {
      await mcp("qingzhou_stop_session", { sessionId: active }).catch(() => extensionRequest(environment.page, 'stop_session', {sessionId:active}, 'state', 10000).catch(() => {}));
      active = null;
    }
  }
} catch (error) { report.error = redact(error.stack || error); report.setupDiagnostics = (error.diagnostics || []).map(redact); process.exitCode = 1; }
finally {
  await transport?.terminateSession().catch(() => {}); await client?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.diagnostics = (environment?.diagnostics || []).map(redact);
  await environment?.close(); await persist();
}
