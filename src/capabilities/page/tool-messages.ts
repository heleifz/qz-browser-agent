import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("page-tools", {
  readArticleDescription: {
    "zh-CN": "读取整理后的正文 Markdown，保留标题、列表、链接、代码和表格，适用于文章、文档、搜索摘要和长文本。返回 offset/limit 指定片段及 totalChars/hasMore/nextOffset/sourceSelector/linkCount。outline 条目含 offset/endOffset/charCount，可据此设置 offset/limit 读取章节；sourceSelector 可交给 read_dom 验证 DOM。",
    en: "Read cleaned main content as Markdown, preserving headings, lists, links, code, and tables for articles, documents, search summaries, and long text. Returns the offset/limit segment and totalChars/hasMore/nextOffset/sourceSelector/linkCount. outline entries provide offset/endOffset/charCount for section reads via offset/limit; pass sourceSelector to read_dom for DOM evidence.",
  },
  readArticleTabId: {
    "zh-CN": "本次调用的目标标签页 ID；省略时使用当前任务工作标签页。",
    en: "Target tab ID for this call. Defaults to the current task’s working tab.",
  },
  readArticleSource: {
    "zh-CN": "读取来源，默认 auto：选中文本优先，其次自动整理正文，最后 main/body",
    en: "Content source. Default: auto, which prefers selected text, then extracted main content, then main/body.",
  },
  readArticleSelector: {
    "zh-CN": "source=selector 时读取的范围；可传原始 CSS，也可传 target 格式 css:... / uid:...",
    en: "Scope to read when source=selector. Accepts a raw CSS selector or a css:... / uid:... target.",
  },
  readArticleOffset: {
    "zh-CN": "正文字符起始 offset，默认 0",
    en: "Starting character offset in the main text. Default: 0.",
  },
  readArticleLimit: {
    "zh-CN": "必填。返回字符数，建议 4000-8000，最大 20000；继续读下一段时传上次返回的 nextOffset",
    en: "Required number of characters to return. Recommended: 4000–8000; maximum: 20000. To continue reading, pass nextOffset from the previous result.",
  },
  readDomDescription: {
    "zh-CN": "分页读取目标页面的实时 DOM HTML 原始片段。返回原始 HTML 和行号，支持指定起始行和行数进行分段读取，总是返回 totalLines 方便后续继续读取。用于读取 find_elements 返回的 line/lineRange，或验证隐藏字段、form/action、id/class/data-testid、p/br 等 DOM 结构。",
    en: "Read paginated raw HTML from the target page’s live DOM. Returns raw HTML with line numbers, accepts a starting line and line count, and always returns totalLines for continued reading. Use to read line/lineRange returned by find_elements, or to verify DOM structure such as hidden fields, form/action, id/class/data-testid, or p/br.",
  },
  readDomOffset: {
    "zh-CN": "起始行号（1-indexed），默认 1",
    en: "Starting line number, 1-indexed. Default: 1.",
  },
  readDomLimit: {
    "zh-CN": "读取行数，默认 200",
    en: "Number of lines to read. Default: 200.",
  },
  readDomSelector: {
    "zh-CN": "限定读取范围，默认 body；可传原始 CSS，也可传 target 格式 css:... / uid:...",
    en: "Scope to read. Default: body. Accepts a raw CSS selector or a css:... / uid:... target.",
  },
  findElementsDescription: {
    "zh-CN": "按范围、语义和可选正则查找元素，包括按钮、链接、输入框、列表项、文本和容器；优先返回可操作、可见、匹配明确的候选。省略 pattern 时列出 selector/tags/roles/types 命中项。返回供 inspect_element/act_on_element 使用的 target、stable selector 和 role/name/text/rect/actionable/inViewport/lineRange 摘要；用 read_dom 读取对应行号的原始 DOM。",
    en: "Find elements by scope, semantics, and optional regex, including buttons, links, inputs, list items, text, and containers. Prioritize actionable, visible, specific matches. Without pattern, list selector/tags/roles/types matches. Returns target for inspect_element/act_on_element, stable selector, and role/name/text/rect/actionable/inViewport/lineRange summaries; read_dom reads the corresponding raw DOM lines.",
  },
  findElementsPattern: {
    "zh-CN": "可选 JavaScript RegExp pattern，用于匹配文本、aria、placeholder、class、id、href 等；不传则列出范围内候选元素。",
    en: "Optional JavaScript RegExp pattern to match text, aria, placeholder, class, id, href, and similar fields. If omitted, lists candidates within the scope.",
  },
  findElementsFlags: {
    "zh-CN": "RegExp flags，默认 i",
    en: "RegExp flags. Default: i.",
  },
  findElementsSelector: {
    "zh-CN": "限定查找范围，默认 body；可传原始 CSS，也可传 target 格式 css:... / uid:...",
    en: "Search scope. Default: body. Accepts a raw CSS selector or a css:... / uid:... target.",
  },
  findElementsRoles: {
    "zh-CN": "可选 role 过滤，如 button/link/textbox/checkbox",
    en: "Optional role filter, such as button/link/textbox/checkbox.",
  },
  findElementsTags: {
    "zh-CN": "可选 tag 过滤，如 button/a/input/div",
    en: "Optional tag filter, such as button/a/input/div.",
  },
  findElementsTypes: {
    "zh-CN": "可选 input type 过滤，如 text/search/submit",
    en: "Optional input type filter, such as text/search/submit.",
  },
  findElementsLimit: {
    "zh-CN": "最多返回数量，默认 20",
    en: "Maximum number of results. Default: 20.",
  },
  findElementsIncludeHidden: {
    "zh-CN": "是否包含不可见元素，默认 false",
    en: "Whether to include hidden elements. Default: false.",
  },
  inspectElementDescription: {
    "zh-CN": "检查 get_ax_tree/find_elements 返回的 target：匹配数、文本/aria/attrs、可见性、disabled、rect、clickablePoint、表单和附近文本。{targetGrammar}。",
    en: "Inspect a target from get_ax_tree/find_elements: match count, text/aria/attrs, visibility, disabled state, rect, clickablePoint, form, and nearby text. {targetGrammar}.",
  },
  inspectElementIndex: {
    "zh-CN": "匹配多个时的 index，默认 0",
    en: "Match index when multiple elements match. Default: 0.",
  },
  actOnElementDescription: {
    "zh-CN": "对元素执行高层动作。常规操作只用这个工具：click=真实点击按钮/链接/自定义选项（移动模式自动使用触摸）；fill=填写输入框/textarea/contenteditable，contenteditable 多行文本会尝试按富文本段落插入并返回 p/br/block 结构；press=按键如 Enter；select=选择原生 <select> 的 option（优先精确匹配 option.value，否则匹配可见 label，label 忽略首尾空白）；check/uncheck=勾选；scroll=滚到元素。必须先从 get_ax_tree/find_elements 获取 target。本地文件选择通过 wait_for_user 交给用户完成。{targetGrammar}。失败会返回元素诊断和可选候选。",
    en: "Perform a high-level action on an element. Use this tool for routine interactions: click sends a real click to a button/link/custom option, using touch in mobile mode; fill enters text into an input/textarea/contenteditable, attempting rich-text paragraphs for multiline contenteditable text and returning p/br/block structure; press sends a key such as Enter; select chooses an option in a native <select> by exact option.value first, or by visible label (surrounding whitespace ignored) if no value matches; check/uncheck toggles a checkbox; scroll scrolls to an element. Obtain the target from get_ax_tree/find_elements first. Use wait_for_user for the user to select local files. {targetGrammar}. Failures return element diagnostics and optional alternatives.",
  },
  actOnElementValue: {
    "zh-CN": "fill 的文本，或原生 select 的 option.value / 可见 label（精确 value 优先）；press 也可用作 key。例如 fill 搜索词，press Enter",
    en: "Text for fill, or an option.value / visible label for a native select (exact value takes priority). Can also supply the key for press. For example, fill a search query, then press Enter.",
  },
  actOnElementKey: {
    "zh-CN": "press 的按键，如 Enter/Escape/Tab/ArrowDown。press 时 key 或 value 必填",
    en: "Key for press, such as Enter/Escape/Tab/ArrowDown. press requires either key or value.",
  },
  actOnElementSubmit: {
    "zh-CN": "fill 后是否发送 Enter，默认 false；页面可以拦截按键，因此不保证提交成功。也可在检查输入后单独 press Enter",
    en: "Send Enter after filling. Default: false. Page handlers may prevent submission. You can also inspect the field and then press Enter separately.",
  },
  scrollPageDescription: {
    "zh-CN": "滚动页面；需要滚到指定元素时传 target，普通上下滚动只传 direction/pixels。",
    en: "Scroll the page. Provide target to scroll to a specific element; for ordinary scrolling, provide only direction/pixels.",
  },
  scrollPagePixels: {
    "zh-CN": "滚动像素数，默认 500",
    en: "Scroll distance in pixels. Default: 500.",
  },
  scrollPageTarget: {
    "zh-CN": "滚动到指定元素时使用。{targetDescription}",
    en: "Target to scroll into view. {targetDescription}",
  },
  scrollPageIndex: {
    "zh-CN": "target 为 css:... 且匹配多个时的 index，默认 0",
    en: "Match index when a css:... target matches multiple elements. Default: 0.",
  },
});

export const toolT = createTranslator(messages);
