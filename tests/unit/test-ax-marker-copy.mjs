import assert from "node:assert/strict";
import { withLanguage } from "../../src/shared/i18n/index.js";
import { toolT } from "../../src/capabilities/accessibility/tool-messages.js";

const target = "uid:t8.000001.3";
for (const language of ["zh-CN", "en"]) withLanguage(language, () => {
  const en = language === "en";
  const capability = toolT("readViewportRoot", { target });
  assert.equal(capability, en ? `read with root="${target}" or scope:"full"` : `用 root="${target}" 或 scope:"full" 读取`);
  for (const [key, expected] of [
    ["aboveViewport", en ? '↑ 7 AX nodes omitted above viewport; read with scope:"full" or a tree target as root' : '↑ 视口上方省略 7 个 AX 节点；用 scope:"full" 或树中 target 作 root 读取'],
    ["belowViewport", en ? '↓ 7 AX nodes omitted below viewport; read with scope:"full" or a tree target as root' : '↓ 视口下方省略 7 个 AX 节点；用 scope:"full" 或树中 target 作 root 读取'],
    ["foldedAbove", en ? `↑ This block omits 7 content items above; ${capability}` : `↑ 此区块上方省略 7 项内容；${capability}`],
    ["foldedBelow", en ? `↓ This block omits 7 content items below; ${capability}` : `↓ 此区块下方省略 7 项内容；${capability}`],
    ["unmeasuredViewport", en ? "Geometry unavailable: 7 nodes." : "几何信息缺失：7 个节点。"],
  ]) assert.equal(toolT(key, { count: 7, capability }), expected);

  assert.equal(toolT("getAxTreeDepth"), en ? "Maximum tree depth: default 16, range 1–40." : "最大树深度，默认 16，范围 1–40。");
  assert.equal(toolT("getAxTreeActionsLimit"), en ? "Maximum reserved action nodes: default 40, range 5–80." : "优先保留的可操作节点上限，默认 40，范围 5–80。");
  assert.match(toolT("getAxTreeLimit"), en ? /breadth-first.*120.*20–300.*Reserved action nodes and their ancestors are counted separately/ : /广度优先.*120.*20–300.*优先保留的可操作节点及其祖先另计/);
  assert.match(toolT("getAxTreeScope"), en ? /Page roots default to viewport; uid:\/css: element roots default to full/ : /整页根默认 viewport，uid:\/css: 元素根默认 full/);
  assert.doesNotMatch(toolT("getAxTreeScope") + toolT("getAxTreeDescription", { targetGrammar: "uid:/css:" }), /depth|limit|alias/);
  assert.match(toolT("getAxTreeDescription", { targetGrammar: "uid:/css:" }), /items.*\(truncated, N more\)/);
});
console.log("Bilingual AX marker and budget copy passed");
