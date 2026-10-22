import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "获取当前任务所拥有页面的语义快照。紧凑 snapshot：每行 target、role、name、同源相对 url，以及 placeholder、value、checked、disabled 等状态；文件输入带 accept、multiple、selectedFileCount。pageOverview 选出的可操作元素及其到根的祖先一定在树中且不计入 limit。不另附 actions 或 headings 列表。默认还返回当前范围内尺寸较大的可见 canvases(name/rect/inViewport/bitmapSize)，小型 Canvas 会忽略；这里的 rect 是页面 CSS 位置提示，视觉操作坐标必须以 screenshot({actionable:true}) 返回的原始图片为准。root=\"root\" 查看整页；root 传 uid:/css: target 时展开该元素子树。limit 使用 BFS 分配节点预算以覆盖更多同层分支，输出仍保持树形顺序；保底可操作元素及其祖先不计入 limit。节点行尾的 (truncated, N more) 表示该节点有 N 个后代因 limit 未展示。uid 形如 t5493.00001.12（标签页尾号、5 位快照编号、序号），图片为 t5493.00001.i3。理解页面后，优先把 snapshot 中的 target 原样传给 act_on_element/inspect_element/screenshot/read_image；需要精确 CSS 定位时再用 find_elements/inspect_element。{targetGrammar}。",
    en: "Get a semantic snapshot of a page owned by the current task. Compact snapshot lines include target, role, name, a same-origin relative url, and state such as placeholder, value, checked, and disabled. File inputs include accept, multiple, and selectedFileCount. Actionable elements chosen by pageOverview, and their ancestors up to the root, are always in the tree and do not consume limit. There is no separate actions or headings list. By default, includes larger visible canvases(name/rect/inViewport/bitmapSize) in the current scope and omits small canvases. These rect values are CSS page-position hints; visual action coordinates must come from the original image returned by screenshot({actionable:true}). Use root=\"root\" for the whole page, or a uid:/css: target to expand an element subtree. limit allocates the node budget breadth-first to cover more sibling branches, while output retains tree order. Guaranteed actionable elements and their ancestors do not consume limit. A trailing (truncated, N more) means N descendant nodes were omitted because of limit. A uid looks like t5493.00001.12 (tab suffix, 5-character snapshot number, sequence); images use t5493.00001.i3. Once you understand the page, pass targets from the snapshot unchanged to act_on_element/inspect_element/screenshot/read_image. Use find_elements/inspect_element when precise CSS targeting is needed. {targetGrammar}.",
  },
  getAxTreeTabId: {
    "zh-CN": "当前任务拥有的目标标签页 ID；省略时使用当前任务工作标签页。",
    en: "ID of a target tab owned by the current task. Defaults to the current task’s working tab.",
  },
  getAxTreeRoot: {
    "zh-CN": "展开根节点。传 \"root\" 查看整页；也可传 uid:... 或 css:... 只展开某个元素子树。默认 root。",
    en: "Root to expand. Use \"root\" for the whole page, or uid:... / css:... to expand an element subtree. Default: root.",
  },
  getAxTreeDepth: {
    "zh-CN": "AX tree 深度，默认 16，范围 1-40",
    en: "AX tree depth. Default: 16; range: 1–40.",
  },
  getAxTreeLimit: {
    "zh-CN": "snapshot 最多返回的普通节点行数，默认 120，范围 20-300。按 BFS 分配预算，输出仍为树形顺序。保底可操作元素及其祖先不计入该预算。被省略的子树在节点行尾标记 (truncated, N more)，N 为未展示的后代节点数。",
    en: "Maximum number of ordinary snapshot node lines. Default: 120; range: 20–300. Allocates the budget breadth-first and retains tree order. Guaranteed actionable elements and their ancestors do not consume this budget. Omitted subtrees are marked (truncated, N more), where N is the number of descendant nodes left out.",
  },
  getAxTreeActionsLimit: {
    "zh-CN": "保底放入快照树的可操作元素数量，不占 limit。默认 40，范围 5-80。",
    en: "Number of actionable elements guaranteed in the snapshot tree. They do not consume limit. Default: 40; range: 5–80.",
  },
});

export const toolT = createTranslator(messages);
