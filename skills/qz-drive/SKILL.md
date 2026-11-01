---
name: qz-drive
description: Drive the connected browser. Put actions, waits, and reads in one run_script and return only the needed fields. Use qz script or qingzhou_execute_tool. Do not configure a qz model.
---

不要配置轻舟模型

<!-- qz-drive-guide:zh-CN -->
把操作、等待和取数写进一个脚本，只 return 需要的字段。

这是直驱的默认做法。一次 `run_script`，`target` 为 `"inner"`。脚本里用 `await tools.工具名(参数)` 调用已经存在的浏览器工具。成功时只要返回值。不要把整页快照、坐标或 trace 留在 return 里。

`qz exec` 和单次 `qingzhou_execute_tool` 是辅助。只在一两步的简单操作或调试时用。同一件事不要拆成多轮单次调用。

不要配置轻舟模型。不要调用 `qz create`。不要用 curl 或 wget 取页面正文。bash 只处理本机文件。

主范例：在公开练习页填日期和科目，只返回这两个字段。CLI 把下面的函数存成文件后执行 `qz script form.js`。MCP 用同一次 `qingzhou_execute_tool`，`name` 为 `run_script`，`args` 为 `{target:"inner", timeout:120, code}`，`code` 就是这个函数。两条路径是同一件事。

```js
async () => {
  const tab = "form";
  await tools.open_tab({ tabAlias: tab, url: "https://demoqa.com/automation-practice-form" });
  await tools.act_on_element({ tabRef: tab, target: "css:#dateOfBirthInput", action: "click" });
  await tools.wait_for_element({ tabRef: tab, selector: ".react-datepicker__month-select" });
  await tools.act_on_element({ tabRef: tab, target: "css:.react-datepicker__month-select", action: "select", value: "March" });
  await tools.act_on_element({ tabRef: tab, target: "css:.react-datepicker__year-select", action: "select", value: "1990" });
  await tools.act_on_element({ tabRef: tab, target: "css:.react-datepicker__day--015:not(.react-datepicker__day--outside-month)", action: "click" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "fill", value: "Maths" });
  await tools.wait_for_element({ tabRef: tab, selector: ".subjects-auto-complete__option" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "press", key: "Enter" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "fill", value: "Computer Science" });
  await tools.wait_for_element({ tabRef: tab, selector: ".subjects-auto-complete__option" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "press", key: "Enter" });
  const read = await tools.run_script({
    tabRef: tab,
    timeout: 10,
    code: "async () => ({ dob: document.querySelector('#dateOfBirthInput')?.value || '', chips: [...document.querySelectorAll('.subjects-auto-complete__multi-value__label')].map(node => node.textContent.trim()) })",
  });
  return { dob: read.result.dob, chips: read.result.chips };
}
```

`select` 的 `value` 先匹配 `option.value`，再匹配去掉首尾空白的可见文字，所以 `"March"` 和 `"1990"` 可以用。`wait_for_element` 的 `selector` 是原始 CSS，或带 `css:` 前缀。`uid:` 不能用于等待。

多页也放进同一个脚本。打开第一页，其余页用 `navigate`。这一题只返回 Node.js 20、Python 3.12、Ubuntu 22.04 LTS 的发布日和支持截止。页面没有表格时返回标题和地址，不要返回空数组。

```js
async () => {
  const tab = "sources";
  await tools.open_tab({ tabAlias: tab, url: "https://nodejs.org/en/about/previous-releases" });
  await tools.wait_for_element({ tabRef: tab, selector: "#tbVersions tbody tr" });
  const node = await tools.run_script({ tabRef: tab, timeout: 15, code: "async () => { const row = [...document.querySelectorAll('#tbVersions tbody tr')].find(item => /^v20\\b/.test(item.innerText.trim())); const cells = row ? [...row.querySelectorAll('td')].slice(0, 5).map(cell => cell.innerText.replace(/\\s+/g, ' ').trim()) : []; return { version: cells[0] || '', released: cells[2] || '', lastUpdated: cells[3] || '', status: cells[4] || '' }; }" });
  await tools.navigate({ tabRef: tab, url: "https://devguide.python.org/versions/" });
  const python = await tools.run_script({ tabRef: tab, timeout: 20, code: "async () => { const start = Date.now(); let hit; while (Date.now() - start < 15000) { hit = [...document.querySelectorAll('table tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.innerText.replace(/\\s+/g, ' ').trim())).find(cells => /^3\\.12\\b/.test(cells[0] || '')); if (hit) break; await new Promise(resolve => setTimeout(resolve, 500)); } if (hit) return { version: hit[0], status: hit[2] || '', released: hit[3] || '', supportEnd: hit[4] || '' }; return { title: document.title, href: location.href }; }" });
  await tools.navigate({ tabRef: tab, url: "https://ubuntu.com/about/release-cycle" });
  await tools.wait_for_element({ tabRef: tab, selector: "body" });
  const ubuntu = await tools.run_script({ tabRef: tab, timeout: 15, code: "async () => { const text = document.body.innerText || ''; const at = text.indexOf('22.04 LTS'); const slice = at < 0 ? '' : text.slice(at, at + 280); const released = slice.match(/Released:\\s*([A-Za-z]+ \\d{4})/); const supportEnd = slice.match(/Standard security maintenance\\s*([A-Za-z]+ \\d{4})/); return { version: '22.04 LTS', released: released ? released[1] : '', supportEnd: supportEnd ? supportEnd[1] : '' }; }" });
  return { node: node.result, python: python.result, ubuntu: ubuntu.result };
}
```

先读这份说明书。CLI：`qz skill` 或 `qz --help` 直接打印。语言用 `--lang zh-CN` 或 `en`，否则看 `QZ_GUIDE_LANG` 和 `LANG`。MCP：先调用一次 `qingzhou_guide`，它返回全文。不要每轮重读。默认 MCP 工具只有 `qingzhou_guide`、`qingzhou_execute_tool`、`qingzhou_list_tools`、`qingzhou_get_tool`、`qingzhou_bridge_status`。调试用 `qz mcp --profile full`，那是任务和诊断目录，不是默认。

会话。直驱会话的 source 是 `external-drive`。不传 `sessionId` 时，这一条 MCP 连接共用一个新 id。`qz script` 和 `qz exec` 每个进程都是新连接；省略 `--session` 会新建会话。成功或失败都把 `sessionId <id>` 写到 stderr。下一进程用 `qz script --session <id> file.js`。并行的几路各用自己的 sessionId。已有普通任务占用的 id 返回 `DRIVE_SESSION_OCCUPIED`，换一个新 id。同一会话已有调用在飞时返回 `DRIVE_SESSION_BUSY`，等它结束，不要再发一轮。`tabAlias` 只在本会话内有效，1–64 个字母、数字、下划线或连字符，不能全是数字。引用别名前，`open_tab` 必须已经出现。页面参数用 `tabRef`（别名或正整数标签页 id）。执行时它会变成 `tabId`。不要自己造 `page(...)` 或别的简写。

脚本怎么写。`code` 是单个 `async () => { ... }` 函数表达式。不要写 IIFE、`main()`，也不要在函数外 `return`。开头用一行注释说明页面、动作和目的。只通过 `tools.名字(参数)` 调用工具。名字、参数和错误码与 `qz exec`、`qingzhou_execute_tool` 相同。`tools.$list()` 查看当前可用工具，不要用 `Object.keys(tools)`。嵌套调用和 `$list` 使用同一份黑名单。`target:"inner"` 没有 `document`、`window`、DOM、`tabId`。要读页面字段，再调用 `tools.run_script({tabRef, timeout, code})`，那个内层脚本才有 `document`。`timeout` 单位是秒，脚本必填；`<= 0` 表示不限时，`> 0` 表示最多等待这么多秒。`qz script` 默认传 120，可用 `--timeout` 覆盖。嵌套深度最多 3。复杂步骤用 `trace(...)`。失败时看返回的 `code` 和最多 5 条 trace，改脚本再跑，不要把失败结果原样再塞进下一轮上下文。

成功时工具结果是 `{ok:true, result}`。`qz script` 的 stdout 只打印 `result`。失败时打印 `code`、`error` 和最后 5 条 trace，退出码 1。没有 trace 的失败只有 `code` 和 `error`。

常用签名。未写「必填」的字段可省略。页面工具省略 `tabRef` 时用本会话工作标签页。

- `tools.open_tab({url, tabAlias})` 打开网页。`url` 必填。新页面用 `tabAlias`，随后用 `tabRef` 引用。
- `tools.navigate({url, tabRef})` 在已有标签页打开另一个 URL。`url` 必填。
- `tools.act_on_element({tabRef, target, action, value, key})`。`target` 用 `uid:` 或 `css:`。`action` 是 `click`、`fill`、`press`、`select`、`check`、`uncheck`、`scroll`。`fill` 把 `value` 写入输入框，空字符串清空。`press` 传 `key`，例如 `"Enter"`。`select` 传 `value`。
- `tools.wait_for_element({tabRef, selector, timeout, absent})`。`selector` 必填。`timeout` 默认 10 秒。`absent:true` 表示等到元素消失。超时不抛错，返回 `{found:false, timedOut:true}`。脚本要看 `found`，再读页面。
- `tools.run_script({target, tabRef, timeout, code, mutatesPage})`。编排用 `target:"inner"`。页面读取省略 `target` 或用 `"page"`，并传 `tabRef`。`timeout` 与 `code` 必填。会改页面时 `mutatesPage:true`。
- `tools.find_elements({tabRef, pattern, selector, roles, tags, types, limit})`。`limit` 默认 20。用它定位，不要先把整页 DOM 读回来。
- `tools.get_ax_tree({tabRef, root, scope, depth, limit, actionsLimit})`。默认视口、`depth` 16、`limit` 120。只在需要元素 `uid:` 时调用，并缩小 `root` 或 `limit`。
- `tools.list_tabs({})` 默认只返回本会话标签页：`{tabs:[{id, alias, title, url}], count, foreign}`。`scope:"all"` 列出全部网页标签。`verbose:true` 才保留几何字段。
- `tools.screenshot({tabRef})` 不是默认步骤。字节走图片块，不会嵌进 JSON 文本。
- `tools.load_skill({name})` 然后 `tools.load_skill_resource({name, path})`。同一站点已有 Skill 时先读它，再写临时脚本。
- `tools.list_skills({scope, query})` 只有摘要。`tools.data_store(...)` 写表。大批行在脚本里分批写入，return 只留计数和至多 1–3 条 sample。

少取数据。不要为了找一个按钮去 `list_tabs` 再 `get_ax_tree` 再截图。脚本里等待具体选择器，然后只 return 字段。不要调用 `get_trace`。单次结果大约超过 48000 个字符时变成 `{truncated:true, totalChars, limitChars, preview}`。JSON 不缩进。除非 `verbose:true`，结果里去掉 `_tabId`、`_pageTitle`、`_pageUrl`、`_pageContext`、`sessionId`、`runId`，以及 `rect`、`clickablePoint`、`parent`、`lineRange`、`actionable`。`list_tools` 不列出黑名单工具，返回 `name`、一行 `signature` 和短描述，不返回完整 JSON Schema。`qz tools` 打印这些签名；`qz tools 名字` 看一个工具。

文档。先 `tools.load_skill({name:"qingzhou-documents"})`。然后用 `qingzhou_documents__document_fetch`、`document_parse`、`document_read_chunk`、`document_create`、`document_download`、`document_list_artifacts`。这些文档工具的 `timeout` 可省略，默认 120 秒。其他脚本工具的 `timeout` 仍然必填。

Chrome 的 PDF 查看器地址如果嵌了 http(s) 或 file URL，按那个文件地址处理。本会话拥有的查看器标签页可以读取。不要因为地址以 `chrome-extension://` 开头就当成打不开。

出错就停，把工具返回的 `code` 和那一句原样告诉用户，然后按下面改一次再试。

- `DRIVE_TOOL_FORBIDDEN`：这个名字不能直驱，包括脚本里的 `tools.名字`。换一个允许的工具。
- `DRIVE_SESSION_OCCUPIED`：这个 id 已有任务。用新的 sessionId。
- `DRIVE_SESSION_BUSY`：这个会话正在执行。等当前调用结束。
- `DRIVE_ARGUMENTS`：`name` 与 `calls` 只能二选一。`calls` 的每项要有 `id`、`name`，`args` 是对象。
- `DRIVE_TOO_MANY_CALLS`：一批最多 10 个调用。
- `DRIVE_BATCH_TIMEOUT`：`limits.timeoutSeconds` 到了。加大限制或把工作放进一个脚本。
- `UNKNOWN_TOOL`：名字不存在。先 `qz tools` 或 `tools.$list()`，不要猜 `browser_open`、`open_url`。
- `MISSING_REQUIRED_ARGUMENTS`：补上 `details.missing` 里的字段。
- `INVALID_TIMEOUT`：`timeout` 必须是秒数。
- `BATCH_TAB_REFERENCE_ERROR`：`tabRef` 或 `tabAlias` 不对，或 `open_tab` 排在引用之后。
- `SESSION_TAB_UNOWNED`：标签页不属于本会话。用本会话的 `tabRef`，或先 `open_tab`。
- `SESSION_TAB_NOT_WEB`：目标不是网页。PDF 查看器要由本会话拥有，或地址里能还原出文件 URL。
- `RUN_SCRIPT_TOOL_DEPTH_EXCEEDED`：嵌套超过 3 层。把调用展平到这个脚本里。
- `OPERATION_ABORTED`：调用被取消或超时。先看页面是否已经变化，再决定要不要重试。
- `BRIDGE_REQUEST_TIMEOUT`：桥接超时。浏览器里的操作可能还在跑。先看会话，不要立刻重发。

不能直驱的名字：`ask_llm`、`manage_sessions`、`manage_settings`、`manage_guardrails`、`manage_skill_settings`、`qingzhou_call`、`create_skill`、`update_skill`、`delete_skill`、`manage_skill`、`edit_skill_resource`、`import_skill_from_page_zip`、`import_git_skill_repository`、`install_skill_to_git`、`import_page_zip`、`import_git_repository`、`manage_bookmarks`、`wait_for_user`、`ask_user`、`send_message`，以及任何 `mcp_` 开头的名字。侧栏对直驱会话只查看。不要改那两句拒绝文案，也不要通过脚本绕过黑名单。

一轮请求长什么样。MCP 默认先 `qingzhou_guide`，之后每一轮尽量只有一次 `qingzhou_execute_tool`：

```json
{"name":"run_script","args":{"target":"inner","timeout":120,"code":"async () => { /* 页面、动作、目的 */ return { ok: true }; }"}}
```

同一会话的后续调用带上 stderr 里的 `sessionId`。CLI 等价写法是 `qz script - --session <id> <<'JS'`，脚本从 stdin 读入，不要包一层 JSON。`qz script file.js` 读文件。stdout 只有 `return` 的值。调试一两步时才用 `qz exec`，JSON 为 `{"name":"wait_for_element","args":{"tabRef":"form","selector":"#done"}}`。`calls` 同样只用于这种短批次：每项 `{id, name, args}`，一批最多 10 个，需要别名时把 `open_tab` 放在前面。

操作结果留下动作是否发生，不留下坐标。`click` 看 `inputDelivered`。`fill` 看写入后的值。`press` 看 `pressed` 和 `key`。`select` 看选中的值。`check` 看选中状态。这些字段里如果还有 `rect`、`clickablePoint`、`parent`、`lineRange`、`actionable`，直驱会去掉，除非这次参数带 `verbose:true`。页面跳转看 `navigated` 或返回里的 URL 变化；没有这些字段就再读你关心的那一个节点，不要整页重抓。

元素目标只有两种。`css:` 后面是 CSS 选择器，例如 `css:#dateOfBirthInput` 或 `css:.react-datepicker__day--015:not(.react-datepicker__day--outside-month)`。`uid:` 后面是 `get_ax_tree` 或 `find_elements` 返回的引用。等待只用 `selector`，不要把 `uid:` 传给 `wait_for_element`。选择器对不上时，改选择器或先 `find_elements({pattern, limit:5})`，不要改用截图坐标。

少取数据时按这个顺序。能写死选择器就不要读树。必须读树时把 `get_ax_tree` 的 `limit` 降到 40，并传 `root`。表格只在页面脚本里 `filter` 出需要的行。列表页只 return `{count, sample}`。文件先 `load_skill` 文档工具，用 `document_read_chunk` 的 `offset` 和 `limit` 读一块，不要一次 parse 完全文再塞进 return。`list_tabs` 默认已经是本会话的短列表；只有要找用户自己打开的标签时才传 `scope:"all"`。

空闲大约 30 分钟没有新调用时，直驱会话会结束并关闭它打开的标签。需要留下标签时不要依赖空闲，先把结果取回。`qingzhou_stop_session` 不在默认工具列表里；结束观察用新的 sessionId 即可。侧栏能看到每次工具调用的平铺记录，直驱会话不能在侧栏发消息。

返回值怎么读。`open_tab` 成功时看 `id`，这是标签页数字 id，也可以当作下一次的 `tabRef`。同时记下你传的 `tabAlias`。`get_ax_tree` 成功时读 `snapshot` 文本，不要再要一份节点数组。`find_elements` 用返回的 `target` 作为下一次 `act_on_element` 的 `target`。页面 `run_script` 的有用值在 `result` 里，外层脚本把它放进自己的 `return`。直驱成功包一层 `{ok:true, result}`；`qz script` 去掉这层，stdout 就是内层 `result`。失败 stdout 是 JSON：`{"code":"……","error":"……","trace":[……]}`，`trace` 最多 5 条。stderr 始终有一行 `sessionId` 加空格加 id。退出码 0 是成功，1 是工具失败，2 是参数不合法。

第一次失败时只改一处。选择器超时：把 `wait_for_element` 的 `timeout` 调到 20，选择器改成页面上确实存在的那个。`select` 没选中：`value` 改成 option 的 value 或可见文字，不要改 action 的名字。科目没出现：先 `fill`，再等 `.subjects-auto-complete__option`，再 `press` `Enter`，不要在选项出现前按键。`SESSION_TAB_UNOWNED`：不要复用别的会话或用户标签的数字 id，除非本会话已经 `open_tab` 或明确接管。脚本抛错：看 `trace` 最后一条的 message，改那一行。不要为了重试而新开一个 sessionId，除非错误码是 `DRIVE_SESSION_OCCUPIED`。

参数记这几条。`timeout` 在脚本和 `wait_for_element` 上都是秒，不是毫秒。`limits.timeoutSeconds` 只限制一批 `calls` 的总时间，不代替脚本里的 `timeout`。`tabRef` 可以是别名或数字 id，不要两个都传。`open_tab` 不要传 `tabRef`。`act_on_element` 的 `target` 必填，`action` 必填。`fill` 和 `select` 要有 `value`。`press` 要有 `key`。`mutatesPage` 只在页面脚本会改 DOM 时设为 true，编排用的 inner 脚本不用设。`verbose` 只在你确实要坐标时加。`scope:"all"` 只加在 `list_tabs` 上。文档工具名字带前缀 `qingzhou_documents__`，不要写成 `document_fetch`。Skill 名字是 `qingzhou-documents`，中间是连字符。

和内置任务的差别。直驱没有模型循环，也没有轻舟侧的规划。你写的脚本就是整轮操作。内置任务里的 `run_script` 同样使用这份 inner 说明：用它把多次工具调用收成一次，只 return 摘要。直驱额外会删掉黑名单工具、压短列表，并把成功的脚本结果收成 `{ok, result}`。两边的工具名和参数一致，所以同一段 `code` 可以在 `qz script` 和 `qingzhou_execute_tool` 之间原样搬。不要为直驱另写一套函数名。

取数停在能回答问题的那一层。日期题返回日期字符串和科目标签。版本题返回三份来源里各自匹配的几行，不要返回整张表，也不要返回页面标题以外的装饰文字。能从 DOM 读到的字段就不要截图。能从选择器点到的控件就不要先取无障碍树。

不要把这份全文改写成另一套步骤。以这里的工具名、参数和错误码为准。页面脚本和编排脚本都写 `tools.名字(参数)`，不要再包一层助手函数。同一段 code 在 qz script 和 qingzhou_execute_tool 之间原样使用，不要改参数名。需要的字段只包括题目要求的日期、科目或版本行，并写进 return 即可，不要省略。

工具描述里的「先读说明书」就是这份全文。一条新连接读一次。同一连接的后续轮次不要再调用 `qingzhou_guide`，除非换了语言，或手头的文本不完整。`qz skill` 不连接浏览器，只打印说明书。`qz --help` 在命令列表后面附上同一份文本。

连接。先 `qz connect`。外部客户端使用 `qz mcp` 打印的地址。默认就是这份直驱目录。打印出来的文本和 Skill 文件是同一份。
<!-- qz-drive-guide:end -->

<!-- qz-drive-guide:en -->
Put the actions, the waits, and the reads in one script. Return only the fields you need.

That is the default way to drive the connected browser. One `run_script` with `target` `"inner"`. Inside it, call existing browser tools with `await tools.tool_name(arguments)`. On success, return the value and nothing else. Do not return a full-page snapshot, coordinates, or the trace.

`qz exec` and a single `qingzhou_execute_tool` call are auxiliary. Use them for one or two simple steps, or while debugging. Do not split one task into a round of single calls.

不要配置轻舟模型. Do not call `qz create`. Do not use curl or wget to fetch page content. bash stays available for local files only.

Main example: fill the date and subjects on the public practice form, and return only those fields. From the CLI, save the function and run `qz script form.js`. From MCP, one `qingzhou_execute_tool` with `name` `run_script` and `args` `{target:"inner", timeout:120, code}` where `code` is this function. Both paths are the same call.

```js
async () => {
  const tab = "form";
  await tools.open_tab({ tabAlias: tab, url: "https://demoqa.com/automation-practice-form" });
  await tools.act_on_element({ tabRef: tab, target: "css:#dateOfBirthInput", action: "click" });
  await tools.wait_for_element({ tabRef: tab, selector: ".react-datepicker__month-select" });
  await tools.act_on_element({ tabRef: tab, target: "css:.react-datepicker__month-select", action: "select", value: "March" });
  await tools.act_on_element({ tabRef: tab, target: "css:.react-datepicker__year-select", action: "select", value: "1990" });
  await tools.act_on_element({ tabRef: tab, target: "css:.react-datepicker__day--015:not(.react-datepicker__day--outside-month)", action: "click" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "fill", value: "Maths" });
  await tools.wait_for_element({ tabRef: tab, selector: ".subjects-auto-complete__option" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "press", key: "Enter" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "fill", value: "Computer Science" });
  await tools.wait_for_element({ tabRef: tab, selector: ".subjects-auto-complete__option" });
  await tools.act_on_element({ tabRef: tab, target: "css:#subjectsInput", action: "press", key: "Enter" });
  const read = await tools.run_script({
    tabRef: tab,
    timeout: 10,
    code: "async () => ({ dob: document.querySelector('#dateOfBirthInput')?.value || '', chips: [...document.querySelectorAll('.subjects-auto-complete__multi-value__label')].map(node => node.textContent.trim()) })",
  });
  return { dob: read.result.dob, chips: read.result.chips };
}
```

`select` matches `option.value` first, then the visible label with surrounding whitespace removed, so `"March"` and `"1990"` work. `wait_for_element` `selector` is raw CSS or a `css:` prefix. `uid:` is not a wait selector.

Several pages belong in the same script. Open the first URL and `navigate` the rest. Return only Node.js 20, Python 3.12, and Ubuntu 22.04. No table: return the title and URL.

```js
async () => {
  const tab = "sources";
  await tools.open_tab({ tabAlias: tab, url: "https://nodejs.org/en/about/previous-releases" });
  await tools.wait_for_element({ tabRef: tab, selector: "#tbVersions tbody tr" });
  const node = await tools.run_script({ tabRef: tab, timeout: 15, code: "async () => { const row = [...document.querySelectorAll('#tbVersions tbody tr')].find(item => /^v20\\b/.test(item.innerText.trim())); const cells = row ? [...row.querySelectorAll('td')].slice(0, 5).map(cell => cell.innerText.replace(/\\s+/g, ' ').trim()) : []; return { version: cells[0] || '', released: cells[2] || '', lastUpdated: cells[3] || '', status: cells[4] || '' }; }" });
  await tools.navigate({ tabRef: tab, url: "https://devguide.python.org/versions/" });
  const python = await tools.run_script({ tabRef: tab, timeout: 20, code: "async () => { const start = Date.now(); let hit; while (Date.now() - start < 15000) { hit = [...document.querySelectorAll('table tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.innerText.replace(/\\s+/g, ' ').trim())).find(cells => /^3\\.12\\b/.test(cells[0] || '')); if (hit) break; await new Promise(resolve => setTimeout(resolve, 500)); } if (hit) return { version: hit[0], status: hit[2] || '', released: hit[3] || '', supportEnd: hit[4] || '' }; return { title: document.title, href: location.href }; }" });
  await tools.navigate({ tabRef: tab, url: "https://ubuntu.com/about/release-cycle" });
  await tools.wait_for_element({ tabRef: tab, selector: "body" });
  const ubuntu = await tools.run_script({ tabRef: tab, timeout: 15, code: "async () => { const text = document.body.innerText || ''; const at = text.indexOf('22.04 LTS'); const slice = at < 0 ? '' : text.slice(at, at + 280); const released = slice.match(/Released:\\s*([A-Za-z]+ \\d{4})/); const supportEnd = slice.match(/Standard security maintenance\\s*([A-Za-z]+ \\d{4})/); return { version: '22.04 LTS', released: released ? released[1] : '', supportEnd: supportEnd ? supportEnd[1] : '' }; }" });
  return { node: node.result, python: python.result, ubuntu: ubuntu.result };
}
```

Read this guide first. CLI: `qz skill` or `qz --help` prints it. `--lang zh-CN` or `en` selects the language; otherwise `QZ_GUIDE_LANG` and `LANG` do. MCP: call `qingzhou_guide` once. It returns the full text. Do not read it again every turn. The default MCP tools are `qingzhou_guide`, `qingzhou_execute_tool`, `qingzhou_list_tools`, `qingzhou_get_tool`, and `qingzhou_bridge_status`. `qz mcp --profile full` is the task and diagnostic catalog, not the default.

Sessions. A drive session has source `external-drive`. Omit `sessionId` and this MCP connection keeps one new id. Each `qz script` or `qz exec` process is a new connection; omitting `--session` starts a session. Success and failure write `sessionId <id>` to stderr. The next process passes `qz script --session <id> file.js`. Parallel paths each use their own sessionId. An id that already belongs to a normal task returns `DRIVE_SESSION_OCCUPIED`; use a new id. A session that already has a call in flight returns `DRIVE_SESSION_BUSY`; wait for that call. `tabAlias` belongs to this session: 1–64 letters, digits, underscores, or hyphens, and not all digits. The `open_tab` that creates an alias comes before any call that uses it. Page arguments use `tabRef` (an alias or a positive integer tab id). Execution renames it to `tabId`. Do not invent `page(...)` or another shorthand.

How to write a script. `code` is one `async () => { ... }` function expression. No IIFE, no `main()`, no `return` outside the function. Start with a one-line comment naming the page, the action, and the purpose. Call tools only as `tools.name(arguments)`. Names, parameters, and error codes are the same ones `qz exec` and `qingzhou_execute_tool` use. `tools.$list()` lists the tools available now. Do not use `Object.keys(tools)`. Nested calls and `$list` use the same blacklist. `target:"inner"` has no `document`, `window`, DOM, or `tabId`. To read page fields, call `tools.run_script({tabRef, timeout, code})`. That inner page script has `document`. `timeout` is seconds and is required on scripts; `<= 0` means no limit, `> 0` is the maximum wait. `qz script` sends 120 unless `--timeout` says otherwise. Nested depth stops at 3. Use `trace(...)` at important steps. On failure, read `code` and at most five trace rows, change the script, and run it again. Do not paste the failed payload back into the next turn.

A successful tool result is `{ok:true, result}`. `qz script` prints only `result` on stdout. A failure prints `code`, `error`, and the last five trace rows, and exits 1. A failure without a trace has `code` and `error` only.

Common signatures. Fields not marked required may be omitted. Page tools use the session working tab when `tabRef` is omitted.

- `tools.open_tab({url, tabAlias})` opens a page. `url` is required. Name a new page with `tabAlias` and refer to it with `tabRef`.
- `tools.navigate({url, tabRef})` opens another URL in an existing tab. `url` is required.
- `tools.act_on_element({tabRef, target, action, value, key})`. `target` is `uid:` or `css:`. `action` is `click`, `fill`, `press`, `select`, `check`, `uncheck`, or `scroll`. `fill` writes `value` into an input; `""` clears it. `press` sends `key`, for example `"Enter"`. `select` sends `value`.
- `tools.wait_for_element({tabRef, selector, timeout, absent})`. `selector` is required. `timeout` defaults to 10 seconds. `absent:true` waits until the element is gone. A timeout returns `{found:false, timedOut:true}` and does not throw. Check `found`.
- `tools.run_script({target, tabRef, timeout, code, mutatesPage})`. Orchestration uses `target:"inner"`. A page read omits `target` or uses `"page"` and passes `tabRef`. `timeout` and `code` are required. Set `mutatesPage:true` when the page script changes the page.
- `tools.find_elements({tabRef, pattern, selector, roles, tags, types, limit})`. `limit` defaults to 20. Use it to locate elements. Do not read the whole DOM first.
- `tools.get_ax_tree({tabRef, root, scope, depth, limit, actionsLimit})`. Defaults are the viewport, `depth` 16, and `limit` 120. Call it only when you need an element `uid:`, and narrow `root` or `limit`.
- `tools.list_tabs({})` defaults to this session: `{tabs:[{id, alias, title, url}], count, foreign}`. `scope:"all"` lists every web tab. `verbose:true` keeps geometry.
- `tools.screenshot({tabRef})` is not a default step. Bytes travel as image blocks, not as base64 inside JSON text.
- `tools.load_skill({name})`, then `tools.load_skill_resource({name, path})`. When a Skill already covers the site, read it before writing a temporary script.
- `tools.list_skills({scope, query})` returns summaries. `tools.data_store(...)` writes tables. Write large rows in batches inside the script. Return a count and at most one to three sample rows.

Fetch less. Do not call `list_tabs`, then `get_ax_tree`, then a screenshot to find one button. Wait for the selector in the script and return the fields. Do not call `get_trace`. A result past about 48000 characters becomes `{truncated:true, totalChars, limitChars, preview}`. JSON is compact. Unless `verbose:true`, results omit `_tabId`, `_pageTitle`, `_pageUrl`, `_pageContext`, `sessionId`, `runId`, `rect`, `clickablePoint`, `parent`, `lineRange`, and `actionable`. `list_tools` hides blacklisted tools and returns `name`, a one-line `signature`, and a short description, not a full JSON Schema. `qz tools` prints those signatures. `qz tools NAME` shows one tool.

Documents. Call `tools.load_skill({name:"qingzhou-documents"})` first. Then `qingzhou_documents__document_fetch`, `document_parse`, `document_read_chunk`, `document_create`, `document_download`, and `document_list_artifacts`. Timeout on those document tools is optional and defaults to 120 seconds. Other script tools still require `timeout`.

A Chrome PDF viewer URL that embeds an http(s) or file URL is handled as that file URL. A viewer tab owned by this session can be read. Do not treat an address as unreadable only because it starts with `chrome-extension://`.

On an error, stop. Tell the user the returned `code` and the returned sentence unchanged, then change one thing and retry.

- `DRIVE_TOOL_FORBIDDEN`: direct drive cannot call this name, including `tools.name` inside a script. Use an allowed tool.
- `DRIVE_SESSION_OCCUPIED`: a task already uses this id. Use a new sessionId.
- `DRIVE_SESSION_BUSY`: this session already has a call in flight. Wait for it.
- `DRIVE_ARGUMENTS`: pass `name` or `calls`, not both. Each call needs `id` and `name`. `args` is an object.
- `DRIVE_TOO_MANY_CALLS`: a batch holds at most 10 calls.
- `DRIVE_BATCH_TIMEOUT`: `limits.timeoutSeconds` elapsed. Raise it, or move the work into one script.
- `UNKNOWN_TOOL`: the name does not exist. Run `qz tools` or `tools.$list()`. Do not guess `browser_open` or `open_url`.
- `MISSING_REQUIRED_ARGUMENTS`: add the fields in `details.missing`.
- `INVALID_TIMEOUT`: `timeout` must be a number of seconds.
- `BATCH_TAB_REFERENCE_ERROR`: `tabRef` or `tabAlias` is wrong, or `open_tab` comes after the call that uses the alias.
- `SESSION_TAB_UNOWNED`: the tab is not owned by this session. Use this session's `tabRef`, or `open_tab` first.
- `SESSION_TAB_NOT_WEB`: the target is not a web page. A PDF viewer must be owned by this session, or its URL must still contain the file URL.
- `RUN_SCRIPT_TOOL_DEPTH_EXCEEDED`: nesting passed 3. Flatten the calls into this script.
- `OPERATION_ABORTED`: the call was cancelled or timed out. Look at the page before retrying.
- `BRIDGE_REQUEST_TIMEOUT`: the bridge timed out. The browser operation may still be running. Inspect the session before repeating it.

Names direct drive cannot call: `ask_llm`, `manage_sessions`, `manage_settings`, `manage_guardrails`, `manage_skill_settings`, `qingzhou_call`, `create_skill`, `update_skill`, `delete_skill`, `manage_skill`, `edit_skill_resource`, `import_skill_from_page_zip`, `import_git_skill_repository`, `install_skill_to_git`, `import_page_zip`, `import_git_repository`, `manage_bookmarks`, `wait_for_user`, `ask_user`, `send_message`, and any name that starts with `mcp_`. The side panel for a drive session is view-only. Do not route around the blacklist from a script.

What one turn looks like. On MCP, call `qingzhou_guide` first. After that, a turn should be one `qingzhou_execute_tool`:

```json
{"name":"run_script","args":{"target":"inner","timeout":120,"code":"async () => { /* page, action, purpose */ return { ok: true }; }"}}
```

Later calls on the same session pass the `sessionId` from stderr. The CLI form is `qz script - --session <id> <<'JS'`. The script is raw JavaScript on stdin, not a JSON wrapper. `qz script file.js` reads a file. stdout is only the returned value. Use `qz exec` for one or two debug steps, with JSON `{"name":"wait_for_element","args":{"tabRef":"form","selector":"#done"}}`. `calls` is the same kind of short batch: each item is `{id, name, args}`, at most 10, and an `open_tab` comes before the calls that use its alias.

Action results say whether the action happened. They do not include coordinates. `click` reports `inputDelivered`. `fill` reports the value that was written. `press` reports `pressed` and `key`. `select` reports the chosen value. `check` reports the checked state. If those objects still contain `rect`, `clickablePoint`, `parent`, `lineRange`, or `actionable`, direct drive removes them unless this call passes `verbose:true`. Navigation is a `navigated` field or a changed URL. If neither is present, read the one node you care about. Do not fetch the page again.

Element targets have two forms. `css:` is a CSS selector, for example `css:#dateOfBirthInput` or `css:.react-datepicker__day--015:not(.react-datepicker__day--outside-month)`. `uid:` is a reference returned by `get_ax_tree` or `find_elements`. Waits use `selector` only. Do not pass `uid:` to `wait_for_element`. If a selector misses, change the selector or call `find_elements({pattern, limit:5})`. Do not switch to screenshot coordinates.

Fetch less, in this order. A known selector does not need a tree. If you do need a tree, set `get_ax_tree` `limit` to 40 and pass `root`. Filter table rows inside the page script. A list page returns `{count, sample}`. For files, load the document Skill and read one piece with `document_read_chunk` `offset` and `limit`. Do not parse the whole file into the return value. `list_tabs` is already the short list for this session. Pass `scope:"all"` only when you must see a tab the user opened.

After about 30 minutes without a call, the drive session ends and closes the tabs it opened. If you still need those tabs, read the result first. `qingzhou_stop_session` is not in the default tool list. Start a new sessionId when you want a fresh page. The side panel shows one flat row per tool call. A drive session cannot send a message from that panel.

How to read a result. A successful `open_tab` has `id`, the numeric tab id, which is also a valid later `tabRef`. Keep the `tabAlias` you passed. A successful `get_ax_tree` is the `snapshot` text. Do not ask for a second copy of the nodes. `find_elements` returns `target` values. Pass one of them as `act_on_element` `target`. A page `run_script` puts the useful value on `result`. The outer script returns that value. Direct drive wraps success as `{ok:true, result}`. `qz script` unwraps it, so stdout is the inner `result`. Failure stdout is JSON: `{"code":"…","error":"…","trace":[…]}`, with at most five trace rows. stderr always has one line, `sessionId`, a space, and the id. Exit 0 is success, 1 is a tool failure, and 2 is invalid arguments.

On the first failure, change one thing. A selector timeout: set `wait_for_element` `timeout` to 20 and use a selector that exists on the page. A `select` that did not stick: change `value` to the option value or the visible label. Do not rename the action. A subject that did not appear: `fill`, wait for `.subjects-auto-complete__option`, then `press` `Enter`. Do not press the key before the option exists. `SESSION_TAB_UNOWNED`: do not reuse a numeric id from another session or from a tab the user opened, unless this session already called `open_tab` or took that tab. A thrown script: read the message on the last `trace` row and change that line. Do not start a new sessionId just to retry, unless the code is `DRIVE_SESSION_OCCUPIED`.

Argument notes. `timeout` on scripts and on `wait_for_element` is seconds, not milliseconds. `limits.timeoutSeconds` bounds one `calls` batch. It does not replace the script `timeout`. `tabRef` is either an alias or a numeric id. Do not pass both. `open_tab` does not take `tabRef`. `act_on_element` requires `target` and `action`. `fill` and `select` need `value`. `press` needs `key`. Set `mutatesPage` only when a page script changes the DOM. An inner orchestration script does not set it. Add `verbose` only when you actually need coordinates. Add `scope:"all"` only on `list_tabs`. Document tool names use the prefix `qingzhou_documents__`. Do not call `document_fetch` without it. The Skill name is `qingzhou-documents`, with a hyphen.

How this differs from a built-in task. Direct drive has no model loop and no planning step inside qz. The script you write is the whole turn. A built-in task uses the same inner `run_script` description: fold several tool calls into one script and return a summary. Direct drive also drops blacklisted tools, shortens lists, and reduces a successful script to `{ok, result}`. Tool names and parameters match on both sides, so the same `code` moves unchanged between `qz script` and `qingzhou_execute_tool`. Do not invent a second set of function names for direct drive.

Stop at the layer that answers the question. A date task returns the date string and the subject labels. A version task returns the few matching rows from each of the three sources, not the whole table and not the decorative text around the title. A field you can read from the DOM does not need a screenshot. A control you can address with a selector does not need an accessibility tree first.

Do not rewrite this text into a second procedure. Use the tool names, parameters, and error codes written here. Page scripts and the orchestration script both call `tools.name(arguments)`. Do not wrap those calls in another helper. Use the same code unchanged for qz script and qingzhou_execute_tool. Do not rename parameters. The fields you need are the date, the subjects, or the version rows the question asked for. Put them in the return and do not drop them.

“Read the guide first” in a tool description means this text. Read it once per new connection. Do not call `qingzhou_guide` again on that connection unless you change language or the text you have is incomplete. `qz skill` does not connect to the browser. It only prints the guide. `qz --help` appends the same text after the command list.

Connect with `qz connect`. An external client uses the URL from `qz mcp`. That default is this drive catalog.
<!-- qz-drive-guide:end -->
