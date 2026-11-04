import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("wait-tools", {
  waitForUserDescription: {
    "zh-CN": "暂停并等待用户完成登录、验证码、授权、付款、本地文件选择等必须亲自操作的步骤。侧边栏显示提示，用户点击[继续]后自动恢复。",
    en: "Pause for the user to complete a step requiring direct page interaction, such as signing in, solving a CAPTCHA, authorizing access, paying, or selecting a local file. Resumes when the user clicks [Continue].",
  },
  waitForUserMessage: {
    "zh-CN": "展示给用户的提示，说明需要用户在页面完成什么操作。",
    en: "Instructions shown to the user explaining what to do on the page.",
  },
  waitForUserTabId: {
    "zh-CN": "可选。恢复后观测的标签页 tabRef：别名或 open_tab/list_tabs 返回的 tabRef。",
    en: "Optional tabRef to observe after resuming: an alias or the tabRef returned by open_tab/list_tabs.",
  },
  askUserDescription: {
    "zh-CN": "向用户展示结构化表单并返回提交的 answers。用于澄清需求、提供选项、收集字段，或在向外部系统执行发送/提交/发布/创建/修改/删除动作前请求确认。",
    en: "Show a structured form to the user and return submitted answers. Use to clarify requirements, offer choices, collect fields, or confirm before sending, submitting, publishing, creating, modifying, or deleting external data.",
  },
  askUserTitle: {
    "zh-CN": "表单标题，默认“帮我补充信息”。",
    en: "Form title. Default: “Provide more information”.",
  },
  askUserMessage: {
    "zh-CN": "简短说明为什么需要这些信息或确认。",
    en: "Brief explanation of why this information or confirmation is needed.",
  },
  askUserSubmitLabel: {
    "zh-CN": "提交按钮文案，默认“提交”。",
    en: "Submit button label. Default: “Submit”.",
  },
  askUserFields: {
    "zh-CN": "表单字段数组（最多 8 个），支持 text、textarea、single_choice、multi_choice。",
    en: "Up to 8 form fields; supports text, textarea, single_choice, and multi_choice.",
  },
  askUserId: {
    "zh-CN": "字段 ID（作为返回 answers 的 key）。",
    en: "Field ID (used as the key in returned answers).",
  },
  askUserLabel: {
    "zh-CN": "字段标题。",
    en: "Field label.",
  },
  askUserType: {
    "zh-CN": "字段类型，默认 text。",
    en: "Field type. Default: text.",
  },
  askUserPresentation: {
    "zh-CN": "选择题可设为 cards 以卡片展示（最多 50 项）。",
    en: "Set to cards on choice fields for card selection (up to 50 options).",
  },
  askUserPlaceholder: {
    "zh-CN": "输入占位提示。",
    en: "Input placeholder.",
  },
  askUserHelp: {
    "zh-CN": "字段补充说明。",
    en: "Additional help text.",
  },
  askUserDefaultValue: {
    "zh-CN": "text/textarea/single_choice 的默认字符串值。",
    en: "Default string value for text/textarea/single_choice.",
  },
  askUserDefaultValues: {
    "zh-CN": "multi_choice 的默认勾选值数组。",
    en: "Default selected values array for multi_choice.",
  },
  askUserRequired: {
    "zh-CN": "是否必填，默认 true。",
    en: "Whether required. Default: true.",
  },
  askUserOptions: {
    "zh-CN": "选择题选项数组 {label, value, description}（value 省略时同 label）。",
    en: "Choice options array {label, value, description} (value defaults to label).",
  },
  askUserOptionMeta: {
    "zh-CN": "卡片短标签（最多 6 个，每个最多 80 字符）。",
    en: "Card metadata tags (up to 6 tags, 80 chars each).",
  },
  askUserOptionImageUrl: {
    "zh-CN": "卡片缩略图 HTTP(S) URL。",
    en: "Card thumbnail HTTP(S) URL.",
  },
  askUserOptionUrl: {
    "zh-CN": "卡片来源 HTTP(S) URL。",
    en: "Card source HTTP(S) URL.",
  },
  waitForLoadDescription: {
    "zh-CN": "等待 tabRef 指定页的当前加载完成；页面已完成时立即返回。这是状态检查，不证明发生了新导航。",
    en: "Wait until the current page load in tabRef is complete; returns immediately if already complete. This state check does not prove a new navigation occurred.",
  },
  waitForNavigationTitle: { "zh-CN": "等待新导航", en: "Wait for navigation" },
  waitForNavigationDescription: {
    "zh-CN": "等待 tabRef 指定页之后发生的新导航（包括同 URL 重载、SPA 和片段导航）；已加载完成的旧页面不能满足。可传 trigger:{name,args}，先监听再执行该工具；动作与等待共用超时，动作失败直接报错。",
    en: "Wait for a future navigation in tabRef, including same-URL reloads, SPA navigation, and fragment changes. An already-loaded page does not match. Pass trigger:{name,args} to arm before invoking a tool; action failure propagates and the deadline is shared.",
  },
  waitForPopupTitle: { "zh-CN": "等待新页面", en: "Wait for popup" },
  waitForPopupDescription: {
    "zh-CN": "等待 tabRef 指定页因任务动作打开的新标签页，并在确认任务归属后返回 Tab。可传 trigger:{name,args}，先监听再执行动作；不会认领用户自行打开的页面。返回后可用 wait_for_load 等待新页加载。",
    en: "Wait for a new tab caused by a task action in tabRef, returning its Tab after ownership is established. Optionally pass trigger:{name,args} to arm before the action. User-opened tabs are not claimed. Use wait_for_load afterwards if loading must finish.",
  },
  waitForPopupAlias: { "zh-CN": "新页面的可选别名。", en: "Optional alias for the new page." },
  waitForUrlTitle: { "zh-CN": "等待页面地址", en: "Wait for URL" },
  waitForUrlDescription: {
    "zh-CN": "等待 tabRef 指定页的当前 URL 匹配 urlPattern 正则；当前已匹配时立即返回。",
    en: "Wait until the current URL in tabRef matches the urlPattern regex; returns immediately when already matched.",
  },
  waitForUrlPattern: { "zh-CN": "匹配完整页面 URL 的正则表达式。", en: "Regular expression matched against the full page URL." },
  waitForFunctionTitle: { "zh-CN": "等待页面条件", en: "Wait for page condition" },
  waitForFunctionDescription: {
    "zh-CN": "在 tabRef 指定页反复求值 code 函数，直到返回真值，并返回该值。args 可为任意 JSON 值，作为函数参数传入；函数应只读取页面状态。异常直接报错，超时返回 ToolError。",
    en: "Evaluate the code function repeatedly in tabRef until it returns a truthy value, then return that value. args is any JSON value passed to the function. Read page state without changing it; evaluation errors propagate and timeout is a ToolError.",
  },
  waitForFunctionCode: { "zh-CN": "读取页面状态的函数表达式；返回真值表示条件已满足。", en: "Function expression reading page state; a truthy return value satisfies the condition." },
  waitForNavigationTabId: {
    "zh-CN": "目标标签页 tabRef：别名或 open_tab/list_tabs 返回的 tabRef。",
    en: "Target tabRef: an alias or the tabRef returned by open_tab/list_tabs.",
  },
  waitForNavigationTimeout: {
    "zh-CN": "超时秒数，默认 10。",
    en: "Timeout in seconds. Default: 10.",
  },
  waitForNavigationScreenshot: {
    "zh-CN": "加载完成后是否截图，默认 false。",
    en: "Capture a screenshot after loading. Default: false.",
  },
  waitForNavigationFromUrl: {
    "zh-CN": "可选：动作前 URL，用于计算 urlChanged。",
    en: "Optional pre-action URL to compute urlChanged.",
  },
  waitForNavigationFromTitle: {
    "zh-CN": "可选：动作前标题，用于计算 titleChanged。",
    en: "Optional pre-action title to compute titleChanged.",
  },
  waitForElementDescription: {
    "zh-CN": "等待 tabRef 指定页的 target 达到 state：attached、visible（默认）、hidden 或 detached。hidden 包括移除或不可见，detached 仅表示移除；uid 始终观察原节点，不重匹配替代节点。",
    en: "Wait for target in tabRef to reach attached, visible (default), hidden, or detached. Hidden includes removal or invisibility; detached requires removal. A uid observes its original node, never a replacement.",
  },
  waitForElementTabId: {
    "zh-CN": "目标标签页 tabRef：别名或 open_tab/list_tabs 返回的 tabRef。",
    en: "Target tabRef: an alias or the tabRef returned by open_tab/list_tabs.",
  },
  waitForElementSelector: {
    "zh-CN": "元素 target，优先 uid:，css: 兜底。",
    en: "Element target: prefer uid:, with css: as fallback.",
  },
  waitForElementState: {
    "zh-CN": "期望状态，默认 visible。attached/detached 检查节点连接，visible/hidden 检查可见性。",
    en: "Expected state; default: visible. Attached/detached check node connection; visible/hidden check visibility.",
  },
  waitForElementIntervalSeconds: {
    "zh-CN": "轮询间隔秒数，默认 0.5。",
    en: "Polling interval in seconds. Default: 0.5.",
  },
  waitDescription: {
    "zh-CN": "等待指定秒数（等待网络或元素时优先用 wait_for_network_idle / wait_for_element）。",
    en: "Wait for the specified seconds (prefer wait_for_network_idle or wait_for_element for network or DOM state).",
  },
  waitSeconds: {
    "zh-CN": "等待秒数。",
    en: "Seconds to wait.",
  },
  waitUntilDescription: {
    "zh-CN": "等到指定日期时间再继续（已过时立即返回 pastDue:true）。适合定时任务提前启动准备后等待正式执行时间；最长等待 2 小时，更久请用定时任务。",
    en: "Wait until a specified date and time before continuing (returns immediately with pastDue:true if past). Useful when a scheduled task starts early to prepare; maximum wait: 2 hours (use automations for longer delays).",
  },
  waitUntilUntil: {
    "zh-CN": "目标日期时间（最长 2 小时）。推荐带时区的 ISO 8601（如 2026-07-17T12:00:00+08:00），也兼容按北京时间解释的 YYYY-MM-DD HH:mm:ss。",
    en: "Target date and time (max 2 hours). Prefer ISO 8601 with time zone (e.g. 2026-07-17T12:00:00+08:00); also accepts YYYY-MM-DD HH:mm:ss in Beijing time.",
  },
  userContinuedNoImages: {
    "zh-CN": "用户已继续。当前模型不支持图片输入，请确认用户操作的结果后继续任务。",
    en: "The user continued. The current model does not support image input. Check the result of the user’s action before continuing the task.",
  },
  userContinuedWithImage: {
    "zh-CN": "用户已继续，这是 tabRef 指定页面的状态截图，请确认并继续任务。",
    en: "The user continued. Check this screenshot of the page specified by tabRef, then continue the task.",
  },
  userContinued: {
    "zh-CN": "用户已继续，请确认用户操作的结果后继续任务。",
    en: "The user continued. Check the result of the user’s action before continuing the task.",
  },
  navigationScreenshotFailed: {
    "zh-CN": "加载完成但截图失败，请调用 screenshot({tabRef}) 确认页面状态",
    en: "Loading finished, but the screenshot failed. Call screenshot({tabRef}) to check the page state.",
  },
}, { historicalLabels: ["waitForNavigationTitle", "waitForPopupTitle", "waitForUrlTitle", "waitForFunctionTitle"] });

export const toolT = createTranslator(messages);
