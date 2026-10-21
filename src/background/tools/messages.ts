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
  frameContentReadOnly: {
    "zh-CN": "这个 target 在 iframe 内，不能用 act_on_element 或 inspect_element。带 frame= 且没有 target 的行只阅读。嵌入页能独立打开时用 navigate/open_tab 打开该 url；依赖父页面时说明限制后停止。",
    en: "This target is inside an iframe and cannot be used with act_on_element or inspect_element. Lines marked frame= have no target and are read-only. When the embedded page works on its own, open that url with navigate/open_tab. When it depends on the parent page, state that limit and stop.",
  },
  nextPageSelector: { "zh-CN": "下一页", en: "Next page" },
  commentSelector: { "zh-CN": "评论", en: "Comment" },
});

export const t = createTranslator(messages);
