import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { driveGuide } from "../../services/mcp-bridge/src/drive-guide.mjs";
import { buildScriptRequest, presentScriptResult } from "../../services/mcp-bridge/src/script-call.mjs";

const CHARS_PER_TOKEN = 23156 / 5700;

test("the packed drive guide is the qz-drive skill, in one language, inside 3k–5k tokens", () => {
  const source = readFileSync(new URL("../../skills/qz-drive/SKILL.md", import.meta.url), "utf8");
  const mirror = readFileSync(new URL("../../services/mcp-bridge/src/qz-drive-SKILL.md", import.meta.url), "utf8");
  assert.equal(mirror, source);
  const zh = driveGuide({ explicit: "zh-CN", env: {} });
  const en = driveGuide({ explicit: "en", env: {} });
  assert.match(zh, /不要配置轻舟模型/);
  assert.match(en, /不要配置轻舟模型/);
  assert.match(zh, /把操作、等待和取数写进一个脚本，只 return 需要的字段/);
  assert.match(en, /Put the actions, the waits, and the reads in one script\. Return only the fields you need\./);
  assert.doesNotMatch(zh, /page\.click|selectOption/);
  assert.doesNotMatch(en, /page\.click|selectOption/);
  for (const text of [zh, en]) {
    const tokens = text.length / CHARS_PER_TOKEN;
    assert.ok(tokens >= 3000 && tokens <= 5000, `${text.length} chars is ${tokens} tokens`);
  }
});

test("qz script wraps an inner run_script and prints only the returned value", () => {
  assert.deepEqual(buildScriptRequest({ code: "return 1", sessionId: " s " }), {
    name: "run_script",
    args: { target: "inner", timeout: 120, code: "return 1" },
    sessionId: "s",
  });
  const ok = presentScriptResult({
    sessionId: "s",
    result: { ok: true, result: { title: "Ada" }, trace: [{ name: "open" }] },
  });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.text, "{\"title\":\"Ada\"}\n");
  assert.equal(ok.stderr, "sessionId s\n");
  const traces = [1, 2, 3, 4, 5, 6].map(step => ({ step }));
  const bad = presentScriptResult({
    result: { ok: false, code: "DRIVE_TOOL_FORBIDDEN", error: "blocked", trace: traces },
  });
  assert.equal(bad.exitCode, 1);
  assert.deepEqual(JSON.parse(bad.text), {
    code: "DRIVE_TOOL_FORBIDDEN",
    error: "blocked",
    trace: traces.slice(-5),
  });
});
