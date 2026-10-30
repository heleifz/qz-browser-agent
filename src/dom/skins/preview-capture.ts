import type { WelcomeSkin } from '../../shared/skins/model.js';
import type { SkinPreview } from '../../shared/skins/preview.js';

/** Only the owning Background may request a screenshot of this exact editor and revision. */
export function registerSkinPreviewCapture(options: {
  current(): WelcomeSkin | undefined;
  settled(): boolean;
  capture(): Promise<SkinPreview>;
  signal: AbortSignal;
}) {
  if (!chrome.runtime.onMessage || !chrome.tabs?.getCurrent) return;
  let tabId: number | undefined;
  void chrome.tabs.getCurrent().then(tab => { tabId = tab?.id; }).catch(() => {});
  const listener = (message: Record<string, unknown>, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (message?.type !== 'skin_preview_capture' || sender.id !== chrome.runtime.id || sender.tab
      || sender.url !== chrome.runtime.getURL('background/service-worker.js') || tabId === undefined || message.tabId !== tabId
      || typeof message.requestId !== 'string' || message.requestId.length > 100) return false;
    const sessionId = new URL(location.href).searchParams.get('session') || '';
    if (message.sessionId !== sessionId) return false;
    const matches = () => options.current()?.id === message.id && options.current()?.revision === message.revision;
    const reply = { requestId: message.requestId, id: message.id, revision: message.revision };
    void (async () => {
      const deadline = performance.now() + 20000;
      while (!options.signal.aborted && (!matches() || !options.settled()) && performance.now() < deadline) {
        if (options.current() && (options.current()!.id !== message.id || options.current()!.revision > Number(message.revision))) break;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      if (options.signal.aborted || !matches() || !options.settled()) throw new Error('Preview changed');
      const preview = await options.capture();
      if (options.signal.aborted || !matches() || !options.settled()) throw new Error('Preview changed');
      respond({ ...reply, ok: true, preview });
    })().catch(() => respond({ ...reply, ok: false }));
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  options.signal.addEventListener('abort', () => chrome.runtime.onMessage.removeListener(listener), { once: true });
}
