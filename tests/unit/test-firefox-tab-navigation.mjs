import assert from "node:assert/strict";
import { test } from "node:test";
import { installFirefoxTabNavigation } from "../../src/background/firefox/tab-navigation.js";

const event = () => {
  const listeners = [];
  return { listeners, addListener: (callback, filter) => listeners.push({ callback, filter }),
    fire: details => listeners.forEach(({ callback }) => callback(details)) };
};
function fixture() {
  const tab = { id: 1, url: "https://old.test/", status: "loading" };
  const browser = {
    tabs: { async get() { return tab; }, async query() { return [tab]; }, onRemoved: event() },
    webRequest: Object.fromEntries(["onBeforeRequest", "onBeforeRedirect", "onErrorOccurred", "onHeadersReceived"].map(name => [name, event()])),
    webNavigation: { onCommitted: event() },
  };
  installFirefoxTabNavigation(browser);
  return { browser, tab, request: { tabId: 1, requestId: "first", url: "https://new.test/" } };
}

test("Firefox exposes pending main navigation in get/query until commit, not until resources finish", async () => {
  const { browser: b, tab, request } = fixture();
  b.webRequest.onBeforeRequest.fire(request);
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url);
  assert.equal((await b.tabs.query({}))[0].pendingUrl, request.url);
  assert.equal(tab.pendingUrl, undefined, "native browser objects are not mutated");
  assert.deepEqual(b.webRequest.onBeforeRequest.listeners[0].filter.types, ["main_frame"]);
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 1, url: request.url });
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "subframes cannot finish a main navigation");
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: "about:blank" });
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "late initial blank commit cannot erase pendingUrl");
  b.webRequest.onHeadersReceived.fire({ ...request, statusCode: 200 });
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "response headers are not document commit");
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: request.url + "#part" });
  assert.equal((await b.tabs.get(1)).pendingUrl, undefined);
  assert.equal((await b.tabs.get(1)).status, "loading", "slow resources remain readable");
});

test("Firefox navigation events preserve replacement and same-URL reload identity", async () => {
  const { browser: b, request } = fixture();
  b.webRequest.onBeforeRequest.fire(request);
  const replacement = { ...request, requestId: "replacement" };
  b.webRequest.onBeforeRequest.fire(replacement);
  b.webRequest.onErrorOccurred.fire(request);
  b.webRequest.onHeadersReceived.fire({ ...request, statusCode: 204 });
  b.webRequest.onBeforeRedirect.fire({ ...request, redirectUrl: "https://obsolete.test/" });
  assert.equal((await b.tabs.get(1)).pendingUrl, replacement.url);
  b.webRequest.onBeforeRedirect.fire({ ...replacement, redirectUrl: "https://redirected.test/" });
  assert.equal((await b.tabs.get(1)).pendingUrl, "https://redirected.test/");
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: request.url });
  assert.equal((await b.tabs.get(1)).pendingUrl, "https://redirected.test/");
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: "https://redirected.test/" });
  assert.equal((await b.tabs.get(1)).pendingUrl, undefined);
});

for (const end of ["error", "204", "205", "close"]) test(`Firefox pending navigation clears on ${end}`, async () => {
  const { browser: b, request } = fixture();
  b.webRequest.onBeforeRequest.fire(request);
  if (end === "error") b.webRequest.onErrorOccurred.fire(request);
  else if (end === "close") b.tabs.onRemoved.fire(1);
  else b.webRequest.onHeadersReceived.fire({ ...request, statusCode: Number(end) });
  assert.equal((await b.tabs.get(1)).pendingUrl, undefined);
});

test("Firefox pending URL adapter is idempotent and preserves native pendingUrl", async () => {
  const { browser: b, request, tab } = fixture();
  installFirefoxTabNavigation(b);
  assert.equal(b.webRequest.onBeforeRequest.listeners.length, 1);
  b.webRequest.onBeforeRequest.fire(request); tab.pendingUrl = "https://native.test/";
  assert.equal((await b.tabs.get(1)).pendingUrl, tab.pendingUrl);
});

test("Firefox ignores a main-frame request delivered after its document committed", async () => {
  const { browser: b, tab, request } = fixture();
  const committed = { ...request, timeStamp: 200 };
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: request.url, timeStamp: committed.timeStamp });
  b.webRequest.onBeforeRequest.fire({ ...request, timeStamp: 100 });
  tab.url = request.url;
  tab.status = "loading";
  assert.equal((await b.tabs.get(1)).pendingUrl, undefined);
  assert.equal((await b.tabs.query({}))[0].pendingUrl, undefined);
});

test("Firefox subframe commits do not retire a main-frame request", async () => {
  const { browser: b, request } = fixture();
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 1, url: request.url, timeStamp: 500 });
  b.webRequest.onBeforeRequest.fire({ ...request, timeStamp: 100 });
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url);
});

test("Firefox keeps a newer same-URL request pending until that document commits", async () => {
  const { browser: b, tab, request } = fixture();
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: request.url, timeStamp: 100 });
  const reload = { ...request, requestId: "reload", timeStamp: 200 };
  b.webRequest.onBeforeRequest.fire(reload);
  tab.url = request.url;
  tab.status = "complete";
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "status can still be complete when the reload request is recorded");
  tab.status = "loading";
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url);
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: request.url + "#part", timeStamp: 250 });
  assert.equal((await b.tabs.get(1)).pendingUrl, undefined);
  assert.equal((await b.tabs.get(1)).status, "loading", "slow resources remain readable");
});

test("Firefox drops pendingUrl once the completed tab is already showing that URL", async () => {
  const { browser: b, tab, request } = fixture();
  b.webRequest.onBeforeRequest.fire(request);
  tab.url = "https://old.test/";
  tab.status = "complete";
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "a different completed URL is still navigating");
  tab.url = request.url;
  assert.equal((await b.tabs.get(1)).pendingUrl, undefined);
  assert.equal((await b.tabs.get(1)).pendingUrl, undefined);
  b.webRequest.onBeforeRequest.fire(request);
  tab.status = "loading";
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "an in-flight reload stays pending while loading");
});

test("Firefox does not let a late previous request replace the current navigation", async () => {
  const { browser: b, request } = fixture();
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: "about:blank", timeStamp: 200 });
  b.webRequest.onBeforeRequest.fire({ ...request, timeStamp: 100 });
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "an earlier blank commit does not swallow the target request");
  b.webNavigation.onCommitted.fire({ tabId: 1, frameId: 0, url: "https://old.test/", timeStamp: 100 });
  b.webRequest.onBeforeRequest.fire({ ...request, requestId: "current", timeStamp: 150 });
  b.webRequest.onBeforeRequest.fire({ tabId: 1, requestId: "stale", url: "https://old.test/", timeStamp: 80 });
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url);
  b.tabs.onRemoved.fire(1);
  b.webRequest.onBeforeRequest.fire({ ...request, timeStamp: 50 });
  assert.equal((await b.tabs.get(1)).pendingUrl, request.url, "closing the tab forgets commit timestamps");
});
