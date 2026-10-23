import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  FIREFOX_THEME_COLOR_PROPERTIES,
  FIREFOX_TEXT_TIERS,
  applyFirefoxPalette,
  applyFirefoxTheme,
  firefoxThemeColor,
  installFirefoxTheme,
  parseFirefoxThemeColor,
} from "../../src/sidepanel/firefox/theme.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const PALETTE_PROPERTIES = [
  "--qz-ff-primary", "--qz-ff-primary-hover", "--qz-ff-primary-active", "--qz-ff-primary-text", "--qz-ff-accent-ink",
  ...FIREFOX_TEXT_TIERS.map(([property]) => property),
];

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

/** Sidebar, popup, and field share one surface and text; the accent and its label are separate. */
function sourceColors(sidebar, text, accent, accentText = "rgb(255, 255, 255)") {
  return {
    "--qz-ff-accent": accent,
    "--qz-ff-accent-text": accentText,
    "--qz-ff-sidebar": sidebar,
    "--qz-ff-sidebar-text": text,
    "--qz-ff-popup": sidebar,
    "--qz-ff-popup-text": text,
    "--qz-ff-field": sidebar,
    "--qz-ff-field-text": text,
  };
}

/** A sidebar root whose probe resolves var(--name) from `colors`, the way Firefox computes the skin variables. */
function paletteRoot(colors) {
  const root = styleRoot();
  const listeners = { load: [], focus: [], change: [] };
  const view = {
    getComputedStyle(element) {
      if (element === root) return { color: "", getPropertyValue: name => (name === "--qz-ff-accent" && colors["--qz-ff-accent"] ? "AccentColor" : "") };
      const name = /^var\((--[\w-]+)\)$/.exec(element.style.color)?.[1];
      return { color: colors[name] ?? "", getPropertyValue: () => "" };
    },
    matchMedia: () => ({ addEventListener: (type, listener) => listeners.change.push(listener) }),
    addEventListener: (type, listener) => listeners[type].push(listener),
  };
  root.probes = 0;
  root.ownerDocument = {
    defaultView: view,
    createElement() { return { style: { cssText: "", color: "" }, remove() { root.probes -= 1; } }; },
  };
  root.appendChild = () => { root.probes += 1; };
  root.listeners = listeners;
  return root;
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

test("theme colors parse hex, rgb, and hsl into sRGB channels", () => {
  assert.deepEqual(parseFirefoxThemeColor("#0af"), [0, 170, 255, 1]);
  assert.deepEqual(parseFirefoxThemeColor("#0061e080"), [0, 97, 224, 128 / 255]);
  assert.deepEqual(parseFirefoxThemeColor("rgb(0, 122, 255)"), [0, 122, 255, 1]);
  assert.deepEqual(parseFirefoxThemeColor("rgba(0 122 255 / 50%)"), [0, 122, 255, 0.5]);
  assert.deepEqual(parseFirefoxThemeColor("rgb(100%, 0%, 50%)"), [255, 0, 128, 1]);
  assert.deepEqual(parseFirefoxThemeColor("hsl(0, 100%, 50%)"), [255, 0, 0, 1]);
  assert.deepEqual(parseFirefoxThemeColor("color(srgb 0.28 0.28 0.28)"), [71, 71, 71, 1]);
  assert.deepEqual(parseFirefoxThemeColor("color(srgb 0 0 0 / 0.14)"), [0, 0, 0, 0.14]);
  assert.equal(parseFirefoxThemeColor("color(display-p3 0 0 0)"), undefined);
  assert.equal(parseFirefoxThemeColor("rebeccapurple"), undefined);
  assert.equal(parseFirefoxThemeColor("rgb(1, 2)"), undefined);
  assert.equal(parseFirefoxThemeColor("hsl(10, 20, 30)"), undefined);
});

test("an empty firefox theme removes color overrides", () => {
  const root = styleRoot();
  applyFirefoxTheme(root, { colors: { sidebar: "#112233", sidebar_highlight: "#00ddff" } });
  assert.equal(root.get("--qz-ff-sidebar"), "rgb(17, 34, 51)");
  assert.equal(root.get("--qz-ff-accent-text"), "#15141a");
  assert.equal(root.get("color-scheme"), "dark");
  for (const theme of [undefined, null, {}, { colors: null }, { colors: {} }, { images: {} }]) {
    assert.equal(applyFirefoxTheme(root, theme), false);
    for (const [, property] of FIREFOX_THEME_COLOR_PROPERTIES) assert.equal(root.get(property), undefined);
    assert.equal(root.get("color-scheme"), undefined);
  }
});

test("a theme palette maps the sidebar, focus, field, and popup keys like Firefox's sidebar", () => {
  const root = styleRoot();
  const colors = {
    frame: "#3b2f63",
    toolbar: [42, 33, 72],
    sidebar: [42, 33, 72, 0.4],
    sidebar_text: "#fbfbfe",
    sidebar_border: "rgba(255, 255, 255, 0.2)",
    sidebar_highlight: "#b9a5ff",
    focus_outline: "#00ddff",
    toolbar_field: "#423a66",
    toolbar_field_text: "white",
    toolbar_field_border: "#5b5285",
    popup: "#f6f3ff",
    popup_border: "#c6bddc",
  };
  assert.equal(applyFirefoxTheme(root, { colors }), true);
  assert.equal(root.get("--qz-ff-sidebar"), "rgb(42, 33, 72)", "Firefox paints the sidebar opaque");
  assert.equal(root.get("--qz-ff-sidebar-text"), "rgb(251, 251, 254)");
  assert.equal(root.get("--qz-ff-sidebar-border"), "rgba(255, 255, 255, 0.2)");
  assert.equal(root.get("--qz-ff-accent"), "rgb(185, 165, 255)");
  assert.equal(root.get("--qz-ff-accent-text"), "#15141a");
  assert.equal(root.get("--qz-ff-focus"), "#00ddff");
  assert.equal(root.get("--qz-ff-field"), "#423a66");
  assert.equal(root.get("--qz-ff-field-text"), "white");
  assert.equal(root.get("--qz-ff-field-border"), "#5b5285");
  assert.equal(root.get("--qz-ff-popup"), "rgb(246, 243, 255)");
  assert.equal(root.get("--qz-ff-popup-text"), "#15141a");
  assert.equal(root.get("--qz-ff-popup-border"), "#c6bddc");
  assert.equal(root.get("--qz-ff-frame"), undefined);
  assert.equal(root.get("--qz-ff-toolbar"), undefined);
  assert.equal(root.get("color-scheme"), "dark");

  applyFirefoxTheme(root, { theme: { colors: { sidebar_highlight: "#0061e0", sidebar_text: "#15141a" } } });
  assert.equal(root.get("--qz-ff-accent"), "rgb(0, 97, 224)");
  assert.equal(root.get("--qz-ff-accent-text"), "#fbfbfe");
  assert.equal(root.get("--qz-ff-sidebar"), undefined);
  assert.equal(root.get("--qz-ff-focus"), undefined);
  assert.equal(root.get("color-scheme"), "light");

  applyFirefoxTheme(root, { colors: { sidebar: "#f9f9fb" } });
  assert.equal(root.get("color-scheme"), "light");
  applyFirefoxTheme(root, { colors: { sidebar_highlight: "#0061e0" } });
  assert.equal(root.get("color-scheme"), undefined);
});

test("the palette is written from the resolved colors and cleared when the accent is unknown", () => {
  const root = paletteRoot(sourceColors("rgb(255, 255, 255)", "rgb(0, 0, 0)", "rgb(0, 122, 255)"));
  assert.equal(applyFirefoxPalette(root), true);
  assert.equal(root.probes, 0, "the probe element is removed");
  assert.equal(root.get("--qz-ff-primary"), "rgb(0, 112, 235)");
  assert.equal(root.get("--qz-ff-primary-text"), "rgb(255, 255, 255)");
  assert.equal(root.get("--qz-ff-primary-hover"), "rgb(0, 99, 207)");
  assert.equal(root.get("--qz-ff-primary-active"), "rgb(0, 87, 183)");
  assert.equal(root.get("--qz-ff-accent-ink"), "rgb(0, 105, 219)");
  assert.equal(root.get("--qz-ff-text-deemphasized"), "rgb(71, 71, 71)", "system colors keep the stylesheet's 72% share");
  assert.equal(root.get("--qz-ff-text-muted"), "rgb(97, 97, 97)", "a share above 60% keeps the active fill readable");
  assert.equal(root.get("--qz-ff-field-text-deemphasized"), "rgb(71, 71, 71)");
  assert.equal(root.get("--qz-ff-field-placeholder"), "rgb(102, 102, 102)");

  const unknown = paletteRoot(sourceColors("rgb(255, 255, 255)", "rgb(0, 0, 0)", ""));
  for (const property of PALETTE_PROPERTIES) unknown.style.setProperty(property, "red");
  assert.equal(applyFirefoxPalette(unknown), false);
  for (const property of PALETTE_PROPERTIES) assert.equal(unknown.get(property), undefined, `${property} falls back to the stylesheet`);

  const unparsed = paletteRoot(sourceColors("rgb(255, 255, 255)", "rgb(0, 0, 0)", "color(display-p3 0 0.5 1)"));
  assert.equal(applyFirefoxPalette(unparsed), false);
  assert.equal(unparsed.probes, 0);
  for (const property of PALETTE_PROPERTIES) assert.equal(unparsed.get(property), undefined);

  assert.equal(applyFirefoxPalette(styleRoot()), false, "a root without a document keeps the stylesheet fallback");
});

test("a low-contrast theme raises each text tier until it keeps 4.5:1", () => {
  const colors = {
    ...sourceColors("rgb(244, 236, 216)", "rgb(60, 47, 30)", "rgb(185, 165, 255)", "rgb(21, 20, 26)"),
    "--qz-ff-popup": "rgb(28, 27, 34)",
    "--qz-ff-popup-text": "rgb(251, 251, 254)",
    "--qz-ff-field": "rgba(255, 255, 255, 0.5)",
  };
  const root = paletteRoot(colors);
  assert.equal(applyFirefoxPalette(root), true);
  assert.equal(root.get("--qz-ff-primary"), "rgb(185, 165, 255)");
  assert.equal(root.get("--qz-ff-primary-text"), "rgb(21, 20, 26)");
  assert.equal(root.get("--qz-ff-text-deemphasized"), "rgb(99, 87, 69)");
  assert.equal(root.get("--qz-ff-text-muted"), "rgb(102, 90, 73)");
  assert.equal(root.get("--qz-ff-popup-text-deemphasized"), "rgb(189, 188, 192)", "popups use their own surface and text");
  assert.equal(root.get("--qz-ff-popup-text-muted"), "rgb(162, 161, 166)");
  assert.equal(root.get("--qz-ff-field-text-deemphasized"), "rgb(104, 93, 77)");
  assert.equal(root.get("--qz-ff-field-placeholder"), "rgb(119, 109, 94)", "a translucent field is composited over the sidebar");

  const computed = paletteRoot({
    ...sourceColors("color(srgb 0.11 0.105 0.133)", "color(srgb 0.984 0.984 0.996)", "rgb(0, 96, 223)"),
    "--qz-ff-field": "color(srgb 0.17 0.165 0.19 / 0.9)",
  });
  assert.equal(applyFirefoxPalette(computed), true, "computed color(srgb) values parse");
  assert.equal(computed.get("--qz-ff-text-muted"), "rgb(162, 161, 166)");
  assert.equal(computed.get("--qz-ff-field-placeholder"), "rgb(167, 167, 171)");
});

test("the palette follows theme updates, color-scheme changes, and window focus", async () => {
  const colors = sourceColors("rgb(255, 255, 255)", "rgb(0, 0, 0)", "rgb(0, 96, 223)");
  const root = paletteRoot(colors);
  let listener;
  installFirefoxTheme({
    windows: { async getCurrent() { return { id: 1 }; } },
    theme: { getCurrent: () => ({}), onUpdated: { addListener(fn) { listener = fn; } } },
  }, root);
  assert.equal(root.get("--qz-ff-primary"), "rgb(0, 96, 223)");
  assert.equal(root.listeners.load.length, 0, "a resolved stylesheet needs no load listener");
  assert.equal(root.listeners.change.length, 1);
  assert.equal(root.listeners.focus.length, 1);
  await new Promise(resolve => setTimeout(resolve, 0));

  colors["--qz-ff-accent"] = "rgb(185, 165, 255)";
  listener({ theme: { colors: { sidebar_highlight: "#b9a5ff" } }, windowId: 1 });
  assert.equal(root.get("--qz-ff-accent"), "rgb(185, 165, 255)");
  assert.equal(root.get("--qz-ff-primary-text"), "rgb(21, 20, 26)");

  Object.assign(colors, sourceColors("rgb(28, 27, 34)", "rgb(251, 251, 254)", "rgb(10, 132, 255)"));
  root.listeners.change[0]();
  assert.equal(root.get("--qz-ff-primary"), "rgb(9, 115, 222)");
  assert.equal(root.get("--qz-ff-accent-ink"), "rgb(35, 144, 255)");
  assert.equal(root.get("--qz-ff-text-muted"), "rgb(162, 161, 166)");
  colors["--qz-ff-accent"] = "rgb(0, 122, 255)";
  root.listeners.focus[0]();
  assert.equal(root.get("--qz-ff-primary"), "rgb(0, 112, 235)");
});

test("the palette waits for the stylesheet before reading the accent", () => {
  const colors = sourceColors("rgb(255, 255, 255)", "rgb(0, 0, 0)", "");
  const root = paletteRoot(colors);
  installFirefoxTheme({}, root);
  assert.equal(root.get("--qz-ff-primary"), undefined);
  assert.equal(root.listeners.load.length, 1);
  colors["--qz-ff-accent"] = "rgb(0, 96, 223)";
  root.listeners.load[0]();
  assert.equal(root.get("--qz-ff-primary"), "rgb(0, 96, 223)");
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
  listener({ theme: { colors: { sidebar: "#abcdef" } }, windowId: 7 });
  assert.equal(root.get("--qz-ff-sidebar"), undefined);
  resolveWindow({ id: 7 });
  await Promise.resolve();
  assert.deepEqual(calls, [7]);
  listener({ theme: { colors: { sidebar: [10, 20, 30] } }, windowId: 7 });
  assert.equal(root.get("--qz-ff-sidebar"), "rgb(10, 20, 30)");
  resolveTheme({ colors: { popup: "#123456", popup_text: "#ffffff" } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(root.get("--qz-ff-sidebar"), "rgb(10, 20, 30)", "a stale initial read does not replace a newer update");
  assert.equal(root.get("--qz-ff-popup"), undefined);
  listener({ theme: { colors: { sidebar: "#aabbcc" } }, windowId: 3 });
  assert.equal(root.get("--qz-ff-sidebar"), "rgb(10, 20, 30)", "another window's theme is ignored");
  listener({ theme: { colors: { popup: "#eeeeee", focus_outline: "#123456" } } });
  assert.equal(root.get("--qz-ff-popup"), "rgb(238, 238, 238)");
  assert.equal(root.get("--qz-ff-focus"), "#123456");
  listener({ theme: {} });
  assert.equal(root.get("--qz-ff-popup"), undefined);
  assert.equal(root.get("--qz-ff-focus"), undefined);
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
        return { colors: { sidebar: "#123456", sidebar_text: "#ffffff", sidebar_highlight: [0, 97, 224] } };
      },
      onUpdated: { addListener() {} },
    },
  }, root);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, [4]);
  assert.equal(root.get("--qz-ff-sidebar"), "rgb(18, 52, 86)");
  assert.equal(root.get("--qz-ff-sidebar-text"), "rgb(255, 255, 255)");
  assert.equal(root.get("--qz-ff-accent"), "rgb(0, 97, 224)");
  assert.equal(root.get("--qz-ff-accent-text"), "#fbfbfe");
  assert.equal(root.get("color-scheme"), "dark");
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
  for (const [, property] of FIREFOX_THEME_COLOR_PROPERTIES) assert.equal(root.get(property), undefined);
});

test("the theme reader does not call theme.update", () => {
  const theme = readFileSync(join(repoRoot, "src/sidepanel/firefox/theme.ts"), "utf8");
  const host = readFileSync(join(repoRoot, "src/sidepanel/firefox/host.ts"), "utf8");
  assert.equal(theme.includes(".update("), false);
  assert.equal(theme.includes(".reset("), false);
  assert.match(host, /installFirefoxTheme\(chromeApi, document\.documentElement\)/);
  assert.equal(host.includes(".update("), false);
});
