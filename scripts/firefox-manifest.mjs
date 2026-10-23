// Firefox rejects permission names it does not implement. This rewrites a built copy.
// src/manifest.json and the Chrome output stay on the Chrome manifest.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromeMessageId, decodeChromeMessage, encodeChromeMessage, HISTORICAL_LABELS_MESSAGE_ID } from "../src/shared/i18n/definition.ts";

export const FIREFOX_GECKO_ID = "qz-browser-agent@heleifz.github.io";
export const FIREFOX_MIN_VERSION = "139.0";
export const FIREFOX_BACKGROUND_SCRIPT = "background/firefox-boot.js";
export const FIREFOX_PANEL_SCRIPT = "sidepanel/firefox-boot.js";
export const FIREFOX_DROPPED_PERMISSIONS = Object.freeze([
  "debugger",
  "desktopCapture",
  "offscreen",
  "sidePanel",
]);
export const FIREFOX_ADDED_PERMISSIONS = Object.freeze([
  "webNavigation",
  "webRequest",
  "webRequestBlocking",
]);
export const FIREFOX_DATA_COLLECTION = Object.freeze({
  required: Object.freeze(["websiteContent"]),
  optional: Object.freeze(["locationInfo", "browsingActivity", "bookmarksInfo"]),
});
export const FILE_ACCESS_MESSAGE_KEY = "backend.toolError.FILE_ACCESS_REQUIRED.message";
export const FIREFOX_SIDEBAR_STYLESHEET = "sidepanel/firefox-sidebar.css";

const droppedPermissions = new Set(FIREFOX_DROPPED_PERMISSIONS);
const FILE_ACCESS_TEXT = Object.freeze({
  en: "Open qz in about:addons, open Permissions, enable Access local files on your computer, then retry.",
  zh_CN: "请在 about:addons 中打开轻舟，进入权限页，开启“访问您计算机上的本地文件”，然后重试。",
  zh_TW: "請在 about:addons 中開啟輕舟，進入權限頁，開啟「存取您電腦上的本機檔案」，然後重試。",
  ja: "about:addons で軽舟を開き、権限ページで「コンピューター上のローカルファイルへのアクセス」を有効にしてから再試行してください。",
  ko: "about:addons에서 qz를 열고 권한 페이지에서 컴퓨터의 로컬 파일 액세스를 켠 다음 다시 시도하세요.",
  de: "Öffnen Sie qz unter about:addons, öffnen Sie die Berechtigungen, aktivieren Sie den Zugriff auf lokale Dateien auf Ihrem Computer und versuchen Sie es erneut.",
  es: "Abra qz en about:addons, abra Permisos, active el acceso a los archivos locales del equipo y vuelva a intentarlo.",
  fr: "Ouvrez qz dans about:addons, ouvrez Autorisations, activez l’accès aux fichiers locaux de votre ordinateur, puis réessayez.",
  pt_BR: "Abra o qz em about:addons, abra Permissões, ative o acesso a arquivos locais no computador e tente novamente.",
  ru: "Откройте qz на странице about:addons, откройте разрешения, включите доступ к локальным файлам на компьютере и повторите попытку.",
  ar: "افتح qz في about:addons، ثم افتح الأذونات، وفعّل الوصول إلى الملفات المحلية على جهاز الكمبيوتر، ثم أعد المحاولة.",
  hi: "about:addons में qz खोलें, अनुमतियाँ खोलें, अपने कंप्यूटर पर स्थानीय फ़ाइलों की पहुँच चालू करें और फिर से कोशिश करें।",
});

/** True for sources that exist only in the Firefox package. */
export function isFirefoxOnlySource(path) {
  return /^(?:background|sidepanel)\/firefox(?:-boot\.ts|\/)/.test(String(path || "").replaceAll("\\", "/"));
}

/** Return a Manifest V3 document Firefox can load as a temporary add-on. */
export function firefoxManifest(manifest) {
  if (!manifest || manifest.manifest_version !== 3) {
    throw new Error("Firefox manifest requires Manifest V3");
  }
  const worker = manifest.background?.service_worker;
  if (!worker || manifest.background.type !== "module") {
    throw new Error("Firefox background expects the module service worker entry");
  }
  const panel = manifest.side_panel?.default_path;
  if (!panel) throw new Error("Firefox sidebar requires side_panel.default_path");

  const next = structuredClone(manifest);
  delete next.key;
  delete next.side_panel;
  if (Array.isArray(next.permissions)) {
    next.permissions = next.permissions.filter(permission => !droppedPermissions.has(permission));
    for (const permission of FIREFOX_ADDED_PERMISSIONS) {
      if (!next.permissions.includes(permission)) next.permissions.push(permission);
    }
  }
  if (Array.isArray(next.optional_permissions)) {
    next.optional_permissions = next.optional_permissions.filter(permission => !droppedPermissions.has(permission));
    if (!next.optional_permissions.length) delete next.optional_permissions;
  }
  // Firefox starts background.scripts and does not run background.service_worker.
  // The boot module patches Firefox APIs, then loads the shared service worker.
  next.background = {
    scripts: [FIREFOX_BACKGROUND_SCRIPT],
    service_worker: worker,
    type: "module",
  };
  if (next.action) next.action.default_area = "navbar";
  if (next.commands?._execute_action) {
    const suggested = next.commands._execute_action.suggested_key;
    delete next.commands._execute_action;
    // Firefox toggles a sidebar_action from this reserved command. It does not use _execute_action.
    next.commands._execute_sidebar_action = {
      description: next.action?.default_title || next.name,
      ...(suggested ? { suggested_key: suggested } : {}),
    };
  }
  const sidebarAction = {
    default_panel: panel,
    open_at_install: false,
  };
  const sidebarTitle = next.action?.default_title || next.name;
  const sidebarIcon = next.action?.default_icon || next.icons;
  if (sidebarTitle) sidebarAction.default_title = sidebarTitle;
  if (sidebarIcon) sidebarAction.default_icon = sidebarIcon;
  next.sidebar_action = sidebarAction;
  next.browser_specific_settings = {
    gecko: {
      id: FIREFOX_GECKO_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      data_collection_permissions: {
        required: [...FIREFOX_DATA_COLLECTION.required],
        optional: [...FIREFOX_DATA_COLLECTION.optional],
      },
    },
  };
  return next;
}

/** Point the sidebar document at the Firefox boot module and the sidebar skin. The Chrome file is unchanged. */
export function rewriteFirefoxSidepanelHtml(html) {
  let next = String(html).replace(/(<script\b[^>]*\bsrc=["'])sidepanel\.js(["'])/i, `$1${FIREFOX_PANEL_SCRIPT.split("/").pop()}$2`);
  if (!next.includes("firefox-sidebar.css")) {
    const link = `  <link rel="stylesheet" href="firefox-sidebar.css">\n`;
    next = next.includes("</head>") ? next.replace("</head>", `${link}</head>`) : `${next}\n${link}`;
  }
  return next;
}

/** System colors and the Firefox UI font. Loaded only after the shared sidebar skin. */
export function firefoxSidebarCss() {
  return `/* Firefox sidebar skin. The shared theme still draws the controls. */
:root {
  color-scheme: light dark;
  --font-sans: system-ui, sans-serif;
  --bg-primary: Canvas;
  --bg-secondary: Canvas;
  --bg-tertiary: ButtonFace;
  --bg-elevated: ButtonFace;
  --text-primary: CanvasText;
  --text-secondary: CanvasText;
  --border: color-mix(in srgb, CanvasText 24%, transparent);
  --control-surface: ButtonFace;
  --control-text: ButtonText;
  --control-primary-surface: AccentColor;
  --control-primary-text: AccentColorText;
  --field-surface: Field;
  accent-color: AccentColor;
}

html,
body {
  font: message-box;
  background: Canvas;
  color: CanvasText;
}
`;
}

/** Rewrite catalog sentences that name Chrome, its URLs, or a side panel. */
export function firefoxUserText(text) {
  let next = String(text);
  next = next.replaceAll("ChromeOS", "\u0000OS");
  next = next.replaceAll("chrome-extension://", "moz-extension://");
  next = next.replaceAll("chrome://extensions/shortcuts", "about:addons");
  next = next.replaceAll("chrome://extensions", "about:addons");
  next = next.replaceAll("chrome://downloads", "about:downloads");
  next = next.replaceAll("chrome://", "about:");
  next = next.replaceAll("Chrome Web Store", "Add-ons Manager");
  next = next.replaceAll("Android Chrome", "an Android layout");
  next = next.replaceAll("Chrome DevTools MCP", "a browser snapshot");
  next = next.replaceAll(/\bChrome\b/g, "Firefox");
  next = next.replaceAll("\u0000OS", "ChromeOS");
  next = next.replaceAll("the extension store", "Add-ons");
  next = next.replaceAll("Side Panel", "Sidebar");
  next = next.replaceAll("side panel", "sidebar");
  return next;
}

export function firefoxFileAccessMessageId() {
  return chromeMessageId(FILE_ACCESS_MESSAGE_KEY);
}

export function rewriteFirefoxMessages(locale, messages) {
  const id = firefoxFileAccessMessageId();
  if (!messages || typeof messages !== "object" || Array.isArray(messages)) return messages;
  // English and zh-CN keep the Chrome sentence in the shared bundle. Their catalogs omit the key,
  // so the Firefox package adds it and the loader prefers the catalog over that sentence.
  let next = messages;
  if (messages[id] || messages.qz_language) {
    const text = FILE_ACCESS_TEXT[locale] || FILE_ACCESS_TEXT.en;
    next = { ...messages, [id]: { message: text } };
  }
  let changed = next !== messages;
  const rewritten = { ...next };
  for (const [key, value] of Object.entries(rewritten)) {
    if (key === "qz_language" || key === HISTORICAL_LABELS_MESSAGE_ID) continue;
    const text = decodeChromeMessage(value);
    if (text === undefined) continue;
    const updated = firefoxUserText(text);
    if (updated === text) continue;
    const manifestMessage = !key.startsWith("qz_");
    rewritten[key] = encodeChromeMessage(updated, { substitutions: !manifestMessage });
    changed = true;
  }
  return changed ? rewritten : messages;
}

/** Write the Firefox-only sidebar skin next to the rewritten panel document. */
export async function writeFirefoxSidebarSkin(root) {
  const path = resolve(root, FIREFOX_SIDEBAR_STYLESHEET);
  await writeFile(path, firefoxSidebarCss());
}

/** Rewrite generated locale catalogs in a Firefox build output. */
export async function rewriteFirefoxLocaleFiles(root) {
  const locales = resolve(root, "_locales");
  let names = [];
  try { names = await readdir(locales); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const locale of names) {
    const path = resolve(locales, locale, "messages.json");
    let messages;
    try { messages = JSON.parse(await readFile(path, "utf8")); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const rewritten = rewriteFirefoxMessages(locale, messages);
    if (rewritten === messages) continue;
    await writeFile(path, `${JSON.stringify(rewritten, null, 2)}\n`);
  }
}
