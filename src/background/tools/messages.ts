import { defineMessages } from "../../shared/i18n/definition.js";
import { createTranslator } from "../../shared/i18n/index.js";

/** Shared model-facing documentation stays out of the panel's UI catalog. */
const messages = defineMessages("tool-runtime", {
  timeout: {
    "zh-CN": "工具硬超时，单位秒。不填时系统按工具类型给出默认值。",
    en: "Hard timeout in seconds. If omitted, the runtime uses the default for this tool type.",
  },
  elementReference: {
    "zh-CN": "元素引用：{grammar}。UID 来自工具结果，CSS 匹配当前页面；快照别名须显式 tabId，限当前 Session/tab 快照使用。",
    en: "Element reference: {grammar}. UIDs come from tool results; CSS matches the current page. Snapshot aliases require explicit tabId and the current Session/tab snapshot.",
  },
  nextPageSelector: { "zh-CN": "下一页", en: "Next page" },
  commentSelector: { "zh-CN": "评论", en: "Comment" },
});

export const t = createTranslator(messages);
