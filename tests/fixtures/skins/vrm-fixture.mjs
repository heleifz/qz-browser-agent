import { BoxGeometry, Matrix4 } from 'three';

/** Synthetic textured avatar: humanoid, skinned head, expression and spring hair. No downloaded art. */
export function vrmFixture(version = '1', customize = () => {}) {
  const chunks = [], bufferViews = [], accessors = [], nodes = [], humanBones = {};
  let byteLength = 0;
  const bufferView = bytes => {
    const view = bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length }) - 1;
    const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4); bytes.copy(padded);
    chunks.push(padded); byteLength += padded.length; return view;
  };
  const accessor = (array, type, componentType = 5126, bounds = {}) => accessors.push({
    bufferView: bufferView(Buffer.from(array.buffer, array.byteOffset, array.byteLength)), componentType,
    count: array.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type]), type, ...bounds,
  }) - 1;
  const bone = (name, parent, translation) => {
    const index = nodes.push({ name, translation, children: [] }) - 1;
    if (parent !== null) nodes[parent].children.push(index);
    humanBones[name] = { node: index }; return index;
  };
  const hips = bone('hips', null, [0, 1, 0]), spine = bone('spine', hips, [0, .5, 0]);
  const head = bone('head', spine, [0, .7, 0]);
  for (const [side, x] of [['left', 1], ['right', -1]]) {
    const leg = bone(`${side}UpperLeg`, hips, [x * .2, -.1, 0]);
    const knee = bone(`${side}LowerLeg`, leg, [0, -.4, 0]); bone(`${side}Foot`, knee, [0, -.4, .1]);
    const arm = bone(`${side}UpperArm`, spine, [x * .3, .3, 0]);
    const elbow = bone(`${side}LowerArm`, arm, [x * .4, 0, 0]); bone(`${side}Hand`, elbow, [x * .3, 0, 0]);
  }
  const hair = nodes.push({ name: 'hair', translation: [0, .4, 0], children: [nodes.length + 1], mesh: 2 }) - 1;
  const tip = nodes.push({ name: 'hairTip', translation: [0, .4, 0] }) - 1;
  nodes[head].children.push(hair);
  const geometry = (width, height, depth, y, skinned = false) => {
    const box = new BoxGeometry(width, height, depth).translate(0, y, 0); box.computeBoundingBox();
    const count = box.attributes.position.count;
    const attributes = Object.fromEntries([['POSITION', 'position', 'VEC3'], ['NORMAL', 'normal', 'VEC3'], ['TEXCOORD_0', 'uv', 'VEC2']]
      .map(([name, field, type]) => [name, accessor(box.attributes[field].array, type, 5126,
        name === 'POSITION' ? { min: box.boundingBox.min.toArray(), max: box.boundingBox.max.toArray() } : {})]));
    if (skinned) {
      attributes.JOINTS_0 = accessor(new Uint16Array(count * 4), 'VEC4', 5123);
      attributes.WEIGHTS_0 = accessor(Float32Array.from({ length: count * 4 }, (_, i) => i % 4 === 0 ? 1 : 0), 'VEC4');
    }
    const primitive = { attributes, indices: accessor(box.index.array, 'SCALAR', 5123), material: 0 };
    if (skinned) primitive.targets = [{ POSITION: accessor(Float32Array.from({ length: count * 3 }, (_, i) => i % 3 === 0 ? .2 : 0), 'VEC3') }];
    box.dispose(); return { primitives: [primitive], ...(skinned ? { weights: [0], extras: { targetNames: ['Smile'] } } : {}) };
  };
  const meshes = [geometry(.7, 1.2, .4, 1.2), geometry(.8, .7, .6, 2.2, true), geometry(.15, .4, .15, .2)];
  const bodyNode = nodes.push({ name: 'Body', mesh: 0 }) - 1;
  const faceNode = nodes.push({ name: 'Face', mesh: 1, skin: 0 }) - 1;
  const inverseBind = accessor(new Float32Array(new Matrix4().makeTranslation(0, -2.2, 0).elements), 'MAT4');
  const image = bufferView(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==', 'base64'));
  const data = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [hips, bodyNode, faceNode] }], nodes, meshes,
    skins: [{ joints: [head], inverseBindMatrices: inverseBind }],
    materials: [{ name: 'Outfit', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [.2, .4, .8, 1], baseColorTexture: { index: 0 }, metallicFactor: 0 },
      extensions: { VRMC_materials_mtoon: { specVersion: '1.0', shadeColorFactor: [.15, .2, .5], shadingToonyFactor: .9 } } }],
    textures: [{ source: 0 }], images: [{ bufferView: image, mimeType: 'image/png' }],
    buffers: [{ byteLength }], bufferViews, accessors,
    extensionsUsed: ['VRMC_vrm', 'VRMC_materials_mtoon', 'VRMC_springBone'],
    extensions: { VRMC_vrm: { specVersion: '1.0',
      meta: { name: 'Synthetic avatar', authors: ['qz tests'], licenseUrl: 'https://vrm.dev/licenses/1.0/' },
      humanoid: { humanBones }, expressions: { preset: { happy: { morphTargetBinds: [{ node: faceNode, index: 0, weight: 1 }] } } } },
      VRMC_springBone: { specVersion: '1.0', springs: [{ joints: [{ node: hair, gravityPower: .2 }, { node: tip }] }] } },
  };
  if (version === '0') {
    data.extensionsUsed = ['VRM', 'VRMC_materials_mtoon'];
    data.extensions = { VRM: { specVersion: '0.0', meta: { title: 'Synthetic legacy avatar', author: 'qz tests', licenseName: 'CC0' },
      humanoid: { humanBones: Object.entries(humanBones).map(([bone, { node }]) => ({ bone, node })) },
      blendShapeMaster: { blendShapeGroups: [{ name: 'Joy', presetName: 'joy', binds: [{ mesh: 1, index: 0, weight: 100 }] }] },
      secondaryAnimation: { boneGroups: [{ bones: [hair], gravityDir: { x: 0, y: -1, z: 0 }, gravityPower: .2, dragForce: .4, stiffiness: 1, hitRadius: .02, center: -1, colliderGroups: [] }] },
    } };
  }
  customize(data);
  const json = Buffer.from(JSON.stringify(data)), jsonSize = Math.ceil(json.length / 4) * 4;
  const result = Buffer.alloc(28 + jsonSize + byteLength);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonSize, 12); result.writeUInt32LE(0x4e4f534a, 16); result.fill(32, 20, 20 + jsonSize); json.copy(result, 20);
  result.writeUInt32LE(byteLength, 20 + jsonSize); result.writeUInt32LE(0x004e4942, 24 + jsonSize);
  Buffer.concat(chunks).copy(result, 28 + jsonSize); return result;
}
