import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MISSING_IMAGEMAGICK_REASON } from "../support/imagemagick.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skipReason = new RegExp(MISSING_IMAGEMAGICK_REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

function pathWithoutMagick() {
  const directory = mkdtempSync(join(tmpdir(), "qz-no-magick-"));
  symlinkSync("/usr/bin/git", join(directory, "git"));
  return directory;
}

function run(args, path) {
  const env = { ...process.env, PATH: path };
  // Nested node --test must not inherit the parent runner's channel.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_CHANNEL_FD;
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
}

test("comparator argument errors are unchanged when magick is not consulted", () => {
  const css = spawnSync(process.execPath, ["tests/design-system/compare-css.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(css.status, 0);
  assert.match(`${css.stderr}\n${css.stdout}`, /Missing --reference-dir/);
  assert.doesNotMatch(`${css.stdout}\n${css.stderr}`, skipReason);

  const loading = spawnSync(process.execPath, ["tests/benchmarks/capability-loading/compare.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(loading.status, 0);
  assert.match(`${loading.stderr}\n${loading.stdout}`, /Missing --reference/);
  assert.doesNotMatch(`${loading.stdout}\n${loading.stderr}`, skipReason);
});

test("pixel-comparison commands skip when the magick command is absent", t => {
  const path = pathWithoutMagick();
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const output = join(path, "output");
  const commands = [
    ["tests/design-system/compare-css.mjs", "--reference-dir", path, "--candidate-dir", path, "--fixture-dir", path, "--output", output],
    ["tests/benchmarks/conversation-render/compare-revisions.mjs", "--prepare", output],
    ["tests/benchmarks/conversation-render/compare-revisions.mjs", "--run", output],
    ["tests/benchmarks/capability-loading/compare.mjs", "--reference", path, "--candidate", path, "--fixture", path, "--output", output],
    ["tests/tool-timeline/compare-revisions.mjs", "--baseline", "HEAD", "--output", output],
  ];
  for (const args of commands) {
    const result = run(args, path);
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stderr || result.stdout}`);
    assert.match(result.stdout, skipReason, args[0]);
    assert.equal(result.stdout.trim().split("\n").length, 1, result.stdout);
    assert.equal(existsSync(output), false, `${args[0]} created output after skipping`);
  }
});

test("comparison commands that do not invoke magick keep their existing errors", t => {
  const path = pathWithoutMagick();
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const captures = run([
    "tests/benchmarks/conversation-render/compare-revisions.mjs",
    "--captures",
    join(path, "missing-plan"),
    join(path, "captures"),
    join(path, "metadata.json"),
  ], path);
  assert.notEqual(captures.status, 0);
  assert.doesNotMatch(`${captures.stdout}\n${captures.stderr}`, skipReason);

  const usage = run(["tests/benchmarks/conversation-render/compare-revisions.mjs", "--unknown"], path);
  assert.notEqual(usage.status, 0);
  assert.match(`${usage.stderr}\n${usage.stdout}`, /Usage:/);
  assert.doesNotMatch(`${usage.stdout}\n${usage.stderr}`, skipReason);

  const benchmark = readFileSync(join(root, "tests/benchmarks/conversation-render/run.mjs"), "utf8");
  const helpAt = benchmark.indexOf("if (args.help)");
  const skipAt = benchmark.indexOf("args.compareBaseline === true && !findImageMagickExecutable()");
  assert.ok(helpAt !== -1 && skipAt > helpAt, "baseline comparison skip must stay behind --help and the other benchmark modes");
  assert.equal(benchmark.includes("conversation render baseline comparison skipped"), true);
});

test("the design-system pixel test skips when magick is absent and its neighbors still run", t => {
  const path = pathWithoutMagick();
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const result = run([
    "--require=./tests/support/unit-bootstrap.cjs",
    "--test",
    "--test-reporter=spec",
    "--test-concurrency=1",
    "tests/unit/test-design-system-comparison.mjs",
  ], path);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, /ImageMagick \(magick\) is not installed; pixel comparison skipped/);
  assert.match(output, /pass 2/);
  assert.match(output, /skipped 1/);
  assert.match(output, /fail 0/);
});
