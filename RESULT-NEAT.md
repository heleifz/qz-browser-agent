# Neatness audit: MOSTLY

Reviewed `da46c658a2b845fc4fa130d892824dcbe1fcddda` on
`autofix/merge-pending-astra-neat` against `origin/main`
(`242453292cd5d84fc16a055209ebe5e78214e868`). Initial worktree was clean.
Read the prior `RESULT.md` before tracing the scoped additions and their tests.
This verdict was recorded before editing application code.

## Answer

**MOSTLY**, not an unqualified YES. The new state mostly represents real distinctions:
a user decision versus browser acknowledgement; a cancelled command lease versus narrowly
permitted cleanup; and an incoming Skill name versus its stored identity. Removing those
entities would reopen the failures documented in the prior review.

Two smaller pieces were unnecessary: defensive branches in a private, single-caller Skill-ID
helper, and duplicated guard/debugger composition in the page action wrappers. The minimal pass
removed those without redesigning the state owners or changing product behavior.

## Entity audit

Source paths below are relative to `src/`.

| Entity / location | Assessment and disposition |
| --- | --- |
| `waitTurns` / `reserveWait` in `background/tools/javascript-dialog.ts` | Keep. One promise tail per Session/run serializes only dialog decisions against the supervisor's single wait slot. It does not serialize independent page work or other Sessions. Removing it would turn a parallel dialog into a conflict/dismissal. Release is idempotent and removes the completed tail. |
| `PendingDialog`, `pendingDialogs`, and local `chain` | Keep. Records retain child-session identity, native-close outcome, exact wait settlement, deadline release, and one-shot dismissal. The chain orders handling/draining within an action; the array also reaches dialogs cancelled before their handler installs a wait. Neither replaces the cross-action Session queue. |
| Guard controller, `failure`, `underlying`/`guarded`/`send`, and `drain` | Keep. A blocked browser command must still lose to cancellation/detachment. Raw sends answer dialogs without waiting on their own handler; wrapped sends drain dialog handling before subsequent input. Binding preserves child-session routing and arms observation before dispatch. These are lifecycle boundaries, not a general event framework. |
| `dialogDismissals` WeakMap / `dismissJavaScriptDialog` in `background/tools/cdp-runtime.ts` | Keep. Original function identity is private cleanup authority. Normal send rejects after cancellation; cleanup may only decline on the captured connection/Session/run, without reattaching. Copied send properties do not copy this authority, and weak keys need no second disposal registry. A public method/property would broaden that authority. |
| `pageDialogRuntime` and `pauseDeadline` wiring in `background/tools/runtime.ts` | Keep. One handler instance shares dialog wait turns across calls; each tool owns its deadline. The pause counter supports overlapping pending dialogs and idempotent releases, while cancellation remains active. There is no second runtime state owner here. |
| `runPageDebugger` / `runPageDebuggerValue` in `capabilities/page/tools.ts` | Collapse duplicated binding, not the two result-use cases. Click/press attach receipts after later result construction; fill/check/select return a result from inside the debugger scope. Make the value wrapper delegate to a generic common wrapper. Remove the indirect `Awaited<ReturnType<...>>` annotation through inference. |
| `contentAction` for select | Keep. It constructs the existing Content result once; select invokes it only after the guard is bound. Moving selection out of the guard or adding a fallback retry would restore blocked replies or replay risk. |
| `imported`, reconciled `rows`, `expectedKey`, and `readSet` in `background/skills/skill-workspace.ts` | Keep. Incoming names key the caller's optimistic expectations; reconciled names select stored records. Both identities belong in the read set. Collapsing them loses stale-write checks for direct callers that still submit the new hashed name. |
| `preserveStoredSkillId` and its UI/Background/import callers | Keep one shared policy. UI reconciliation happens before overwrite confirmation; Background repeats it against its authoritative snapshot. Git candidates are restricted to that source. Exact ID wins; only an unambiguous display-name match adopts a legacy ID. A shared prefix alone is not identity. Repeated normalization is a modest boundary cost, not a reason to introduce an identity cache. |
| Pre/post-reconciliation duplicate and builtin checks in Git/page imports | Keep. Raw duplicate input must be rejected before reconciliation can separate it, and different incoming IDs can collapse afterward. These checks apply at different stages and retain source-specific errors. |
| `agentSkillNameWithDisambiguator` in `shared/skills/skill-utils.ts` | Remove. Its only caller already supplies a nonempty normalized ASCII slug and a 32-bit base-36 hash (1–7 characters). Re-slugging, multiple validity checks, minimum-stem handling, and fallback IDs cannot contribute for those inputs. Inline suffix-budgeted truncation in `toAgentSkillName`; preserve the full hash and exact IDs. |
| `clearStaleOptionDisabled` in `capabilities/accessibility/tools.ts` | Keep. One helper is used for main and child documents with their own senders. Candidate filtering avoids all probe calls when unnecessary; one object group bounds remote-object cleanup. Strict false removes only stale disabled flags; failures preserve AX data. No node cache, parallel probe scheduler, or generalized AX repair layer is needed. Leave its reviewed predicate untouched. |
| Scheduler / tab-batch / behavior declarations | No net changes in `tool-scheduler.ts`, `tab-batch.ts`, or the behavior contract versus this baseline. Skimmed Agent consumers and plugin resolution too. Execution dependencies, ordered commits, provisional results versus published ownership, and plugin barriers have actual consumers; do not remove them under a net-new-complexity audit. |

## Changes

`71e9e3b5012be0574cffa16a8abd25d98a798ff2` — `refactor: simplify skill IDs and page dialog composition`

- **Skill IDs:** before, `toAgentSkillName` passed an already-normalized slug through a second
  helper with redundant normalization and fallback repairs. After, it reserves the hash suffix,
  truncates the nonempty slug, trims a trailing hyphen, and returns the ID directly. Removed the
  private helper; no storage format or ID policy changed.
- **Page actions:** before, two wrappers independently composed the same guard, debugger lease,
  and awaited binding. After, `runPageDebuggerValue` delegates to generic `runPageDebugger`;
  click/press extract its receipts explicitly. Guard ordering, result attachment, and no-replay
  behavior remain the same.
- **Tests:** retained all existing tests and added eight exact-ID assertions covering empty input,
  punctuation, Unicode, normalized/empty/long fallbacks, and truncation at a hyphen. Expected IDs
  were sampled from the pre-edit implementation.
- Application source: **12 lines added, 33 removed (net −21)** across two files. No new module,
  runtime type, map, WeakMap, queue, or framework. No changes to dialog lifecycle/CDP authority,
  Skill workspace concurrency, AX correction, or scheduling.

The source commit was pushed with `git push -u origin HEAD` (PASS;
`/tmp/astra-neat-push-source.log`). This report follows in a documentation-only commit.
Author and Committer: `Lei He <heleifz@icloud.com>`. English messages, no trailers.
No main update, force push, PR, tag, release, or user-browser operation.

## Commands run

Node `v24.22.0`. All checks below passed; no failed test run was retried.

| Command | Result / log |
| --- | --- |
| `npm ci` | PASS — `/tmp/astra-neat-npm-ci.log`. Existing dependency audit reported 6 moderate / 5 high vulnerabilities and an esbuild install-script approval warning; no dependency edits. |
| `npm run typecheck` | PASS, all four configurations — `/tmp/astra-neat-typecheck.log`. |
| `npm test -- unit --match skill-identity` | PASS — `/tmp/astra-neat-unit-skill-identity.log`. |
| `npm test -- unit --match skill-workspace` | PASS — `/tmp/astra-neat-unit-skill-workspace.log`. |
| `npm test -- unit --match git-skill-source-service` | PASS — `/tmp/astra-neat-unit-git-skill-source-service.log`. |
| `npm test -- unit --match page-skill-importer` | PASS — `/tmp/astra-neat-unit-page-skill-importer.log`. |
| `npm test -- unit --match element-actions` | PASS, 30 tests — `/tmp/astra-neat-unit-element-actions.log`. |
| `npm test -- unit --match javascript-dialog` | PASS, 19 tests — `/tmp/astra-neat-unit-javascript-dialog.log`. |
| `npm test -- unit --match cdp-runtime` | PASS — `/tmp/astra-neat-unit-cdp-runtime.log`. |
| `npm test -- playwright iframe-offscreen-click.spec.mjs --workers 1` | PASS, one combined Chromium scenario — `/tmp/astra-neat-browser.log`. Covers iframe clicks, click/press/select dialog receipts, native answers, sequential/child dialogs, and abort cleanup. |
| `git diff --check`, scoped diff and final status review | PASS. |

No full suite, coverage, live-provider, Firefox browser/package, or separate AX/scheduler test run.
The Firefox native-only guard is covered by the dialog units. The unchanged AX and scheduler code
was inspected, not represented as newly tested.

## Preserved behavior and residuals

Unchanged decisions: Chrome has no human-response timeout or auto-accept; browser acknowledgement
still has the remaining tool deadline. Firefox remains native-only. #39 remains remove-only.
Parallel execution retains semantic-serial ordered publication and plugin barriers.

Borderline residuals are the two page result adapters and repeated import normalization. Keep
them for their current consumers; reconsider only if those consumers or boundary contracts change.
There is no proposed framework, cache, queue consolidation, or taste-only rename backlog.
