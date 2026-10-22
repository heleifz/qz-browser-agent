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

function bindSessions() {
  for (const host of document.querySelectorAll("qz-session-view")) {
    if (host.shadowRoot) mountSessionView(host.shadowRoot);
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
  if (label) button.textContent = label;
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
