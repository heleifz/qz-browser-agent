# Firefox packaging

Status: proposal for review at `f6446e5`. This page describes the convention to adopt. It adds no
script, no workflow, and no package output. Chrome remains the default build. The skin and palette
stay as they are.

Related pages keep their current jobs. [Commands](commands.md) lists the commands that exist today.
[Firefox differences from Chrome](firefox-differences.md) lists behavior a person can observe.
[Firefox capability gap](firefox-capability-gap.md) records the API survey. This page owns how the
two packages are separated.

## Decision

The browser is a build-time package target. `chrome` is the default. `firefox` is the other target.
One source tree emits one package per target.

| Axis | Selector | What it chooses |
| --- | --- | --- |
| Browser | `--browser chrome\|firefox` on [build-extension.mjs](../scripts/build-extension.mjs) | Output directory, which sources are emitted, manifest, sidebar document, sidebar skin, locale supplements |
| Product | `--product`, read by [product-profile.mjs](../scripts/product-profile.mjs) | Composition facades under `src/products/`. The default product is `public` |
| Sentence | `productText` in [product-text.ts](../src/shared/product-text.ts) | One of two strings already compiled into a shared module, chosen when that module runs |

The product axis and the browser axis compose. `npm run build -- --product public --browser firefox`
is a Firefox package of the public product. A product facade stays free of host branches. Host
behavior belongs to the Firefox adapter or to `productText`.

Edge loads the Chrome package. There is no `--browser edge` target.

`esbuild` `target: "chrome114"` is the JavaScript language floor for both packages. It is not the
browser target.

## What the build owns

`prepareBuild` accepts `chrome` or `firefox` and defaults to `chrome`. The default output is
`dist/extension/`. The Firefox output is `dist/extension-firefox/`. `--output-dir` overrides either
default. The two directories can be watched at the same time because each watcher locks its own
output.

For `firefox`, [firefox-manifest.mjs](../scripts/firefox-manifest.mjs) runs after the shared compile
and rewrites only that output:

| Rewrite | Result in `dist/extension-firefox/` |
| --- | --- |
| `firefoxManifest` | Drops `key` and `side_panel`. Drops `debugger`, `desktopCapture`, `offscreen`, and `sidePanel`. Adds `webNavigation`, `webRequest`, and `webRequestBlocking`. Sets `sidebar_action`, moves the suggested key to `_execute_sidebar_action`, and sets `background.scripts` to `background/firefox-boot.js` while keeping `service_worker` for the shared validators. Sets `browser_specific_settings.gecko`. |
| `rewriteFirefoxSidepanelHtml` | The sidebar document loads `firefox-boot.js` and `firefox-sidebar.css`. |
| `writeFirefoxSidebarSkin` | Writes `sidepanel/firefox-sidebar.css`. That file has no twin under `src/`. |
| `rewriteFirefoxLocaleFiles` | Rewrites catalog sentences in the Firefox copy. `src/` locale sources stay on the Chrome wording. |

`src/manifest.json` stays the Chrome manifest. The Chrome output manifest matches it.

## What runtime code owns

Runtime detection chooses a sentence inside a package that the build already selected. It does not
choose permissions, entry points, or which files exist.

`firefoxExtension()` is true when `chrome.runtime.getURL("")` starts with `moz-extension:`.
`productText(chromeText, firefoxText)` returns the matching sentence. Both sentences ship in every
package, because the shared module ships in both. Use it for inline strings in shared modules.
Catalog copy that should exist in only one package goes through the locale rewrite above, so the
Chrome catalog keeps the Chrome sentence alone.

Firefox API stand-ins install from the boot modules, which run before the shared graph:

- [background/firefox-boot.ts](../src/background/firefox-boot.ts) imports `background/firefox/host.ts`, then `background/service-worker.ts`.
- [sidepanel/firefox-boot.ts](../src/sidepanel/firefox-boot.ts) imports `sidepanel/firefox/host.ts`, then `sidepanel/sidepanel.ts`.

`installFirefoxHost` patches `sidebarAction`, notifications, offscreen, debugger, and network
hooks on the `chrome` object, then the shared service worker reads that object. The side panel
host does the same for display capture, extension-page URLs, and the sidebar palette. The
`qzFirefoxHost` and `qzFirefoxSidepanel` flags make that install run once. They are not a second
browser switch.

A runtime flag cannot be the package boundary. Firefox rejects unknown permission names at install,
and the entry script is fixed by the manifest. One manifest cannot be the Chrome package and the
Firefox package. A flag read after startup can change a sentence or patch an API the package was
allowed to call. It cannot take `sidePanel` out of a package Firefox has already refused to load,
and it cannot keep Firefox boot code out of the Chrome zip.

## Source layout

Host adapters live in these trees:

```text
src/background/firefox-boot.ts
src/background/firefox/**
src/sidepanel/firefox-boot.ts
src/sidepanel/firefox/**
```

`isFirefoxOnlySource` is that set. The Chrome compile drops those paths. The Firefox compile emits
them plus the shared graph.

Shared extension modules leave those paths alone. The boot files are the extension importers.
Tests may import the adapters directly. A new Firefox-only module is imported from
`background/firefox/host.ts` or `sidepanel/firefox/host.ts`, which the matching boot file already
loads.

The shared graph is the program both packages run. The Firefox package includes it on purpose:
the adapters wrap `chrome.*`, and the service worker and side panel stay the callers. There is no
Chrome-only source tree. A file with no Firefox caller would need a matching exclusion predicate
on the Firefox compile. No such file exists in this tree, so the predicate is not added here.

Generated files that differ by target are written by the Firefox build step into the Firefox
output. They are not committed under `src/`, so the Chrome copy step never sees them.

`src/products/` stays a product axis. `readProductProfile` selects facades whose paths match
`{background,shared,sidepanel}/product/*.ts` and whose implementations live under
`src/products/<product>/`. Browser packaging does not read or write those ports.

### Dead weight

| Package | What it contains | What stays out |
| --- | --- | --- |
| `dist/extension/` | Shared sources, Chrome manifest, Chrome locales | Paths matched by `isFirefoxOnlySource`. The generated sidebar skin. Rewritten Firefox locales |
| `dist/extension-firefox/` | Shared sources, Firefox boot modules, rewritten manifest, generated skin, rewritten locales | `key`, `side_panel`, and the permission names Firefox rejects |

The path filter decides which files are copied and which modules are esbuild entries. esbuild still
follows imports from disk. A shared module that imports `firefox/` would pull that module into the
Chrome bundle even though the path filter dropped it from the entry list. Closing that gap is an
implementation step below. Today the boot files are the only extension importers, which the Firefox
host unit test reads as source text.

## Commands that exist today

These commands already implement the target. New script names in the next section are proposed and
are not in `package.json`.

| Command | Target | Output |
| --- | --- | --- |
| `npm run dev` | `chrome` | Watches `dist/extension/` |
| `npm run build` | `chrome`, production, typecheck | `dist/extension/` |
| `npm run dev -- --browser firefox` | `firefox` | Watches `dist/extension-firefox/` |
| `npm run build -- --browser firefox` | `firefox`, production, typecheck | `dist/extension-firefox/` |
| `npm run verify:quick` | Chrome suites | Loads `dist/extension/`. Does not launch Firefox |
| `npm run verify:firefox` | Firefox suite | Builds `dist/extension-firefox/` in development mode, then runs `tests/unit/test-firefox-*.mjs` and Firefox Playwright |
| `npm test -- firefox` | Firefox suite | Same suite as `verify:firefox` without the leading typecheck |
| `npm run release` | `chrome` | `dist/releases/<version>/qz-browser-agent-extension-<version>.zip` |

`npm run verify:firefox` rebuilds the Firefox directory unless `QINGZHOU_FIREFOX_EXTENSION_DIR` is
set. A shell that exports that variable tests the directory as it stands, including a production
build left by `npm run build -- --browser firefox`. Leave the variable unset for the suite's own
development build.

Typecheck is repository-wide. `npm run build` and `npm run verify:quick` typecheck Firefox sources
even though they emit the Chrome package. One TypeScript program covers both targets. Emit stays
per target.

## Proposed commands

Add these after this proposal is accepted. Each one is a name for a flag the build already has, or
a release path that does not exist yet. `npm run build` and `npm run release` stay Chrome.

| Script | Invokes | Result |
| --- | --- | --- |
| `build:firefox` | `node scripts/build-extension.mjs --mode production --typecheck --browser firefox` | Production package in `dist/extension-firefox/`. Leaves `dist/extension/` untouched |
| `dev:firefox` | `node scripts/build-extension.mjs --watch --browser firefox` | Watcher for `dist/extension-firefox/` |
| `release:firefox` | `python3 scripts/publish-release.py --browser firefox` | Local unsigned archive described below. No upload, no tag |

`npm run build:firefox -- --no-bundle` forwards the extra build flag. `--browser` remains the
switch that product and browser flags share, so a product build can still pass both.

## Release artifacts

Chrome packaging stays on [publish-release.py](../scripts/publish-release.py). With no browser
flag it compiles `chrome`, writes `qz-browser-agent-extension-<version>.zip`, and uses
`--target webstore` for `qz-browser-agent-extension-<version>.webstore.zip`. The manual zip keeps
the public `key`. The webstore zip removes `key`. That `key` fixes the unpacked Chrome id
`ghbaodmonhcgkfeejcpffknlggbjhjgj`.

The Firefox archive is a separate directory and a separate file:

```text
dist/releases/<version>/firefox/qz-browser-agent-firefox-<version>.xpi
dist/releases/<version>/firefox/qz-browser-agent-firefox-<version>.debug.zip
dist/releases/<version>/firefox/version.json
```

The `.xpi` is a zip with `manifest.json` at the archive root, which is the layout Add-ons Manager
and a temporary file install both accept. It has no folder wrapper and no `key`. Its
`version.json` records `browser: "firefox"` and `geckoId`. The debug zip stays local, as the Chrome
debug zip does. The version number is the same `manifest.version` as the Chrome archive of that
commit. The stores do not share an update channel.

### Identifiers

| | Chrome | Firefox |
| --- | --- | --- |
| Id | `ghbaodmonhcgkfeejcpffknlggbjhjgj`, from `key` | `qz-browser-agent@heleifz.github.io`, from `browser_specific_settings.gecko.id` |
| Where it is set | `src/manifest.json` | `FIREFOX_GECKO_ID` in `firefox-manifest.mjs`, applied only to the Firefox output |
| Minimum browser | Chrome's own | `strict_min_version` `139.0` |
| Data collection | Chrome Web Store form | `websiteContent` required; `locationInfo`, `browsingActivity`, `bookmarksInfo` optional. `none` is not declared |

The ids are independent. `runtime.id`, `storage.local`, and update URLs belong to the browser that
loaded the package. The Firefox build deletes `key` so the Chrome id mechanism is absent from the
Firefox manifest. The gecko id is provisional until the first signed upload. A later change of that
id splits stored data and the Add-ons Manager identity. Temporary builds keep this id so profiles
created during development match the eventual listing.

## Developer workflow

CI already runs the two targets as two jobs in [ci.yml](../.github/workflows/ci.yml). The portable
job builds `dist/extension/` and runs focused Chromium contracts on Linux, macOS, and Windows. The
`firefox-package` job runs `npm run verify:firefox` on Linux. That split matches this proposal. A
matrix cell on the portable job would rebuild Chrome on each OS and still need a Linux Firefox
install, so the Firefox gate stays its own job.

Local checks follow the files in the change.

| Change | Local check |
| --- | --- |
| Shared runtime, manifest, locales, content scripts, or `scripts/build-extension.mjs` | `npm run verify:quick` with `QINGZHOU_PLAYWRIGHT_WORKERS` set, and `npm run verify:firefox`. The Firefox package compiles the shared graph |
| Firefox-only trees, `scripts/firefox-manifest.mjs`, `tests/firefox/**`, `tests/unit/test-firefox-*.mjs`, Firefox docs | `npm run verify:firefox`. The Chrome package's file set does not include those sources |
| Product facades under `src/products/` | The same shared-runtime row. Product selection is orthogonal and still ships in both packages |
| Docs outside the Firefox set | Link and example check. No browser launch |

`npm test -- unit --match firefox` is the inner loop for adapter work. `npm test -- firefox` runs
the Firefox suite without a fresh typecheck. The finish line for a Firefox-only change is
`npm run verify:firefox`.

A change to the Chrome emit path, including a new field inside the packaged `.qingzhou-build.json`,
is a Chrome package change. Prove the default `npm run build` output against the previous Chrome
tip when that path is edited. A Firefox-only edit leaves that output byte-identical.

## Gap against `f6446e5`

| Piece | At `f6446e5` | After acceptance |
| --- | --- | --- |
| Build-time target, default Chrome | `--browser`, two output directories | Keep |
| Firefox manifest, boot, skin, and locale rewrite | `firefox-manifest.mjs` after the shared compile | Keep |
| Chrome exclusion of Firefox paths | `isFirefoxOnlySource` on the copy and entry list | Keep, and reject a Chrome esbuild graph that still imports those paths |
| Runtime sentence helper | `productText` / `moz-extension:` | Keep. Document it as a sentence helper, not a package switch |
| Product axis | `--product` and `src/products/` | Keep orthogonal |
| Boot-only imports | True in the tree. The host unit test reads the boot file text | Add a graph check so a new shared import fails the Chrome build |
| `build:firefox`, `dev:firefox` | Absent. The flag form is the public command | Add as aliases |
| `release:firefox` and `.xpi` | Absent. `publish-release.py` always compiles Chrome | Add `--browser firefox` with a separate output directory. Default invocation stays Chrome |
| Build summary names the target | The log line prints mode and product. `.qingzhou-build.json` has no `browser` field | Print `browser` in the log and the stdout JSON. Leave the packaged build manifest unchanged so the Chrome directory hash stays put |
| CI | Separate `firefox-package` job runs `verify:firefox`. Failure logs are uploaded. Success uploads no package | Keep the separate job. Uploading the built directory is optional and later. No matrix axis |
| Release workflow | None for Firefox. Chrome zips are local via `npm run release` | Local `release:firefox` only. Signing and Add-ons Manager upload stay maintainer steps |
| Typecheck | One program for the repo | Keep |
| `verify:firefox` package mode | Development build, skipped when `QINGZHOU_FIREFOX_EXTENSION_DIR` is set | Keep the rebuild. State the variable in the command docs when the aliases land |
| This convention | Behavior is spread across commands, differences, and the capability gap | This page is the owner |

## Implementation sketch

Land these only after the review accepts the proposal. Each step is one commit. None of them rename
source trees.

1. **Graph fence.** During the Chrome compile, fail if an esbuild input matches
   `isFirefoxOnlySource`. Add a unit test that a fixture service worker importing
   `background/firefox/host.ts` fails the Chrome build and passes the Firefox build. A clean tree
   emits the same Chrome bytes.
2. **Summary line.** Include `browser` in the human build line and the `--json` stdout object.
   Do not add the field to the packaged `.qingzhou-build.json`.
3. **Aliases.** Add `build:firefox` and `dev:firefox` to `package.json`. Point
   [commands.md](commands.md) at them. `npm run build` stays the Chrome production build.
4. **Release path.** Add `--browser firefox` to `publish-release.py`, default `chrome`. Write the
   `.xpi`, debug zip, and `version.json` under `dist/releases/<version>/firefox/`. The default
   command's zip path and bytes stay on the current Chrome recipe. Cover both with the release
   tests.
5. **Workflow text.** Update the [AGENTS.md](../AGENTS.md) finish line so a shared-graph change runs
   `verify:firefox` as well as `verify:quick`, and a Firefox-only change finishes on
   `verify:firefox`. Mark this page as the adopted convention.
6. **CI artifact, optional.** On the existing `firefox-package` job, upload
   `dist/extension-firefox/` after a green `verify:firefox`. Leave the portable job's matrix on
   operating systems only.

## Open questions

1. Confirm `qz-browser-agent@heleifz.github.io` before any signed upload, or pick the permanent id
   while every existing profile is still a temporary add-on.
2. Confirm the `.xpi` name and the `dist/releases/<version>/firefox/` directory. A `.zip` with
   `manifest.json` at the root is the same bytes with a different suffix.
3. Confirm that local shared-graph work runs both `verify:quick` and `verify:firefox`, with CI
   unchanged. `verify:firefox` is the short suite. `verify:quick` stays the long Chrome gate.
4. Confirm that `productText` keeps its name. Renaming the helper rewrites shared modules and
   moves the Chrome package hash. The packaging commits above leave the helper in place.
5. Confirm the data-collection lists stay the submission lists. `none` stays undeclared.
