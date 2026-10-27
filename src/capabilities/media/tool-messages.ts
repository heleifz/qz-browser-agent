import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("media-tools", {
  screenshotDescription: {
    "zh-CN": "截图当前视口或 target 元素的已渲染区域，返回图片。actionable:true 的视口截图建立 act_on_screen 坐标依据，coordinateSpace 给出原始图片像素宽高；destination 将截图另存到图集。{targetGrammar}。",
    en: "Capture the viewport or target element's rendered region and return an image. actionable:true on a viewport capture establishes the act_on_screen coordinate basis; coordinateSpace gives original image-pixel dimensions. destination also saves it to a gallery. {targetGrammar}.",
  },
  screenshotTabId: {
    "zh-CN": "目标 tabId，默认工作标签页或完整 UID 所属 tab；别名与流程内调用须显式填写。",
    en: "Target tabId, default working tab or full UID's tab; explicit for aliases and flow calls.",
  },
  screenshotTarget: {
    "zh-CN": "元素级截图目标。{targetDescription}",
    en: "Target for an element screenshot. {targetDescription}",
  },
  screenshotIndex: {
    "zh-CN": "target 为 css:... 且匹配多个时的 index，默认 0",
    en: "Match index when a css:... target matches multiple elements. Default: 0.",
  },
  screenshotDestination: {
    "zh-CN": "可选图集表名，用于保存截图副本。",
    en: "Optional gallery table name for a saved copy of the screenshot.",
  },
  screenshotFormat: {
    "zh-CN": "默认 jpeg",
    en: "Default: jpeg.",
  },
  screenshotQuality: {
    "zh-CN": "JPEG 质量 0-100，默认 70",
    en: "JPEG quality from 0 to 100. Default: 70.",
  },
  screenshotPadding: {
    "zh-CN": "元素截图外扩像素，默认 0，最大 200",
    en: "Padding around an element screenshot in pixels. Default: 0; maximum: 200.",
  },
  screenshotMaxWidth: {
    "zh-CN": "返回图片最大宽度，默认及上限 2048；编码后不超过 2 MiB",
    en: "Maximum returned image width. Default and ceiling: 2048; encoded output is at most 2 MiB.",
  },
  screenshotMaxHeight: {
    "zh-CN": "返回图片最大高度，默认及上限 2048；编码后不超过 2 MiB",
    en: "Maximum returned image height. Default and ceiling: 2048; encoded output is at most 2 MiB.",
  },
  screenshotActionable: {
    "zh-CN": "将视口截图设为 act_on_screen 坐标依据，默认 false；仅适用于视口截图。",
    en: "Establish the act_on_screen coordinate basis, default false; available for viewport captures.",
  },
  actOnScreenDescription: {
    "zh-CN": "执行一次视觉动作，可直接调用或在 run_flow 中调用。坐标依据为最近的 screenshot(actionable=true) 或 act_on_screen(returnScreenshot:true)，x/y/endX/endY 使用原始图片像素，范围为 coordinateSpace.width/height。省略 x/y 时，press/type 操作当前焦点，scroll 使用视口中心；指定坐标的 type 点击后输入，replace:true 配合空文本清空。long_press 按住后释放；移动模式使用触摸，hover 和右键/中键限桌面模式。返回动作结果、viewportChange 和 coordinateBasisReady，returnScreenshot:true 另带观察图。",
    en: "Execute one visual action, directly or inside run_flow. Coordinates use the latest screenshot(actionable=true) or act_on_screen(returnScreenshot:true) basis: original image pixels within coordinateSpace.width/height. With x/y omitted, press/type uses current focus and scroll uses viewport center. Coordinate-based type clicks then types; replace:true with empty text clears the field. long_press holds then releases. Mobile mode uses touch; hover and right/middle buttons are desktop-only. Returns action results, viewportChange and coordinateBasisReady; returnScreenshot:true adds an observation image.",
  },
  actOnScreenReturnScreenshot: {
    "zh-CN": "必填；true 返回动作后的观察图，false 返回动作元数据。",
    en: "Required; true returns a post-action observation image, false returns action metadata.",
  },
  actOnScreenX: {
    "zh-CN": "起点图片像素横坐标；省略时 scroll 使用视口中心，press/type 使用当前焦点。",
    en: "Starting image-pixel x-coordinate; omitted scroll uses viewport center, press/type uses current focus.",
  },
  actOnScreenY: {
    "zh-CN": "起点图片像素纵坐标；省略时 scroll 使用视口中心，press/type 使用当前焦点。",
    en: "Starting image-pixel y-coordinate; omitted scroll uses viewport center, press/type uses current focus.",
  },
  actOnScreenEndX: {
    "zh-CN": "drag 在返回图片上的终点横坐标（像素）",
    en: "Ending x-coordinate for drag, in pixels on the returned image.",
  },
  actOnScreenEndY: {
    "zh-CN": "drag 在返回图片上的终点纵坐标（像素）",
    en: "Ending y-coordinate for drag, in pixels on the returned image.",
  },
  actOnScreenText: {
    "zh-CN": "type 要输入的文本；replace=true 时可传空字符串表示只清空",
    en: "Text to enter with type. With replace=true, an empty string clears the field.",
  },
  actOnScreenReplace: {
    "zh-CN": "type 前是否全选并替换当前内容，默认 false；与空 text 合用表示清空",
    en: "Whether type selects all and replaces existing content. Default: false. With empty text, clears the field.",
  },
  actOnScreenKey: {
    "zh-CN": "press 按键，如 Enter、Escape、Tab、Meta+A、Control+L。",
    en: "Press key, such as Enter, Escape, Tab, Meta+A or Control+L.",
  },
  actOnScreenButton: {
    "zh-CN": "click/double_click/long_press/drag 使用的鼠标键，默认 left",
    en: "Mouse button for click/double_click/long_press/drag. Default: left.",
  },
  actOnScreenDurationMs: {
    "zh-CN": "long_press 按住的毫秒数，默认 800，范围 300–5000",
    en: "Duration of long_press in milliseconds. Default: 800; range: 300–5000.",
  },
  actOnScreenDeltaX: {
    "zh-CN": "scroll 水平滚动像素，向右为正",
    en: "Horizontal scroll distance in pixels. Positive values scroll right.",
  },
  actOnScreenDeltaY: {
    "zh-CN": "scroll 垂直滚动像素，向下为正",
    en: "Vertical scroll distance in pixels. Positive values scroll down.",
  },
  actOnScreenRepeat: {
    "zh-CN": "scroll 在同一坐标连续发送的滚轮事件数，默认 1，最大 20",
    en: "Number of consecutive wheel events at the same coordinates. Default: 1; maximum: 20.",
  },
  listImagesDescription: {
    "zh-CN": "列出页面图片候选的 target、alt/title、上下文、尺寸、来源与位置。target 绑定 Session、tab、页面和图片地址，可用于 read_image/collect_images；index/rank 为列表序号。",
    en: "List page image candidates with target, alt/title, context, dimensions, source and position. target binds Session, tab, page and image URL for read_image/collect_images; index/rank are list positions.",
  },
  listImagesTabId: {
    "zh-CN": "本次调用的目标标签页 ID；省略时使用当前任务工作标签页。",
    en: "Target tab ID for this call. Defaults to the current task’s working tab.",
  },
  listImagesSelector: {
    "zh-CN": "可选容器或 img 范围：原始 CSS、css:、完整 uid: 或当前快照别名，默认整页。",
    en: "Optional container/img scope: raw CSS, css:, full uid: or current snapshot alias; default whole page.",
  },
  listImagesMinWidth: {
    "zh-CN": "最小图片宽度，按显示宽度或 naturalWidth 判断，默认 1",
    en: "Minimum image width, checked against displayed width or naturalWidth. Default: 1.",
  },
  listImagesMinHeight: {
    "zh-CN": "最小图片高度，按显示高度或 naturalHeight 判断，默认 1",
    en: "Minimum image height, checked against displayed height or naturalHeight. Default: 1.",
  },
  listImagesVisibleOnly: {
    "zh-CN": "是否只列出可见图片，默认 true",
    en: "Whether to list visible images only. Default: true.",
  },
  listImagesLimit: {
    "zh-CN": "最多返回多少张，默认 100，最大 1000",
    en: "Maximum number of images to return. Default: 100; maximum: 1000.",
  },
  collectImagesDescription: {
    "zh-CN": "将 targets 或 urls 指定的图片保存为本地资产，元信息写入 table 图集，返回摘要与 assetId。按来源页面上下文读取并校验引用；多次调用可持续写入同一图集。",
    en: "Save images selected by targets or urls as local assets, write metadata to gallery table and return a summary with assetIds. Reads use the source page context and validate references; repeated calls can append to the same gallery.",
  },
  collectImagesTable: {
    "zh-CN": "必填，保存图片元信息的图集 Data 表名。",
    en: "Required gallery Data table name for saved image metadata.",
  },
  collectImagesTargets: {
    "zh-CN": "选中页面图片的 target 列表。每项原样使用 list_images 返回的 target。{targetDescription}",
    en: "Targets of selected page images. Pass each target from list_images unchanged. {targetDescription}",
  },
  collectImagesUrls: {
    "zh-CN": "选中图片的直接 URL 列表，支持 http/https/data:image。",
    en: "Direct URLs of selected images. Supports http/https/data:image.",
  },
  collectImagesDedupField: {
    "zh-CN": "图集表 upsert 去重字段，默认 sourceKey。",
    en: "Deduplication field for upsert into the collection table. Default: sourceKey.",
  },
  collectImagesMaxWidth: {
    "zh-CN": "读取/存储图片最大宽度，默认及上限 2048；编码后不超过 2 MiB。",
    en: "Maximum image width for reading/storage. Default and ceiling: 2048; encoded output is at most 2 MiB.",
  },
  collectImagesMaxHeight: {
    "zh-CN": "读取/存储图片最大高度，默认及上限 2048；编码后不超过 2 MiB。",
    en: "Maximum image height for reading/storage. Default and ceiling: 2048; encoded output is at most 2 MiB.",
  },
  collectImagesMaxBytes: {
    "zh-CN": "单张 URL 图片最大读取字节数，默认 20 MiB，最大 32 MiB；编码后图片不超过 2 MiB。",
    en: "Maximum bytes to read per URL image. Default: 20 MiB; maximum: 32 MiB. Encoded output is at most 2 MiB.",
  },
  collectImagesMaxImages: {
    "zh-CN": "本地 asset store 最大图片张数，默认 2000。",
    en: "Maximum number of images in the local asset store. Default: 2000.",
  },
  collectImagesMaxStorageBytes: {
    "zh-CN": "本地 asset store 最大总字节数，默认 1.5 GiB。",
    en: "Maximum total bytes in the local asset store. Default: 1.5 GiB.",
  },
  collectImagesFormat: {
    "zh-CN": "页面侧转码格式，默认 jpeg。",
    en: "Image format for conversion in the page. Default: jpeg.",
  },
  collectImagesQuality: {
    "zh-CN": "jpeg/webp 质量，0-1 或 1-100，默认 0.88。",
    en: "JPEG/WebP quality, from 0–1 or 1–100. Default: 0.88.",
  },
  readImagePrompt: {
    "zh-CN": "以上工具读取到的图片，请分析其视觉内容：",
    en: "Analyze the visual content of the images read by the tool above:",
  },
  readImageAssetDescription: {
    "zh-CN": "读取已保存的本地图片 asset，并作为图片消息返回给 LLM。适合从 collect_images 采集后的图集中挑选少量图片做视觉分析。",
    en: "Read a saved local image asset and return it to the model as an image message. Useful for visually analyzing a small selection from a collection created by collect_images.",
  },
  readImageAssetAssetId: {
    "zh-CN": "collect_images 返回或图集表中的 assetId。",
    en: "assetId returned by collect_images or stored in the collection table.",
  },
  readImageAssetDetail: {
    "zh-CN": "传给视觉模型的图片细节等级，默认 auto。",
    en: "Image detail level sent to the vision model. Default: auto.",
  },
  readImageDescription: {
    "zh-CN": "读取单张图片并返回图片消息。url 读取图片资源，target 读取页面已加载的 img 或图片容器，两者选一。{targetGrammar}。",
    en: "Read one image and return an image message. Choose url for an image resource or target for a loaded page img/image container. {targetGrammar}.",
  },
  readImageUrl: {
    "zh-CN": "独立图片资源 URL，支持 http/https/data:image。",
    en: "Standalone image resource URL, supporting http/https/data:image.",
  },
  readImageTarget: {
    "zh-CN": "页面 img 或图片容器目标。{targetDescription}",
    en: "Target of a page img or image container. {targetDescription}",
  },
  readImageDetail: {
    "zh-CN": "传给视觉模型的图片细节等级，默认 auto",
    en: "Image detail level sent to the vision model. Default: auto.",
  },
  readImageMaxBytes: {
    "zh-CN": "URL 图片最大读取字节数，默认 20 MiB，最大 32 MiB；编码后图片不超过 2 MiB",
    en: "Maximum bytes to read from a URL image. Default: 20 MiB; maximum: 32 MiB. Encoded output is at most 2 MiB.",
  },
  readImageFormat: {
    "zh-CN": "页面侧转码格式，默认 png。png 可保留透明通道，避免透明图片转 jpeg 后变黑。",
    en: "Image format for conversion in the page. Default: png. PNG preserves transparency, avoiding black backgrounds when transparent images are converted to JPEG.",
  },
  readImageQuality: {
    "zh-CN": "jpeg/webp 质量，0-1 或 1-100，默认 0.88",
    en: "JPEG/WebP quality, from 0–1 or 1–100. Default: 0.88.",
  },
  imageCandidatesGuidance: {
    "zh-CN": "已发现图片候选。在该页面上下文中完成判断和采集；把合格候选的 target 原样传给 read_image 或 collect_images。sourceOmitted 表示来源是内嵌图片或地址过长，完整来源仍安全绑定在 target 内部。",
    en: "Image candidates found. Evaluate and collect them in the current page context; pass selected targets unchanged to read_image or collect_images. sourceOmitted means the source is embedded or its URL is too long; the full source remains securely bound to the target.",
  },
  imageTargetRecovery: {
    "zh-CN": "重新调用 list_images，并原样使用某一个候选的 target。",
    en: "Call list_images again and use a candidate’s target unchanged.",
  },
  changedImageRecovery: {
    "zh-CN": "页面图片已变化，请重新调用 list_images 并选择新的 target。",
    en: "Page images have changed. Call list_images again and select a new target.",
  },
  collectTargetsRecovery: {
    "zh-CN": "调用 list_images，并把选中候选的 target 原样传入 targets。",
    en: "Call list_images and pass the selected candidates’ targets unchanged in targets.",
  },
  collectLimitRecovery: {
    "zh-CN": "减少本次明确选中的候选数量。",
    en: "Select fewer candidates for this call.",
  },
  collectionFailuresRecovery: {
    "zh-CN": "根据 failures 中的错误修正候选；页面 target 失效时重新调用 list_images，URL 失败时更换可直接访问的图片地址。",
    en: "Use the errors in failures to correct the candidates. For stale page targets, call list_images again; for failed URLs, choose directly accessible image URLs.",
  },
});

export const toolT = createTranslator(messages);
