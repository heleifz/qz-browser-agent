import * as THREE from 'three';
import type { SkinCamera } from '../../shared/skins/preview.js';

const portraits = new WeakMap<THREE.Object3D, { bounds: THREE.Box3; position: THREE.Vector3 }>();
function headBounds(root: THREE.Object3D, head: THREE.Object3D, body: THREE.Box3) {
  const position = head.getWorldPosition(new THREE.Vector3()), cached = portraits.get(head);
  if (cached) return cached.bounds.clone().translate(position.clone().sub(cached.position));
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  const neck = position.y - (body.max.y - body.min.y) * .035;
  root.traverse(object => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    if (!indices || !weights) return;
    const headJoints = new Set(mesh.skeleton.bones.flatMap((bone, index) => {
      for (let node: THREE.Object3D | null = bone; node; node = node.parent) if (node === head) return [index];
      return [];
    }));
    if (!headJoints.size) return;
    mesh.skeleton.update();
    for (let index = 0; index < indices.count; index++) {
      let influence = 0;
      for (let component = 0; component < 4; component++) if (headJoints.has(indices.getComponent(index, component))) influence += weights.getComponent(index, component);
      if (influence < .5) continue;
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      // Long hair can extend to the body; frame the face and head silhouette above the neck.
      if (point.y >= neck) bounds.expandByPoint(point);
    }
  });
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(body.min.x, position.y, body.min.z), body.max.clone());
  portraits.set(head, { bounds: bounds.clone(), position });
  return bounds;
}

/** Frame the selected subject; humanoid head data improves portraits without assuming every model has feet. */
export function frameSkinSubject(root: THREE.Object3D, head: THREE.Object3D | null | undefined, preset: SkinCamera) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root), bodySize = bounds.getSize(new THREE.Vector3());
  if (preset !== 'full') {
    if (head) {
      const portrait = headBounds(root, head, bounds);
      if (preset === 'bust') portrait.min.y = Math.max(bounds.min.y, portrait.min.y - bodySize.y * .25);
      bounds.copy(portrait);
    } else bounds.min.y = bounds.max.y - bodySize.y * (preset === 'close' ? .45 : .75);
  }
  const size = bounds.getSize(new THREE.Vector3()), target = bounds.getCenter(new THREE.Vector3());
  return { target, distance: Math.max(.2, Math.max(size.x, size.y) * .58 / Math.tan(THREE.MathUtils.degToRad(35 / 2)) + size.z / 2) };
}

/** A temporary render target keeps thumbnails and photos out of the visible drawing buffer. */
export function photographSkin(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
  maxSize: unknown, format: unknown, square = false) {
  const edge = Math.max(64, Math.min(1024, Number(maxSize) || 1024));
  const aspect = square ? 1 : camera.aspect;
  const width = Math.max(1, Math.round(edge * Math.min(1, aspect)));
  const height = Math.max(1, Math.round(edge / Math.max(1, aspect)));
  const lens = camera.clone(); lens.aspect = aspect; lens.updateProjectionMatrix();
  const target = new THREE.WebGLRenderTarget(width, height, { samples: Math.min(4, renderer.capabilities.maxSamples) });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target); renderer.render(scene, lens);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!, image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - y - 1) * width * 4, (height - y) * width * 4), y * width * 4);
    // WebGL's transparent output is premultiplied; ImageData expects straight alpha.
    for (let i = 0; i < image.data.length; i += 4) {
      const alpha = image.data[i + 3]!;
      if (alpha && alpha < 255) for (let c = 0; c < 3; c++) image.data[i + c] = Math.min(255, Math.round(image.data[i + c]! * 255 / alpha));
    }
    context.putImageData(image, 0, 0);
    return { image: canvas.toDataURL(format === 'webp' ? 'image/webp' : 'image/png', .9), width, height };
  } finally { renderer.setRenderTarget(previous); target.dispose(); }
}
