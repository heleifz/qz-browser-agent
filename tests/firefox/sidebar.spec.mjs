import { test, expect } from "./fixture.mjs";
import { FIREFOX_EXTENSION_UUID } from "./launch.mjs";
import {
  buttonColors,
  colorSchemes,
  contrastRatio,
  createNotification,
  extensionManifest,
  openFromShortcut,
  openFromToolbar,
  paint,
  parseRgb,
  readSidebar,
  readTheme,
  refuseSidebarOpen,
  sidebarCommandId,
} from "./driver.mjs";

test.describe.configure({ mode: "serial" });

test("a temporary add-on opens the sidebar from the toolbar, not a tab", async ({ firefoxSidebar }) => {
  expect(firefoxSidebar.browserName).toBe("firefox");
  expect(firefoxSidebar.packageLabel).toBe("dist/extension-firefox");
  expect(firefoxSidebar.browserVersion).toMatch(/^Mozilla Firefox \d+\./);
  const closed = await readSidebar(firefoxSidebar);
  expect(closed.panel).not.toBe(firefoxSidebar.sidebarUrl);
  expect(closed.tabs.some(url => url.includes("/sidepanel/sidepanel.html"))).toBe(false);

  const opened = await openFromToolbar(firefoxSidebar);
  expectSidebar(opened, firefoxSidebar);
  expect(opened.button).toBe(true);

  const identity = await extensionManifest(firefoxSidebar);
  expect(identity.id).toBe(firefoxSidebar.geckoId);
  expect(identity.url.startsWith("moz-extension:")).toBe(true);
  expect(identity.url.startsWith("chrome-extension:")).toBe(false);
  expect(identity.commands).toContain("_execute_sidebar_action");
  expect(identity.commands).not.toContain("_execute_action");
  expect(identity.sidebar).toBe(firefoxManifestPath("sidepanel/sidepanel.html"));
  expect(identity.scripts).toEqual([firefoxManifestPath("background/firefox-boot.js")]);
  expect(identity.serviceWorker).toBe(firefoxManifestPath("background/service-worker.js"));
  expect(identity.gecko).toBe(firefoxSidebar.geckoId);
  expect(identity.themeKey).toBeNull();
  expect(identity.permissions).not.toContain("theme");

  const booted = await firefoxSidebar.extension("sidebar", `
    const accept = content.document.querySelector("[data-consent-accept]");
    if (accept) accept.click();
    const started = Date.now();
    let app = null;
    let input = null;
    while (Date.now() - started < 12000) {
      app = content.document.querySelector("#app");
      input = content.document.querySelector("#input");
      if (input && app && !app.hasAttribute("data-consent-pending")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return {
      booted: !!(input && app && !app.hasAttribute("data-consent-pending")),
      pending: app ? app.getAttribute("data-consent-pending") : "missing",
    };
  `);
  expect(booted.booted, JSON.stringify(booted)).toBe(true);
});

test("the sidebar shortcut opens the real sidebar", async ({ firefoxSidebar }) => {
  const opened = await openFromShortcut(firefoxSidebar);
  expectSidebar(opened, firefoxSidebar);
  expect(opened.key).toBe("K");
  expect(opened.modifiers).toBe("accel,shift");
});

test("primary buttons stay readable in light and dark", async ({ firefoxSidebar }) => {
  await openFromToolbar(firefoxSidebar);
  const theme = await readTheme(firefoxSidebar);
  expect(theme.theme.error || "", JSON.stringify(theme.theme)).toBe("");
  expect(theme.theme.missing).toBeUndefined();
  expect(theme.colorScheme).toBe("light dark");
  expect(theme.sheets).toContain("firefox-sidebar.css");
  const themeColors = theme.theme?.colors;
  const themed = Boolean(themeColors && typeof themeColors === "object" && Object.keys(themeColors).length > 0);
  if (themed && themeColors.toolbar) expect(normalizeThemeColor(theme.toolbar)).toBe(normalizeThemeColor(themeColors.toolbar));
  else expect(theme.toolbar).toBe("Canvas");
  if (themed && themeColors.accentcolor) {
    expect(normalizeThemeColor(theme.accent)).toBe(normalizeThemeColor(themeColors.accentcolor));
    expect(theme.inlineAccent.length).toBeGreaterThan(0);
  } else expect(theme.accent).toBe("AccentColor");
  if (themed && themeColors.toolbar) expect(theme.inlineToolbar.length).toBeGreaterThan(0);

  const colors = await buttonColors(firefoxSidebar);
  expect(colors.missing, JSON.stringify(colors)).toBeUndefined();
  expect(colors.disabledOpacity).toBe("1");
  expect(colors.veil).toBe("14%");
  expect(colors.activeVeil).toBe("22%");
  expect(colors.disabledVeil).toBe("14%");
  expectButtonContrast(colors, "resting");

  const schemes = await colorSchemes(firefoxSidebar);
  expect(schemes.map(sample => sample.name)).toEqual(["light", "dark"]);
  const media = new Set(schemes.map(sample => sample.dark));
  expect(media.size, JSON.stringify(schemes.map(sample => ({ name: sample.name, dark: sample.dark, light: sample.light, body: sample.body })))).toBe(2);
  if (!themed) expect(schemes[0].body).not.toBe(schemes[1].body);
  const dark = schemes.find(sample => sample.name === "dark");
  const light = schemes.find(sample => sample.name === "light");
  expect(dark.dark).toBe(true);
  expect(light.dark).toBe(false);
  expect(light.light).toBe(true);
  for (const sample of schemes) expectButtonContrast(sample, sample.name);
});

test("creating a notification without requireInteraction does not throw", async ({ firefoxSidebar }) => {
  const plain = await createNotification(firefoxSidebar, "qz-firefox-plain", {
    type: "basic",
    title: "qz",
    message: "plain",
  });
  expect(plain.error || "", JSON.stringify(plain)).toBe("");
  expect(plain.marked).toBe(true);
  expect(plain.created).toBe("qz-firefox-plain");

  const sticky = await createNotification(firefoxSidebar, "qz-firefox-sticky", {
    type: "basic",
    title: "qz",
    message: "sticky",
    requireInteraction: true,
    priority: 1,
  });
  // Firefox rejects requireInteraction before showAlert. A returned id means the wrapper removed it.
  expect(sticky.error || "", JSON.stringify(sticky)).toBe("");
  expect(sticky.marked).toBe(true);
  expect(sticky.created).toBe("qz-firefox-sticky");
});

test("refusing sidebar open sets the badge and the click prompt", async ({ firefoxSidebar }) => {
  const prompt = await refuseSidebarOpen(firefoxSidebar);
  expect(prompt.openError).toMatch(/user gesture/);
  expect(prompt.badge).toBe("!");
  expect(prompt.requireInteraction).toBe(false);
  expect(["Click this notification to open the sidebar.", "点击此通知打开侧边栏。"]).toContain(prompt.message);
  expect(["qz", "轻舟"]).toContain(prompt.title);
});

function expectSidebar(snapshot, session) {
  expect(snapshot.panel).toBe(session.sidebarUrl);
  expect(snapshot.current).toBe(sidebarCommandId(session.geckoId));
  expect(snapshot.tabs).not.toContain(session.sidebarUrl);
  expect(snapshot.tabs.some(url => String(url).includes("/sidepanel/sidepanel.html"))).toBe(false);
}

function expectButtonContrast(sample, label) {
  expect(sample.missing, JSON.stringify(sample)).toBeUndefined();
  const hover = resolvedState(sample.rest, sample.hover, sample.veil);
  const active = resolvedState(sample.rest, sample.active, sample.activeVeil);
  const disabled = resolvedState(sample.rest, sample.disabled, sample.disabledVeil);
  expect(readable(sample.rest, `${label} rest`)).toBeGreaterThanOrEqual(4.5);
  expect(readable(hover, `${label} hover`)).toBeGreaterThanOrEqual(4.5);
  expect(readable(active, `${label} active`)).toBeGreaterThanOrEqual(4.5);
  expect(readable(disabled, `${label} disabled`)).toBeGreaterThanOrEqual(4.5);
}

function resolvedState(rest, state, veil) {
  if (state && !state.error && (state.image && state.image !== "none" || state.background)) return state;
  const amount = Number.parseFloat(veil);
  const alpha = Number.isFinite(amount) ? amount / 100 : 0.14;
  return {
    color: rest.color,
    background: rest.background,
    image: `linear-gradient(rgba(0, 0, 0, ${alpha}), rgba(0, 0, 0, ${alpha}))`,
  };
}

function readable(sample, label) {
  const text = parseRgb(sample.color);
  const fill = paint(sample.background, sample.image) || parseRgb(sample.background);
  expect(text, label).toBeTruthy();
  expect(fill, `${label} fill`).toBeTruthy();
  const ratio = contrastRatio(text, fill);
  expect(ratio, `${label} contrast ${ratio.toFixed(2)}:1 for ${sample.color} on ${fill.join(",")} image ${sample.image}`).toBeGreaterThanOrEqual(4.5);
  return ratio;
}

function firefoxManifestPath(path) {
  return `moz-extension://${FIREFOX_EXTENSION_UUID}/${path}`;
}

function normalizeThemeColor(value) {
  if (Array.isArray(value)) return `rgb(${value.slice(0, 3).join(",")})`;
  return String(value || "").trim().toLowerCase().replaceAll(" ", "");
}
