// Detail-page media, session tabs, and the document title. Conversation HTML is already in the page.
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

function applySteps() {
  const chinese = document.documentElement.lang === "zh-CN";
  for (const node of document.querySelectorAll("[data-steps]")) {
    const count = node.dataset.steps;
    node.textContent = chinese ? `${count} 个步骤` : `${count} steps`;
  }
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

function bindTabs() {
  const download = document.querySelector("#example-download");
  const tabs = [...document.querySelectorAll(".example-switch [data-pane]")];
  const panes = [...document.querySelectorAll(".example-log")];
  if (!(download instanceof HTMLAnchorElement) || !tabs.length) return;
  const select = (tab) => {
    const pane = document.getElementById(tab.dataset.pane);
    for (const button of tabs) button.setAttribute("aria-selected", button === tab ? "true" : "false");
    for (const itemPane of panes) itemPane.hidden = itemPane !== pane;
    if (pane?.dataset.file) {
      download.href = pane.dataset.file;
      download.setAttribute("download", pane.dataset.download || "");
    }
  };
  for (const tab of tabs) tab.addEventListener("click", () => select(tab));
}

bindMedia();
bindTabs();
syncTitle();
applySteps();
document.querySelector(".language")?.addEventListener("click", () => {
  syncTitle();
  applySteps();
});
window.addEventListener("popstate", () => {
  syncTitle();
  applySteps();
});
