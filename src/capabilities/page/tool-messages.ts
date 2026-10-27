import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

const messages = defineMessages("page-tools", {
  readArticleDescription: {
    "zh-CN": "读取页面正文 Markdown，保留标题、列表、链接、代码和表格。返回 offset/limit 片段、totalChars/hasMore/nextOffset/sourceSelector/linkCount；outline 的 offset/endOffset/charCount 可定位章节，sourceSelector 可用于 read_dom。",
    en: "Read page content as Markdown with headings, lists, links, code and tables. Returns the offset/limit segment and totalChars/hasMore/nextOffset/sourceSelector/linkCount. outline entries locate sections by offset/endOffset/charCount; sourceSelector scopes read_dom.",
  },
  readArticleTabId: { "zh-CN": "目标 tabId，默认工作标签页；别名与流程内页面调用须显式填写。", en: "Target tabId, default working tab; explicit for aliases and page calls inside flows." },
  readArticleSource: { "zh-CN": "来源，默认 auto：选中文本、提取正文、main/body 依次选用。", en: "Source, default auto: selected text, extracted content, then main/body." },
  readArticleSelector: { "zh-CN": "source=selector 的范围：原始 CSS、css:、完整 uid: 或当前快照别名。", en: "Scope for source=selector: raw CSS, css:, full uid: or current snapshot alias." },
  readArticleOffset: { "zh-CN": "正文字符起始位置，默认 0。", en: "Starting character offset, default 0." },
  readArticleLimit: { "zh-CN": "必填，返回字符数，最大 20000；nextOffset 为下一段起点。", en: "Required character count, maximum 20000; nextOffset starts the next segment." },
  readDomDescription: {
    "zh-CN": "分段读取实时 DOM HTML，返回原始 HTML、行号与 totalLines。selector 限定范围，offset/limit 指定行段，可读取 find_elements 的 lineRange。",
    en: "Read live DOM HTML in segments, with line numbers and totalLines. selector scopes the read; offset/limit selects a line range, including lineRange from find_elements.",
  },
  readDomOffset: { "zh-CN": "起始行号，从 1 开始，默认 1。", en: "Starting line, 1-indexed, default 1." },
  readDomLimit: { "zh-CN": "读取行数，默认 200。", en: "Line count, default 200." },
  readDomSelector: { "zh-CN": "读取范围，默认 body；接受原始 CSS、css:、完整 uid: 或当前快照别名。", en: "Read scope, default body; accepts raw CSS, css:, full uid: or current snapshot alias." },
  findElementsDescription: {
    "zh-CN": "按范围、语义和可选文本正则查找元素，优先排列可操作、可见及匹配明确的候选。返回 target、selector、role/name/text/rect/actionable/inViewport/lineRange，可直接用于元素读取与操作。",
    en: "Find elements by scope, semantics and optional text regex, prioritizing actionable, visible and specific matches. Returns target, selector, role/name/text/rect/actionable/inViewport/lineRange for element reads and actions.",
  },
  findElementsPattern: { "zh-CN": "可选 JavaScript 正则，匹配文本、aria、placeholder、class、id、href 等。", en: "Optional JavaScript regex matching text, aria, placeholder, class, id, href and related fields." },
  findElementsFlags: { "zh-CN": "正则 flags，默认 i。", en: "Regex flags, default i." },
  findElementsSelector: { "zh-CN": "查找范围，默认 body；接受原始 CSS、css:、完整 uid: 或当前快照别名。", en: "Search scope, default body; accepts raw CSS, css:, full uid: or current snapshot alias." },
  findElementsRoles: { "zh-CN": "role 过滤，如 button/link/textbox/checkbox。", en: "Role filter, such as button/link/textbox/checkbox." },
  findElementsTags: { "zh-CN": "tag 过滤，如 button/a/input/div。", en: "Tag filter, such as button/a/input/div." },
  findElementsTypes: { "zh-CN": "input type 过滤，如 text/search/submit。", en: "Input type filter, such as text/search/submit." },
  findElementsLimit: { "zh-CN": "最多返回数量，默认 20。", en: "Maximum results, default 20." },
  findElementsIncludeHidden: { "zh-CN": "包含隐藏元素，默认 false。", en: "Include hidden elements, default false." },
  inspectElementDescription: {
    "zh-CN": "读取元素细节：匹配数、文本/aria/attrs、可见性、disabled、rect、clickablePoint、表单与附近文本。{targetGrammar}。",
    en: "Read element details: match count, text/aria/attrs, visibility, disabled state, rect, clickablePoint, form and nearby text. {targetGrammar}.",
  },
  inspectElementIndex: { "zh-CN": "CSS 多匹配时的序号，默认 0。", en: "Index for multiple CSS matches, default 0." },
  uploadFilesDescription: {
    "zh-CN": "将提供的文件内容设置到文件输入框并触发 input/change，返回选择结果。target 使用元素引用；files 含文件名、内容、可选 MIME 与 utf8/base64 编码，[] 清空选择。限 5 个文件、共 512 KiB；表单提交单独调用，本机文件选择通过 wait_for_user。",
    en: "Set supplied content on a file input, dispatch input/change and return the selection result. target uses an element reference; files contains name, content, optional MIME and utf8/base64 encoding; [] clears selection. Limit: five files, 512 KiB total. Submission is a separate action; local file selection uses wait_for_user.",
  },
  uploadFilesContent: { "zh-CN": "文件名和内容数组，编码默认 utf8，二进制使用 base64。", en: "Filenames and content; encoding defaults to utf8, with base64 for binary data." },
  actOnElementDescription: {
    "zh-CN": "执行一次元素动作，也可在 run_flow 中调用。click 发送浏览器点击（移动模式为触摸）；fill 填写输入框/textarea/contenteditable，多行富文本返回段落结构；press 发送按键；select 按精确 option.value 或去除首尾空白的 label 选择原生选项；check/uncheck 设置勾选状态；scroll 滚到元素。返回动作结果、适用的 pageAfter/urlChanged/titleChanged 或错误诊断；run_flow 另带最终快照。{targetGrammar}。",
    en: "Execute one element action, directly or inside run_flow. click sends browser input (touch in mobile mode); fill writes input/textarea/contenteditable and reports paragraph structure for multiline rich text; press sends keys; select matches a native option by exact value, then trimmed label; check/uncheck sets checked state; scroll brings the element into view. Returns the action result, applicable pageAfter/urlChanged/titleChanged or error diagnostics. run_flow also supplies a final snapshot. {targetGrammar}.",
  },
  actOnElementValue: { "zh-CN": "fill 文本、select 的 value/label 或 press 按键。", en: "Fill text, select value/label or press key." },
  actOnElementKey: { "zh-CN": "press 按键，如 Enter/Escape/Tab/ArrowDown；key 或 value 必填。", en: "Press key, such as Enter/Escape/Tab/ArrowDown; key or value is required." },
  actOnElementSubmit: { "zh-CN": "fill 后发送 Enter，默认 false；提交结果由页面处理决定。", en: "Send Enter after fill, default false; page handlers determine the submission outcome." },
  scrollPageDescription: { "zh-CN": "按 direction/pixels 滚动页面，或按 target 滚到元素，返回滚动结果。", en: "Scroll by direction/pixels or bring target into view; returns the scroll result." },
  scrollPagePixels: { "zh-CN": "滚动像素数，默认 500。", en: "Scroll distance in pixels, default 500." },
  scrollPageTarget: { "zh-CN": "滚动目标。{targetDescription}", en: "Scroll target. {targetDescription}" },
  scrollPageIndex: { "zh-CN": "CSS 多匹配时的序号，默认 0。", en: "Index for multiple CSS matches, default 0." },
});

export const toolT = createTranslator(messages);
