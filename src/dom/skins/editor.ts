import { initializeLanguage, getLanguage, getTextDirection } from '../../shared/i18n/index.js';
import { skinT as t, skinErrorText } from '../../shared/skins/messages.js';
import { SKIN_STORAGE_KEY, MAX_SKIN_BYTES, MAX_SCENE_MODELS, chooseSkinQuote, exportSkinPackage, sameSkinData } from '../../shared/skins/model.js';
import type { SkinLibrarySummary, WelcomeSkin, SkinCharacter } from '../../shared/skins/model.js';
import { skinRequest } from './client.js';
import { createSkinViewer, skinImageUrl } from './viewer.js';
import { GLB_DATA_PREFIX, MAX_GLB_BYTES, inspectGlb, glbDataBytes } from '../../shared/skins/glb.js';
import { registerSkinPreviewCapture } from './preview-capture.js';
import { createLibraryPreviews } from './library-previews.js';
import { createStudioTools } from './studio-tools.js';

await initializeLanguage();
document.documentElement.lang = getLanguage(); document.documentElement.dir = getTextDirection();
document.title = t('studio');
for (const element of document.querySelectorAll<HTMLElement>('[data-skin-i18n]')) element.textContent = t(element.dataset.skinI18n as Parameters<typeof t>[0]);
for (const element of document.querySelectorAll<HTMLElement>('[data-skin-label]')) {
  const label = t(element.dataset.skinLabel as Parameters<typeof t>[0]);
  element.setAttribute('aria-label', label); element.title = label;
}
const el = <T extends HTMLElement>(id: string) => document.getElementById(`skin-${id}`) as T;
const nameInput = el<HTMLInputElement>('name'), quotesInput = el<HTMLTextAreaElement>('quotes'), sourceInput = el<HTMLTextAreaElement>('source');
sourceInput.setAttribute('aria-label', t('source'));
const lifetime = new AbortController(), signal = lifetime.signal;
function showInspector(open: boolean, restoreFocus = false) {
  el('inspector').hidden = !open;
  el('layout').toggleAttribute('data-inspector-open', open);
  el('toggle-inspector').setAttribute('aria-expanded', String(open));
  if (restoreFocus) el('toggle-inspector').focus();
}
el('toggle-inspector').addEventListener('click', () => showInspector(Boolean(el('inspector').hidden)), { signal });
el('close-inspector').addEventListener('click', () => showInspector(false, true), { signal });
el('inspector').addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.stopPropagation(); showInspector(false, true); }
}, { signal });
let current: WelcomeSkin | undefined, snapshot: SkinLibrarySummary | undefined, busy = false, fieldsDirty = false, sourceDirty = false;
let renderReady = false, rendered: WelcomeSkin | undefined, selected = new URL(location.href).searchParams.get('skin') || '';
let quote = '', saveTimer: ReturnType<typeof setTimeout> | undefined, darkUpload = false, refreshAgain = false;
let librarySelection = '', libraryWidth = 0;
let selectedCharacter = new URL(location.href).searchParams.get('character') || '', appendModels = false, dragTimer: ReturnType<typeof setTimeout> | undefined;
let operations: Promise<unknown> = Promise.resolve();
const modelMetadata = new Map<string, ReturnType<typeof inspectGlb>>();
const libraryPreviews = createLibraryPreviews();
let capturingThumbnail: WelcomeSkin | undefined;
function modelInfo(src: string) {
  let info = modelMetadata.get(src);
  if (!info) {
    info = inspectGlb(glbDataBytes(src));
    if (modelMetadata.size >= MAX_SCENE_MODELS) modelMetadata.delete(modelMetadata.keys().next().value!);
    modelMetadata.set(src, info);
  }
  return info;
}
const viewer = createSkinViewer(el('viewer'), { onFileDrag: showDropTarget, onCamera: preset => studioTools.cameraChanged(preset), onStatus(ready, message) {
  renderReady = ready; syncButtons();
  if (message) showError(message);
  if (ready) void updateThumbnail();
} });
const studioTools = createStudioTools({ viewer, signal, current: () => current, character: () => current?.visual.type === 'scene3d' ? selectedCharacter : '',
  selectCharacter(id) { selectedCharacter = id; renderCharacters(); syncButtons(); }, modelInfo, update, run, status });
registerSkinPreviewCapture({ current: () => current, settled: () => !busy && !sourceDirty && !fieldsDirty && renderReady,
  capture: () => viewer.capture(), signal });
function status(key: Parameters<typeof t>[0]) { el('status').textContent = t(key); }
function showError(message: string) { el('error').textContent = message; el('error').hidden = false; }
function clearError() { el('error').hidden = true; el('reload').hidden = true; }
function thumbnailImage(source: string) {
  const image = document.createElement('img'); image.src = source; image.alt = ''; image.draggable = false;
  return image;
}
async function updateThumbnail() {
  const skin = current;
  // The built-in logo uses a theme-aware picture instead of a captured light/dark variant.
  if (skin?.id === 'qingzhou' && skin.revision === 1) return;
  if (!skin || !renderReady || capturingThumbnail === skin || libraryPreviews.get(skin.id)?.revision === skin.revision) return;
  capturingThumbnail = skin;
  try {
    const preview = await viewer.capture(160, 'webp');
    if (signal.aborted || current !== skin || !renderReady) return;
    libraryPreviews.set(skin.id, skin.revision, preview);
    for (const item of el('library-list').querySelectorAll<HTMLElement>('[data-skin-id]')) {
      if (item.dataset.skinId === skin.id) item.querySelector('.skin-library-symbol')?.replaceChildren(thumbnailImage(preview.image));
    }
  } catch { /* Keep the type icon until a valid preview is available. */ }
  finally { if (capturingThumbnail === skin) capturingThumbnail = undefined; }
}
function syncButtons() {
  el<HTMLButtonElement>('apply').disabled = busy || !current || !renderReady || fieldsDirty || sourceDirty;
  const modified = fieldsDirty || sourceDirty || snapshot?.skins.some(skin => skin.id === current?.id && skin.modified);
  el<HTMLButtonElement>('revert').disabled = busy || !current || !modified;
  const badge = el('preview-state');
  badge.hidden = !current || !modified && current.id !== snapshot?.activeId;
  badge.dataset.state = modified ? 'draft' : 'active'; badge.textContent = t(modified ? 'draft' : 'active');
  for (const id of ['duplicate', 'delete', 'export', 'update-source', 'upload', 'upload-dark']) el<HTMLButtonElement>(id).disabled = busy || !current;
  const count = current?.visual.type === 'scene3d' ? Object.keys(current.visual.models || {}).length : 0;
  el<HTMLButtonElement>('add-character').disabled = busy || count >= MAX_SCENE_MODELS;
  el<HTMLButtonElement>('remove-character').disabled = busy || count <= 1;
  studioTools.refresh({ busy, ready: renderReady && !fieldsDirty && !sourceDirty, modified: Boolean(modified) });
}
function run(operation: () => Promise<void>) {
  const next = operations.then(async () => {
    if (signal.aborted) return;
    busy = true; syncButtons();
    try { await operation(); }
    catch (error) {
      if (!signal.aborted) {
        showError(skinErrorText(error));
        if ((error as { code?: string }).code === 'SKIN_CONFLICT') { showError(t('conflict')); el('reload').hidden = false; }
      }
    } finally {
      busy = false; syncButtons();
      if (refreshAgain && !signal.aborted) { refreshAgain = false; void refresh(false); }
    }
  });
  operations = next.catch(() => {});
  return next;
}
function revealLibrarySelection() {
  const list = el('library-list');
  if (list.scrollWidth <= list.clientWidth) return;
  const item = list.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!item) return;
  const bounds = list.getBoundingClientRect(), selectedBounds = item.getBoundingClientRect();
  const left = selectedBounds.left < bounds.left ? selectedBounds.left - bounds.left
    : selectedBounds.right > bounds.right ? selectedBounds.right - bounds.right : 0;
  if (left) list.scrollBy({ left });
}
function renderLibrary() {
  const list = el('library-list');
  const { scrollLeft, scrollTop } = list;
  const focusedId = list.contains(document.activeElement) ? (document.activeElement as HTMLElement)?.dataset.skinId : undefined;
  list.replaceChildren();
  const groups = new Map<string, HTMLElement>();
  for (const item of snapshot?.skins || []) {
    const id = item.character?.id || item.id;
    if (groups.has(id)) continue;
    const members = snapshot!.skins.filter(skin => (skin.character?.id || skin.id) === id);
    const group = document.createElement('div'); group.className = 'skin-library-group'; group.setAttribute('role', 'group');
    const name = members.find(skin => skin.character)?.character?.name || item.name;
    group.setAttribute('aria-label', name);
    if (members.length > 1) {
      const heading = document.createElement('div'); heading.className = 'skin-library-group-heading';
      const title = document.createElement('span'); title.textContent = name;
      const count = document.createElement('span'); count.textContent = t('looks', { number: members.length });
      heading.append(title, count); group.append(heading);
    }
    groups.set(id, group); list.append(group);
  }
  el('library-count').textContent = String(groups.size);
  for (const item of snapshot?.skins || []) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'skin-library-item';
    button.setAttribute('aria-pressed', String(item.id === selected)); button.dataset.skinId = item.id;
    const active = item.id === snapshot?.activeId, type = item.type === 'image2d' ? '2D' : '3D';
    button.title = item.name;
    button.setAttribute('aria-label', [item.name, type, active ? t('active') : '', item.modified ? t('draft') : ''].filter(Boolean).join(' · '));
    const symbol = document.createElement('span'); symbol.className = 'skin-library-symbol'; symbol.setAttribute('aria-hidden', 'true');
    const thumbnail = libraryPreviews.get(item.id);
    if (item.id === 'qingzhou' && item.revision === 1) {
      const picture = document.createElement('picture'), dark = document.createElement('source');
      dark.media = '(prefers-color-scheme: dark)'; dark.srcset = skinImageUrl('builtin:logo-night');
      picture.append(dark, thumbnailImage(skinImageUrl('builtin:logo-day'))); symbol.append(picture);
    }
    else if (thumbnail) symbol.append(thumbnailImage(thumbnail.preview.image));
    else symbol.append(el<HTMLTemplateElement>(item.type === 'image2d' ? 'type-image' : 'type-model').content.cloneNode(true));
    const copy = document.createElement('span'); copy.className = 'skin-library-copy';
    const name = document.createElement('span'); name.className = 'skin-library-name'; name.textContent = item.name;
    const hint = document.createElement('span'); hint.className = 'skin-library-meta'; hint.textContent = type;
    if (active) { const label = document.createElement('span'); label.className = 'skin-library-active'; label.textContent = t('active'); hint.append(label); }
    if (item.modified) { const dot = document.createElement('span'); dot.className = 'skin-library-draft'; dot.title = t('draft'); dot.setAttribute('aria-hidden', 'true'); hint.append(dot); }
    copy.append(name, hint); button.append(symbol, copy); groups.get(item.character?.id || item.id)!.append(button);
    if (item.id === focusedId) button.focus({ preventScroll: true });
  }
  list.scrollTo({ left: scrollLeft, top: scrollTop });
  if (librarySelection !== selected) revealLibrarySelection();
  librarySelection = selected;
}
const libraryResize = new ResizeObserver(([entry]) => {
  if (entry && entry.contentRect.width !== libraryWidth) {
    libraryWidth = entry.contentRect.width; revealLibrarySelection();
  }
});
libraryResize.observe(el('library-list'));
function adopt(skin: WelcomeSkin, fillFields: boolean) {
  current = skin; selected = skin.id;
  const sources = new Set(skin.visual.type === 'model3d' ? [skin.visual.src]
    : skin.visual.type === 'scene3d' ? Object.values(skin.visual.models || {}).map(model => model.src) : []);
  for (const src of modelMetadata.keys()) if (!sources.has(src)) modelMetadata.delete(src);
  const url = new URL(location.href); url.searchParams.set('skin', selected); history.replaceState(null, '', url);
  if (fillFields) { nameInput.value = skin.name; quotesInput.value = skin.quotes.join('\n'); sourceInput.value = skin.visual.type !== 'image2d' ? skin.visual.source : ''; fieldsDirty = false; sourceDirty = false; }
  el('preview-name').textContent = skin.name; el('preview-name').title = skin.name;
  if (!rendered || rendered.id !== skin.id || !sameSkinData(rendered.visual, skin.visual) || !sameSkinData(rendered.assets, skin.assets)) {
    rendered = skin; clearError(); viewer.setSkin(skin);
  }
  el('visual-label').textContent = t(skin.visual.type !== 'image2d' ? 'scene' : 'image');
  el('source-details').hidden = skin.visual.type === 'image2d'; el('upload-dark').hidden = skin.visual.type !== 'image2d';
  el('drag-hint').hidden = skin.visual.type === 'image2d'; el('model-options').hidden = skin.visual.type !== 'model3d';
  if (skin.visual.type === 'model3d') {
    const info = modelInfo(skin.visual.src);
    el('visual-label').textContent = info.format.toUpperCase();
    const select = el<HTMLSelectElement>('animation'); select.replaceChildren();
    for (const [value, label] of [['auto', t('autoAnimation')], ['none', t('noAnimation')], ...info.animations.map(name => [name, name])]) {
      const option = document.createElement('option'); option.value = value!; option.textContent = label!; select.append(option);
    }
    select.value = skin.visual.animation; el<HTMLInputElement>('rotation').value = String(skin.visual.rotationY);
    el('rotation-value').textContent = `${skin.visual.rotationY}°`;
  }
  renderCharacters();
  if (!skin.quotes.includes(quote)) quote = chooseSkinQuote(skin.quotes);
  el('preview-quote').textContent = quote;
  renderLibrary(); syncButtons(); void updateThumbnail();
}
function renderCharacters() {
  const models = current?.visual.type === 'scene3d' ? current.visual.models : undefined;
  el('characters').hidden = !models;
  const url = new URL(location.href);
  if (!models) { url.searchParams.delete('character'); history.replaceState(null, '', url); return; }
  if (!Object.hasOwn(models, selectedCharacter)) selectedCharacter = Object.keys(models)[0]!;
  url.searchParams.set('character', selectedCharacter); history.replaceState(null, '', url);
  const select = el<HTMLSelectElement>('character'); select.replaceChildren();
  for (const [id, character] of Object.entries(models)) {
    const option = document.createElement('option'); option.value = id; option.textContent = character.name; select.append(option);
  }
  select.value = selectedCharacter;
  const character = models[selectedCharacter]!;
  el<HTMLInputElement>('character-name').value = character.name;
  for (const [index, axis] of ['x', 'y', 'z'].entries()) el<HTMLInputElement>(`character-${axis}`).value = String(character.position[index]);
  el<HTMLInputElement>('character-scale').value = String(character.scale);
  el<HTMLInputElement>('character-rotation').value = String(character.rotationY);
  const animation = el<HTMLSelectElement>('character-animation'); animation.replaceChildren();
  for (const [value, label] of [['auto', t('autoAnimation')], ['none', t('noAnimation')], ...modelInfo(character.src).animations.map(name => [name, name])]) {
    const option = document.createElement('option'); option.value = value!; option.textContent = label!; animation.append(option);
  }
  animation.value = character.animation;
}
let refreshGeneration = 0;
async function refresh(force: boolean) {
  if (busy) { refreshAgain = true; return; }
  const generation = ++refreshGeneration;
  let finishPreview = () => {};
  try {
    const next = await skinRequest<SkinLibrarySummary>({ action: 'list' }, signal);
    if (signal.aborted || generation !== refreshGeneration) return;
    snapshot = next;
    const id = next.skins.some(skin => skin.id === selected) ? selected : next.activeId;
    if (!force && current?.id === id && current.revision === next.skins.find(skin => skin.id === id)?.revision) {
      renderLibrary(); syncButtons(); return;
    }
    finishPreview = current ? viewer.beginUpdate() : () => {};
    const { skin } = await skinRequest<{ skin: WelcomeSkin }>({ action: 'get', id }, signal);
    if (signal.aborted || generation !== refreshGeneration) return;
    if (!force && current?.id === skin.id && current.revision !== skin.revision && (fieldsDirty || sourceDirty)) {
      showError(t('conflict')); el('reload').hidden = false; renderLibrary(); return;
    }
    if (force || !current || current.id !== skin.id || current.revision !== skin.revision) {
      adopt(skin, true); status('saved');
    } else { renderLibrary(); syncButtons(); }
    if (force) clearError();
  } catch (error) { if (!signal.aborted) showError(skinErrorText(error)); }
  finally { finishPreview(); }
}
async function update(patch: Record<string, unknown>) {
  if (!current) return;
  status('saving');
  const finishPreview = patch.visual !== undefined || patch.assets !== undefined ? viewer.beginUpdate() : () => {};
  try {
    const result = await skinRequest<{ skin: WelcomeSkin; snapshot: SkinLibrarySummary }>({ action: 'update', id: current.id, revision: current.revision, patch }, signal);
    if (signal.aborted) return;
    snapshot = result.snapshot; adopt(result.skin, false); status('saved');
  } finally { finishPreview(); }
}
async function saveFields() {
  clearTimeout(saveTimer);
  if (!fieldsDirty || !current) return;
  const name = nameInput.value, quotes = quotesInput.value;
  await update({ name, quotes: quotes.split('\n').filter(text => text.trim()) });
  fieldsDirty = nameInput.value !== name || quotesInput.value !== quotes;
  syncButtons();
}
async function savePending() {
  await saveFields();
  if (sourceDirty && current?.visual.type !== 'image2d') {
    const source = sourceInput.value;
    await update({ visual: { type: current?.visual.type, source } });
    sourceDirty = sourceInput.value !== source;
  }
}
for (const input of [nameInput, quotesInput]) input.addEventListener('input', () => {
  fieldsDirty = true; syncButtons(); clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void run(saveFields), 650);
}, { signal });
sourceInput.addEventListener('input', () => { sourceDirty = true; syncButtons(); }, { signal });
el('library-list').addEventListener('click', event => {
  const id = (event.target as Element).closest<HTMLElement>('[data-skin-id]')?.dataset.skinId;
  if (!id || id === selected) return;
  void run(async () => {
    await savePending();
    const { skin } = await skinRequest<{ skin: WelcomeSkin }>({ action: 'get', id }, signal);
    if (!signal.aborted) { clearError(); adopt(skin, true); }
  });
}, { signal });
function click(id: string, action: () => Promise<void>) { el(id).addEventListener('click', () => void run(action), { signal }); }
click('update-source', async () => {
  await saveFields(); const source = sourceInput.value;
  await update({ visual: { type: current?.visual.type === 'model3d' ? 'model3d' : 'scene3d', source } }); sourceDirty = sourceInput.value !== source;
});
click('apply', async () => {
  if (!current || !renderReady || fieldsDirty || sourceDirty) return;
  const result = await skinRequest<{ snapshot: SkinLibrarySummary }>({ action: 'apply', id: current.id, revision: current.revision }, signal);
  snapshot = result.snapshot; renderLibrary(); status('applied'); clearError();
});
click('revert', async () => {
  if (!current) return;
  clearTimeout(saveTimer);
  const finishPreview = viewer.beginUpdate();
  try {
    const result = await skinRequest<{ skin: WelcomeSkin; snapshot: SkinLibrarySummary }>({ action: 'revert', id: current.id, revision: current.revision }, signal);
    snapshot = result.snapshot; adopt(result.skin, true); clearError(); status('restored');
  } finally { finishPreview(); }
});
click('duplicate', async () => {
  await savePending(); if (!current) return;
  const character = current.character || { id: current.id, name: current.name };
  const count = snapshot?.skins.filter(skin => (skin.character?.id || skin.id) === character.id).length || 1;
  const result = await skinRequest<{ skin: WelcomeSkin; snapshot: SkinLibrarySummary }>({ action: 'create', skin: { ...current, character, name: t('look', { number: count + 1 }) } }, signal);
  snapshot = result.snapshot; adopt(result.skin, true);
});
click('delete', async () => {
  if (!current || !window.confirm(t('deleteConfirm'))) return;
  clearTimeout(saveTimer);
  const result = await skinRequest<{ snapshot: SkinLibrarySummary }>({ action: 'delete', id: current.id, revision: current.revision }, signal);
  snapshot = result.snapshot; fieldsDirty = false; sourceDirty = false; selected = snapshot.activeId;
  const { skin } = await skinRequest<{ skin: WelcomeSkin }>({ action: 'get', id: selected }, signal); adopt(skin, true);
});
el('reload').addEventListener('click', () => { clearTimeout(saveTimer); void refresh(true); }, { signal });
el('shuffle').addEventListener('click', () => { quote = chooseSkinQuote(current?.quotes || [], quote); el('preview-quote').textContent = quote; }, { signal });
click('copy-prompt', async () => { await navigator.clipboard.writeText(t('editPrompt', { id: selected })); status('copied'); });
el('open-chat').addEventListener('click', () => {
  // Initiated by the user's click; the extension API requires that gesture.
  void chrome.windows.getCurrent().then(window => chrome.sidePanel.open({ windowId: window.id! })).catch(error => showError(skinErrorText(error)));
}, { signal });
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
}
el('import').addEventListener('click', () => el<HTMLInputElement>('import-file').click(), { signal });
el<HTMLInputElement>('import-file').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file) return;
  void run(async () => {
    if (file.size > MAX_SKIN_BYTES + 1024) throw { code: 'SKIN_TOO_LARGE' };
    await savePending();
    const result = await skinRequest<{ skin: WelcomeSkin; snapshot: SkinLibrarySummary }>({ action: 'import', package: JSON.parse(await file.text()) }, signal);
    snapshot = result.snapshot; adopt(result.skin, true); status('saved');
  });
}, { signal });
click('export', async () => {
  await savePending(); if (!current) return;
  const portable = structuredClone(current);
  const embed = async (source: string) => source.startsWith('builtin:') ? dataUrl(await (await fetch(skinImageUrl(source))).blob()) : source;
  if (portable.visual.type === 'image2d') { portable.visual.src = await embed(portable.visual.src); if (portable.visual.darkSrc) portable.visual.darkSrc = await embed(portable.visual.darkSrc); }
  for (const [key, value] of Object.entries(portable.assets)) portable.assets[key] = await embed(value);
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportSkinPackage(portable), null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${portable.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80)}.qzskin.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
for (const id of ['upload', 'upload-dark']) el(id).addEventListener('click', () => { darkUpload = id === 'upload-dark'; el<HTMLInputElement>('image-file').click(); }, { signal });
el<HTMLInputElement>('image-file').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, file = input.files?.[0], dark = darkUpload; input.value = '';
  if (!file) return;
  void run(async () => {
    if (file.size > MAX_SKIN_BYTES * .7) throw { code: 'SKIN_TOO_LARGE' };
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw { code: 'SKIN_IMAGE_INVALID' };
    await saveFields(); const src = await dataUrl(file);
    const visual = current?.visual.type === 'image2d' ? current.visual : { type: 'image2d' as const, src };
    await update({ visual: { ...visual, ...(dark ? { darkSrc: src } : { src }) } }); sourceDirty = false;
  });
}, { signal });
function pickModels(append: boolean) { appendModels = append; el<HTMLInputElement>('model-file').click(); }
el('import-model').addEventListener('click', () => pickModels(false), { signal });
el('add-character').addEventListener('click', () => pickModels(true), { signal });
el<HTMLInputElement>('model-file').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, files = [...input.files || []], append = appendModels; input.value = '';
  if (files.length) void run(() => importModels(files, append));
}, { signal });
async function importModels(files: File[], append: boolean) {
  if (files.some(file => !/\.(?:glb|vrm)$/i.test(file.name))) throw { code: 'SKIN_MODEL_INVALID' };
  function currentModels(): Record<string, SkinCharacter> {
    if (!append) return {};
    if (current?.visual.type === 'scene3d') return structuredClone(current.visual.models || {});
    if (current?.visual.type === 'model3d') {
      const { type: _type, ...model } = current.visual;
      return { character_1: { ...model, name: current.name, position: [0, 0, 0], scale: 1 } };
    }
    return {};
  }
  let models = currentModels();
  if (Object.keys(models).length + files.length > MAX_SCENE_MODELS) throw { code: 'SKIN_CHARACTERS_LIMIT' };
  const existingBytes = Object.values(models).reduce((total, character) => total + glbDataBytes(character.src).byteLength, 0);
  if (existingBytes + files.reduce((total, file) => total + file.size, 0) > MAX_GLB_BYTES) throw { code: 'SKIN_SCENE_TOO_LARGE' };
  const added: SkinCharacter[] = [];
  // Prepare the whole batch before writing so one invalid file cannot leave a partial scene.
  for (const file of files) {
    inspectGlb(new Uint8Array(await file.arrayBuffer())); signal.throwIfAborted();
    added.push({ name: file.name.replace(/\.(?:glb|vrm)$/i, '').slice(0, 100),
      src: GLB_DATA_PREFIX + (await dataUrl(file)).split(',')[1], source: 'return { root: model };',
      animation: 'auto', animationSpeed: 1, rotationY: 0, position: [0, 0, 0], scale: 1 });
  }
  await savePending();
  models = currentModels();
  if (!append && files.length === 1) {
    const { name, position: _position, scale: _scale, ...model } = added[0]!;
    const result = await skinRequest<{ skin: WelcomeSkin; snapshot: SkinLibrarySummary }>({ action: 'create', skin: {
      name, visual: { type: 'model3d', ...model }, quotes: current?.quotes || [], assets: {},
    } }, signal);
    snapshot = result.snapshot; adopt(result.skin, true); status('saved');
    return;
  }
  for (const character of added) {
    let index = 1; while (Object.hasOwn(models, `character_${index}`)) index++;
    character.position[0] = Object.keys(models).length * 1.5;
    selectedCharacter = `character_${index}`; models[selectedCharacter] = character;
  }
  const visual = { type: 'scene3d' as const, models,
    source: append && current?.visual.type === 'scene3d' && current.visual.models ? current.visual.source : 'return { root: model };' };
  if (append && current) { await update({ visual }); sourceInput.value = visual.source; sourceDirty = false; }
  else {
    const result = await skinRequest<{ skin: WelcomeSkin; snapshot: SkinLibrarySummary }>({ action: 'create', skin: {
      name: added.map(character => character.name).join(' + ').slice(0, 100), visual, quotes: current?.quotes || [], assets: {},
    } }, signal);
    snapshot = result.snapshot; adopt(result.skin, true); status('saved');
  }
}
function showDropTarget() { clearTimeout(dragTimer); el('drop-target').hidden = false; }
function hideDropTarget() { clearTimeout(dragTimer); el('drop-target').hidden = true; }
for (const type of ['dragenter', 'dragover'] as const) document.addEventListener(type, event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; showDropTarget();
}, { signal });
document.addEventListener('dragleave', () => { clearTimeout(dragTimer); dragTimer = setTimeout(hideDropTarget, 150); }, { signal });
document.addEventListener('drop', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); hideDropTarget();
  const files = [...event.dataTransfer.files]; if (files.length) void run(() => importModels(files, true));
}, { signal });
window.addEventListener('blur', hideDropTarget, { signal });
el<HTMLSelectElement>('character').addEventListener('change', event => { selectedCharacter = (event.target as HTMLSelectElement).value; renderCharacters(); syncButtons(); }, { signal });
el('characters').addEventListener('change', event => {
  const input = event.target as HTMLInputElement, field = input.dataset.characterField, id = selectedCharacter;
  if (!field || current?.visual.type !== 'scene3d' || !current.visual.models?.[id]) return;
  const value = ['name', 'animation'].includes(field) ? input.value : Number(input.value);
  void run(async () => {
    const patch: Record<string, unknown> = { [field]: value };
    if (['x', 'y', 'z'].includes(field)) {
      if (current?.visual.type !== 'scene3d' || !current.visual.models?.[id]) return;
      const position = [...current.visual.models[id]!.position]; position[['x', 'y', 'z'].indexOf(field)] = Number(value);
      delete patch[field]; patch.position = position;
    }
    await update({ visual: { type: 'scene3d', models: { [id]: patch } } });
  });
}, { signal });
el('remove-character').addEventListener('click', () => {
  const id = selectedCharacter;
  void run(async () => {
    if (current?.visual.type !== 'scene3d' || !Object.hasOwn(current.visual.models || {}, id)
      || Object.keys(current.visual.models || {}).length <= 1) return;
    await update({ visual: { type: 'scene3d', models: { [id]: null } } });
  });
}, { signal });
for (const [id, field] of [['animation', 'animation'], ['rotation', 'rotationY']] as const) {
  el(id).addEventListener('change', () => void run(async () => {
    if (current?.visual.type !== 'model3d') return;
    await update({ visual: { type: 'model3d', [field]: field === 'rotationY' ? Number(el<HTMLInputElement>(id).value) : el<HTMLSelectElement>(id).value } });
  }), { signal });
}
el<HTMLInputElement>('rotation').addEventListener('input', event => {
  el('rotation-value').textContent = `${(event.target as HTMLInputElement).value}°`;
}, { signal });
const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && changes[SKIN_STORAGE_KEY]) void refresh(false); };
chrome.storage.onChanged.addListener(onStorage);
window.addEventListener('pagehide', () => { lifetime.abort(); clearTimeout(saveTimer); clearTimeout(dragTimer); libraryResize.disconnect(); viewer.dispose(); chrome.storage.onChanged.removeListener(onStorage); }, { once: true });
status('loading'); await refresh(true);
