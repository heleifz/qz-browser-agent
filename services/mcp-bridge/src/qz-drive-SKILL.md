---
name: qz-browser-agent
description: Drive the connected browser through qz scripts. Create one titled session per task, pass its sessionId to every script, and use explicit tabRef values for page tools. Read qz skill for the installed CLI's guide. Read references/create-task.md only when the built-in agent should plan the task.
---

Read `qz skill` once at the start of a task to use the guide shipped with the installed CLI. `qz --version` prints its version.

<!-- qz-drive-guide:en -->
The external agent plans the work and drives the connected browser. Do not configure a qz model or call `qz create`. Read references/create-task.md only when the built-in agent should plan and execute the task.

## Connect

Use the installed `qz` command (Node.js 22+) on the machine running the browser extension:

```sh
qz status --json
```

Session and script commands prepare the connection automatically: they reuse a responding online browser, or try installed Chrome, Firefox, and Edge once each within the connection deadline until the extension responds. Complete the extension's first-use notice and connection prompt when shown. If the extension is missing, `qz install` opens the store; ask the user to install it.

When multiple browsers are registered, run `qz browsers --json` and pass `--client CLIENT_UUID` to select a profile explicitly. Existing sessions are located via read-only queries before execution; ambiguous or unavailable ownership requires explicit selection. To pair a specific profile without launching a browser, run `qz connect uri --name work --json` and open `result.url` in that profile. An incompatible local service is restarted once before browser operations; an incompatible extension requires updating the CLI and extension together.

## One task uses one session

Run `qz session create --title "Inspect example page"` first. A readable `--title` is required (omitting it exits 2). stdout prints `sessionId <id>`; with `--json`, read `result.sessionId`. Each call creates a fresh session without starting a model.

Pass that same ID to every `qz script --session ID` call (missing `--session` exits 2). Scripts never create or resume a session implicitly. Use separate sessions for independent tasks. Run `qz session list` to list sessions and `qz session show ID` to read `{sessionId,title,status}`. If an ID is not found, check `qz session list` and the selected browser; never invent an ID.

```sh
CREATED=$(qz session create --title "Inspect example page" --json) || exit 1
SID=$(printf '%s' "$CREATED" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!x.ok || !x.result.sessionId) process.exit(1); console.log(x.result.sessionId)') || exit 1
qz script --session "$SID" - <<'JS'
// Open one page and read its relevant text.
await tools.open_tab({ url: "https://example.com", tabAlias: "page" });
return await tools.read_article({ tabRef: "page", limit: 3000 });
JS
```

`open_tab`, `list_tabs`, and `wait_for_popup` return Tabs `{tabRef,url,title,active}`. Pass the optional `tabAlias` set on `open_tab` or a `tabRef` returned by those tools. Aliases use 1–64 letters, digits, underscores, or hyphens (not all digits), are preserved in the returned Tab, and expire when the tab closes. Returned positive integers or numeric strings are also valid `tabRef` values; never guess one. `active` marks the tab visible to the user and never selects a tool target. `set_page_mode` switches between `desktop` and `mobile` modes; a change reloads the page, so re-observe it afterward.

Page tools always pass tabRef on every call, including inside scripts. Omitting `tabRef` fails with `TAB_REF_REQUIRED`. One tab belongs to one session at a time: use `list_tabs({scope:"all"})` for read-only inspection of other tabs, and use a session-owned tab for actions or evaluation without interrupting another session's owner.

## Scripts and tool discovery

`qz script --session ID [FILE|-] [--args JSON]` runs JavaScript orchestration outside web pages. Read a local file or `-` for stdin; `--args` passes a JSON value exposed as `args`. Use top-level `await` and `return`, starting with a short comment stating the script's purpose. The outer script survives page navigation and provides `args`, `tools`, `trace()`, and `console`, without `document`/`window`, Node.js, `fs`, `process`, `require`, or `import`.

Call tools by their catalog names on `tools`. Run `tools.list_tools()` for compact signatures, and `tools.list_tools({names:["evaluate","wait_for_navigation"]})` for full schemas of selected tools. Read unfamiliar schemas before calling; loaded Skills can register additional tools. Awaited calls (including Skill tools) return business values directly and throw on failure.

```sh
qz script --session "$SID" - <<'JS'
// Discover browser tools before choosing a more specialized operation.
return await tools.list_tools();
JS
```

For in-page DOM or authenticated `fetch` access, call `evaluate` with an explicit `tabRef`. Its `code` must be a self-contained function; pass external values via `args` and return a JSON-serializable value. Closures, DOM nodes, and functions cannot cross the page boundary.

```sh
qz script --session "$SID" --args '{"limit":1000}' - <<'JS'
// Read a compact DOM summary from the page opened earlier.
return await tools.evaluate({
  tabRef: "page",
  code: ({ limit }) => ({ title: document.title, text: document.body.innerText.slice(0, limit) }),
  args
});
JS
```

Use outer action tools for clicks, form input, and navigation. `evaluate` waits for `DOMContentLoaded` by default (`waitUntil:"commit"` allows early observation); wait for specific elements or conditions when reading dynamic content. Navigating or closing the page can interrupt an in-flight `evaluate`; catch its error if the outer script should continue. Do not blindly replay a script after an uncertain outcome; inspect completed state first.

## Observe, act, and verify

Use `read_article` for document text, lists, and tables. Use a scoped `get_ax_tree` or `find_elements` to locate interactive elements. Element identity is `target` (`uid:t<tab>.<snap>.<n>` or `css:...`); `rect` is `{x,y,width,height}`. Pass returned `target` values unchanged to `act_on_element`, `inspect_element`, `screenshot`, and `wait_for_element`. Prefer returned `uid:` targets; use `css:` only when no `uid:` is available.

`find_elements` `pattern` is a case-insensitive regular expression by default (for literal `a.b`, pass `"a\\.b"`). `get_ax_tree` `scope` is `viewport` or `full`; narrow `target` or `limit` instead of requesting the full page for one control. Navigation, reloads, and DOM replacement can invalidate `uid:` targets; re-observe after a stale-reference error.

`act_on_element` performs one action: `click`, `fill`, `press`, `select`, `check`, `uncheck`, or `scroll` (`fill`/`select` require `value`; `press` requires `key`). Ordinary success returns `{}`: delivery and `fill`/`check` verification succeeded, with `navigated`/`url` or `navigationPending` added when navigation is detected. If `confirmationRequired` is true, verify the field locally before continuing. To check resulting page state, read a focused region rather than requesting both a full snapshot and a screenshot; reserve `screenshot` for visual checks.

When an action must cause navigation, a popup, or a network response, pass `trigger:{name,args}` to the corresponding wait tool so it arms the listener before invoking the trigger once. Pass `tabRef` on both the wait call and the trigger action. A failed wait never rolls back or replays the action.

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

`wait_for_navigation` matches only a new navigation after listening starts (including same-URL reloads, SPA transitions, and hash changes); an already-loaded page never satisfies it. `wait_for_load` checks whether the current page load has finished. `wait_for_element` defaults to `visible` (use `attached` for DOM presence; a zero-height `body` can still contain visible children, so do not use `body` visibility as a readiness check). Prefer observable conditions over fixed sleeps.

Use `await` for sequential dependencies and `Promise.all` for independent page workflows. Each branch opens and operates on its own tab without waiting on slower branches, while same-page actions stay serialized. `Promise.all` preserves input order and rejects on the first failure without cancelling siblings; use `Promise.allSettled` when every outcome is needed. Await all tool calls before returning: script exit cancels unfinished calls.

```sh
qz script --session "$SID" - <<'JS'
// Open and read each page independently.
return await Promise.all(
  ["https://example.com", "https://example.org"].map(async url => {
    const { tabRef } = await tools.open_tab({ url });
    return await tools.read_article({ tabRef, limit: 1500 });
  })
);
JS
```

Observe the relevant result once and inspect unknown targets or page state before deciding the next action. Scripts are not transactions: completed actions remain in effect after a later failure. Return only the business data needed for the task. Use `trace()` at key checkpoints (such as completed stages and counts) to aid recovery. `trace` contains only errors and explicit `trace()`/`console` output, in order.

## Documents and larger results

For PDFs, load the document Skill before reading: call `list_skills`, then `load_skill({name:"qingzhou-documents"})`, and follow its schemas using the original PDF URL. PDF viewers do not support ordinary body reads or element actions. Keep returned `fileId`/`docModelId` values within the session and follow chunk cursors only as needed. `load_skill_resource` parses packaged documents directly.

Images and files remain in their artifact stores; return their references. Business results exceeding ~48,000 characters become `{truncated:true,totalChars,limitChars,preview}`; narrow the query or paginate instead of treating `preview` as complete. `ToolError` is never truncated.

## Output and recovery

stdout is JSON `{ok,result,trace}` on success and failure. `ok` reports execution success; `result` is the returned business value (`null` for `undefined`) or the uncaught `{code,message,hint?,details?}` error (with script line/column in `details`); `trace` lists errors and explicit `trace()`/`console` messages in order, without levels. Exit codes: `0` success, `1` execution or connection failure, `2` invalid CLI arguments.

`--timeout` sets script execution seconds (default `120`, range `>0` through `3600`); the request waits 60 seconds longer. Give the calling shell a longer deadline. A timeout or interrupted connection does not undo browser actions; inspect the session and page before repeating an action.

- Disconnected: retry with the same `--session ID`; connection preparation is automatic. Use `qz connect uri` to pair a specific browser profile.
- `DRIVE_SESSION_NOT_FOUND`: check `qz session list` and `--client`.
- `DRIVE_SESSION_ENDED`: create a new session for a new task.
- `DRIVE_SESSION_BUSY`: wait for the active script to finish, or cancel the session separately.
- `TAB_REF_REQUIRED`: pass an explicit `tabRef` from `open_tab` or `list_tabs`.
- Unknown alias or stale target: inspect `list_tabs` or refresh the element observation.
- Login or challenge: stop and ask the user to complete it in the browser.

## Finish

Run `qz session cancel "$SID"` when the task is done. It ends the session and closes its created tabs (including while a script is running), while preserving pre-existing user tabs and tabs handed back to the user. Do not call `close_tab` after the session ends; further calls return `DRIVE_SESSION_ENDED`.

CLI process exit does not close task tabs; ~30 minutes of inactivity triggers cleanup while the extension runtime is running. Always run `qz session cancel` for task cleanup. The side panel for a drive session is view-only. Use browser tools for page content and the shell for local files.
<!-- qz-drive-guide:end -->
