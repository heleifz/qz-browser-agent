# 直驱文案对照（等用户确认）

这是拟定稿，等用户确认。对照基线是 `55a2fe74`。每一处都写了旧文和新文。仓库这份与商店 `docs/drive-copy-draft.md` 正文一致。

`不要配置轻舟模型` 仍在说明书里。侧栏只读句没有改。中文：「这个会话由外部客户端直接操作，这里只能查看。」英文：「An external client is driving this session. This view is read-only.」

口径 23156/5700。中文切片 12251 字符，3015.66 token。英文切片 19791 字符，4871.68 token。新说明书全文与 `skills/qz-drive/SKILL.md` 字节相同，也与 `services/mcp-bridge/src/qz-drive-SKILL.md` 相同。

说明书里给模型看的侧栏句是：「侧栏对直驱会话只查看。不要通过脚本绕过黑名单。」英文是：「The side panel for a drive session is view-only. Do not route around the blacklist from a script.」开发者向的改拒绝文案提醒已经从说明书删除。

## 旧说明书全文

基线 `skills/qz-drive/SKILL.md`。

~~~~markdown
---
name: qz-drive
description: Operate the already connected browser with qingzhou_execute_tool or qz exec. Use when the current browser should be driven directly and qz should not plan the task or configure a model.
---

用 qingzhou_execute_tool 操作已经连接的浏览器。不要配置轻舟模型，不要调用 qz create。独立的打开和阅读放进同一次 calls。元素用 uid: 或 css:。同一站点已有 Skill 时先 load_skill。文档用 qingzhou-documents。报错时把工具返回的那一句原样告诉用户。

并行时每路用自己的 sessionId。不传 sessionId 时，这一条 MCP 连接共用一个新的 id。`qz exec` 不传则会新建会话，结果里带 sessionId，之后的调用带上它。

如果没有 qingzhou_execute_tool，用 `qz exec` 传同一份 JSON。stdin 写法是 `qz exec <<'JSON'`。stdout 是 JSON。

Use the browser to open and read every page. Do not use curl or wget to fetch page content. bash remains available only for local files.
~~~~

## 新说明书全文

~~~~markdown
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

主范例：在一个公开表单页写入姓名和尺寸，只返回这两个字段。CLI 把下面的函数存成文件后执行 `qz script page.js`。MCP 用同一次 `qingzhou_execute_tool`，`name` 为 `run_script`，`args` 为 `{target:"inner", timeout:120, code}`，`code` 就是这个函数。两条路径是同一件事。

```js
async () => {
  const tab = "page";
  await tools.open_tab({ tabAlias: tab, url: "https://httpbin.org/forms/post" });
  await tools.wait_for_element({ tabRef: tab, selector: "form" });
  await tools.act_on_element({ tabRef: tab, target: "css:input[name=custname]", action: "fill", value: "Ada" });
  await tools.act_on_element({ tabRef: tab, target: "css:select[name=size]", action: "select", value: "medium" });
  await tools.act_on_element({ tabRef: tab, target: "css:textarea[name=comments]", action: "fill", value: "Packed in one script." });
  const read = await tools.run_script({
    tabRef: tab,
    timeout: 10,
    code: "async () => ({ name: document.querySelector('input[name=custname]')?.value || '', size: document.querySelector('select[name=size]')?.value || '' })",
  });
  return { name: read.result.name, size: read.result.size };
}
```

`select` 的 `value` 先匹配 `option.value`，再匹配去掉首尾空白的可见文字，所以 `"medium"` 可以用。`wait_for_element` 的 `selector` 是原始 CSS，或带 `css:` 前缀。`uid:` 不能用于等待。成功时上面的脚本只留下姓名和尺寸，不要把整页 HTML 放进 return。

多页也放进同一个脚本。打开第一页，其余页用 `navigate`。下面只返回标题和正文第一行非空文本。页面没有目标节点时返回标题和地址，不要返回空数组。

```js
async () => {
  const tab = "page";
  await tools.open_tab({ tabAlias: tab, url: "https://httpbin.org/html" });
  await tools.wait_for_element({ tabRef: tab, selector: "h1" });
  const heading = await tools.run_script({ tabRef: tab, timeout: 10, code: "async () => ({ heading: (document.querySelector('h1')?.textContent || '').trim() })" });
  await tools.navigate({ tabRef: tab, url: "https://httpbin.org/robots.txt" });
  await tools.wait_for_element({ tabRef: tab, selector: "body" });
  const line = await tools.run_script({ tabRef: tab, timeout: 10, code: "async () => { const text = document.body?.innerText || ''; const row = text.split(/\\n/).map(item => item.trim()).find(Boolean) || ''; if (!row) return { title: document.title, href: location.href }; return { line: row }; }" });
  return { heading: heading.result.heading, line: line.result.line || "", title: line.result.title || "", href: line.result.href || "" };
}
```

这一次 return 里只有标题和第一行。正文为空时才带上页面标题和地址。不要把整段正文规则带回。

再看一次往返。表单脚本的 stdout 只有 `{"name":"Ada","size":"medium"}`。标题脚本的 stdout 只有 `heading` 和 `line`。不要把 `trace` 留在成功的 return 里。失败才把 `code`、`error` 和最后 5 条 trace 打到 stdout，退出码 1。没有 trace 时失败对象只有 `code` 和 `error`。

`wait_for_element` 超时不抛错。先看 `found`。`found` 为 false 时不要读页面，把 `timeout` 调到 20 或改选择器后再跑同一段脚本。`select` 没写上时，把 `value` 改成 `medium` 这种 option value，不要改 action 的名字。

`tools.list_tabs({})` 在脚本里也是本会话的短列表：`tabs` 里每项只有 `id`、`alias`、`title`、`url`，另有 `count` 和 `foreign`。别的会话的标签页只计入 `foreign`。要看用户自己打开的标签时才传 `scope:"all"`。`verbose:true` 才留下几何字段。

`qz exec {"name":"get_tool","args":{"name":"open_tab"}}` 与 `qz tools open_tab` 相同。`{"name":"capabilities"}` 列出能力，不会进浏览器工具执行。单次 `open_tab` 或 `wait_for_element` 仍然走 `qingzhou_execute_tool`。

超长字符串也一样。脚本 `return` 的文本超过大约 48000 个字符时，stdout 是 `{truncated:true,totalChars,limitChars,preview}`，退出码仍是 0。预览留在 `preview`。不要因为对象里没有 `ok` 就再跑一遍。

同一会话的下一步用 stderr 里的 sessionId。`qz script page.js --session <id>` 接着写，不要新开一个 id，除非错误码是 `DRIVE_SESSION_OCCUPIED`。`DRIVE_SESSION_BUSY` 表示上一次调用还没结束，等它返回再发。脚本超时后请求仍会把 `code` 和 trace 送回来，因为请求比脚本多等 60 秒。

脚本里的 `tools.list_tabs` 和顶层 `qz exec` 使用同一套精简，默认结果没有 `width` 或 `rect`。别名 `page` 只在本会话有效，下一轮继续用这个 `tabRef`，不要改用别的会话留下的数字 id。后补的 `open_tab` 不会追溯到前面已经写过的引用。

先读这份说明书。CLI：`qz skill` 或 `qz --help` 直接打印。语言用 `--lang zh-CN` 或 `en`，否则看 `QZ_GUIDE_LANG` 和 `LANG`。MCP：先调用一次 `qingzhou_guide`，它返回全文。不要每轮重读。默认 MCP 工具只有 `qingzhou_guide`、`qingzhou_execute_tool`、`qingzhou_list_tools`、`qingzhou_get_tool`、`qingzhou_bridge_status`。调试用 `qz mcp --profile full`，那是任务和诊断目录，不是默认。

会话。直驱会话的 source 是 `external-drive`。不传 `sessionId` 时，这一条 MCP 连接共用一个新 id。`qz script` 和 `qz exec` 每个进程都是新连接；省略 `--session` 会新建会话。成功或失败都把 `sessionId <id>` 写到 stderr。下一进程用 `qz script --session <id> file.js`。并行的几路各用自己的 sessionId。已有普通任务占用的 id 返回 `DRIVE_SESSION_OCCUPIED`，换一个新 id。同一会话已有调用在飞时返回 `DRIVE_SESSION_BUSY`，等它结束，不要再发一轮。`tabAlias` 只在本会话内有效，1–64 个字母、数字、下划线或连字符，不能全是数字。引用别名前，`open_tab` 必须已经出现。页面参数用 `tabRef`（别名或正整数标签页 id）。执行时它会变成 `tabId`。不要自己造 `page(...)` 或别的简写。

脚本怎么写。`code` 是单个 `async () => { ... }` 函数表达式。不要写 IIFE、`main()`，也不要在函数外 `return`。开头用一行注释说明页面、动作和目的。只通过 `tools.名字(参数)` 调用工具。名字、参数和错误码与 `qz exec`、`qingzhou_execute_tool` 相同。`tools.$list()` 查看当前可用工具，不要用 `Object.keys(tools)`。嵌套调用和 `$list` 使用同一份黑名单。`target:"inner"` 没有 `document`、`window`、DOM、`tabId`。要读页面字段，再调用 `tools.run_script({tabRef, timeout, code})`，那个内层脚本才有 `document`。`timeout` 单位是秒，脚本必填；`<= 0` 表示不限时，`> 0` 表示最多等待这么多秒。`qz script` 默认传 120，可用 `--timeout` 覆盖。请求再多等 60 秒。嵌套深度最多 3。复杂步骤用 `trace(...)`。失败时看返回的 `code` 和最多 5 条 trace，改脚本再跑，不要把失败结果原样再塞进下一轮上下文。

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

少取数据。不要为了找一个按钮去 `list_tabs` 再 `get_ax_tree` 再截图。脚本里等待具体选择器，然后只 return 字段。不要调用 `get_trace`。单次结果大约超过 48000 个字符时变成 `{truncated:true, totalChars, limitChars, preview}`。`qz script` 仍以退出码 0 打印这个对象。JSON 不缩进。除非 `verbose:true`，结果里去掉 `_tabId`、`_pageTitle`、`_pageUrl`、`_pageContext`、`sessionId`、`runId`，以及 `rect`、`clickablePoint`、`parent`、`lineRange`、`actionable`。`list_tools` 不列出黑名单工具，返回 `name`、一行 `signature` 和短描述，不返回完整 JSON Schema。`qz tools` 打印这些签名；`qz tools 名字` 看一个工具。`qz exec` 的 `{"name":"list_tools"}` 与 `qz tools` 相同。

文档。先 `tools.load_skill({name:"qingzhou-documents"})`。然后用 `qingzhou_documents__document_fetch`、`document_parse`、`document_read_chunk`、`document_create`、`document_download`、`document_list_artifacts`。这些文档工具的 `timeout` 可省略，默认 120 秒。其他脚本工具的 `timeout` 仍然必填。

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
- `SESSION_TAB_NOT_WEB`：目标不是网页。换成本会话打开的网页标签。
- `RUN_SCRIPT_TOOL_DEPTH_EXCEEDED`：嵌套超过 3 层。把调用展平到这个脚本里。
- `OPERATION_ABORTED`：调用被取消或超时。先看页面是否已经变化，再决定要不要重试。
- `BRIDGE_REQUEST_TIMEOUT`：桥接超时。浏览器里的操作可能还在跑。先看会话，不要立刻重发。

不能直驱的名字：`ask_llm`、`manage_sessions`、`manage_settings`、`manage_guardrails`、`manage_skill_settings`、`qingzhou_call`、`create_skill`、`update_skill`、`delete_skill`、`manage_skill`、`edit_skill_resource`、`import_skill_from_page_zip`、`import_git_skill_repository`、`install_skill_to_git`、`import_page_zip`、`import_git_repository`、`manage_bookmarks`、`wait_for_user`、`ask_user`、`send_message`，以及任何 `mcp_` 开头的名字。侧栏对直驱会话只查看。不要通过脚本绕过黑名单。

一轮请求长什么样。MCP 默认先 `qingzhou_guide`，之后每一轮尽量只有一次 `qingzhou_execute_tool`：

```json
{"name":"run_script","args":{"target":"inner","timeout":120,"code":"async () => { /* 页面、动作、目的 */ return { ok: true }; }"}}
```

同一会话的后续调用带上 stderr 里的 `sessionId`。CLI 等价写法是 `qz script - --session <id> <<'JS'`，脚本从 stdin 读入，不要包一层 JSON。`qz script file.js` 读文件。stdout 只有 `return` 的值。调试一两步时才用 `qz exec`，JSON 为 `{"name":"wait_for_element","args":{"tabRef":"page","selector":"#done"}}`。`calls` 同样只用于这种短批次：每项 `{id, name, args}`，一批最多 10 个，需要别名时把 `open_tab` 放在前面。

操作结果留下动作是否发生，不留下坐标。`click` 看 `inputDelivered`。`fill` 看写入后的值。`press` 看 `pressed` 和 `key`。`select` 看选中的值。`check` 看选中状态。这些字段里如果还有 `rect`、`clickablePoint`、`parent`、`lineRange`、`actionable`，直驱会去掉，除非这次参数带 `verbose:true`。页面跳转看 `navigated` 或返回里的 URL 变化；没有这些字段就再读你关心的那一个节点，不要整页重抓。

元素目标只有两种。`css:` 后面是 CSS 选择器，例如 `css:input[name=custname]` 或 `css:select[name=size]`。`uid:` 后面是 `get_ax_tree` 或 `find_elements` 返回的引用。等待只用 `selector`，不要把 `uid:` 传给 `wait_for_element`。选择器对不上时，改选择器或先 `find_elements({pattern, limit:5})`，不要改用截图坐标。

少取数据时按这个顺序。能写死选择器就不要读树。必须读树时把 `get_ax_tree` 的 `limit` 降到 40，并传 `root`。表格只在页面脚本里 `filter` 出需要的行。列表页只 return `{count, sample}`。文件先 `load_skill` 文档工具，用 `document_read_chunk` 的 `offset` 和 `limit` 读一块，不要一次 parse 完全文再塞进 return。`list_tabs` 默认已经是本会话的短列表；只有要找用户自己打开的标签时才传 `scope:"all"`。

空闲大约 30 分钟没有新调用时，直驱会话会结束并关闭它打开的标签。需要留下标签时不要依赖空闲，先把结果取回。`qingzhou_stop_session` 不在默认工具列表里；结束观察用新的 sessionId 即可。侧栏能看到每次工具调用的平铺记录，直驱会话不能在侧栏发消息。

返回值怎么读。`open_tab` 成功时看 `id`，这是标签页数字 id，也可以当作下一次的 `tabRef`。同时记下你传的 `tabAlias`。`get_ax_tree` 成功时读 `snapshot` 文本，不要再要一份节点数组。`find_elements` 用返回的 `target` 作为下一次 `act_on_element` 的 `target`。页面 `run_script` 的有用值在 `result` 里，外层脚本把它放进自己的 `return`。直驱成功包一层 `{ok:true, result}`；`qz script` 去掉这层，stdout 就是内层 `result`。失败 stdout 是 JSON：`{"code":"……","error":"……","trace":[……]}`，`trace` 最多 5 条。stderr 始终有一行 `sessionId` 加空格加 id。退出码 0 是成功，1 是工具失败，2 是参数不合法。

第一次失败时只改一处。选择器超时：把 `wait_for_element` 的 `timeout` 调到 20，选择器改成页面上确实存在的那个。`select` 没选中：`value` 改成 option 的 value 或可见文字，不要改 action 的名字。填完没有出现预期文字：先 `fill`，再 `wait_for_element`，确认 `found` 后再按键。`SESSION_TAB_UNOWNED`：不要复用别的会话或用户标签的数字 id，除非本会话已经 `open_tab` 或明确接管。脚本抛错：看 `trace` 最后一条的 message，改那一行。不要为了重试而新开一个 sessionId，除非错误码是 `DRIVE_SESSION_OCCUPIED`。

参数记这几条。`timeout` 在脚本和 `wait_for_element` 上都是秒，不是毫秒。`limits.timeoutSeconds` 只限制一批 `calls` 的总时间，不代替脚本里的 `timeout`。`tabRef` 可以是别名或数字 id，不要两个都传。`open_tab` 不要传 `tabRef`。`act_on_element` 的 `target` 必填，`action` 必填。`fill` 和 `select` 要有 `value`。`press` 要有 `key`。`mutatesPage` 只在页面脚本会改 DOM 时设为 true，编排用的 inner 脚本不用设。`verbose` 只在你确实要坐标时加。`scope:"all"` 只加在 `list_tabs` 上。文档工具名字带前缀 `qingzhou_documents__`，不要写成 `document_fetch`。Skill 名字是 `qingzhou-documents`，中间是连字符。

和内置任务的差别。直驱没有模型循环，也没有轻舟侧的规划。你写的脚本就是整轮操作。直驱会删掉黑名单工具、压短列表，并把成功的脚本结果收成 `{ok, result}`。内置任务继续使用自己的 run_script 说明，不改成这份直驱说明书。两边的工具名和参数一致，所以同一段 `code` 可以在 `qz script` 和 `qingzhou_execute_tool` 之间原样搬。不要为直驱另写一套函数名。

取数停在能回答问题的那一层。只要姓名、尺寸、标题或正文第一行这类字段，不要返回整张表，也不要返回标题以外的装饰文字。能从 DOM 读到的字段就不要截图。能从选择器点到的控件就不要先取无障碍树。

不要把这份全文改写成另一套步骤。以这里的工具名、参数和错误码为准。页面脚本和编排脚本都写 `tools.名字(参数)`，不要再包一层助手函数。同一段 code 在 qz script 和 qingzhou_execute_tool 之间原样使用，不要改参数名。需要的字段写进 return。姓名和尺寸、标题和第一行就够了，不要把整页再带回去。

`qingzhou_guide` 写着先读说明书，返回的就是这份全文。一条新连接读一次。同一连接的后续轮次不要再调用 `qingzhou_guide`，除非换了语言，或手头的文本不完整。`qz skill` 不连接浏览器，只打印说明书。`qz --help` 在命令列表后面附上同一份文本。

连接。先 `qz connect`。外部客户端使用 `qz mcp` 打印的地址。默认就是这份直驱目录。打印出来的文本和 Skill 文件是同一份。
<!-- qz-drive-guide:end -->

<!-- qz-drive-guide:en -->
Put the actions, the waits, and the reads in one script. Return only the fields you need.

That is the default way to drive the connected browser. One `run_script` with `target` `"inner"`. Inside it, call existing browser tools with `await tools.tool_name(arguments)`. On success, return the value and nothing else. Do not return a full-page snapshot, coordinates, or the trace.

`qz exec` and a single `qingzhou_execute_tool` call are auxiliary. Use them for one or two simple steps, or while debugging. Do not split one task into a round of single calls.

不要配置轻舟模型. Do not call `qz create`. Do not use curl or wget to fetch page content. bash stays available for local files only.

Main example: write a name and a size on a public form, and return only those two fields. From the CLI, save the function and run `qz script page.js`. From MCP, one `qingzhou_execute_tool` with `name` `run_script` and `args` `{target:"inner", timeout:120, code}` where `code` is this function. Both paths are the same call.

```js
async () => {
  const tab = "page";
  await tools.open_tab({ tabAlias: tab, url: "https://httpbin.org/forms/post" });
  await tools.wait_for_element({ tabRef: tab, selector: "form" });
  await tools.act_on_element({ tabRef: tab, target: "css:input[name=custname]", action: "fill", value: "Ada" });
  await tools.act_on_element({ tabRef: tab, target: "css:select[name=size]", action: "select", value: "medium" });
  await tools.act_on_element({ tabRef: tab, target: "css:textarea[name=comments]", action: "fill", value: "Packed in one script." });
  const read = await tools.run_script({
    tabRef: tab,
    timeout: 10,
    code: "async () => ({ name: document.querySelector('input[name=custname]')?.value || '', size: document.querySelector('select[name=size]')?.value || '' })",
  });
  return { name: read.result.name, size: read.result.size };
}
```

`select` matches `option.value` first, then the visible label with surrounding whitespace removed, so `"medium"` works. `wait_for_element` `selector` is raw CSS or a `css:` prefix. `uid:` is not a wait selector. On success the script above keeps the name and the size. Do not return the page HTML.

Several pages belong in the same script. Open the first URL and `navigate` the rest. Return only the heading and the first non-empty line. If the node is missing, return the title and the URL. Do not return an empty array.

```js
async () => {
  const tab = "page";
  await tools.open_tab({ tabAlias: tab, url: "https://httpbin.org/html" });
  await tools.wait_for_element({ tabRef: tab, selector: "h1" });
  const heading = await tools.run_script({ tabRef: tab, timeout: 10, code: "async () => ({ heading: (document.querySelector('h1')?.textContent || '').trim() })" });
  await tools.navigate({ tabRef: tab, url: "https://httpbin.org/robots.txt" });
  await tools.wait_for_element({ tabRef: tab, selector: "body" });
  const line = await tools.run_script({ tabRef: tab, timeout: 10, code: "async () => { const text = document.body?.innerText || ''; const row = text.split(/\\n/).map(item => item.trim()).find(Boolean) || ''; if (!row) return { title: document.title, href: location.href }; return { line: row }; }" });
  return { heading: heading.result.heading, line: line.result.line || "", title: line.result.title || "", href: line.result.href || "" };
}
```

That return holds the heading and the first line. The page title and URL appear only when the body line is empty. Do not return the whole text.

Read the round trip once. The form script's stdout is only `{"name":"Ada","size":"medium"}`. The heading script's stdout has `heading` and `line`. Do not leave `trace` in a successful return. A failure prints `code`, `error`, and at most five trace rows on stdout and exits 1. A failure without a trace has `code` and `error` only.

`wait_for_element` does not throw on timeout. Check `found`. When `found` is false, do not read the page; set `timeout` to 20 or change the selector and run the same script. When `select` does not stick, change `value` to an option value such as `medium`. Do not rename the action.

`tools.list_tabs({})` inside the script is the short list for this session. Each item has `id`, `alias`, `title`, and `url`, plus `count` and `foreign`. A different session only increases `foreign`. Pass `scope:"all"` to see a tab the user opened. `verbose:true` keeps geometry.

`qz exec {"name":"get_tool","args":{"name":"open_tab"}}` matches `qz tools open_tab`. `{"name":"capabilities"}` lists capabilities and does not execute a browser tool. One `open_tab` or `wait_for_element` still uses `qingzhou_execute_tool`.

A long string follows the same rule. When returned text passes about 48000 characters, stdout is `{truncated:true,totalChars,limitChars,preview}` and the exit code stays 0. The preview stays in `preview`. Do not run it again only because `ok` is absent.

The next step on this session uses the sessionId from stderr. Continue with `qz script page.js --session <id>`. Start a new id only for `DRIVE_SESSION_OCCUPIED`. `DRIVE_SESSION_BUSY` means the previous call is still running. A script timeout still returns `code` and trace, because the request waits 60 seconds longer.

Read this guide first. CLI: `qz skill` or `qz --help` prints it. `--lang zh-CN` or `en` selects the language; otherwise `QZ_GUIDE_LANG` and `LANG` do. MCP: call `qingzhou_guide` once. It returns the full text. Do not read it again every turn. The default MCP tools are `qingzhou_guide`, `qingzhou_execute_tool`, `qingzhou_list_tools`, `qingzhou_get_tool`, and `qingzhou_bridge_status`. `qz mcp --profile full` is the task and diagnostic catalog, not the default.

Sessions. A drive session has source `external-drive`. Omit `sessionId` and this MCP connection keeps one new id. Each `qz script` or `qz exec` process is a new connection; omitting `--session` starts a session. Success and failure write `sessionId <id>` to stderr. The next process passes `qz script --session <id> file.js`. Parallel paths each use their own sessionId. An id that already belongs to a normal task returns `DRIVE_SESSION_OCCUPIED`; use a new id. A session that already has a call in flight returns `DRIVE_SESSION_BUSY`; wait for that call. `tabAlias` belongs to this session: 1–64 letters, digits, underscores, or hyphens, and not all digits. The `open_tab` that creates an alias comes before any call that uses it. Page arguments use `tabRef` (an alias or a positive integer tab id). Execution renames it to `tabId`. Do not invent `page(...)` or another shorthand.

How to write a script. `code` is one `async () => { ... }` function expression. No IIFE, no `main()`, no `return` outside the function. Start with a one-line comment naming the page, the action, and the purpose. Call tools only as `tools.name(arguments)`. Names, parameters, and error codes are the same ones `qz exec` and `qingzhou_execute_tool` use. `tools.$list()` lists the tools available now. Do not use `Object.keys(tools)`. Nested calls and `$list` use the same blacklist. `target:"inner"` has no `document`, `window`, DOM, or `tabId`. To read page fields, call `tools.run_script({tabRef, timeout, code})`. That inner page script has `document`. `timeout` is seconds and is required on scripts; `<= 0` means no limit, `> 0` is the maximum wait. `qz script` sends 120 unless `--timeout` says otherwise. The request waits 60 seconds longer. Nested depth stops at 3. Use `trace(...)` at important steps. On failure, read `code` and at most five trace rows, change the script, and run it again. Do not paste the failed payload back into the next turn.

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

Fetch less. Do not call `list_tabs`, then `get_ax_tree`, then a screenshot to find one button. Wait for the selector in the script and return the fields. Do not call `get_trace`. A result past about 48000 characters becomes `{truncated:true, totalChars, limitChars, preview}`. `qz script` still exits 0 and prints that object. JSON is compact. Unless `verbose:true`, results omit `_tabId`, `_pageTitle`, `_pageUrl`, `_pageContext`, `sessionId`, `runId`, `rect`, `clickablePoint`, `parent`, `lineRange`, and `actionable`. `list_tools` hides blacklisted tools and returns `name`, a one-line `signature`, and a short description, not a full JSON Schema. `qz tools` prints those signatures. `qz tools NAME` shows one tool. `qz exec` with `{"name":"list_tools"}` returns the same list.

Documents. Call `tools.load_skill({name:"qingzhou-documents"})` first. Then `qingzhou_documents__document_fetch`, `document_parse`, `document_read_chunk`, `document_create`, `document_download`, and `document_list_artifacts`. Timeout on those document tools is optional and defaults to 120 seconds. Script tools besides those document tools still require `timeout`.

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
- `SESSION_TAB_NOT_WEB`: the target is not a web page. Use a web tab this session opened.
- `RUN_SCRIPT_TOOL_DEPTH_EXCEEDED`: nesting passed 3. Flatten the calls into this script.
- `OPERATION_ABORTED`: the call was cancelled or timed out. Look at the page before retrying.
- `BRIDGE_REQUEST_TIMEOUT`: the bridge timed out. The browser operation may still be running. Inspect the session before repeating it.

Names direct drive cannot call: `ask_llm`, `manage_sessions`, `manage_settings`, `manage_guardrails`, `manage_skill_settings`, `qingzhou_call`, `create_skill`, `update_skill`, `delete_skill`, `manage_skill`, `edit_skill_resource`, `import_skill_from_page_zip`, `import_git_skill_repository`, `install_skill_to_git`, `import_page_zip`, `import_git_repository`, `manage_bookmarks`, `wait_for_user`, `ask_user`, `send_message`, and any name that starts with `mcp_`. The side panel for a drive session is view-only. Do not route around the blacklist from a script.

What one turn looks like. On MCP, call `qingzhou_guide` first. After that, a turn should be one `qingzhou_execute_tool`:

```json
{"name":"run_script","args":{"target":"inner","timeout":120,"code":"async () => { /* page, action, purpose */ return { ok: true }; }"}}
```

Later calls on the same session pass the `sessionId` from stderr. The CLI form is `qz script - --session <id> <<'JS'`. The script is raw JavaScript on stdin, not a JSON wrapper. `qz script file.js` reads a file. stdout is only the returned value. Use `qz exec` for one or two debug steps, with JSON `{"name":"wait_for_element","args":{"tabRef":"page","selector":"#done"}}`. `calls` is the same kind of short batch: each item is `{id, name, args}`, at most 10, and an `open_tab` comes before the calls that use its alias.

Action results say whether the action happened. They do not include coordinates. `click` reports `inputDelivered`. `fill` reports the value that was written. `press` reports `pressed` and `key`. `select` reports the chosen value. `check` reports the checked state. If those objects still contain `rect`, `clickablePoint`, `parent`, `lineRange`, or `actionable`, direct drive removes them unless this call passes `verbose:true`. Navigation is a `navigated` field or a changed URL. If neither is present, read the one node you care about. Do not fetch the page again.

Element targets have two forms. `css:` is a CSS selector, for example `css:input[name=custname]` or `css:select[name=size]`. `uid:` is a reference returned by `get_ax_tree` or `find_elements`. Waits use `selector` only. Do not pass `uid:` to `wait_for_element`. If a selector misses, change the selector or call `find_elements({pattern, limit:5})`. Do not switch to screenshot coordinates.

Fetch less, in this order. A known selector does not need a tree. If you do need a tree, set `get_ax_tree` `limit` to 40 and pass `root`. Filter table rows inside the page script. A list page returns `{count, sample}`. For files, load the document Skill and read one piece with `document_read_chunk` `offset` and `limit`. Do not parse the whole file into the return value. `list_tabs` is already the short list for this session. Pass `scope:"all"` only when you must see a tab the user opened.

After about 30 minutes without a call, the drive session ends and closes the tabs it opened. If you still need those tabs, read the result first. `qingzhou_stop_session` is not in the default tool list. Start a new sessionId when you want a fresh page. The side panel shows one flat row per tool call. A drive session cannot send a message from that panel.

How to read a result. A successful `open_tab` has `id`, the numeric tab id, which is also a valid later `tabRef`. Keep the `tabAlias` you passed. A successful `get_ax_tree` is the `snapshot` text. Do not ask for a second copy of the nodes. `find_elements` returns `target` values. Pass one of them as `act_on_element` `target`. A page `run_script` puts the useful value on `result`. The outer script returns that value. Direct drive wraps success as `{ok:true, result}`. `qz script` unwraps it, so stdout is the inner `result`. Failure stdout is JSON: `{"code":"…","error":"…","trace":[…]}`, with at most five trace rows. stderr always has one line, `sessionId`, a space, and the id. Exit 0 is success, 1 is a tool failure, and 2 is invalid arguments.

On the first failure, change one thing. A selector timeout: set `wait_for_element` `timeout` to 20 and use a selector that exists on the page. A `select` that did not stick: change `value` to the option value or the visible label. Do not rename the action. Text missing after a fill: call `wait_for_element` and press a key only after `found` is true. `SESSION_TAB_UNOWNED`: do not reuse a numeric id from another session or from a tab the user opened, unless this session already called `open_tab` or took that tab. A thrown script: read the message on the last `trace` row and change that line. Do not start a new sessionId just to retry, unless the code is `DRIVE_SESSION_OCCUPIED`.

Argument notes. `timeout` on scripts and on `wait_for_element` is seconds, not milliseconds. `limits.timeoutSeconds` bounds one `calls` batch. It does not replace the script `timeout`. `tabRef` is either an alias or a numeric id. Do not pass both. `open_tab` does not take `tabRef`. `act_on_element` requires `target` and `action`. `fill` and `select` need `value`. `press` needs `key`. Set `mutatesPage` only when a page script changes the DOM. An inner orchestration script does not set it. Add `verbose` only when you actually need coordinates. Add `scope:"all"` only on `list_tabs`. Document tool names use the prefix `qingzhou_documents__`. Do not call `document_fetch` without it. The Skill name is `qingzhou-documents`, with a hyphen.

How this differs from a built-in task. Direct drive has no model loop and no planning step inside qz. The script you write is the whole turn. Direct drive drops blacklisted tools, shortens lists, and reduces a successful script to `{ok, result}`. A built-in task keeps its own run_script description. Tool names and parameters match on both sides, so the same `code` moves unchanged between `qz script` and `qingzhou_execute_tool`. Do not invent a second set of function names for direct drive.

Stop at the layer that answers the question. Return the name and the size, or the heading and the first line. Do not return the whole table or the decorative text around the title. A field you can read from the DOM does not need a screenshot. A control you can address with a selector does not need an accessibility tree first.

Do not rewrite this text into a second procedure. Use the tool names, parameters, and error codes written here. Page scripts and the orchestration script both call `tools.name(arguments)`. Do not wrap those calls in another helper. Use the same code unchanged for qz script and qingzhou_execute_tool. Do not rename parameters. Put the name and the size, or the heading and the first line, in the return. Do not bring the whole page back.

`qingzhou_guide` says to read the guide first and returns this text. Read it once per new connection. Do not call `qingzhou_guide` again on that connection unless you change language or the text you have is incomplete. `qz skill` does not connect to the browser. It only prints the guide. `qz --help` appends the same text after the command list.

Connect with `qz connect`. An external client uses the URL from `qz mcp`. That default is this drive catalog.
<!-- qz-drive-guide:end -->
~~~~

## 内置 Agent：run_script

相对 `55a2fe74`，`src/capabilities/script/tool-messages.ts` 和 `src/capabilities/script/messages.ts` 的 `run_script` 文案没有差异。直驱专用措辞留在说明书里。内置 Agent 仍看到基线里的 inner 说明、`runScriptTarget`、`workingTabRecovery`、`useTargetPageWithAWorkingTabForPage` 和 `forDataStoreProcessingFileGenerationOrPureJs`。

## 文档工具 timeout

这一项内置 Agent 能看到。文档宿主工具是名字以 `qingzhou_documents__` 开头、runtime 为 host 的工具。省略 `timeout` 时仍按 120 秒执行。其他脚本工具仍必须传入 `timeout`，描述仍用下面的旧句。

旧文在工具描述里，schema 的 `required` 含 `timeout`。

zh-CN：

> 必须传入 timeout（秒）：<= 0 表示无限等待，> 0 表示最多等待对应秒数。

en：

> Required timeout in seconds: <= 0 means no time limit; > 0 sets the maximum duration.

新文替换文档宿主工具描述里的那一句。schema 的 `required` 不再包含 `timeout`。属性描述换成下面这句。

zh-CN：

> 可选。文档工具超时秒数；省略时默认 120 秒。

en：

> Optional document-tool timeout in seconds. Defaults to 120 seconds.

等用户确认。

## DRIVE_TOOL_FORBIDDEN

旧文：这个错误码不存在，没有标题，也没有正文。

新文 zh-CN：

> 标题：直驱不能调用此工具
>
> 正文：这个工具不能在直驱会话里调用。

新文 en：

> Label: Direct drive cannot call this tool
>
> Message: This tool cannot be called in a direct-drive session.

另外 10 种语言有译文，这里只列语言名：阿拉伯语、德语、西班牙语、法语、印地语、日语、韩语、葡萄牙语（巴西）、俄语、繁体中文。

等用户确认。

## list_sessions 参数

工具描述「列出轻舟会话及运行态。」相对基线没有改。新增的两个参数以前不存在，描述只有英文。

`scope` 旧文：无此参数。

`scope` 新文：

> session returns one session. Omit it to list tasks.

`sessionId` 旧文：无此参数。

`sessionId` 新文：

> Session to return when scope is session.

等用户确认。

## qingzhou_guide

旧文：没有这个工具。

新文（描述同时含中文和英文）：

> 先读说明书。返回直驱说明书全文。一条新连接调用一次。Read the guide first. Call this once on a new connection before other tools.

`lang` 参数旧文：无此参数。

`lang` 新文：

> zh-CN or en. Omit to follow QZ_GUIDE_LANG or LANG.

`qingzhou_execute_tool` 的目录描述相对基线没有改：「在已连接的浏览器里执行现有工具。单次传 name 和 args。同一轮并行或带 tabAlias、tabRef 时改传 calls（每项含 id、name、args），不要拆成多次请求。」

等用户确认。

## MCP instructions

旧文，完整目录和直驱目录都是这句英文：

> Control qz tasks and browser tools through the local bridge.

新文，完整目录仍是上面那句。直驱目录换成下面这句，中文和英文在同一段里：

> 先调用 qingzhou_guide 读取直驱说明书，再操作浏览器。默认把操作、等待和取数写进一次 run_script（target 为 inner），只 return 需要的字段。单次调用只用于一两步或调试。Call qingzhou_guide once, then prefer one inner run_script.

等用户确认。

## 侧栏直驱欢迎页

这 5 行是新的。旧文：页面上没有这 5 行。区域标签仍用原来的 `sessions.externalDrive`：中文「外部直驱」，英文「External」。只读句见文首，没有改。

另外 10 种语言有这 5 行的译文，这里只列语言名：阿拉伯语、德语、西班牙语、法语、印地语、日语、韩语、葡萄牙语（巴西）、俄语、繁体中文。

### 标题 externalDriveWelcomeTitle

zh-CN 新文：

> 由外部 agent 直接操作

en 新文：

> Driven by an external agent

### 正文 externalDriveWelcomeBody

zh-CN 新文：

> 这个会话由外部 agent 通过 MCP 或 qz CLI 直接操作。在终端运行下面的命令完成绑定。

en 新文：

> An external agent drives this session through MCP or the qz CLI. Run this command in a terminal to connect it.

### 命令说明 externalDriveWelcomeCommandHint

zh-CN 新文：

> 绑定当前浏览器

en 新文：

> Pair this browser

### 复制 externalDriveWelcomeCopy

zh-CN 新文：

> 复制

en 新文：

> Copy

### 已复制 externalDriveWelcomeCopied

zh-CN 新文：

> 已复制

en 新文：

> Copied

命令本身不随语言变化。旧文：没有这条命令。新文：`npx qz-browser-agent@latest connect`。

等用户确认。

## CLI 帮助

这些句子只有英文。

### qz script

旧文：没有这条命令。

新文：

> qz script [FILE|-]
>
> Run an async JavaScript function as run_script target inner. stdout is only the returned value.
>
> qz script - reads the script from stdin. --timeout sets the script timeout in seconds and defaults to 120. The request waits 60 seconds longer.
>
> --session ID reuses a drive session. A new session prints sessionId on stderr.

摘要：Run one browser script

### qz tools

旧文：没有这条命令。

新文：

> qz tools [NAME]
>
> List compact tool signatures, or show one tool.
>
> Blacklisted direct-drive tools are omitted for a drive session.

摘要：List browser tool signatures

### qz skill

旧文：没有这条命令。

新文：

> qz skill [--lang zh-CN|en]
>
> Print the direct-drive guide. This does not connect to the browser.
>
> qz --help prints the same guide after the command list.

摘要：Print the direct-drive guide

`qz --help` 旧文：命令列表结束。新文：命令列表后面接上同一份说明书。

### qz mcp

旧文：

> qz mcp [--json]
>
> Print the running service's MCP URL for an external agent.
>
> Run qz connect first.

新文：

> qz mcp [--profile full|drive] [--json]
>
> Print the MCP URL. The default catalog is the direct-drive set.
>
> --profile full prints the task and diagnostic catalog.
>
> Run qz connect first.

摘要仍是：Print the MCP URL

### qz exec

帮助正文相对基线没有改。选项列表新增 `--session`（短选项 `-s`）。`qz script` 和 `qz tools` 也有这个选项。

## docs/cli.md

这份文档只有英文。「Use `-t` for `--title`.」那句没有改。下面是改过的段落，到「If a request times out」之前。

旧文：

~~~~markdown
MCP clients can inspect browser tool schemas with `qingzhou_list_tools` and `qingzhou_get_tool`,
then call `qingzhou_execute_tool` in a task. Set `wait: false` to receive a job ID and read the result
with `qingzhou_get_tool_job`. MCP also
provides `qingzhou_get_trace` and `qingzhou_clear_trace` for diagnostics. An MCP connection that
omits `sessionId` keeps one generated id for that connection.

`qz exec` is transport for that same tool. It does not add tools or start a model. Pass one JSON
object with `name` and `args`, or with `calls`. Quote it safely by piping stdin:
`qz exec <<'JSON'`. stdout is JSON. Exit 0 when the tool succeeds, 2 when the JSON is invalid, and
1 when the tool fails. Screenshot bytes are written to temporary files and the JSON lists those paths.
Omit `sessionId` to start a new drive session; the result includes that `sessionId` for later calls.
Each parallel path uses its own `sessionId`. Run `qz connect` first. `qz exec --help` prints the same usage.
~~~~

新文：

~~~~markdown
The default MCP catalog is the direct-drive set: `qingzhou_guide`, `qingzhou_execute_tool`,
`qingzhou_list_tools`, `qingzhou_get_tool`, and `qingzhou_bridge_status`. Call `qingzhou_guide`
once on a new connection. It returns the same text as `skills/qz-drive/SKILL.md`. `qz mcp` prints
that URL. `qz mcp --profile full` prints the task and diagnostic catalog. A direct-drive session
omits blocked tools from `qingzhou_list_tools`. `qingzhou_get_tool` returns `DRIVE_TOOL_FORBIDDEN`
for a blocked name. Set `wait: false` to receive a job ID and read the result with
`qingzhou_get_tool_job`. The full catalog also provides `qingzhou_get_trace` and
`qingzhou_clear_trace` for diagnostics. An MCP connection that omits `sessionId` keeps one
generated id for that connection.

`qz script [FILE|-]` runs an async function as `run_script` with `target` `inner`. stdout is only
the returned value. A failure prints the error code and the last five trace rows. `--timeout`
defaults to 120 seconds. `qz tools` lists compact signatures. `qz skill` prints the direct-drive
guide without connecting. `qz --help` prints that same guide after the command list.

`qz exec` is transport for one tool call or a short `calls` batch. It does not add tools or start
a model. Pass one JSON object with `name` and `args`, or with `calls`. Quote it safely by piping
stdin: `qz exec <<'JSON'`. stdout is JSON. Exit 0 when the tool succeeds, 2 when the JSON is
invalid, and 1 when the tool fails. Screenshot bytes are written to temporary files and the JSON
lists those paths. Omit `sessionId` to start a new drive session; the result includes that
`sessionId` for later calls. Each parallel path uses its own `sessionId`. Run `qz connect` first.
~~~~

等用户确认。
