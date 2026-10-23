import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIREFOX_DROPPED_PERMISSIONS,
  FIREFOX_GECKO_ID,
  FIREFOX_MIN_VERSION,
  firefoxManifest,
} from "../../scripts/firefox-manifest.mjs";

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
  assert.deepEqual(firefox.background.scripts, [source.background.service_worker]);
  assert.equal(firefox.background.type, "module");
  assert.equal(firefox.sidebar_action.default_panel, source.side_panel.default_path);
  assert.equal(firefox.sidebar_action.default_title, source.action.default_title);
  assert.equal(firefox.sidebar_action.open_at_install, false);
  assert.deepEqual(firefox.sidebar_action.default_icon, source.action.default_icon);
  assert.equal(firefox.browser_specific_settings.gecko.id, FIREFOX_GECKO_ID);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, FIREFOX_MIN_VERSION);
  assert.equal(firefox.browser_specific_settings.gecko.data_collection_permissions, undefined);
  for (const permission of FIREFOX_DROPPED_PERMISSIONS) {
    assert.equal(firefox.permissions.includes(permission), false, permission);
    assert.equal(firefox.optional_permissions.includes(permission), false, permission);
  }
  for (const permission of [
    "activeTab", "alarms", "tabs", "tabGroups", "scripting", "storage", "downloads",
    "geolocation", "clipboardWrite", "notifications", "declarativeNetRequest", "unlimitedStorage",
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
  assert.deepEqual(firefox.commands, source.commands);
  assert.deepEqual(firefox.host_permissions, source.host_permissions);
});

test("the firefox manifest refuses a background that is not the shared module worker", () => {
  assert.throws(() => firefoxManifest({ manifest_version: 3, background: { scripts: ["background.js"] } }), /module service worker/);
  assert.throws(() => firefoxManifest({
    manifest_version: 3,
    background: { service_worker: "background/service-worker.js", type: "module" },
  }), /side_panel/);
});
