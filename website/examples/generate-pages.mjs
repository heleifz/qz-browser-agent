// Build homepage cards, detail pages, and example translations from catalog.js.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(websiteRoot, "examples/catalog.js");
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(catalogPath, "utf8"), context, { filename: catalogPath });
const catalog = context.window.QZ_EXAMPLES;
const localeIds = ["zh", "en"];
if (!Array.isArray(catalog?.locales?.zh) || !Array.isArray(catalog?.locales?.en)) {
  throw new Error("catalog locales need zh and en lists");
}
if (catalog.fallback && !localeIds.includes(catalog.fallback)) throw new Error("fallback locale must be zh or en");
if (!catalog.locales.zh.length && !catalog.locales.en.length) throw new Error("catalog has no examples");

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

function buttonHtml(label) {
  return `<span>${escapeHtml(label)}</span>${ARROW}`;
}

function groupOf(entry) {
  return entry.group || entry.slug;
}

function requireEntry(entry, localeId) {
  for (const field of ["slug", "title", "summary", "file"]) {
    if (!entry[field]) throw new Error(`${localeId} example is missing ${field}`);
  }
  if (entry.slug === "en" || entry.slug === "sessions") throw new Error(`${entry.slug} is a reserved directory name`);
  if (!entry.cover?.src || !entry.media?.src || !entry.media?.poster) throw new Error(`${entry.slug} is missing cover or media`);
  if (entry.media.kind !== "loop" && entry.media.kind !== "click") throw new Error(`${entry.slug} media.kind must be loop or click`);
  for (const link of entry.related || []) {
    if (!link.slug || !link.id || !link.label) throw new Error(`${entry.slug} related link is incomplete`);
    if (!catalog.locales[localeId].some((item) => item.slug === link.slug)) {
      throw new Error(`${entry.slug} links to missing ${localeId} example ${link.slug}`);
    }
  }
}

function presentation(localeId) {
  const own = catalog.locales[localeId];
  if (own.length || localeId === catalog.fallback || !catalog.fallback) {
    return { entries: own.filter((entry) => entry.card !== false), fallback: false, source: localeId };
  }
  return {
    entries: catalog.locales[catalog.fallback].filter((entry) => entry.card !== false),
    fallback: true,
    source: catalog.fallback,
  };
}

function cardHref(sourceLocale, slug) {
  return sourceLocale === "en" ? `./examples/en/${slug}/` : `./examples/${slug}/`;
}

function cardsHtml(localeId) {
  const view = presentation(localeId);
  return view.entries.map((entry) => {
    const pack = view.fallback ? catalog.fallbackCopy?.[localeId]?.[groupOf(entry)] : null;
    if (view.fallback && !pack) throw new Error(`missing fallbackCopy.${localeId}.${groupOf(entry)}`);
    const title = view.fallback ? pack.title : entry.title;
    const summary = view.fallback ? pack.summary : entry.summary;
    const alt = view.fallback ? pack.coverAlt : entry.cover.alt;
    return `    <a class="example-card" href="${cardHref(view.source, entry.slug)}">
      <span class="example-cover"><img src="./${entry.cover.src}" width="${entry.cover.width}" height="${entry.cover.height}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"></span>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(summary)}</p>
    </a>`;
  }).join("\n");
}

function englishPack(group) {
  const pack = catalog.fallbackCopy?.en?.[group];
  if (!pack) throw new Error(`missing fallbackCopy.en.${group}`);
  return pack;
}

function buildCopy() {
  const copy = {};
  for (const locale of ["en", "zh-CN"]) {
    const shared = catalog.copy[locale];
    const localeId = locale === "zh-CN" ? "zh" : "en";
    copy[locale] = {
      html: {
        examplesTitle: escapeHtml(shared.title),
        examplesLede: escapeHtml(shared.lede),
        exampleDownload: escapeHtml(shared.download),
        examplesGrid: cardsHtml(localeId),
      },
      attributes: {
        examplePlayButton: { "aria-label": shared.play },
      },
    };
  }
  const seen = new Set();
  for (const entry of catalog.locales.zh) {
    const group = groupOf(entry);
    if (seen.has(group)) continue;
    seen.add(group);
    const primary = catalog.locales.zh.find((item) => item.slug === group) || entry;
    const pack = englishPack(group);
    copy.en.html[`example-${group}-title`] = escapeHtml(pack.title);
    copy["zh-CN"].html[`example-${group}-title`] = escapeHtml(primary.title);
    copy.en.html[`example-${group}-summary`] = escapeHtml(pack.summary);
    copy["zh-CN"].html[`example-${group}-summary`] = escapeHtml(primary.summary);
    copy.en.attributes[`example-${group}-description`] = { content: pack.summary };
    copy["zh-CN"].attributes[`example-${group}-description`] = { content: primary.summary };
    copy.en.attributes[`example-${group}-cover`] = { alt: pack.coverAlt };
    copy["zh-CN"].attributes[`example-${group}-cover`] = { alt: primary.cover.alt };
    const mediaName = primary.media.kind === "loop" ? "aria-label" : "alt";
    copy.en.attributes[`example-${group}-media`] = { [mediaName]: pack.mediaAlt };
    copy["zh-CN"].attributes[`example-${group}-media`] = { [mediaName]: primary.media.alt };
    const labels = catalog.locales.zh
      .filter((item) => groupOf(item) === group)
      .flatMap((item) => item.related || []);
    labels.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    for (const link of labels) {
      const english = pack.related?.[link.id];
      if (!english) throw new Error(`missing fallbackCopy.en.${group}.related.${link.id}`);
      copy.en.html[`example-${group}-${link.id}`] = escapeHtml(english);
      copy["zh-CN"].html[`example-${group}-${link.id}`] = escapeHtml(link.label);
    }
  }
  for (const entry of catalog.locales.en) {
    const key = `example-en-${entry.slug}`;
    const zhMatch = catalog.locales.zh.find((item) => item.slug === entry.slug);
    copy.en.html[`${key}-title`] = escapeHtml(entry.title);
    copy["zh-CN"].html[`${key}-title`] = escapeHtml(zhMatch?.title || entry.title);
    copy.en.html[`${key}-summary`] = escapeHtml(entry.summary);
    copy["zh-CN"].html[`${key}-summary`] = escapeHtml(zhMatch?.summary || entry.summary);
    copy.en.attributes[`${key}-description`] = { content: entry.summary };
    copy["zh-CN"].attributes[`${key}-description`] = { content: zhMatch?.summary || entry.summary };
    copy.en.attributes[`${key}-cover`] = { alt: entry.cover.alt };
    copy["zh-CN"].attributes[`${key}-cover`] = { alt: zhMatch?.cover.alt || entry.cover.alt };
    const mediaName = entry.media.kind === "loop" ? "aria-label" : "alt";
    copy.en.attributes[`${key}-media`] = { [mediaName]: entry.media.alt };
    copy["zh-CN"].attributes[`${key}-media`] = { [mediaName]: zhMatch?.media.alt || entry.media.alt };
    for (const link of entry.related || []) {
      copy.en.html[`${key}-${link.id}`] = escapeHtml(link.label);
      const zhLabel = zhMatch?.related?.find((item) => item.id === link.id)?.label || link.label;
      copy["zh-CN"].html[`${key}-${link.id}`] = escapeHtml(zhLabel);
    }
  }
  return copy;
}

function homepageSection(cards) {
  const en = catalog.copy.en;
  return `<section class="examples section wrap" id="examples" aria-labelledby="examples-title">
  <div class="section-heading">
    <h2 id="examples-title" data-i18n="examplesTitle">${escapeHtml(en.title)}</h2>
    <p data-i18n="examplesLede">${escapeHtml(en.lede)}</p>
  </div>
  <div class="example-grid" data-i18n="examplesGrid">
${cards}
  </div>
</section>`;
}

function mediaMarkup(entry, view, root) {
  const poster = `${root}${entry.media.poster}`;
  const alt = escapeHtml(view.mediaAlt);
  if (entry.media.kind === "loop") {
    return `<div class="example-player"><video class="example-loop" poster="${poster}" muted playsinline loop preload="none" width="${entry.media.width}" height="${entry.media.height}" aria-label="${alt}" data-i18n-attributes="${view.mediaKey}"></video></div>`;
  }
  return `<div class="example-player"><button class="example-play" type="button" aria-label="${escapeHtml(catalog.copy.en.play)}" data-i18n-attributes="examplePlayButton"><img src="${poster}" width="${entry.media.width}" height="${entry.media.height}" alt="${alt}" decoding="async" data-i18n-attributes="${view.mediaKey}">${PLAY}</button><video hidden controls playsinline preload="none"></video></div>`;
}

function hasSlug(localeId, slug) {
  return catalog.locales[localeId].some((entry) => entry.slug === slug);
}

function switchHref(localeId, slug) {
  const other = localeId === "zh" ? "en" : "zh";
  if (hasSlug(other, slug)) return localeId === "zh" ? `../en/${slug}/` : `../../${slug}/`;
  return localeId === "zh" ? "../../?lang=en#examples" : "../../../?lang=zh-CN#examples";
}

function readExport(file) {
  const absolute = path.join(websiteRoot, file);
  const html = fs.readFileSync(absolute, "utf8");
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
  const runtime = html.match(/<script>([\s\S]*?)<\/script>/);
  const exchange = html.match(/<script id="qingzhou-session-exchange" type="application\/json">[\s\S]*?<\/script>/);
  const messages = html.match(/<main id="messages">([\s\S]*?)<\/main>/);
  const labels = html.match(/<script type="application\/json" id="qingzhou-export-messages">[\s\S]*?<\/script>/);
  if (styles.length < 2 || !runtime || !exchange || !messages || !labels) {
    throw new Error(`export ${file} is missing the transcript, stylesheet, or exchange script`);
  }
  const title = sessionTitle(html, exchange[0]);
  const transcript = messages[1].replace(/<div id="session-title-bar"[\s\S]*?<\/div>/, "");
  return { styles, runtime: runtime[1], exchange: exchange[0], messages: transcript, labels: labels[0], title };
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function sessionTitle(html, exchangeTag) {
  const shown = html.match(/<span id="current-session-title"[^>]*>([\s\S]*?)<\/span>/);
  if (!shown?.[1].trim()) throw new Error("export is missing the session title");
  const title = decodeHtml(shown[1].trim());
  const payload = JSON.parse(exchangeTag.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
  if (payload?.session?.title !== title) throw new Error(`session title mismatch for ${title}`);
  return title;
}

function adaptSessionCss(panel, shell) {
  const adaptedPanel = panel.replaceAll(":root", ":host").replace("html,\n  body", ":host");
  const adaptedShell = shell
    .replaceAll("html, body", ":host")
    .replace("body { background: var(--bg-primary); }", ":host { background: var(--bg-primary); }");
  if (adaptedPanel.includes(":root") || adaptedPanel.includes("html,") || adaptedShell.includes("html,") || /\bbody\b/.test(adaptedShell)) {
    throw new Error("session stylesheet still targets the outer page");
  }
  return `${adaptedPanel}\n${adaptedShell}\n`;
}

function adaptSessionScript(source) {
  source = source.trim();
  if (!source.startsWith("(()=>{") || !source.endsWith("})();")) throw new Error("unexpected export runtime");
  const body = source
    .slice("(()=>{".length, -"})();".length)
    .replace('document.getElementById("qingzhou-export-messages")', 'root.getElementById("qingzhou-export-messages")')
    .replace("document.body.appendChild", "root.appendChild")
    .replace('document.addEventListener("click"', 'root.addEventListener("click"');
  if (body.includes("document.body") || body.includes('document.addEventListener("click"') || body.includes('document.getElementById("qingzhou-export-messages")')) {
    throw new Error("export runtime was not scoped to the shadow root");
  }
  if (!body.includes('document.getElementById("qingzhou-session-cta")')) throw new Error("import placeholder lookup was removed");
  return `export function mountSessionView(root) {${body}}\n`;
}

function lazyImages(html) {
  return html.replace(/<img\b([^>]*?)>/g, (full, attrs) => (
    /\bloading\s*=/.test(attrs) ? full : `<img loading="lazy"${attrs}>`
  ));
}

function sessionView(part, root) {
  return `<qz-session-view><template shadowrootmode="open"><link rel="stylesheet" href="${root}assets/examples/session-view.css"><link rel="stylesheet" href="${root}assets/examples/session-view-overrides.css">${part.labels}<main id="messages">${lazyImages(part.messages)}</main></template></qz-session-view>`;
}

function relatedMarkup(entry) {
  const group = groupOf(entry);
  const pack = englishPack(group);
  const links = (entry.related || []).map((link) => {
    const english = pack.related?.[link.id];
    if (!english) throw new Error(`missing fallbackCopy.en.${group}.related.${link.id}`);
    return `<a href="../${link.slug}/" data-i18n="example-${group}-${link.id}">${escapeHtml(english)}</a>`;
  });
  return links.length ? `\n      <p class="example-related">${links.join("")}</p>` : "\n      ";
}

function pageView(entry, localeId) {
  const group = groupOf(entry);
  if (localeId === "zh") {
    const pack = englishPack(group);
    return {
      title: pack.title,
      summary: pack.summary,
      mediaAlt: pack.mediaAlt,
      titleKey: `example-${group}-title`,
      summaryKey: `example-${group}-summary`,
      descriptionKey: `example-${group}-description`,
      mediaKey: `example-${group}-media`,
      related: relatedMarkup(entry),
    };
  }
  const key = `example-en-${entry.slug}`;
  const links = (entry.related || []).map((link) => (
    `<a href="../${link.slug}/" data-i18n="${key}-${link.id}">${escapeHtml(link.label)}</a>`
  ));
  return {
    title: entry.title,
    summary: entry.summary,
    mediaAlt: entry.media.alt,
    titleKey: `${key}-title`,
    summaryKey: `${key}-summary`,
    descriptionKey: `${key}-description`,
    mediaKey: `${key}-media`,
    related: links.length ? `\n      <p class="example-related">${links.join("")}</p>` : "\n      ",
  };
}

function writeSharedSessionAssets(parts) {
  const [first] = parts;
  for (const part of parts.slice(1)) {
    if (part.styles[0] !== first.styles[0] || part.styles[1] !== first.styles[1] || part.runtime !== first.runtime || part.labels !== first.labels) {
      throw new Error("session exports do not share one stylesheet and interaction script");
    }
  }
  const dir = path.join(websiteRoot, "assets/examples");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session-view.css"), adaptSessionCss(first.styles[0], first.styles[1]));
  fs.writeFileSync(path.join(dir, "session-view.js"), adaptSessionScript(first.runtime));
}

function detailPage(localeId, entry, part) {
  const en = catalog.copy.en;
  const view = pageView(entry, localeId);
  const root = localeId === "zh" ? "../../" : "../../../";
  const canonical = localeId === "zh"
    ? `https://alibaba.github.io/qz-browser-agent/examples/${entry.slug}/`
    : `https://alibaba.github.io/qz-browser-agent/examples/en/${entry.slug}/`;
  const alternates = localeId === "zh" && !hasSlug("en", entry.slug)
    ? `<link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${canonical}">
  <link rel="alternate" hreflang="zh-CN" href="${canonical}?lang=zh-CN">
  <link rel="alternate" hreflang="x-default" href="${canonical}">`
    : `<link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${hasSlug("en", entry.slug) ? `https://alibaba.github.io/qz-browser-agent/examples/en/${entry.slug}/` : "https://alibaba.github.io/qz-browser-agent/?lang=en#examples"}">
  <link rel="alternate" hreflang="zh-CN" href="${hasSlug("zh", entry.slug) ? `https://alibaba.github.io/qz-browser-agent/examples/${entry.slug}/` : "https://alibaba.github.io/qz-browser-agent/?lang=zh-CN#examples"}">
  <link rel="alternate" hreflang="x-default" href="${canonical}">`;
  const pageLang = localeId === "zh" ? "zh-CN" : "en";
  return `<!DOCTYPE html>
<html lang="en" data-example="${groupOf(entry)}" data-site-root="${root}" data-generated="qz-example" data-session="${entry.session || "default"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="description" content="${escapeHtml(view.summary)}" data-i18n-attributes="${view.descriptionKey}">
  <meta name="theme-color" content="#f7f7f5">
  ${alternates}
  <link rel="icon" type="image/png" href="${root}assets/icon.png">
  <link rel="stylesheet" href="${root}assets/site.css">
  <link rel="stylesheet" href="${root}assets/examples.css">
  <script src="${root}examples/catalog.js"></script>
  <script src="${root}assets/site.js" type="module"></script>
  <script src="${root}assets/examples-render.js" type="module"></script>
  <title>${escapeHtml(view.title)} — qz</title>
</head>
<body>
<a class="skip-link" href="#main" data-i18n="skip">Skip to content</a>
<header class="header wrap">
  <a class="brand" href="${root}" aria-label="qz — Home" data-i18n-attributes="home"><img src="${root}assets/icon.png" width="32" height="32" alt=""><span>qz<span class="brand-caption"> / 轻舟</span></span></a>
  <nav aria-label="Main navigation" data-i18n-attributes="nav"><a href="${root}#overview" data-i18n="navOverview">Data</a><a href="${root}#extend" data-i18n="navExtend">Skills</a><a href="${root}#agents" data-i18n="navAgents">For agents</a><a href="https://github.com/alibaba/qz-browser-agent" class="nav-github">GitHub ${GITHUB}</a></nav>
  <div class="header-actions"><button class="language" type="button" hidden="" aria-label="Switch to 简体中文" data-example-locale="${pageLang}" data-switch-href="${switchHref(localeId, entry.slug)}">中文</button><a class="button button-small" href="${STORE}" data-i18n="navStart">Install${ARROW}</a></div>
</header>
<main id="main" class="example-page wrap">
  <div class="example-stage">
    <div class="example-lead">
      <h1 data-i18n="${view.titleKey}">${escapeHtml(view.title)}</h1>
      <p class="example-summary" data-i18n="${view.summaryKey}">${escapeHtml(view.summary)}</p>${view.related}
      <div class="example-frame">${mediaMarkup(entry, view, root)}</div>
    </div>
    <div class="example-thread">
      <div class="example-actions example-thread-bar">
        <p class="example-session-title">${escapeHtml(part.title)}</p>
        <div class="example-thread-cta">
          <button id="qingzhou-session-cta" class="qz-btn qz-btn--primary qz-btn--xs session-export-cta" hidden type="button"></button>
          <a class="qz-btn qz-btn--primary qz-btn--xs session-export-cta" id="example-store" href="${STORE}" target="_blank" rel="noopener" data-i18n="exampleDownload">${escapeHtml(en.download)}</a>
        </div>
      </div>
      ${sessionView(part, root)}
    </div>
  </div>
</main>
<footer class="footer wrap"><a class="brand" href="${root}">qz<span class="footer-name">qz-browser-agent</span></a><nav aria-label="Footer navigation" data-i18n-attributes="footer"><a href="https://github.com/alibaba/qz-browser-agent/blob/main/README.md" data-i18n="footerDocs" data-i18n-attributes="documentation">Documentation</a><a href="https://github.com/alibaba/qz-browser-agent/issues" data-i18n="footerIssues">Feedback</a><a href="https://github.com/alibaba/qz-browser-agent/blob/main/docs/permissions.md" data-i18n="footerPrivacy">Privacy</a><a href="${root}credits/" data-i18n="footerCredits">Credits</a><a href="https://github.com/alibaba/qz-browser-agent/blob/main/LICENSE">Apache-2.0</a></nav></footer>
${part.exchange}
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

function removeGenerated(dir, slugs) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "sessions" || entry.name === "en" || slugs.has(entry.name)) continue;
    const indexPath = path.join(dir, entry.name, "index.html");
    if (!fs.existsSync(indexPath)) continue;
    const html = fs.readFileSync(indexPath, "utf8");
    if (html.includes('data-generated="qz-example"')) fs.rmSync(path.join(dir, entry.name), { recursive: true });
  }
}

function removeStalePages() {
  const examplesDir = path.join(websiteRoot, "examples");
  removeGenerated(examplesDir, new Set(catalog.locales.zh.map((entry) => entry.slug)));
  const englishDir = path.join(examplesDir, "en");
  removeGenerated(englishDir, new Set(catalog.locales.en.map((entry) => entry.slug)));
  if (fs.existsSync(englishDir) && fs.readdirSync(englishDir).length === 0) fs.rmdirSync(englishDir);
}

for (const localeId of localeIds) {
  const seen = new Set();
  for (const entry of catalog.locales[localeId]) {
    requireEntry(entry, localeId);
    if (seen.has(entry.slug)) throw new Error(`duplicate ${localeId} example ${entry.slug}`);
    seen.add(entry.slug);
  }
}
const copy = buildCopy();
const staleI18n = path.join(websiteRoot, "assets/examples-i18n.js");
if (fs.existsSync(staleI18n)) fs.rmSync(staleI18n);
writeTranslations(copy);
const translations = (await import(pathToFileURL(path.join(websiteRoot, "assets/translations.js")).href)).translations;
const section = homepageSection(cardsHtml("en"));
const homepage = upsertHomepage(section);
assertClean("homepage", homepage);
assertExampleKeys(homepage, translations);
removeStalePages();
const pages = localeIds.flatMap((localeId) => catalog.locales[localeId].map((entry) => ({
  localeId,
  entry,
  part: readExport(entry.file),
})));
writeSharedSessionAssets(pages.map((page) => page.part));
for (const page of pages) {
  const html = detailPage(page.localeId, page.entry, page.part);
  const exchangeCount = html.split('id="qingzhou-session-exchange"').length - 1;
  const slug = page.localeId === "zh" ? page.entry.slug : `en/${page.entry.slug}`;
  if (exchangeCount !== 1) throw new Error(`${slug} embeds ${exchangeCount} exchange payloads`);
  if (!html.includes(page.part.exchange)) throw new Error(`${slug} changed the exchange script`);
  assertClean(`examples/${slug}/`, html);
  assertExampleKeys(html, translations);
  const dir = path.join(websiteRoot, "examples", ...(page.localeId === "zh" ? [page.entry.slug] : ["en", page.entry.slug]));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  console.log(`examples/${slug}/`);
}
console.log(`fallback: ${catalog.fallback || "off"}`);
console.log("generated example pages");
