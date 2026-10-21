import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("accessibility-tools", {
  getAxTreeDescription: {
    "zh-CN": "获取当前任务所拥有页面的语义快照。只返回一棵 snapshot：每行是 target、role、name、value、url 和状态，重复的文本节点会去掉。不另列 actions 或 headings。占位符、offscreen、文件输入的 accept 和 files=数量写在对应行上。默认还返回较大的可见 canvases(name/rect/inViewport/bitmapSize)，小型 Canvas 会忽略；rect 是页面 CSS 位置，不是截图像素。root=\"root\" 查看整页；root 传 uid:/css: target 时展开该元素子树。limit 使用 BFS 分配节点预算以覆盖更多同层分支，输出仍保持树形顺序；节点行尾的 (truncated) 表示该节点在当前 depth 内还有子树因 limit 未展示。带 frame=序号的行没有 target，文本已经在行内，只阅读，序号对应 frames 的 url。不要编造 target，也不要传给 act_on_element、inspect_element 或 find_elements。嵌入页能独立打开时用 navigate/open_tab 打开该 url；依赖父页面时说明限制后停止。shadow DOM 节点仍有 target。理解页面后，把 snapshot 里带 target 的值原样传给 act_on_element/inspect_element。{targetGrammar}。",
    en: "Get a semantic snapshot of a page owned by the current task. Returns one snapshot tree: each line has target, role, name, value, url, and state, without repeated text nodes. actions and headings are not listed separately. Placeholder, offscreen, and a file input's accept and files= count are written on that line. By default, includes larger visible canvases(name/rect/inViewport/bitmapSize) and omits small canvases. rect is a CSS page position, not an image pixel. Use root=\"root\" for the whole page, or a uid:/css: target to expand an element subtree. limit allocates the node budget breadth-first to cover more sibling branches, while output retains tree order. A trailing (truncated) means a node has descendants within depth that were omitted because of limit. Lines marked frame=<index> have no target; their text is already on the line and is read-only. The index matches frames[].url. Do not invent a target for those lines or pass them to act_on_element, inspect_element, or find_elements. When the embedded page works on its own, open that url with navigate/open_tab. When it depends on the parent page, state that limit and stop. Shadow DOM nodes keep a target. Once you understand the page, pass targets from snapshot lines unchanged to act_on_element/inspect_element. {targetGrammar}.",
  },
  getAxTreeTabId: {
    "zh-CN": "当前任务拥有的目标标签页 ID；省略时使用当前任务工作标签页。",
    en: "ID of a target tab owned by the current task. Defaults to the current task’s working tab.",
  },
  getAxTreeRoot: {
    "zh-CN": "展开根节点。传 \"root\" 查看整页；也可传 uid:... 或 css:... 只展开某个元素子树。iframe 内的行没有 target，不能作为 root；传 iframe 元素自己的 target 可以阅读其嵌入内容。默认 root。",
    en: "Root to expand. Use \"root\" for the whole page, or uid:... / css:... to expand an element subtree. Lines inside an iframe have no target and cannot be a root; pass the iframe element's own target to read what it embeds. Default: root.",
  },
  getAxTreeDepth: {
    "zh-CN": "AX tree 深度，默认 16，范围 1-40",
    en: "AX tree depth. Default: 16; range: 1–40.",
  },
  getAxTreeLimit: {
    "zh-CN": "snapshot 最多返回节点行数，默认 120，范围 20-300；按 BFS 分配预算，输出仍为树形顺序，截断分支标记 (truncated)",
    en: "Maximum number of snapshot node lines. Default: 120; range: 20–300. Allocates the budget breadth-first, retains tree order, and marks omitted branches with (truncated).",
  },
});

export const toolT = createTranslator(messages);
