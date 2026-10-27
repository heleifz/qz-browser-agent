import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "页面语义 tree（target、role、name、url）。默认 viewport 保留纵向相交细节及有限屏外结构节点；不横向裁剪，几何未知节点保留。区块折叠标记注明缺失内容及 root/full 能力。depth/limit 仍生效；limit 是 BFS 可选节点预算，(truncated, N more) 表示预算截断。canvases 提供 CSS rect，视觉坐标以 screenshot({actionable:true}) 为准。{targetGrammar}。",
    en: "Semantic tree (target, role, name, url). Default viewport retains vertical overlap and bounded off-screen structure; horizontal overflow and unknown geometry remain. Block fold markers identify missing content and root/full capabilities. depth/limit still apply; limit budgets optional nodes breadth-first, with (truncated, N more) for budget omissions. canvases provides CSS rect hints; visual coordinates require screenshot({actionable:true}). {targetGrammar}.",
  },
  getAxTreeTabId: {
    "zh-CN": "当前任务拥有的目标标签页 ID；省略时使用当前任务工作标签页。",
    en: "ID of a target tab owned by the current task. Defaults to the current task’s working tab.",
  },
  getAxTreeRoot: {
    "zh-CN": "展开根节点，默认 root；uid:... / css:... 仅展开该元素子树。范围由 scope 控制。",
    en: "Root to expand, default root; uid:... / css:... expands only that element's subtree. scope controls the range.",
  },
  getAxTreeScope: {
    "zh-CN": "viewport：视口细节及有限屏外结构；full：文档/子树范围（仍受 depth/limit 限制）。整页根默认 viewport，uid:/css: 元素根默认 full。",
    en: "viewport: visible detail and bounded off-screen structure; full: document/subtree range (still subject to depth/limit). Page roots default to viewport; uid:/css: element roots default to full.",
  },
  getAxTreeDepth: {
    "zh-CN": "视口过滤后的 AX 树深度，默认 16，范围 1-40。",
    en: "AX tree depth after viewport filtering. Default: 16; range: 1–40.",
  },
  getAxTreeLimit: {
    "zh-CN": "BFS 可选节点预算，默认 120，范围 20-300；保留的可操作节点及其祖先不占此预算。",
    en: "BFS optional-node budget. Default: 120; range: 20–300. Guaranteed actions and their ancestors are additional.",
  },
  getAxTreeActionsLimit: {
    "zh-CN": "可操作元素最多返回数量，默认 40，范围 5-80",
    en: "Maximum number of actionable elements. Default: 40; range: 5–80.",
  },
  aboveViewport: {
    "zh-CN": "↑ 视口上方 {count} 个已有 AX 节点未显示；可用 scope:\"full\" 或树中 uid 作 root 读取（仍受 depth/limit 限制）",
    en: "↑ {count} existing AX nodes above viewport not shown; scope:\"full\" or a tree uid as root can read them (depth/limit still apply)",
  },
  belowViewport: {
    "zh-CN": "↓ 视口下方 {count} 个已有 AX 节点未显示；可用 scope:\"full\" 或树中 uid 作 root 读取（仍受 depth/limit 限制）",
    en: "↓ {count} existing AX nodes below viewport not shown; scope:\"full\" or a tree uid as root can read them (depth/limit still apply)",
  },
  readViewportRoot: {
    "zh-CN": "可用 root=\"{target}\" 或 scope:\"full\" 读取",
    en: "readable with root=\"{target}\" or scope:\"full\"",
  },
  foldedAbove: {
    "zh-CN": "↑ 此区块上方还有 {count} 项内容（未显示；{capability}；仍受 depth/limit 限制）",
    en: "↑ This block has {count} more content items above (not shown; {capability}; depth/limit still apply)",
  },
  foldedBelow: {
    "zh-CN": "↓ 此区块下方还有 {count} 项内容（未显示；{capability}；仍受 depth/limit 限制）",
    en: "↓ This block has {count} more content items below (not shown; {capability}; depth/limit still apply)",
  },
  unmeasuredViewport: {
    "zh-CN": "几何信息缺失：{count} 个节点未按视口过滤（仍受 depth/limit 限制）。",
    en: "Geometry unavailable: {count} nodes not viewport-filtered (still subject to depth/limit).",
  },
});

export const toolT = createTranslator(messages);
