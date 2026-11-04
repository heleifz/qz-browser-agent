import { defineMessages } from "#sdk/shared/i18n-definition";
import { createTranslator } from "#sdk/shared/i18n";

/** Model-facing documentation stays with the tool contribution, outside the UI catalog. */
const messages = defineMessages("script-tools", {
  runScriptDescription: {"zh-CN": "在页面外执行 JavaScript 编排，支持顶层 await 和 return。通过 tools 调用当前可用工具，成功直接返回业务值（包括 Skill），失败抛错；每个页面调用显式传 tabRef；通过 tools.evaluate 在页面内执行函数。通过 args 读取参数。有依赖的步骤用 await，独立页面流程用 Promise.all，需要全部结果时用 Promise.allSettled。返回前等待所有工具调用，脚本退出会取消未完成调用。代码 return 业务值；交给模型的回执为 {ok,result,trace}，失败时 result 为错误，trace 包含 console、trace 和嵌套调用诊断。timeout 单位为秒，默认 120；0 不设置本次截止时间，仍受父调用取消和期限约束。页面导航不会销毁外层脚本。", "en": "Run JavaScript orchestration outside pages, with top-level await and return. Call available tools through tools; awaited calls, including Skills, return business values directly and throw on failure. Each page call passes tabRef. Use tools.evaluate for a function inside a page. Read parameters from args. Use await for dependencies, Promise.all for independent page workflows, and Promise.allSettled for every outcome. Await tool calls before returning; script exit cancels unfinished calls. Return the business value needed. The model receives {ok,result,trace}; on failure result is an error, and trace includes console, trace and nested-call diagnostics. timeout is seconds, defaults to 120; 0 removes this call deadline while retaining parent cancellation and deadlines. Page navigation does not destroy the outer script."},
  evaluateDescription: {"zh-CN": "在 tabRef 指定的页面执行自包含函数并返回其 JSON 值。函数可访问 document/window 和页面登录态；外部值通过 args 传入，不捕获外层变量。页面函数不能调用 tools。脚本中的 code 可以直接传函数，JSON 调用传函数字符串。用外层工具执行导航和点击。默认等待当前文档 DOMContentLoaded 后执行；动态内容需等待具体条件。页面卸载可能中断本次 evaluate，代码不会自动重放。", "en": "Evaluate a self-contained function in the page identified by tabRef and return its JSON value. The function can use document/window and the page login state; pass outside values through args rather than captured variables. Page functions cannot call tools. Scripts can pass a function as code; JSON callers pass its source string. Perform navigation and clicks through outer tools. By default, wait for DOMContentLoaded in the current document before executing; wait for specific conditions for dynamic content. Unloading the page may interrupt this evaluation; code is never replayed automatically."},
  evaluateCode: {"zh-CN": "自包含的普通函数、箭头函数或 async 函数。", "en": "A self-contained ordinary, arrow or async function."},
  evaluateWaitUntil: {"zh-CN": "执行前的文档状态：domcontentloaded（默认）等待解析与延迟脚本；commit 在文档提交后即可执行，适合早期观察。不等待图片或网络空闲。", "en": "Document state before execution: domcontentloaded (default) waits for parsing and deferred scripts; commit allows early observation after navigation commits. Neither waits for images or network idle."},
  evaluateArgs: {"zh-CN": "作为函数唯一参数传入的 JSON 值。", "en": "A JSON value passed as the function’s single argument."},
  listToolsDescription: {"zh-CN": "查询当前会话可用工具。省略 names 返回简洁签名；指定 names 返回同一工具定义的完整参数。", "en": "Inspect tools available in this session. Omit names for compact signatures; provide names for their complete parameter definitions."},
  runSkillScriptDescription: {
    "zh-CN": "内部工具：执行已加载 Skill 包内的脚本资源（模型不直接调用）。page 必须使用当前任务已拥有的网页 tab；inner 运行在轻舟内部 Worker，不需要网页 tab。",
    en: "Internal tool: execute a script resource from a loaded Skill package (not called directly by the model). page requires a web tab owned by the current task; inner runs in qz's internal Worker without a web tab.",
  },
  runSkillScriptTarget: {
    "zh-CN": "执行目标：省略或 page=当前任务网页；inner=内部 Worker。",
    en: "Execution target: omitted or page for the current task's web page; inner for the internal Worker.",
  },
  runSkillScriptTabId: {
    "zh-CN": "本次调用的目标标签页 tabRef：别名或 open_tab/list_tabs 返回的 id。",
    en: "Target tabRef for this call: an alias or the id returned by open_tab/list_tabs.",
  },
  runSkillScriptSkill: {
    "zh-CN": "Skill 名称。",
    en: "Skill name.",
  },
  runSkillScriptScript: {
    "zh-CN": "Skill 包内脚本相对路径，如 scripts/collect-feed.js。",
    en: "Relative script path in the Skill package, such as scripts/collect-feed.js.",
  },
  runSkillScriptArgs: {
    "zh-CN": "传给脚本的参数对象（脚本内通过 args 读取）。",
    en: "Arguments object passed to the script (read via args).",
  },
  runSkillScriptMutatesPage: {
    "zh-CN": "脚本是否会修改页面 DOM、表单或状态，默认 false。",
    en: "Whether the script modifies page DOM, forms, or state. Default: false.",
  },
  runScriptArgs: {"zh-CN": "作为 args 传给外层脚本的 JSON 值。", "en": "A JSON value exposed as args in the outer script."},
  runScriptCode: {"zh-CN": "JavaScript 代码，支持顶层 await 和 return。", "en": "JavaScript code with top-level await and return."},
  scriptTimeout: {
    "zh-CN": "脚本超时秒数，默认 120；0 表示不限时，仍受任务取消和调用方期限约束。",
    en: "Script timeout in seconds, default 120. Zero removes the script limit; cancellation and the caller deadline still apply.",
  },
});

export const toolT = createTranslator(messages);
