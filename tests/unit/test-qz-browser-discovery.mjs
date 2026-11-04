import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, win32 } from "node:path";
import test from "node:test";
import { openConnectionBrowser } from "../../services/mcp-bridge/src/open-browser.mjs";

const url = "http://127.0.0.1:18765/qz-connect?name=work";

test("installed browser launchers run in Chrome, Firefox, Edge order and never repeat an excluded family", {
  skip: process.platform === "win32" ? "Executable POSIX fixture" : false,
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), "qz-browser-launch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = join(directory, "first"), second = join(directory, "second"), log = join(directory, "launches.jsonl");
  await Promise.all([mkdir(first), mkdir(second)]);
  for (const [folder, command, browser] of [[second, "google-chrome", "Chrome"], [first, "firefox", "Firefox"], [first, "microsoft-edge", "Edge"]]) {
    await writeFile(join(folder, command), `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, JSON.stringify({browser:${JSON.stringify(browser)},args:process.argv.slice(2)})+'\\n');\n`, { mode: 0o700 });
  }
  const launches = [], children = [];
  let unrefs = 0;
  const dependencies = { platform: "linux", env: { PATH: [first, second].join(delimiter) }, spawnProcess(command, args, options) {
    launches.push({ command, args, options });
    const child = spawn(command, args, options);
    // Keep fixture children referenced until their recorded output has been inspected.
    child.unref = () => { unrefs++; return child; };
    children.push(new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Fixture launcher exited ${code}`)));
    }));
    return child;
  } };
  const excluded = [];
  for (const browser of ["Chrome", "Firefox", "Edge"]) {
    assert.deepEqual(await openConnectionBrowser(url, { ...dependencies, exclude: [...excluded] }), { url, opened: true, browser });
    excluded.push(browser);
  }
  await assert.rejects(openConnectionBrowser(url, { ...dependencies, exclude: excluded }), error => error.code === "BROWSER_NOT_FOUND");
  await Promise.all(children);
  assert.deepEqual(launches.map(launch => launch.command), [join(second, "google-chrome"), join(first, "firefox"), join(first, "microsoft-edge")]);
  assert.ok(launches.every(launch => launch.args.length === 1 && launch.args[0] === url && launch.options.detached && launch.options.stdio === "ignore"));
  assert.equal(unrefs, 3);
  const rows = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.browser).sort(), ["Chrome", "Edge", "Firefox"]);
  assert.ok(rows.every(row => row.args.length === 1 && row.args[0] === url));
});

test("standard macOS and Windows installation paths preserve browser priority without shell commands", async () => {
  for (const [platform, env, expected] of [
    ["darwin", {}, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["win32", { ProgramFiles: "C:\\Programs" }, win32.join("C:\\Programs", "Google", "Chrome", "Application", "chrome.exe")],
  ]) {
    const calls = [];
    const result = await openConnectionBrowser(url, { platform, env, canExecute: async file => file === expected,
      spawnProcess(command, args, options) {
        calls.push({ command, args, options });
        const child = new EventEmitter(); child.unref = () => {};
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    });
    assert.equal(result.browser, "Chrome");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, expected);
    assert.deepEqual(calls[0].args, [url]);
    assert.equal(calls[0].options.shell, undefined);
  }
});

test("cancellation during an executable access check prevents every spawn", async () => {
  const controller = new AbortController(), reason = new Error("Caller cancelled during discovery");
  let checks = 0, spawns = 0;
  await assert.rejects(openConnectionBrowser(url, {
    platform: "linux", env: { PATH: "/fixture" }, signal: controller.signal,
    canExecute: async () => { checks++; controller.abort(reason); return true; },
    spawnProcess() { spawns++; assert.fail("a cancelled command cannot launch a browser"); },
  }), error => error === reason);
  assert.equal(checks, 1);
  assert.equal(spawns, 0);
});
