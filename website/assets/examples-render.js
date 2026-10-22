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

function bindImport() {
  const actions = document.querySelector(".example-actions");
  if (!actions) return;
  const shortLink = actions.querySelector(".example-download-short");
  const sync = () => {
    const live = Boolean(actions.querySelector("[data-qingzhou-session-import]"));
    actions.classList.toggle("is-live", live);
    if (shortLink) shortLink.hidden = !live;
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
document.querySelector(".language")?.addEventListener("click", syncTitle);
window.addEventListener("popstate", syncTitle);
