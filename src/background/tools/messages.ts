import { defineMessages } from "../../shared/i18n/definition.js";
import { createTranslator } from "../../shared/i18n/index.js";

/** Shared model-facing documentation stays out of the panel's UI catalog. */
const messages = defineMessages("tool-runtime", {
  timeout: {
    "zh-CN": "超时秒数；省略时用默认超时。",
    en: "Timeout in seconds; defaults to the tool default.",
  },
  elementReference: {
    "zh-CN": "元素引用（{grammar}）。element_uid 取自 get_ax_tree/find_elements/list_images 的 uid；css_selector 须能被 querySelector/querySelectorAll 匹配（例：{examples}）。禁止传按钮文案、标题、URL 或自然语言。",
    en: "Element reference ({grammar}). element_uid comes from get_ax_tree/find_elements/list_images; css_selector must match via querySelector/querySelectorAll (e.g. {examples}). Never pass button text, titles, URLs, or natural language.",
  },
  nextPageSelector: { "zh-CN": "下一页", en: "Next page" },
  commentSelector: { "zh-CN": "评论", en: "Comment" },
});

export const t = createTranslator(messages);
