const HARNESS_BODY = String.raw`
const win = Cu.waiveXrays(content);
if (!win.__qzLiveHarness) {
  const chromeApi = win.chrome || win.browser;
  let port = chromeApi.runtime.connect({ name: "sidepanel" });
  const events = [];
  const waiters = new Set();
  let sequence = 0;
  const scrub = (value) => JSON.parse(JSON.stringify(value, (key, item) => (
    /api.?key|authorization|token|secret/i.test(key) ? "[redacted]" : item
  )));
  const matches = (message, expected) => Object.entries(expected || {}).every(([key, value]) => message?.[key] === value);
  const settle = (message) => {
    for (const waiter of [...waiters]) {
      if (waiter.after > events.length - 1 || !waiter.predicate(message)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  };
  port.onMessage.addListener(raw => {
    if (raw?.type === "dynamic_context_request") {
      try {
        port.postMessage({ type: "dynamic_context_response", requestId: raw.requestId, context: {} });
      } catch (_error) {}
    }
    const message = scrub(raw);
    events.push(message);
    settle(message);
  });
  const wait = (expected, after = 0, timeoutMs = 30_000, predicate = null) => {
    const test = predicate || (message => matches(message, expected));
    const existing = events.slice(after).find(test);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        after,
        predicate: test,
        resolve,
        timer: content.setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error("timed out waiting for event"));
        }, timeoutMs),
      };
      waiters.add(waiter);
    });
  };
  const send = (type, payload = {}) => port.postMessage({ type, ...payload });
  const request = async (type, payload, responseType, timeoutMs, acceptedTypes = [responseType]) => {
    const requestId = "live_" + Date.now().toString(36) + "_" + (++sequence);
    const after = events.length;
    send(type, { ...payload, requestId });
    const failures = ["error", "request_failed", "transport_error"];
    const response = await wait({}, after, timeoutMs, message => message?.requestId === requestId
      && (acceptedTypes.includes(message.type) || failures.includes(message.type)));
    if (failures.includes(response.type) && !acceptedTypes.includes(response.type)) {
      throw new Error(type + " failed (" + (response.code || response.type) + "): " + (response.message || "request failed"));
    }
    return response;
  };
  win.__qzLiveHarness = { send, wait, request, count: () => events.length, eventsSince: index => events.slice(index),
    toolEndsSince: index => events.slice(index).filter(message => message?.type === "tool_execution_end") };
}
const windows = await (win.chrome || win.browser).windows.getAll({ windowTypes: ["normal"] });
const windowId = windows[0]?.id ?? null;
if (windowId === null) throw new Error("no browser window for sidepanel_attach");
await win.__qzLiveHarness.request("sidepanel_attach", { windowId }, "sidepanel_attached", 30_000);
return { installed: true, windowId };
`;

export async function installFirefoxLiveHarness(session) {
  return session.extension("sidebar", HARNESS_BODY);
}

export function callFirefoxHarness(session, expression) {
  return session.extension("sidebar", `
    const harness = Cu.waiveXrays(content).__qzLiveHarness;
    if (!harness) throw new Error("sidebar live harness is not installed");
    return await (${expression});
  `);
}
