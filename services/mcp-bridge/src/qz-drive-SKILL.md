---
name: qz-browser-agent
description: Drive the connected browser directly. Create one session per task, then pass its sessionId and an explicit tabRef to page tools. Do not configure a qz model. Read references/create-task.md only when the built-in agent should plan the task.
---

<!-- qz-drive-guide:zh-CN -->
不要配置轻舟模型

外部 agent 自己编排，在已经连接的浏览器里开标签、读页面、操作元素。不启动轻舟内置模型，也不要调用 `qz create`。只有需要内置 agent 规划执行时才读 references/create-task.md。

## 安装与连接

唯一可发现技能是 skills/qz-browser-agent，里面带这份说明和 references/create-task.md。安装或更新：

```sh
npx skills add alibaba/qz-browser-agent -g
```

下文 `qz` 是 `npx --yes qz-browser-agent@latest` 的简称，不要求全局安装 CLI。Bash/Zsh 可先定义函数；PowerShell 使用完整 npx 命令替换 qz。连接命令必须在装有扩展的机器上运行，要求 Node.js 22 或更高：

```sh
qz() { npx --yes qz-browser-agent@latest "$@"; }
node --version
qz status --json
qz connect
```

查看 status 的 `result.connected`、`result.browsers`。未连接时下一步是 `qz connect`，不要配置模型。它启动本机服务，在默认浏览器打开配对页，请用户确认一次；只有一个在线浏览器时复用它。扩展未安装时 `qz install` 打开商店，让用户添加扩展并完成首次数据说明，然后配对。

指定 Profile 时：

```sh
qz connect --no-open --name work --json
```

把 `result.url` 打开在用户选定的、已装扩展的 Profile。macOS Chrome 可设置 QZ_PAIRING_URL 和 QZ_PROFILE_DIRECTORY 后运行：

```sh
open -na "Google Chrome" --args --profile-directory="$QZ_PROFILE_DIRECTORY" "$QZ_PAIRING_URL"
```

自定义数据目录再加 `--user-data-dir`。配对前后比较 `qz browsers --json`，记下新出现的 clientId；后续命令带 `--client CLIENT_UUID`。多浏览器在线时必须选定，不能与 connect 的 --no-open/--name 混用。--name 命名打开配对 URL 的 Profile，不写则保留旧名或分配 default、browser-2 等名字。一次只绑定一个 Profile。

连不上先检查 status 的地址；connect --port 仅在服务未启动时指定端口，已有服务保持原地址。改地址后仍需用户确认。升级不兼容时先等当前任务结束，再 `qz stop`、更新并重新加载各浏览器扩展、`qz connect`。stop 会断开所有浏览器，**不是任务清理命令**。

`qz skill` 和 MCP `qingzhou_guide` 返回这份说明；每条新连接读一次，不要每轮重读。`--lang zh-CN|en` 选择语言，否则跟随 QZ_GUIDE_LANG/LANG。`qz mcp` 打印 MCP 地址。默认目录：qingzhou_guide、qingzhou_create_drive_session、qingzhou_execute_tool、qingzhou_list_tools、qingzhou_get_tool、qingzhou_bridge_status。`qz mcp --profile full` 打印任务和诊断目录地址。

## 一个任务一个会话

先 `qz session create`，stdout 打出 `sessionId <id>`；`--json` 则取 result.sessionId。MCP 调 qingzhou_create_drive_session，取返回的 sessionId。每次 create 都创建新会话，不启动模型。

后续每次 `qz script --session ID`、`qz exec --session ID`、`qz tools --session ID` 都带同一 ID；MCP 对应调用显式传同一个 sessionId。漏掉 `--session` 退出码 2，不会新建，也不会沿用上次会话。不存在的 ID 返回 DRIVE_SESSION_NOT_FOUND；检查 ID 和浏览器选择，不要自造 ID。换新任务再 create，并行的独立任务各自创建会话。

### 可复制的黄金路径（Bash/Zsh）

先完成连接及上面的 qz 函数定义。多浏览器时给函数内的 npx 调用追加 `--client CLIENT_UUID`。以下每步失败就停：

```sh
CREATED=$(qz session create --json) || exit 1
SID=$(printf '%s' "$CREATED" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!x.ok || !x.result.sessionId) process.exit(1); console.log(x.result.sessionId)') || exit 1
qz exec --session "$SID" <<'JSON'
{"calls":[
  {"id":"open","name":"open_tab","args":{"url":"https://example.com","tabAlias":"page"}},
  {"id":"read","name":"get_ax_tree","args":{"tabRef":"page","scope":"viewport","limit":40}}
]}
JSON
test "$?" -eq 0 || exit 1
# 检查上一批每项 isError；有错误就不要继续。
qz script --session "$SID" --tab page --json - <<'JS'
async () => {
  // 读取示例页的标题和地址，确认页面内容。
  return { title: document.title, href: location.href };
}
JS
```

`open_tab` 成功时看 tabRef，不是 id。tabAlias 建议写上，便于阅读，但不是必填。下一步使用别名，或 open_tab/list_tabs 返回的 tabRef。别名是 1–64 个字母、数字、下划线或连字符，不能全为数字；关闭标签后失效。tabRef 也可为返回的正整数或其数字字符串，不能凭空猜值。直驱结果用 tabRef 标识页面。

页面工具始终传 `tabRef`。一批中每项都传自己的页面引用；缺失时返回 DRIVE_TAB_REF_REQUIRED。open_tab 不传 tabRef；list_tabs、list_skills、load_skill、wait、wait_until 不需要页面引用；read_image 传 url 时也不需要。act_on_screen 使用截图坐标凭据，没有 tabRef 参数。

同一标签只归一个会话，后来者失败，不中断先占用者。查看用户标签用 list_tabs({scope:"all"})，接管前查询 use_tab 的签名和归属要求。默认 list_tabs 是本会话短列表 `{tabs:[{tabRef,alias,title,url}],count,foreign}`。

## 发现工具与常用参数

`qz tools --session "$SID"`、qingzhou_list_tools({sessionId})、脚本 tools.$list() 默认返回短签名，不是完整 JSON Schema：

open_tab、navigate、list_tabs、close_tab、use_tab、get_ax_tree、find_elements、read_article、act_on_element、scroll_page、screenshot、wait_for_element、wait_for_navigation、run_script、load_skill、list_skills。

说明书档不在默认列表但仍可按名查询：`qz tools --session "$SID" wait_until`，或 qingzhou_get_tool({sessionId,name:"wait_until"})。包括 read_dom、inspect_element、act_on_screen、get_working_tab、wait、wait_for_response、wait_for_network_idle、wait_until、文档工具、list_images、collect_images、read_image、data_store、download_url、save_file、network_*、browse_history、set_page_mode、send_alert、load_skill_resource。get_working_tab 仅查询页面，不替代显式引用；wait_until 的 until 是带时区的绝对时间。

- open_tab({url,tabAlias?})、navigate({tabRef,url})：url 用 http/https。
- read_article({tabRef,limit:6000})：读正文；跟随 nextOffset 分段续读，不用树代替全文。
- get_ax_tree({tabRef,root?,scope?,depth?,limit?})：取 snapshot 中的 uid。scope 只能是 viewport 或 full。省略时 root="root" 用 viewport，uid:/css: 根用 full；缩小 root/limit，勿把截断 preview 当完整树。
- find_elements({tabRef,pattern?,selector?,limit?})：pattern 是正则，默认忽略大小写，不是字面文本。字面 `a.b` 要用 JSON 字符串 `"a\\.b"`；其它正则元字符也需转义。返回 target 原样交给元素工具。
- act_on_element({tabRef,target,action,value?,key?})：target 用 uid: 或 css:；action 仅 click、fill、press、select、check、uncheck、scroll。fill/select 需要 value，press 需要 key，一次一个动作。
- wait_for_element({tabRef,selector,timeout?,absent?})：selector 是 CSS 或 css:，不是 uid:。普通等待检查 found；absent:true 成功时 found 也是 false，必须检查 timedOut 是否为 true，不能把超时当成功消失。
- wait_for_navigation({tabRef,timeout?,fromUrl?,fromTitle?})：等加载完成，不是等 URL 变化。调用时已经加载就立即返回 already_complete，不能证明上一动作成功。用 fromUrl 比较 urlChanged，再读页面确认结果。

导航、同 URL 重载或 DOM 替换都可能使 uid 失效。遇到失效重新 find_elements 或读取局部 get_ax_tree，使用新 target；不要反复提交旧 uid。能写可靠 CSS 就直接用，不要为一个按钮连续读整树、list_tabs、截图。screenshot 仅在语义工具不够时使用，图片不进入 JSON 正文。默认超过约 48000 字符的结果会变为 `{truncated:true,totalChars,limitChars,preview}`，请缩小读取。

## calls 是批次，不是事务

calls 每项的 id 只是关联结果，不会把前项的返回值插值给后项。固定 alias 的 open/read 可同批；读到 uid、fileId、docModelId 后才能确定的下一步要拆请求。检查 `results` 中每项的 isError；失败不回滚已执行动作，不要盲目重放整批。一批最多 10 项，同会话只能有一批在执行。

例如两页对比：

```sh
qz exec --session "$SID" <<'JSON'
{"calls":[
  {"id":"a-open","name":"open_tab","args":{"url":"https://example.com/a","tabAlias":"a"}},
  {"id":"a-read","name":"read_article","args":{"tabRef":"a","limit":4000}},
  {"id":"b-open","name":"open_tab","args":{"url":"https://example.com/b","tabAlias":"b"}},
  {"id":"b-read","name":"read_article","args":{"tabRef":"b","limit":4000}}
]}
JSON
```

## 页面脚本与三层超时

直驱的 run_script 在该页执行，并带 tabRef。直驱脚本只在 tabRef 所指的标签页里运行。编排用 calls 或分次 execute_tool，不要嵌套另一段 run_script 字符串。

`qz script --session "$SID" --tab page page.js` 读取本机文件，页面代码是单个 `async () => { ... }` 函数表达式；不要写 IIFE、main() 或函数外 return。用一行注释说明页面、动作和目的。可访问 document/window、input/args、tools/tool、trace/log。tabRef 是调用参数，不是自动提供的脚本变量；嵌套页面工具也显式传别名。页面运行环境不提供 Node.js、fs、process 或 require。

MCP 等价调用：qingzhou_execute_tool({sessionId,name:"run_script",args:{tabRef:"page",timeout:30,code:"async () => { return document.title; }"}})。CLI script 没有 mutatesPage 选项，修改页面时用 exec 并传 mutatesPage:true：

```sh
qz exec --session "$SID" <<'JSON'
{"name":"run_script","args":{"tabRef":"page","timeout":30,"mutatesPage":true,"code":"async () => { document.querySelector('#query').value = 'example'; return {changed:true}; }"}}
JSON
```

优先用 act_on_element 填表/点击；会卸载页面的点击或导航拆成普通工具步骤，随后重新读页面。

三层预算都以秒计：

1. args.timeout 是脚本执行期限，必填；<=0 不设脚本期限，>0 最多执行这么久。CLI script 默认 120；它的 --timeout 同时设置脚本期限，只接受 >0 且 <=3600。
2. limits.timeoutSeconds 是一批 calls 的总执行预算，不能当作客户端等待。超过时返回 DRIVE_BATCH_TIMEOUT，不保证回滚。
3. CLI exec --timeout / MCP timeoutSeconds 是请求等待，默认 180。CLI 与桥接对 run_script 都至少等该请求中最长脚本 timeout + 60，且不缩短更长的客户端设置；脚本 timeout<=0 时请求等待上限为 86400。不会改写 args.timeout 或 limits.timeoutSeconds。多段串行脚本的总时间还需显式给足请求预算；外部 agent 的 shell/MCP 超时也要更长。

不要用 sleep 掩盖请求超时。BRIDGE_REQUEST_TIMEOUT 后先检查本次调用和页面状态，不立刻重发。加载更多宜按少量页分步、返回数量/游标，无增长时停；脚本自身超时仍可能发生，先确认已完成部分再续跑。

## PDF：先加载文档 Skill

先发现并加载 Skill；文档工具只在加载后可用。不要用 PDF 查看器的页面树代替文档正文。以下 URL/ID 是占位值：替换 URL，逐步取返回值再填写下一条，不要原样提交 FILE_ID/DOC_MODEL_ID。

```sh
qz exec --session "$SID" '{"name":"list_skills","args":{}}'
qz exec --session "$SID" '{"name":"load_skill","args":{"name":"qingzhou-documents"}}'
qz exec --session "$SID" '{"name":"qingzhou_documents__document_fetch","args":{"url":"https://example.com/report.pdf"}}'
# 读取 result.result.fileId，填写下一条的 FILE_ID。
qz exec --session "$SID" '{"name":"qingzhou_documents__document_parse","args":{"fileId":"FILE_ID"}}'
# 读取 result.result.docModelId，填写下一条的 DOC_MODEL_ID。
qz exec --session "$SID" '{"name":"qingzhou_documents__document_read_chunk","args":{"docModelId":"DOC_MODEL_ID","chunkIndex":0}}'
```

按 read_chunk 返回的 next 按需续读。fileId/docModelId 属于当前会话。若 PDF 是另一个 Skill 的包内资源，调用 load_skill_resource({name,path}) 可直接返回 docModelId，再分块读；不用重新 fetch/parse。文档工具名保留 qingzhou_documents__ 前缀。

## 返回值：按入口解包

以下省略 clientId、runId 等元数据；MCP 指 content 中 text 的 JSON 解码值。

| 入口 | 成功：脚本 return 7 | 工具失败（脚本语法错误） | 抛出/传输失败 |
| --- | --- | --- | --- |
| qz script --session ID --tab page --json | `7` | `{"code":"SCRIPT_SYNTAX_ERROR","error":"SyntaxError: Unexpected token (2:4)"}` | `{"ok":false,"error":{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}}` |
| qz exec --session ID | `{"ok":true,"result":{"toolName":"run_script","sessionId":"S","result":{"ok":true,"result":7}}}` | `{"ok":true,"result":{"toolName":"run_script","sessionId":"S","result":{"ok":false,"code":"SCRIPT_SYNTAX_ERROR","error":"…"}}}` | `{"ok":false,"error":{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}}` |
| MCP execute_tool | `{"toolName":"run_script","sessionId":"S","result":{"ok":true,"result":7}}` | `{"toolName":"run_script","sessionId":"S","result":{"ok":false,"code":"SCRIPT_SYNTAX_ERROR","error":"…"}}` | MCP isError:true，text 为 `{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}`；连接未建立时可能没有工具响应 |

script stdout 直接是返回值；exec 的脚本值在 result.result.result，MCP 在 result.result。普通工具如 open_tab 的数据分别在 exec 的 result.result、MCP 的 result；批次分别看 result.results、results。exec 外层 ok:true 仅表示传输成功，仍要检查工具结果与每项 isError。CLI exit 0 成功、1 工具/传输失败、2 参数非法。script 已投影失败最多带 5 条 trace；抛出型失败在交互终端未加 --json 时写 stderr。错误有行列号/堆栈摘要时保留它们，不要盖成笼统失败。超过字符上限时直接处理截断包，不再按普通返回值解包。

## 收尾、隔天与出错恢复

MCP 连接与业务 Session 不同：每个 CLI 进程会关闭自己的连接，**不会立即关闭业务标签**。同任务下一个进程继续显式带同一 sessionId。业务调用结束后空闲约 30 分钟，运行中的扩展会触发该会话清理；不要把传输连接结束当成清理完成的保证。

任务完成后 `qz cancel "$SID"` 显式停止并清理本会话；或用 `qz exec --session "$SID" '{"name":"close_tab","args":{"tabRef":"page"}}'` 只关指定标签。要保留打开的标签，用 full MCP 的 qingzhou_stop_session({sessionId:SID,keepTabs:true,cascade:false})，full 地址由 qz mcp --profile full 获取。不要用全局 qz stop 收尾。

清理默认关闭本会话 open_tab 创建的标签；use_tab 接管的或用户原有的标签只释放租约，不自动关闭。用户主动激活标签会交还，自动化停止，标签保留。隔天视为新任务：qz connect，然后重新 create；昨天剩下的标签组是普通用户标签，不假定旧别名有效。

错误只修一处再试，保留 code 和原句：

- 未连接：qz connect，不循环重试、不配置模型。
- DRIVE_SESSION_REQUIRED：先 create，携带 ID。DRIVE_SESSION_NOT_FOUND：检查 ID/浏览器；新任务重新 create。
- DRIVE_SESSION_OCCUPIED：此 ID 是普通任务，改用 create 得到新 ID。
- DRIVE_SESSION_BUSY：已有调用在飞；桥接最多自动重试一次，仍忙就等当前批次结束。
- DRIVE_ARGUMENTS / DRIVE_TOO_MANY_CALLS：name 与 calls 二选一；每项 id/name、对象 args；一批最多 10 项。
- DRIVE_TAB_REF_REQUIRED：补本会话的显式 tabRef。BATCH_TAB_REFERENCE_ERROR：检查 alias、open 在 read 前、同一 session。no_alias 仅在已经传入别名但本会话没有该别名时出现。
- SESSION_TAB_UNOWNED：使用本会话页面，或先 open_tab。
- UNKNOWN_TOOL：先 `qz tools --session "$SID"`，按名查询或加载对应 Skill。
- DRIVE_BATCH_TIMEOUT：检查已执行结果再调整批次预算/拆步。OPERATION_ABORTED：先看页面是否已经变化。
- 登录墙/验证：停下来，请用户在这个浏览器登录，再重试。

不能直驱：ask_llm、manage_sessions、manage_settings、manage_guardrails、manage_skill_settings、manage_goal、example_echo、qingzhou_call、create_skill、update_skill、delete_skill、manage_skill、edit_skill_resource、import_skill_from_page_zip、import_git_skill_repository、install_skill_to_git、import_page_zip、import_git_repository、manage_bookmarks、wait_for_user、ask_user、send_message，以及任何 mcp_ 开头的工具。DRIVE_TOOL_FORBIDDEN 在脚本 tools.* 中同样有效。

侧栏对直驱会话只查看。不要通过脚本绕过黑名单。不要用 curl/wget 获取页面正文；bash 只处理本机文件。不要安装另一份名叫 qz-drive 的技能。不要配置轻舟模型。
<!-- qz-drive-guide:end -->

<!-- qz-drive-guide:en -->
不要配置轻舟模型

The external agent plans the work and drives the connected browser. Do not start a qz model or call `qz create`. Read references/create-task.md only when the built-in agent should plan and execute the task.

## Install and connect

The only discoverable skill is skills/qz-browser-agent, including this guide and references/create-task.md. Install or update it:

```sh
npx skills add alibaba/qz-browser-agent -g
```

Here `qz` abbreviates `npx --yes qz-browser-agent@latest`; a global CLI install is optional. In Bash/Zsh define the function below. In PowerShell replace qz with the full npx invocation. Run connection commands on the machine with the extension, using Node.js 22 or later:

```sh
qz() { npx --yes qz-browser-agent@latest "$@"; }
node --version
qz status --json
qz connect
```

Read result.connected and result.browsers. When disconnected, run qz connect, not model configuration. It starts the local service and opens pairing in the default browser; ask the user to confirm once. It reuses the only online browser. If the extension is missing, qz install opens the store; ask the user to install it, finish the first-use notice, and pair.

To select a Profile:

```sh
qz connect --no-open --name work --json
```

Open result.url in the user-selected Profile with the extension. On macOS Chrome, set QZ_PAIRING_URL and QZ_PROFILE_DIRECTORY, then:

```sh
open -na "Google Chrome" --args --profile-directory="$QZ_PROFILE_DIRECTORY" "$QZ_PAIRING_URL"
```

Add --user-data-dir for a custom data directory. Compare qz browsers --json before and after pairing, keep the new clientId, and pass --client CLIENT_UUID on later commands. Selection is required with several online browsers; do not combine --client with connect --no-open/--name. --name labels the Profile opening the URL; otherwise preserve its name or allocate default, browser-2, etc. Pair one Profile at a time.

For connection failures inspect the address in status. connect --port selects a port only before service startup; a running service keeps its address. The user must still confirm pairing. For incompatible upgrades, finish current tasks, qz stop, update/reload every extension, then qz connect. stop disconnects all browsers; it is **not task cleanup**.

qz skill and MCP qingzhou_guide return this guide. Read once on a new connection, not every turn. --lang zh-CN|en chooses the language; otherwise use QZ_GUIDE_LANG/LANG. qz mcp prints the MCP URL. The default catalog contains qingzhou_guide, qingzhou_create_drive_session, qingzhou_execute_tool, qingzhou_list_tools, qingzhou_get_tool and qingzhou_bridge_status. qz mcp --profile full prints the task/diagnostic catalog URL.

## One task uses one session

Run `qz session create` first: stdout prints `sessionId <id>`. With --json, read result.sessionId. On MCP call qingzhou_create_drive_session and read sessionId. Each create makes a new session without starting a model.

Every later `qz script --session ID`, `qz exec --session ID`, and `qz tools --session ID` call uses that ID; corresponding MCP calls pass the same sessionId. Missing `--session` exits 2 and does not create or reuse a session. An unknown ID returns DRIVE_SESSION_NOT_FOUND: check the ID and browser selection, never invent an ID. A new task creates again; independent parallel tasks use separate sessions. The CLI does not resume the previous session implicitly.

### Copyable golden path (Bash/Zsh)

Connect and define qz as above. With several browsers, add --client CLIENT_UUID to the npx invocation inside that function. Stop after any failed step:

```sh
CREATED=$(qz session create --json) || exit 1
SID=$(printf '%s' "$CREATED" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!x.ok || !x.result.sessionId) process.exit(1); console.log(x.result.sessionId)') || exit 1
qz exec --session "$SID" <<'JSON'
{"calls":[
  {"id":"open","name":"open_tab","args":{"url":"https://example.com","tabAlias":"page"}},
  {"id":"read","name":"get_ax_tree","args":{"tabRef":"page","scope":"viewport","limit":40}}
]}
JSON
test "$?" -eq 0 || exit 1
# Inspect every isError in the batch before continuing.
qz script --session "$SID" --tab page --json - <<'JS'
async () => {
  // Read the example page's title and URL to verify its content.
  return { title: document.title, href: location.href };
}
JS
```

A successful open_tab returns tabRef, not id. `tabAlias` is recommended for readability and is not required. Use that alias or the tabRef returned by open_tab/list_tabs next. Aliases contain 1–64 letters, digits, underscores or hyphens, not all digits, and expire when the tab closes. A returned positive integer or its numeric string is also a tabRef; never guess one. Direct-drive results name the page with tabRef.

Page tools always pass `tabRef`, including each page call in a batch. A missing tabRef is DRIVE_TAB_REF_REQUIRED. open_tab takes no tabRef. list_tabs, list_skills, load_skill, wait and wait_until need no page reference; read_image with url also needs none. act_on_screen uses screenshot coordinate credentials and has no tabRef parameter.

One tab belongs to one session at a time; a later claimant fails without interrupting its owner. Use list_tabs({scope:"all"}) to inspect user tabs and query use_tab's signature/ownership requirements before claiming one. Default list_tabs returns `{tabs:[{tabRef,alias,title,url}],count,foreign}` for this session.

## Discover tools and use their parameters

`qz tools --session "$SID"`, qingzhou_list_tools({sessionId}), and tools.$list() in a script return compact signatures, not full JSON Schema. The default tier is:

open_tab, navigate, list_tabs, close_tab, use_tab, get_ax_tree, find_elements, read_article, act_on_element, scroll_page, screenshot, wait_for_element, wait_for_navigation, run_script, load_skill, list_skills.

Guide-tier tools remain callable by name: `qz tools --session "$SID" wait_until` or qingzhou_get_tool({sessionId,name:"wait_until"}). These include read_dom, inspect_element, act_on_screen, get_working_tab, wait, wait_for_response, wait_for_network_idle, wait_until, document tools, list_images, collect_images, read_image, data_store, download_url, save_file, network_*, browse_history, set_page_mode, send_alert, and load_skill_resource. get_working_tab only queries a page, not a substitute for an explicit reference. wait_until takes an absolute until timestamp with a time zone.

- open_tab({url,tabAlias?}), navigate({tabRef,url}): use HTTP/HTTPS URLs.
- read_article({tabRef,limit:6000}): read body text; continue with nextOffset. Do not substitute an accessibility tree for document text.
- get_ax_tree({tabRef,root?,scope?,depth?,limit?}): read snapshot for uids. scope is only viewport or full. Omitted scope uses viewport for root="root", full for a uid:/css: root. Narrow root/limit; a truncated preview is not the full tree.
- find_elements({tabRef,pattern?,selector?,limit?}): pattern is a regex, case-insensitive by default, not literal text. For literal `a.b`, use the JSON string `"a\\.b"`; escape other regex metacharacters too. Pass returned target unchanged to element tools.
- act_on_element({tabRef,target,action,value?,key?}): target is uid: or css:. action is click, fill, press, select, check, uncheck, or scroll. fill/select need value; press needs key. One action per call.
- wait_for_element({tabRef,selector,timeout?,absent?}): selector is CSS or css:, never uid:. Check found for ordinary waits. With absent:true, found:false also occurs on success; inspect timedOut to distinguish timeout from disappearance.
- wait_for_navigation({tabRef,timeout?,fromUrl?,fromTitle?}): wait for loading to finish, not for a URL change. An already loaded tab immediately returns already_complete, which does not prove the preceding action succeeded. Supply fromUrl to compute urlChanged and read the page to verify state.

Navigation, same-URL reloads and DOM replacement can invalidate uids. On stale references, run find_elements again or read a small get_ax_tree and use a fresh target; do not repeatedly submit the old uid. Prefer reliable CSS when known. One button does not need a full tree, list_tabs, and screenshot. Use screenshots only when semantic tools are insufficient; image bytes stay out of JSON. Results beyond about 48000 characters become `{truncated:true,totalChars,limitChars,preview}`; narrow the read.

## calls is a batch, not a transaction

Each call's id only correlates results; it does not interpolate earlier returned values into later arguments. Fixed-alias open/read calls may share a batch. Split requests when the next step requires an unknown uid, fileId or docModelId. Inspect each results item's isError. Failures do not roll back completed actions; do not blindly replay the entire batch. At most 10 items, and only one in-flight batch per session.

For a two-page comparison:

```sh
qz exec --session "$SID" <<'JSON'
{"calls":[
  {"id":"a-open","name":"open_tab","args":{"url":"https://example.com/a","tabAlias":"a"}},
  {"id":"a-read","name":"read_article","args":{"tabRef":"a","limit":4000}},
  {"id":"b-open","name":"open_tab","args":{"url":"https://example.com/b","tabAlias":"b"}},
  {"id":"b-read","name":"read_article","args":{"tabRef":"b","limit":4000}}
]}
JSON
```

## Page scripts and three timeout budgets

Direct-drive run_script passes tabRef and runs in that tab. The script runs in the tab named by tabRef. Orchestrate with calls or separate execute_tool requests; do not nest another run_script string.

`qz script --session "$SID" --tab page page.js` reads a local file. Page code is a single `async () => { ... }` function expression: no IIFE, main(), or return outside a function. Start with a comment naming the page, action and purpose. Scripts can access document/window, input/args, tools/tool and trace/log. tabRef is a call argument, not an injected script variable; nested page tool calls explicitly pass an alias too. Page execution does not provide Node.js, fs, process or require.

The equivalent MCP call is qingzhou_execute_tool({sessionId,name:"run_script",args:{tabRef:"page",timeout:30,code:"async () => { return document.title; }"}}). CLI script has no mutatesPage option. For page changes use exec with mutatesPage:true:

```sh
qz exec --session "$SID" <<'JSON'
{"name":"run_script","args":{"tabRef":"page","timeout":30,"mutatesPage":true,"code":"async () => { document.querySelector('#query').value = 'example'; return {changed:true}; }"}}
JSON
```

Prefer act_on_element for forms/clicks. Perform clicks or navigation that unload the page as separate ordinary tool calls, then read the page again.

All three budgets are seconds:

1. args.timeout is required and limits script execution. <=0 means no script deadline; >0 is its maximum duration. CLI script defaults to 120; its --timeout sets this deadline and accepts only >0 and <=3600.
2. limits.timeoutSeconds limits the entire calls batch's execution, not client waiting. Expiry yields DRIVE_BATCH_TIMEOUT without a rollback guarantee.
3. CLI exec --timeout / MCP timeoutSeconds sets request waiting, default 180. The CLI and bridge both wait at least the longest script timeout in that request plus 60, preserving a longer client setting. Script timeout<=0 uses a request upper bound of 86400. Neither args.timeout nor limits.timeoutSeconds is rewritten. Allow enough total request time for several serial scripts; the external agent's shell/MCP deadline must also be longer.

Do not hide a request timeout with sleep. On BRIDGE_REQUEST_TIMEOUT inspect the call and page before resending. For load-more work, process a few pages per step, return count/cursor, and stop on no growth. Script execution can still time out; inspect completed work before continuing.

## PDF: load the document Skill first

Discover and load the Skill before using its document tools. Do not read a PDF viewer's page tree as document text. The URL and IDs below are placeholders: replace the URL, then read each response before filling the next command. Never send FILE_ID/DOC_MODEL_ID literally.

```sh
qz exec --session "$SID" '{"name":"list_skills","args":{}}'
qz exec --session "$SID" '{"name":"load_skill","args":{"name":"qingzhou-documents"}}'
qz exec --session "$SID" '{"name":"qingzhou_documents__document_fetch","args":{"url":"https://example.com/report.pdf"}}'
# Copy result.result.fileId into FILE_ID below.
qz exec --session "$SID" '{"name":"qingzhou_documents__document_parse","args":{"fileId":"FILE_ID"}}'
# Copy result.result.docModelId into DOC_MODEL_ID below.
qz exec --session "$SID" '{"name":"qingzhou_documents__document_read_chunk","args":{"docModelId":"DOC_MODEL_ID","chunkIndex":0}}'
```

Follow read_chunk's next value only as needed. fileId/docModelId belong to this session. For PDF resources packaged in another Skill, load_skill_resource({name,path}) returns docModelId directly; read chunks without fetching/parsing again. Keep the qingzhou_documents__ prefix.

## Results by interface

Examples omit metadata such as clientId/runId. MCP means the decoded JSON from a text content block.

| Interface | Success: script returns 7 | Tool failure (script syntax) | Thrown/transport failure |
| --- | --- | --- | --- |
| qz script --session ID --tab page --json | `7` | `{"code":"SCRIPT_SYNTAX_ERROR","error":"SyntaxError: Unexpected token (2:4)"}` | `{"ok":false,"error":{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}}` |
| qz exec --session ID | `{"ok":true,"result":{"toolName":"run_script","sessionId":"S","result":{"ok":true,"result":7}}}` | `{"ok":true,"result":{"toolName":"run_script","sessionId":"S","result":{"ok":false,"code":"SCRIPT_SYNTAX_ERROR","error":"…"}}}` | `{"ok":false,"error":{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}}` |
| MCP execute_tool | `{"toolName":"run_script","sessionId":"S","result":{"ok":true,"result":7}}` | `{"toolName":"run_script","sessionId":"S","result":{"ok":false,"code":"SCRIPT_SYNTAX_ERROR","error":"…"}}` | MCP isError:true, text `{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}`; connection failures may have no tool response |

script stdout is the returned value. exec script values are at result.result.result; MCP at result.result. Ordinary tool data, such as open_tab, is at exec result.result or MCP result. Batches are at result.results or results respectively. An exec outer ok:true means transport success, not tool success; inspect the body and each isError. CLI exit 0 means success, 1 tool/transport failure, 2 invalid arguments. Projected script failures include at most five trace rows. Thrown failures on an interactive terminal without --json go to stderr. Keep supplied engine text, location and stack summaries rather than replacing them with a generic error. Handle a truncation envelope directly instead of unwrapping it as an ordinary return value.

## Finish, reconnect and recover

MCP connections and business Sessions are different. Each CLI process closes its connection, **not immediately its business tabs**. The next process in the same task explicitly passes the same sessionId. After business calls finish, about 30 minutes of idle time triggers cleanup while the extension runtime is running; transport disconnection is not proof that cleanup completed.

At task completion, `qz cancel "$SID"` explicitly stops and cleans up this session. To close only one tab use `qz exec --session "$SID" '{"name":"close_tab","args":{"tabRef":"page"}}'`. To retain opened tabs, use full MCP qingzhou_stop_session({sessionId:SID,keepTabs:true,cascade:false}); obtain the full URL with qz mcp --profile full. Do not use global qz stop for task cleanup.

Cleanup closes tabs this session opened with open_tab. Claimed use_tab tabs and pre-existing user tabs only release leases, never close automatically. User activation hands a tab back, stops automation, and preserves the tab. The next day is a new task: qz connect, then create again. Leftover tab groups are ordinary user tabs; do not assume old aliases are valid.

Change one thing per retry and retain the error code and sentence:

- Disconnected: qz connect, no loop and no model setup.
- DRIVE_SESSION_REQUIRED: create first and pass its ID. DRIVE_SESSION_NOT_FOUND: check the ID/browser; create for a new task.
- DRIVE_SESSION_OCCUPIED: the ID belongs to an ordinary task; create a new session.
- DRIVE_SESSION_BUSY: a call is in flight. The bridge retries once; if still busy, wait for that batch.
- DRIVE_ARGUMENTS / DRIVE_TOO_MANY_CALLS: name or calls, not both; each row needs id/name and object args; at most 10 calls.
- DRIVE_TAB_REF_REQUIRED: supply this session's explicit tabRef. BATCH_TAB_REFERENCE_ERROR: check aliases, open-before-read order, and session identity. no_alias occurs only when an alias was passed but no matching alias exists in this session.
- SESSION_TAB_UNOWNED: use this session's page or open_tab first.
- UNKNOWN_TOOL: start with `qz tools --session "$SID"`, inspect by name or load the matching Skill.
- DRIVE_BATCH_TIMEOUT: inspect completed results before raising the budget/splitting steps. OPERATION_ABORTED: inspect the page before retrying.
- Login/challenge: stop and ask the user to sign in in this browser, then retry.

Blocked names: ask_llm, manage_sessions, manage_settings, manage_guardrails, manage_skill_settings, manage_goal, example_echo, qingzhou_call, create_skill, update_skill, delete_skill, manage_skill, edit_skill_resource, import_skill_from_page_zip, import_git_skill_repository, install_skill_to_git, import_page_zip, import_git_repository, manage_bookmarks, wait_for_user, ask_user, send_message, and names starting with mcp_. DRIVE_TOOL_FORBIDDEN also applies to tools.* inside scripts.

The side panel for a drive session is view-only. Do not route around the blacklist from a script. Do not use curl/wget for page content; bash only handles local files. Do not install another skill named qz-drive. Do not configure a qz model.
<!-- qz-drive-guide:end -->
