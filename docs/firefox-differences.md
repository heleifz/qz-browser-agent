# Differences from Chrome on Firefox

The Firefox package loads the same tools as Chrome. A boot module installs Firefox stand-ins
before those tools run. The Chrome package does not include that module, and its manifest and
bundles stay on the Chrome path.

This list is what a person or a tool result can still observe. Each item names the feature, the
Firefox behavior, and the limit that remains. Anything that could not be approximated is in
[Not approximated](#not-approximated).

Build the package with [`npm run build -- --browser firefox`](commands.md#load-temporarily-in-firefox).
It writes `dist/extension-firefox/`. `npm run build` still writes the Chrome package to
`dist/extension/`.

## Package

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Background | `background.scripts` is `background/firefox-boot.js`. That module patches Firefox APIs, then imports `background/service-worker.js`. `background.service_worker` stays in the manifest so the shared validators still see the Chrome entry. Firefox starts the event page and does not run the service worker. | The event page can still be discarded. The hidden offscreen frame is what keeps the keepalive running. |
| Workspace page | `sidebar_action.default_panel` is `sidepanel/sidepanel.html`. The HTML in this package loads `sidepanel/firefox-boot.js`, which patches sidebar-only APIs and then loads `sidepanel.js`. `open_at_install` is `false`. | Install does not open the sidebar. |
| Permissions | `sidePanel`, `debugger`, `offscreen`, and optional `desktopCapture` are omitted. `webNavigation`, `webRequest`, and `webRequestBlocking` are added. | A store review can still reject `webRequestBlocking`. If that permission is removed, response bodies are unavailable. |
| Identity | `browser_specific_settings.gecko.id` is `qz-browser-agent@heleifz.github.io`. `strict_min_version` is `139.0`. The Chrome `key` is omitted. | The id is provisional. Changing it later changes stored data. The minimum version exists because `tabGroups` starts in Firefox 139. |
| Data collection | `data_collection_permissions.required` is `websiteContent`. `optional` is `locationInfo`, `browsingActivity`, and `bookmarksInfo`. | The field is Firefox-only. `none` is not declared: page content is sent to the configured model, and location, history, and bookmarks can be sent when those features are used. |

## Sidebar

The toolbar button, the `_execute_action` command, a notification click, session-import reveal,
and the model-preset shortcut call `chrome.sidePanel.open`. On Firefox that call is
`sidebarAction.open()`.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Opening | `open` runs inside the user-gesture turn. It tries `{ windowId }` and, if Firefox rejects that argument, calls `open()` with no arguments. The toolbar path from `setPanelBehavior({ openPanelOnActionClick: true })` calls `open()` with no arguments. | Firefox draws the sidebar, chooses the side, and shows one sidebar. `open({ tabId })` cannot select a tab. A rejected `windowId` opens whichever window Firefox treats as current. |
| Focus | Composer focus still uses `visibilitychange` and `focus`. | There is no `sidePanel.onOpened`. |
| Closing | Opening does not close a sidebar that is already open. | Chrome's side panel and Firefox's sidebar are different frames. |

## Offscreen work

`run_script`, SVG rasterization, and the 10-second keepalive use `chrome.offscreen.createDocument`.
On Firefox that creates a hidden iframe in the event page whose `src` is `offscreen.html`. The
iframe uses the `hidden` attribute and a zero-size box. It is not `display: none`, so its scripts
run. The same `offscreen.js` keepalive, SVG conversion, and sandbox iframe run inside it.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Hidden frame | `hasDocument` is true after the iframe `load` event. | If the event page has no document, the fallback is a minimized, unfocused popup of `offscreen.html`. That window can flash. The log line is `[轻舟] firefox offscreen uses a minimized window`. |
| Lifetime | The iframe's 10-second ping is the same message the Chrome offscreen document sends. | The ping keeps the event page alive only while the iframe stays loaded. Discarding the event page drops the frame until the next `ensure()`. |
| Sandbox runner | The manifest still declares `runner-sandbox.html` and the sandbox CSP. | Firefox documents those sandbox keys from version 154. This approximation was not executed against a live page in the temporary-load check. |

## Page input

Click, press, and `act_on_screen` send `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`,
`Input.dispatchTouchEvent`, and `Input.insertText`. Firefox runs those in the page through
`scripting.executeScript`.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Mouse, wheel, keys, and text | The command hits the element at the point, or the last mouse target, and dispatches a DOM `MouseEvent`, `KeyboardEvent`, or `InputEvent`. `selectAll`, `copy`, `paste`, and `cut` also call `execCommand`. A release with a negative coordinate is a mouseup without a click. Wheel events also scroll the document. | The events are untrusted. A page that ignores untrusted input does not respond. Paste can fail when the page has no clipboard permission. |
| Touch | `Input.dispatchTouchEvent` dispatches `TouchEvent` when the page provides that constructor, and otherwise sends mouse events. | `Emulation.setTouchEmulationEnabled` only stores a flag. It does not make the page report a touch device. |
| Coordinates | `DOM.getBoxModel` returns the element's viewport quad from `getBoundingClientRect`. Clicks and iframe screenshot math in this extension use that origin. | These quads are viewport CSS pixels. Raw Chrome DevTools Protocol box models are document coordinates. |
| Stop | `Runtime.terminateExecution` returns an empty result. | A running page function is not interrupted. |

## Screenshots

`Page.captureScreenshot` uses `tabs.captureTab` when that method exists. If it throws, the tab is
activated and `tabs.captureVisibleTab` is used.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Viewport | A capture without a clip returns the visible tab as base64, without a data-URL prefix. | The image is a tab capture, not a Chrome compositor surface. Device pixel ratio and zoom can differ from Chrome. |
| Element and overflow clips | A clip inside the viewport is cropped. `captureBeyondViewport` scrolls, captures, and stacks up to 8 vertical slices, then restores the scroll position. | The page can jump while the slices are taken. A clip wider than the viewport is cropped to one viewport width. More than 8 viewport heights are cut off. |
| Background tabs | `captureTab` can capture a tab that is not focused. | When `captureTab` fails, the fallback focuses the tab and its window. |

## Accessibility tree

`Accessibility.getFullAXTree` walks the DOM and ARIA attributes in the isolated world.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Nodes | The root role is `RootWebArea`. Buttons, links, inputs, images, and other mapped roles are kept. A generic or none node with no name is omitted and its children attach to the nearest kept parent. `backendDOMNodeId` matches the ids from the DOM commands. `depth` is honored. | This is not the browser accessibility tree. Computed roles, presentational nodes, and shadow trees are missing. The walk stops at 4000 nodes. |
| Frames | An iframe element is role `Iframe`. Direct child frames can be grafted through `DOM.getFrameOwner`. | Nested frames whose parent is not the main frame are not attached. Duplicate iframe `src` values can be paired with the wrong frame. |

## Mobile page mode

`set_page_mode` reads `navigator.userAgent`, then sets an Android Chrome user agent, device metrics
of 412×915, touch emulation, and reloads the page.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| User agent | A debugger evaluation of the exact expression `navigator.userAgent` returns `Chrome/131.0.0.0` until an override is set, then returns the override. `Emulation.setUserAgentOverride` also assigns `navigator.userAgent` in the page's main world. An empty override restores the native getter. | The engine stays Gecko. `navigator.userAgentData` stays Firefox's. The main-world assignment can lose to a page script that runs first. Other expressions that read `navigator.userAgent` see the page value, not the compatibility string. |
| Viewport | The window is resized so the page's inner size is near 412×915. The previous bounds are restored when that tab clears emulation or the debugger detaches. | The whole window changes size, including other tabs. |
| Reload | `Page.reload` is `tabs.reload`. The frame's `loaderId` changes on `webNavigation.onCommitted`. | The reload is a normal tab reload. |

## PDF

`Page.printToPDF` scrolls the document, captures up to 8 JPEG viewport slices, and wraps them in a
PDF. Each JPEG is one page. The page size is the bitmap size in points.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Output | The result is `{ data }` with base64 PDF bytes, which is the shape the document tool already reads. | The PDF is a raster. Text is not selectable. CSS page size, headers, and margins are ignored. Content below 8 viewports is omitted. `printBackground` is whatever the pixels contain. |
| `data:` documents | The tool opens an inactive tab and prints it through this command. | Capturing a `data:` tab was not checked in Firefox. If scripting or capture is blocked there, PDF creation fails. |

## Network and console

`Network.enable` listens with `webRequest`. `Runtime.enable` installs a console hook.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Requests | `requestWillBeSent`, `responseReceived`, `loadingFinished`, and `loadingFailed` are emitted on the tab, with no `sessionId`. Timestamps are seconds. Resource types are mapped onto the CDP names the monitor already accepts. Request headers are included when `onBeforeSendHeaders` runs. | The set of requests is Firefox's `webRequest` set. Cache and service-worker fidelity differ from CDP. Requests from iframes appear on the main tab monitor. |
| Bodies | A blocking listener reads the body with `filterResponseData`, up to about 1 MB and 200 entries. `xmlhttprequest`, `script`, `stylesheet`, and `other` are returned as text. Other types are base64. A missing body throws `No data found for resource`. | Truncated bodies omit the rest of the response. If the blocking listener cannot be added, bodies are not stored. |
| Console | `console.debug`, `log`, `info`, `warn`, `error`, `error`, and `unhandledrejection` are reported after `Runtime.enable`. The hook is installed again on navigation. | Messages from before `Runtime.enable` are not replayed. Line numbers are parsed from the wrapper stack. A burst can drop records. A failed hook install is ignored so `Runtime.enable` still succeeds. |

## Cross-origin iframes

`Page.getFrameTree` on the main frame includes same-origin child frames. Cross-origin direct
children are omitted there and announced with `Target.attachedToTarget`. The session id is
`ff-<tabId>-<frameId>`, and `targetInfo.parentFrameId` is `"0"`. Commands with that `sessionId`
run in that frame. `about:blank`, `about:`, and `javascript:` URLs stay with the parent.
An origin of `"null"` is treated as cross-origin.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Injection | The frame command uses `scripting.executeScript` with `frameIds`. | Pages that block extension scripting, including some `about:` and `data:` URLs, still fail. |
| Nesting | Only direct children of the main frame are announced. | A cross-origin frame inside another child frame is not attached. |
| Owner node | `DOM.getFrameOwner` matches the frame URL to the iframe's `contentWindow` location, then to `src`, then to the sibling index. | Two iframes with the same `src` can be matched to the wrong element. |

## Header rules

Kimi, DashScope, ChatGPT, and OpenCode session rules set `initiatorDomains` to `runtime.id` so
the `qz-agent/1.0.0` user agent is added to the extension's own requests. On Firefox `runtime.id`
is the email-shaped gecko id, which is not a hostname. `declarativeNetRequest.updateSessionRules`
and `updateDynamicRules` rewrite an initiator domain equal to that id into the hostname of
`runtime.getURL("/")`. When the hostname already equals `runtime.id`, the rules are unchanged, so
the Chrome path is a no-op if this module were ever loaded there.

Live calls to those providers were not made from Firefox. If Firefox does not treat the
extension's UUID host as the initiator, the header is still missing.

## Copy and settings links

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| File access | The Firefox package tells the user to open qz in `about:addons`, open Permissions, and enable local-file access. Translated catalogs replace the `chrome://extensions` sentence. English and Simplified Chinese omit that key in Chrome and use the shared bundle sentence, so the Firefox package adds the key. The loader prefers the catalog. The English source and the Chrome package still name `chrome://extensions`. | The sentence does not deep-link to the checkbox. |
| Shortcuts | A sidebar `tabs.create` URL that starts with `chrome://extensions` opens `about:addons`. | Firefox has no equivalent of `chrome://extensions/shortcuts` in this package. Shortcuts are edited from the add-ons gear menu, **Manage Extension Shortcuts**. |

## Case recording

The sidebar asks for the optional `desktopCapture` permission, then calls
`desktopCapture.chooseDesktopMedia`, then `getUserMedia` with `chromeMediaSource`. Firefox has no
`desktopCapture` permission. A request for that permission alone resolves as granted. The chooser
calls `getDisplayMedia` immediately, keeps the stream, and returns the id `firefox-display`.
`getUserMedia` with a desktop source returns that stream. Audio tracks are stopped when the caller
did not ask for audio.

The picker is Firefox's display picker. The stream is the display stream itself. Audio is present
only when the user shares it. The picker was not opened in the temporary-load check.

## Notifications

`requireInteraction` and `priority` are ignored by Firefox. When `requireInteraction` is true, a
notification that closes with `byUser !== true` is created again, up to 12 times, with the same
id and options. A click, or a close with `byUser === true`, stops the renewals. `priority` has no
substitute: the notification looks like any other Firefox notification.

If Firefox does not fire `onClosed` until the user dismisses the toast, the renewal does not run
and the toast still disappears on Firefox's own timer.

## Not approximated

These calls fail or stay absent. The tool receives the existing error path.

| Feature | What happens |
| --- | --- |
| `Network.loadNetworkResource` and `IO.read` | `sendCommand` rejects with `<method> is not available in Firefox`. The Git Skill archive download that uses those methods fails. |
| Chrome debugger infobar | `debugger.attach` does not show a debugging banner. |
| Trusted input | Clicks, keys, and touch are DOM events. |
| Browser accessibility tree | The tree is the DOM walk above. |
| Vector PDF | The PDF is JPEG pages. |
| Per-tab side panel | The sidebar is one per window. |
| Notification priority | Ignored. |
| `Runtime.terminateExecution` | Returns `{}` and does not stop script. |
| MCP settings sender | `assertMcpSettingsSender` still requires a `chrome-extension://<id>/` URL. A Firefox settings page is `moz-extension://…`, so that check still fails. |
| Half-minute alarm | The MCP reconnect alarm stays `periodInMinutes: 0.5`. Firefox may clamp it. The one-minute automation alarm is unchanged. |
| Geolocation prompt | The in-app consent card is unchanged. Whether Firefox also shows its own location prompt was not checked. |
| Tab groups | The same `tabGroups` calls run. The group chrome is Firefox's. `TabGroup.shared` is unsupported and unused. |

## What this check did not run

The temporary add-on was loaded in Firefox. These paths were not exercised there: a live provider
request, the display-capture picker, a real-page click, an accessibility snapshot, a PDF of a
page, mobile resize, the `about:debugging` button, and the geolocation prompt.
