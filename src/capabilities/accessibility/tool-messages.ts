import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "获取当前任务所拥有页面的语义快照。返回每行一个节点的紧凑 snapshot 文本（含 target、role、name、value、url、状态标记等）。root=\"root\" 查看整页；传 uid:/css: target 时只展开该元素子树。limit 使用 BFS 分配节点预算以覆盖更多同层分支，输出按树形顺序排列；行尾 (truncated, N more) 表示其下还有 N 行未展开。同时返回 root 范围内尺寸较大的可见 canvases(name/rect/inViewport/bitmapSize)；其中 rect 仅为页面 CSS 位置提示，视觉操作坐标必须以 screenshot({actionable:true}) 返回的原始图片为准。直接把行中的 target（形如 uid:...）原样传给 act_on_element、inspect_element、screenshot 或 read_image；需要 CSS 过滤或定位时再用 find_elements/inspect_element。{targetGrammar}。",
    en: "Get a semantic snapshot of a page owned by the current task. Returns compact snapshot text with one node per line (including target, role, name, value, url, and state flags). Use root=\"root\" for the whole page, or pass a uid:/css: target to expand only that element's subtree. limit allocates the node budget breadth-first (BFS) to cover more sibling branches while keeping tree order; a trailing (truncated, N more) means N descendant lines under that node were omitted. Also returns larger visible canvases(name/rect/inViewport/bitmapSize) within root; rect is only a CSS position hint, and visual action coordinates must come from the original image returned by screenshot({actionable:true}). Pass a line's target (such as uid:...) unchanged to act_on_element, inspect_element, screenshot, or read_image; use find_elements/inspect_element when CSS filtering or targeting is needed. {targetGrammar}.",
  },
  getAxTreeTabId: {
    "zh-CN": "目标标签页 ID（须归属当前任务）；省略时使用当前任务工作标签页。",
    en: "Target tab ID owned by the current task. Defaults to the current task's working tab.",
  },
  getAxTreeRoot: {
    "zh-CN": "展开根节点。传 \"root\" 查看整页，或传 uid:... / css:... 展开指定元素子树。默认 \"root\"。",
    en: "Root node to expand. Pass \"root\" for the whole page, or uid:... / css:... for an element subtree. Default: \"root\".",
  },
  getAxTreeDepth: {
    "zh-CN": "最大展开深度，默认 16，范围 1–40。",
    en: "Maximum tree depth. Default: 16; range: 1–40.",
  },
  getAxTreeLimit: {
    "zh-CN": "snapshot 最多返回节点行数，默认 120，范围 20–300。",
    en: "Maximum snapshot node lines. Default: 120; range: 20–300.",
  },
  getAxTreeActionsLimit: {
    "zh-CN": "最多保留的可操作元素数量，默认 40，范围 5–80。",
    en: "Maximum actionable elements to include. Default: 40; range: 5–80.",
  },
});

export const toolT = createTranslator(messages);
