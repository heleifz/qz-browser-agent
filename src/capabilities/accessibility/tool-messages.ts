import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "获取当前任务页面的紧凑语义 snapshot，每行一个节点，包含 target、role、name、url。整页根默认 scope=viewport：保留布局框与视口高度相交的节点，不做横向裁剪，并保留祖先链；屏外祖先仅作结构，不提供 target。↑/↓ 标记分别统计在深度、文本和 BFS 截断之前省略的上方/下方 AX 节点（不是行数，不含保留的祖先）。计数只涵盖已有 AX/DOM，不含尚未加载的懒加载或虚拟列表项目。可滚动后重读，或用 scope=full 查看完整文档范围。root 可传 uid:/css: target 查看子树，显式元素根默认 full。缺少几何信息的节点保留并注明。limit 按 BFS 分配可选节点预算，输出按树形顺序；(truncated, N more) 表示另有 N 个语义节点受预算截断。还返回 root 范围内较大的可见 canvases(name/rect/inViewport/bitmapSize)；rect 仅为 CSS 位置提示，视觉操作坐标以 screenshot({actionable:true}) 原始图片为准。将 target 原样传给 act_on_element、inspect_element、screenshot 或 read_image；精确 CSS 定位使用 find_elements/inspect_element。{targetGrammar}。",
    en: "Get a compact semantic snapshot of the task's page: one node per line with target, role, name and url. The page root defaults to scope=viewport: keep boxes intersecting the viewport height, without horizontal culling, plus ancestor chains; off-band ancestors are structural without targets. ↑/↓ count AX nodes omitted above/below BEFORE depth, text and BFS truncation (not lines; retained ancestors excluded). Counts cover existing AX/DOM only, not unloaded lazy/virtual items. Scroll and read again, or use scope=full for the full document range. Pass a uid:/css: root for a subtree; explicit element roots default to full. Nodes lacking geometry are retained and noted. limit budgets optional nodes breadth-first; output remains in tree order. (truncated, N more) means N additional semantic nodes were budget-truncated. Also returns larger visible canvases(name/rect/inViewport/bitmapSize) in the root scope; rect is a CSS hint, while visual coordinates must come from the original screenshot({actionable:true}) image. Pass targets unchanged to act_on_element, inspect_element, screenshot or read_image; use find_elements/inspect_element for precise CSS targeting. {targetGrammar}.",
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
    "zh-CN": "↑ 视口上方约 {count} 个节点（未显示）",
    en: "↑ ~{count} nodes above viewport (not shown)",
  },
  belowViewport: {
    "zh-CN": "↓ 视口下方约 {count} 个节点（未显示）",
    en: "↓ ~{count} nodes below viewport (not shown)",
  },
  unmeasuredViewport: {
    "zh-CN": "几何信息缺失：{count} 个节点未按视口过滤（仍受 depth/limit 限制）。",
    en: "Geometry unavailable: {count} nodes not viewport-filtered (still subject to depth/limit).",
  },
});

export const toolT = createTranslator(messages);
