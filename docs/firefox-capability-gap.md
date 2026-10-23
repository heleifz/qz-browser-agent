# Firefox capability gap

This survey lists every Chrome-only or differing extension surface that a Firefox port has to
account for. The Chrome experience is the target: interaction, copy, defaults, tool results, the
side panel, and import/export. An item in this document stays here until someone confirms a
different behavior. This change does not switch a tool onto a fallback, rewrite user-facing copy,
or drop a Chrome permission.

The temporary-load package is built with
[`npm run build -- --browser firefox`](commands.md#load-temporarily-in-firefox). It writes
`dist/extension-firefox/` from the same sources. `npm run build` still writes the Chrome package
to `dist/extension/`.

Firefox facts below come from Mozilla's WebExtensions documentation and `browser-compat-data`.
Version numbers are that data's `version_added` values. `web-ext lint` on the built package
reports no errors. It warns that `background.service_worker` is unsupported; Firefox still
starts the event page from `background.scripts`. This checkout was not loaded through
`about:debugging`. Confirm that step on Firefox 139 or later.

## What this skeleton loads

| Piece | Firefox package |
| --- | --- |
| Scripts | The Chrome module graph, including `background/service-worker.js`, the side panel page, content scripts, the offscreen page, and `runner-sandbox.html`. |
| Background | `background.scripts` plus `background.service_worker`, both pointing at the same module, with `"type": "module"`. Firefox starts the event page and does not run the service worker ([bug 1573659](https://bugzilla.mozilla.org/show_bug.cgi?id=1573659)). From Firefox 121 the event page still starts when both keys are present. |
| Workspace page | `sidebar_action.default_panel` is `sidepanel/sidepanel.html`. `open_at_install` is `false`, so install does not open the sidebar. |
| Content scripts | The same three registrations: MCP connect on loopback, session export at `document_start`, and the page tools at `document_idle`. |
| Permissions kept | `activeTab`, `alarms`, `tabs`, `tabGroups`, `scripting`, `storage`, `downloads`, `geolocation`, `clipboardWrite`, `notifications`, `declarativeNetRequest`, `unlimitedStorage`, and optional `history`, `bookmarks`, `downloads.open`. |
| Permissions removed from this package only | `sidePanel`, `debugger`, `offscreen`, and optional `desktopCapture`. Firefox rejects these names, so the temporary add-on would fail to install with them present. They remain in [`src/manifest.json`](../src/manifest.json). |
| Minimum version | `browser_specific_settings.gecko.strict_min_version` is `139.0`, because `tabGroups` starts in Firefox 139. |
| Add-on id | Provisional `qz-browser-agent@heleifz.github.io`. Confirm it before any signed build. Changing it later changes stored data and the AMO identity. |
| Chrome `key` | Omitted from the Firefox manifest. The Chrome extension id stays `ghbaodmonhcgkfeejcpffknlggbjhjgj`. |
| Sandbox declaration | `sandbox.pages` and `content_security_policy.sandbox` are copied through. Firefox documents `content_security_policy.sandbox` from version 154. The runner page is still created from the offscreen document. |

Startup calls `chrome.sidePanel.setPanelBehavior` only when that method exists. On Firefox the
existing toolbar listener is registered instead, and that listener calls `sidePanel.open`. The API
is absent, so the toolbar button and the `_execute_action` shortcut do not open the workspace.
Open qz from Firefox's sidebar list. Notification clicks, session-import reveal, and the model
preset shortcut use the same `sidePanel.open` call and also leave the sidebar closed.

The sidebar document is the same side panel page. Its port to the background uses the existing
runtime channel. `assertSidePanelSender` checks that page URL, so the consent button can still
reach the background. End-to-end tasks were not run.

## Portable as-is

These surfaces use APIs Firefox implements. Call sites can stay shared. A version floor is noted
where Firefox added the API later than Chrome.

| Chrome API or feature | Firefox reality | User-visible effect when present |
| --- | --- | --- |
| `chrome.*` namespace | Firefox exposes `chrome.*` and `browser.*`. | Shared call sites keep their names. No polyfill is added. |
| Manifest V3 `action`, `commands`, `default_locale`, icons, `__MSG_*` | Supported. Suggested keys are `Ctrl+Shift+K` and `Ctrl+Shift+M`. | Toolbar icon, localized name, and command entries load. The shortcut editor link is in the next section. |
| `host_permissions: ["<all_urls>"]` | Supported. A temporary add-on grants install-time host permissions without the store dialog. | Content scripts and page tools can be registered. Store-install permission UI is in the next section. |
| Content scripts and `chrome.tabs.sendMessage` | Supported. The manifest does not set `all_frames`, so injection stays on the top frame. | Page reads that already go through the content script keep that path. |
| `scripting.executeScript`, including `world: "MAIN"` | Isolated world from Firefox 102. `MAIN` from Firefox 128. | Main-world probes used by page setup can run on Firefox 128+. |
| `runtime` messaging, ports, `getURL`, `onInstalled`, `onStartup`, `getManifest`, `getPlatformInfo`, `id` | Supported. `runtime.id` is the gecko id, not the Chrome id derived from `key`. | Background and sidebar connect. The local MCP record stores whatever id the browser reports. |
| `storage.local`, `unlimitedStorage` | Supported. | Sessions, settings, and Skills use the same repository calls. |
| `tabs` and `windows`, except grouping | Supported, including `captureVisibleTab` (host permission or `activeTab`; Firefox 126 accepts either). | Open, close, list, focus, and navigate tabs. Visible-tab capture is available to callers that already use it. |
| `tabGroups` and `tabs.group` | `tabs.group` from Firefox 138. `tabGroups` from Firefox 139. `TabGroup.shared` is unsupported and unused. | Task tabs can be grouped with the same title, color, and collapsed flag. The group chrome is Firefox's. See the confirmation list. |
| `alarms` for the one-minute scheduler | Supported. The automation scheduler uses `periodInMinutes: 1`. | Scheduled tasks can wake the background. The MCP reconnect alarm is in the next section. |
| `downloads` including `download`, `search`, `open`, and `show` | Present since Firefox 47–48. Optional `downloads.open` is a valid permission. `FilenameConflictAction.prompt` is unsupported. | Save and list files. Opening a finished download can call `downloads.open`. Firefox may show its own confirm dialog. `saveAs` behavior differed before Firefox 58; current Firefox shows the chooser when `saveAs` is true. |
| `bookmarks` and `history` | Supported optional permissions. | The same tools, after the browser permission prompt. |
| `permissions.contains` and `permissions.request` | Supported for the optional permissions that remain. | History, bookmarks, and `downloads.open` still use the in-panel allow card. |
| `notifications` of type `basic`, plus `onClicked` | Supported. `buttons`, `requireInteraction`, `priority`, image and list templates, and `getPermissionLevel` are ignored or absent. | A basic completion notification can appear. It does not stay on screen the way `requireInteraction: true` does in Chrome, and its click does not open the sidebar. |
| `clipboardWrite` | Supported since Firefox 51. | Copy actions in the sidebar keep the permission. |
| `geolocation` permission and `navigator.geolocation` in the sidebar | The manifest permission exists since Firefox 54. The side panel reads the location after the in-app consent card. | `get_location` still asks inside qz. Whether Firefox also shows its own location prompt needs a device check. |
| `declarativeNetRequest` session rules | The API, `modifyHeaders`, and `initiatorDomains` exist since Firefox 113. | The calls are the same. Whether those rules match extension requests is in the next section. |
| `extension.isAllowedFileSchemeAccess` | Firefox 48–152 always returned `false`. From Firefox 153 the value follows **Access local files on your computer** in the add-on permissions. | The flag can become true on Firefox 153+. The error text still names `chrome://extensions`. |
| `commands.getAll` and `commands.onCommand` | Supported. | The model-preset command event can fire. Opening the workspace for that command is not wired. |
| Model requests, device-code login, and local MCP/CLI | Ordinary `fetch` from the extension. The bridge records `extensionId` and does not require the Chrome id. | Provider calls that do not depend on rewritten request headers can proceed. Pairing uses the loopback service. |
| Session import content script | `session-export-bridge.js` runs at `document_start` on all URLs. | An export page can message the extension. Revealing the workspace still calls `sidePanel.open`. |

## Needs a confirmed alternative

These can be attempted with a different API or with a path the Chrome code already has. Using that
path changes what the user sees or what a tool returns. Nothing in this list is enabled specially
for Firefox in this change. Where the shared code already catches a debugger failure, that catch
runs on Firefox because the debugger API is missing.

| Chrome API or feature | Firefox reality | User-visible effect |
| --- | --- | --- |
| `sidePanel` (`open`, `setPanelBehavior({ openPanelOnActionClick: true })`, `onOpened`) | No `sidePanel` API and no `sidePanel` permission. `sidebarAction` is a different API. Firefox draws the sidebar, on the side the user has set, and shows one sidebar at a time. `sidebarAction.open` and `toggle` require a user gesture. There is no `onOpened` event. | The workspace page can appear in the sidebar. It does not occupy Chrome's side panel slot, it does not follow `open({ tabId })` or `open({ windowId })`, and the toolbar button does not toggle it. Composer focus also listens to `visibilitychange` and `focus`, so the missing `onOpened` event is not the only focus signal. |
| Background service worker and offscreen keepalive | The background is an event page. `chrome.offscreen` does not exist. `offscreen.ts` pings the worker every 10 seconds from `offscreen.html`. | With the sidebar closed, the event page can suspend and drop in-memory run state that has not been written. Chrome keeps that work alive through the offscreen document. |
| `chrome.offscreen.createDocument` for SVG raster and the inner script runner | No offscreen API. The event page has a DOM, and Firefox 154 documents extension sandbox pages. This package does not move either job onto that DOM. | SVG conversion fails closed with the existing offscreen error. `run_script` returns `INNER_RUNNER_UNAVAILABLE`. Skill scripts that depend on the inner runner stop. |
| `chrome.debugger` and CDP | The `debugger` permission is rejected. There is no WebExtensions debugger API. | Tools that attach the debugger throw `DEBUGGER_UNAVAILABLE` unless a caller already catches that error. The debugging infobar Chrome shows cannot appear. |
| `act_on_element` click and press | On debugger failure, click and press already call the content script, except inside a child frame, after a partial CDP dispatch, or for mobile touch. `DEBUGGER_UNAVAILABLE` is not in the "do not fall back" set. | On Firefox those actions can return `method: "content_fallback"`. That is a DOM event, not a trusted CDP click, and it does not match Chrome's result. Fill, check, and uncheck stay on the debugger and fail. Select and in-page scroll already use the content script on Chrome. |
| `screenshot` and `act_on_screen` | Page and element capture call `Page.captureScreenshot`. The page capture catch already continues to `tabs.captureVisibleTab` unless the error is an image limit or a forbidden CDP error. `act_on_screen` sends CDP mouse, wheel, and text input. | A page screenshot can become a visible-viewport image after the tab is activated. Element clips, capture beyond the viewport, and screen actions do not have that fallback. |
| `get_ax_tree` | `Accessibility.getFullAXTree` has no extension equivalent. | The accessibility snapshot tool fails. Agents that read the page through that tree do not see the Chrome result. |
| `read_console_messages`, `network_watch`, `network_recent`, `network_body`, `wait_for_response`, `wait_for_network_idle` | These subscribe to CDP `Runtime` and `Network` events. Firefox still has blocking `webRequest` and `webRequest.filterResponseData`. | Network and console tools fail. A `webRequest` replacement would observe a different set of requests and bodies. |
| `set_page_mode` | Mobile mode uses CDP emulation: viewport, touch, and user agent. | Mobile page mode cannot be applied. Touch input in element actions follows that mode and stays unavailable. |
| PDF creation | `document` PDF rendering opens a tab and calls `Page.printToPDF`. | PDF artifacts fail with the debugger error. Other document formats that encode bytes in the background keep their current path. |
| Child frames and cross-origin iframes | CDP uses `Page.getFrameTree`, `DOM.getFrameOwner`, and `Target.setAutoAttach`. Content scripts are top-frame only. | iframe targets that Chrome resolves through CDP fail. Top-frame content-script reads continue. |
| Git Skill download through CDP | `Network.loadNetworkResource` and `IO.read` fetch an archive from a tab. | Importing a Skill repository through that page path fails. |
| Provider and Skill header rules | Session rules set `initiatorDomains` to `runtime.id`. In Chrome that id is the `chrome-extension` host. In Firefox `runtime.id` is the email-shaped add-on id, and the origin host is an internal UUID. | User-Agent and Skill managed headers can miss the extension's own requests. Kimi, DashScope, ChatGPT, and OpenCode calls that require `qz-agent/1.0.0` can fail until the condition is confirmed. |
| `desktopCapture.chooseDesktopMedia` | Not a Firefox permission or API. The recorder already returns "desktopCapture is unavailable" when the method is missing. `getDisplayMedia` is a different picker. | Case recording does not start. Replacing the picker changes the chooser, the stream id, and the audio options. |
| Shortcut settings | The settings buttons open `chrome://extensions/shortcuts`. | The buttons do not open Firefox's shortcut page (`about:addons`). Display of `commands.getAll` can still show the current binding. |
| File URL instructions | The `FILE_ACCESS_REQUIRED` text tells the user to enable file access at `chrome://extensions`. | On Firefox 153+ the real control is the add-on's local-file permission. The current sentence sends the user to a Chrome URL. |
| MCP reconnect alarm | `periodInMinutes: 0.5`. Firefox can clamp short alarm periods through its alarm minimum. | CLI reconnect after the background sleeps can be slower than in Chrome. The one-minute automation alarm is inside the portable floor. |
| Completion notification click and session import | Both call `sidePanel.open` on the user-gesture turn so Chrome accepts the open. | The click and the import message are delivered. The sidebar stays closed, so the user does not land in the imported or finished session until they open the sidebar themselves. |
| Store host permissions and data collection | Temporary loading grants install-time permissions silently. AMO requires `browser_specific_settings.gecko.data_collection_permissions` for new submissions. This manifest omits that field. Users can revoke host access later in the add-on manager. | A signed Firefox listing needs an explicit data-collection list before upload. The permission doorhanger and revocation UI are Firefox copy. |

## Not available on Firefox

These have no API that preserves the current behavior. They are blocked, not quietly replaced.

| Chrome API or feature | Firefox reality | User-visible effect |
| --- | --- | --- |
| `chrome.debugger.attach` / `sendCommand` / `detach` | Permission `version_added` is false. No debugger API page. | Any tool that needs a debugger lease fails with `DEBUGGER_UNAVAILABLE` when it does not already catch that error. The "debugging this browser" infobar cannot be shown. |
| CDP domains used by qz: `Accessibility.*`, `DOM.*`, `Emulation.*`, `Input.*`, `IO.*`, `Network.*`, `Page.captureScreenshot`, `Page.printToPDF`, `Page.getFrameTree`, `Runtime.evaluate` on a debugger execution context, `Target.setAutoAttach` | No extension binding. | Accessibility snapshots, trusted input, element geometry from the debugger, mobile emulation, response bodies, full-page screenshots, PDF print, and out-of-process frame attach do not run. |
| `chrome.offscreen` | No API and no permission. | The offscreen document is never created. Inner `run_script`, SVG rasterization, and the keepalive ping do not run. |
| `chrome.sidePanel` | `version_added` is false for the API and the permission. | Per-tab panels, `setPanelBehavior`, and `sidePanel.open({ windowId \| tabId })` do not exist. `sidebar_action` is a different surface and is listed above for confirmation. |
| `chrome.desktopCapture` | Not implemented. | The Chrome desktop chooser, including its window and audio result, cannot be opened. |
| Manifest `key` | Ignored as a Chrome id mechanism. Firefox ids are gecko ids. | Unpacked and store installs do not share Chrome's fixed extension id. |
| `background.service_worker` as the running context | Unsupported. The event page is the background. | Service-worker-only lifetime and `clients.matchAll` do not apply. The offscreen existence check already tolerates a missing `clients` global. |
| Sandbox page as a live runner | Declaring the page does not create the offscreen iframe that loads it. | The inner runner stays unavailable even on Firefox 154+, where the sandbox manifest keys exist. |

## Confirmation needed before any behavior change

1. **Sidebar host.** Can the Firefox sidebar stand in for the Chrome side panel? Firefox chooses the side, shows one sidebar at a time, and draws its own frame. This skeleton does not bind the toolbar button, the import flow, notification clicks, or the model-preset shortcut to `sidebarAction`.
2. **Existing debugger catch paths.** Click and press can already return `content_fallback`. Page screenshots can already fall through to `captureVisibleTab`, which activates the tab and captures the viewport. Confirm whether those results must be rejected on Firefox until a matching mechanism exists.
3. **Offscreen work.** `run_script`, SVG conversion, and background keepalive need a DOM host. An event-page document or a hidden window would be a different lifetime and may flash UI. Confirm before either is used.
4. **Page understanding and input.** `get_ax_tree`, mobile page mode, PDF print, CDP network and console capture, `act_on_screen`, and cross-origin iframe targeting have no same-result API.
5. **Case recording.** `getDisplayMedia` is a different picker from `desktopCapture.chooseDesktopMedia`.
6. **Header rules.** `initiatorDomains: [runtime.id]` likely misses Firefox extension requests. Confirm the condition before changing which requests receive `qz-agent/1.0.0` or Skill headers.
7. **Tab groups.** The same calls run on Firefox 139+. The group chrome is Firefox's. The skeleton requires Firefox 139 so the `tabGroups` permission is valid. An older Firefox would need that permission removed.
8. **Chrome URLs in copy.** File-access errors and shortcut buttons still send the user to `chrome://extensions`. Firefox 153+ has its own local-file checkbox, and shortcuts are edited in `about:addons`.
9. **Notifications.** Firefox ignores `requireInteraction` and `priority`. A click does not open the sidebar.
10. **Identity and signing.** The provisional gecko id is `qz-browser-agent@heleifz.github.io`. AMO also requires `data_collection_permissions`, which the temporary manifest omits. Confirm both before a signed build.
11. **Debugging infobar.** Chrome's debugger banner is part of what the user sees while a task drives a page. Firefox cannot show it.

## Out of scope for this skeleton

Chrome's manifest, permissions, side panel opener, and tool paths are unchanged. No fallback was
added or removed. The Firefox package is a second build output so `about:debugging` can load the
shared scripts.
