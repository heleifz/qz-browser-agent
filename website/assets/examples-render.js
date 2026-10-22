// Detail-page media, the export transcript, and the document title.
import { mountSessionView } from "./examples/session-view.js";

const catalog = window.QZ_EXAMPLES;
const slug = document.documentElement.dataset.example;
const item = catalog?.items?.find((entry) => entry.slug === slug);
const siteRoot = document.documentElement.dataset.siteRoot || "../../";

function siteUrl(relativeToSite) {
  return new URL(relativeToSite, new URL(siteRoot, document.baseURI)).href;
}

function syncTitle() {
  const heading = document.querySelector(".example-page h1");
  const text = heading?.textContent?.replace(/\s+/g, " ").trim();
  if (text) document.title = `${text} — qz`;
}

function bindMedia() {
  if (!item) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const loop = document.querySelector(".example-loop");
  if (loop instanceof HTMLVideoElement && item.media.kind === "loop" && !reduced) {
    loop.src = siteUrl(item.media.src);
    loop.play().catch(() => { /* The poster stays if autoplay is blocked. */ });
  }
  const play = document.querySelector(".example-play");
  const clip = document.querySelector(".example-player video:not(.example-loop)");
  if (!(play instanceof HTMLButtonElement) || !(clip instanceof HTMLVideoElement) || item.media.kind !== "click") return;
  play.addEventListener("click", () => {
    if (!clip.getAttribute("src")) clip.src = siteUrl(item.media.src);
    clip.hidden = false;
    play.hidden = true;
    clip.play().catch(() => { /* Native controls remain if playback is blocked. */ });
  });
}

function adoptSessionOverrides(root) {
  if (root.querySelector('link[href*="session-view-overrides.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = siteUrl("assets/examples/session-view-overrides.css");
  const current = [...root.querySelectorAll("link")].find((node) => node.getAttribute("href")?.includes("session-view.css"));
  if (current) current.after(link);
  else root.prepend(link);
}

function cellText(cell) {
  return (cell.textContent || "").replace(/\s+/g, " ").trim();
}

function keepCellOnOneLine(text) {
  if (!text || (text.length <= 14 && !/\s/.test(text))) return true;
  if (text.length > 24) return false;
  const time = /^(?:\d{1,2}:\d{2})(?:\s*[-–—~～至到]\s*\d{1,2}:\d{2})?$/;
  const date = /^(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[/.月]\d{1,2}日?)(?:\s*[-–—~～至到]\s*(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}[/.月]\d{1,2}日?))?$/;
  const price = /^(?:免费|免票|[—–-]|[$¥￥€£]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:元|美元|人民币))$/;
  return time.test(text) || date.test(text) || price.test(text);
}

function markTableCells(table) {
  for (const cell of table.querySelectorAll("th, td")) {
    cell.classList.toggle("example-cell-nowrap", keepCellOnOneLine(cellText(cell)));
  }
}

function prepareTable(table) {
  const parent = table.parentElement;
  if (!parent) return;
  if (parent.classList.contains("example-table-scroll") || parent.classList.contains("tool-data-table-wrap")) {
    markTableCells(table);
    return;
  }
  const scroller = document.createElement("div");
  scroller.className = "example-table-scroll";
  parent.insertBefore(scroller, table);
  scroller.append(table);
  markTableCells(table);
}

function prepareTables(root) {
  adoptSessionOverrides(root);
  root.querySelectorAll("table").forEach(prepareTable);
  root.querySelectorAll("template").forEach((template) => {
    template.content.querySelectorAll("table").forEach(prepareTable);
  });
}

function bindSessions() {
  for (const host of document.querySelectorAll("qz-session-view")) {
    if (!host.shadowRoot) continue;
    mountSessionView(host.shadowRoot);
    prepareTables(host.shadowRoot);
  }
}

function importLabel() {
  const lang = document.documentElement.lang === "zh-CN" ? "zh-CN" : "en";
  return catalog?.copy?.[lang]?.download || "";
}

function labelImportButton() {
  const button = document.querySelector("#qingzhou-session-cta");
  if (!(button instanceof HTMLButtonElement) || !button.hasAttribute("data-qingzhou-session-import")) return;
  if (button.disabled || button.getAttribute("aria-busy") === "true") return;
  const label = importLabel();
  if (label && button.textContent !== label) button.textContent = label;
}

function bindImport() {
  const actions = document.querySelector(".example-actions");
  if (!actions) return;
  const sync = () => {
    actions.classList.toggle("is-live", Boolean(actions.querySelector("[data-qingzhou-session-import]")));
    labelImportButton();
  };
  sync();
  new MutationObserver(sync).observe(actions, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
}

bindMedia();
bindSessions();
bindImport();
syncTitle();
document.querySelector(".language")?.addEventListener("click", () => {
  syncTitle();
  labelImportButton();
});
window.addEventListener("popstate", () => {
  syncTitle();
  labelImportButton();
});
