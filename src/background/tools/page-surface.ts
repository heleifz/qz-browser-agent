type Send = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

async function outerSize(tabId: number) {
  try {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const view = globalThis as unknown as { outerWidth: number; outerHeight: number };
        return { width: view.outerWidth, height: view.outerHeight };
      },
    });
    const value = frame?.result;
    if (!value) return null;
    return { width: Number(value.width) || 0, height: Number(value.height) || 0 };
  } catch {
    return null;
  }
}

function laidOut(size: { width: number; height: number } | null) {
  return !!size && size.width > 0 && size.height > 0;
}

/** A background tab drops CDP mouse input until Chrome has composited it. One capture does that. */
export async function ensurePageSurface(tabId: number, send: Send) {
  if (laidOut(await outerSize(tabId))) return;
  try {
    await send("Page.captureScreenshot", { format: "jpeg", quality: 1, fromSurface: true, captureBeyondViewport: false });
  } catch {
    // The discarded frame only nudges layout. The tab stays in the background.
  }
}

/** Count trusted input on the live document. Null means the page could not be observed. */
export async function armPageInputReceipt(tabId: number) {
  await receipt(tabId, true);
}

export async function readPageInputReceipt(tabId: number) {
  return receipt(tabId, false);
}

async function receipt(tabId: number, arm: boolean) {
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
          for (const type of ["mousedown", "touchstart"]) doc.addEventListener(type, count, true);
        }
        if (shouldArm) root.__qzInputReceipt = 0;
        return root.__qzInputReceipt || 0;
      },
    });
    return typeof frame?.result === "number" ? frame.result : null;
  } catch {
    return null;
  }
}
