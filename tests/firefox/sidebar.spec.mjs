import { test, expect } from "./fixture.mjs";
import { FIREFOX_EXTENSION_UUID } from "./launch.mjs";

test("the Firefox package opens its sidebar in Firefox", async ({ firefoxSidebar }) => {
  const page = firefoxSidebar.page;
  expect(test.info().project.name).toBe("firefox");
  expect(firefoxSidebar.browserName).toBe("firefox");
  expect(firefoxSidebar.packageLabel).toBe("dist/extension-firefox");
  expect(firefoxSidebar.packageDir.replaceAll("\\", "/")).toMatch(/extension-firefox$/);
  expect(firefoxSidebar.browserVersion).toMatch(/^\d+\./);
  await expect(page).toHaveURL(/^moz-extension:\/\/12345678-1234-5678-9abc-123456789abc\/sidepanel\/sidepanel\.html$/);

  const identity = await page.evaluate(async () => {
    const manifest = chrome.runtime.getManifest();
    const theme = globalThis.browser?.theme;
    let current = { missing: true };
    if (typeof theme?.getCurrent === "function") {
      try { current = await theme.getCurrent(); }
      catch (error) { current = { error: String(error) }; }
    }
    const style = getComputedStyle(document.documentElement);
    return {
      id: chrome.runtime.id,
      url: chrome.runtime.getURL(""),
      agent: navigator.userAgent,
      scripts: manifest.background?.scripts || [],
      serviceWorker: manifest.background?.service_worker || "",
      sidebar: manifest.sidebar_action?.default_panel || "",
      gecko: manifest.browser_specific_settings?.gecko?.id || "",
      themeKey: manifest.theme || null,
      permissions: manifest.permissions || [],
      colorScheme: style.colorScheme,
      toolbar: style.getPropertyValue("--qz-ff-toolbar").trim(),
      accent: style.getPropertyValue("--qz-ff-accent").trim(),
      sheets: [...document.querySelectorAll("link[rel=stylesheet]")].map(link => link.getAttribute("href")),
      theme: current,
    };
  });

  expect(identity.id).toBe(firefoxSidebar.geckoId);
  expect(identity.url.startsWith("moz-extension:")).toBe(true);
  expect(identity.url.startsWith("chrome-extension:")).toBe(false);
  expect(identity.agent).toContain("Firefox/");
  expect(identity.scripts).toEqual([firefoxManifestPath("background/firefox-boot.js")]);
  expect(identity.serviceWorker).toBe(firefoxManifestPath("background/service-worker.js"));
  expect(identity.sidebar).toBe(firefoxManifestPath("sidepanel/sidepanel.html"));
  expect(identity.gecko).toBe(firefoxSidebar.geckoId);
  expect(identity.themeKey).toBeNull();
  expect(identity.permissions).not.toContain("theme");
  expect(identity.colorScheme).toBe("light dark");
  expect(identity.sheets).toContain("firefox-sidebar.css");
  expect(identity.theme.error || "").toBe("");
  expect(identity.theme.missing).toBeUndefined();
  const themeColors = identity.theme?.colors;
  const themed = themeColors && typeof themeColors === "object" && Object.keys(themeColors).length > 0;
  if (themed && themeColors.toolbar) expect(normalizeThemeColor(identity.toolbar)).toBe(normalizeThemeColor(themeColors.toolbar));
  else expect(identity.toolbar).toBe("Canvas");
  if (themed && themeColors.accentcolor) expect(normalizeThemeColor(identity.accent)).toBe(normalizeThemeColor(themeColors.accentcolor));
  else expect(identity.accent).toBe("AccentColor");

  // BiDi Firefox ignores Playwright color-scheme emulation. The root property still selects Canvas.
  const scheme = await page.evaluate(() => {
    const root = document.documentElement;
    const background = () => getComputedStyle(document.body).backgroundColor;
    root.style.colorScheme = "dark";
    const dark = background();
    root.style.colorScheme = "light";
    const light = background();
    root.style.colorScheme = "";
    return { dark, light };
  });
  expect(scheme.dark).toMatch(/^rgb\(/);
  expect(scheme.light).toMatch(/^rgb\(/);
  if (!themed) expect(scheme.dark).not.toBe(scheme.light);

  await page.locator("[data-consent-accept]").click();
  await expect(page.locator("#app")).not.toHaveAttribute("data-consent-pending", { timeout: 20_000 });
  await expect(page.locator("#input")).toBeAttached();
  expect(firefoxSidebar.pageErrors, firefoxSidebar.pageErrors.join("\n")).toEqual([]);
  expect(firefoxSidebar.consoleErrors, firefoxSidebar.consoleErrors.join("\n")).toEqual([]);
});

function firefoxManifestPath(path) {
  return `moz-extension://${FIREFOX_EXTENSION_UUID}/${path}`;
}

function normalizeThemeColor(value) {
  if (Array.isArray(value)) return `rgb(${value.slice(0, 3).join(", ")})`;
  return String(value || "").trim().toLowerCase().replaceAll(" ", "");
}
