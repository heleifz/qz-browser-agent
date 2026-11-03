import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join, win32 } from "node:path";
import { QzError } from "./client.mjs";

/** Open the next installed supported browser, preserving its normal profile and consent flow. */
export async function openConnectionBrowser(url, {
  platform = process.platform, env = process.env, home = homedir(), spawnProcess = spawn, signal, exclude = [],
  canExecute = file => access(file, platform === "win32" ? constants.F_OK : constants.X_OK).then(() => true, () => false),
} = {}) {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) throw new QzError("BROWSER_OPEN_FAILED", "Only web URLs can be opened.", { url });
  const path = platform === "win32" ? win32 : { join };
  const search = String(env.PATH || "").split(platform === "win32" ? ";" : delimiter).filter(Boolean);
  const windowsRoots = [env.PROGRAMFILES || env.ProgramFiles, env["PROGRAMFILES(X86)"] || env["ProgramFiles(x86)"], env.LOCALAPPDATA || env.LocalAppData].filter(Boolean);
  const browsers = [
    { name: "Chrome", commands: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"], app: "Google Chrome", binary: "Google Chrome", windows: ["Google", "Chrome", "Application", "chrome.exe"] },
    { name: "Firefox", commands: ["firefox"], app: "Firefox", binary: "firefox", windows: ["Mozilla Firefox", "firefox.exe"] },
    { name: "Edge", commands: ["microsoft-edge", "microsoft-edge-stable", "msedge"], app: "Microsoft Edge", binary: "Microsoft Edge", windows: ["Microsoft", "Edge", "Application", "msedge.exe"] },
  ];
  for (const browser of browsers) {
    if (exclude.includes(browser.name)) continue;
    const candidates = platform === "darwin"
      ? ["/Applications", join(home, "Applications")].map(root => join(root, `${browser.app}.app`, "Contents", "MacOS", browser.binary))
      : platform === "win32"
        ? [...windowsRoots.map(root => path.join(root, ...browser.windows)), ...search.map(root => path.join(root, browser.windows.at(-1)))]
        : search.flatMap(root => browser.commands.map(command => join(root, command)));
    for (const executable of [...new Set(candidates)]) {
      signal?.throwIfAborted();
      if (!await canExecute(executable)) continue;
      signal?.throwIfAborted();
      try {
        await new Promise((resolveSpawn, reject) => {
          const child = spawnProcess(executable, [url], { detached: true, stdio: "ignore", windowsHide: true });
          child.once("error", reject);
          child.once("spawn", () => { child.unref(); resolveSpawn(); });
        });
        return { url, opened: true, browser: browser.name };
      } catch { signal?.throwIfAborted(); }
    }
  }
  throw new QzError("BROWSER_NOT_FOUND", "Chrome, Firefox and Edge were not found.", {
    url, hint: "Run qz connect uri and open its URL in the browser profile with qz installed.",
  });
}

export async function openBrowser(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) throw new QzError("BROWSER_OPEN_FAILED", "Only web URLs can be opened.", { url });
  const [command, args] = platform === "darwin" ? ["open", [url]]
    : platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  await new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new QzError("BROWSER_OPEN_FAILED", "The browser did not open. Open the URL in Chrome with qz installed.", { url }));
    }, 10000);
    const finish = error => { clearTimeout(timer); error ? reject(error) : resolve(); };
    child.once("error", () => finish(new QzError("BROWSER_OPEN_FAILED", "Could not open a browser. Open the URL in Chrome with qz installed.", { url })));
    child.once("exit", code => finish(code === 0 ? null : new QzError("BROWSER_OPEN_FAILED", "Could not open a browser. Open the URL in Chrome with qz installed.", { url })));
  });
  return { url, opened: true };
}
