import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIREFOX_THEME_COLOR_PROPERTIES,
  applyFirefoxTheme,
  firefoxThemeColor,
  installFirefoxTheme,
} from "../../src/sidepanel/firefox/theme.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function styleRoot() {
  const props = new Map();
  return {
    style: {
      setProperty(name, value) { props.set(name, value); },
      removeProperty(name) { props.delete(name); },
    },
    get(name) { return props.get(name); },
  };
}

test("firefox theme colors accept hex, functions, names, and rgb arrays", () => {
  assert.equal(firefoxThemeColor("  #00ddff "), "#00ddff");
  assert.equal(firefoxThemeColor("#abc"), "#abc");
  assert.equal(firefoxThemeColor("rgb(1, 2, 3)"), "rgb(1, 2, 3)");
  assert.equal(firefoxThemeColor("hsl(200 80% 40%)"), "hsl(200 80% 40%)");
  assert.equal(firefoxThemeColor("rebeccapurple"), "rebeccapurple");
  assert.equal(firefoxThemeColor([10, 20, 30]), "rgb(10, 20, 30)");
  assert.equal(firefoxThemeColor([10, 20, 30, 0.5]), "rgba(10, 20, 30, 0.5)");
  assert.equal(firefoxThemeColor("red;background:url(https://evil)"), undefined);
  assert.equal(firefoxThemeColor("url(#fff)"), undefined);
  assert.equal(firefoxThemeColor("#12"), undefined);
  assert.equal(firefoxThemeColor([1, 2]), undefined);
  assert.equal(firefoxThemeColor([1, 2, 3, 2]), undefined);
  assert.equal(firefoxThemeColor([1.5, 2, 3]), undefined);
});

test("an empty firefox theme removes color overrides", () => {
  const root = styleRoot();
  applyFirefoxTheme(root, {
    colors: { toolbar: "#112233", toolbar_text: "#fbfbfe", accentcolor: "#00ddff" },
  });
  assert.equal(root.get("--qz-ff-toolbar"), "#112233");
  assert.equal(root.get("--qz-ff-button"), "#112233");
  assert.equal(root.get("--qz-ff-accent-text"), "#15141a");
  for (const theme of [undefined, null, {}, { colors: null }, { colors: {} }, { images: {} }]) {
    assert.equal(applyFirefoxTheme(root, theme), false);
    for (const [, property] of FIREFOX_THEME_COLOR_PROPERTIES) assert.equal(root.get(property), undefined);
    assert.equal(root.get("--qz-ff-button"), undefined);
    assert.equal(root.get("--qz-ff-button-text"), undefined);
    assert.equal(root.get("--qz-ff-accent-text"), undefined);
  }
});

test("a theme palette maps the nine color keys and chooses accent ink", () => {
  const root = styleRoot();
  const colors = {
    frame: "#3b2f63",
    toolbar: [42, 33, 72],
    toolbar_text: "#fbfbfe",
    toolbar_field: "#423a66",
    toolbar_field_text: "white",
    popup: "#f6f3ff",
    popup_text: "#1c1b22",
    popup_border: "#c6bddc",
    accentcolor: "#0061e0",
    sidebar: "#000000",
  };
  assert.equal(applyFirefoxTheme(root, { colors }), true);
  assert.equal(root.get("--qz-ff-frame"), "#3b2f63");
  assert.equal(root.get("--qz-ff-toolbar"), "rgb(42, 33, 72)");
  assert.equal(root.get("--qz-ff-toolbar-text"), "#fbfbfe");
  assert.equal(root.get("--qz-ff-toolbar-field"), "#423a66");
  assert.equal(root.get("--qz-ff-toolbar-field-text"), "white");
  assert.equal(root.get("--qz-ff-popup"), "#f6f3ff");
  assert.equal(root.get("--qz-ff-popup-text"), "#1c1b22");
  assert.equal(root.get("--qz-ff-popup-border"), "#c6bddc");
  assert.equal(root.get("--qz-ff-accent"), "#0061e0");
  assert.equal(root.get("--qz-ff-button"), "rgb(42, 33, 72)");
  assert.equal(root.get("--qz-ff-button-text"), "#fbfbfe");
  assert.equal(root.get("--qz-ff-accent-text"), "#fbfbfe");
  assert.equal(root.get("--qz-ff-sidebar"), undefined);
  applyFirefoxTheme(root, { theme: { colors: { accentcolor: "#00ddff" } } });
  assert.equal(root.get("--qz-ff-accent"), "#00ddff");
  assert.equal(root.get("--qz-ff-accent-text"), "#15141a");
  assert.equal(root.get("--qz-ff-frame"), undefined);
});

test("the sidebar follows its window theme and never writes a theme", async () => {
  const root = styleRoot();
  const calls = [];
  let listener;
  let resolveWindow;
  let resolveTheme;
  let writes = 0;
  const api = {
    windows: { getCurrent: () => new Promise(resolve => { resolveWindow = resolve; }) },
    theme: {
      getCurrent(windowId) {
        calls.push(windowId);
        return new Promise(resolve => { resolveTheme = resolve; });
      },
      onUpdated: { addListener(fn) { listener = fn; } },
      update() { writes += 1; },
      reset() { writes += 1; },
    },
  };
  installFirefoxTheme(api, root);
  assert.equal(typeof listener, "function");
  listener({ theme: { colors: { frame: "#abcdef" } }, windowId: 7 });
  assert.equal(root.get("--qz-ff-frame"), undefined);
  resolveWindow({ id: 7 });
  await Promise.resolve();
  assert.deepEqual(calls, [7]);
  listener({ theme: { colors: { frame: [10, 20, 30] } }, windowId: 7 });
  assert.equal(root.get("--qz-ff-frame"), "rgb(10, 20, 30)");
  resolveTheme({ colors: { toolbar: "#123456", toolbar_text: "#ffffff", accentcolor: [0, 97, 224] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.get("--qz-ff-frame"), "rgb(10, 20, 30)");
  assert.equal(root.get("--qz-ff-toolbar"), undefined);
  listener({ theme: { colors: { frame: "#aabbcc" } }, windowId: 3 });
  assert.equal(root.get("--qz-ff-frame"), "rgb(10, 20, 30)");
  listener({ theme: { colors: { popup: "#eeeeee", toolbar: "#123456", toolbar_text: "#ffffff" } } });
  assert.equal(root.get("--qz-ff-popup"), "#eeeeee");
  assert.equal(root.get("--qz-ff-toolbar"), "#123456");
  assert.equal(root.get("--qz-ff-button-text"), "#ffffff");
  listener({ theme: {} });
  assert.equal(root.get("--qz-ff-popup"), undefined);
  assert.equal(root.get("--qz-ff-toolbar"), undefined);
  assert.equal(writes, 0);
});

test("the initial theme read paints the sidebar window", async () => {
  const root = styleRoot();
  const calls = [];
  installFirefoxTheme({
    windows: { async getCurrent() { return { id: 4 }; } },
    theme: {
      getCurrent(windowId) {
        calls.push(windowId);
        return { colors: { toolbar: "#123456", toolbar_text: "#ffffff", accentcolor: [0, 97, 224] } };
      },
      onUpdated: { addListener() {} },
    },
  }, root);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [4]);
  assert.equal(root.get("--qz-ff-toolbar"), "#123456");
  assert.equal(root.get("--qz-ff-button"), "#123456");
  assert.equal(root.get("--qz-ff-button-text"), "#ffffff");
  assert.equal(root.get("--qz-ff-accent"), "rgb(0, 97, 224)");
  assert.equal(root.get("--qz-ff-accent-text"), "#fbfbfe");
});

test("a missing theme api and a failed read leave the system-color base", async () => {
  const root = styleRoot();
  installFirefoxTheme({}, root);
  installFirefoxTheme({ theme: { getCurrent() { return {}; } } }, root);
  const calls = [];
  installFirefoxTheme({
    windows: { getCurrent() { return Promise.reject(new Error("no window")); } },
    theme: {
      getCurrent(windowId) {
        calls.push(windowId);
        return Promise.reject(new Error("no theme"));
      },
      onUpdated: { addListener() {} },
    },
  }, root);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [undefined]);
  assert.equal(root.get("--qz-ff-toolbar"), undefined);
});

test("the theme reader does not call theme.update", () => {
  const theme = readFileSync(join(repoRoot, "src/sidepanel/firefox/theme.ts"), "utf8");
  const host = readFileSync(join(repoRoot, "src/sidepanel/firefox/host.ts"), "utf8");
  assert.equal(theme.includes(".update("), false);
  assert.equal(theme.includes(".reset("), false);
  assert.match(host, /installFirefoxTheme\(chromeApi, document\.documentElement\)/);
  assert.equal(host.includes(".update("), false);
});
