// Turn a qz session export into site HTML. The export file itself stays a download.
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const SCRIPT_PATTERN = /<script\s+id=(["'])qingzhou-session-exchange\1\s+type=(["'])application\/json\2>([\s\S]*?)<\/script>/u;

export function readSessionPayload(html) {
  const match = SCRIPT_PATTERN.exec(String(html || ""));
  if (!match) throw new Error("missing qingzhou-session-exchange script");
  return JSON.parse(match[3]);
}

export function renderSessionHtml(html) {
  return renderEntries(entriesFromPayload(readSessionPayload(html)));
}

export function renderSessionFile(file) {
  if (!file || !fs.existsSync(file)) return "";
  return renderSessionHtml(fs.readFileSync(file, "utf8"));
}

function entriesFromPayload(payload) {
  const session = payload?.session || {};
  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  if (transcript.length) return flatten(transcript);
  const entries = session.conversation?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const message = entry?.message || entry || {};
    const role = String(message.role || entry?.type || "");
    return {
      type: role === "tool" ? "tool" : role,
      name: message.name || message.tool_calls?.[0]?.function?.name || "",
      text: textFromContent(message.content),
      content: message.content,
      argsText: toolArguments(message),
      images: imagesFromContent(message.content),
    };
  });
}

function flatten(list) {
  const out = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const nested = entry.tools || entry.entries || entry.children;
    if ((entry.type === "tool-group" || entry.type === "thinking-group") && Array.isArray(nested)) {
      if (entry.type === "tool-group") out.push(...flatten(nested));
      continue;
    }
    out.push(entry);
  }
  return out;
}

function renderEntries(entries) {
  const html = [];
  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (isTool(entry)) {
      const group = [];
      while (index < entries.length && isTool(entries[index])) group.push(entries[index++]);
      html.push(group.length > 1 ? renderToolGroup(group) : `<div class="example-turn">${renderTool(group[0])}</div>`);
      continue;
    }
    if (isUser(entry)) html.push(renderUser(entry));
    else if (isAssistant(entry)) html.push(renderAssistant(entry));
    index += 1;
  }
  return html.filter(Boolean).join("\n");
}

function isUser(entry) {
  return entry?.type === "user" || entry?.role === "user";
}

function isAssistant(entry) {
  return entry?.type === "assistant" || entry?.role === "assistant";
}

function isTool(entry) {
  return entry?.type === "tool" || entry?.role === "tool";
}

function renderUser(entry) {
  const text = entryText(entry);
  const images = entryImages(entry).map(renderImage).join("");
  if (!text && !images) return "";
  return `<article class="example-turn example-user">${text ? `<div class="example-user-text">${escapeHtml(text)}</div>` : ""}${images}</article>`;
}

function renderAssistant(entry) {
  const text = entryText(entry);
  const images = entryImages(entry).map(renderImage).join("");
  if (!text && !images) return "";
  return `<article class="example-turn example-assistant">${text ? renderMarkdown(text) : ""}${images}</article>`;
}

function renderToolGroup(group) {
  return `<details class="example-turn example-tools"><summary data-steps="${group.length}">${group.length} steps</summary><div class="example-tool-list">${group.map(renderTool).join("")}</div></details>`;
}

function renderTool(entry) {
  const name = escapeHtml(entry?.name || "tool");
  const arg = escapeHtml(shortArg(entry));
  const body = toolBody(entry);
  return `<details class="example-tool"><summary><span class="example-tool-name">${name}</span>${arg ? `<span class="example-tool-arg">${arg}</span>` : ""}</summary>${body ? `<pre class="example-tool-body">${escapeHtml(body)}</pre>` : ""}</details>`;
}

function renderImage(image) {
  const src = safeUrl(image.src);
  if (!src) return "";
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(image.alt || "")}" loading="lazy" decoding="async">`;
}

function entryText(entry) {
  if (typeof entry?.text === "string" && entry.text) return entry.text;
  return textFromContent(entry?.content);
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text") return String(part.text ?? "");
    return "";
  }).filter(Boolean).join("\n");
}

function imagesFromContent(content) {
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    const src = part?.image_url?.url || "";
    return part?.type === "image_url" && src ? [{ src, alt: "" }] : [];
  });
}

function entryImages(entry) {
  const images = [];
  if (Array.isArray(entry?.images)) {
    for (const image of entry.images) {
      const src = image?.dataUrl || image?.url || "";
      if (src) images.push({ src, alt: image?.name || "" });
    }
  }
  images.push(...imagesFromContent(entry?.content));
  return images;
}

function toolArguments(message) {
  const raw = message?.tool_calls?.[0]?.function?.arguments;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return JSON.stringify(raw, null, 2);
  return "";
}

function shortArg(entry) {
  const raw = typeof entry?.argsText === "string" && entry.argsText
    ? entry.argsText
    : pickArg(entry?.args);
  const one = String(raw || "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length <= 72 ? one : `${one.slice(0, 71)}…`;
}

function pickArg(args) {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function toolBody(entry) {
  const parts = [];
  if (typeof entry?.argsText === "string" && entry.argsText) parts.push(entry.argsText);
  else if (entry?.args !== undefined) parts.push(typeof entry.args === "string" ? entry.args : JSON.stringify(entry.args, null, 2));
  if (typeof entry?.result === "string") parts.push(entry.result);
  else if (entry?.result !== undefined) parts.push(JSON.stringify(entry.result, null, 2));
  else if (typeof entry?.text === "string" && entry.text) parts.push(entry.text);
  return parts.filter(Boolean).join("\n\n");
}

function safeUrl(value) {
  const src = String(value || "").trim();
  if (src.startsWith("data:image/") || src.startsWith("https://") || src.startsWith("http://") || src.startsWith("./") || src.startsWith("../")) return src;
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(source) {
  const text = String(source || "").replace(/\r\n/g, "\n");
  const blocks = [];
  const pattern = /```[^\n]*\n([\s\S]*?)```/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) blocks.push(renderMarkdownBlocks(text.slice(last, match.index)));
    blocks.push(`<pre class="example-code"><code>${escapeHtml(match[1].replace(/\n$/, ""))}</code></pre>`);
    last = match.index + match[0].length;
  }
  blocks.push(renderMarkdownBlocks(text.slice(last)));
  return blocks.join("");
}

function renderMarkdownBlocks(source) {
  const lines = String(source || "").split("\n");
  const html = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      const table = [];
      while (index < lines.length && lines[index].includes("|")) table.push(lines[index++]);
      html.push(renderTable(table));
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(lines[index]);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 4);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(lines[index])) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(lines[index])) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      html.push(`<ol>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</ol>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isTableStart(lines, index) && !/^(#{1,3})\s+/.test(lines[index]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    html.push(`<p>${inline(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
  }
  return html.join("");
}

function isTableStart(lines, index) {
  return lines[index].includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1]);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(lines) {
  const rows = lines.filter((line) => !/^\s*\|?\s*:?-{3,}/.test(line));
  if (!rows.length) return "";
  const head = splitRow(rows[0]);
  const body = rows.slice(1).map(splitRow);
  return `<div class="example-table-wrap"><table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function inline(value) {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    const src = safeUrl(url);
    return src ? `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async">` : escapeHtml(`![${alt}](${url})`);
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const href = safeUrl(url);
    return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
  });
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function runSelfTest() {
  const raw = `<script id="qingzhou-session-exchange" type="application/json">${JSON.stringify({
    format: "qingzhou.session",
    version: 1,
    session: {
      transcript: [
        { type: "user", text: "看 <西湖>" },
        { type: "tool", name: "open_tab", args: { url: "https://example.com/a" }, result: "ok" },
        { type: "tool", name: "read_page", argsText: "https://example.com/b", result: "body" },
        { type: "assistant", content: "结果\n\n| 时段 | 安排 |\n| --- | --- |\n| 08:30 | 断桥 |\n\n- 一项" },
      ],
    },
  })}</script>`;
  const html = renderSessionHtml(raw);
  if (!html.includes("看 &lt;西湖&gt;")) throw new Error("user text changed");
  if (!html.includes('class="example-table-wrap"') || !html.includes("<td>断桥</td>")) throw new Error("table was not rendered");
  if (!html.includes("<li>一项</li>")) throw new Error("list was not rendered");
  if (!html.includes('data-steps="2"') || !html.includes("open_tab") || !html.includes("read_page")) throw new Error("tools were not grouped");
  if (html.includes("<iframe") || html.includes("待定")) throw new Error("renderer added a frame or a draft mark");
  const long = "x".repeat(80);
  const truncated = renderSessionHtml(`<script id="qingzhou-session-exchange" type="application/json">${JSON.stringify({
    session: { transcript: [{ type: "tool", name: "search", argsText: long }] },
  })}</script>`);
  const summary = truncated.match(/<summary>[\s\S]*?<\/summary>/)?.[0] || "";
  if (!summary.includes(`${"x".repeat(71)}…`) || summary.includes(long) || !truncated.includes(long)) throw new Error("tool summary was not shortened");
  console.log("render-session self-test passed");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href && process.argv.includes("--self-test")) runSelfTest();
