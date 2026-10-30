import { sameSkinData, skinError, type WelcomeSkin, type SkinModel } from '../../shared/skins/model.js';
import { skinT as t } from '../../shared/skins/messages.js';
import type { GlbInfo } from '../../shared/skins/glb.js';
import type { SkinCamera } from '../../shared/skins/preview.js';
import { createSkinViewer } from './viewer.js';
import { skinRequest } from './client.js';

const el = <T extends HTMLElement>(id: string) => document.getElementById(`skin-${id}`) as T;
type Viewer = ReturnType<typeof createSkinViewer>;
interface StudioToolsOptions {
  viewer: Viewer; signal: AbortSignal;
  current(): WelcomeSkin | undefined;
  character(): string;
  selectCharacter(id: string): void;
  modelInfo(src: string): GlbInfo;
  update(patch: Record<string, unknown>): Promise<void>;
  run(operation: () => Promise<void>): Promise<unknown>;
  status(key: Parameters<typeof t>[0]): void;
}

/** Studio-only camera and photography controls; the welcome viewer remains rotation-only. */
export function createStudioTools(options: StudioToolsOptions) {
  const { viewer, signal } = options;
  let camera: SkinCamera = 'full', identity = '', ready = false, busy = false;
  let thumbnailKey: unknown, thumbnailEpoch = 0, thumbnailPending = false;
  let comparisonViewer: Viewer | undefined, comparisonHost: HTMLElement | undefined, comparisonEpoch = 0;
  const dialog = el<HTMLDialogElement>('comparison');
  const selectedModel = (): SkinModel | undefined => {
    const visual = options.current()?.visual;
    return visual?.type === 'model3d' ? visual : visual?.type === 'scene3d' ? visual.models?.[options.character()] : undefined;
  };
  function setCamera(preset: SkinCamera) {
    cameraChanged(preset); viewer.camera(preset, options.character());
  }
  function cameraChanged(preset: SkinCamera) {
    camera = preset;
    for (const button of el('cameras').querySelectorAll<HTMLElement>('[data-camera]')) button.setAttribute('aria-pressed', String(button.dataset.camera === preset));
  }
  el('cameras').addEventListener('click', event => {
    const preset = (event.target as Element).closest<HTMLElement>('[data-camera]')?.dataset.camera as SkinCamera | undefined;
    if (preset) setCamera(preset);
  }, { signal });
  el<HTMLSelectElement>('focus-character').addEventListener('change', event => {
    options.selectCharacter((event.target as HTMLSelectElement).value); setCamera(camera);
  }, { signal });
  const labels: Record<string, Parameters<typeof t>[0]> = { happy: 'expressionHappy', angry: 'expressionAngry', sad: 'expressionSad',
    relaxed: 'expressionRelaxed', surprised: 'expressionSurprised', blink: 'expressionBlink', blinkLeft: 'expressionBlinkLeft', blinkRight: 'expressionBlinkRight' };
  function expressionNames(model: SkinModel) {
    const supported = options.modelInfo(model.src).vrm?.expressions || [];
    return [...Object.keys(labels).filter(name => supported.includes(name)),
      ...supported.filter(name => !Object.hasOwn(labels, name) && !/^(neutral|aa|ih|ou|ee|oh|lookUp|lookDown|lookLeft|lookRight)$/.test(name))].slice(0, 10);
  }
  async function thumbnails(epoch: number) {
    const character = options.character();
    for (const button of el('expression-list').querySelectorAll<HTMLButtonElement>('button')) {
      if (signal.aborted || epoch !== thumbnailEpoch || !ready) return;
      if (button.querySelector('img')) continue;
      try {
        const name = button.dataset.expression!;
        const preview = await viewer.capture(160, 'webp', { camera: 'close', character, square: true,
          ...(name === '@original' ? { originalExpression: true } : { expression: name }) });
        if (signal.aborted || epoch !== thumbnailEpoch) return;
        const image = document.createElement('img'); image.src = preview.image; image.alt = ''; image.draggable = false;
        button.querySelector('.skin-expression-preview')?.replaceChildren(image);
      } catch { return; }
    }
  }
  function refreshExpressions() {
    const model = selectedModel(), names = model ? expressionNames(model) : [];
    el('expressions').hidden = !names.length;
    if (!model || !names.length) { thumbnailEpoch++; thumbnailKey = undefined; return; }
    const skin = options.current()!;
    const strip = (spec: SkinModel) => { const { expressions: _, ...rest } = spec; return rest; };
    const visual = skin.visual.type === 'model3d' ? strip(skin.visual) : skin.visual.type === 'scene3d'
      ? { ...skin.visual, models: Object.fromEntries(Object.entries(skin.visual.models || {}).map(([id, spec]) => [id, strip(spec)])) } : skin.visual;
    const key = { id: skin.id, visual, assets: skin.assets, character: options.character() };
    if (!sameSkinData(thumbnailKey, key)) {
      thumbnailKey = key; thumbnailEpoch++; thumbnailPending = true;
      const list = el('expression-list'); list.replaceChildren();
      for (const name of ['@original', '', ...names]) {
        const button = document.createElement('button'); button.className = 'skin-expression'; button.dataset.expression = name;
        const label = name === '@original' ? t('expressionOriginal') : !name ? t('expressionNeutral') : labels[name] ? t(labels[name]!) : name;
        button.title = label; button.setAttribute('aria-label', label);
        const preview = document.createElement('span'); preview.className = 'skin-expression-preview'; preview.setAttribute('aria-hidden', 'true');
        const caption = document.createElement('span'); caption.textContent = label;
        button.append(preview, caption); list.append(button);
      }
    }
    const values = model.expressions || {}, nonzero = Object.entries(values).filter(([, value]) => value !== 0);
    const active = !Object.keys(values).length ? '@original' : !nonzero.length ? '' : nonzero.length === 1 && nonzero[0]![1] === 1 ? nonzero[0]![0] : undefined;
    for (const button of el('expression-list').querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.expression === active)); button.disabled = busy || !ready;
    }
    if (ready && thumbnailPending) { thumbnailPending = false; void thumbnails(thumbnailEpoch); }
  }
  el('expression-list').addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-expression]');
    const model = selectedModel(), character = options.character(), skin = options.current();
    if (!button || !model || !skin) return;
    const name = button.dataset.expression!;
    const expressions = name === '@original' ? {} : Object.fromEntries((options.modelInfo(model.src).vrm?.expressions || []).map(key => [key, key === name ? 1 : 0]));
    void options.run(async () => {
      if (options.current()?.id !== skin.id || options.character() !== character) return;
      await options.update({ visual: skin.visual.type === 'model3d' ? { type: 'model3d', expressions }
        : { type: 'scene3d', models: { [character]: { expressions } } } });
    });
  }, { signal });
  for (const portrait of [false, true]) el(portrait ? 'portrait' : 'photo').addEventListener('click', () => void options.run(async () => {
    const skin = options.current(); if (!skin) return;
    const preview = await viewer.capture(1024, 'png', portrait ? { camera: 'close', character: options.character(), square: true } : {});
    if (signal.aborted || options.current() !== skin) return;
    const anchor = document.createElement('a'); anchor.href = preview.image;
    anchor.download = `${skin.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80)}${portrait ? '-portrait' : ''}.png`;
    anchor.click(); options.status('photographed');
  }), { signal });
  function releaseComparison() {
    comparisonEpoch++; comparisonViewer?.dispose(); comparisonViewer = undefined; comparisonHost?.remove(); comparisonHost = undefined;
    el<HTMLImageElement>('compare-before').removeAttribute('src'); el<HTMLImageElement>('compare-after').removeAttribute('src');
  }
  dialog.addEventListener('close', releaseComparison, { signal });
  el('close-comparison').addEventListener('click', () => dialog.close(), { signal });
  el('compare').addEventListener('click', () => void options.run(async () => {
    const skin = options.current(); if (!skin) return;
    releaseComparison(); const epoch = comparisonEpoch;
    el('comparison-images').hidden = true; el('comparison-loading').hidden = false; dialog.showModal();
    try {
      const { skin: saved } = await skinRequest<{ skin: WelcomeSkin }>({ action: 'get', id: skin.id, saved: true }, signal);
      const after = await viewer.capture();
      if (epoch !== comparisonEpoch || signal.aborted) return;
      const bounds = el('viewer').getBoundingClientRect();
      comparisonHost = document.createElement('div'); comparisonHost.className = 'skin-comparison-render qz-skin-viewer';
      comparisonHost.style.width = `${bounds.width}px`; comparisonHost.style.height = `${bounds.height}px`;
      document.body.append(comparisonHost);
      comparisonViewer = createSkinViewer(comparisonHost, { initialView: after.view, still: true });
      comparisonViewer.setSkin(saved); const before = await comparisonViewer.capture();
      const { skin: latest } = await skinRequest<{ skin: WelcomeSkin }>({ action: 'get', id: skin.id }, signal);
      const { skin: latestSaved } = await skinRequest<{ skin: WelcomeSkin }>({ action: 'get', id: skin.id, saved: true }, signal);
      if (epoch !== comparisonEpoch || signal.aborted) return;
      if (latest.revision !== skin.revision || !sameSkinData(latestSaved, saved)) throw skinError('SKIN_CONFLICT');
      el<HTMLImageElement>('compare-before').src = before.image; el<HTMLImageElement>('compare-after').src = after.image;
      el<HTMLImageElement>('compare-before').alt = t('compareBefore'); el<HTMLImageElement>('compare-after').alt = t('compareAfter');
      el('comparison-images').hidden = false; el('comparison-loading').hidden = true;
    } catch (error) {
      if (epoch !== comparisonEpoch || signal.aborted) return;
      dialog.close(); throw error;
    } finally { comparisonViewer?.dispose(); comparisonViewer = undefined; comparisonHost?.remove(); comparisonHost = undefined; }
  }), { signal });
  signal.addEventListener('abort', () => { releaseComparison(); dialog.close(); }, { once: true });
  return { cameraChanged, refresh(state: { busy: boolean; ready: boolean; modified: boolean }) {
    // A quick edit can invalidate an in-flight capture. Resume unfinished thumbnails once
    // the new revision is ready, while retaining completed thumbnails for expression-only edits.
    if (ready && !state.ready) { thumbnailEpoch++; thumbnailPending = true; }
    busy = state.busy; ready = state.ready;
    const skin = options.current(), nextIdentity = `${skin?.id}/${options.character()}`;
    if (identity !== nextIdentity) {
      const sameSkin = identity.split('/')[0] === skin?.id;
      identity = nextIdentity; camera = 'full';
      for (const button of el('cameras').querySelectorAll<HTMLElement>('[data-camera]')) button.setAttribute('aria-pressed', String(button.dataset.camera === camera));
      if (dialog.open) dialog.close();
      if (ready && sameSkin) setCamera('full');
    }
    const is3d = !!skin && skin.visual.type !== 'image2d'; el('cameras').hidden = !is3d;
    for (const button of el('cameras').querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy || !ready;
    for (const id of ['photo', 'portrait', 'compare']) el<HTMLButtonElement>(id).disabled = busy || !ready || !skin || id === 'compare' && !state.modified;
    const models = skin?.visual.type === 'scene3d' ? skin.visual.models : undefined;
    const select = el<HTMLSelectElement>('focus-character'); select.hidden = !models; select.disabled = busy || !ready;
    if (models && (select.value !== options.character() || select.options.length !== Object.keys(models).length
      || [...select.options].some(option => option.textContent !== models[option.value]?.name))) {
      select.replaceChildren(...Object.entries(models).map(([id, model]) => new Option(model.name, id))); select.value = options.character();
    }
    refreshExpressions();
  } };
}
