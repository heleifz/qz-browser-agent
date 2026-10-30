import type { WelcomeSkin } from '../../shared/skins/model.js';
import { sameSkinData, skinError } from '../../shared/skins/model.js';
import { glbDataBytes } from '../../shared/skins/glb.js';
import { skinT } from '../../shared/skins/messages.js';
import { readSkinPreview, type SkinPreview } from '../../shared/skins/preview.js';
import { clearWelcomePreview, writeWelcomePreview, type WelcomePreview } from './welcome-preview.js';

export function skinImageUrl(source: string): string {
  if (source === 'builtin:logo-day' || source === 'builtin:logo-night') {
    return chrome.runtime.getURL(`icons/${source.slice(8)}.png`);
  }
  return source;
}
export function createSkinViewer(container: HTMLElement, options: { onStatus?(ready: boolean, message?: string): void; onFileDrag?(): void;
  welcomePreview?: WelcomePreview; rememberView?: boolean } = {}) {
  const lifetime = new AbortController(), token = crypto.randomUUID();
  const theme = matchMedia('(prefers-color-scheme: dark)'), motion = matchMedia('(prefers-reduced-motion: reduce)');
  let skin: WelcomeSkin | undefined, iframe: HTMLIFrameElement | undefined, image: HTMLImageElement | undefined;
  let visible = true, inView = true, ready = false, generation = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let failed = false, fatal = false;
  let presented = false, preparing = 0, pendingPreparation = false, rendering = false;
  let poster: HTMLImageElement | undefined, restored = options.welcomePreview;
  const captures = new Map<string, { resolve(preview: SkinPreview): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const indicator = document.createElement('div'), spinner = document.createElement('span'), label = document.createElement('span');
  indicator.className = 'skin-viewer-loading'; indicator.setAttribute('role', 'status'); indicator.setAttribute('aria-live', 'polite'); indicator.hidden = true;
  spinner.className = 'skin-viewer-spinner'; spinner.setAttribute('aria-hidden', 'true'); indicator.append(spinner, label);
  let modelKeys = new Map<string, string>();
  const signal = lifetime.signal;
  if (restored) {
    poster = document.createElement('img'); poster.className = 'skin-viewer-poster'; poster.src = restored.image;
    poster.alt = restored.name; poster.draggable = false; container.replaceChildren(poster);
  }
  const observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting !== false; visibility(); });
  observer.observe(container);
  function post(data: Record<string, unknown>, transfer: Transferable[] = []) { iframe?.contentWindow?.postMessage({ channel: 'qz-skin', token, ...data }, '*', transfer); }
  function visibility() { post({ type: 'visibility', visible: visible && inView && !document.hidden }); }
  function setLoading(value: boolean) {
    const show = value && skin?.visual.type !== 'image2d';
    container.setAttribute('aria-busy', String(Boolean(show)));
    indicator.hidden = !show || !!poster;
    label.textContent = show ? skinT(presented ? 'refreshingPreview' : 'loading') : '';
    if (show && indicator.parentElement !== container) container.append(indicator);
  }
  function load() {
    if (!ready || !skin || skin.visual.type === 'image2d') return;
    const nextKeys = new Map<string, string>(), modelBuffers: Record<string, ArrayBuffer> = {};
    const reference = (src: string) => {
      let key = nextKeys.get(src) || modelKeys.get(src);
      if (!key) { key = `qz-model:${crypto.randomUUID()}`; modelBuffers[key] = glbDataBytes(src).buffer; }
      nextKeys.set(src, key); return key;
    };
    try {
      const visual = skin.visual.type === 'model3d' ? { ...skin.visual, src: reference(skin.visual.src) }
        : { ...skin.visual, ...(skin.visual.models ? { models: Object.fromEntries(Object.entries(skin.visual.models)
          .map(([id, model]) => [id, { ...model, src: reference(model.src) }])) } : {}) };
      post({ type: 'load', visual, assets: skin.assets, revision: generation, modelBuffers,
        modelKeys: [...nextKeys.values()], visible: visible && inView && !document.hidden,
        reducedMotion: motion.matches, ...(restored ? { view: restored.view } : {}) }, Object.values(modelBuffers));
      modelKeys = nextKeys;
    } catch (error) {
      clearTimeout(timer); failed = true; rendering = false; setLoading(false);
      options.onStatus?.(false, String(error instanceof Error ? error.message : error));
    }
  }
  function clear(keepPoster = false) {
    clearTimeout(timer); post({ type: 'dispose' }); iframe?.remove(); image?.remove();
    iframe = undefined; image = undefined; ready = false; modelKeys.clear();
    if (!keepPoster) { poster?.remove(); poster = undefined; restored = undefined; }
    container.replaceChildren(...(poster ? [poster] : [])); presented = false; rendering = false; pendingPreparation = false; setLoading(false);
    for (const pending of captures.values()) { clearTimeout(pending.timer); pending.reject(skinError('SKIN_PREVIEW_UNAVAILABLE')); }
    captures.clear();
  }
  async function capture(maxSize = 1024, format: 'png' | 'webp' = 'png'): Promise<SkinPreview> {
    const current = generation;
    const deadline = performance.now() + 20000;
    while (!signal.aborted && current === generation && !failed && (rendering || pendingPreparation || !presented) && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (signal.aborted || current !== generation || failed || rendering || pendingPreparation) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
    const edge = Math.max(64, Math.min(1024, maxSize));
    if (image) {
      if (!image.complete || !image.naturalWidth) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
      const canvas = document.createElement('canvas'), scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { image: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
    }
    if (!presented || !iframe) throw skinError('SKIN_PREVIEW_UNAVAILABLE');
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { captures.delete(requestId); reject(skinError('SKIN_PREVIEW_UNAVAILABLE')); }, 3000);
      captures.set(requestId, { resolve, reject, timer }); post({ type: 'capture', requestId, maxSize: edge, format });
    });
  }
  async function remember() {
    if (!options.rememberView || !skin || rendering || !presented) return;
    const current = skin, epoch = generation;
    try {
      const preview = await capture(512, 'webp');
      if (!signal.aborted && epoch === generation && current === skin) writeWelcomePreview(current, preview);
    } catch { /* The live viewer is independent of its optional startup image. */ }
  }
  window.addEventListener('message', event => {
    if (event.source !== iframe?.contentWindow || event.data?.channel !== 'qz-skin') return;
    if (event.data.type === 'ready') { ready = true; modelKeys.clear(); load(); return; }
    if (event.data.token !== token || event.data.revision !== generation) return;
    if (event.data.type === 'capture') {
      const pending = captures.get(event.data.requestId);
      if (!pending) return;
      captures.delete(event.data.requestId); clearTimeout(pending.timer);
      try { pending.resolve(readSkinPreview(event.data.preview)); } catch { pending.reject(skinError('SKIN_PREVIEW_UNAVAILABLE')); }
      return;
    }
    if (event.data.type === 'view-changed') { void remember(); return; }
    if (event.data.type === 'file-drag') { options.onFileDrag?.(); return; }
    if (event.data.type === 'loaded') {
      clearTimeout(timer); presented = true; rendering = false;
      poster?.remove(); poster = undefined; restored = undefined;
      setLoading(pendingPreparation); options.onStatus?.(true); void remember();
    }
    else if (event.data.type === 'error') {
      clearTimeout(timer); failed = true; fatal = event.data.fatal === true; rendering = false; setLoading(false);
      const message = String(event.data.message || '').slice(0, 500);
      options.onStatus?.(false, event.data.retained ? `${skinT('previewRetained')} ${message}` : message);
    }
  }, { signal });
  document.addEventListener('visibilitychange', visibility, { signal });
  theme.addEventListener('change', () => { if (image && skin?.visual.type === 'image2d') image.src = skinImageUrl(theme.matches && skin.visual.darkSrc || skin.visual.src); }, { signal });
  motion.addEventListener('change', () => post({ type: 'motion', reducedMotion: motion.matches }), { signal });
  container.addEventListener('keydown', event => {
    if (!iframe || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); post(event.key === 'Home' ? { type: 'reset' } : { type: 'rotate', amount: event.key === 'ArrowLeft' ? -.15 : .15 });
  }, { signal });
  return {
    capture,
    setSkin(next: WelcomeSkin) {
      if (signal.aborted) return;
      container.setAttribute('aria-label', next.name);
      if (iframe) iframe.title = next.name;
      if (image) image.alt = next.name;
      if (!failed && skin?.id === next.id && sameSkinData(skin.visual, next.visual) && sameSkinData(skin.assets, next.assets)) { skin = next; void remember(); return; }
      const reuse = iframe && skin?.id === next.id && !fatal && next.visual.type !== 'image2d';
      skin = next; generation++; clearTimeout(timer);
      if (!reuse) clear(restored?.id === next.id && restored.revision === next.revision && next.visual.type !== 'image2d');
      if (options.rememberView && (!restored || next.visual.type === 'image2d')) clearWelcomePreview();
      failed = false; fatal = false; options.onStatus?.(false);
      container.dataset.visual = next.visual.type;
      if (next.visual.type === 'image2d') {
        container.removeAttribute('tabindex');
        image = document.createElement('img'); image.alt = next.name; image.draggable = false;
        image.onload = () => { presented = true; options.onStatus?.(true); };
        image.onerror = () => options.onStatus?.(false, skinT('SKIN_IMAGE_INVALID'));
        image.src = skinImageUrl(theme.matches && next.visual.darkSrc || next.visual.src);
        container.append(image);
      } else {
        container.tabIndex = 0;
        rendering = true;
        setLoading(true);
        timer = setTimeout(() => {
          post({ type: 'cancel' }); failed = true; rendering = false; setLoading(false);
          options.onStatus?.(false, skinT('fallback'));
        }, 20000);
        if (reuse) load();
        else {
          iframe = document.createElement('iframe'); iframe.title = next.name;
          iframe.setAttribute('sandbox', 'allow-scripts'); iframe.setAttribute('referrerpolicy', 'no-referrer');
          iframe.src = chrome.runtime.getURL('dom/skins/sandbox.html');
          container.append(iframe);
        }
      }
    },
    beginUpdate() {
      const ticket = ++preparing; pendingPreparation = true;
      setLoading(true); post({ type: 'pause', paused: true });
      return () => {
        if (signal.aborted || ticket !== preparing) return;
        pendingPreparation = false; setLoading(rendering);
        if (!rendering) post({ type: 'pause', paused: false });
      };
    },
    setVisible(value: boolean) { visible = value; visibility(); },
    reset() { post({ type: 'reset' }); },
    dispose() { lifetime.abort(); observer.disconnect(); clear(); },
  };
}
