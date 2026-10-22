// Detail pages: play catalog media, and show the exported conversation in an iframe.
const catalog = window.QZ_EXAMPLES;
const slug = document.documentElement.dataset.example;
const item = catalog?.items?.find((entry) => entry.slug === slug);
const siteRoot = document.documentElement.dataset.siteRoot || "../../";

function siteUrl(relativeToSite) {
  const root = new URL(siteRoot, document.baseURI);
  return new URL(relativeToSite, root).href;
}

const THREAD_CSS = `
html, body { height: auto !important; min-height: 100% !important; overflow: visible !important; }
.session-export-shell { width: auto !important; max-width: none !important; min-width: 100% !important; }
#messages { overflow-x: auto !important; }
#messages table, .tabulator { width: max-content !important; min-width: 100% !important; table-layout: auto !important; }
#messages th, #messages td, .tabulator-cell, .tabulator-col-title {
  min-width: 6.5rem !important;
  max-width: 16rem !important;
  width: auto !important;
  word-break: normal !important;
  overflow-wrap: break-word !important;
  white-space: normal !important;
}
.tabulator, .data-row-detail { overflow-x: auto !important; }
`;

const LAZY_SCRIPT = `(() => {
  const images = document.querySelectorAll("img[data-src]");
  const load = (img) => {
    if (!img.dataset.src) return;
    img.src = img.dataset.src;
    if (img.dataset.srcset) img.srcset = img.dataset.srcset;
    delete img.dataset.src;
    delete img.dataset.srcset;
  };
  if (!images.length) return;
  if (!("IntersectionObserver" in window)) {
    images.forEach(load);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      load(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "240px" });
  images.forEach((img) => observer.observe(img));
})();`;

function prepareDisplayHtml(html) {
  const stripped = String(html).replace(/<script\b[^>]*\bsrc\s*=\s*(["'])https?:[^"']*\1[^>]*>\s*<\/script>/giu, "");
  const lazy = stripped.replace(/<img\b[^>]*>/giu, (tag) => {
    if (!/\ssrc\s*=/iu.test(tag)) return tag;
    return tag.replace(/\s(src|srcset)\s*=\s*(["'])([\s\S]*?)\2/giu, (_, name, quote, value) => {
      const placeholder = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";
      const shown = name === "src" ? placeholder : "";
      return ` data-${name}=${quote}${value}${quote} ${name}=${quote}${shown}${quote}`;
    });
  });
  const extra = `<style id="qz-example-thread">${THREAD_CSS}</style><script>${LAZY_SCRIPT}</script>`;
  return lazy.includes("</head>") ? lazy.replace("</head>", `${extra}</head>`) : `${extra}${lazy}`;
}

function bindMedia() {
  if (!item) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const loop = document.querySelector(".example-loop");
  if (loop && item.media.kind === "loop" && !reduced) {
    loop.src = siteUrl(item.media.src);
    loop.play().catch(() => { /* The poster stays visible if autoplay is blocked. */ });
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

async function showSession(file) {
  const frame = document.querySelector("#example-thread");
  const status = document.querySelector("#example-thread-status");
  if (!(frame instanceof HTMLIFrameElement)) return;
  const response = await fetch(file);
  if (!response.ok) throw new Error(String(response.status));
  frame.srcdoc = prepareDisplayHtml(await response.text());
  if (status instanceof HTMLElement) status.hidden = true;
}

function bindSessions() {
  const download = document.querySelector("#example-download");
  const status = document.querySelector("#example-thread-status");
  const tabs = [...document.querySelectorAll(".example-switch [data-file]")];
  if (!(download instanceof HTMLAnchorElement)) return;

  const select = (file, tab) => {
    download.href = file;
    download.setAttribute("download", file.split("/").pop() || "session.html");
    for (const button of tabs) button.setAttribute("aria-selected", button === tab ? "true" : "false");
    showSession(file).catch(() => {
      if (status instanceof HTMLElement) status.hidden = false;
    });
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab.dataset.file, tab));
  }
  if (download.getAttribute("href")) {
    showSession(download.getAttribute("href")).catch(() => {
      if (status instanceof HTMLElement) status.hidden = false;
    });
  }
}

bindMedia();
bindSessions();
