import type { DebuggerCommandScope } from "../tools/cdp-runtime.js";

const RECOVERY_MS = 1000;
const RETRY_MS = 50;
interface Press {
  tabId: number;
  frameId: number;
  mainGeneration: number;
  frameGeneration: number;
  dispatched: boolean;
  signal?: AbortSignal;
  dispose(): void;
}

/** An Enter may replace its document before Firefox acknowledges input or accepts keyUp. */
export function createFirefoxEnterInput(generation: (tabId: number, frameId: number) => number) {
  const presses = new Map<string, Press>();
  const changed = (press: Press) => generation(press.tabId, 0) !== press.mainGeneration
    || generation(press.tabId, press.frameId) !== press.frameGeneration;

  async function send(tabId: number, frameId: number, releasing: boolean,
    prepare: () => Promise<number>, dispatch: (frameId: number) => Promise<unknown>, scope: DebuggerCommandScope) {
    check(scope);
    const key = `${tabId}:${frameId}`;
    let press = presses.get(key);
    if (releasing && press?.signal !== scope.signal) press = undefined;
    if (!releasing) {
      presses.get(key)?.dispose();
      const next: Press = {
        tabId, frameId, mainGeneration: generation(tabId, 0), frameGeneration: generation(tabId, frameId),
        dispatched: false, signal: scope.signal,
        dispose() {
          scope.signal?.removeEventListener("abort", next.dispose);
          if (presses.get(key) === next) presses.delete(key);
        },
      };
      presses.set(key, next);
      scope.signal?.addEventListener("abort", next.dispose, { once: true });
      press = next;
    }
    try {
      // No key was held if preparation failed. A replaced document no longer owns
      // the old key either; do not release into a newly focused page or child frame.
      if (releasing && press && (!press.dispatched || changed(press))) return {};
      const target = await retryProbe(prepare, scope, () => Boolean(releasing && press && changed(press)));
      if (target == null) return {};
      check(scope);
      if (!releasing && press) {
        press.frameId = target;
        press.mainGeneration = generation(tabId, 0);
        press.frameGeneration = generation(tabId, target);
        press.dispatched = true;
      }
      try {
        // Never retry this call: a rejected reply can follow a completed submit.
        return await observe(dispatch(target), scope);
      } catch (error) {
        check(scope);
        if (!press?.dispatched || !frameMissing(error)) throw error;
        const deadline = Date.now() + RECOVERY_MS;
        while (!changed(press)) {
          if (Date.now() >= deadline) throw error;
          await pause(scope);
        }
        check(scope);
        return {};
      }
    } finally {
      if (releasing) press?.dispose();
    }
  }

  return { send, release(tabId: number) {
    for (const press of presses.values()) if (press.tabId === tabId) press.dispose();
  } };
}

function frameMissing(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).includes("Missing host permission for the tab");
}
function check(scope: DebuggerCommandScope) {
  scope.check();
  scope.signal?.throwIfAborted();
}

/** Only the read-only frame route may repeat, with the original error and one deadline. */
async function retryProbe<T>(probe: () => Promise<T>, scope: DebuggerCommandScope, obsolete: () => boolean): Promise<T | null> {
  let deadline = Infinity;
  let original: unknown;
  for (;;) {
    check(scope);
    if (obsolete()) return null;
    if (Date.now() >= deadline) throw original;
    try {
      return await observe(probe(), scope, deadline, original);
    } catch (error) {
      check(scope);
      if (!frameMissing(error)) throw error;
      if (deadline === Infinity) { original = error; deadline = Date.now() + RECOVERY_MS; }
      if (Date.now() >= deadline) throw original;
      await pause(scope);
    }
  }
}

function pause(scope: DebuggerCommandScope) {
  let timer: ReturnType<typeof setTimeout>;
  return observe(new Promise<void>(resolve => { timer = setTimeout(resolve, RETRY_MS); }), scope)
    .finally(() => clearTimeout(timer));
}

/** A late browser reply cannot continue a cancelled or superseded command. */
function observe<T>(operation: Promise<T>, scope: DebuggerCommandScope, deadline = Infinity, failure?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); scope.signal?.removeEventListener("abort", aborted); };
    const aborted = () => { cleanup(); try { check(scope); } catch (error) { reject(error); } };
    scope.signal?.addEventListener("abort", aborted, { once: true });
    if (Number.isFinite(deadline)) timer = setTimeout(() => { cleanup(); reject(failure); }, Math.max(0, deadline - Date.now()));
    operation.then(value => {
      cleanup();
      try { check(scope); resolve(value); } catch (error) { reject(error); }
    }, error => { cleanup(); reject(error); });
    if (scope.signal?.aborted) aborted();
  });
}
