---
name: qz-browser-agent
description: Drive the connected browser through qz scripts. Create one titled session per task, pass its sessionId to every script, and use explicit tabRef values for page tools. Read qz skill for the installed CLI's guide. Read references/create-task.md only when the built-in agent should plan the task.
---

Read `qz skill` once at the start of a task to use the guide shipped with the installed CLI. `qz --version` prints its version.

<!-- qz-drive-guide:en -->
The external agent plans the work and drives the connected browser. Do not configure a qz model or call `qz create`. Read references/create-task.md only when the built-in agent should plan and execute the task.

## Connect

Use the installed `qz` command with Node.js 22 or later, on the machine running the browser extension:

```sh
qz status --json
```

Session and script commands prepare the connection automatically. They reuse a responding online browser; when none is connected, they try installed Chrome, Firefox and Edge once each within one connection deadline, stopping when the extension responds. Complete the extension’s first-use notice and connection prompt when needed. If the extension is missing, qz install opens the store; ask the user to install it.

With several browsers, run `qz browsers --json` and add `--client CLIENT_UUID` to select a profile explicitly. An existing session is located with read-only queries before any operation; ambiguous or unavailable ownership requires an explicit selection. To pair a specific profile, run `qz connect uri --name work --json` and open result.url there. This command only prints the URL. An incompatible local service is restarted once before browser operations; an incompatible extension requires updating the CLI and extension together.

## One task uses one session

Run `qz session create --title "Inspect example page"` first. A readable title is required; omitting it exits 2. stdout prints `sessionId <id>`. With --json, read result.sessionId. Each create makes a fresh session without starting a model.

Pass that same ID on every `qz script --session ID` call. Missing --session exits 2. Scripts never create a session or resume the previous one implicitly. Independent tasks use separate sessions. Use `qz session list` to find sessions and `qz session show ID` to read one session's `{sessionId,title,status}`. For an unknown ID, check the ID and browser selection; never invent an ID.

```sh
CREATED=$(qz session create --title "Inspect example page" --json) || exit 1
SID=$(printf '%s' "$CREATED" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!x.ok || !x.result.sessionId) process.exit(1); console.log(x.result.sessionId)') || exit 1
qz script --session "$SID" - <<'JS'
// Open one page and read its relevant text.
await tools.open_tab({ url: "https://example.com", tabAlias: "page" });
return await tools.read_article({ tabRef: "page", limit: 3000 });
JS
```

open_tab, list_tabs and wait_for_popup return Tabs `{tabRef,url,title,active}`. Use the supplied tabAlias or a tabRef returned by those tools; tabAlias is optional. Aliases contain 1–64 letters, digits, underscores or hyphens, not all digits, and expire when the tab closes. Returned positive integers or their numeric strings are also valid tabRef values; never guess one. A supplied alias is preserved in the returned Tab. active marks the tab visible to the user and never selects a tool target. set_page_mode switches between desktop and mobile modes; a change reloads the page, so observe it again afterward.

Page tools always pass tabRef, including each call inside a script. A missing tabRef is TAB_REF_REQUIRED. One tab belongs to one session at a time. Use list_tabs({scope:"all"}) to inspect other web pages; changes require a session-owned page. Do not interrupt another session's owner.

## Scripts and tool discovery

`qz script --session ID [FILE|-] [--args JSON]` reads a local file or stdin. --args accepts a JSON value available as input/args. Use top-level await and return, beginning with a short comment stating the script's purpose. The script runs outside web pages and survives their navigation. It has tools/tool and trace/log, but no document/window, Node.js, fs, process, require or import.

Call tools by their catalog names. Use `tools.list_tools()` for compact signatures, then `tools.list_tools({names:["evaluate","wait_for_navigation"]})` for selected full schemas. Read the relevant schema before using an unfamiliar tool; loaded Skills can add tools.

```sh
qz script --session "$SID" - <<'JS'
// Discover browser tools before choosing a more specialized operation.
return await tools.list_tools();
JS
```

For DOM access, call evaluate with an explicit tabRef. Its code is a self-contained function; pass outer values through args. It returns the function's value. Function closures, browser nodes and functions cannot be carried across pages as arguments or results.

```sh
qz script --session "$SID" --args '{"limit":1000}' - <<'JS'
// Read a compact DOM summary from the page opened earlier.
return await tools.evaluate({
  tabRef: "page",
  code: ({ limit }) => ({ title: document.title, text: document.body.innerText.slice(0, limit) }),
  args: input
});
JS
```

Use ordinary action tools for clicks, forms and navigation. evaluate waits for DOMContentLoaded by default; use waitUntil:"commit" for early page observation. Wait for specific elements or predicates when the task depends on dynamic content. evaluate runs inside the page: navigating or closing that page can interrupt that evaluate call, while the outer script remains available. Do not blindly replay a script after an uncertain result; inspect completed work first.

## Observe, act, and verify

Use read_article for document text. Use a narrow get_ax_tree or find_elements to choose an element. Element identity is target: `uid:t<tab>.<snap>.<n>` or `css:...`; rect is `{x,y,width,height}`. Pass returned targets unchanged to act_on_element, inspect_element, screenshot and wait_for_element. Prefer returned uid: targets; use css: when no uid is available.

find_elements pattern is a regular expression, case-insensitive by default. For literal `a.b`, use the JSON string `"a\\.b"`. get_ax_tree scope is viewport or full; narrow target/limit rather than requesting the whole page for one button. Navigation, reloads and DOM replacement can invalidate uids: read a fresh target after a stale-reference error.

act_on_element performs one action: click, fill, press, select, check, uncheck or scroll. fill/select need value; press needs key. Ordinary success returns `{}`: the action executed, and fill/check verification remains part of execution. It does not prove the application's overall result. If confirmationRequired is returned, verify the indicated field locally before continuing. When the application result matters, read a small relevant region; do not request both a full snapshot and a screenshot by default. Use screenshots when semantic observations are insufficient.

When an action must cause navigation, a popup or a network response, use the corresponding wait tool with a trigger. It installs the listener before executing the trigger once. Supply tabRef on both the wait and its page action. A failed wait does not roll back or repeat the action.

```js
// Follow the next-page link and wait for the navigation it triggers.
const found = await tools.find_elements({ tabRef: "page", pattern: "Next", roles: ["link"], limit: 3 });
return await tools.wait_for_navigation({
  tabRef: "page",
  trigger: {
    name: "act_on_element",
    args: { tabRef: "page", target: found.results[0].target, action: "click" }
  }
});
```

wait_for_navigation observes a new navigation after listening begins, including same-URL reloads and SPA changes; a completed old page cannot satisfy it. wait_for_load waits for the current page load. wait_for_element defaults to visible; use attached when only DOM presence is needed. A body with zero height can contain visible children, so waiting for body visibility is not a page-readiness check. Read the tools' schemas for popup, response and timeout options. Prefer an observable condition to a fixed sleep.

Use await for dependent steps and Promise.all for independent page workflows; each branch continues when its own calls complete. Use Promise.allSettled to collect every outcome. Await tool calls before returning: script exit cancels unfinished calls. Observe the relevant result once. If the next step depends on an unknown target or page state, inspect that result before choosing the action. Scripts are not transactions: completed actions remain completed after a later failure. Return only the business data needed for the task. trace/log and console diagnostics are returned as ordered strings in traces.

## Documents and larger results

For PDFs, load the document Skill before reading: list_skills, then load_skill({name:"qingzhou-documents"}). Follow its tool schemas and use the original PDF URL. PDF viewers do not support ordinary body reads or page actions. Keep the returned fileId/docModelId in this session and follow chunk cursors only as needed. load_skill_resource can load a packaged document directly.

Images and files stay in their artifact stores; return their references. Business results beyond about 48000 characters become `{truncated:true,totalChars,limitChars,preview}`; narrow the read instead of treating the preview as a full value. ToolError is never truncated.

## Output and recovery

stdout is JSON `{traces,result}` on success and failure. traces contains execution messages in order, without levels; result is the returned business value, or null for undefined. Use return for business output and console/trace for progress. A tool failure rejects its awaited call with `{code,message,hint?,details?}`; an uncaught failure puts that error in result. Keep its code, message and recovery guidance. Script locations are in details. Successful scripts exit 0; execution and connection failures exit 1; invalid CLI arguments exit 2.

--timeout sets script execution seconds, defaults to 120, and accepts >0 through 3600. The request waits 60 seconds longer. Give the calling shell a longer deadline. A timeout or interrupted connection does not prove that a browser action was undone; inspect the session and page before repeating it.

- Disconnected: retry with the same session ID; connection preparation is automatic. Use qz connect uri to choose a browser profile.
- DRIVE_SESSION_NOT_FOUND: inspect qz session list and the selected browser.
- DRIVE_SESSION_ENDED: create a new session for a new task.
- DRIVE_SESSION_BUSY: wait for the active script; cancellation remains available separately.
- TAB_REF_REQUIRED: pass an explicit tabRef from open_tab/list_tabs.
- Unknown alias or stale target: inspect existing pages or refresh the element observation.
- Login or challenge: stop and ask the user to finish it in the browser.

## Finish

Run `qz session cancel "$SID"` when the task is done. It ends the session and cleans up its created tabs, including while a script is busy. It preserves pre-existing tabs and tabs handed back to the user. Do not call close_tab after the session ends. Further execution returns DRIVE_SESSION_ENDED.

CLI process exit does not close task tabs. While the extension runtime is running, about 30 minutes of inactivity triggers cleanup. Use session cancel for task cleanup. The side panel for a drive session is view-only. Use browser tools for page content and the shell for local files.
<!-- qz-drive-guide:end -->
