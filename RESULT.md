# Re-review result: PASS

## Neatness audit: MOSTLY

The scoped merge-pending additions are mostly justified by concrete lifecycle and compatibility
requirements. Commit `71e9e3b` removes two small exceptions: the single-use Skill-ID suffix helper's
redundant normalization and unreachable fallback branches, and duplicated guard/debugger binding
in the page action wrappers. The dialog wait queue, private dismissal WeakMap, legacy-ID reconciliation,
and remove-only AX probe remain justified. See [RESULT-NEAT.md](RESULT-NEAT.md) for the entity audit,
minimal changes, commit references, and validation. The prior product/re-review record follows unchanged.

Reviewed the complete net diff `origin/main...8ee0c64` (43 files), then the fixes below,
on `autofix/merge-pending-astra-review-2` in `/workspace/mp-astra-review-2`.
Baseline: `242453292cd5d84fc16a055209ebe5e78214e868`.
Traced the affected runtime, CDP leases, Session waits, scheduler/ordered commits,
UID/frame routing, AX correction, usage codec, image persistence, and Skill import owners.

All confirmed high/medium findings below are fixed. No confirmed must-fix remains.

## Must-fix findings and fixes

| Severity | Finding | Fix / evidence |
| --- | --- | --- |
| High | Native Chrome answers and debugger detachment left a sidebar wait pending with its deadline suspended. | Consume matching dialog-close events, retire the exact wait without answering twice, and cancel waits on detach. Unit and real Chromium coverage include sequential dialogs and child frames. |
| High | Stop attempted dialog dismissal through a CDP sender that rejects commands after cancellation, leaving the native modal open on a retained connection. | Private, decline-only cleanup is bound to the original sender, connection, Session and run. It cannot reattach, accept, use a copied sender, or affect a newer run/reconnected target. Tests cover production CDP lease checks, queued cancellation and real browser abort. |
| Medium | Parallel dialogs in one Session treated the second decision as a conflict and automatically dismissed its page dialog. | Queue dialog decisions per Session/run, suspending queued deadlines. Cancellation preserves the preceding wait; independent Sessions remain concurrent. |
| Medium | The deadline remained suspended while waiting for the browser to acknowledge the user's answer. A stalled acknowledgement could hang forever. | Resume the remaining tool deadline as soon as the user responds. Controlled-clock test distinguishes unbounded human time from bounded browser acknowledgement. |
| Medium | `select` dispatched change handlers outside the dialog guard. A native dialog could block Content without a sidebar card. | Arm the guard before selection, preserve receipts and avoid replay. Unit and Chromium selection-dialog tests pass. |
| Medium | Local ZIP/directory imports omitted legacy Skill-ID reconciliation, silently creating a second hashed ID instead of confirming an overwrite. | Reconcile before UI confirmation and again at the Background owner. Preserve optimistic expectations, original creation time, duplicate rejection and unrelated prefix identities. Unit and browser overwrite/cancel tests pass. |
| High | The new AX option-disabled predicate had no exact reviewed fingerprint, blocking the production build. | Reviewed and admitted only that function at its bounded output paths. Mutation, extra-call and wrong-path tests still reject unreviewed execution. Production build and audit pass. |

## SHAs changed

- `9d1894b` — preserve dialog waits across cancellation and parallel actions.
- `50db3ea` — preserve legacy Skill identities on local re-import.
- `1824655` — approve the reviewed AX disabled-state probe.
- This report is committed separately after those source fixes.

All review commits use Author and Committer `Lei He <heleifz@icloud.com>` with English
messages and no trailers. Source fixes were pushed with `git push -u origin HEAD`;
the report commit follows on the same branch. No force push, main update, PR, tag,
release upload or user-session operation was performed.

## Left alone

- Chrome waits have no human-response timeout and never auto-accept. Cancel/Stay remains
  a page response, not task cancellation.
- Firefox retains native dialogs: no shim, busy loop, agent dialog click, wait card or receipt.
- #39 remains restricted to already-disabled option/optgroup nodes, `resolveNode`, the
  prescribed `matches(':disabled') || closest(...)` predicate, remove-only correction,
  object-group release, and each iframe's own sender. Only its audit registration changed.
- Parallel tool planning, semantic ordering, execution lanes, ordered publication,
  behavior declarations and plugin barriers remain intact.
- UID/tab identity, iframe viewport click behavior, viewport-slim AX output and display-only
  StaticText targeting were not redesigned. Focused regression checks passed.
- Usage aggregation and durable image persistence were retained; focused codec, usage,
  image storage/read/sweep tests passed. Missing historical provider usage/cost is not invented.

## Nice-to-have / residual risks

- No live-provider, headed native-dialog, Firefox package/browser, full release, full-suite
  or coverage run was performed. Firefox adapter units and the native-only guard test passed.
- Dialog observation remains scoped to an active guarded action; dialogs opening after
  that scope ends are not covered by these fixes.
- Usage is derived from recorded calls/transcripts, not an independent billing ledger.
- Code-audit approval is narrowly scoped source review, not a guarantee of store approval.
- Pure style nits and broader refactors were deliberately skipped.

## Needs user preview

No system prompt, tool description, sidebar copy or model-facing error text was changed
by these review fixes. The following inherited merge changes still merit product preview:

- `src/capabilities/page/tool-messages.ts`: English/Chinese `actOnElementDescription`
  explaining Chrome sidebar decisions versus Firefox native dialogs and dialog receipts.
- `src/shared/javascript-dialog.ts` and
  `src/sidepanel/features/chat/transcript/waiting-card.ts`: page-dialog labels, prompt input,
  OK/Cancel and Leave/Stay presentation.
- `src/background/session/user-input.ts`: external-client instructions and prompt response templates.
- `services/mcp-bridge/src/catalog.json`: cumulative usage in the snapshot tool description.

## Commands run and results

Node `v24.22.0`; dependencies installed from the lockfile.

| Command/check | Result / evidence |
| --- | --- |
| `git status --short`, branch/tip/base checks, `git diff origin/main...HEAD` by source/test groups, final diff review | Initial tree clean; expected branch/base/tip; complete net change reviewed. |
| `npm ci` | PASS — `/tmp/astra-review-npm-ci.log`. |
| `npm run typecheck` | PASS, all four runtime/test configurations — `/tmp/astra-review-typecheck-final4.log`. |
| `npm test -- unit --match <area>` individually for `javascript-dialog`, `element-actions`, `skill-workspace`, `skill-identity`, `session-usage`, `tool-runtime-partials`, `session-user-input`, `git-skill-source-service`, `page-skill-importer`, `ax-option-disabled`, `tool-dataflow`, `agent-tool-scheduler`, `tool-behavior`, `session-image` | All PASS — `/tmp/astra-review-unit-focused.log`. Latest dialog changes: 19/19 PASS in `/tmp/astra-review-dialog-final4.log`. |
| `npm test -- unit --match cdp-runtime` | PASS — `/tmp/astra-review-cdp-final.log`. |
| `npm test -- unit --match firefox` | PASS — `/tmp/astra-review-firefox-unit.log`. |
| `npm test -- unit --match reviewable-code` | PASS, including predicate/path/extra-call mutations — `/tmp/astra-review-reviewable-code.log`. |
| `npm test -- contracts` | PASS, 28 contract checks — `/tmp/astra-review-contracts.log`. |
| `npm test -- playwright iframe-offscreen-click.spec.mjs skill-workspace-races.spec.mjs waiting-card.spec.mjs ax-option-disabled.spec.mjs --workers 2` | PASS, 44 tests — `/tmp/astra-review-browser.log`. Includes light/dark wait-card fixtures. |
| `npm test -- playwright iframe-offscreen-click.spec.mjs --workers 1` after subsequent dialog changes | PASS — latest `/tmp/astra-review-dialog-browser-final3.log`; native answers, sequential/child dialogs, selection, abort and iframe clicks. |
| `node scripts/build-extension.mjs --mode production` | PASS, 103 files — `/tmp/astra-review-build-final.log`. |
| `node scripts/check-reviewable-code.mjs dist/extension` | PASS, 42 JavaScript files including embedded scripts — `/tmp/astra-review-code-audit-final.log`. |
| `git diff --check` | PASS. |
| `git push -u origin HEAD` | PASS for the three source-fix commits — `/tmp/astra-review-push.log`; repeated after committing this report. |

Earlier attempts retained for transparency: the initial typecheck caught an optional resolver
invocation (fixed); a regex-style `--match` selected no tests (the runner uses substring matching,
so the focused selectors above were run individually); the initial production build failed on the
missing AX fingerprint (fixed and verified). Relevant logs: `/tmp/astra-review-typecheck.log`,
`/tmp/astra-review-unit.log`, `/tmp/astra-review-build.log`.
