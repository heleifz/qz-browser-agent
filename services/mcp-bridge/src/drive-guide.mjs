import { readFileSync } from "node:fs";

const MARKER_END = "<!-- qz-drive-guide:end -->";
const candidates = [
  new URL("./qz-drive-SKILL.md", import.meta.url),
  new URL("../../../skills/qz-drive/SKILL.md", import.meta.url),
];

let cached = "";

function loadGuideSource() {
  if (cached) return cached;
  const errors = [];
  for (const url of candidates) {
    try {
      cached = readFileSync(url, "utf8");
      return cached;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      errors.push(url.pathname);
    }
  }
  throw new Error(`qz-drive guide is missing. Looked in ${errors.join(", ")}.`);
}

function languageTag(value) {
  return String(value || "").trim().toLowerCase().replaceAll("_", "-");
}

/** One language slice of skills/qz-drive/SKILL.md. The package copy is a packed mirror, not a second draft. */
export function driveGuide({ explicit = "", env = process.env } = {}) {
  const requested = languageTag(explicit || env.QZ_GUIDE_LANG || env.LANG || "");
  const key = requested.startsWith("zh") ? "zh-CN" : "en";
  const text = loadGuideSource();
  const marker = `<!-- qz-drive-guide:${key} -->`;
  const start = text.indexOf(marker);
  const end = text.indexOf(MARKER_END, start + marker.length);
  if (start < 0 || end < 0) throw new Error(`qz-drive guide is missing the ${key} section.`);
  return `${text.slice(start + marker.length, end).trim()}\n`;
}

export function resetDriveGuideCache() {
  cached = "";
}
