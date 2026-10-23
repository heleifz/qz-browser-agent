// Firefox rejects permission names it does not implement. This rewrites a built copy.
// src/manifest.json and the Chrome output stay on the Chrome manifest.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromeMessageId, decodeChromeMessage, encodeChromeMessage, HISTORICAL_LABELS_MESSAGE_ID } from "../src/shared/i18n/definition.ts";
import { readTranslationVariants } from "./capability-locales.mjs";

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

const FIREFOX_SYSTEM_COLOR_VARS = `
  --qz-ff-frame: Canvas;
  --qz-ff-toolbar: Canvas;
  --qz-ff-toolbar-text: CanvasText;
  --qz-ff-toolbar-field: Field;
  --qz-ff-toolbar-field-text: FieldText;
  --qz-ff-popup: Canvas;
  --qz-ff-popup-text: CanvasText;
  --qz-ff-popup-border: color-mix(in srgb, CanvasText 16%, transparent);
  --qz-ff-accent: AccentColor;
  --qz-ff-accent-text: AccentColorText;
  --qz-ff-button: ButtonFace;
  --qz-ff-button-text: ButtonText;
  --qz-ff-muted: GrayText;
  --qz-ff-highlight: Highlight;`;

/**
 * Firefox-only sidebar skin. Loaded after the shared theme and unlayered, so it
 * repaints tokens without changing the shared Chrome stylesheet.
 *
 * The base layer is color-scheme plus the system colors, repeated inside
 * prefers-color-scheme so those colors are recomputed for light, dark, and
 * system. theme.getCurrent() copies a window theme onto the same --qz-ff-*
 * variables; an empty built-in theme leaves this base in place.
 * Toolbar icon buttons stay transparent until hover (currentColor 17%, active
 * 30%). Filled buttons use ButtonFace until a toolbar color replaces it.
 * Focus is a 2px accent outline. Readable secondary text is a CanvasText mix
 * that stays at least 4.5:1 on light Canvas and on the dark sidebar. GrayText
 * is only a placeholder.
 */
export function firefoxSidebarCss() {
  const scheme = (name, green, orange, red) => `@media (prefers-color-scheme: ${name}) {
  :root {${FIREFOX_SYSTEM_COLOR_VARS}
    --green: ${green};
    --orange: ${orange};
    --red: ${red};
  }
}
`;
  return `/* Firefox sidebar skin. The shared theme still draws the controls. */
:root {
  color-scheme: light dark;
  accent-color: var(--qz-ff-accent);
  --font-sans: system-ui, sans-serif;
  --font-mono: ui-monospace, monospace;
${FIREFOX_SYSTEM_COLOR_VARS}

  --bg-primary: var(--qz-ff-toolbar);
  --bg-secondary: var(--qz-ff-frame);
  --bg-tertiary: color-mix(in srgb, var(--qz-ff-toolbar-text) 7%, var(--qz-ff-toolbar));
  --bg-elevated: color-mix(in srgb, var(--qz-ff-popup-text) 8%, var(--qz-ff-popup));
  --bg-glass: var(--qz-ff-toolbar);
  --text-primary: var(--qz-ff-toolbar-text);
  --text-secondary: color-mix(in srgb, var(--qz-ff-toolbar-text) 78%, var(--qz-ff-toolbar));
  --text-muted: color-mix(in srgb, var(--qz-ff-toolbar-text) 62%, var(--qz-ff-toolbar));
  --text-faint: var(--text-muted);
  --border: var(--qz-ff-popup-border);
  --border-focus: var(--qz-ff-accent);

  --accent: var(--qz-ff-accent);
  --accent-strong: var(--qz-ff-accent);
  --accent-glow: color-mix(in srgb, var(--qz-ff-accent) 18%, transparent);
  --accent-subtle: color-mix(in srgb, var(--qz-ff-accent) 10%, transparent);
  --control-track: color-mix(in srgb, var(--qz-ff-toolbar-text) 7%, var(--qz-ff-toolbar));
  --control-hover-fill: color-mix(in srgb, currentColor 17%, transparent);
  --control-active-fill: color-mix(in srgb, currentColor 30%, transparent);
  --control-surface: transparent;
  --control-surface-hover: var(--control-hover-fill);
  --control-surface-pressed: var(--control-active-fill);
  --control-text: var(--qz-ff-toolbar-text);
  --control-text-hover: var(--qz-ff-toolbar-text);
  --control-border: var(--qz-ff-popup-border);
  --control-border-hover: color-mix(in srgb, var(--qz-ff-toolbar-text) 28%, transparent);
  --control-primary-surface: var(--qz-ff-accent);
  --control-primary-surface-hover: color-mix(in srgb, var(--qz-ff-accent) 86%, var(--qz-ff-toolbar));
  --control-primary-text: var(--qz-ff-accent-text);
  --control-focus-ring: 0 0 0 2px var(--qz-ff-accent);
  --control-radius: 4px;
  --field-surface: var(--qz-ff-toolbar-field);
  --field-text: var(--qz-ff-toolbar-field-text);
  --field-border: var(--qz-ff-popup-border);
  --field-border-hover: color-mix(in srgb, var(--qz-ff-toolbar-text) 28%, transparent);
  --field-border-focus: var(--qz-ff-accent);
  --field-placeholder: var(--qz-ff-muted);
  --field-focus-ring: var(--control-focus-ring);

  --user-bubble-bg: color-mix(in srgb, var(--qz-ff-toolbar-text) 7%, var(--qz-ff-toolbar));
  --user-bubble-text: var(--qz-ff-toolbar-text);
  --block-fill: color-mix(in srgb, var(--qz-ff-popup-text) 5%, var(--qz-ff-popup));
  --block-fill-hover: color-mix(in srgb, var(--qz-ff-popup-text) 9%, var(--qz-ff-popup));
  --block-radius: 4px;
  --code-bg: color-mix(in srgb, var(--qz-ff-toolbar-text) 6%, var(--qz-ff-toolbar));
  --code-inline-bg: color-mix(in srgb, var(--qz-ff-toolbar-text) 8%, var(--qz-ff-toolbar));
  --code-border: color-mix(in srgb, var(--qz-ff-accent) 28%, transparent);
  --modal-backdrop: color-mix(in srgb, var(--qz-ff-toolbar-text) 32%, transparent);
  --modal-surface: var(--qz-ff-popup);
  --modal-muted-surface: color-mix(in srgb, var(--qz-ff-popup-text) 6%, var(--qz-ff-popup));
  --modal-card-surface: var(--qz-ff-popup);
  --modal-card-border: var(--qz-ff-popup-border);
  --modal-card-shadow: none;
  --surface-porcelain: var(--qz-ff-popup);
  --surface-porcelain-border: var(--qz-ff-popup-border);
  --surface-porcelain-shadow: none;
  --popover-surface: var(--qz-ff-popup);
  --popover-border: var(--qz-ff-popup-border);
  --shadow-sm: none;
  --shadow-md: 0 2px 6px color-mix(in srgb, var(--qz-ff-toolbar-text) 18%, transparent);
  --shadow-lg: 0 8px 24px color-mix(in srgb, var(--qz-ff-toolbar-text) 22%, transparent);
  --green: #06674b;
  --orange: #7a3e00;
  --red: #c50042;
  --danger-subtle: color-mix(in srgb, var(--red) 12%, transparent);
  --success-border: color-mix(in srgb, var(--green) 45%, transparent);
  --send-standby-bg: color-mix(in srgb, var(--qz-ff-toolbar-text) 14%, var(--qz-ff-toolbar));
  --send-standby-mark: color-mix(in srgb, var(--qz-ff-toolbar-text) 62%, var(--qz-ff-toolbar));
  --qz-scrollbar-size: 8px;
  --qz-scrollbar-thumb: color-mix(in srgb, var(--qz-ff-toolbar-text) 35%, transparent);
  --radius-sm: 4px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --radius-xl: 8px;
}

${scheme("light", "#06674b", "#7a3e00", "#c50042")}${scheme("dark", "#11ae84", "#ffb54c", "#ff848b")}
html,
body,
#app {
  font-family: system-ui, sans-serif;
  font-size: 13px;
  background: var(--qz-ff-toolbar);
  color: var(--qz-ff-toolbar-text);
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--qz-ff-toolbar-text) 35%, transparent) transparent;
}

::selection {
  background: var(--qz-ff-highlight);
}

#header {
  background: var(--qz-ff-frame);
  color: var(--qz-ff-toolbar-text);
  border-color: var(--qz-ff-popup-border);
  box-shadow: none;
}

.session-title-bar,
.chat-dock {
  background: var(--qz-ff-toolbar);
  border-color: var(--qz-ff-popup-border);
  box-shadow: none;
}

.header-tabs,
.settings-tabs {
  border-color: transparent;
  border-radius: 4px;
  box-shadow: none;
}

.header-tabs {
  background: color-mix(in srgb, var(--qz-ff-toolbar-text) 7%, var(--qz-ff-toolbar));
}

.settings-tabs {
  background: color-mix(in srgb, var(--qz-ff-popup-text) 7%, var(--qz-ff-popup));
}

.tab-btn,
.settings-tabs .qz-segment-item {
  border-radius: 4px;
  background: transparent;
  box-shadow: none;
}

.tab-btn {
  color: var(--qz-ff-toolbar-text);
}

.settings-tabs .qz-segment-item {
  color: var(--qz-ff-popup-text);
}

.tab-btn:hover {
  background: color-mix(in srgb, var(--qz-ff-toolbar-text) 8%, transparent);
  color: var(--qz-ff-toolbar-text);
}

.settings-tabs .qz-segment-item:hover {
  background: color-mix(in srgb, var(--qz-ff-popup-text) 8%, transparent);
  color: var(--qz-ff-popup-text);
}

.tab-btn.active {
  background: var(--qz-ff-toolbar);
  color: var(--qz-ff-toolbar-text);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--qz-ff-toolbar-text) 14%, transparent);
}

.settings-tabs .qz-segment-item[aria-selected="true"] {
  background: var(--qz-ff-popup);
  color: var(--qz-ff-popup-text);
  box-shadow: 0 0 0 1px var(--qz-ff-popup-border);
}

.qz-icon-btn,
.qz-icon-btn--secondary,
.icon-btn {
  border-color: transparent;
  background: transparent;
  border-radius: 4px;
  color: var(--qz-ff-toolbar-text);
  box-shadow: none;
}

.qz-icon-btn:not(:disabled):hover,
.qz-icon-btn--secondary:not(:disabled):hover,
.icon-btn:hover {
  border-color: transparent;
  background: color-mix(in srgb, currentColor 17%, transparent);
  color: var(--qz-ff-toolbar-text);
}

.qz-icon-btn:not(:disabled):active,
.icon-btn:active {
  background: color-mix(in srgb, currentColor 30%, transparent);
}

.qz-btn {
  border-radius: 4px;
  background: var(--qz-ff-button);
  color: var(--qz-ff-button-text);
  box-shadow: none;
}

.qz-btn--primary {
  background: var(--qz-ff-accent);
  color: var(--qz-ff-accent-text);
}

.qz-btn--ghost,
.qz-btn--inline {
  border-color: transparent;
  background: transparent;
  color: var(--qz-ff-toolbar-text);
}

.qz-btn:focus-visible,
.qz-icon-btn:focus-visible,
.tab-btn:focus-visible,
.qz-field:focus-visible,
.tool-timeline-step:focus-visible,
.input-wrapper:focus-within {
  outline: 2px solid var(--qz-ff-accent);
  outline-offset: 2px;
  box-shadow: none;
}

.qz-field,
.input-wrapper,
#input {
  border-radius: 4px;
}

.qz-field,
.input-wrapper {
  background: var(--qz-ff-toolbar-field);
  color: var(--qz-ff-toolbar-field-text);
  border-color: var(--qz-ff-popup-border);
  box-shadow: none;
}

.qz-field::placeholder,
textarea::placeholder,
input::placeholder {
  color: var(--qz-ff-muted);
}

.input-wrapper:focus-within {
  border-color: var(--qz-ff-accent);
}

.send-btn {
  background: var(--qz-ff-accent);
  color: var(--qz-ff-accent-text);
  border-radius: 4px;
}

.msg-assistant .msg-content,
.msg-user .msg-content {
  color: var(--qz-ff-toolbar-text);
}

.msg-user .msg-content {
  border-radius: 8px;
  background: var(--user-bubble-bg);
  box-shadow: none;
}

.msg-tool-timeline.tool-timeline-expanded,
.compact-node,
.tool-timeline-summary,
.settings-content {
  border-radius: 4px;
  background: var(--qz-ff-popup);
  color: var(--qz-ff-popup-text);
  border-color: var(--qz-ff-popup-border);
  box-shadow: none;
}

.tool-timeline-step,
.tool-chip,
.tool-compact-meta span,
.tool-slim-meta span {
  border-radius: 4px;
  border-color: var(--qz-ff-popup-border);
  background: transparent;
  box-shadow: none;
  color: color-mix(in srgb, var(--qz-ff-popup-text) 78%, var(--qz-ff-popup));
  font-family: system-ui, sans-serif;
}

.tool-timeline-step .mini-dot,
.compact-node-dot,
.tool-timeline-summary .dot {
  box-shadow: none;
}

.tool-timeline-step.active {
  background: color-mix(in srgb, var(--qz-ff-accent) 12%, var(--qz-ff-popup));
  border-color: color-mix(in srgb, var(--qz-ff-accent) 45%, transparent);
  color: var(--qz-ff-popup-text);
  box-shadow: none;
}

.qz-scroll,
.qz-scroll:not(.qz-scroll--native),
.qz-scroll:not(.qz-scroll--native):is(:hover, :focus-within) {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--qz-ff-toolbar-text) 35%, transparent) transparent;
}
`;
}

const FALLBACK_LOCALE_LANGUAGE = Object.freeze({
  en: "en",
  zh_CN: "zh-CN",
});

/** Rewrite catalog sentences that name Chrome, its URLs, a side panel, or chrome.debugger. */
export function firefoxUserText(text) {
  let next = String(text);
  next = next.replaceAll("ChromeOS", "\u0000OS");
  next = next.replaceAll("chrome-extension://", "moz-extension://");
  next = next.replaceAll("chrome.debugger", "debugger");
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

/**
 * English and zh-CN catalogs omit most authored sentences, so the loader falls back to the
 * shared bundle. Add the sentences whose Firefox wording differs. Other locales already ship
 * a full catalog and are rewritten in place.
 */
export function firefoxFallbackSupplements(locale, variants) {
  const language = FALLBACK_LOCALE_LANGUAGE[locale];
  if (!language || !variants) return {};
  const supplements = {};
  for (const [qualified, value] of variants) {
    if (!value || typeof value !== "object") continue;
    const authored = typeof value[language] === "string" ? value[language] : value.en;
    if (typeof authored !== "string") continue;
    const updated = firefoxUserText(authored);
    if (updated === authored) continue;
    const manifestMessage = String(qualified).startsWith("manifest.");
    const name = manifestMessage ? String(qualified).slice("manifest.".length) : chromeMessageId(qualified);
    if (!name || name === "qz_language" || name === HISTORICAL_LABELS_MESSAGE_ID) continue;
    supplements[name] = encodeChromeMessage(updated, { substitutions: !manifestMessage });
  }
  return supplements;
}

export function firefoxFileAccessMessageId() {
  return chromeMessageId(FILE_ACCESS_MESSAGE_KEY);
}

export function rewriteFirefoxMessages(locale, messages, supplements = {}) {
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
  for (const [key, value] of Object.entries(supplements || {})) {
    if (key === "qz_language" || key === HISTORICAL_LABELS_MESSAGE_ID || rewritten[key]) continue;
    rewritten[key] = value;
    changed = true;
  }
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
export async function rewriteFirefoxLocaleFiles(root, sourceDir) {
  const variants = sourceDir ? readTranslationVariants(sourceDir) : null;
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
    const supplements = variants ? firefoxFallbackSupplements(locale, variants) : {};
    const rewritten = rewriteFirefoxMessages(locale, messages, supplements);
    if (rewritten === messages) continue;
    await writeFile(path, `${JSON.stringify(rewritten, null, 2)}\n`);
  }
}
