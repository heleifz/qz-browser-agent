/**
 * Read the window theme into the sidebar the way Firefox themes its own sidebar panels:
 * the sidebar keys recolor the surface, text, border, and selection; fields and popups follow
 * their toolbar_field and popup keys. Themes without sidebar keys leave the system colors.
 * The resolved colors then yield a primary fill, accent ink, and text tiers that keep 4.5:1.
 * This module never calls theme.update.
 */

/** Theme key, custom property, and whether the value is painted opaque like Firefox's sidebar. */
export const FIREFOX_THEME_COLOR_PROPERTIES: readonly (readonly [string, string, boolean])[] = [
  ["sidebar", "--qz-ff-sidebar", true],
  ["sidebar_text", "--qz-ff-sidebar-text", true],
  ["sidebar_border", "--qz-ff-sidebar-border", false],
  ["sidebar_highlight", "--qz-ff-accent", true],
  ["sidebar_highlight_text", "--qz-ff-accent-text", true],
  ["focus_outline", "--qz-ff-focus", false],
  ["toolbar_field", "--qz-ff-field", false],
  ["toolbar_field_text", "--qz-ff-field-text", true],
  ["toolbar_field_border", "--qz-ff-field-border", false],
  ["popup", "--qz-ff-popup", true],
  ["popup_text", "--qz-ff-popup-text", true],
  ["popup_border", "--qz-ff-popup-border", false],
];

/** A surface key without its text key gets the more legible of Firefox's two inks. */
const INK_PAIRS: readonly (readonly [string, string, string])[] = [
  ["sidebar_highlight", "sidebar_highlight_text", "--qz-ff-accent-text"],
  ["toolbar_field", "toolbar_field_text", "--qz-ff-field-text"],
  ["popup", "popup_text", "--qz-ff-popup-text"],
];

const LIGHT_INK = "#fbfbfe";
const DARK_INK = "#15141a";

interface ThemeStyle {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
}

interface AccentRoot {
  style: ThemeStyle;
  ownerDocument?: {
    defaultView: AccentView | null;
    createElement(tag: "span"): { style: { cssText: string; color: string }; remove(): void };
  } | null;
  appendChild?(node: unknown): unknown;
}

interface AccentView {
  getComputedStyle(element: unknown): { color: string; getPropertyValue(name: string): string };
  matchMedia?(query: string): { addEventListener?(type: "change", listener: () => void): void } | null;
  addEventListener?(type: "load" | "focus", listener: () => void, options?: { once?: boolean }): void;
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

type Rgba = readonly [number, number, number, number];

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

/** Parse hex, rgb(), hsl(), and computed color(srgb) into sRGB channels. Named colors stay unparsed. */
export function parseFirefoxThemeColor(color: string): Rgba | undefined {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color);
  if (hex) {
    const digits = hex[1].length <= 4 ? hex[1].split("").map(digit => digit + digit).join("") : hex[1];
    const channel = (index: number) => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
    return [channel(0), channel(1), channel(2), digits.length === 8 ? channel(3) / 255 : 1];
  }
  const srgb = /^color\(\s*srgb\s+([^)]*)\)$/i.exec(color);
  if (srgb) {
    const parts = srgb[1].split(/\s*\/\s*|\s+/).filter(Boolean);
    const values = parts.map(part => fraction(part, 1));
    if (parts.length < 3 || parts.length > 4 || values.some(value => value === undefined)) return undefined;
    const [red, green, blue] = values.slice(0, 3).map(value => Math.round(clamp(value as number) * 255));
    return [red, green, blue, parts.length === 4 ? clamp(values[3] as number) : 1];
  }
  const fn = /^(rgb|hsl)a?\(\s*([^)]*)\)$/i.exec(color);
  if (!fn) return undefined;
  const parts = fn[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return undefined;
  const alpha = parts.length === 4 ? fraction(parts[3], 1) : 1;
  if (alpha === undefined) return undefined;
  if (fn[1].toLowerCase() === "rgb") {
    const channels = parts.slice(0, 3).map(part => fraction(part, 255));
    if (channels.some(channel => channel === undefined)) return undefined;
    const [red, green, blue] = channels.map(channel => Math.round(Math.min(1, Math.max(0, channel as number)) * 255));
    return [red, green, blue, clamp(alpha)];
  }
  const hue = Number.parseFloat(parts[0].replace(/deg$/i, ""));
  const saturation = percent(parts[1]);
  const lightness = percent(parts[2]);
  if (!Number.isFinite(hue) || saturation === undefined || lightness === undefined) return undefined;
  const [red, green, blue] = hslToRgb(hue, saturation, lightness);
  return [red, green, blue, clamp(alpha)];
}

function fraction(part: string, scale: number): number | undefined {
  if (part.endsWith("%")) return percent(part);
  const value = Number.parseFloat(part);
  return Number.isFinite(value) ? value / scale : undefined;
}

function percent(part: string): number | undefined {
  if (!part.endsWith("%")) return undefined;
  const value = Number.parseFloat(part);
  return Number.isFinite(value) ? clamp(value / 100) : undefined;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (((hue % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] = sector < 1 ? [chroma, second, 0]
    : sector < 2 ? [second, chroma, 0]
      : sector < 3 ? [0, chroma, second]
        : sector < 4 ? [0, second, chroma]
          : sector < 5 ? [second, 0, chroma]
            : [chroma, 0, second];
  const offset = lightness - chroma / 2;
  return [red, green, blue].map(channel => Math.round((channel + offset) * 255)) as [number, number, number];
}

function relativeLuminance([red, green, blue]: Rgba): number {
  const linear = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** The ink with the higher WCAG contrast on an opaque surface. */
function legibleInk(surface: Rgba): string {
  const luminance = relativeLuminance(surface);
  const light = (relativeLuminance([251, 251, 254, 1]) + 0.05) / (luminance + 0.05);
  const dark = (luminance + 0.05) / (relativeLuminance([21, 20, 26, 1]) + 0.05);
  return light >= dark ? LIGHT_INK : DARK_INK;
}

function contrast(first: Rgba, second: Rgba): number {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Mix toward black (amount > 0) or white (amount < 0) in sRGB, like color-mix(in srgb). */
function shade([red, green, blue]: Rgba, amount: number): Rgba {
  const target = amount >= 0 ? 0 : 255;
  const weight = Math.abs(amount);
  const channel = (value: number) => Math.round(value + (target - value) * weight);
  return [channel(red), channel(green), channel(blue), 1];
}

const PRIMARY_TARGET = 4.6;
const PRIMARY_HOVER = 0.12;
const PRIMARY_ACTIVE = 0.22;

export interface FirefoxPrimaryPalette { fill: Rgba; hover: Rgba; active: Rgba; ink: Rgba }

/**
 * The fill closest to the accent whose label keeps 4.5:1 at rest, hover, and active.
 * Hover and active darken the fill, so a light label is checked at rest and a dark label at active.
 */
export function firefoxPrimaryPalette(accent: Rgba, preferredInk?: Rgba): FirefoxPrimaryPalette {
  const inks: Rgba[] = [...(preferredInk ? [preferredInk] : []), [255, 255, 255, 1], [21, 20, 26, 1]];
  let best: { step: number; fill: Rgba; ink: Rgba } | undefined;
  for (const ink of inks) {
    const darkInk = relativeLuminance(ink) < relativeLuminance(accent);
    for (let step = 0; step <= 100; step += 1) {
      const fill = shade(accent, darkInk ? -step / 100 : step / 100);
      const hardest = darkInk ? shade(fill, PRIMARY_ACTIVE) : fill;
      if (contrast(ink, hardest) < PRIMARY_TARGET) continue;
      if (!best || step < best.step) best = { step, fill, ink };
      break;
    }
  }
  const { fill, ink } = best ?? { fill: shade(accent, 0.6), ink: [255, 255, 255, 1] as Rgba };
  return { fill, hover: shade(fill, PRIMARY_HOVER), active: shade(fill, PRIMARY_ACTIVE), ink };
}

/** `top` over `bottom` at `weight`, like color-mix(in srgb) or an alpha composite. */
function mix(top: Rgba, weight: number, bottom: Rgba): Rgba {
  const channel = (index: number) => Math.round(top[index] * weight + bottom[index] * (1 - weight));
  return [channel(0), channel(1), channel(2), 1];
}

/** The accent moved away from the surface until it reads as text on every ground. */
export function firefoxAccentInk(accent: Rgba, grounds: readonly Rgba[]): Rgba {
  const toward = relativeLuminance(grounds[0]) > 0.18 ? 1 : -1;
  for (let step = 0; step <= 100; step += 1) {
    const ink = shade(accent, (toward * step) / 100);
    if (grounds.every(ground => contrast(ink, ground) >= PRIMARY_TARGET)) return ink;
  }
  return toward > 0 ? [0, 0, 0, 1] : [255, 255, 255, 1];
}

type TierSource = "sidebar" | "popup" | "field";

/**
 * Neutral text tiers: the stylesheet's share of the text over its surface, and the share of
 * the text in the darkest fill the tier sits on. The stylesheet declares the same shares.
 */
export const FIREFOX_TEXT_TIERS: readonly (readonly [string, TierSource, number, number])[] = [
  ["--qz-ff-text-deemphasized", "sidebar", 0.72, 0.14],
  ["--qz-ff-text-muted", "sidebar", 0.6, 0.12],
  ["--qz-ff-popup-text-deemphasized", "popup", 0.72, 0.06],
  ["--qz-ff-popup-text-muted", "popup", 0.6, 0.06],
  ["--qz-ff-field-text-deemphasized", "field", 0.72, 0.14],
  ["--qz-ff-field-placeholder", "field", 0.6, 0],
];

/** The smallest share of `text` at or above `share` that reads on the surface and on its fill. */
export function firefoxTextTier(text: Rgba, surface: Rgba, share: number, fillShare: number): Rgba {
  const fill = mix(text, fillShare, surface);
  for (let step = Math.round(share * 100); step <= 100; step += 1) {
    const ink = mix(text, step / 100, surface);
    if (contrast(ink, surface) >= PRIMARY_TARGET && contrast(ink, fill) >= PRIMARY_TARGET) return ink;
  }
  return mix(text, 1, surface);
}

const PALETTE_SOURCES = [
  "--qz-ff-accent", "--qz-ff-accent-text", "--qz-ff-sidebar", "--qz-ff-sidebar-text",
  "--qz-ff-popup", "--qz-ff-popup-text", "--qz-ff-field", "--qz-ff-field-text",
] as const;
const PALETTE_PROPERTIES = [
  "--qz-ff-primary", "--qz-ff-primary-hover", "--qz-ff-primary-active", "--qz-ff-primary-text", "--qz-ff-accent-ink",
  ...FIREFOX_TEXT_TIERS.map(([property]) => property),
];

function rgb([red, green, blue]: Rgba): string {
  return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * Resolve the accent, sidebar, popup, and field colors through the stylesheet, then write the
 * primary fill, accent ink, and text tiers that keep 4.5:1. Without a resolved accent and
 * sidebar the stylesheet's fallback stays.
 */
export function applyFirefoxPalette(root: AccentRoot): boolean {
  const document = root.ownerDocument;
  const view = document?.defaultView;
  if (!document || !view || typeof view.getComputedStyle !== "function" || typeof root.appendChild !== "function") return false;
  for (const property of PALETTE_PROPERTIES) root.style.removeProperty(property);
  if (!view.getComputedStyle(root).getPropertyValue("--qz-ff-accent").trim()) return false;
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden";
  root.appendChild(probe);
  const colors = {} as Record<(typeof PALETTE_SOURCES)[number], Rgba | undefined>;
  for (const name of PALETTE_SOURCES) {
    probe.style.color = `var(${name})`;
    colors[name] = parseFirefoxThemeColor(view.getComputedStyle(probe).color);
  }
  probe.remove();
  const accent = colors["--qz-ff-accent"];
  const sidebarColor = colors["--qz-ff-sidebar"];
  const sidebarText = colors["--qz-ff-sidebar-text"];
  if (!accent || !sidebarColor || !sidebarText) return false;
  const sidebar: Rgba = [sidebarColor[0], sidebarColor[1], sidebarColor[2], 1];
  const palette = firefoxPrimaryPalette(accent, colors["--qz-ff-accent-text"]);
  root.style.setProperty("--qz-ff-primary", rgb(palette.fill));
  root.style.setProperty("--qz-ff-primary-hover", rgb(palette.hover));
  root.style.setProperty("--qz-ff-primary-active", rgb(palette.active));
  root.style.setProperty("--qz-ff-primary-text", rgb(palette.ink));
  root.style.setProperty("--qz-ff-accent-ink", rgb(firefoxAccentInk(accent, [sidebar, mix(sidebarText, 0.05, sidebar)])));
  const over = (color: Rgba | undefined) => (color ? mix(color, color[3], sidebar) : undefined);
  const pairs: Record<TierSource, [Rgba | undefined, Rgba | undefined]> = {
    sidebar: [sidebarText, sidebar],
    popup: [colors["--qz-ff-popup-text"], over(colors["--qz-ff-popup"])],
    field: [colors["--qz-ff-field-text"], over(colors["--qz-ff-field"])],
  };
  for (const [property, source, share, fillShare] of FIREFOX_TEXT_TIERS) {
    const [text, surface] = pairs[source];
    if (text && surface) root.style.setProperty(property, rgb(firefoxTextTier(text, surface, share, fillShare)));
  }
  return true;
}

/** Recompute the palette when the stylesheet loads, the color scheme flips, or the window regains focus. */
function installFirefoxPalette(root: AccentRoot): () => void {
  const view = root.ownerDocument?.defaultView;
  const refresh = () => { applyFirefoxPalette(root); };
  if (!view) return refresh;
  if (!applyFirefoxPalette(root)) view.addEventListener?.("load", refresh, { once: true });
  view.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", refresh);
  view.addEventListener?.("focus", refresh);
  return refresh;
}

/** Firefox's lwt-sidebar test: text at or below 110 perceived brightness is dark text on a light sidebar. */
function isDarkText([red, green, blue]: Rgba): boolean {
  return 0.2125 * red + 0.7154 * green + 0.0721 * blue <= 110;
}

function themeColors(theme: unknown): Record<string, unknown> | undefined {
  if (!theme || typeof theme !== "object") return undefined;
  const record = theme as { colors?: unknown; theme?: { colors?: unknown } };
  const colors = record.colors ?? record.theme?.colors;
  if (!colors || typeof colors !== "object" || Array.isArray(colors)) return undefined;
  if (!Object.keys(colors).length) return undefined;
  return colors as Record<string, unknown>;
}

/** Copy a theme palette onto the sidebar root. A palette without these keys removes the overrides. */
export function applyFirefoxTheme(root: { style: ThemeStyle }, theme: unknown): boolean {
  const colors = themeColors(theme);
  const read = (key: string) => (colors ? firefoxThemeColor(colors[key]) : undefined);
  let applied = false;
  for (const [key, property, opaque] of FIREFOX_THEME_COLOR_PROPERTIES) {
    const value = read(key);
    if (!value) {
      root.style.removeProperty(property);
      continue;
    }
    const rgba = opaque ? parseFirefoxThemeColor(value) : undefined;
    root.style.setProperty(property, rgba ? `rgb(${rgba[0]}, ${rgba[1]}, ${rgba[2]})` : value);
    applied = true;
  }
  for (const [surfaceKey, textKey, property] of INK_PAIRS) {
    const surface = read(surfaceKey);
    if (!surface || read(textKey)) continue;
    const rgba = parseFirefoxThemeColor(surface);
    if (rgba) root.style.setProperty(property, legibleInk(rgba));
  }
  const text = read("sidebar_text");
  const background = read("sidebar");
  const textRgba = text ? parseFirefoxThemeColor(text) : undefined;
  const backgroundRgba = !text && background ? parseFirefoxThemeColor(background) : undefined;
  const scheme = textRgba ? (isDarkText(textRgba) ? "light" : "dark")
    : backgroundRgba ? (isDarkText(backgroundRgba) ? "dark" : "light")
      : undefined;
  if (scheme) root.style.setProperty("color-scheme", scheme);
  else root.style.removeProperty("color-scheme");
  return applied;
}

/**
 * Follow the sidebar window's theme. Built-in themes often return no colors;
 * the stylesheet's system colors stay in that case.
 */
export function installFirefoxTheme(chromeApi: FirefoxThemeChrome, root: AccentRoot): void {
  const refreshPalette = installFirefoxPalette(root);
  const theme = chromeApi.theme;
  if (!theme || typeof theme.getCurrent !== "function" || typeof theme.onUpdated?.addListener !== "function") return;
  const apply = (value: unknown) => {
    applyFirefoxTheme(root, value);
    refreshPalette();
  };
  let windowId: number | undefined;
  let updates = 0;
  theme.onUpdated.addListener(update => {
    const target = update?.windowId;
    if (target != null && (windowId == null || target !== windowId)) return;
    updates += 1;
    apply(update?.theme);
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
    if (updates === started) apply(current);
  }, () => {
    if (updates === started) apply(undefined);
  });
}
