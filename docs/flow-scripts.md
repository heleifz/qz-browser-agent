# Browser flow scripts

`run_flow` combines actions, condition waits and verification in one call across pages or tabs. Its default final viewport snapshot is the next round's starting
view, so that round does not need another observation call for the same state. Page-mode
`run_script` handles bulk DOM extraction and parsing; direct tools expose individual operations.
The controller runs in a Worker outside task pages. Navigation and closing a tab do not unload it.

```javascript
run_flow({
  timeout: 60,
  args: { urls: ["https://example.com/", "https://example.org/"] },
  code: `async () => {
    const tabs = await Promise.all(input.urls.map(url => tools.open_tab({url})));
    return Promise.all(tabs.map(async tab => {
      const read = await tools.run_script({
        tabId: tab.id, target: "page", timeout: 10,
        code: "() => ({title: document.title, url: location.href})"
      });
      await tools.$emit({tabId: tab.id, page: read.result});
      return read.result;
    }));
  }`
})
```

`open_tab` returns `id`. Pass explicit `tabId` to every page call, including calls with a UID.
`tools.run_script` returns an envelope containing `result`, not the evaluated value directly.
Leaf page scripts have DOM and input arguments but no `tools`/`tool` bridge. They may declare
`mutatesPage:true` for local DOM changes; lifecycle actions belong in controller tool calls.

## Comparison with an external Node/Playwright controller

This compares the browser-external scripting model described for ego, not a benchmark of a
particular ego release. qz implements the browser workflow through its existing tools rather
than exposing a second Playwright or filesystem API.

| Capability | External Node/Playwright-style script | qz flow |
| --- | --- | --- |
| Survive page navigation | External process retains script state | Out-of-page Worker retains script state |
| Open/close tabs, parallel work | Browser contexts/pages and promises | `open_tab`, `close_tab`, bounded `Promise.all`; same-tab ordinary calls serialize |
| Loading and future navigation | Navigation/load-state promises | `wait_for_navigation`; `next:true` plus an armed `$watch` for future navigation/reload |
| Element/text waits | Locator/predicate waits | `wait_for_element` with CSS and optional `text` substring; `absent` supports disappearance |
| Network/time waits | Network events, idle checks, timers | `wait_for_response`, `wait_for_network_idle`, `wait`, `wait_until`, Worker timers |
| Snapshot/text/selector/evaluation | DOM/locator reads and `evaluate` | AX snapshots, `read_article`, `read_dom`, `find_elements`, `inspect_element`, leaf page `run_script` |
| Browser interaction | Click/fill/select/keyboard/scroll/hover/drag | Existing core tools, including `act_on_element` and `act_on_screen`; screenshot-coordinate guards remain enforced |
| Upload | Local paths or explicit file buffers | `upload_files` accepts explicit UTF-8/base64 content; local filesystem selection uses `wait_for_user` |
| Screenshots | Image buffers/files | Existing screenshot tool; latest nested image reaches the Agent, separately from final AX state |
| Intermediate results | Console/IPC/checkpoints | `$emit` updates the running tool's transcript result; Data/files provide durable checkpoints |
| Step errors and recovery | Exceptions and explicit recovery | Exceptions with `code/details/observation`, or `$settle` results; page failures include an AX observation |
| Stop/deadline | Cancel task/close process | Script/run AbortSignals revoke calls, cancel watches and terminate the Worker |
| Large results | Files/databases/IPC limits | Bounded arguments/results/progress/trace/artifact summaries; complete data stays in Data/files |
| Host access | Node modules, OS processes and filesystem | No Node, shell, arbitrary OS file access or unguarded browser API |
| Browser portability | Engine-specific automation backends | Shared controller/Worker/protocols; existing Chrome/Firefox host adapters |

The supported surface is the current run's visible core tool registry. `tools.$list()` returns its
schemas. Hidden tools, Skill tools, recursive `run_flow`, and nested inner scripts are excluded.
Normal profile, permission, ownership, URL, UID and resource-concurrency checks still apply.
The flow does not grant a tool that is unavailable to the current run.

## Arm a wait before triggering an action

A passive wait does not occupy the same-tab action queue. `$watch` additionally acknowledges that
the underlying listener is installed before returning its handle:

```javascript
const navigation = await tools.$watch("wait_for_navigation", {
  tabId, next: true, timeout: 10
});
try {
  await tools.act_on_element({tabId, target: nextTarget, action: "click"});
  await navigation.wait();
} finally {
  await navigation.cancel().catch(() => {}); // Already-consumed handles need no cleanup.
}
await tools.wait_for_element({tabId, selector: "#flash", text: "logged out", timeout: 10});
return {done: true}; // run_flow appends the fresh final snapshot automatically.
```

The handle can be consumed once or cancelled with `await navigation.cancel()`. Unconsumed watches
are cancelled when the flow ends. Same-URL reloads and URL-changing same-document navigation are
supported. The default navigation wait only settles current loading: `already_complete` does not
prove that a previous action succeeded. Use text/element conditions for application readiness.

Wait tools opt into this contract with `behavior.flowWait:true` and invoke
`context.flowWaitReady?.()` after their listener/poll is ready. They must clean listeners and timers
on completion, timeout and AbortSignal. Only passive waits may bypass the action queue.

## Recover and publish progress

```javascript
const step = await tools.$settle("act_on_element", {tabId, target, action: "click"});
if (!step.ok) {
  await tools.$emit({stage: "needs-recovery", code: step.code});
  // step.observation describes the failed step's page, or why it was unavailable.
  return {ok: false, code: step.code, observation: step.observation};
}
```

Ordinary calls reject with an Error, so `try/catch` and `Promise.allSettled` also work. `$settle`
returns `{ok:true,result}` or `{ok:false,error,code,details,observation}` without ending the flow.
Recovery must inspect the current state before retrying a potentially delivered action.
A failed serialized action obtains its observation before the next queued action. A failed passive
wait queues its observation separately, avoiding a snapshot in the middle of a tab action.

`$emit(value)` returns a sequenced checkpoint and publishes a run-scoped `tool_execution_update`
with `partialResult`. Transcript projection preserves the running tool's identity and replaces the
partial result on completion. This is progress, not a durable script-resume journal. Persist large
or important intermediate data with the owning Data/file tools and emit their identifiers.

Snapshot lines print both `target=uid:t5493.abcdef.12` and `alias=@abcdef.12`. Either value works
unchanged in `tools.act_on_element({tabId, target, action: "click"})`, including a target from the
previous flow's final snapshot. Aliases require explicit `tabId` and the current Session/tab
snapshot. The token binds the alias to that snapshot rather than rebinding `@12` to a new element.
A newer snapshot (including image snapshots) expires old aliases. Navigation, replaced documents,
TTL expiry and missing registry entries still reject stale references. `uid:12` is not expanded.
Full UIDs continue through the existing Session/tab/document/loader/node checks; a new snapshot
alone does not change those full-UID checks.

## Flow result control

The conversation shows `run_flow` as a compact flow control. Expand it to see nested tool calls in
invocation order, with target, queued/running/settled state, duration and navigation/wait outcomes.
Source, returned values and the final AX observation have independent native disclosures. Long
lists and code scroll within the control. Updates retain disclosure state, row identity, keyboard
focus and manual scroll position. Stop marks unfinished steps as stopped; delivered effects remain.

The controller publishes a versioned `_display.flow` projection, retained with the transcript but
excluded from model messages. It keeps at most 128 steps and reports omitted earlier entries;
active calls remain eligible. Targets use bounded action/selector/URL/condition fields, excluding
fill values, script source and file bodies. Progress updates coalesce within 200 ms; failures
publish immediately. Final host errors retain the last accepted display projection.

The script capability owns the parser, renderer, translations and token-based styles. Historical
script-profile flows route to the same control; records without step data retain a readable result
view. HTML export embeds the compiled skin and static renderer, including native disclosures and
code presentation, with no extension or network dependency. Portable import retains display data.
See [unit coverage](../tests/unit/test-flow-display.mjs) and
[browser coverage](../tests/browser/flow-display.spec.mjs).

## Limits and lifecycle

| Boundary | Limit / behavior |
| --- | --- |
| Pending Worker tool calls | 64 |
| Armed watches | 32; consumed/cancelled on completion |
| Nested arguments | 1,048,576 JSON characters |
| Nested structured result | 262,144 JSON characters; larger results fail with `FLOW_RESULT_TOO_LARGE` |
| Final script value | 65,536 JSON characters; oversized values become an explicit truncated preview and recovery instruction |
| Checkpoints | Latest 16, each 2,048 JSON characters |
| AX observation | get_ax_tree defaults: 120 optional BFS nodes, depth 16, up to 40 guaranteed actions plus ancestors; 16,000 JSON characters, 5 seconds including queue time |
| Worker trace | Latest 80 entries, at most 1,000 characters per message |
| Artifact summaries | At most 64 / 16,384 JSON characters; `artifactsTruncated` signals omitted summaries; resources remain stored |
| Images | Existing normalized image budget: 2 MiB, 2,048-pixel long edge |
| File input | Five files, 512 KiB combined decoded bytes; no OS paths; empty array clears selection |

The final envelope contains the bounded script result, checkpoints and
`finalObservation: {purpose: "next_turn_start", tabId, snapshot}`. `snapshot` is the ordinary
`get_ax_tree` result with URL, title, viewport, scope, snapshot ID and actionable snapshot text.
It defaults to the last-used remaining tab, or the Session's working tab when no page was called.
A snapshot captures the current moment; application readiness comes from explicit conditions.

| run_flow parameter | Default / behavior |
| --- | --- |
| `observe` | `true`; `false` omits the final snapshot but not failure observations |
| `observationTabId` | Explicit owned tab override; normal ownership/permission checks apply |
| `observationScope` | `viewport`; `full` includes offscreen detail within the same budgets |
| `observationRoot` | `root`; a full UID, current alias or `css:` target restricts the subtree |

Final observations use the ordinary `get_ax_tree` path without budget overrides: vertical viewport
filtering, bounded off-screen structure, local/global fold markers, BFS selection and UID/alias
registration are identical. Every retained UID has an alias, including off-screen subtree entries.
Horizontal overflow and unknown geometry remain eligible. This is not pixel-level occlusion or
nested-scroll clipping. See [accessibility snapshots](architecture.md#accessibility-snapshots).

Standalone `get_ax_tree` defaults to `viewport` at the page root and `full` for explicit element
roots (including aliases). A flow explicitly requests `observationScope`, defaulting to `viewport`
even with an element root. A stale root fails instead of falling back to the page. The flow's
separate 16,000-character transport limit may return a marked truncated preview in place of the
structured snapshot.

If no tab remains, or observation is unavailable, the result says so. The five-second observation
deadline includes queue time; Stop does not wait for it. The most recent nested screenshot can
predate the final observation. Other tabs are not automatically snapshotted.

`timeout` is required in seconds; a nonpositive value is unlimited. Stop and timeout revoke the
scope before cleanup, reject queued/future calls and cancel Worker timers and passive watches.
The controller cannot undo browser actions already delivered or forcibly roll back arbitrary
page JavaScript and its timers. Extension restart loses in-memory script state; durable Data/files
can support a new run, but automatic controller resume is not implemented.

Chrome uses native offscreen support. Firefox uses the same sandbox/Worker through its existing
hidden-frame/minimized-window adapter, selected by feature detection. Viewport filtering uses the
same Chromium DOMSnapshot/box-model and Firefox batched-rectangle path as standalone AX reads. No new browser permission
or Firefox-only controller is introduced; full-UID authority checks are unchanged. See [architecture](architecture.md)
and [live test commands](../tests/README.md#real-model-tests) for the implementation and evidence.
