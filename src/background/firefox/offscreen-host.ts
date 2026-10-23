/** Host run_script, SVG raster, and the keepalive in a hidden frame of the event page. */

export function installOffscreenHost(chromeApi: OffscreenChrome, doc: HostDocument | undefined = hostDocument()): void {
  if (typeof chromeApi.offscreen?.createDocument === "function") return;
  const path = "offscreen.html";
  let frame: HostFrame | null = null;
  let windowId: number | null = null;
  const url = () => chromeApi.runtime?.getURL?.(path) || path;
  const hasDocument = async () => {
    if (frame?.isConnected) return true;
    if (windowId == null || !chromeApi.windows?.get) return false;
    try {
      await chromeApi.windows.get(windowId);
      return true;
    } catch {
      windowId = null;
      return false;
    }
  };
  const createDocument = async () => {
    if (await hasDocument()) return;
    const parent = doc?.documentElement;
    if (parent && doc?.createElement) {
      const next = doc.createElement("iframe");
      next.src = url();
      next.hidden = true;
      if (next.style) next.style.cssText = "position:absolute;width:0;height:0;border:0;";
      const loaded = new Promise<void>((resolve, reject) => {
        next.addEventListener?.("load", () => resolve(), { once: true });
        next.addEventListener?.("error", () => reject(new Error("Firefox offscreen frame failed to load")), { once: true });
      });
      parent.appendChild(next);
      frame = next;
      await loaded;
      return;
    }
    if (!chromeApi.windows?.create) throw new Error("Firefox offscreen host has no document");
    console.info("[轻舟] firefox offscreen uses a minimized window");
    const created = await chromeApi.windows.create({ url: url(), type: "popup", state: "minimized", focused: false, width: 200, height: 200 });
    windowId = Number(created?.id ?? -1);
  };
  chromeApi.offscreen = {
    createDocument,
    hasDocument,
    Reason: { BLOBS: "BLOBS", USER_MEDIA: "USER_MEDIA", AUDIO_PLAYBACK: "AUDIO_PLAYBACK" },
  };
}

function hostDocument(): HostDocument | undefined {
  return (globalThis as { document?: HostDocument }).document;
}

interface HostFrame {
  src: string; hidden?: boolean; isConnected?: boolean; style?: { cssText: string };
  addEventListener?(type: string, listener: () => void, options?: { once?: boolean }): void;
}
interface HostDocument {
  documentElement: { appendChild(node: HostFrame): void } | null;
  createElement(tag: string): HostFrame;
}
interface OffscreenChrome {
  runtime?: { getURL?(path: string): string };
  offscreen?: { createDocument?: () => unknown; hasDocument?: () => unknown; Reason?: unknown };
  windows?: {
    get?(id: number): Promise<unknown>;
    create?(options: { url: string; type: string; state: string; focused: boolean; width: number; height: number }): Promise<{ id?: number } | undefined>;
  };
}
