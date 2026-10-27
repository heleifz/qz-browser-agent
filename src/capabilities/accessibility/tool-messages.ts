import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "返回页面语义快照，每行含 target、alias、role、name 等。整页根默认 viewport，保留纵向视口细节与有限屏外结构，横向溢出和几何未知节点保留。全局 ↑/↓ 统计省略的已有 AX 节点，局部折叠统计区块内容分支并标明 root/full 读取能力；items 为直接列表项数。(truncated, N more) 表示 BFS 预算省略的节点数。有 target 的节点均带快照别名，可用于元素工具和 run_flow。canvases 返回 name/rect/inViewport/bitmapSize，rect 为 CSS 位置；视觉坐标来自 screenshot({actionable:true})。",
    en: "Return a semantic page snapshot with target, alias, role and name on each line. Page roots default to viewport, retaining vertical viewport detail and bounded off-screen structure; horizontal overflow and unknown geometry remain. Global ↑/↓ counts omitted existing AX nodes; local folds count content branches and identify root/full reads. items counts direct list items. (truncated, N more) reports BFS-omitted nodes. Every target-bearing node has a snapshot alias usable in element tools and run_flow. canvases returns name/rect/inViewport/bitmapSize; rect is CSS position, while visual coordinates come from screenshot({actionable:true}).",
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
    "zh-CN": "viewport：视口细节及有限屏外结构；full：文档/子树范围（仍受 depth/limit 限制）。整页根默认 viewport，元素根（含别名）默认 full。",
    en: "viewport: visible detail and bounded off-screen structure; full: document/subtree range (still subject to depth/limit). Page roots default to viewport; element roots (including aliases) default to full.",
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
