import { defineMessages } from "../../shared/i18n/definition.js";
import { createTranslator } from "../../shared/i18n/index.js";

/** Shared model-facing documentation stays out of the panel's UI catalog. */
const messages = defineMessages("tool-runtime", {
  timeout: {
    "zh-CN": "工具硬超时，单位秒。不填时系统按工具类型给出默认值。",
    en: "Hard timeout in seconds. If omitted, the runtime uses the default for this tool type.",
  },
  elementReference: {
    "zh-CN": "元素机器引用，格式：{grammar}。element_uid 必须来自 get_ax_tree/find_elements/list_images 返回的 uid；css_selector 必须能被当前页面 querySelector/querySelectorAll 匹配。示例：{examples}。不要传按钮文案、页面标题、URL 或自然语言。",
    en: "Machine-readable element reference: {grammar}. element_uid must be a uid returned by get_ax_tree/find_elements/list_images; css_selector must match the current page via querySelector/querySelectorAll. Examples: {examples}. Do not pass button text, page titles, URLs, or natural-language descriptions.",
  },
  nextPageSelector: { "zh-CN": "下一页", en: "Next page" },
  commentSelector: { "zh-CN": "评论", en: "Comment" },
  contentScriptUnavailable: { "zh-CN": "内容脚本不可用。请重新加载页面后再试。", en: "Content script is not available. Reload the page and retry." },
  elementContextUnsupported: { "zh-CN": "元素不在顶层文档中。请重新 get_ax_tree，并改用顶层文档里的目标。", en: "The element is not in the top document. Take a fresh get_ax_tree and use a top-document target." },
  elementIndexRequired: { "zh-CN": "选择器匹配了 {count} 个元素。请传入 index，或改用唯一的 css 选择器 / uid。", en: "Selector matched {count} elements. Pass index, or use a unique css selector or uid." },
  elementIndexRequiredScope: { "zh-CN": "选择器匹配了 {count} 个元素。这个读取需要唯一选择器或 uid。", en: "Selector matched {count} elements. This read needs a unique selector or a uid." },
});

export const t = createTranslator(messages);
