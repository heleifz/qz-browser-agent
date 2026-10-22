// Build homepage cards, detail pages, and example translations from catalog.js.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderSessionFile } from "./render-session.mjs";

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(websiteRoot, "examples/catalog.js");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(catalogPath, "utf8"), context, { filename: catalogPath });
const catalog = context.window.QZ_EXAMPLES;
if (!catalog?.items?.length) throw new Error("catalog has no examples");

const ARROW = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';
const GITHUB = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"></path></svg>';
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="m9 5 11 7-11 7z"></path></svg>';
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

function sessionHref(file) {
  return `../sessions/${path.posix.basename(file)}`;
}

function buttonHtml(label) {
  return `<span>${escapeHtml(label)}</span>${ARROW}`;
}

function buildCopy() {
  const copy = {};
  for (const locale of ["en", "zh-CN"]) {
    const shared = catalog.copy[locale];
    const html = {
      examplesTitle: escapeHtml(shared.title),
      examplesLede: escapeHtml(shared.lede),
      exampleDownload: buttonHtml(shared.download),
    };
    const attributes = {
      examplePlayButton: { "aria-label": shared.play },
    };
    for (const item of catalog.items) {
      html[`example-${item.slug}-title`] = escapeHtml(item.title[locale]);
      html[`example-${item.slug}-summary`] = escapeHtml(item.summary[locale]);
      attributes[`example-${item.slug}-description`] = { content: item.summary[locale] };
      attributes[`example-${item.slug}-cover`] = { alt: item.cover.alt[locale] };
      attributes[`example-${item.slug}-media`] = item.media.kind === "loop"
        ? { "aria-label": item.media.alt[locale] }
        : { alt: item.media.alt[locale] };
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
  const cards = catalog.items.map((item) => {
    const alt = escapeHtml(item.cover.alt.en);
    return `    <a class="example-card" href="./examples/${item.slug}/">
      <span class="example-cover"><img src="./${item.cover.src}" width="${item.cover.width}" height="${item.cover.height}" alt="${alt}" loading="lazy" decoding="async" data-i18n-attributes="example-${item.slug}-cover"></span>
      <h3 data-i18n="example-${item.slug}-title">${escapeHtml(item.title.en)}</h3>
      <p data-i18n="example-${item.slug}-summary">${escapeHtml(item.summary.en)}</p>
    </a>`;
  }).join("\n");
  return `<section class="examples section wrap" id="examples" aria-labelledby="examples-title">
  <div class="section-heading">
    <h2 id="examples-title" data-i18n="examplesTitle">${escapeHtml(en.title)}</h2>
    <p data-i18n="examplesLede">${escapeHtml(en.lede)}</p>
  </div>
  <div class="example-grid">
${cards}
  </div>
</section>`;
}

function mediaMarkup(item) {
  const poster = `../../${item.media.poster}`;
  const alt = escapeHtml(item.media.alt.en);
  const key = `example-${item.slug}-media`;
  if (item.media.kind === "loop") {
    return `<div class="example-player"><video class="example-loop" poster="${poster}" muted playsinline loop preload="none" width="${item.media.width}" height="${item.media.height}" aria-label="${alt}" data-i18n-attributes="${key}"></video></div>`;
  }
  return `<div class="example-player"><button class="example-play" type="button" aria-label="${escapeHtml(catalog.copy.en.play)}" data-i18n-attributes="examplePlayButton"><img src="${poster}" width="${item.media.width}" height="${item.media.height}" alt="${alt}" decoding="async" data-i18n-attributes="${key}">${PLAY}</button><video hidden controls playsinline preload="none"></video></div>`;
}

function tabMarkup(item) {
  if (item.sessions.length < 2) return "";
  const buttons = item.sessions.map((session, index) => {
    const selected = index === 0 ? "true" : "false";
    return `<button type="button" role="tab" id="example-tab-${session.id}" aria-selected="${selected}" aria-controls="example-pane-${session.id}" data-pane="example-pane-${session.id}" data-i18n="example-${item.slug}-${session.id}">${escapeHtml(session.label.en)}</button>`;
  }).join("");
  return `<div class="example-switch" role="tablist" aria-label="${escapeHtml(item.title.en)}">${buttons}</div>`;
}

function logMarkup(item) {
  return item.sessions.map((session, index) => {
    const file = sessionHref(session.file);
    const filename = path.posix.basename(session.file);
    const absolute = path.join(websiteRoot, session.file);
    const conversation = renderSessionFile(absolute);
    if (!conversation) console.warn(`missing session ${session.file}`);
    const hidden = index === 0 ? "" : " hidden";
    return `<div class="example-log" id="example-pane-${session.id}" data-file="${file}" data-download="${filename}"${hidden}>${conversation}</div>`;
  }).join("\n");
}

function detailPage(item) {
  const en = catalog.copy.en;
  const file = sessionHref(item.sessions[0].file);
  const filename = path.posix.basename(item.sessions[0].file);
  const canonical = `https://alibaba.github.io/qz-browser-agent/examples/${item.slug}/`;
  return `<!DOCTYPE html>
<html lang="en" data-example="${item.slug}" data-site-root="../../" data-generated="qz-example">
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
  <link rel="stylesheet" href="../../assets/examples.css">
  <script src="../../examples/catalog.js"></script>
  <script src="../../assets/site.js" type="module"></script>
  <script src="../../assets/examples-render.js" type="module"></script>
  <title>${escapeHtml(item.title.en)} — qz</title>
</head>
<body>
<a class="skip-link" href="#main" data-i18n="skip">Skip to content</a>
<header class="header wrap">
  <a class="brand" href="../../" aria-label="qz — Home" data-i18n-attributes="home"><img src="../../assets/icon.png" width="32" height="32" alt=""><span>qz<span class="brand-caption"> / 轻舟</span></span></a>
  <nav aria-label="Main navigation" data-i18n-attributes="nav"><a href="../../#overview" data-i18n="navOverview">Data</a><a href="../../#extend" data-i18n="navExtend">Skills</a><a href="../../#agents" data-i18n="navAgents">For agents</a><a href="https://github.com/alibaba/qz-browser-agent" class="nav-github">GitHub ${GITHUB}</a></nav>
  <div class="header-actions"><button class="language" type="button" hidden="" aria-label="Switch to 简体中文">中文</button><a class="button button-small" href="${STORE}" data-i18n="navStart">Install${ARROW}</a></div>
</header>
<main id="main" class="example-page wrap">
  <div class="example-stage">
    <div class="example-lead">
      <h1 data-i18n="example-${item.slug}-title">${escapeHtml(item.title.en)}</h1>
      <p class="example-summary" data-i18n="example-${item.slug}-summary">${escapeHtml(item.summary.en)}</p>
      ${tabMarkup(item) ? `${tabMarkup(item)}\n      ` : ""}<a class="button" id="example-download" href="${file}" download="${filename}" data-i18n="exampleDownload">${buttonHtml(en.download)}</a>
      <div class="example-frame">${mediaMarkup(item)}</div>
    </div>
    <div class="example-thread">
      ${logMarkup(item)}
    </div>
  </div>
</main>
<footer class="footer wrap"><a class="brand" href="../../">qz<span class="footer-name">qz-browser-agent</span></a><nav aria-label="Footer navigation" data-i18n-attributes="footer"><a href="https://github.com/alibaba/qz-browser-agent/blob/main/README.md" data-i18n="footerDocs" data-i18n-attributes="documentation">Documentation</a><a href="https://github.com/alibaba/qz-browser-agent/issues" data-i18n="footerIssues">Feedback</a><a href="https://github.com/alibaba/qz-browser-agent/blob/main/docs/permissions.md" data-i18n="footerPrivacy">Privacy</a><a href="../../credits/" data-i18n="footerCredits">Credits</a><a href="https://github.com/alibaba/qz-browser-agent/blob/main/LICENSE">Apache-2.0</a></nav></footer>
</body>
</html>
`;
}

function assertClean(label, html) {
  if (html.includes("待定") || html.includes("copy-pending") || html.includes("<iframe") || html.includes("header-examples")) {
    throw new Error(`${label} still has a draft mark, frame, or duplicate Examples link`);
  }
  const navEntries = html.match(/data-i18n="navExamples"/g) || [];
  if (navEntries.length !== 0) throw new Error(`${label} still changes the site nav`);
  if (html.includes("Allow access to file URLs") || html.includes("允许访问文件网址") || html.includes("下载后用 Chrome")) {
    throw new Error(`${label} still shows a download hint`);
  }
}

function assertExampleKeys(html, translations) {
  for (const locale of ["en", "zh-CN"]) {
    for (const match of html.matchAll(/data-i18n="([^"]+)"/g)) {
      if (!Object.hasOwn(translations[locale].html, match[1])) throw new Error(`missing ${locale} html translation ${match[1]}`);
    }
    for (const match of html.matchAll(/data-i18n-attributes="([^"]+)"/g)) {
      if (!translations[locale].attributes[match[1]]) throw new Error(`missing ${locale} attribute translation ${match[1]}`);
    }
  }
}

function jsonEntries(entries, indent) {
  return Object.entries(entries).map(([key, value]) => {
    if (value && typeof value === "object") {
      const body = Object.entries(value).map(([name, item]) => `${indent}  ${JSON.stringify(name)}: ${JSON.stringify(item)}`).join(",\n");
      return `${indent}${JSON.stringify(key)}: {\n${body}\n${indent}}`;
    }
    return `${indent}${JSON.stringify(key)}: ${JSON.stringify(value)}`;
  }).join(",\n");
}

function upsertMarked(source, marker, block, anchor) {
  const start = `/* ${marker}:start */`;
  const end = `/* ${marker}:end */`;
  const wrapped = `${start}\n${block}\n      ${end}`;
  const pattern = new RegExp(`/\\* ${marker}:start \\*/[\\s\\S]*?/\\* ${marker}:end \\*/`);
  if (pattern.test(source)) return source.replace(pattern, wrapped);
  if (!source.includes(anchor)) throw new Error(`missing translations anchor for ${marker}`);
  return source.replace(anchor, `${anchor},\n      ${wrapped}`);
}

function writeTranslations(copy) {
  const file = path.join(websiteRoot, "assets/translations.js");
  let source = fs.readFileSync(file, "utf8");
  source = upsertMarked(
    source,
    "example-html:en",
    jsonEntries(copy.en.html, "      "),
    '"agentRequirements": "Requires Node.js 22+ and Chrome on the same machine, with the qz extension and a model configured."',
  );
  source = upsertMarked(
    source,
    "example-html:zh",
    jsonEntries(copy["zh-CN"].html, "      "),
    '"agentRequirements": "需要 Node.js 22+，以及同一台电脑上的 Chrome、轻舟扩展和已配置的模型。"',
  );
  source = upsertMarked(
    source,
    "example-attr:en",
    jsonEntries(copy.en.attributes, "      "),
    '"aria-label": "Enlarge the qz side panel"\n      }',
  );
  source = upsertMarked(
    source,
    "example-attr:zh",
    jsonEntries(copy["zh-CN"].attributes, "      "),
    '"aria-label": "放大查看轻舟侧边栏"\n      }',
  );
  fs.writeFileSync(file, source);
}

function ensureHomepage(html) {
  if (!html.includes('href="./assets/examples.css"')) {
    html = html.replace(
      '  <link rel="stylesheet" href="./assets/site.css">\n',
      '  <link rel="stylesheet" href="./assets/site.css">\n  <link rel="stylesheet" href="./assets/examples.css">\n',
    );
  }
  return html
    .replace('<a class="header-examples" href="#examples" data-i18n="navExamples">Examples</a>', "")
    .replace('<a href="#examples" data-i18n="navExamples">Examples</a>', "");
}

function upsertHomepage(section) {
  const indexPath = path.join(websiteRoot, "index.html");
  let html = ensureHomepage(fs.readFileSync(indexPath, "utf8"));
  const block = `${START}\n${section}\n${END}\n`;
  if (html.includes(START) && html.includes(END)) {
    html = html.replace(new RegExp(`${START}[\\s\\S]*?${END}\\n?`), block);
  } else {
    const marker = '<section class="results section wrap" id="overview"';
    if (!html.includes(marker)) throw new Error("homepage overview section was not found");
    html = html.replace(marker, `${block}${marker}`);
  }
  if (!html.includes('id="examples"')) throw new Error("homepage is missing the examples section");
  if (html.includes('href="#examples"') || html.includes('data-i18n="navExamples"')) {
    throw new Error("homepage nav was changed");
  }
  fs.writeFileSync(indexPath, html);
  return html;
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
const staleI18n = path.join(websiteRoot, "assets/examples-i18n.js");
if (fs.existsSync(staleI18n)) fs.rmSync(staleI18n);
writeTranslations(copy);
const translations = (await import(pathToFileURL(path.join(websiteRoot, "assets/translations.js")).href)).translations;
const section = homepageSection();
const homepage = upsertHomepage(section);
assertClean("homepage", homepage);
assertExampleKeys(homepage, translations);
removeStalePages();
for (const item of catalog.items) {
  const html = detailPage(item);
  assertClean(`examples/${item.slug}/`, html);
  assertExampleKeys(html, translations);
  const dir = path.join(websiteRoot, "examples", item.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  console.log(`examples/${item.slug}/`);
}
console.log("generated example pages");
