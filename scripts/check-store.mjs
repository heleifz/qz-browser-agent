#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenizer } from "acorn";
import { loadExtension, loadRules, runRules, formatJson, stripComments } from "storecheck";

const STORECHECK_VERSION = "0.1.0";
const REVIEWED_SANDBOXES = new Map([
  ["runner-sandbox.js", {
    page: "runner-sandbox.html", script: "runner-sandbox.js",
    tokens: "be360135e3b288b310f1fd14dfac454cc9620223262b2be8b1012c04fbb5a8eb",
    arguments: 'new Function("input", "args", "$plugin", "tools", "tool", "trace", "log", "tabId"',
    reason: "Exact packaged inner-runner in a manifest-declared opaque-origin sandbox Worker. No extension APIs; existing user/Agent script capability.",
  }],
  ["dom/skins/sandbox.js", {
    page: "dom/skins/sandbox.html", script: "sandbox.js",
    tokens: "6d265c9bb1b31235a725c9418b0b9d9a0266c4c9f014650abd4cdfa66a73fbe9",
    arguments: 'new Function("THREE", "assets", "model", "vrm", "characters",',
    csp: "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; connect-src data: blob:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'",
    reason: "Exact packaged skin scene editor in a manifest-declared opaque-origin sandbox. User/Agent scene source uses local Three.js and embedded models; no extension APIs, parent DOM, network, frames or Workers.",
  }],
]);
const REQUIRED_CLEAN = /^(?:code\/(?:obfuscated-code|minified-without-source)|privacy\/(?:remote-code-execution|remote-script-tag)|csp\/)/u;
const identity = finding => JSON.stringify([finding.ruleId, finding.file, finding.line, finding.message]);

/** Storecheck 0.1.0 has no ignore config. Its public Rule API permits this exact report adapter. */
export function reviewedSandboxFinding(source, finding) {
  const reviewed = REVIEWED_SANDBOXES.get(finding.file);
  if (!reviewed || finding.message !==
      "new Function( - new Function() compiles a string into executable code. Manifest V3 requires that the full functionality of an extension be discernible from the submitted code, so remotely sourced logic is not allowed.") return false;
  const manifest = source.manifest;
  const pages = JSON.stringify(manifest?.sandbox?.pages);
  if (!['["runner-sandbox.html"]', '["runner-sandbox.html","dom/skins/sandbox.html"]'].includes(pages) ||
      !manifest.sandbox.pages.includes(reviewed.page) ||
      manifest?.content_security_policy?.extension_pages !== "script-src 'self'; object-src 'self';" ||
      manifest?.content_security_policy?.sandbox !== "sandbox allow-scripts; script-src 'self' 'unsafe-eval' blob:; worker-src blob:; child-src blob:;") return false;
  const runtime = source.file(finding.file)?.text();
  const html = source.file(reviewed.page)?.text();
  if (!runtime || !html || !html.includes(`<script src="${reviewed.script}"></script>`) ||
      (reviewed.csp && !html.includes(`<meta http-equiv="Content-Security-Policy" content="${reviewed.csp}">`)) ||
      // The pinned rule reports lines after stripping comments; token hashing still uses every executable token.
      !stripComments(runtime).split("\n")[finding.line - 1]?.includes(reviewed.arguments)) return false;
  const digest = createHash("sha256").update(JSON.stringify([...tokenizer(runtime, { ecmaVersion: "latest" })].map(token => [token.type.label, token.value]))).digest("hex");
  return digest === reviewed.tokens;
}

export async function checkStore(path) {
  const cli = fileURLToPath(new URL("cli.js", import.meta.resolve("storecheck")));
  const installed = JSON.parse(await readFile(resolve(dirname(cli), "../../package.json"), "utf8"));
  if (installed.version !== STORECHECK_VERSION) throw new Error("storecheck version changed; review rules and the scoped exception");
  // Always run the unmodified CLI against the final directory/ZIP. Preserve its real exit status.
  const raw = spawnSync(process.execPath, [cli, resolve(path), "--severity=error", "--json"], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
  });
  if (raw.error || ![0, 1].includes(raw.status)) throw new Error(`storecheck failed to execute: ${raw.error?.message || raw.stderr}`);
  const cliReport = JSON.parse(raw.stdout);
  if (cliReport.ruleErrors.length) throw new Error(`storecheck rule failures: ${JSON.stringify(cliReport.ruleErrors)}`);
  const source = loadExtension(resolve(path));
  const rules = await loadRules();
  if (rules.length !== 24) throw new Error(`storecheck registry changed: expected 24 rules, got ${rules.length}`);
  const exceptions = [];
  const adapted = rules.map(loaded => loaded.meta.id !== "privacy/remote-code-execution" ? loaded : {
    ...loaded,
    rule: { ...loaded.rule, check(context) {
      return loaded.rule.check({ ...context, report(finding) {
        if (reviewedSandboxFinding(source, finding)) {
          exceptions.push({ ...finding, ruleId: loaded.meta.id, severity: loaded.meta.severity,
            category: loaded.meta.category, title: loaded.meta.title, policyRef: loaded.meta.policyRef,
            rejectionCodes: loaded.meta.rejectionCodes,
            reason: `${REVIEWED_SANDBOXES.get(finding.file).reason} See docs/store-code-audit.md; this is not a CWS approval.` });
        } else context.report(finding);
      } });
    } },
  });
  const result = await runRules(source, { rules: adapted });
  const effective = JSON.parse(formatJson(result, rules.length));
  const accepted = new Set(exceptions.map(identity));
  const cliUnresolved = cliReport.findings.filter(finding => !accepted.has(identity(finding)));
  const blocking = effective.findings.filter(finding => finding.severity === "error" || REQUIRED_CLEAN.test(finding.ruleId));
  const ok = exceptions.length <= REVIEWED_SANDBOXES.size && new Set(exceptions.map(finding => finding.file)).size === exceptions.length &&
    !cliUnresolved.length && !blocking.length && !effective.ruleErrors.length;
  return { version: 1, storecheck: STORECHECK_VERSION, ok, rawCliExitCode: raw.status, rawCli: cliReport,
    rawFindings: [...effective.findings, ...exceptions.map(({ reason, ...finding }) => finding)],
    exceptions, effective, blocking };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [path, output] = process.argv.slice(2);
  if (!path) throw new Error("usage: node scripts/check-store.mjs <extension-directory-or-zip> [report.json]");
  const report = await checkStore(path);
  if (output) {
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
