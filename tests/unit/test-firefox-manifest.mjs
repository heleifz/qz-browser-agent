import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FILE_ACCESS_MESSAGE_KEY,
  FIREFOX_ADDED_PERMISSIONS,
  FIREFOX_BACKGROUND_SCRIPT,
  FIREFOX_DATA_COLLECTION,
  FIREFOX_DROPPED_PERMISSIONS,
  FIREFOX_GECKO_ID,
  FIREFOX_MIN_VERSION,
  firefoxFileAccessMessageId,
  firefoxManifest,
  firefoxSidebarCss,
  firefoxUserText,
  isFirefoxOnlySource,
  rewriteFirefoxMessages,
  rewriteFirefoxSidepanelHtml,
} from "../../scripts/firefox-manifest.mjs";
import { chromeMessageId, HISTORICAL_LABELS_MESSAGE_ID } from "../../src/shared/i18n/definition.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const source = JSON.parse(readFileSync(join(repoRoot, "src/manifest.json"), "utf8"));

test("the firefox manifest drops rejected permissions and keeps the shared entries", () => {
  const snapshot = structuredClone(source);
  const firefox = firefoxManifest(source);
  assert.deepEqual(source, snapshot, "the Chrome manifest source is left unchanged");
  assert.equal(firefox.manifest_version, 3);
  assert.equal(firefox.key, undefined);
  assert.equal(firefox.side_panel, undefined);
  assert.equal(firefox.background.service_worker, source.background.service_worker);
  assert.deepEqual(firefox.background.scripts, [FIREFOX_BACKGROUND_SCRIPT]);
  assert.equal(firefox.background.type, "module");
  assert.equal(firefox.sidebar_action.default_panel, source.side_panel.default_path);
  assert.equal(firefox.sidebar_action.default_title, source.action.default_title);
  assert.equal(firefox.sidebar_action.open_at_install, false);
  assert.deepEqual(firefox.sidebar_action.default_icon, source.action.default_icon);
  assert.equal(firefox.browser_specific_settings.gecko.id, FIREFOX_GECKO_ID);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, FIREFOX_MIN_VERSION);
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions.required, [...FIREFOX_DATA_COLLECTION.required]);
  assert.deepEqual(firefox.browser_specific_settings.gecko.data_collection_permissions.optional, [...FIREFOX_DATA_COLLECTION.optional]);
  assert.equal(firefox.browser_specific_settings.gecko.data_collection_permissions.required.includes("none"), false);
  for (const permission of FIREFOX_DROPPED_PERMISSIONS) {
    assert.equal(firefox.permissions.includes(permission), false, permission);
    assert.equal(firefox.optional_permissions.includes(permission), false, permission);
  }
  for (const permission of [
    "activeTab", "alarms", "tabs", "tabGroups", "scripting", "storage", "downloads",
    "geolocation", "clipboardWrite", "notifications", "declarativeNetRequest", "unlimitedStorage",
    ...FIREFOX_ADDED_PERMISSIONS,
  ]) {
    assert.equal(firefox.permissions.includes(permission), true, permission);
  }
  for (const permission of ["history", "bookmarks", "downloads.open"]) {
    assert.equal(firefox.optional_permissions.includes(permission), true, permission);
  }
  assert.deepEqual(firefox.content_scripts, source.content_scripts);
  assert.deepEqual(firefox.sandbox, source.sandbox);
  assert.equal(firefox.content_security_policy.extension_pages, source.content_security_policy.extension_pages);
  assert.equal(firefox.content_security_policy.sandbox, source.content_security_policy.sandbox);
  const commands = structuredClone(source.commands);
  const suggested = commands._execute_action.suggested_key;
  delete commands._execute_action;
  commands._execute_sidebar_action = { description: source.action.default_title, suggested_key: suggested };
  assert.deepEqual(firefox.commands, commands);
  assert.equal(firefox.action.default_area, "navbar");
  assert.equal(source.action.default_area, undefined);
  assert.equal(firefox.update_url, undefined);
  assert.equal(firefox.permissions.includes("menus"), false);
  assert.deepEqual(firefox.host_permissions, source.host_permissions);
});

test("the firefox manifest refuses a background that is not the shared module worker", () => {
  assert.throws(() => firefoxManifest({ manifest_version: 3, background: { scripts: ["background.js"] } }), /module service worker/);
  assert.throws(() => firefoxManifest({
    manifest_version: 3,
    background: { service_worker: "background/service-worker.js", type: "module" },
  }), /side_panel/);
});

test("firefox-only sources stay out of the chrome compilation", () => {
  assert.equal(isFirefoxOnlySource("background/firefox-boot.ts"), true);
  assert.equal(isFirefoxOnlySource("background/firefox/host.ts"), true);
  assert.equal(isFirefoxOnlySource("sidepanel/firefox/host.ts"), true);
  assert.equal(isFirefoxOnlySource("background/service-worker.ts"), false);
  assert.equal(isFirefoxOnlySource("sidepanel/sidepanel.ts"), false);
});

test("firefox copy and the sidebar boot stay out of the chrome files", () => {
  assert.equal(firefoxFileAccessMessageId(), chromeMessageId(FILE_ACCESS_MESSAGE_KEY));
  const id = firefoxFileAccessMessageId();
  const rewritten = rewriteFirefoxMessages("en", { [id]: { message: "Open qz Details in chrome://extensions, enable Allow access to file URLs, then retry." }, other: { message: "keep" } });
  assert.match(rewritten[id].message, /about:addons/);
  assert.equal(rewritten[id].message.includes("chrome://extensions"), false);
  assert.equal(rewritten.other.message, "keep");
  const inserted = rewriteFirefoxMessages("zh_CN", { qz_language: { message: "zh-CN" } });
  assert.match(inserted[id].message, /about:addons/);
  assert.equal(rewriteFirefoxMessages("en", { other: { message: "keep" } }).other.message, "keep");
  assert.equal(Object.hasOwn(rewriteFirefoxMessages("en", { other: { message: "keep" } }), id), false);
  const moduleScript = rewriteFirefoxSidepanelHtml('<head>\n</head>\n<script type="module" src="sidepanel.js"></script>');
  assert.match(moduleScript, /src="firefox-boot\.js"/);
  assert.ok(moduleScript.indexOf('href="firefox-sidebar.css"') < moduleScript.indexOf("</head>"));
  assert.match(rewriteFirefoxSidepanelHtml('<script src="sidepanel.js" type="module"></script>'), /src="firefox-boot\.js"/);
  assert.match(rewriteFirefoxSidepanelHtml('<script src="../shared/mathjax-config.js"></script>'), /mathjax-config\.js/);
  assert.match(firefoxSidebarCss(), /color-scheme: light dark/);
  assert.match(firefoxSidebarCss(), /font: message-box/);
  assert.match(firefoxSidebarCss(), /background: Canvas/);
  assert.equal(
    firefoxUserText("ChromeOS uses Chrome, chrome://extensions/shortcuts, chrome://downloads, the side panel, and the Chrome Web Store."),
    "ChromeOS uses Firefox, about:addons, about:downloads, the sidebar, and the Add-ons Manager.",
  );
  assert.equal(firefoxUserText("chrome-extension://abc and Android Chrome and Chrome DevTools MCP"), "moz-extension://abc and an Android layout and a browser snapshot");
  const catalogs = rewriteFirefoxMessages("en", {
    qz_language: { message: "en" },
    [HISTORICAL_LABELS_MESSAGE_ID]: { message: "Chrome" },
    qz_example: { message: "Use Chrome and chrome://downloads" },
  });
  assert.equal(catalogs[HISTORICAL_LABELS_MESSAGE_ID].message, "Chrome");
  assert.equal(catalogs.qz_language.message, "en");
  assert.equal(catalogs.qz_example.message, "Use Firefox and about:downloads");
});
