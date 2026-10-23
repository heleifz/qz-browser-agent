import { FIREFOX_EXTENSION_UUID, widgetId } from "./launch.mjs";

const SIDEBAR_URL = `moz-extension://${FIREFOX_EXTENSION_UUID}/sidepanel/sidepanel.html`;

export function sidebarCommandId(extensionId) {
  return `${widgetId(extensionId)}-sidebar-action`;
}

export function shortcutKeyId(extensionId) {
  return `ext-key-id-${widgetId(extensionId)}-sidebar-action`;
}

/** Read the focused window's sidebar browser and every tab URL. */
export function readSidebar(session) {
  const command = sidebarCommandId(session.geckoId);
  return session.chrome(`
    const win = Services.focus.activeWindow || window;
    const panel = win.document.getElementById("sidebar")?.contentDocument?.getElementById("webext-panels-browser");
    const tabs = [];
    for (const browserWin of Services.wm.getEnumerator("navigator:browser")) {
      for (const tab of browserWin.gBrowser.tabs) tabs.push(tab.linkedBrowser.currentURI.spec);
    }
    return {
      current: win.SidebarController?.currentID || "",
      panel: panel?.currentURI?.spec || "",
      tabs,
      command: ${JSON.stringify(command)},
    };
  `);
}

export async function hideSidebars(session) {
  await session.chrome(`
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      try { win.SidebarController.hide(); } catch { /* A closed sidebar is the state this reset wants. */ }
    }
    const started = Date.now();
    while (Date.now() - started < 2000) {
      const win = Services.focus.activeWindow || window;
      if (!win.SidebarController?.currentID) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return true;
  `);
}

/** The navbar button calls browserAction.triggerAction, which runs the extension click handler. */
export async function openFromToolbar(session) {
  await hideSidebars(session);
  return session.chrome(`
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const policy = WebExtensionPolicy.getByID(${JSON.stringify(session.geckoId)});
    const win = Services.focus.activeWindow || window;
    const button = win.document.getElementById(${JSON.stringify(`${widgetId(session.geckoId)}-browser-action`)});
    ExtensionParent.apiManager.global.browserActionFor(policy.extension).triggerAction(win);
    const started = Date.now();
    let snap = null;
    while (Date.now() - started < 5000) {
      const panel = win.document.getElementById("sidebar")?.contentDocument?.getElementById("webext-panels-browser");
      snap = { current: win.SidebarController.currentID || "", panel: panel?.currentURI?.spec || "", button: !!button };
      if (snap.panel === ${JSON.stringify(SIDEBAR_URL)}) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const tabs = [];
    for (const browserWin of Services.wm.getEnumerator("navigator:browser")) {
      for (const tab of browserWin.gBrowser.tabs) tabs.push(tab.linkedBrowser.currentURI.spec);
    }
    snap.tabs = tabs;
    return snap;
  `);
}

/** The manifest shortcut is _execute_sidebar_action. Firefox toggles the sidebar from that key. */
export async function openFromShortcut(session) {
  await hideSidebars(session);
  const keyId = shortcutKeyId(session.geckoId);
  return session.chrome(`
    const win = Services.focus.activeWindow || window;
    const key = win.document.getElementById(${JSON.stringify(keyId)});
    if (!key) throw new Error("Firefox did not register the sidebar shortcut");
    key.doCommand();
    const started = Date.now();
    let snap = null;
    while (Date.now() - started < 5000) {
      const panel = win.document.getElementById("sidebar")?.contentDocument?.getElementById("webext-panels-browser");
      snap = {
        current: win.SidebarController.currentID || "",
        panel: panel?.currentURI?.spec || "",
        key: key.getAttribute("key"),
        modifiers: key.getAttribute("modifiers"),
      };
      if (snap.panel === ${JSON.stringify(SIDEBAR_URL)}) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const tabs = [];
    for (const browserWin of Services.wm.getEnumerator("navigator:browser")) {
      for (const tab of browserWin.gBrowser.tabs) tabs.push(tab.linkedBrowser.currentURI.spec);
    }
    snap.tabs = tabs;
    return snap;
  `);
}

export function extensionManifest(session) {
  return session.extension("background", `
    const manifest = view.chrome.runtime.getManifest();
    return {
      id: view.chrome.runtime.id,
      url: view.chrome.runtime.getURL(""),
      commands: Object.keys(manifest.commands || {}),
      sidebar: manifest.sidebar_action && manifest.sidebar_action.default_panel,
      scripts: manifest.background && manifest.background.scripts || [],
      serviceWorker: manifest.background && manifest.background.service_worker || "",
      gecko: manifest.browser_specific_settings && manifest.browser_specific_settings.gecko && manifest.browser_specific_settings.gecko.id || "",
      themeKey: manifest.theme || null,
      permissions: manifest.permissions || [],
    };
  `);
}

const BUTTON_STATE_SCRIPT = `
  const started = Date.now();
  let button = null;
  while (Date.now() - started < 4000) {
    button = content.document.querySelector("#onboarding-primary-btn") || content.document.querySelector(".qz-btn--primary");
    if (button) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!button) {
    return {
      missing: true,
      href: String(content.location && content.location.href || ""),
      buttons: content.document.querySelectorAll("button").length,
    };
  }
  const read = () => {
    const style = content.getComputedStyle(button);
    return { color: style.color, background: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity };
  };
  const rest = read();
  let hover = { error: "pseudo lock unavailable" };
  let active = { error: "pseudo lock unavailable" };
  let utils = null;
  try {
    if (typeof InspectorUtils !== "undefined" && InspectorUtils.addPseudoClassLock) utils = InspectorUtils;
    else utils = Cc["@mozilla.org/inspector/dom-utils;1"].getService(Ci.inIDOMUtils);
    const target = Cu.waiveXrays(button);
    utils.addPseudoClassLock(target, ":hover");
    hover = read();
    utils.clearPseudoClassLocks(target);
    utils.addPseudoClassLock(target, ":active");
    active = read();
    utils.clearPseudoClassLocks(target);
  } catch (error) {
    hover = { error: String(error) };
    active = { error: String(error) };
    try { if (utils && utils.clearPseudoClassLocks) utils.clearPseudoClassLocks(Cu.waiveXrays(button)); }
    catch { /* The next sample sets its own lock. */ }
  }
  const wasDisabled = button.disabled;
  button.disabled = true;
  const disabled = read();
  button.disabled = wasDisabled;
  const rootStyle = content.getComputedStyle(content.document.documentElement);
  return {
    rest, hover, active, disabled,
    veil: rootStyle.getPropertyValue("--qz-ff-primary-hover-veil").trim(),
    activeVeil: rootStyle.getPropertyValue("--qz-ff-primary-active-veil").trim(),
    disabledVeil: rootStyle.getPropertyValue("--qz-ff-primary-disabled-veil").trim(),
    disabledOpacity: rootStyle.getPropertyValue("--control-disabled-opacity").trim(),
    accent: rootStyle.getPropertyValue("--qz-ff-accent").trim(),
    scheme: rootStyle.colorScheme,
  };
`;

export function buttonColors(session) {
  return session.extension("sidebar", `
    const sample = await (async () => { ${BUTTON_STATE_SCRIPT} })();
    sample.dark = view.matchMedia("(prefers-color-scheme: dark)").matches;
    return sample;
  `);
}

export function readTheme(session) {
  return session.extension("sidebar", `
    const style = content.getComputedStyle(content.document.documentElement);
    const root = content.document.documentElement;
    let current = { missing: true };
    const theme = view.browser && view.browser.theme;
    if (typeof theme?.getCurrent === "function") {
      try { current = await theme.getCurrent(); }
      catch (error) { current = { error: String(error) }; }
    }
    return {
      colorScheme: style.colorScheme,
      toolbar: style.getPropertyValue("--qz-ff-toolbar").trim(),
      accent: style.getPropertyValue("--qz-ff-accent").trim(),
      inlineAccent: root.style.getPropertyValue("--qz-ff-accent").trim(),
      inlineToolbar: root.style.getPropertyValue("--qz-ff-toolbar").trim(),
      sheets: [...content.document.querySelectorAll("link[rel=stylesheet]")].map(link => link.getAttribute("href")),
      theme: current,
    };
  `);
}

export async function colorSchemes(session) {
  // Extension pages ignore layout.css.prefers-color-scheme.content-override.
  // Firefox applies prefers-color-scheme to the sidebar browser through
  // browsingContext.prefersColorSchemeOverride, the same field the window theme uses.
  const samples = [];
  try {
    for (const name of ["light", "dark"]) {
      await session.chrome(`
        const win = Services.focus.activeWindow || window;
        const panel = win.document.getElementById("sidebar")?.contentDocument?.getElementById("webext-panels-browser");
        if (!panel?.browsingContext) throw new Error("Firefox sidebar has no browsing context");
        panel.browsingContext.prefersColorSchemeOverride = ${JSON.stringify(name)};
        await new Promise(resolve => setTimeout(resolve, 50));
        return panel.browsingContext.prefersColorSchemeOverride;
      `);
      const colors = await session.extension("sidebar", `
        content.document.documentElement.style.removeProperty("color-scheme");
        void content.document.documentElement.offsetWidth;
        const sample = await (async () => { ${BUTTON_STATE_SCRIPT} })();
        sample.name = ${JSON.stringify(name)};
        sample.dark = content.matchMedia("(prefers-color-scheme: dark)").matches;
        sample.light = content.matchMedia("(prefers-color-scheme: light)").matches;
        sample.body = content.getComputedStyle(content.document.body).backgroundColor;
        return sample;
      `);
      samples.push(colors);
    }
  } finally {
    await session.chrome(`
      const win = Services.focus.activeWindow || window;
      const panel = win.document.getElementById("sidebar")?.contentDocument?.getElementById("webext-panels-browser");
      if (panel?.browsingContext) panel.browsingContext.prefersColorSchemeOverride = "none";
      return true;
    `).catch(() => undefined);
  }
  return samples;
}

export function createNotification(session, id, options) {
  return session.extension("background", `
    const api = extensionApi();
    const marked = !!(api.notifications && api.notifications.create && api.notifications.create.qzFirefoxRenewal);
    let created = "";
    let error = "";
    try {
      // The options object has to live in the extension page. The wrapper's
      // JSON clone drops fields from a frame-script object.
      const payload = Cu.cloneInto(${JSON.stringify(options)}, content);
      created = await api.notifications.create(${JSON.stringify(id)}, payload);
    } catch (failure) {
      error = String(failure && failure.message || failure);
    }
    return { created, error, marked };
    function extensionApi() {
      const chromeApi = view.chrome || view.browser;
      const browserApi = view.browser || view.chrome;
      return chromeApi.notifications && chromeApi.notifications.create && chromeApi.notifications.create.qzFirefoxRenewal ? chromeApi : browserApi;
    }
  `);
}

export function refuseSidebarOpen(session) {
  return session.extension("background", `
    const api = view.chrome && view.chrome.sidePanel ? view.chrome : view.browser;
    const original = api.notifications.create;
    let captured = null;
    api.notifications.create = function(notificationId, options) {
      const value = Cu.waiveXrays(options) || options || {};
      if (notificationId === "qz-open-sidebar") {
        captured = {
          message: value.message || "",
          title: value.title || "",
          requireInteraction: Object.prototype.hasOwnProperty.call(value, "requireInteraction"),
        };
      }
      return original.apply(this, arguments);
    };
    let openError = "";
    try {
      await api.sidePanel.open(Cu.cloneInto({}, content));
      openError = "opened";
    } catch (error) {
      openError = String(error && error.message || error);
    } finally {
      api.notifications.create = original;
    }
    let badge = "";
    try { badge = await api.action.getBadgeText(Cu.cloneInto({}, content)); }
    catch (error) { badge = String(error); }
    return {
      openError,
      badge,
      message: captured ? captured.message : "",
      title: captured ? captured.title : "",
      requireInteraction: captured ? captured.requireInteraction : false,
    };
  `);
}

export function parseRgb(value) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(String(value || ""));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function gradientVeil(image) {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/.exec(String(image || ""));
  if (!match || image === "none") return null;
  const raw = match[4];
  const alpha = raw == null ? 1 : Number(String(raw).replace("%", "")) / (String(raw).includes("%") ? 100 : 1);
  if (!Number.isFinite(alpha)) return null;
  return { color: [Number(match[1]), Number(match[2]), Number(match[3])], alpha };
}

/** Composite a black or colored veil over an opaque background. */
export function paint(background, image) {
  const base = parseRgb(background);
  if (!base) return null;
  const veil = gradientVeil(image);
  if (!veil || veil.alpha <= 0) return base;
  return base.map((channel, index) => Math.round(channel * (1 - veil.alpha) + veil.color[index] * veil.alpha));
}

export function contrastRatio(foreground, background) {
  const ratio = (relativeLuminance(foreground) + 0.05) / (relativeLuminance(background) + 0.05);
  const inverse = (relativeLuminance(background) + 0.05) / (relativeLuminance(foreground) + 0.05);
  return Math.max(ratio, inverse);
}

function relativeLuminance(rgb) {
  const [red, green, blue] = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
