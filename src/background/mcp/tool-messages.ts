import { defineMessages } from "../../shared/i18n/definition.js";
import { createTranslator } from "../../shared/i18n/index.js";

/** Direct-drive documentation; the built-in Agent keeps its own targeting policy. */
const messages = defineMessages("drive-tools", {
  listTabs: {
    "zh-CN": "列出网页标签页及 tabRef、标题、URL、归属和可用性。active 表示用户正在看的标签，不用于隐式选页；页面工具仍须显式传 tabRef。默认只列本会话标签，scope=all 查看其他网页。",
    en: "List web pages with tabRef, title, URL, ownership and availability. active marks the tab visible to the user, never an implicit tool target. Page tools require explicit tabRef. Defaults to this session; scope=all includes other web pages.",
  },
  navigate: {
    "zh-CN": "导航 tabRef 指定且属于本会话的页面，等待导航提交后返回。资源和动态内容可能继续加载；watchNetwork:true 在跳转前启用网络监听，可用 network_recent 查看请求。",
    en: "Navigate the session-owned page specified by tabRef and wait for navigation to commit. Resources and dynamic content may still load. watchNetwork:true starts monitoring before navigation; inspect requests with network_recent.",
  },
  pageReference: {
    "zh-CN": "从 open_tab 或 list_tabs 获取页面引用，并显式传入 tabRef。",
    en: "Get a page reference from open_tab or list_tabs and pass tabRef explicitly.",
  },
  unavailable: {
    "zh-CN": "此工具不对直驱开放。请查询可用工具；页面操作显式传入 tabRef。",
    en: "This tool is unavailable in direct drive. Query the available tools and pass tabRef explicitly for page operations.",
  },
});
export const driveToolText = createTranslator(messages);
