---
name: qz-browser-agent
description: Drive the connected browser through the qz CLI. Create one session per task, then pass its sessionId and an explicit tabRef to page tools. Do not configure a qz model. Read references/create-task.md only when the built-in agent should plan the task.
---

<!-- qz-drive-guide:en -->
Do not configure a qz model.

The external agent plans the work and drives the connected browser. Do not start a qz model or call `qz create`. Read references/create-task.md only when the built-in agent should plan and execute the task.

## Install and connect

Install or update the skill:

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

qz skill returns this guide. Read once when starting a task, not every turn.

## One task uses one session

Run `qz session create --title "Inspect example page"` first; a readable title is required, and omitting it exits 2. stdout prints `sessionId <id>`. With --json, read result.sessionId. Each create makes a new session without starting a model.

Every later `qz script --session ID`, `qz exec --session ID`, and `qz tools --session ID` call uses that ID. Missing `--session` exits 2 and does not create or reuse a session. An unknown ID returns DRIVE_SESSION_NOT_FOUND: check the ID and browser selection, never invent an ID. A new task creates again; independent parallel tasks use separate sessions. The CLI does not resume the previous session implicitly.

### Copyable golden path (Bash/Zsh)

Connect and define qz as above. With several browsers, add --client CLIENT_UUID to the npx invocation inside that function. Stop after any failed step:

```sh
CREATED=$(qz session create --title "Inspect example page" --json) || exit 1
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

A successful open_tab returns tabRef, not id. `tabAlias` is recommended for readability and is not required. Use that alias or the tabRef returned by open_tab/list_tabs next. Aliases contain 1–64 letters, digits, underscores or hyphens, not all digits, and expire when the tab closes. A returned positive integer or its numeric string is also a tabRef; never guess one. Direct-drive results name the page with tabRef: only open_tab/list_tabs return it, preserving a supplied alias; other page tools do not echo it.

Page tools always pass `tabRef`, including act_on_screen and each page call in a batch. A missing tabRef is DRIVE_TAB_REF_REQUIRED. open_tab, list_tabs, list_skills, load_skill, wait and wait_until need no page reference; neither do read_image with url or collect_images with only urls. wait waits for a duration; use wait_for_navigation for page loading.

One tab belongs to one session at a time; a later claimant fails without interrupting its owner. Use list_tabs({scope:"all"}) to inspect other web pages and pass tabRef explicitly for read-only tools; changes require a session-owned page. Default list_tabs returns `{tabs:[{tabRef,title,url,active}],count,foreign}` for this session. active marks the tab visible to the user; it never selects a tool target.

## Discover tools and use their parameters

`qz tools --session "$SID"` and tools.$list() in a script return compact signatures. The listed tools are:

open_tab, navigate, list_tabs, close_tab, get_ax_tree, find_elements, read_article, act_on_element, scroll_page, screenshot, wait_for_element, wait_for_navigation, run_script, load_skill, list_skills.

Look up additional tools by name: `qz tools --session "$SID" wait_until`. These include read_dom, inspect_element, act_on_screen, wait, wait_for_response, wait_for_network_idle, wait_until, document tools, list_images, collect_images, read_image, read_image_asset, data_store, download_url, list_downloads, save_file, network_watch, network_recent, network_body, read_console_messages, browse_history, set_page_mode, get_location, send_alert, and load_skill_resource. wait_until takes an absolute until timestamp with a time zone.

- open_tab({url,tabAlias?}), navigate({tabRef,url}): use HTTP/HTTPS URLs.
- read_article({tabRef,target?,limit:6000}): read body text; use source:"target" for an element source, and continue with nextOffset. Do not substitute an accessibility tree for document text.
- get_ax_tree({tabRef,target?,scope?,depth?,limit?}): read snapshot for uids. scope is only viewport or full. Omitted scope uses viewport without a target, full for a uid:/css: target. Narrow target/limit; a truncated preview is not the full tree.
- find_elements({tabRef,pattern?,target?,limit?}): pattern is a regex, case-insensitive by default, not literal text. For literal `a.b`, use the JSON string `"a\\.b"`; escape other regex metacharacters too. Pass returned target unchanged to element tools.
- act_on_element({tabRef,target,action,value?,key?}): target is uid: or css:. action is click, fill, press, select, check, uncheck, or scroll. fill/select need value; press needs key. One action per call.
- wait_for_element({tabRef,target,timeout?,absent?}): prefer uid:, with css: as fallback. Check found for ordinary waits. absent:true means the original node was removed or is invisible; found:false also occurs on success, so inspect timedOut to distinguish timeout from disappearance.
- wait_for_navigation({tabRef,timeout?,fromUrl?,fromTitle?}): wait for loading to finish, not for a URL change. An already loaded tab immediately returns already_complete, which does not prove the preceding action succeeded. Supply fromUrl to compute urlChanged and read the page to verify state.

Navigation, same-URL reloads and DOM replacement can invalidate uids. On stale references, run find_elements again or read a small get_ax_tree and use a fresh target; do not repeatedly submit the old uid. Reuse returned uid: targets first; use css: targets when no uid is available. One button does not need a full tree, list_tabs, and screenshot. Use screenshots only when semantic tools are insufficient; image bytes stay out of JSON. Omit target for the viewport; pass a uid: or css: target for an element. Business results beyond about 48000 characters become `{truncated:true,totalChars,limitChars,preview}`; narrow the read. ToolError is never truncated.

Use returned target values unchanged. A target is `uid:t<tab>.<snap>.<n>` or `css:...`; rect is `{x,y,width,height}`. AX, find_elements, list_images, inspect_element and wait_for_element return targets accepted by act_on_element, inspect_element and screenshot.

## calls is a batch, not a transaction

Use each call's id to match its entry in results. Fixed-alias open/read calls may share a batch. Split requests when the next step requires an unknown uid, fileId or docModelId. Inspect each results item's isError. Failures do not roll back completed actions; do not blindly replay the entire batch. At most 10 items, and only one in-flight batch per session.

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

Direct-drive run_script passes tabRef and runs in that tab. The script runs in the tab named by tabRef. Orchestrate with calls or separate `qz exec --session ID` requests; do not nest another run_script string.

`qz script --session "$SID" --tab page page.js` reads a local file. Page code is a single `async () => { ... }` function expression: no IIFE, main(), or return outside a function. Start with a comment naming the page, action and purpose. Scripts can access document/window, input/args, tools/tool and trace/log. tabRef is a call argument, not an injected script variable; nested page tool calls explicitly pass an alias too. Page execution does not provide Node.js, fs, process or require.

CLI script has no mutatesPage option. For page changes use exec with mutatesPage:true:

```sh
qz exec --session "$SID" <<'JSON'
{"name":"run_script","args":{"tabRef":"page","timeout":30,"mutatesPage":true,"code":"async () => { document.querySelector('#query').value = 'example'; return {changed:true}; }"}}
JSON
```

Prefer act_on_element for forms/clicks. Perform clicks or navigation that unload the page as separate ordinary tool calls, then read the page again.

All three budgets are seconds:

1. args.timeout is required and limits script execution. <=0 means no script deadline; >0 is its maximum duration. CLI script defaults to 120; its --timeout sets this deadline and accepts only >0 and <=3600.
2. limits.timeoutSeconds limits the entire calls batch's execution, not client waiting. Expiry yields DRIVE_BATCH_TIMEOUT without a rollback guarantee.
3. CLI exec --timeout sets request waiting, default 180. It waits at least the longest script timeout in that request plus 60, preserving a longer client setting. Script timeout<=0 uses a request upper bound of 86400. Neither args.timeout nor limits.timeoutSeconds is rewritten. Allow enough total request time for several serial scripts; the external agent's shell deadline must also be longer.

Do not hide a request timeout with sleep. On BRIDGE_REQUEST_TIMEOUT inspect the call and page before resending. For load-more work, process a few pages per step, return count/cursor, and stop on no growth. Script execution can still time out; inspect completed work before continuing.

## PDF: load the document Skill first

Discover and load the Skill before using its document tools. PDF viewers do not support body reads or page actions. On PDF_PAGE_UNSUPPORTED or blocked script injection, use qingzhou-documents tools with the original PDF URL, not CORS proxies or online viewers. The URL and IDs below are placeholders: replace the URL, then read each response before filling the next command. Never send FILE_ID/DOC_MODEL_ID literally.

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

## CLI results

Examples omit metadata such as clientId/runId.

| Command | Success: script returns 7 | Tool failure (script syntax) | Thrown/transport failure |
| --- | --- | --- | --- |
| qz script --session ID --tab page --json | `7` | `{"code":"SCRIPT_EVALUATION_FAILED","message":"SyntaxError: Unexpected token","details":{"line":2,"column":4}}` | `{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}` |
| qz exec --session ID | `{"ok":true,"result":{"toolName":"run_script","sessionId":"S","result":{"ok":true,"result":7}}}` | `{"ok":true,"result":{"toolName":"run_script","sessionId":"S","result":{"code":"SCRIPT_EVALUATION_FAILED","message":"…"}}}` | `{"code":"DRIVE_SESSION_NOT_FOUND","message":"…"}` |

script stdout is the returned value. exec script values are at result.result.result; ordinary tool data, such as open_tab, is at result.result; batches are at result.results. An exec outer ok:true means transport success, not tool success; inspect the body and each isError. CLI exit 0 means success, 1 tool/transport failure, 2 invalid arguments. Errors use `{code,message,hint?,details?}`; details carries locations and trace information. Thrown failures on an interactive terminal without --json go to stderr. Keep supplied engine text, location and stack summaries rather than replacing them with a generic error. Handle a truncation envelope directly instead of unwrapping it as an ordinary return value.

## Finish, reconnect and recover

A CLI process exiting **does not immediately close its business tabs**. The next process in the same task explicitly passes the same sessionId. After business calls finish, about 30 minutes of idle time triggers cleanup while the extension runtime is running; process exit is not proof that cleanup completed.

Finish with `qz cancel "$SID"`: it ends the session and cleans up tabs; do not call close_tab afterward. close_tab closes individual tabs only while the session is active. Further tool execution returns DRIVE_SESSION_ENDED; create a new session for a new task. Do not use global qz stop for task cleanup.

Cleanup closes tabs opened by this session. It preserves pre-existing tabs and tabs handed back to the user. If the user activates a task tab, automation stops on that tab and the tab stays open. For a new task or a later day, run qz connect and create a new session.

Change one thing per retry and retain the error code and sentence:

- Disconnected: qz connect, no loop and no model setup.
- DRIVE_SESSION_REQUIRED: create first and pass its ID. DRIVE_SESSION_NOT_FOUND: check the ID/browser; create for a new task.
- DRIVE_SESSION_ENDED: the session has ended; no further tab cleanup calls are needed. Create for a new task.
- DRIVE_SESSION_OCCUPIED: the ID belongs to an ordinary task; create a new session.
- DRIVE_SESSION_BUSY: a call is in flight. Wait for that batch to finish.
- DRIVE_ARGUMENTS / DRIVE_TOO_MANY_CALLS: name or calls, not both; each row needs id/name and object args; at most 10 calls.
- DRIVE_TAB_REF_REQUIRED: supply this session's explicit tabRef. BATCH_TAB_REFERENCE_ERROR: check aliases, open-before-read order, and session identity. no_alias occurs only when an alias was passed but no matching alias exists in this session.
- SESSION_TAB_UNOWNED: use this session's page or open_tab first.
- UNKNOWN_TOOL: start with `qz tools --session "$SID"`, inspect by name or load the matching Skill.
- DRIVE_TOOL_FORBIDDEN: choose an available tool from `qz tools --session "$SID"`.
- DRIVE_BATCH_TIMEOUT: inspect completed results before raising the budget/splitting steps. OPERATION_ABORTED: inspect the page before retrying.
- Login/challenge: stop and ask the user to sign in in this browser, then retry.

The side panel for a drive session is view-only. Use browser tools for page content; use the shell for local files.
<!-- qz-drive-guide:end -->
