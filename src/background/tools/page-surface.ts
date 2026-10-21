import type { ToolContext } from "../../sdk/background.js";

export interface PageSurface {
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  visibilityState: string;
}

type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export function pageSurfaceReady(surface: PageSurface | null): boolean {
  return !!surface && surface.outerWidth > 0 && surface.outerHeight > 0;
}

/** A background tab can report a zero outer size until Chrome has composited it. */
export async function readPageSurface(tabId: number): Promise<PageSurface | null> {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const view = globalThis as unknown as {
          outerWidth: number; outerHeight: number; innerWidth: number; innerHeight: number;
          document: { visibilityState: string };
        };
        return {
          outerWidth: view.outerWidth,
          outerHeight: view.outerHeight,
          innerWidth: view.innerWidth,
          innerHeight: view.innerHeight,
          visibilityState: view.document.visibilityState,
        };
      },
    });
    const value = frame?.result;
    if (!value) return null;
    return {
      outerWidth: Number(value.outerWidth) || 0,
      outerHeight: Number(value.outerHeight) || 0,
      innerWidth: Number(value.innerWidth) || 0,
      innerHeight: Number(value.innerHeight) || 0,
      visibilityState: String(value.visibilityState || ""),
    };
  } catch {
    return null;
  }
}

/**
 * Give a background tab a real viewport before mouse input or a screenshot.
 * A discarded capture is enough on current Chrome; bringing the tab forward is the fallback.
 */
export async function ensurePageSurface(tabId: number, send: Send, _context: ToolContext = {}): Promise<PageSurface | null> {
  let surface = await readPageSurface(tabId);
  if (pageSurfaceReady(surface)) return surface;
  try {
    await send("Page.captureScreenshot", { format: "jpeg", quality: 1, fromSurface: true, captureBeyondViewport: false });
  } catch {
    // The discarded frame only nudges layout. The caller still attempts the real operation.
  }
  await settleLayout(send);
  surface = await readPageSurface(tabId);
  if (pageSurfaceReady(surface)) return surface;
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // The tab may already be closing.
  }
  for (let attempt = 0; attempt < 8 && !pageSurfaceReady(surface); attempt += 1) {
    await delay(50);
    surface = await readPageSurface(tabId);
  }
  await settleLayout(send);
  return surface;
}

async function settleLayout(send: Send) {
  let previous = await layoutSize(send);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await delay(120);
    const next = await layoutSize(send);
    if (previous && next && previous.width > 0 && previous.height > 0
      && previous.width === next.width && previous.height === next.height) return;
    previous = next;
  }
}

async function layoutSize(send: Send): Promise<{ width: number; height: number } | null> {
  try {
    const metrics = record(await send("Page.getLayoutMetrics", {}));
    const raw = record(metrics.cssVisualViewport || metrics.visualViewport || metrics.cssLayoutViewport || metrics.layoutViewport);
    const width = Number(raw.clientWidth) || 0;
    const height = Number(raw.clientHeight) || 0;
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Count trusted input on the live page document. Returns null when the page cannot be observed. */
export async function armPageInputReceipt(tabId: number): Promise<number | null> {
  return runReceipt(tabId, true);
}

export async function readPageInputReceipt(tabId: number): Promise<number | null> {
  return runReceipt(tabId, false);
}

async function runReceipt(tabId: number, arm: boolean): Promise<number | null> {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [arm],
      func: (shouldArm: boolean) => {
        const root = globalThis as unknown as {
          __qzInputReceipt?: number;
          document: {
            __qzInputReceiptBound?: boolean;
            addEventListener: (type: string, listener: (event: { isTrusted: boolean }) => void, capture: boolean) => void;
          };
        };
        const doc = root.document;
        if (!doc.__qzInputReceiptBound) {
          doc.__qzInputReceiptBound = true;
          const count = (event: { isTrusted: boolean }) => {
            if (event.isTrusted) root.__qzInputReceipt = (root.__qzInputReceipt || 0) + 1;
          };
          for (const type of ["pointerdown", "mousedown", "click", "touchstart"]) doc.addEventListener(type, count, true);
        }
        if (shouldArm) root.__qzInputReceipt = 0;
        return root.__qzInputReceipt || 0;
      },
    });
    const count = frame?.result;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
