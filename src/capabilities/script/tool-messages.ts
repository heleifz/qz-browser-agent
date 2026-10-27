import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("script-tools", {
  runScriptDescription: {
    "zh-CN": `执行临时 JavaScript，支持 top-level await；包内脚本通过对应 Skill 工具调用。可用 input/args、tools/tool、trace/log。tools 是当前运行可用工具的动态代理：直接 await tools.find_elements({...}) 或 tools.data_store({...})，用 await tools.$list() 查询能力。

执行环境：
- target 省略或为 "page"：当前任务自有的显式 tabId 或 workingTabId，提供 tabId/document/window/Web APIs；上下文不可用时返回 page_context_unavailable。
- target:"inner"：内部 offscreen Worker，提供标准 JS/Web Worker APIs，无 document/window/DOM/tabId；用于与页面无关的计算、data_store、save_file/document_*、ask_llm 编排。
- open_tab 创建工作 tab，use_tab 选择，list_tabs 查看状态。其他任务的 tab 仅通过只读页面工具显式传 tabId 读取。
- 使用标准 API；DevTools 的 getEventListeners/$0/copy/monitorEvents 不可用。

执行与返回：
- 填写 timeout；轻量读取可用几十秒，明确的长采集/翻页/批量写入可用 0，由用户停止。
- code 推荐单个 async () => { ... } 函数表达式，工具自动调用。开头用一行注释写明页面、任务和目的。
- 复杂脚本维护 stage，在开始、选择器命中数、分支、循环进度和 catch 中 trace；失败后根据 diagnostic + trace 修正再重试。
- 动态页面/懒加载/虚拟列表用有超时的 waitFor(fn,label,timeout)，读取元素属性前检查存在性。
- 页面模式支持读取、解析、落库、DOM 调试、ask_llm 分析和已验证的批量交互。视觉序列先单步验证效果；效果符合预期、后续坐标可预测且 viewportChange 表示视口稳定时，才串行 await tools.act_on_screen。中间动作 returnScreenshot:false，每步检查 coordinateBasisReady，条件失效立即返回。需观察时 screenshot 或 act_on_screen(returnScreenshot:true)；工具返回按执行顺序最后一张观察图。修改页面的脚本设 mutatesPage:true。
- 图片候选用 tools.list_images，选定 target/URL 用 tools.collect_images 保存；可在脚本中滚动、整理元信息，截图保存用 screenshot 的 destination=图集表名。
- tools.data_store/collect_images/save_file/download_url/document_* 生成的表和文件自动成为任务产物。大数据在脚本内分批写入。
- 返回小摘要，如 {ok, stage, count, inserted, updated, totalRows, table, sample, errors}，sample 最多 1–3 条。

示例：
async () => {
  // 读取当前列表页条目，验证解析结果。
  let stage = "select";
  try {
    const items = [...document.querySelectorAll(".item")];
    trace(stage, {count: items.length});
    stage = "parse";
    const rows = items.map(el => ({text: el.textContent.trim()}));
    return {ok: true, stage, count: rows.length, sample: rows.slice(0, 3)};
  } catch (e) {
    trace("fail", {stage, message: e.message});
    return {ok: false, stage, error: e.message};
  }
}`,
    en: `Execute temporary JavaScript with top-level await; invoke packaged scripts through their Skill tools. Provides input/args, tools/tool, and trace/log. tools dynamically proxies this run's available tools: call await tools.find_elements({...}) or tools.data_store({...}) directly; discover capabilities with await tools.$list().

Execution environments:
- target omitted or "page": an explicit task-owned tabId or workingTabId, with tabId/document/window/Web APIs. Unavailable context returns page_context_unavailable.
- target:"inner": an internal offscreen Worker with standard JavaScript/Web Worker APIs, without document/window/DOM/tabId; for page-independent computation, data_store, save_file/document_*, and ask_llm orchestration.
- open_tab creates a working tab, use_tab selects it, list_tabs reports status. Read another task's tab only through read-only page tools with explicit tabId.
- Use standard APIs; DevTools getEventListeners/$0/copy/monitorEvents are unavailable.

Execution and results:
- Set timeout; use a few dozen seconds for light reads or 0 for explicitly long collection/pagination/bulk writes, stopped by the user.
- Prefer one async () => { ... } function expression as code; the tool invokes it. Start with a one-line comment naming the page, task, and purpose.
- Track stage in complex scripts and trace start, selector counts, branches, loop progress, and catch. Correct failures using diagnostic + trace before retrying.
- For dynamic pages, lazy loading, or virtual lists, use bounded waitFor(fn,label,timeout) and check element existence before reading properties.
- Page mode supports reads, parsing, storage, DOM debugging, ask_llm analysis, and verified interaction batches. Verify visual sequences one step at a time first. Only with expected effects, predictable subsequent coordinates, and a stable viewport reported by viewportChange, call await tools.act_on_screen serially. Use returnScreenshot:false for intermediate actions, check coordinateBasisReady each step, and return immediately if conditions fail. Observe through screenshot or act_on_screen(returnScreenshot:true); the tool returns the last observation image in execution order. Set mutatesPage:true for page-changing scripts.
- Discover image candidates with tools.list_images; save selected targets/URLs with tools.collect_images. Scripts can scroll and organize metadata; save screenshots with destination set to the gallery table.
- Tables/files produced by tools.data_store/collect_images/save_file/download_url/document_* become task artifacts automatically. Write bulk data in batches inside the script.
- Return a small summary such as {ok, stage, count, inserted, updated, totalRows, table, sample, errors}, with at most 1–3 samples.

Example:
async () => {
  // Read current list items to verify parsing.
  let stage = "select";
  try {
    const items = [...document.querySelectorAll(".item")];
    trace(stage, {count: items.length});
    stage = "parse";
    const rows = items.map(el => ({text: el.textContent.trim()}));
    return {ok: true, stage, count: rows.length, sample: rows.slice(0, 3)};
  } catch (e) {
    trace("fail", {stage, message: e.message});
    return {ok: false, stage, error: e.message};
  }
}`,
  },
  runSkillScriptDescription: {
    "zh-CN": "内部工具：执行已加载 Skill 的脚本资源，复用 run_script page/inner 桥接，不直接暴露给模型。page 使用当前任务自有网页；inner 在内部 Worker 运行，无需 tab。",
    en: "Internal tool for loaded Skill script resources, reusing the run_script page/inner bridge; not exposed directly to the model. page uses a task-owned web tab; inner uses an internal Worker without a tab.",
  },
  runSkillScriptTarget: {
    "zh-CN": "执行目标。不填或 page=当前任务网页；inner=轻舟内部 Worker。",
    en: "Execution target. Omitted or page: the current task’s web page. inner: qz’s internal Worker.",
  },
  runSkillScriptTabId: {
    "zh-CN": "本次调用的目标标签页 ID；省略时使用当前任务 workingTabId。",
    en: "Target tab ID for this call. Defaults to the current task’s workingTabId.",
  },
  runSkillScriptSkill: {
    "zh-CN": "Skill 名称。",
    en: "Skill name.",
  },
  runSkillScriptScript: {
    "zh-CN": "Skill 包中的脚本路径，例如 scripts/collect-feed.js。",
    en: "Script path within the Skill package, such as scripts/collect-feed.js.",
  },
  runSkillScriptArgs: {
    "zh-CN": "脚本参数对象，通过 input 或 args 读取。",
    en: "Script arguments, available as input or args.",
  },
  runSkillScriptMutatesPage: {
    "zh-CN": "是否修改页面 DOM、表单或状态；默认 false，修改时设 true。",
    en: "Whether the script changes page DOM, forms, or state. Default false; set true for changes.",
  },
  runScriptTarget: {
    "zh-CN": "默认 page：当前任务网页上下文；inner：内部 offscreen Worker，用于与页面无关的 JS/data_store/save_file/document/ask_llm 批处理。",
    en: "Default page: the task's web page context. inner: internal offscreen Worker for page-independent JavaScript/data_store/save_file/document/ask_llm batches.",
  },
  runScriptArgs: {
    "zh-CN": "临时代码参数对象，通过 input 或 args 读取。",
    en: "Temporary code arguments, available as input or args.",
  },
  runScriptCode: {
    "zh-CN": "临时 JavaScript；最后一个表达式作为 result，函数体可 return。trace(...items)/log(...items) 写入结果 trace。先填 target/tabId/args/mutatesPage，最后填 code。",
    en: "Temporary JavaScript; the last expression becomes result, and function bodies can return. trace(...items)/log(...items) append to the result trace. Fill target/tabId/args/mutatesPage before code.",
  },
  scriptTimeout: {
    "zh-CN": "必填。脚本硬超时，单位秒；<= 0 表示无限等待，> 0 表示最多等待对应秒数。",
    en: "Required script timeout in seconds. <= 0 means no time limit; > 0 sets the maximum duration.",
  },
  scriptShapeRecovery: {
    "zh-CN": "使用单个 async () => { let stage='init'; try { ... return {ok:true, stage}; } catch(e) { trace('fail',{stage,message:e.message}); return {ok:false, stage, error:e.message}; } }。",
    en: "Use a single async () => { let stage='init'; try { ... return {ok:true, stage}; } catch(e) { trace('fail',{stage,message:e.message}); return {ok:false, stage, error:e.message}; } } function expression.",
  },
  workingTabRecovery: {
    "zh-CN": "用 open_tab/use_tab 选定工作网页；与页面无关的处理传 target:\"inner\"。",
    en: "Select a working page with open_tab/use_tab; pass target:\"inner\" for page-independent processing.",
  },
});

export const toolT = createTranslator(messages);
