import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("tabs-tools", {
  pageMode: {
    "zh-CN": "desktop（桌面端，默认）或 mobile（Android Chrome，412×915，支持触摸）。",
    en: "desktop (default) or mobile (Android Chrome, 412×915, touch enabled).",
  },
  setPageModeDescription: {
    "zh-CN": "切换当前任务拥有页面的 desktop / mobile 模式。模式变化会自动刷新页面（相同模式不刷新）；切换后必须重新观察页面，禁止复用旧元素 target 或截图坐标。有未保存表单时不要切换。",
    en: "Switch a task-owned page between desktop and mobile mode. Changing the mode reloads the page (setting the same mode does not reload); re-observe the page afterward and never reuse old element targets or screenshot coordinates. Do not switch modes with unsaved form input.",
  },
  modeContextTitle: { "zh-CN": "页面模式", en: "Page mode" },
  modeResume: { "zh-CN": "下一次任务内页面操作会恢复移动模式并刷新。请先重新观察页面，再操作。", en: "The next owned-page tool restores mobile mode and reloads. Observe the page again before interacting." },
  modeChanging: { "zh-CN": "页面模式正在切换，请等待完成后重新观察。", en: "Page mode is changing. Wait, then observe the page again." },
  listTabsDescription: {
    "zh-CN": "列出所有打开的普通网页标签页及角色与可用性（忽略 chrome://、扩展页、新标签页等非网页 tab）：pageMode 为当前 desktop/mobile 模式；active=true 表示用户可见标签页，isWorkingTab=true 表示当前任务工作标签页，ownedByCurrentTask=true 表示当前任务拥有该标签页；claimRequired=true 表示可用 use_tab 认领为当前任务工作标签页；readOnlyUsable=true 表示可用只读页面工具显式传 tabId 查看。命中安全护栏的标签页返回标题/URL/tabId 且标记 contentAccess=blocked。",
    en: "List all open web tabs with their roles and availability (excluding non-web tabs such as chrome://, extension pages, and new-tab pages): pageMode reports desktop/mobile mode; active=true marks the user-visible tab; isWorkingTab=true marks the current task's working tab; ownedByCurrentTask=true means the current task owns the tab; claimRequired=true means use_tab can claim the unclaimed tab; readOnlyUsable=true means read-only page tools can inspect it with an explicit tabId. Tabs blocked by security guardrails return title/URL/tabId with contentAccess=blocked.",
  },
  getWorkingTabDescription: {
    "zh-CN": "读取当前任务的工作标签页。没有工作标签页时返回 hasWorkingTab=false；存在时返回 hasWorkingTab=true、pageMode 及页面元信息。若命中安全护栏，标记 contentAccess=blocked，后续不要读取其页面内容。",
    en: "Read the current task's working tab. Returns hasWorkingTab=false if none exists, or hasWorkingTab=true with pageMode and tab metadata. If blocked by security guardrails, returns contentAccess=blocked; do not read its page content.",
  },
  openTabDescription: {
    "zh-CN": "打开新网页标签页并设为当前任务工作标签页，等待文档导航提交后返回（可紧接调用页面读取工具）。需捕获首屏、重定向或加载期接口时传 watchNetwork:true（导航前开启 Network 监听，加载后用 network_recent / network_body 查看）；监听已打开页面中点击、搜索等后续交互请求用 network_watch。",
    en: "Open a new web tab as the current task's working tab and return once navigation commits (page-reading tools can follow immediately). Pass watchNetwork:true to start network monitoring before navigation and capture initial load and redirect requests (inspect with network_recent / network_body); use network_watch for subsequent interaction requests on an open page.",
  },
  openTabUrl: {
    "zh-CN": "要打开的 HTTP/HTTPS URL（或已开启文件网址访问权限的 file:// URL）；需要移动版页面时同时传 mode:\"mobile\"。",
    en: "HTTP/HTTPS URL (or a file:// URL when file URL access is enabled). Set mode:\"mobile\" to load in mobile mode from the first request.",
  },
  openTabWatchNetwork: {
    "zh-CN": "是否在导航前开启 Network 监听以捕获首屏和重定向请求，默认 false；页面已打开后的交互监听请用 network_watch。",
    en: "Start network monitoring before navigation to capture initial load and redirect requests. Default: false. Use network_watch for interactions on an already open page.",
  },
  openTabResetNetwork: {
    "zh-CN": "watchNetwork=true 时是否清空该 tab 已有网络记录，默认 true。",
    en: "Clear existing network records for this tab when watchNetwork=true. Default: true.",
  },
  openTabNetworkMaxRecords: {
    "zh-CN": "watchNetwork=true 时最多保留的请求数，默认 200，范围 20–1000。",
    en: "Maximum network requests to retain when watchNetwork=true. Default: 200; range: 20–1000.",
  },
  closeTabDescription: {
    "zh-CN": "关闭当前任务拥有的指定标签页。",
    en: "Close a specified tab owned by the current task.",
  },
  closeTabTabId: {
    "zh-CN": "目标标签页 ID。",
    en: "Target tab ID.",
  },
  useTabDescription: {
    "zh-CN": "将当前任务已拥有或未归属的网页标签页设为当前任务工作标签页，用户可见标签页保持不变。归属其他任务的只读标签页无需调用本工具，直接用只读页面工具显式传 tabId 查看。",
    en: "Set a task-owned or unclaimed web tab as the current task's working tab; the user-visible tab remains unchanged. For a read-only tab owned by another task, pass tabId directly to a read-only page tool instead.",
  },
  navigateDescription: {
    "zh-CN": "在当前任务拥有的标签页中导航到新 URL，等待导航提交后返回。需捕获本次跳转的首屏、重定向或加载期接口时传 watchNetwork:true，随后用 network_recent / network_body 查看本次导航请求；监听页面加载后后续交互的请求用 network_watch。",
    en: "Navigate a task-owned tab to a new URL and return once navigation commits. Pass watchNetwork:true to capture initial load and redirect requests for this navigation, then inspect them with network_recent / network_body; use network_watch for subsequent interaction requests after loading.",
  },
  navigateUrl: {
    "zh-CN": "目标 HTTP/HTTPS URL（或已开启文件网址访问权限的 file:// URL）。",
    en: "Destination HTTP/HTTPS URL (or a file:// URL when file URL access is enabled).",
  },
  navigateTabId: {
    "zh-CN": "目标标签页 ID；省略时使用当前任务工作标签页。",
    en: "Target tab ID. Defaults to the current task's working tab.",
  },
  navigateWatchNetwork: {
    "zh-CN": "是否在本次导航前开启 Network 监听以捕获首屏和重定向请求，默认 false；页面已加载后的交互监听请用 network_watch。",
    en: "Start network monitoring before this navigation to capture initial load and redirect requests. Default: false. Use network_watch for interactions after the page has loaded.",
  },
  workingTabSelected: {
    "zh-CN": "已设为当前任务工作标签页；用户可见标签页保持不变。",
    en: "Set as the current task’s working tab. The tab visible to the user is unchanged.",
  },
});

export const toolT = createTranslator(messages);
