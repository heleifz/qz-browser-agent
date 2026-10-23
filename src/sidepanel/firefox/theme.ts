/** Read Firefox theme colors into the sidebar. This module never calls theme.update. */

export const FIREFOX_THEME_COLOR_PROPERTIES: readonly (readonly [string, string])[] = [
  ["frame", "--qz-ff-frame"],
  ["toolbar", "--qz-ff-toolbar"],
  ["toolbar_text", "--qz-ff-toolbar-text"],
  ["toolbar_field", "--qz-ff-toolbar-field"],
  ["toolbar_field_text", "--qz-ff-toolbar-field-text"],
  ["popup", "--qz-ff-popup"],
  ["popup_text", "--qz-ff-popup-text"],
  ["popup_border", "--qz-ff-popup-border"],
  ["accentcolor", "--qz-ff-accent"],
];

const DERIVED_PROPERTIES = ["--qz-ff-accent-text", "--qz-ff-button", "--qz-ff-button-text"];

interface ThemeStyle {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

interface ThemeUpdate {
  theme?: unknown;
  windowId?: number;
}

interface FirefoxThemeApi {
  getCurrent(windowId?: number): Promise<unknown> | unknown;
  onUpdated: { addListener(listener: (update: ThemeUpdate) => void): void };
}

interface FirefoxWindowApi {
  getCurrent(): Promise<{ id?: number } | undefined> | { id?: number } | undefined;
}

export interface FirefoxThemeChrome {
  theme?: FirefoxThemeApi;
  windows?: FirefoxWindowApi;
}

/** Accept a theme color string or the schema's RGB array. Reject anything that is not a color. */
export function firefoxThemeColor(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || text.length > 80 || /[;{}]|url\s*\(/i.test(text)) return undefined;
    if (/^#[0-9a-f]{3,8}$/i.test(text)) return text;
    if (/^(?:rgb|hsl)a?\([^)]+\)$/i.test(text)) return text;
    if (/^[a-z]{3,20}$/i.test(text)) return text;
    return undefined;
  }
  if (!Array.isArray(value)) return undefined;
  if (value.length === 3 && value.every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    return `rgb(${value[0]}, ${value[1]}, ${value[2]})`;
  }
  if (value.length === 4 && value.slice(0, 3).every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255) && typeof value[3] === "number" && value[3] >= 0 && value[3] <= 1) {
    return `rgba(${value[0]}, ${value[1]}, ${value[2]}, ${value[3]})`;
  }
  return undefined;
}

function themeColors(theme: unknown): Record<string, unknown> | undefined {
  if (!theme || typeof theme !== "object") return undefined;
  const record = theme as { colors?: unknown; theme?: { colors?: unknown } };
  const colors = record.colors ?? record.theme?.colors;
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return undefined;
  if (!Object.keys(colors).length) return undefined;
  return colors as Record<string, unknown>;
}

function linearChannel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function accentChannels(color: string): [number, number, number] | undefined {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map(digit => digit + digit).join("") : hex[1];
    return [
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    ];
  }
  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (!rgb) return undefined;
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/** Dark ink on a light accent, light ink on a dark accent. Other color forms keep AccentColorText. */
function accentInk(color: string): string | undefined {
  const rgb = accentChannels(color);
  if (!rgb) return undefined;
  const luminance = 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2]);
  return luminance > 0.45 ? "#15141a" : "#fbfbfe";
}

/** Copy a theme palette onto the sidebar root. An empty palette removes the overrides. */
export function applyFirefoxTheme(root: { style: ThemeStyle }, theme: unknown): boolean {
  const colors = themeColors(theme);
  let applied = false;
  for (const [key, property] of FIREFOX_THEME_COLOR_PROPERTIES) {
    const value = colors ? firefoxThemeColor(colors[key]) : undefined;
    if (value) {
      root.style.setProperty(property, value);
      applied = true;
    } else root.style.removeProperty(property);
  }
  const toolbar = colors ? firefoxThemeColor(colors.toolbar) : undefined;
  const toolbarText = colors ? firefoxThemeColor(colors.toolbar_text) : undefined;
  const accent = colors ? firefoxThemeColor(colors.accentcolor) : undefined;
  if (toolbar) root.style.setProperty("--qz-ff-button", toolbar);
  else root.style.removeProperty("--qz-ff-button");
  if (toolbarText) root.style.setProperty("--qz-ff-button-text", toolbarText);
  else root.style.removeProperty("--qz-ff-button-text");
  const ink = accent ? accentInk(accent) : undefined;
  if (ink) root.style.setProperty("--qz-ff-accent-text", ink);
  else root.style.removeProperty("--qz-ff-accent-text");
  return applied;
}

/**
 * Follow the sidebar window's theme. Built-in themes often return no colors;
 * the stylesheet's system colors stay in that case.
 */
export function installFirefoxTheme(chromeApi: FirefoxThemeChrome, root: { style: ThemeStyle }): void {
  const theme = chromeApi.theme;
  if (!theme || typeof theme.getCurrent !== "function" || typeof theme.onUpdated?.addListener !== "function") return;
  let windowId: number | undefined;
  let updates = 0;
  theme.onUpdated.addListener(update => {
    const target = update?.windowId;
    if (target != null && (windowId == null || target !== windowId)) return;
    updates += 1;
    applyFirefoxTheme(root, update?.theme);
  });
  const readWindow = chromeApi.windows?.getCurrent;
  const started = updates;
  const ready = typeof readWindow === "function"
    ? Promise.resolve(readWindow()).then(win => {
      if (typeof win?.id === "number") windowId = win.id;
      return theme.getCurrent(windowId);
    }, () => theme.getCurrent())
    : Promise.resolve(theme.getCurrent());
  ready.then(current => {
    if (updates === started) applyFirefoxTheme(root, current);
  }, () => {
    if (updates === started) applyFirefoxTheme(root, undefined);
  });
}

export const FIREFOX_THEME_DERIVED_PROPERTIES = DERIVED_PROPERTIES;
