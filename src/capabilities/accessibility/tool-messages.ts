import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "读取页面语义快照，返回 target、alias、role、name 和视口信息。整页根默认 viewport，包含纵向视口细节、结构祖先和有限屏外结构；横向溢出和几何未知节点保留。折叠标记给出读取入口。items 为直接列表项数，(truncated, N more) 为省略节点数。每个 target 均带快照别名，可用于元素工具与 run_flow。canvases 返回 name/rect/inViewport/bitmapSize，rect 使用 CSS 像素；视觉操作使用 screenshot({actionable:true}) 的坐标。",
    en: "Read a semantic page snapshot with target, alias, role, name and viewport information. Page roots default to viewport, including vertical viewport detail, structural ancestors and bounded off-screen structure; horizontal overflow and unknown geometry remain. Fold markers provide read targets. items counts direct list items; (truncated, N more) counts omitted nodes. Every target has a snapshot alias usable in element tools and run_flow. canvases returns name/rect/inViewport/bitmapSize; rect uses CSS pixels. Visual actions use coordinates from screenshot({actionable:true}).",
  },
  getAxTreeTabId: {
    "zh-CN": "任务拥有的 tabId，默认工作标签页；别名与流程内页面调用须显式填写。",
    en: "Owned tabId, default working tab; explicit for aliases and page calls inside flows.",
  },
  getAxTreeRoot: {
    "zh-CN": "展开根节点，默认 root；uid:... / 当前 alias / css:... 仅展开该元素子树。范围由 scope 控制。",
    en: "Root to expand, default root; uid:... / current alias / css:... expands only that element's subtree. scope controls the range.",
  },
  getAxTreeScope: {
    "zh-CN": "viewport：视口细节与有限屏外结构；full：文档或子树。整页根默认 viewport，元素根（含别名）默认 full。",
    en: "viewport: viewport detail and bounded off-screen structure; full: document or subtree. Page roots default to viewport; element roots (including aliases) default to full.",
  },
  getAxTreeDepth: {
    "zh-CN": "最大树深度，默认 16，范围 1–40。",
    en: "Maximum tree depth: default 16, range 1–40.",
  },
  getAxTreeLimit: {
    "zh-CN": "广度优先选取的可选节点上限，默认 120，范围 20–300；优先保留的可操作节点及其祖先另计。",
    en: "Maximum optional nodes selected breadth-first: default 120, range 20–300. Reserved action nodes and their ancestors are counted separately.",
  },
  getAxTreeActionsLimit: {
    "zh-CN": "优先保留的可操作节点上限，默认 40，范围 5–80。",
    en: "Maximum reserved action nodes: default 40, range 5–80.",
  },
  aboveViewport: {
    "zh-CN": "↑ 视口上方省略 {count} 个 AX 节点；用 scope:\"full\" 或树中 target 作 root 读取",
    en: "↑ {count} AX nodes omitted above viewport; read with scope:\"full\" or a tree target as root",
  },
  belowViewport: {
    "zh-CN": "↓ 视口下方省略 {count} 个 AX 节点；用 scope:\"full\" 或树中 target 作 root 读取",
    en: "↓ {count} AX nodes omitted below viewport; read with scope:\"full\" or a tree target as root",
  },
  readViewportRoot: {
    "zh-CN": "用 root=\"{target}\" 或 scope:\"full\" 读取",
    en: "read with root=\"{target}\" or scope:\"full\"",
  },
  foldedAbove: {
    "zh-CN": "↑ 此区块上方省略 {count} 项内容；{capability}",
    en: "↑ This block omits {count} content items above; {capability}",
  },
  foldedBelow: {
    "zh-CN": "↓ 此区块下方省略 {count} 项内容；{capability}",
    en: "↓ This block omits {count} content items below; {capability}",
  },
  unmeasuredViewport: {
    "zh-CN": "几何信息缺失：{count} 个节点。",
    en: "Geometry unavailable: {count} nodes.",
  },
});

export const toolT = createTranslator(messages);
