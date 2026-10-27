import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

const messages = defineMessages("tabs-tools", {
  pageMode: { "zh-CN": "desktop（默认）或 mobile（Android Chrome，412×915，触摸）。", en: "desktop (default) or mobile (Android Chrome, 412×915, touch)." },
  setPageModeDescription: {
    "zh-CN": "设置任务拥有页面的 desktop/mobile 模式，返回当前模式。模式变化会刷新页面并使旧引用和截图坐标失效；相同模式保持页面。移动模式持续到切回桌面、关页或删除任务；连接恢复可能刷新页面。",
    en: "Set desktop/mobile mode on an owned page and return its current mode. A mode change reloads the page and expires references and screenshot coordinates; selecting the same mode preserves the page. Mobile mode lasts until desktop mode, tab closure or task deletion; connection restoration may reload the page.",
  },
  modeContextTitle: { "zh-CN": "页面模式", en: "Page mode" },
  modeResume: { "zh-CN": "下一次页面操作将恢复移动模式并刷新，随后可获取新的页面观察。", en: "The next page call restores mobile mode and reloads; fresh observations are then available." },
  modeChanging: { "zh-CN": "页面模式切换中。", en: "Page mode is changing." },
  listTabsDescription: {
    "zh-CN": "列出网页 tab 的 id、标题、URL、pageMode 与可用性。active 为用户可见页，isWorkingTab 为工作页，ownedByCurrentTask 为当前任务拥有页；claimRequired 表示 use_tab 可认领，readOnlyUsable 表示可显式 tabId 只读。contentAccess=blocked 的页面提供元信息。",
    en: "List web tab IDs, titles, URLs, pageMode and availability. active marks the user-visible tab, isWorkingTab the working tab, and ownedByCurrentTask ownership. claimRequired permits claiming with use_tab; readOnlyUsable permits explicit-tabId reads. contentAccess=blocked exposes metadata only.",
  },
  getWorkingTabDescription: { "zh-CN": "返回工作标签页的 hasWorkingTab、id、标题、URL 和 pageMode；contentAccess=blocked 表示仅可读取元信息。", en: "Return working-tab hasWorkingTab, id, title, URL and pageMode. contentAccess=blocked permits metadata reads only." },
  openTabDescription: {
    "zh-CN": "打开并认领新的工作标签页，在目标文档导航提交后返回 id 与页面元信息。动态内容可通过条件等待确认；watchNetwork:true 从导航前记录请求，可用 network_recent 读取。",
    en: "Open and claim a new working tab; return id and page metadata once the destination document commits. Condition waits can track dynamic content. watchNetwork:true records requests from before navigation for network_recent.",
  },
  openTabUrl: { "zh-CN": "HTTP/HTTPS 或已获文件访问权限的 file:// URL；mode:mobile 从首次请求生效。", en: "HTTP/HTTPS or file-access-authorized file:// URL; mode:mobile applies from the first request." },
  openTabWatchNetwork: { "zh-CN": "导航前开始记录首屏、重定向与加载请求。", en: "Record initial-load, redirect and loading requests from before navigation." },
  openTabResetNetwork: { "zh-CN": "watchNetwork=true 时清空已有记录，默认 true。", en: "Clear existing records when watchNetwork=true, default true." },
  openTabNetworkMaxRecords: { "zh-CN": "请求记录上限，默认 200，范围 20–1000。", en: "Request record limit, default 200, range 20–1000." },
  closeTabDescription: { "zh-CN": "关闭任务拥有的标签页，返回关闭结果。", en: "Close an owned tab and return the result." },
  closeTabTabId: { "zh-CN": "目标 tabId。", en: "Target tabId." },
  useTabDescription: { "zh-CN": "将任务拥有或无人认领的网页设为工作标签页，返回页面元信息；用户可见标签页保持当前选择。", en: "Select an owned or unclaimed web tab as the working tab and return page metadata; the user-visible tab keeps its selection." },
  navigateDescription: {
    "zh-CN": "将工作标签页或指定的任务拥有 tab 导航到 URL，文档提交后返回页面元信息。动态内容可通过条件等待确认；watchNetwork:true 记录本次导航请求，可用 network_recent 读取。",
    en: "Navigate the working tab or an explicit owned tab to URL and return page metadata after document commit. Condition waits can track dynamic content. watchNetwork:true records this navigation's requests for network_recent.",
  },
  navigateUrl: { "zh-CN": "HTTP/HTTPS 或已获文件访问权限的 file:// URL。", en: "HTTP/HTTPS or file-access-authorized file:// URL." },
  navigateTabId: { "zh-CN": "目标 tabId，默认工作标签页；流程内须显式填写。", en: "Target tabId, default working tab; explicit inside flows." },
  navigateWatchNetwork: { "zh-CN": "导航前开始记录本次导航请求。", en: "Start recording requests before this navigation." },
  workingTabSelected: { "zh-CN": "已设为工作标签页，用户可见页保持当前选择。", en: "Working tab selected; the user-visible tab keeps its selection." },
});

export const toolT = createTranslator(messages);
