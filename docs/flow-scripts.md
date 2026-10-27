# Browser flow scripts

Use `run_flow` for multi-step browser operations, navigation, multiple tabs and batch collection.
The Agent's system prompt prefers it for these tasks; a single action or read can use a direct tool.
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
await tools.act_on_element({tabId, target: nextTarget, action: "click"});
const loaded = await navigation.wait();
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

Full UIDs are passed unchanged to the existing element runtime. This branch does not introduce
short aliases: incomplete UIDs fail rather than being expanded. A stale full UID after navigation
also fails. No alias from a previous snapshot can acquire authority through a flow.

## Limits and lifecycle

| Boundary | Limit / behavior |
| --- | --- |
| Pending Worker tool calls | 64 |
| Armed watches | 32; consumed/cancelled on completion |
| Nested arguments | 1,048,576 JSON characters |
| Nested structured result | 262,144 JSON characters; larger results fail with `FLOW_RESULT_TOO_LARGE` |
| Final script value | 65,536 JSON characters; oversized values become an explicit truncated preview and recovery instruction |
| Checkpoints | Latest 16, each 2,048 JSON characters |
| AX observation | 40 nodes, depth 8, 16,000 JSON characters, 5-second host deadline |
| Worker trace | Latest 80 entries, at most 1,000 characters per message |
| Artifact summaries | At most 64 / 16,384 JSON characters; `artifactsTruncated` signals omitted summaries; resources remain stored |
| Images | Existing normalized image budget: 2 MiB, 2,048-pixel long edge |
| File input | Five files, 512 KiB combined decoded bytes; no OS paths; empty array clears selection |

The final envelope contains the bounded script result, checkpoints and `finalObservation` for the
last-used remaining tab. If no tab remains, or observation is unavailable, the result says so.
The most recent nested screenshot can predate the final observation. Request other tab summaries
explicitly when they matter.

`timeout` is required in seconds; a nonpositive value is unlimited. Stop and timeout revoke the
scope before cleanup, reject queued/future calls and cancel Worker timers and passive watches.
The controller cannot undo browser actions already delivered or forcibly roll back arbitrary
page JavaScript and its timers. Extension restart loses in-memory script state; durable Data/files
can support a new run, but automatic controller resume is not implemented.

Chrome uses native offscreen support. Firefox uses the same sandbox/Worker through its existing
hidden-frame/minimized-window adapter, selected by feature detection. No new browser permission,
UID interpretation or Firefox-only controller is introduced. See [architecture](architecture.md)
and [live test commands](../tests/README.md#real-model-tests) for the implementation and evidence.
