import { readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firefox } from "playwright";
import { FIREFOX_GECKO_ID } from "../../scripts/firefox-manifest.mjs";
import { assertFirefoxPackage, resolveFirefoxExecutable } from "../support/browser-package.mjs";

export const FIREFOX_EXTENSION_UUID = "12345678-1234-5678-9abc-123456789abc";
const PACKAGE_LABEL = "dist/extension-firefox";

/** Launch stock Firefox and open the sidebar document from the Firefox package. */
export async function openFirefoxSidebar({ extensionDir = process.env.QINGZHOU_FIREFOX_EXTENSION_DIR } = {}) {
  if (!extensionDir) throw new Error("Set QINGZHOU_FIREFOX_EXTENSION_DIR to dist/extension-firefox. npm run verify:firefox builds it.");
  const manifest = assertFirefoxPackage(JSON.parse(await readFile(join(extensionDir, "manifest.json"), "utf8")), extensionDir);
  const browser = resolveFirefoxExecutable();
  const profile = mkdtempSync(join(tmpdir(), "qz-firefox-playwright-"));
  const context = await firefox.launchPersistentContext(profile, {
    channel: "moz-firefox",
    executablePath: browser.executablePath,
    headless: process.env.QINGZHOU_FIREFOX_HEADED !== "1",
    args: ["-remote-allow-system-access"],
    viewport: { width: 420, height: 860 },
    firefoxUserPrefs: {
      "browser.aboutwelcome.enabled": false,
      "datareporting.policy.dataSubmissionEnabled": false,
      "extensions.webextensions.uuids": JSON.stringify({ [FIREFOX_GECKO_ID]: FIREFOX_EXTENSION_UUID }),
    },
  });
  const pageErrors = [];
  const consoleErrors = [];
  try {
    const browserVersion = context.browser().version();
    if (!browserVersion.startsWith("Mozilla/") && !/^\d+\./.test(browserVersion)) {
      throw new Error(`Playwright attached to ${browserVersion}, not Firefox.`);
    }
    await installFirefoxExtension(context, extensionDir);
    const page = context.pages()[0] || await context.newPage();
    page.on("pageerror", error => pageErrors.push(String(error?.stack || error)));
    page.on("console", message => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    const sidebarUrl = `moz-extension://${FIREFOX_EXTENSION_UUID}/sidepanel/sidepanel.html`;
    await page.goto(sidebarUrl, { waitUntil: "commit", timeout: 20_000 });
    await page.waitForSelector("#app", { state: "attached", timeout: 20_000 });
    return {
      browserName: "firefox",
      packageLabel: PACKAGE_LABEL,
      packageDir: extensionDir,
      geckoId: manifest.browser_specific_settings.gecko.id,
      executablePath: browser.executablePath,
      browserVersion,
      context,
      page,
      pageErrors,
      consoleErrors,
      async close() { await context.close(); },
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function installFirefoxExtension(context, extensionDir) {
  const playwrightBrowser = context.browser();
  if (playwrightBrowser.browserType().name() !== "firefox") {
    throw new Error("Refusing to install dist/extension-firefox into a non-Firefox browser.");
  }
  const session = playwrightBrowser._connection?.toImpl?.(playwrightBrowser)?._browserSession;
  if (typeof session?.send !== "function") {
    throw new Error("Playwright did not expose the Firefox WebDriver BiDi session used to install dist/extension-firefox.");
  }
  const installed = await session.send("webExtension.install", {
    extensionData: { type: "path", path: extensionDir },
  });
  if (installed?.extension !== FIREFOX_GECKO_ID) {
    throw new Error(`Firefox installed ${installed?.extension || "nothing"}; expected ${FIREFOX_GECKO_ID}.`);
  }
}
