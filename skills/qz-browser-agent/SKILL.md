---
name: qz-browser-agent
description: Drive the connected browser directly. Use qz script or qingzhou_execute_tool with tabRef on the page. Do not configure a qz model. Read references/create-task.md only when the built-in agent should plan the task.
---

不要配置轻舟模型

<!-- qz-drive-guide:zh-CN -->
不要配置轻舟模型

这是轻舟的直驱说明书。外部 agent 自己编排，在已经连接的浏览器里开标签、读页面、操作元素。不启动轻舟内置模型，也不要调用 `qz create`。需要轻舟内置 agent 规划执行时，再读 references/create-task.md。

安装或更新这份技能用已经存在的命令，不要另找包名：

```bash
npx skills add alibaba/qz-browser-agent -g
```

CLI 的 `qz skill` 和 MCP 的 `qingzhou_guide` 返回的就是这一份。一条新连接读一次。不要每轮重读。`--lang zh-CN` 或 `en` 选择语言，否则看 `QZ_GUIDE_LANG` 和 `LANG`。

连接。在装有扩展的这台机器上操作。先确认 Node.js 22 或更高，再看浏览器是否在线：

```sh
node --version
npx --yes qz-browser-agent@latest status --json
```

看 `result.connected` 和 `result.browsers`。还没有配对时运行 `qz connect`。它启动本机服务，并在默认浏览器里打开配对页。浏览器里点一次确认。未连接时的下一句就是 `qz connect`，不要改去配模型。

要指定配置文件时，先拿配对地址再自己打开：

```sh
npx --yes qz-browser-agent@latest connect --no-open --json
```

返回里的 `result.url` 就是要打开的地址，`mcpUrl` 是 MCP 地址。把这个 URL 打开在用户选定的、已经装了轻舟的配置文件里。macOS Chrome 可以设 `QZ_PAIRING_URL` 和 `QZ_PROFILE_DIRECTORY`，然后：

```sh
open -na "Google Chrome" --args --profile-directory="$QZ_PROFILE_DIRECTORY" "$QZ_PAIRING_URL"
```

自定义用户数据目录时再加上 `--user-data-dir`。一次只绑定一个配置文件。打开前后各看一次 `browsers --json`，记下新出现的 `clientId`。之后的命令带 `--client` 这个 UUID。`--client` 只选择已经连上的浏览器，不能和 `connect --no-open` 或 `connect --name` 写在一起。

`connect --name work` 给打开该地址的配置文件起名。不写名字时，已有名字保持不变，否则分配 `default`、`browser-2` 这样的名字。普通 `connect` 在需要配对时打开系统默认浏览器；已经只有一个在线浏览器时就复用它。

扩展还没装时，让用户在目标配置文件里打开 Chrome 网上应用店并点添加。`npx --yes qz-browser-agent@latest install` 会打开商店页。手动安装用 GitHub 最新发行版的 ZIP。装好后完成首次数据说明，再打开配对地址。

连不上时先看 `status --json` 里的地址。`connect --port` 只在服务还没起来时指定端口。已经在跑的服务保持原地址。只改地址不会连上，用户仍要点一次连接。升级不兼容时，等当前任务结束，运行 `npx --yes qz-browser-agent@latest stop`，更新并重新加载每个浏览器里的扩展，再 `qz connect`。`stop` 会断开所有浏览器。只断开一个浏览器时用那个浏览器的设置。

配对完成后打印 MCP 地址：`npx --yes qz-browser-agent@latest mcp`。默认目录就是这套直驱工具：`qingzhou_guide`、`qingzhou_execute_tool`、`qingzhou_list_tools`、`qingzhou_get_tool`、`qingzhou_bridge_status`。`qz mcp --profile full` 是任务和诊断目录，不是默认。

黄金路径。连上之后做这两步，侧栏会出现标签组「轻舟 · 客户端名」：

```json
{"calls":[
  {"id":"open","name":"open_tab","args":{"url":"https://example.com","tabAlias":"page"}},
  {"id":"read","name":"get_ax_tree","args":{"tabRef":"page"}}
]}
```

CLI 等价写法是两次 `qz exec`，或一次 `calls`。`open_tab` 的返回字段是 `tabRef`，不是 `id`。你传的 `tabAlias` 同时可用。下一步页面工具用这个别名或这个 `tabRef`。

编排用你自己的批量 `calls` 或一次 `execute_tool`。同一会话里一批 calls 里多个 open 或 act 仍是一轮，不要为此新造工具名。不要把编排塞进 `target` 为 inner 的脚本。直驱不接受 `target:"inner"`。

`qz script` 只在需要页面 JavaScript 时用。它必须带 `--tab`，只在该页执行，能看见登录态，也能 `await tools.名字(参数)`。

```sh
qz script --tab page page.js
```

```js
async () => {
  return { title: document.title, href: location.href };
}
```

MCP 的同一次调用是 `qingzhou_execute_tool`，`name` 为 `run_script`，`args` 为 `{target:"page", tabRef, timeout, code}`。`tabRef` 必填。必须写上，也不要写 inner。不要把另一段 `run_script` 当成字符串嵌进这段脚本里当默认写法。要读页面，就在这一段页面脚本里读 `document`。

`code` 是单个 `async () => { ... }` 函数表达式。不要写 IIFE、`main()`，也不要在函数外 `return`。开头用一行注释说明页面、动作和目的。`timeout` 单位是秒，必填。`<= 0` 表示不限时，`> 0` 表示最多这么多秒。`qz script` 默认 120，可用 `--timeout` 覆盖。桥接请求再多等 60 秒，所以节点不会先于扩展报超时。不要为了等它先 sleep。

`tabRef` 是本会话的页面别名，或正整数标签页 id。别名 1–64 个字母、数字、下划线或连字符，不能全是数字。别名只在本会话有效，关闭该标签后失效。引用别名之前，`open_tab` 必须已经出现。本会话还没有别名时，先 `open_tab`，再用返回的 `tabRef`。不要自己造 `page(...)` 或其他简写。`open_tab` 用 `tabAlias`，不要传 `tabRef`。`list_tabs` 每一项的标签标识也是 `tabRef`。

直驱不使用工作标签页。带 `tabRef` 参数的页面工具如果没写，会被拒绝，错误码是 `DRIVE_TAB_REF_REQUIRED`。`act_on_screen` 没有这个参数。一批里每个页面调用都要写自己的 `tabRef`。同一标签同时只给一个会话。后来者失败，先拿到的会话不中断。

默认工具。`qz tools`、`qingzhou_list_tools` 和脚本里的 `tools.$list()` 默认只给这一档，每项是一行短签名加一句说明：

`open_tab`、`navigate`、`list_tabs`、`close_tab`、`use_tab`、`get_ax_tree`、`find_elements`、`read_article`、`act_on_element`、`scroll_page`、`screenshot`、`wait_for_element`、`wait_for_navigation`、`run_script`、`load_skill`、`list_skills`。

说明书档仍可调用，只是不在默认列表里。需要时用 `qz tools 名字` 或 `qingzhou_get_tool` 看签名。这一档包括 `read_dom`、`inspect_element`、`act_on_screen`、`get_working_tab`、次要等待（`wait`、`wait_for_response`、`wait_for_network_idle`）、钟点等待 `wait_until`、`document_*`、`list_images`、`collect_images`、`read_image`、`data_store`、`download_url`、`save_file`、`network_*`、`browse_history`、`set_page_mode`、`send_alert`，以及 `load_skill_resource`。文档工具名字仍带前缀 `qingzhou_documents__`。不要改这些名字。

常用调用：

- `open_tab({url, tabAlias})`。`url` 必填。
- `navigate({url, tabRef})`。`url` 必填。
- `act_on_element({tabRef, target, action, value, key})`。`target` 用 `uid:` 或 `css:`。`action` 是 `click`、`fill`、`press`、`select`、`check`、`uncheck`、`scroll`。
- `wait_for_element({tabRef, selector, timeout, absent})`。`selector` 必填，是 CSS，不是 `uid:`。超时不抛错，看 `found`。
- `wait_for_navigation({tabRef, timeout})` 等地址变化。
- `get_ax_tree({tabRef, root, scope, depth, limit})`。只在需要 `uid:` 时调用，并缩小 `root` 或 `limit`。
- `find_elements({tabRef, pattern, selector, limit})`。用返回的 `target` 做下一次 `act_on_element`。
- `run_script({target:"page", tabRef, timeout, code})`。`tabRef`、`timeout`、`code` 必填。会改页面时再设 `mutatesPage:true`。
- `load_skill({name})` 之后按需要 `load_skill_resource`。`list_skills` 只有摘要。

少取数据。能写死选择器就不要先读整棵树，也不要为了找一个按钮连续 `list_tabs`、`get_ax_tree`、`screenshot`。`screenshot` 不是默认步骤。单次结果大约超过 48000 个字符时变成 `{truncated:true, totalChars, limitChars, preview}`。除非 `verbose:true`，结果里去掉 `_tabId`、`_pageTitle`、`_pageUrl`、`_pageContext`、`sessionId`、`runId`，以及 `rect`、`clickablePoint`、`parent`、`lineRange`、`actionable`。`list_tabs` 默认是本会话短列表：`{tabs:[{tabRef, alias, title, url}], count, foreign}`。只有要看用户自己打开的标签时才传 `scope:"all"`。

会话。直驱会话的 source 是 `external-drive`。不传 `sessionId` 时，这一条 MCP 连接共用一个新 id。`qz script` 和 `qz exec` 每个进程都是新连接；省略 `--session` 会新建会话。成功或失败都把 `sessionId <id>` 写到 stderr。下一进程用 `--session <id>`。并行的几路各用自己的 sessionId。已有普通任务占用的 id 返回 `DRIVE_SESSION_OCCUPIED`，换一个新 id，不要循环重试。同一会话已有调用在飞时返回 `DRIVE_SESSION_BUSY`。瞬时忙最多自动重试一次。仍忙就等它结束，不要再开一轮，也不要 sleep 糊过去。

标签。本会话 `open_tab` 打开的标签归本会话。客户端离开或空闲结束时清掉这些标签。用户原来就有的标签，以及 `use_tab` 接管的标签，只释放租约，绝不自动关。用户点一下该标签会交还：停自动化，标签留在原地。只有显式 `keep` 才留下标签组。不要跨进程沿用旧的 sessionId。隔天先 `qz connect`，再新开一轮黄金路径。看见昨天的「轻舟 · …」组时，把它当普通标签，不要假装还是昨天那个会话。

出错就停。把返回的 `code` 和那一句原样告诉用户，改一处再试。脚本的语法错误、行列号和堆栈摘要会原样回来，不要盖成一句「脚本执行失败。」

- 未连接或掉线：跑 `qz connect` 后再试。不要循环。
- `DRIVE_SESSION_BUSY`：等这一批结束。瞬时忙只会自动重试一次。
- `DRIVE_SESSION_OCCUPIED`：换一个新的 sessionId。
- `DRIVE_TOOL_FORBIDDEN`：这个名字不能直驱，包括脚本里的 `tools.名字`。
- `DRIVE_ARGUMENTS`：`name` 与 `calls` 只能二选一。`calls` 的每项要有 `id`、`name`，`args` 是对象。
- `DRIVE_TOO_MANY_CALLS`：一批最多 10 个。
- `DRIVE_BATCH_TIMEOUT`：`limits.timeoutSeconds` 到了。加大限制，或把页面读取放进带 `tabRef` 的 `qz script`。
- `UNKNOWN_TOOL`：先 `qz tools` 或 `tools.$list()`。
- `BATCH_TAB_REFERENCE_ERROR`：`tabRef` 或 `tabAlias` 不对，或 `open_tab` 排在引用之后。本会话还没有别名时，先 `open_tab`。
- `DRIVE_TAB_REF_REQUIRED`：页面工具没有 `tabRef`。`open_tab` 用 `tabAlias`。`list_tabs`、`list_skills`、`load_skill`、`wait` 和 `wait_until` 不需要页面目标。
- `SESSION_TAB_UNOWNED`：用本会话的 `tabRef`，或先 `open_tab`。
- 登录墙：在这个浏览器里打开该站并登录，然后重试。
- `BRIDGE_REQUEST_TIMEOUT`：不要先 sleep。脚本请求会比脚本超时多等 60 秒。看会话里这次调用是否还在跑，不要立刻重发。
- `OPERATION_ABORTED`：先看页面是否已经变化，再决定要不要重试。

不能直驱的名字：`ask_llm`、`manage_sessions`、`manage_settings`、`manage_guardrails`、`manage_skill_settings`、`manage_goal`、`example_echo`、`qingzhou_call`、`create_skill`、`update_skill`、`delete_skill`、`manage_skill`、`edit_skill_resource`、`import_skill_from_page_zip`、`import_git_skill_repository`、`install_skill_to_git`、`import_page_zip`、`import_git_repository`、`manage_bookmarks`、`wait_for_user`、`ask_user`、`send_message`，以及任何 `mcp_` 开头的名字。`run_script` 不在黑名单里。侧栏对直驱会话只查看。不要通过脚本绕过黑名单。

返回值。`open_tab` 成功时看 `tabRef`。`get_ax_tree` 读 `snapshot` 文本。`find_elements` 用返回的 `target`。页面 `run_script` 的有用值在 `result` 里。直驱成功包一层 `{ok:true, result}`。`qz script` 去掉这层，stdout 就是 `result`。失败 stdout 是 JSON：`{"code":"……","error":"……","trace":[……]}`，`trace` 最多 5 条。退出码 0 是成功，1 是工具失败，2 是参数不合法。

直驱细则。下面这些是同一条路径上的字段、返回和停手条件。写错一处就停，把返回的 code 和原句交给用户，改一处再试。

open_tab。url 必填，用 http 或 https。tabAlias 可选。成功时看 tabRef，不要再找 id。你写的别名可以马上用在下一步。这个调用本身不要传 tabRef。

navigate。url 必填。tabRef 指向已经打开的页面。地址变了以后，旧的 uid 不要沿用。先 wait_for_navigation，或再读一次缩小范围的 get_ax_tree。

get_ax_tree。只为了拿到 uid。能写 root、depth、limit 就写。结果变成截断包时，先缩小范围，不要把 preview 当成完整树。

find_elements。pattern 是可见文本或可访问名的片段，selector 是 CSS。返回的 target 原样交给 act_on_element。不要自己拼 uid 字符串。

act_on_element。target 用 uid: 或 css:。action 只在 click、fill、press、select、check、uncheck、scroll 里选。fill 和 select 要 value。press 要 key。一次只做一个动作。

scroll_page。没有可靠目标时先滚动再读树。它不代替 act_on_element 的 scroll。

screenshot。不是默认步骤。树和选择器都不够时才拍。图片字节不进 JSON 正文。

两个默认等待。wait_for_element 的 selector 是 CSS，超时看 found，不抛错。wait_for_navigation 等地址变化。wait_until 是钟点等待，参数是带时区的 until，不在默认列表里。它留在说明书档，仍可调用：用 qz tools wait_until 或 qingzhou_get_tool 看签名后再调。它不在黑名单里。说明书档还有 wait、wait_for_response、wait_for_network_idle。wait_for_user 和 ask_user 不能直驱。

run_script。直驱入口强制 target 为 page，并且必须有 tabRef。内置 agent 自己的 inner 批处理还在，但这条直驱路径、qz script 和这份说明书都不使用它。页面脚本里可以 await tools.名字(参数)。直驱运行里的 tools.$list() 只返回默认档的短签名，每一项是名字、一行签名和一句说明。黑名单名字在脚本里同样会被拒绝。语法错误带回引擎原文、行列号和几行堆栈。若说明被改写成「脚本执行失败。」或「脚本语法错误，请检查引号、换行、括号或 return/await 的位置。」投影会改回 details 里的原文，并附上 (行:列)。

load_skill 与 list_skills。list_skills 给摘要。需要正文时 load_skill，需要包内文件时再 load_skill_resource。不要为了直驱去改轻舟的模型或供应商设置。

列表形状。默认 list_tabs 是 {tabs:[{tabRef, alias, title, url}], count, foreign}。scope 为 all 时才看用户自己打开的标签，每一项的标签标识仍然是 tabRef。get_working_tab、use_tab、close_tab、navigate 在直驱结果里也用 tabRef 标识页面。

短签名。默认列表类似 open_tab({url, tabAlias?})。说明书档不在这个列表里，仍可用 qz tools 名字 或 qingzhou_get_tool 拿到签名后调用。不要因为默认列表没有它就当成不能调用。

会话忙与占用。DRIVE_SESSION_BUSY 表示同一会话已有调用在飞。桥接对这个错误码最多自动重试一次。连接失败、需要登录、DRIVE_SESSION_OCCUPIED 都不循环。占用表示这个 id 已经是普通任务，换一个新的 sessionId。

登录。没有单独的登录墙检测器。看到登录页或验证时停下来，让用户在这个浏览器里打开该站并登录，然后重试。

离开。客户端断开，或空闲约 30 分钟后，本会话用 open_tab 打开的标签会被关掉。use_tab 接管的标签和用户原来的标签只释放租约，绝不自动关。用户点一下该标签会交还，标签留在原地。只有显式 keep 才留下标签组。不要跨进程恢复旧的 sessionId。下一次先 qz connect，再走黄金路径。

同一标签。后到的会话拿不到，先拿到的会话不中断。这是租约冲突，换页面或换会话，不要循环去抢。

桥接时间。MCP 上一次 run_script 的节点等待不短于脚本 timeout 再加 60 秒。脚本 timeout 小于等于 0 时，节点侧用等待上限，不要先 sleep。BRIDGE_REQUEST_TIMEOUT 先看这次调用是否还在跑。qz script 每个进程仍是一次新连接。要接着用同一个直驱会话，把 stderr 里的 sessionId 传到下一次 --session。这条路径不在进程之间复用 MCP 握手。

安装。对外只有 skills/qz-browser-agent 这一份可发现技能。npx skills add alibaba/qz-browser-agent -g 装的就是它，里面带这份说明书和 references/create-task.md。

不要再安装或寻找名叫 qz-drive 的技能。需要内置 agent 规划执行时，再读 references/create-task.md。

调用示例。这些例子只用公开的示例站，用来核对参数形状，不是待答的题目。

直驱不假设工作标签页。带 tabRef 参数的页面工具都要写上。open_tab 用 tabAlias。list_tabs、list_skills、load_skill、wait 和 wait_until 不需要页面目标。get_working_tab 只查询当前页，不在默认列表里，仍可调用。

```json
{"name":"navigate","args":{"url":"https://example.com/next","tabRef":"page"}}
```

```json
{"name":"act_on_element","args":{"tabRef":"page","target":"css:button[type=submit]","action":"click"}}
```

```json
{"name":"wait_for_element","args":{"tabRef":"page","selector":"main h1","timeout":10}}
```

```json
{"name":"run_script","args":{"target":"page","tabRef":"page","timeout":30,"code":"async () => {\n  return { title: document.title, href: location.href };\n}"}}
```

失败时直驱把脚本收成这样。error 里是引擎原文，不是一句笼统的失败。trace 最多 5 条。

```json
{"ok":false,"code":"SCRIPT_SYNTAX_ERROR","error":"SyntaxError: Unexpected token (2:4)","line":2,"column":4}
```

qz tools 和 qingzhou_list_tools 的默认项是短签名，不是完整 JSON Schema。要看一个说明书档工具，再点名查询。查询本身不是调用。

```text
open_tab({url:string, tabAlias?:string})
打开一个标签页。
```

本会话还没有别名就写了别名时，错误码是 BATCH_TAB_REFERENCE_ERROR，reason 是 no_alias。先 open_tab，再用返回的 tabRef。不要改成去配模型。

直驱页面工具没写 tabRef 时，错误码是 DRIVE_TAB_REF_REQUIRED。run_script 写成 target inner 时，错误码是 DRIVE_RUN_SCRIPT_TARGET。这两条只挡直驱入口、脚本里的页面工具和 qz script。内置 agent 自己的 inner 批处理不走这里。

节点等待。客户端 timeoutSeconds 是这一次 MCP 请求的等待。脚本 args.timeout 是页面脚本自己的秒数。节点实际等待取二者里更长的那个，并且脚本再加 60 秒。不要改写 limits.timeoutSeconds，那是一批 calls 的总预算。脚本 timeout 小于等于 0 时节点等待用 86400 秒作上限。

同一条 MCP 连接省略 sessionId 时共用一个新 id。qz script 和 qz exec 每个进程都是新连接，所以省略 --session 会新开一个直驱会话。成功和失败都把 sessionId 打到 stderr。下一次带上它。并行的几路不要共用一个 id。

再核对一遍停手。未连接时下一句只是 qz connect。瞬时忙自动重试一次之后仍忙，就等当前调用结束。普通任务占用的 id 直接换新，不要重试同一个 id。工具被黑名单拒绝时，换一个默认档或说明书档的名字，不要在脚本里换个写法绕过去。参数不合法时补 id、name 或对象 args。一批超过 10 个就拆开。一批总时间到了就加大 limits.timeoutSeconds，或把读取放进带 tabRef 的页面脚本。不知道名字时先看默认列表。别名写错、顺序写反、或本会话还没有别名，都停在 BATCH_TAB_REFERENCE_ERROR。标签不属于本会话时用本会话的 tabRef，或先 open_tab。请求超时不要先 sleep。调用被中止时先看页面是否已经变了。

侧栏对直驱会话只查看。不要通过脚本绕过黑名单。不要配置轻舟模型。

字段再记几条。timeout 在脚本和 wait_for_element 上都是秒。tabRef 可以是别名或正整数，数字字符串也可以，不要和另一个目标一起指到不同的页。open_tab 的 tabAlias 是 1–64 个字母、数字、下划线或连字符，不能全是数字。关闭该标签后别名失效。verbose 只在确实要坐标时加。scope 为 all 只加在 list_tabs 上。文档工具名字仍带 qingzhou_documents__ 前缀。Skill 包内文件走 load_skill_resource，不要把整包贴进对话。mutatesPage 只在页面脚本会改页面时设为 true，直驱不会替你推断。
同一会话里一批 calls 里多个 open 或 act 仍是一轮，不要为此新造工具名。编排用 calls 或 execute_tool，不要塞进 inner。页面脚本只读 document，不要再嵌一段 run_script 字符串。fetch 少取：能写死选择器就不要先读整棵树。
返回值再记一次。open_tab 成功看 tabRef。get_ax_tree 读 snapshot。find_elements 用返回的 target。页面脚本的有用值在 result。直驱成功是 {ok:true, result}。qz script 去掉这一层，stdout 就是 result。失败 stdout 是 JSON，退出码 0 成功，1 是工具失败，2 是参数不合法。

不要用 curl 或 wget 取页面正文。bash 只处理本机文件。同一段页面脚本可以在 `qz script --tab` 和 `qingzhou_execute_tool` 之间原样使用。不要把这份全文改写成另一套步骤。
<!-- qz-drive-guide:end -->

<!-- qz-drive-guide:en -->
不要配置轻舟模型

This is the direct-drive guide. The external agent plans the work and uses the connected browser to open tabs, read pages, and act on elements. Do not start a qz model, and do not call `qz create`. When the built-in qz agent should plan and carry out the work, read references/create-task.md.

Install or update this skill with the existing command. Do not invent another package name:

```bash
npx skills add alibaba/qz-browser-agent -g
```

`qz skill` and MCP `qingzhou_guide` return this text. Read it once on a new connection. Do not read it again every turn. `--lang zh-CN` or `en` selects the language; otherwise `QZ_GUIDE_LANG` and `LANG` do.

Connection. Run this on the machine where the extension is installed. Check Node.js 22 or later, then see whether a browser is online:

```sh
node --version
npx --yes qz-browser-agent@latest status --json
```

Read `result.connected` and `result.browsers`. When nothing is paired, run `qz connect`. It starts the local service and opens the pairing page in the default browser. Confirm once in the browser. If the client is not connected, the next step is `qz connect`. Do not configure a model instead.

To choose a profile, take the pairing URL and open it yourself:

```sh
npx --yes qz-browser-agent@latest connect --no-open --json
```

`result.url` is the page to open. `mcpUrl` is the MCP address. Open that URL in the user-selected profile where qz is installed. On macOS Chrome, set `QZ_PAIRING_URL` and `QZ_PROFILE_DIRECTORY`, then:

```sh
open -na "Google Chrome" --args --profile-directory="$QZ_PROFILE_DIRECTORY" "$QZ_PAIRING_URL"
```

For a custom user-data directory, also pass `--user-data-dir`. Bind one profile at a time. Compare `browsers --json` before and after, and keep the new `clientId`. Later commands pass `--client` with that UUID. `--client` selects an already connected browser. Do not combine it with `connect --no-open` or `connect --name`.

`connect --name work` names the profile that opens the URL. Without a name, an existing name stays, or qz allocates `default`, `browser-2`, and so on. Ordinary `connect` opens the system default browser when pairing is needed, and reuses the only online browser otherwise.

If the extension is missing, ask the user to add it from the Chrome Web Store in that profile. `npx --yes qz-browser-agent@latest install` opens the listing. A manual install uses the ZIP from the latest GitHub release. After installation, finish the first-use notice, then open the pairing URL.

If pairing fails, compare the address in `status --json`. `connect --port` applies only before the service is running. A running service keeps its address. Changing the address does not connect until the user confirms. For an incompatible upgrade, wait for current work, run `npx --yes qz-browser-agent@latest stop`, update and reload the extension in every browser, then `qz connect`. `stop` disconnects every browser. Disconnect one browser from its own settings.

After pairing, print the MCP URL with `npx --yes qz-browser-agent@latest mcp`. The default catalog is this direct-drive set: `qingzhou_guide`, `qingzhou_execute_tool`, `qingzhou_list_tools`, `qingzhou_get_tool`, and `qingzhou_bridge_status`. `qz mcp --profile full` is the task and diagnostic catalog, not the default.

Golden path. After connect, these two calls show the tab group 「轻舟 · 客户端名」 in the side panel:

```json
{"calls":[
  {"id":"open","name":"open_tab","args":{"url":"https://example.com","tabAlias":"page"}},
  {"id":"read","name":"get_ax_tree","args":{"tabRef":"page"}}
]}
```

The CLI form is two `qz exec` calls, or one `calls` batch. A successful `open_tab` returns `tabRef`, not `id`. The `tabAlias` you passed stays valid. Later page tools use that alias or that `tabRef`.

Orchestrate with your own `calls` batch or one `execute_tool`. Several opens or acts in one batch on the same session are still one round. Do not invent a tool name for that. Do not put orchestration in a script with `target` inner. Direct drive rejects `target:"inner"`.

Use `qz script` only when you need JavaScript on the page. It requires `--tab`, runs only on that page, sees the login session, and can `await tools.name(arguments)`.

```sh
qz script --tab page page.js
```

```js
async () => {
  return { title: document.title, href: location.href };
}
```

The same MCP call is `qingzhou_execute_tool` with `name` `run_script` and `args` `{target:"page", tabRef, timeout, code}`. `tabRef` is required. Pass it, and do not pass inner. Do not nest another `run_script` as a string inside this script. Read `document` in this page script.

`code` is one `async () => { ... }` function expression. No IIFE, no `main()`, and no `return` outside the function. Start with a one-line comment naming the page, the action, and the purpose. `timeout` is seconds and is required. `<= 0` means no limit. `> 0` is the maximum wait. `qz script` sends 120 unless `--timeout` says otherwise. The bridge waits 60 seconds longer, so the node process does not fail before the extension. Do not sleep first.

`tabRef` is a page alias in this session, or a positive integer tab id. An alias is 1–64 letters, digits, underscores, or hyphens, and not all digits. It belongs to this session and dies when the tab closes. The `open_tab` that creates an alias comes first. When this session has no alias yet, `open_tab` first, then use the returned `tabRef`. Do not invent `page(...)` or another shorthand. `open_tab` uses `tabAlias` and does not take `tabRef`. Each `list_tabs` row identifies the tab with `tabRef`.

Direct drive does not use a working tab. A page tool that accepts `tabRef` is rejected with `DRIVE_TAB_REF_REQUIRED` when that field is missing. `act_on_screen` has no `tabRef` parameter. Every other page call in a batch sets its own `tabRef`. One tab has one session at a time. A later claimant fails. The session that already holds the tab is not interrupted.

Default tools. `qz tools`, `qingzhou_list_tools`, and `tools.$list()` return this tier by default. Each item is a one-line signature and a short description:

`open_tab`, `navigate`, `list_tabs`, `close_tab`, `use_tab`, `get_ax_tree`, `find_elements`, `read_article`, `act_on_element`, `scroll_page`, `screenshot`, `wait_for_element`, `wait_for_navigation`, `run_script`, `load_skill`, `list_skills`.

Guide-tier tools still run. They stay off the default list. Use `qz tools NAME` or `qingzhou_get_tool` for a signature. That tier includes `read_dom`, `inspect_element`, `act_on_screen`, `get_working_tab`, secondary waits (`wait`, `wait_for_response`, `wait_for_network_idle`), the clock wait `wait_until`, `document_*`, `list_images`, `collect_images`, `read_image`, `data_store`, `download_url`, `save_file`, `network_*`, `browse_history`, `set_page_mode`, `send_alert`, and `load_skill_resource`. Document tool names still use the prefix `qingzhou_documents__`. Do not rename them.

Common calls:

- `open_tab({url, tabAlias})`. `url` is required.
- `navigate({url, tabRef})`. `url` is required.
- `act_on_element({tabRef, target, action, value, key})`. `target` is `uid:` or `css:`. `action` is `click`, `fill`, `press`, `select`, `check`, `uncheck`, or `scroll`.
- `wait_for_element({tabRef, selector, timeout, absent})`. `selector` is required CSS, not `uid:`. A timeout does not throw. Check `found`.
- `wait_for_navigation({tabRef, timeout})` waits for the URL to change.
- `get_ax_tree({tabRef, root, scope, depth, limit})`. Call it when you need a `uid:`, and narrow `root` or `limit`.
- `find_elements({tabRef, pattern, selector, limit})`. Pass a returned `target` to the next `act_on_element`.
- `run_script({target:"page", tabRef, timeout, code})`. `tabRef`, `timeout`, and `code` are required. Set `mutatesPage:true` when the script changes the page.
- `load_skill({name})`, then `load_skill_resource` when you need a file. `list_skills` returns summaries.

Fetch less. A known selector does not need a full tree, and one button does not need `list_tabs`, then `get_ax_tree`, then `screenshot`. `screenshot` is not a default step. A result past about 48000 characters becomes `{truncated:true, totalChars, limitChars, preview}`. Unless `verbose:true`, results omit `_tabId`, `_pageTitle`, `_pageUrl`, `_pageContext`, `sessionId`, `runId`, `rect`, `clickablePoint`, `parent`, `lineRange`, and `actionable`. `list_tabs` defaults to this session: `{tabs:[{tabRef, alias, title, url}], count, foreign}`. Pass `scope:"all"` only to see a tab the user opened.

Sessions. A drive session has source `external-drive`. Omit `sessionId` and this MCP connection keeps one new id. Each `qz script` or `qz exec` process is a new connection; omitting `--session` starts a session. Success and failure write `sessionId <id>` to stderr. The next process passes `--session <id>`. Parallel paths each use their own sessionId. An id that already belongs to a normal task returns `DRIVE_SESSION_OCCUPIED`. Use a new id. Do not loop. A session that already has a call in flight returns `DRIVE_SESSION_BUSY`. A transient busy state retries once. If it is still busy, wait for that call. Do not start another round, and do not sleep through it.

Tabs. Tabs this session opened with `open_tab` belong to the session. When the client leaves, or the session goes idle, those tabs are closed. Tabs the user already had, and tabs claimed with `use_tab`, only release the lease. They are never closed automatically. If the user activates the tab, automation stops and the tab stays. Only an explicit keep leaves the tab group. Do not reuse an old sessionId across processes. The next day, `qz connect`, then start a new golden path. A leftover 「轻舟 · …」 group is an ordinary tab group, not the old session.

Stop on an error. Tell the user the returned `code` and the sentence, change one thing, and try again. A script syntax error, its line and column, and a short stack come back as the engine reported them. Do not replace that with a generic failure sentence.

- Not connected, or the connection dropped: run `qz connect`, then try again. Do not loop.
- `DRIVE_SESSION_BUSY`: wait for this batch. A transient busy state retries once.
- `DRIVE_SESSION_OCCUPIED`: use a new sessionId.
- `DRIVE_TOOL_FORBIDDEN`: direct drive cannot call this name, including `tools.name` inside a script.
- `DRIVE_ARGUMENTS`: pass `name` or `calls`, not both. Each call needs `id`, `name`, and an object `args`.
- `DRIVE_TOO_MANY_CALLS`: at most 10 calls in one batch.
- `DRIVE_BATCH_TIMEOUT`: `limits.timeoutSeconds` elapsed. Raise the limit, or move a page read into `qz script` with `tabRef`.
- `UNKNOWN_TOOL`: run `qz tools` or `tools.$list()` first.
- `BATCH_TAB_REFERENCE_ERROR`: `tabRef` or `tabAlias` is wrong, or `open_tab` comes after the call that uses the alias. When this session has no alias yet, `open_tab` first.
- `DRIVE_TAB_REF_REQUIRED`: a page tool has no `tabRef`. `open_tab` uses `tabAlias`. `list_tabs`, `list_skills`, `load_skill`, `wait`, and `wait_until` do not need a page target.
- `SESSION_TAB_UNOWNED`: use this session's `tabRef`, or `open_tab` first.
- Login wall: 在这个浏览器里打开该站并登录，然后重试。
- `BRIDGE_REQUEST_TIMEOUT`: do not sleep first. A script request waits 60 seconds longer than the script timeout. Check whether that call is still running before you send it again.
- `OPERATION_ABORTED`: see whether the page already changed before you retry.

Names direct drive cannot call: `ask_llm`, `manage_sessions`, `manage_settings`, `manage_guardrails`, `manage_skill_settings`, `manage_goal`, `example_echo`, `qingzhou_call`, `create_skill`, `update_skill`, `delete_skill`, `manage_skill`, `edit_skill_resource`, `import_skill_from_page_zip`, `import_git_skill_repository`, `install_skill_to_git`, `import_page_zip`, `import_git_repository`, `manage_bookmarks`, `wait_for_user`, `ask_user`, `send_message`, and any name that starts with `mcp_`. `run_script` is not on that list. The side panel for a drive session is view-only. Do not route around the blacklist from a script.

Results. A successful `open_tab` has `tabRef`. A successful `get_ax_tree` is the `snapshot` text. `find_elements` returns `target` values. A page `run_script` puts the useful value on `result`. Direct drive wraps success as `{ok:true, result}`. `qz script` unwraps it, so stdout is `result`. Failure stdout is JSON: `{"code":"…","error":"…","trace":[…]}`, with at most five trace rows. Exit 0 is success, 1 is a tool failure, and 2 is invalid arguments.

Direct-drive details. These are the fields, return values, and stop conditions on this same path. Stop on the first error. Give the user the returned code and the sentence, change one thing, and try again.

open_tab. url is required and uses http or https. tabAlias is optional. On success read tabRef. Do not look for id. The alias you passed is valid on the next call. This call does not take tabRef.

navigate. url is required. tabRef names a tab that is already open. After the URL changes, do not reuse an old uid. Call wait_for_navigation, or read a smaller get_ax_tree.

get_ax_tree. Use it for a uid. Set root, depth, or limit when you can. If the result is truncated, narrow the read. Do not treat preview as the full tree.

find_elements. pattern is a fragment of visible text or an accessible name. selector is CSS. Pass a returned target to act_on_element unchanged. Do not assemble a uid string yourself.

act_on_element. target is uid: or css:. action is one of click, fill, press, select, check, uncheck, or scroll. fill and select need value. press needs key. One action per call.

scroll_page. Scroll, then read the tree, when you have no reliable target. It does not replace scroll on act_on_element.

screenshot. This is not a default step. Use it when the tree and a selector are not enough. Image bytes stay out of the JSON body.

Two default waits. wait_for_element takes a CSS selector. A timeout sets found and does not throw. wait_for_navigation waits for the URL to change. wait_until is a clock wait. Its argument is until, an absolute time with a time zone. It is not on the default list. It stays on the guide tier and is still callable: use qz tools wait_until or qingzhou_get_tool, then call it. It is not blacklisted. Guide-tier waits also include wait, wait_for_response, and wait_for_network_idle. wait_for_user and ask_user cannot be driven.

run_script. The direct-drive entry forces target page and requires tabRef. The built-in agent's own inner batches still exist. This direct path, qz script, and this guide do not use them. A page script may await tools.name(arguments). tools.$list() during a drive run returns only the default tier, each item a name, a one-line signature, and one sentence. Blacklisted names fail inside the script too. A syntax error comes back as the engine text, with line, column, and a few stack lines. If a catalog sentence replaced that with a generic failure, the drive projection restores details.originalError and appends (line:column).

load_skill and list_skills. list_skills returns summaries. load_skill when you need the body, then load_skill_resource for a file in the package. Do not change a qz model or provider for direct drive.

List shape. The default list_tabs value is {tabs:[{tabRef, alias, title, url}], count, foreign}. scope all is the only way to see a tab the user opened, and each row still identifies the tab with tabRef. get_working_tab, use_tab, close_tab, and navigate also identify the page with tabRef in a drive result.

Short signatures. A default row looks like open_tab({url, tabAlias?}). A guide-tier tool is absent from that list and still callable. qz tools NAME or qingzhou_get_tool returns its signature. Absence from the default list does not mean the tool is blocked.

Busy and occupied. DRIVE_SESSION_BUSY means this session already has a call in flight. The bridge retries that code at most once. Connection failures, login, and DRIVE_SESSION_OCCUPIED do not loop. Occupied means the id already belongs to a normal task. Use a new sessionId.

Login. There is no separate login-wall detector. When you see a login page or a challenge, stop and ask the user to open the site in this browser, sign in, and retry.

Leaving. When the client disconnects, or the session is idle for about 30 minutes, tabs this session opened with open_tab are closed. Tabs claimed with use_tab, and tabs the user already had, only release the lease. They are never closed automatically. If the user activates the tab, automation stops and the tab stays. Only an explicit keep leaves the tab group. Do not resume an old sessionId across processes. Next time, qz connect, then the golden path.

One tab. A later session does not take it. The session that already holds it is not interrupted. That is a lease conflict. Change the page or the session. Do not loop to take it.

Bridge time. On MCP, the node wait for one run_script is at least the script timeout plus 60 seconds. When the script timeout is less than or equal to 0, the node side uses its upper bound. Do not sleep first. On BRIDGE_REQUEST_TIMEOUT, see whether that call is still running. Each qz script process is still a new connection. To continue the same drive session, pass the sessionId from stderr as --session on the next process. This path does not reuse an MCP handshake across processes.

Install. The only discoverable skill is skills/qz-browser-agent. npx skills add alibaba/qz-browser-agent -g installs that skill, including this guide and references/create-task.md.

Do not install or look for a skill named qz-drive. When the built-in agent should plan the work, read references/create-task.md.

Call shapes. These examples only check argument shape. They are not questions to answer.

Direct drive does not assume a working tab. Page tools that take tabRef set it. open_tab uses tabAlias. list_tabs, list_skills, load_skill, wait, and wait_until need no page target. get_working_tab only queries the current page. It is off the default list and still callable.

A failed page script comes back with the engine text. trace has at most five rows. qz tools and qingzhou_list_tools return short signatures, not full JSON Schema. Ask for a guide-tier tool by name before you call it. The lookup is not the call.

If this session has no alias yet and you pass one, the code is BATCH_TAB_REFERENCE_ERROR and the reason is no_alias. open_tab first, then use the returned tabRef. A page tool without tabRef returns DRIVE_TAB_REF_REQUIRED. Direct-drive run_script with target inner returns DRIVE_RUN_SCRIPT_TARGET. Those checks apply to the drive entry, to page tools inside a script, and to qz script. The built-in agent's own inner batches do not pass through them.

Node wait. timeoutSeconds on the MCP request is the client wait. args.timeout on the script is the page script's own seconds. The node wait is the longer of the two, and the script gets 60 seconds more. Do not rewrite limits.timeoutSeconds. That is the budget for one calls batch. A script timeout less than or equal to 0 makes the node wait use 86400 seconds as its upper bound.

Stop again on these. If nothing is connected, the next step is only qz connect. After one automatic retry, a still-busy session waits for the current call. An id owned by a normal task gets a new id, with no retry of the same id. A blacklisted name stays blacklisted inside a script. Invalid arguments need id, name, and an object args. More than 10 calls means split the batch. When the batch budget elapses, raise limits.timeoutSeconds or move the read into a page script with tabRef. An unknown name starts with the default list. A bad alias, a reversed open_tab, or a session with no alias yet stops at BATCH_TAB_REFERENCE_ERROR. A tab this session does not own needs this session's tabRef, or open_tab first. A request timeout does not start with sleep. After an abort, look at the page before you retry.

The side panel for a drive session is view-only. Do not route around the blacklist from a script. Do not configure a qz model.

Do not use curl or wget to fetch page content. bash stays available for local files only. The same page script works unchanged for `qz script --tab` and `qingzhou_execute_tool`. Do not rewrite this guide into another procedure.
<!-- qz-drive-guide:end -->
