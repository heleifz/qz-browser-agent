import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "获取页面语义 snapshot（target、role、name、url）。默认 viewport 保留与视口高度相交的布局框，不横向裁剪；屏外祖先保留结构但无 target。↑/↓ 是深度、文本及 BFS 截断前省略的已有 AX 节点数，不是行数。scope=full 查看文档，uid:/css: root 查看子树（默认 full）。缺少几何信息的节点保留并注明。limit 是 BFS 可选节点预算；(truncated, N more) 表示预算截断。canvases 包含较大可见画布的 CSS rect 提示，视觉坐标以 screenshot({actionable:true}) 为准。{targetGrammar}。",
    en: "Page semantic snapshot (target, role, name, url). Default viewport keeps boxes overlapping viewport height without horizontal culling; off-band ancestors stay structural without targets. ↑/↓ count existing AX nodes omitted before depth, text and BFS truncation, not lines. scope=full reads the document; uid:/css: root reads a subtree (default full). Unknown geometry is retained and noted. limit budgets optional nodes breadth-first; (truncated, N more) reports budget omissions. canvases includes larger visible canvases with CSS rect hints; visual coordinates require screenshot({actionable:true}). {targetGrammar}.",
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
    "zh-CN": "viewport：仅视口纵向相交节点及祖先；full：完整文档/子树范围（仍受 depth/limit 限制）。整页根默认 viewport，显式元素根默认 full。",
    en: "viewport: vertical viewport overlap plus ancestors; full: entire document/subtree range (still subject to depth/limit). Defaults to viewport for the page root, full for explicit element roots.",
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
    "zh-CN": "↑ 视口上方 {count} 个节点（未显示）",
    en: "↑ {count} nodes above viewport (not shown)",
  },
  belowViewport: {
    "zh-CN": "↓ 视口下方 {count} 个节点（未显示）",
    en: "↓ {count} nodes below viewport (not shown)",
  },
  unmeasuredViewport: {
    "zh-CN": "几何信息缺失：{count} 个节点未按视口过滤（仍受 depth/limit 限制）。",
    en: "Geometry unavailable: {count} nodes not viewport-filtered (still subject to depth/limit).",
  },
});

export const toolT = createTranslator(messages);
