// Build homepage cards, detail pages, and example translations from catalog.js.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(websiteRoot, "examples/catalog.js");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(catalogPath, "utf8"), context, { filename: catalogPath });
const catalog = context.window.QZ_EXAMPLES;
if (!catalog?.items?.length) throw new Error("catalog has no examples");

const PENDING = '<span class="copy-pending">待定</span>';
const ARROW = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';
const OPEN = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"></path></svg>';
const DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"></path></svg>';
const GITHUB = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"></path></svg>';
const START = "<!-- examples:start -->";
const END = "<!-- examples:end -->";
const STORE = catalog.storeUrl;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function marked(value) {
  return `${escapeHtml(value)}${PENDING}`;
}

function sessionHref(file) {
  return `../sessions/${path.posix.basename(file)}`;
}

function buildCopy() {
  const copy = {};
  for (const locale of ["en", "zh-CN"]) {
    const shared = catalog.copy[locale];
    const html = {
      navExamples: escapeHtml(shared.nav),
      examplesTitle: marked(shared.title),
      examplesLede: marked(shared.lede),
      exampleOpen: `${escapeHtml(shared.open)}${OPEN}`,
      exampleBack: escapeHtml(shared.back),
      exampleKind: escapeHtml(shared.kind),
      exampleDownload: `${escapeHtml(shared.download)}${DOWNLOAD}`,
      exampleDownloadHint: marked(shared.downloadHint),
      exampleFileHint: `${shared.fileHint}${PENDING}`,
      exampleChrome: `${escapeHtml(shared.chrome)}${ARROW}`,
      examplePlay: escapeHtml(shared.play),
      exampleThread: escapeHtml(shared.thread),
      exampleMissing: escapeHtml(shared.missing),
    };
    const attributes = {
      exampleThreadFrame: { title: shared.thread },
    };
    for (const item of catalog.items) {
      html[`example-${item.slug}-title`] = marked(item.title[locale]);
      html[`example-${item.slug}-summary`] = marked(item.summary[locale]);
      attributes[`example-${item.slug}-cover`] = { alt: item.cover.alt[locale] };
      attributes[`example-${item.slug}-media`] = item.media.kind === "loop"
        ? { "aria-label": item.media.alt[locale] }
        : { alt: item.media.alt[locale] };
      attributes[`example-${item.slug}-description`] = { content: item.summary[locale] };
      for (const session of item.sessions) {
        if (!session.label) continue;
        html[`example-${item.slug}-${session.id}`] = escapeHtml(session.label[locale]);
      }
    }
    copy[locale] = { html, attributes };
  }
  return copy;
}

function homepageSection() {
  const en = catalog.copy.en;
  const cards = catalog.items.map((item, index) => {
    const alt = escapeHtml(item.cover.alt.en);
    return `<a class="example-card" href="./examples/${item.slug}/"><span class="example-cover"><img src="./${item.cover.src}" width="${item.cover.width}" height="${item.cover.height}" alt="${alt}" loading="lazy" decoding="async" data-i18n-attributes="example-${item.slug}-cover"></span><span class="example-card-body"><span class="index">${String(index + 1).padStart(2, "0")}</span><h3 data-i18n="example-${item.slug}-title">${marked(item.title.en)}</h3><p data-i18n="example-${item.slug}-summary">${marked(item.summary.en)}</p><span class="text-link" data-i18n="exampleOpen">${escapeHtml(en.open)}${OPEN}</span></span></a>`;
  }).join("");
  return `<section class="examples section wrap" id="examples" aria-labelledby="examples-title"><div class="section-heading"><h2 id="examples-title" data-i18n="examplesTitle">${marked(en.title)}</h2><p data-i18n="examplesLede">${marked(en.lede)}</p></div><div class="example-grid">${cards}</div></section>`;
}

function mediaMarkup(item) {
  const poster = `../../${item.media.poster}`;
  const alt = escapeHtml(item.media.alt.en);
  const key = `example-${item.slug}-media`;
  if (item.media.kind === "loop") {
    return `<div class="example-player"><video class="example-loop" poster="${poster}" muted playsinline loop preload="none" width="${item.media.width}" height="${item.media.height}" aria-label="${alt}" data-i18n-attributes="${key}"></video></div>`;
  }
  return `<div class="example-player"><button class="example-play" type="button"><img src="${poster}" width="${item.media.width}" height="${item.media.height}" alt="${alt}" decoding="async" data-i18n-attributes="${key}"><span data-i18n="examplePlay">${escapeHtml(catalog.copy.en.play)}</span></button><video hidden controls playsinline preload="none"></video></div>`;
}

function tabMarkup(item) {
  if (item.sessions.length < 2) return "";
  const buttons = item.sessions.map((session, index) => {
    const file = sessionHref(session.file);
    const selected = index === 0 ? "true" : "false";
    return `<button type="button" role="tab" id="example-tab-${session.id}" aria-selected="${selected}" aria-controls="example-thread" data-file="${file}" data-i18n="example-${item.slug}-${session.id}">${escapeHtml(session.label.en)}</button>`;
  }).join("");
  return `<div class="example-switch" role="tablist" aria-label="${escapeHtml(item.title.en)}">${buttons}</div>`;
}

function detailPage(item) {
  const en = catalog.copy.en;
  const file = sessionHref(item.sessions[0].file);
  const filename = path.posix.basename(item.sessions[0].file);
  const canonical = `https://alibaba.github.io/qz-browser-agent/examples/${item.slug}/`;
  return `<!DOCTYPE html>
<html lang="en" data-example="${item.slug}" data-site-root="../../" data-title-key="example-${item.slug}-title" data-generated="qz-example">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="${escapeHtml(item.summary.en)}" data-i18n-attributes="example-${item.slug}-description">
  <meta name="theme-color" content="#f7f7f5">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${canonical}">
  <link rel="alternate" hreflang="zh-CN" href="${canonical}?lang=zh-CN">
  <link rel="alternate" hreflang="x-default" href="${canonical}">
  <link rel="icon" type="image/png" href="../../assets/icon.png">
  <link rel="stylesheet" href="../../assets/site.css">
  <script src="../../examples/catalog.js"></script>
  <script src="../../assets/site.js" type="module"></script>
  <script src="../../assets/examples-render.js" type="module"></script>
  <title>${escapeHtml(item.title.en)} — qz</title>
</head>
<body>
<a class="skip-link" href="#main" data-i18n="skip">Skip to content</a>
<header class="header wrap">
  <a class="brand" href="../../" aria-label="qz — Home" data-i18n-attributes="home"><img src="../../assets/icon.png" width="32" height="32" alt=""><span>qz<span class="brand-caption"> / 轻舟</span></span></a>
  <nav aria-label="Main navigation" data-i18n-attributes="nav"><a href="../../#examples" data-i18n="navExamples">${escapeHtml(en.nav)}</a><a href="../../#overview" data-i18n="navOverview">Data</a><a href="../../#extend" data-i18n="navExtend">Skills</a><a href="../../#agents" data-i18n="navAgents">For agents</a><a href="https://github.com/alibaba/qz-browser-agent" class="nav-github">GitHub ${GITHUB}</a></nav>
  <div class="header-actions"><a class="header-examples" href="../../#examples" data-i18n="navExamples">${escapeHtml(en.nav)}</a><button class="language" type="button" hidden aria-label="Switch to 简体中文">中文</button><a class="button button-small" href="${STORE}" data-i18n="navStart">Install${ARROW}</a></div>
</header>
<main id="main" class="example-page wrap">
  <a class="example-back text-link" href="../../#examples" data-i18n="exampleBack">${escapeHtml(en.back)}</a>
  <p class="eyebrow"><span class="square" aria-hidden="true"></span><span data-i18n="exampleKind">${escapeHtml(en.kind)}</span></p>
  <h1 data-i18n="example-${item.slug}-title">${marked(item.title.en)}</h1>
  <p class="example-summary" data-i18n="example-${item.slug}-summary">${marked(item.summary.en)}</p>
  ${tabMarkup(item)}
  <div class="example-actions">
    <a class="button" id="example-download" href="${file}" download="${filename}" data-i18n="exampleDownload">${escapeHtml(en.download)}${DOWNLOAD}</a>
    <a class="button button-secondary" href="${STORE}" data-i18n="exampleChrome">${escapeHtml(en.chrome)}${ARROW}</a>
    <div class="example-hints">
      <p data-i18n="exampleDownloadHint">${marked(en.downloadHint)}</p>
      <p data-i18n="exampleFileHint">${en.fileHint}${PENDING}</p>
    </div>
  </div>
  <div class="example-stage">
    <div class="example-media">${mediaMarkup(item)}</div>
    <div class="example-thread-column">
      <p id="example-thread-status" class="example-thread-status" data-i18n="exampleMissing" hidden>${escapeHtml(en.missing)}</p>
      <iframe id="example-thread" class="example-thread" title="${escapeHtml(en.thread)}" data-i18n-attributes="exampleThreadFrame"></iframe>
    </div>
  </div>
</main>
<footer class="footer wrap"><a class="brand" href="../../">qz<span class="footer-name">qz-browser-agent</span></a><nav aria-label="Footer navigation" data-i18n-attributes="footer"><a href="https://github.com/alibaba/qz-browser-agent/blob/main/README.md" data-i18n="footerDocs" data-i18n-attributes="documentation">Documentation</a><a href="https://github.com/alibaba/qz-browser-agent/issues" data-i18n="footerIssues">Feedback</a><a href="https://github.com/alibaba/qz-browser-agent/blob/main/docs/permissions.md" data-i18n="footerPrivacy">Privacy</a><a href="../../credits/" data-i18n="footerCredits">Credits</a><a href="https://github.com/alibaba/qz-browser-agent/blob/main/LICENSE">Apache-2.0</a></nav></footer>
</body>
</html>
`;
}

function assertExampleKeys(html, copy) {
  const needed = new Set();
  for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) {
    if (/^(?:navExamples|examples|example)/.test(match[1])) needed.add(match[1]);
  }
  for (const match of html.matchAll(/data-i18n-attributes="([^"]+)"/g)) {
    if (/^example/.test(match[1])) needed.add(`@${match[1]}`);
  }
  for (const key of needed) {
    if (key.startsWith("@")) {
      if (!copy.en.attributes[key.slice(1)]) throw new Error(`missing attribute translation ${key}`);
    } else if (!Object.hasOwn(copy.en.html, key)) {
      throw new Error(`missing html translation ${key}`);
    }
  }
}

function upsertHomepage(section) {
  const indexPath = path.join(websiteRoot, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const block = `${START}\n${section}\n${END}\n`;
  let next;
  if (html.includes(START) && html.includes(END)) {
    next = html.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), block);
  } else {
    const marker = '<section class="results section wrap" id="overview"';
    if (!html.includes(marker)) throw new Error("homepage overview section was not found");
    next = html.replace(marker, `${block}${marker}`);
  }
  fs.writeFileSync(indexPath, next);
  return next;
}

function removeStalePages() {
  const examplesDir = path.join(websiteRoot, "examples");
  const slugs = new Set(catalog.items.map((item) => item.slug));
  for (const entry of fs.readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "sessions" || slugs.has(entry.name)) continue;
    const indexPath = path.join(examplesDir, entry.name, "index.html");
    if (!fs.existsSync(indexPath)) continue;
    const html = fs.readFileSync(indexPath, "utf8");
    if (html.includes('data-generated="qz-example"')) fs.rmSync(path.join(examplesDir, entry.name), { recursive: true });
  }
}

const copy = buildCopy();
const i18nPath = path.join(websiteRoot, "assets/examples-i18n.js");
fs.writeFileSync(i18nPath, `// Generated from examples/catalog.js. Run: node website/examples/generate-pages.mjs\nexport const exampleCopy = ${JSON.stringify(copy, null, 2)};\n`);

const section = homepageSection();
const homepage = upsertHomepage(section);
assertExampleKeys(homepage, copy);
removeStalePages();
for (const item of catalog.items) {
  const html = detailPage(item);
  assertExampleKeys(html, copy);
  const dir = path.join(websiteRoot, "examples", item.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  console.log(`examples/${item.slug}/`);
}
console.log("generated example pages");
