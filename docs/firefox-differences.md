# Differences from Chrome on Firefox

The Firefox package loads the same tools as Chrome. A boot module installs Firefox stand-ins
before those tools run. The Chrome package does not include that module. Its manifest and the
Chrome sentences in shared code stay on the Chrome path. Shared copy that a person can read
chooses a Firefox sentence only when `runtime.getURL("")` starts with `moz-extension:`.

This list is what a person or a tool result can still observe. Each row names the Firefox
behavior and the limit that remains. Platform limits cite the Firefox 158.0.1 APIs that were
inspected. Build the package with
[`npm run build -- --browser firefox`](commands.md#load-temporarily-in-firefox). It writes
`dist/extension-firefox/`. `npm run build` still writes the Chrome package to `dist/extension/`.

## Package

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Background | `background.scripts` is `background/firefox-boot.js`. That module patches Firefox APIs, then imports `background/service-worker.js`. `background.service_worker` stays in the manifest so the shared validators still see the Chrome entry. Firefox starts the event page and does not run the service worker. | The event page can still be discarded. The hidden offscreen frame is what keeps the keepalive running. |
| Workspace page | `sidebar_action` is the panel. `default_panel` is `sidepanel/sidepanel.html`. `default_title` and `default_icon` match the toolbar button. `open_at_install` is `false`. The HTML loads `sidepanel/firefox-boot.js` and `sidepanel/firefox-sidebar.css` after the shared skin. | Install does not open the sidebar. Firefox's schema default for `open_at_install` is true. This package keeps false so first install matches the Chrome task flow. |
| Toolbar and shortcut | `action.default_area` is `navbar`, which is Firefox's toolbar. The suggested key that Chrome puts on `_execute_action` moves to the reserved command `_execute_sidebar_action`. Its description is the extension name. The model-preset command stays. The toolbar click calls `sidebarAction.toggle()` during the user gesture. | Firefox rejects two commands with the same suggested key, so `_execute_action` is not also declared. The extension does not add a `menus` item: the sidebar menu already lists a `sidebar_action`, and an extra `menus` permission would be a second entry point. |
| Permissions | `sidePanel`, `debugger`, `offscreen`, and optional `desktopCapture` are omitted. `webNavigation`, `webRequest`, and `webRequestBlocking` are added. There is no `update_url`. | A store review can still reject `webRequestBlocking`. If that permission is removed, response bodies are unavailable. Add-ons Manager owns updates for a signed package. A temporary add-on does not update itself. |
| Storage | Sessions, settings, and Skills use `storage.local` and the extension origin, the same repository calls as Chrome. `unlimitedStorage` stays. | The data lives in the Firefox profile for this add-on. It does not follow a Chrome profile or a Google account. |
| Identity | `browser_specific_settings.gecko.id` is `qz-browser-agent@heleifz.github.io`. `strict_min_version` is `139.0`. The Chrome `key` is omitted. | The id is provisional. Changing it later changes stored data. The minimum version exists because `tabGroups` starts in Firefox 139. |
| Data collection | `data_collection_permissions.required` is `websiteContent`. `optional` is `locationInfo`, `browsingActivity`, and `bookmarksInfo`. | The field is Firefox-only. `none` is not declared: page content is sent to the configured model, and location, history, and bookmarks can be sent when those features are used. |
| Appearance | `sidepanel/firefox-sidebar.css` sets `color-scheme: light dark`, `font: message-box`, and the shared color tokens to `Canvas`, `CanvasText`, `ButtonFace`, `ButtonText`, `Field`, `AccentColor`, and `AccentColorText`. | The controls are still the shared widgets. Firefox does not give an extension the browser's XUL widgets. `browser_style` is not set; Firefox warns that it is deprecated. |

## Sidebar

The toolbar button, a notification click, session-import reveal, and the model-preset shortcut
call `chrome.sidePanel.open`. On Firefox that call is `sidebarAction.setPanel({ tabId, panel })`
when a tab id is present, then `sidebarAction.open()` with no arguments. Firefox 158
`sidebar_action.json` defines `open`, `close`, and `toggle` with an empty parameter list and
`requireUserInput: true`. Passing `{ windowId }` is not in that schema.

A content-script message is not a user-input handler, so the session-import jump cannot call
`sidebarAction.open()` on that turn. The import still stores the session. The failed open sets
the toolbar badge to `!` and creates notification `qz-open-sidebar`. English UI copy is
`Click this notification to open the sidebar.` Chinese UI copy is `点击此通知打开侧边栏。`
The notification click calls `sidebarAction.open()` with no arguments and clears the badge. The
toolbar click clears the badge and toggles the sidebar. `action.openPopup` is not used: this
package has no `default_popup`, and `openPopup` has the same user-input requirement. Content
scripts do not receive `sidebarAction`. The import event stays available for 15 seconds, so a
prompt click in that window still selects the imported session.

No extension entry opens `sidepanel/sidepanel.html` as a browser tab. The toolbar button,
`_execute_sidebar_action`, the sidebar menu, and a later open after consent use Firefox's sidebar
browser. about:debugging Inspect opens a toolbox. A tab whose address is the panel URL is a
manual navigation.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Opening | `open()` runs inside the user-gesture turn and is not preceded by `windows.update`. `setPanel` records the sidebar document for that tab and is not awaited, so the gesture is still current when `open()` runs. The toolbar path calls `toggle()` when Firefox provides it. A call Firefox rejects for lack of user input keeps that rejection, sets badge `!`, and shows `qz-open-sidebar`. The notification click opens the sidebar. | Firefox draws one sidebar for the window and chooses the side. `open()` cannot target a tab or a window. A call outside a user gesture is not retried and does not open a tab. The error is `Firefox opens the sidebar only during a user gesture, such as a toolbar click, shortcut, or notification click.` The toolbar listener logs `[轻舟] firefox sidebar did not open:` and that sentence. The deferred open logs the same prefix and the notification sentence. |
| Per-tab panel | `setPanel({ tabId, panel })` is Firefox's tab-scoped panel URL. Other tabs keep the default panel. The package does not call `setPanel` with an empty string. | The open or closed state is still one per window. Firefox 158 has no API that opens the sidebar for one tab and leaves it closed in another. Switching tabs can show that tab's panel document, which for this package is the same `sidepanel.html`. |
| Focus | Composer focus still uses `visibilitychange` and `focus`. | There is no `sidePanel.onOpened`. |
| Closing | A programmatic open does not close a sidebar that is already open. The toolbar button toggles, which matches Firefox's toolbar convention and Chrome's `openPanelOnActionClick` toggle. | Chrome's side panel and Firefox's sidebar are different frames. |

## Offscreen work

`run_script`, SVG rasterization, and the 10-second keepalive use `chrome.offscreen.createDocument`.
On Firefox that creates a hidden iframe in the event page whose `src` is `offscreen.html`. The
iframe uses the `hidden` attribute and a zero-size box. It is not `display: none`, so its scripts
run. The same `offscreen.js` keepalive, SVG conversion, and sandbox iframe run inside it.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Hidden frame | `hasDocument` stays false until the iframe loads `offscreen.html`. An `about:blank` load does not count. Overlapping `createDocument` calls share that load. A load error removes the frame, so the next `ensure()` can try again. A document that is still loading waits for `DOMContentLoaded` before the frame is created. | The minimized popup is used only when the event page has no document. That window can flash. The log line is `[轻舟] firefox offscreen uses a minimized window`. |
| Lifetime | The iframe's 10-second ping is the same message the Chrome offscreen document sends. | The ping keeps the event page alive only while the iframe stays loaded. Discarding the event page drops the frame until the next `ensure()`. |
| Sandbox runner | The manifest still declares `runner-sandbox.html` and the sandbox CSP. | Firefox documents those sandbox keys from version 154. This approximation was not executed against a live page in the temporary-load check. |

## Page input

Click, press, and `act_on_screen` send `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`,
`Input.dispatchTouchEvent`, and `Input.insertText`. Firefox runs those in the page through
`scripting.executeScript`.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Mouse, wheel, keys, and text | The command hits the element at the point, or the last mouse target. It dispatches `pointerdown`, `pointerup`, or `pointermove` when `PointerEvent` exists, then the matching mouse event. A press calls `focus` when the page allows it. A click that the page does not cancel follows the default action: a link assigns `location` or opens `_blank` in a new window, and a submit control calls `form.requestSubmit`. `javascript:` links are skipped. Checkboxes are left to the page. `selectAll`, `copy`, `paste`, and `cut` call `execCommand` on keydown only. Text uses `execCommand("insertText")`, then the input or textarea value setter plus an `input` event, then a `contentEditable` append. A release with a negative coordinate is a mouseup without a click. Wheel events also scroll the document. | `Event.isTrusted` stays false. Firefox 158 has no `debugger` namespace in the extension schemas. `nsIDOMWindowUtils.sendMouseEvent`, `sendKeyEvent`, and `sendTouchEvent` are chrome-privileged and are not available to an extension. A page that checks `isTrusted` still ignores the events. A file picker still does not open. A missing element reports `Firefox could not dispatch mousedown: the page has no element at (x, y).` A missing focus for a key reports `Firefox could not press <key>: the page has no focused element.` Paste, copy, and cut report a clipboard or focus failure when `execCommand` does not apply. Inserting text with no editable element reports `Firefox could not insert text. Focus an editable element, or the page refused the untrusted insert.` |
| Touch | `Input.dispatchTouchEvent` dispatches `TouchEvent` when the page provides that constructor, and otherwise sends mouse events. | `Emulation.setTouchEmulationEnabled` only stores a flag. It does not make the page report a touch device. |
| Coordinates | `DOM.getBoxModel` returns the element's viewport quad from `getBoundingClientRect`. Clicks and iframe screenshot math in this extension use that origin. | These quads are viewport CSS pixels. Raw Chrome DevTools Protocol box models are document coordinates. |
| Stop | `Runtime.terminateExecution` returns an empty result. `Runtime.disable` also returns an empty result and leaves the console hook in place until detach. | A running page function is not interrupted. Calling `Runtime.disable` in Firefox returns `{}` and must not be treated as success at clearing the hook. |

## Screenshots

`Page.captureScreenshot` uses `tabs.captureTab`. Firefox 158 `ImageDetails.rect` is CSS pixels
relative to the page. `ext-tabs-base.js` `capture()` draws that rect. A clip that stays inside
the viewport is cropped from one visible capture. A `captureBeyondViewport` clip that falls
outside the viewport tries one `captureTab` with that rect and scale. If that throws, the tab
scrolls and up to 8 viewport pieces are stitched. `resetScrollPosition` is not sent.
`ext-tabs-base.js` allows it only when `context.extension.restrictSchemes` is false, which is
the Mozilla-signed path, and the comment there marks the option as not standardized.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Viewport | A capture without a clip returns the visible tab as base64, without a data-URL prefix. | The image is a tab capture, not a Chrome compositor surface. Device pixel ratio and zoom can differ from Chrome. |
| Element and overflow clips | An in-viewport clip is cropped where it sits. A larger clip tries one document rect. The scroll fallback keeps the rectangle that is actually visible, then repeats across and down for up to 8 captures, and restores the scroll position. | The page can jump while the pieces are taken. When the 8-capture budget stops the clip early, the background logs `[轻舟] firefox screenshot kept 8 viewport pieces; the rest of the clip was omitted`. A failed rect capture does not fall through to `captureVisibleTab`. |
| Background tabs | `captureTab` can capture a tab that is not focused. | When `captureTab` fails and no rect was requested, the fallback focuses the tab and its window. |

## Accessibility tree

`Accessibility.getFullAXTree` walks the DOM and ARIA attributes in the isolated world. An open
shadow root is entered. A same-origin iframe's `contentDocument.documentElement` is entered.
Firefox 158 has no `accessibility` namespace in the extension schemas, and no experiment-free
computed-role API was available to this package.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Nodes | The root role is `RootWebArea`. Buttons, links, inputs, images, and other mapped roles are kept. A generic or none node with no name is omitted and its children, including open shadow children, attach to the nearest kept parent. `backendDOMNodeId` matches the ids from the DOM commands. `depth` is honored. A shadow root that cannot be read is marked `shadowBoundary` `shadow root could not be read: …`. A node stopped by `depth` is marked `depthBoundary` `children below this depth were omitted` when it has light children, shadow children, or a nested document. | This is not the browser accessibility tree. Computed roles and presentational nodes are missing. Closed shadow roots stay closed. The walk stops at 4000 nodes. |
| Frames | An iframe element is role `Iframe`. A same-origin document is walked, so that frame has no boundary error. A document without an element is marked `frameBoundary` `nested frame has no document`. A document that cannot be read is marked `cross-origin nested frame is not included`. Direct child frames can be grafted through `DOM.getFrameOwner`. | A page whose iframe order disagrees with `webNavigation` can still pair a duplicated `src` with the wrong element. |

## Mobile page mode

`set_page_mode` reads `navigator.userAgent`, then sets an Android Chrome user agent, device metrics
of 412×915, touch emulation, and reloads the page. The compatibility string is the value the page
sees. It is not extension UI copy, so the Firefox catalog rewrite does not change it. Sites that
branch on a Chrome user agent keep receiving the layout the tool asked for.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| User agent | A debugger evaluation of the exact expression `navigator.userAgent` returns `Chrome/131.0.0.0` until an override is set, then returns the override. `Emulation.setUserAgentOverride` also assigns `navigator.userAgent` in the page's main world. An empty override restores the native getter. | The engine stays Gecko. `navigator.userAgentData` stays Firefox's. The main-world assignment can lose to a page script that runs first. Other expressions that read `navigator.userAgent` see the page value, not the compatibility string. |
| Viewport | The window is resized so the page's inner size is near 412×915. The previous bounds are restored when that tab clears emulation or the debugger detaches. | The whole window changes size, including other tabs. |
| Reload | `Page.reload` is `tabs.reload`. The frame's `loaderId` changes on `webNavigation.onCommitted`. | The reload is a normal tab reload. |

## PDF

`Page.printToPDF` tries one JPEG `captureTab` rect of the document, then one PDF page. If that
capture throws, it scrolls and captures up to 8 JPEG viewport slices. Each JPEG is one page.
The page size is the bitmap size in points.

Firefox 158 `tabs.json` has `print`, `printPreview`, and `saveAsPDF`. It has no `printToPDF`.
`ext-tabs.js` `print()` calls `PrintUtils.startPrintWindow`, which opens the print UI.
`saveAsPDF` creates `nsIFilePicker` in save mode and reports `saved`, `replaced`, `canceled`,
`not_saved`, or `not_replaced`. It does not return bytes. This package does not call it.
WebDriver BiDi `browsingContext.print` can return a PDF, and an extension cannot start the
Remote Agent.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Output | The result is `{ data }` with base64 PDF bytes, which is the shape the document tool already reads. A full-document capture is one page and has no truncation note. | The PDF is a raster. Text is not selectable. CSS page size, headers, and margins are ignored. Content below 8 viewport slices adds a last page whose text is `Firefox kept N of M viewport pages. Content below that was omitted.` The background also logs `[轻舟] firefox pdf kept N of M viewport pages; content below that was omitted`. `printBackground` is whatever the pixels contain. A sliced capture is one viewport wide. |
| `data:` documents | The tool opens an inactive tab and prints it through this command. | Capturing a `data:` tab was not checked in Firefox. If scripting or capture is blocked there, PDF creation fails. |

## Network and console

`Network.enable` listens with `webRequest`. `Runtime.enable` installs a console hook.
`Network.loadNetworkResource` reads through the extension's `fetch`. The manifest host
permission is `<all_urls>`, so that fetch is not limited by the page's CORS or CSP.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Requests | `requestWillBeSent`, `responseReceived`, `loadingFinished`, and `loadingFailed` are emitted on the tab, with no `sessionId`. Timestamps are seconds. Resource types are mapped onto the CDP names the monitor already accepts. Request headers are included when `onBeforeSendHeaders` runs. If Firefox rejects an `extraInfoSpec`, that listener is added without it, and `Network.enable` still returns. | The set of requests is Firefox's `webRequest` set. Cache and service-worker fidelity differ from CDP. Requests from iframes appear on the main tab monitor. |
| Bodies | A blocking listener reads the body with `filterResponseData`, up to about 1 MB and 200 entries. `xmlhttprequest`, `script`, `stylesheet`, and `other` are returned as text. Other types are base64. A missing body throws `No data found for resource`. | Truncated bodies omit the rest of the response. If the blocking listener cannot be added, bodies are not stored. |
| `loadNetworkResource` | An `http` or `https` URL returns `resource.success: true` with `httpStatusCode`, headers, and a stream handle `ff-io-<tabId>-<n>`. `includeCredentials: false` omits credentials. `disableCache: true` uses `cache: "reload"`. `IO.read` returns `{ data, base64Encoded: true, eof }`. `IO.close` drops the handle. A non-HTTP URL returns `ERR_INVALID_URL`. A failed fetch returns `ERR_FAILED` and `success: false`. | The cookies are the extension's jar for hosts it may request, not the frame's partitioned jar, and the bytes are not CDP's HTTP cache. Streams are dropped when the debugger detaches. |
| Console | `console.debug`, `log`, `info`, `warn`, `error`, and `unhandledrejection` are reported after `Runtime.enable`. The hook is installed again on navigation. | Messages from before `Runtime.enable` are not replayed. Line numbers are parsed from the wrapper stack. A burst can drop records. A failed hook install is ignored so `Runtime.enable` still succeeds. `Runtime.disable` leaves the hook in place. |

## Cross-origin iframes

`Page.getFrameTree` on the main frame includes same-origin direct child frames. A child session's
tree includes that frame's same-origin direct children. Frames that are cross-origin relative to
the main frame are omitted from the main tree and announced with `Target.attachedToTarget`.
The session id is `ff-<tabId>-<frameId>`. `targetInfo.parentFrameId` is `"0"` so the existing
direct-child consumer attaches a nested cross-origin frame without a Chrome bundle change.
Commands with that `sessionId` run in that frame. `about:blank`, `about:`, and `javascript:`
URLs stay with the parent. An origin of `"null"` is treated as cross-origin.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| Injection | The frame command uses `scripting.executeScript` with `frameIds`. | Pages that block extension scripting, including some `about:` and `data:` URLs, still fail. |
| Nesting | Every frame that is not the main frame and is cross-origin to the main frame is announced once. A cross-origin frame that leaves is announced with `Target.detachedFromTarget`. | The announced parent is flattened to `"0"`. A frame that is same-origin with the main page but nested inside a cross-origin frame is not a direct child of the main tree and is not announced. |
| Owner node | `DOM.getFrameOwner` matches the frame URL to the iframe's `contentWindow` location, then to an exact `src`, then to a `src` prefix, and uses the sibling index when several iframes share that `src`. | A page whose iframe order disagrees with `webNavigation` can still pair a duplicated `src` with the wrong element. |

## Header rules

Kimi, DashScope, ChatGPT, and OpenCode session rules set `initiatorDomains` to `runtime.id` so
the `qz-agent/1.0.0` user agent is added to the extension's own requests. On Firefox `runtime.id`
is the email-shaped gecko id, which is not a hostname. `declarativeNetRequest.updateSessionRules`
and `updateDynamicRules` rewrite an initiator domain equal to that id into the hostname of
`runtime.getURL("/")`. An update that does not include `addRules` is passed through unchanged, so
a removal is not given an add list. When the hostname already equals `runtime.id`, the rules are
unchanged, so the Chrome path is a no-op if this module were ever loaded there.

Live calls to those providers were not made from Firefox. If Firefox does not treat the
extension's UUID host as the initiator, the header is still missing.

## Copy and settings links

Catalogs in the Firefox package are rewritten. `chrome-extension://` becomes `moz-extension://`.
`chrome.debugger` becomes `debugger`. `chrome://extensions`, including the shortcuts URL, becomes
`about:addons`. `chrome://downloads` becomes `about:downloads`. A remaining `chrome://` becomes
`about:`. `Chrome Web Store` becomes `Add-ons Manager`. `Chrome` becomes `Firefox`. `ChromeOS`
is left as `ChromeOS`. `Side Panel` and `side panel` become `Sidebar` and `sidebar`. Historical
label catalogs are not rewritten. English and Simplified Chinese catalogs ship only the strings
that differ from the shared bundle, because those packs omit the full catalog and the loader
would otherwise show the Chrome sentence. Sentences that are not in a catalog use `productText`,
which returns the Chrome sentence unless the caller is a Firefox extension page.

| Feature | Firefox behavior | Known limitation |
| --- | --- | --- |
| File access | The Firefox package tells the user to open qz in `about:addons`, open Permissions, and enable local-file access. English and Simplified Chinese omit that key in Chrome and use the shared bundle sentence, so the Firefox package adds the key. The loader prefers the catalog. The English source and the Chrome package still name `chrome://extensions`. | The sentence does not deep-link to the checkbox. |
| Shortcuts | A sidebar `tabs.create` URL that starts with `chrome://extensions` opens `about:addons`. The button label comes from the rewritten catalog. | Firefox has no equivalent of `chrome://extensions/shortcuts` in this package. Shortcuts are edited from the Add-ons Manager gear menu, **Manage Extension Shortcuts**. |
| Downloads and prompts | Download hints name `about:downloads` and Firefox. Permission instructions name the sidebar and Firefox's permission prompt. | The local `qz` command process is not an extension page. Its terminal text still says "side panel". |
| Page mode | The tool description in the Firefox catalog says an Android layout. The user agent sent to the page stays the Chrome compatibility string above. | A site can still tell that the engine is Gecko. |

## Case recording

The sidebar asks for the optional `desktopCapture` permission, then calls
`desktopCapture.chooseDesktopMedia`, then `getUserMedia` with `chromeMediaSource`. Firefox has no
`desktopCapture` permission. A request for that permission alone resolves as granted. The chooser
calls `getDisplayMedia` immediately, keeps the stream, and returns the id `firefox-display`.
`getUserMedia` with a desktop source returns that stream. Audio tracks are stopped when the caller
did not ask for audio.

The picker is Firefox's display picker. The stream is the display stream itself. Audio is present
only when the user shares it. A dismissal does not open the picker again. If audio was requested
and the first call fails for another reason, the chooser tries once more without audio. Starting
a new capture stops a stream that was still held. The picker was not opened in the temporary-load check.

## Notifications

Firefox 158 `CreateNotificationOptions` has no `requireInteraction`. Passing that property makes
`notifications.create` fail with `Unexpected property "requireInteraction"`, so the completion
toast and an automation failure toast never appear. The Firefox notification wrapper deletes
`requireInteraction` before `create` and before each renewal. `priority`, `contextMessage`, and
the other schema fields stay. `ext-notifications.js` builds the alert from the title, message, and
icon, so `priority` does not change the toast.

When the caller passed `requireInteraction: true`, a notification that closes with
`byUser !== true` is created again, up to 12 times, with the stripped options. A click, a close
with `byUser === true`, or a recreate that throws stops the renewals. Firefox 158's `onClosed`
always reports `byUser: true` (the `byUser` argument is still the Bug 1413188 placeholder), so a
system dismissal does not renew. The toast still disappears on Firefox's own timer. A notification
click remains a user-input handler, and the completion click calls `sidebarAction.open()` on that
turn.

## Platform limits

These calls stay short of Chrome because Firefox 158.0.1 does not expose the API, or because the
available API opens a dialog or a privileged path this package does not use.

| Feature | What happens |
| --- | --- |
| Trusted input | Clicks, keys, and touch dispatch DOM events and then run the default action described above. `isTrusted` cannot be set. The chrome-privileged `nsIDOMWindowUtils` send methods are not in the extension API. |
| Browser accessibility tree | The tree is the DOM and ARIA walk above, including open shadow trees and same-origin frame documents. Firefox 158 ships no extension accessibility namespace. |
| Vector PDF | The PDF is JPEG pages. `tabs.saveAsPDF` opens a file picker. `tabs.print` opens the print UI. There is no `tabs.printToPDF`. |
| Per-tab side panel | `setPanel({ tabId })` selects that tab's panel document. `open()` and `toggle()` take no window or tab argument and affect the active window's one sidebar. |
| Notification priority | Ignored. |
| `Runtime.terminateExecution` | Returns `{}` and does not stop script. |
| MCP settings sender | `assertMcpSettingsSender` accepts `chrome-extension://<extension id>/` and a `moz-extension://<host>/` page. Firefox's host is an internal UUID, and `sender.id` must still be this extension. A web page URL is still rejected. |
| Half-minute alarm | The MCP reconnect alarm stays `periodInMinutes: 0.5`. Firefox 158.0.1 does not clamp that value: the shipped alarm implementation stores it and schedules `periodInMinutes * 60` seconds. A temporary add-on that created `{ periodInMinutes: 0.5 }` read back `periodInMinutes` `0.5` and a first fire 30047 ms later. The one-minute automation alarm is unchanged. |
| Geolocation prompt | The in-app consent card is unchanged. Whether Firefox also shows its own location prompt was not checked. |
| Tab groups | The same `tabGroups` calls run. The group chrome is Firefox's. `TabGroup.shared` is unsupported and unused. |
| Chrome debugger infobar | `debugger.attach` does not show a debugging banner. Firefox has no `debugger` permission in this package. |

## Native feel

Matching Chrome wins when the result is the same task. The Firefox shape wins when Chrome's
call would be a non-Firefox argument, a warning, or a second menu.

| Choice | Why |
| --- | --- |
| `sidebarAction.open()` takes no arguments | Firefox 158's schema has an empty parameter list. An extra `windowId` is non-standard. |
| Toolbar uses `toggle()` | That is Firefox's toolbar behavior, and Chrome's action click toggles the side panel too. A notification open still only opens, so it does not close a sidebar the user already has open. |
| Import jump asks for one click | A page message cannot satisfy `requireUserInput`. The badge and `qz-open-sidebar` use Firefox's own toolbar and notification click, which are user-input handlers. The session is already stored. |
| `_execute_sidebar_action` owns the shortcut | Firefox toggles a sidebar from that reserved command. `_execute_action` would not. |
| No custom context menu | The sidebar menu and the toolbar button are already Firefox's. A `menus` permission would add a warning and a second entry. |
| `open_at_install: false` | Firefox would otherwise open the sidebar during install. The Chrome task does not. |
| System colors, not a copied Chrome palette | The shared theme stays in the Chrome package. The Firefox skin overrides tokens with `Canvas` and `AccentColor` so light and dark follow the browser theme. |
| No `resetScrollPosition` | Firefox treats it as non-standard and ignores it unless the add-on is Mozilla-signed. |
| No `saveAsPDF` | The file picker interrupts the task and does not return PDF bytes. |
| Catalog rewrite plus `productText` | Firefox pages say Firefox, sidebar, `about:addons`, and `about:downloads`. `chrome.debugger` in a catalog becomes `debugger`. English and Simplified Chinese receive the rewritten sentences the shared bundle would otherwise show. Chrome pages keep the Chrome sentence. The page-mode user agent stays a Chrome string so the site receives the layout the tool requested. |

## What this check did not run

The temporary add-on was loaded in an earlier Firefox pass. This pass checked the shims with
unit tests and the Firefox 158.0.1 schemas named above. These paths were not exercised again in
a live window: a provider request, the display-capture picker, a real-page click, an
accessibility snapshot, a PDF of a page, mobile resize, the `about:debugging` button, and the
geolocation prompt.
