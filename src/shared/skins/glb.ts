import { skinError, skinObject } from './validation.js';
export const MAX_GLB_BYTES = 40 * 1024 * 1024;
export const GLB_DATA_PREFIX = 'data:model/gltf-binary;base64,';
export interface GlbInfo {
  format: 'glb' | 'vrm';
  animations: string[]; nodes: string[]; materials: string[];
  vrm?: { version: '0' | '1'; humanBones: Record<string, string>; expressions: string[]; springBones: boolean };
}
/** Validate the self-contained container before saving or giving it to a renderer. */
export function inspectGlb(bytes: Uint8Array): GlbInfo {
  if (bytes.byteLength > MAX_GLB_BYTES) throw skinError('SKIN_MODEL_TOO_LARGE');
  if (bytes.byteLength < 20) throw skinError('SKIN_MODEL_INVALID');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw skinError('SKIN_MODEL_INVALID');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength % 4 || jsonLength > bytes.byteLength - 20 || jsonLength > 4 * 1024 * 1024) throw skinError('SKIN_MODEL_INVALID');
  let data: Record<string, unknown>;
  try { data = skinObject(JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trim())); }
  catch { throw skinError('SKIN_MODEL_INVALID'); }
  if (skinObject(data.asset).version !== '2.0') throw skinError('SKIN_MODEL_INVALID');
  let offset = 20 + jsonLength;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) throw skinError('SKIN_MODEL_INVALID');
    const length = view.getUint32(offset, true);
    if (length % 4 || offset + 8 + length > bytes.byteLength) throw skinError('SKIN_MODEL_INVALID');
    offset += 8 + length;
  }
  const rows = (key: string) => {
    const list = data[key] ?? [];
    if (!Array.isArray(list)) throw skinError('SKIN_MODEL_INVALID');
    return list.map(skinObject);
  };
  for (const row of [...rows('buffers'), ...rows('images')]) {
    if (row.uri !== undefined && (typeof row.uri !== 'string' || !/^data:(?:image\/(?:png|jpeg|webp)|application\/octet-stream|application\/gltf-buffer);base64,[A-Za-z0-9+/]+=*$/.test(row.uri))) throw skinError('SKIN_MODEL_EXTERNAL');
  }
  const required = data.extensionsRequired || [];
  if (!Array.isArray(required)) throw skinError('SKIN_MODEL_INVALID');
  if (required.some(extension => ['KHR_draco_mesh_compression', 'KHR_texture_basisu', 'EXT_meshopt_compression', 'KHR_meshopt_compression'].includes(String(extension)))) throw skinError('SKIN_MODEL_COMPRESSION');
  const nodes = rows('nodes'), vrm = inspectVrm(data, nodes);
  return { format: vrm ? 'vrm' : 'glb', ...(vrm ? { vrm } : {}),
    animations: rows('animations').map((row, index) => String(row.name || `animation_${index}`)),
    nodes: nodes.map((row, index) => String(row.name || `node_${index}`)).slice(0, 300),
    materials: rows('materials').map((row, index) => String(row.name || `material_${index}`)).slice(0, 100) };
}

/** VRM uses the same self-contained binary container; detect its format from the payload. */
function inspectVrm(data: Record<string, unknown>, nodes: Record<string, unknown>[]): GlbInfo['vrm'] {
  const extensions = skinObject(data.extensions ?? {});
  if (extensions.VRMC_vrm === undefined && extensions.VRM === undefined) return undefined;
  const version = extensions.VRMC_vrm === undefined ? '0' : '1';
  const vrm = skinObject(version === '1' ? extensions.VRMC_vrm : extensions.VRM);
  if (version === '1' && vrm.specVersion !== '1.0') throw skinError('SKIN_MODEL_INVALID');
  const humanoid = skinObject(vrm.humanoid), bones = humanoid.humanBones;
  const entries = version === '1' ? Object.entries(skinObject(bones)).map(([bone, value]) => [bone, skinObject(value).node] as const)
    : Array.isArray(bones) ? bones.map(value => { const row = skinObject(value); return [row.bone, row.node] as const; }) : [];
  if (!entries.length || entries.some(([bone, node]) => typeof bone !== 'string' || !Number.isInteger(node) || !nodes[Number(node)])) throw skinError('SKIN_MODEL_INVALID');
  const humanBones = Object.fromEntries(entries.map(([bone, node]) => [String(bone), String(nodes[Number(node)]!.name || `node_${node}`)]));
  let expressions: string[];
  if (version === '1') {
    const expression = skinObject(vrm.expressions ?? {});
    expressions = [...Object.keys(skinObject(expression.preset ?? {})), ...Object.keys(skinObject(expression.custom ?? {}))];
  } else {
    const groups = skinObject(vrm.blendShapeMaster ?? {}).blendShapeGroups ?? [];
    if (!Array.isArray(groups)) throw skinError('SKIN_MODEL_INVALID');
    // three-vrm exposes VRM 0 presets using their VRM 1 names.
    const presets: Record<string, string> = { a: 'aa', e: 'ee', i: 'ih', o: 'oh', u: 'ou', joy: 'happy', sorrow: 'sad', fun: 'relaxed',
      lookup: 'lookUp', lookdown: 'lookDown', lookleft: 'lookLeft', lookright: 'lookRight', blink_l: 'blinkLeft', blink_r: 'blinkRight' };
    expressions = groups.flatMap(value => {
      const group = skinObject(value), preset = String(group.presetName || 'unknown');
      const name = preset === 'unknown' ? group.name : presets[preset] || preset;
      return typeof name === 'string' ? [name] : [];
    });
  }
  return { version, humanBones, expressions: [...new Set(expressions)].slice(0, 100),
    springBones: version === '1' ? extensions.VRMC_springBone !== undefined : vrm.secondaryAnimation !== undefined };
}
export function glbDataBytes(source: string): Uint8Array<ArrayBuffer> {
  if (!source.startsWith(GLB_DATA_PREFIX) || source.length > Math.ceil(MAX_GLB_BYTES / 3) * 4 + GLB_DATA_PREFIX.length) throw skinError('SKIN_MODEL_INVALID');
  try {
    // Modern Chrome decodes directly to bytes, avoiding the large intermediate UTF-16 string.
    const nativeDecode = (Uint8Array as unknown as { fromBase64?: (source: string) => Uint8Array<ArrayBuffer> }).fromBase64;
    if (nativeDecode) return nativeDecode.call(Uint8Array, source.slice(GLB_DATA_PREFIX.length));
    const binary = atob(source.slice(GLB_DATA_PREFIX.length));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch { throw skinError('SKIN_MODEL_INVALID'); }
}
