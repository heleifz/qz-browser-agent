import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { SkinVisual, SkinModel } from '../../shared/skins/model.js';
import { glbDataBytes, inspectGlb } from '../../shared/skins/glb.js';
import { readSkinView, type SkinViewState } from '../../shared/skins/preview.js';

interface Character { root: THREE.Object3D; update?(time: number, delta: number): void; dispose?(): void }
let token = '', revision = 0, loadEpoch = 0, instance: Awaited<ReturnType<typeof createScene>> | undefined;
let loading: AbortController | undefined;
let requestedVisibility = true;
let requestedMotion = false;
let transition: ViewTransition | undefined;
let renderer: THREE.WebGLRenderer | undefined;
const modelBuffers = new Map<string, ArrayBuffer>();
function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  document.body.append(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); loadEpoch++; loading?.abort(); loading = undefined; instance?.setVisible(false);
    report('error', { message: 'WebGL context lost', fatal: true });
  });
  return renderer;
}
function report(type: string, value: Record<string, unknown> = {}) {
  parent.postMessage({ channel: 'qz-skin', token, revision, type, ...value }, '*');
}
window.addEventListener('message', event => {
  if (event.source !== parent || !event.data || event.data.channel !== 'qz-skin') return;
  const data = event.data;
  if (typeof data.token !== 'string' || data.token.length > 100 || token && token !== data.token) return;
  token = data.token;
  try {
    if (data.type === 'load') {
      const epoch = ++loadEpoch;
      revision = data.revision;
      requestedVisibility = data.visible !== false;
      requestedMotion = data.reducedMotion === true;
      transition?.skipTransition(); loading?.abort(); loading = new AbortController();
      // Keep the last picture and controls, but avoid competing animation work during decoding.
      instance?.setPaused(true);
      for (const key of modelBuffers.keys()) if (!data.modelKeys?.includes(key)) modelBuffers.delete(key);
      for (const [key, buffer] of Object.entries(data.modelBuffers || {})) {
        if (buffer instanceof ArrayBuffer) modelBuffers.set(key, buffer);
      }
      void createScene(data.visual, data.assets || {}, data.reducedMotion === true, loading.signal, epoch).then(async result => {
        if (epoch !== loadEpoch) { result.dispose(); return; }
        const commit = () => {
          if (epoch !== loadEpoch) { result.dispose(); return; }
          const previous = instance;
          try {
            result.activate(previous?.getView() || readSkinView(data.view)); result.setMotion(requestedMotion);
            // Render synchronously before acknowledging readiness or releasing the old scene.
            result.present(requestedVisibility);
          } catch (error) { result.dispose(); previous?.present(requestedVisibility); throw error; }
          previous?.dispose(); instance = result; loading = undefined;
        };
        if (instance && document.startViewTransition && requestedVisibility && !requestedMotion) {
          const changing = document.startViewTransition(commit); transition = changing;
          const ready = changing.ready.catch(() => {});
          void changing.finished.catch(() => {}).then(() => { if (transition === changing) transition = undefined; });
          await changing.updateCallbackDone; await ready;
        } else commit();
        if (epoch === loadEpoch) report('loaded');
      }).catch(error => {
        if (epoch === loadEpoch) {
          loading = undefined; instance?.setMotion(requestedMotion); instance?.setPaused(false);
          report('error', { message: String(error instanceof Error ? error.message : error).slice(0, 500), retained: !!instance });
        }
      });
    } else if (data.type === 'visibility') { requestedVisibility = data.visible === true; instance?.setVisible(requestedVisibility); }
    else if (data.type === 'pause') { if (!loading) instance?.setPaused(data.paused === true); }
    else if (data.type === 'motion') { requestedMotion = data.reducedMotion === true; if (!loading) instance?.setMotion(requestedMotion); }
    else if (data.type === 'cancel') { loadEpoch++; transition?.skipTransition(); loading?.abort(); loading = undefined; instance?.setMotion(requestedMotion); instance?.setPaused(false); }
    else if (data.type === 'reset') instance?.reset();
    else if (data.type === 'rotate') instance?.rotate(Number(data.amount) || 0);
    else if (data.type === 'capture' && typeof data.requestId === 'string' && data.requestId.length <= 100) {
      if (!instance || loading) report('capture', { requestId: data.requestId, error: true });
      else {
        try { report('capture', { requestId: data.requestId, preview: instance.capture(data.maxSize, data.format) }); }
        catch { report('capture', { requestId: data.requestId, error: true }); }
      }
    }
    else if (data.type === 'dispose') {
      loadEpoch++; transition?.skipTransition(); loading?.abort(); loading = undefined; instance?.dispose(); instance = undefined;
      if (renderer) {
        const canvas = renderer.domElement;
        renderer.dispose(); canvas.remove();
        // Removing the frame releases the context; do not dispatch a context-loss error on teardown.
        renderer = undefined;
      }
      modelBuffers.clear();
    }
  } catch (error) { report('error', { message: String(error instanceof Error ? error.message : error).slice(0, 500) }); }
});
window.addEventListener('error', event => report('error', { message: event.message.slice(0, 500) }));
window.addEventListener('dragenter', event => {
  if (event.dataTransfer?.types.includes('Files')) report('file-drag');
});
parent.postMessage({ channel: 'qz-skin', type: 'ready' }, '*');

async function createScene(visual: Exclude<SkinVisual, { type: 'image2d' }>, assets: Record<string, string>, reducedMotion: boolean, signal: AbortSignal, epoch: number) {
  // Locals such as `const vrm = characters.fish.vrm` can shadow host bindings.
  // Compile every source before decoding models or allocating GPU resources.
  const compile = (source: string) => new Function('THREE', 'assets', 'model', 'vrm', 'characters', '"use strict";\n{\n' + source + '\n}');
  const sources = new Map<string, Function>();
  for (const source of [visual.source, ...Object.values(visual.type === 'scene3d' ? visual.models || {} : {}).map(spec => spec.source)]) sources.set(source, compile(source));
  signal.throwIfAborted();
  const renderer = getRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 100);
  camera.position.set(0, .1, 6.8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.disconnect();
  controls.enablePan = false; controls.enableZoom = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: null, RIGHT: null };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: null };
  // Pointer movement changes the camera immediately; inertia makes a small avatar feel delayed.
  controls.enableDamping = false;
  controls.minPolarAngle = Math.PI * .15; controls.maxPolarAngle = Math.PI * .85;
  controls.rotateSpeed = .65;
  const fill = new THREE.HemisphereLight(0xfff8f1, 0x7489af, 2.6); scene.add(fill);
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-3, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa5c9ff, 2); rim.position.set(3, 2, -4); scene.add(rim);
  const pivot = new THREE.Group(); scene.add(pivot);
  const lifetime = new AbortController();
  let actor: Character | undefined, imported: THREE.Group | undefined;
  let vrm: VRM | undefined;
  const loadedModels: THREE.Group[] = [], mixers: THREE.AnimationMixer[] = [], avatars: VRM[] = [], characterActors: Character[] = [];
  const characters: Record<string, { root: THREE.Group; model: THREE.Group; vrm?: VRM }> = Object.create(null);
  let visible = false, active = false, paused = false, frame = 0, last = 0, elapsed = 0, disposed = false, dirty = true, interacting = false;
  let qualityTimer: ReturnType<typeof setTimeout> | undefined;
  let quality = 1, qualitySamples = 0, qualityElapsed = 0, lastPaint = 0;
  // Resizing clears the drawing buffer. Paint in the same callback so a layout change
  // never exposes an empty buffer while waiting for the next animation frame.
  const resize = new ResizeObserver(resizeView);
  function freeObject(...roots: THREE.Object3D[]) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), skeletons = new Set<THREE.Skeleton>();
    for (const root of roots) root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        if (material instanceof THREE.ShaderMaterial) for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
        }
      }
    });
    for (const texture of textures) { if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close(); texture.dispose(); }
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
  }
  function dispose() {
    if (disposed) return;
    signal.removeEventListener('abort', dispose);
    disposed = true; lifetime.abort(); cancelAnimationFrame(frame); clearTimeout(qualityTimer); resize.disconnect(); controls.dispose();
    for (const mixer of mixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
    for (const character of characterActors) { try { character.dispose?.(); } catch { /* Continue host cleanup. */ } }
    try { actor?.dispose?.(); } catch { /* Host cleanup still releases scene resources. */ }
    // Imported roots can also be in the scene; release shared textures/bitmaps only once.
    freeObject(scene, ...loadedModels);
  }
  function resizeRenderer() {
    const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
    // Use a lighter buffer while dragging, then restore supersampled outlines after release.
    const sharpDensity = Math.min(Math.max(devicePixelRatio || 1, 2), 3);
    const preferred = interacting ? Math.min(devicePixelRatio || 1, 1.5)
      : reducedMotion ? sharpDensity : Math.max(1, sharpDensity * quality);
    const density = Math.min(preferred, Math.sqrt((interacting ? 800_000 : 2_500_000) / (width * height)),
      renderer.capabilities.maxTextureSize / Math.max(width, height));
    if (renderer.domElement.width !== Math.floor(width * density) || renderer.domElement.height !== Math.floor(height * density)) {
      renderer.setDrawingBufferSize(width, height, density);
    }
    camera.aspect = width / height;
    camera.position.setLength(6.8 / Math.min(1, camera.aspect)); camera.updateProjectionMatrix();
  }
  function draw() {
    if (disposed || !visible) return;
    renderer.render(scene, camera);
  }
  function requestDraw() {
    dirty = true;
    if (visible && !disposed && !frame) frame = requestAnimationFrame(tick);
  }
  function resizeView() {
    if (!active || disposed) return;
    resizeRenderer(); dirty = true; cancelAnimationFrame(frame); tick(performance.now());
  }
  function tick(now: number) {
    frame = 0;
    if (!visible || disposed) return;
    const animate = !paused && !reducedMotion && (!last || now - last >= 1000 / 30 - .5);
    try {
      if (animate) {
        const delta = last ? Math.min((now - last) / 1000, .1) : 0; last = now; elapsed += delta;
        for (const mixer of mixers) mixer.update(delta);
        for (const character of characterActors) character.update?.(elapsed, delta);
        actor?.update?.(elapsed, delta);
        pivot.position.y = Math.sin(elapsed * 1.4) * .025;
        for (const avatar of avatars) avatar.update(delta);
      }
      // Camera input is painted on the next display frame, independently of the idle animation cap.
      if (animate || dirty) {
        if (animate && !interacting && lastPaint && now - lastPaint < 1000) {
          qualityElapsed += now - lastPaint; qualitySamples++;
          // Sustained missed frames lower supersampling; a single shader/upload spike does not.
          // Recover slowly with headroom. MSAA stays enabled even at the 1x lower bound.
          if (qualitySamples >= 6 && qualityElapsed / qualitySamples > 50) {
            quality = Math.max(1 / Math.min(Math.max(devicePixelRatio || 1, 2), 3), quality * .75);
            qualitySamples = qualityElapsed = 0; resizeRenderer();
          } else if (qualitySamples >= 90) {
            if (qualityElapsed / qualitySamples < 36) quality = Math.min(1, quality + .1);
            qualitySamples = qualityElapsed = 0; resizeRenderer();
          }
        }
        lastPaint = now; dirty = false; draw();
      }
      if (!paused && !reducedMotion && !frame) frame = requestAnimationFrame(tick);
    } catch (error) {
      cancelAnimationFrame(frame); visible = false;
      if (epoch === loadEpoch) report('error', { message: String(error instanceof Error ? error.message : error).slice(0, 500) });
    }
  }
  function setVisible(next: boolean) {
    if (!active || disposed) return;
    if (next === visible && frame) return;
    visible = next; cancelAnimationFrame(frame); frame = 0; last = lastPaint = qualitySamples = qualityElapsed = 0;
    if (!visible) { clearTimeout(qualityTimer); interacting = false; }
    else { resizeRenderer(); requestDraw(); }
  }
  function reset() { camera.position.set(0, .1, 6.8); controls.target.set(0, 0, 0); resizeRenderer(); controls.update(); requestDraw(); if (epoch === loadEpoch) report('view-changed'); }
  controls.addEventListener('change', requestDraw);
  controls.addEventListener('start', () => {
    clearTimeout(qualityTimer); interacting = true; resizeRenderer(); requestDraw();
  });
  controls.addEventListener('end', () => {
    clearTimeout(qualityTimer);
    qualityTimer = setTimeout(() => {
      if (disposed) return;
      interacting = false; resizeRenderer(); requestDraw();
      if (epoch === loadEpoch) report('view-changed');
    }, 120);
  });
  // Browser zoom or moving between displays can change DPR without changing the iframe's CSS size.
  window.addEventListener('resize', resizeView, { signal: lifetime.signal });
  renderer.domElement.addEventListener('dblclick', reset, { signal: lifetime.signal });
  const runSource = (source: string, model?: THREE.Group, avatar?: VRM): Character => {
    const result = sources.get(source)!(THREE, Object.freeze({ ...assets }), model, avatar, characters) as Character;
    if (!result?.root?.isObject3D) throw new Error('Return { root: THREE.Object3D, update(time, delta)? }.');
    return result;
  };
  async function loadModel(spec: SkinModel) {
      signal.throwIfAborted();
      const manager = new THREE.LoadingManager();
      manager.setURLModifier(url => {
        if (!/^(?:blob:|data:)/.test(url)) throw new Error('The model must embed all textures and buffers.');
        return url;
      });
      const buffer = modelBuffers.get(spec.src);
      const bytes = buffer ? new Uint8Array(buffer) : glbDataBytes(spec.src), info = inspectGlb(bytes);
      const loader = new GLTFLoader(manager);
      // Raw bone edits and GLB animation tracks must survive the VRM frame update.
      loader.register(parser => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
      const gltf = await loader.parseAsync(bytes.buffer, '');
      const model = gltf.scene, avatar = gltf.userData.vrm as VRM | undefined;
      if (disposed || signal.aborted) { freeObject(model); throw new Error('Model load cancelled'); }
      loadedModels.push(model);
      if (info.format === 'vrm' && !avatar) throw new Error('The VRM character could not be loaded.');
      if (avatar) {
        avatars.push(avatar); VRMUtils.rotateVRM0(avatar);
        VRMUtils.combineSkeletons(model);
        // MToon uses authored shade colors; PBR-strength lights wash out faces and fabric.
        fill.intensity = 1.2; key.intensity = 1.5; rim.intensity = .5;
      }
      const mixer = new THREE.AnimationMixer(model); mixers.push(mixer);
      const clip = spec.animation === 'none' ? undefined : spec.animation === 'auto'
        ? gltf.animations.find(clip => /idle|breath|stand/i.test(clip.name)) || gltf.animations[0]
        : gltf.animations.find(clip => clip.name === spec.animation);
      if (clip) mixer.clipAction(clip).play();
      mixer.timeScale = spec.animationSpeed;
      return { model, vrm: avatar };
  }
  try {
    signal.throwIfAborted();
    signal.addEventListener('abort', dispose, { once: true });
    if (visual.type === 'model3d') {
      const loaded = await loadModel(visual); imported = loaded.model; vrm = loaded.vrm;
    } else if (visual.models) {
      imported = new THREE.Group();
      for (const [id, spec] of Object.entries(visual.models)) {
        const loaded = await loadModel(spec);
        const character = runSource(spec.source, loaded.model, loaded.vrm); characterActors.push(character);
        const bounds = new THREE.Box3().setFromObject(character.root), center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3()), maximum = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(maximum) || maximum <= 0) throw new Error('The character has no visible geometry.');
        const centered = new THREE.Group(); centered.add(character.root); centered.position.set(-center.x, -bounds.min.y, -center.z);
        const fit = new THREE.Group(); fit.add(centered); fit.scale.setScalar(2.6 / maximum);
        const root = new THREE.Group(); root.name = id; root.add(fit);
        root.position.fromArray(spec.position); root.scale.setScalar(spec.scale); root.rotation.y = THREE.MathUtils.degToRad(spec.rotationY);
        characters[id] = { root, ...loaded }; imported.add(root);
      }
    }
    // This entry is a manifest sandbox page with no extension APIs, networking, or parent DOM access.
    actor = runSource(visual.source, imported, vrm);
    const bounds = new THREE.Box3().setFromObject(actor.root);
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const maximum = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maximum) || maximum <= 0) throw new Error('The character has no visible geometry.');
    const centered = new THREE.Group(); centered.add(actor.root); centered.position.copy(center).negate();
    const fit = new THREE.Group(); fit.add(centered); fit.scale.setScalar(3.1 / maximum);
    if (visual.type === 'model3d') fit.rotation.y = THREE.MathUtils.degToRad(visual.rotationY);
    pivot.add(fit);
    // Apply static expressions even with reduced motion; reset physics after fitting the model.
    scene.updateMatrixWorld(true);
    for (const avatar of avatars) { avatar.springBoneManager?.reset(); avatar.update(0); }
    // Warm shaders while the current preview remains visible. The old scene is replaced only
    // after the complete candidate succeeds; a broken draft cannot blank the previous picture.
    await renderer.compileAsync(scene, camera);
    signal.throwIfAborted();
  } catch (error) { dispose(); throw error; }
  return { dispose, setVisible, reset, present(value: boolean) { setVisible(value); if (value) draw(); }, setPaused(value: boolean) {
    paused = value; last = lastPaint = qualitySamples = qualityElapsed = 0;
    if (!paused) requestDraw();
  }, setMotion(value: boolean) {
    reducedMotion = value; last = lastPaint = qualitySamples = qualityElapsed = 0;
    if (active) resizeRenderer(); requestDraw();
  }, getView: (): SkinViewState => ({ position: camera.position.toArray(), elapsed, quality }), activate(view?: SkinViewState) {
    active = true;
    if (view) {
      camera.position.fromArray(view.position); quality = view.quality; elapsed = view.elapsed;
      if (elapsed > 0 && !reducedMotion) {
        for (const mixer of mixers) mixer.setTime(elapsed);
        for (const character of characterActors) character.update?.(elapsed, 0);
        actor?.update?.(elapsed, 0); pivot.position.y = Math.sin(elapsed * 1.4) * .025;
        for (const avatar of avatars) avatar.update(0);
      }
    }
    controls.connect(renderer.domElement); resize.observe(document.body); resizeRenderer(); controls.update();
  }, capture(maxSize: unknown, format: unknown) {
    // Render and copy synchronously: preserveDrawingBuffer would slow every interactive frame.
    renderer.render(scene, camera);
    const edge = Math.max(64, Math.min(1024, Number(maxSize) || 1024));
    const canvas = document.createElement('canvas'), source = renderer.domElement;
    const scale = Math.min(1, edge / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
    return { image: canvas.toDataURL(format === 'webp' ? 'image/webp' : 'image/png', .9), width: canvas.width, height: canvas.height,
      view: { position: camera.position.toArray(), elapsed, quality } };
  }, rotate(amount: number) {
    camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.max(-.5, Math.min(.5, amount))); controls.update(); requestDraw();
    if (epoch === loadEpoch) report('view-changed');
  } };
}
