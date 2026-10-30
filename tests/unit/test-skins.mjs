import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { GLB_DATA_PREFIX, MAX_GLB_BYTES, glbDataBytes, inspectGlb } from '../../src/shared/skins/glb.js';
import { prepareMessage } from '../../src/shared/transport/message-codec.js';
import { createSkinRepository } from '../../src/background/skins/repository.js';
import { assertSkinSender, createSkinService } from '../../src/background/skins/service.js';
import { readSkinPreview } from '../../src/shared/skins/preview.js';

test('validated library cache survives reopening, isolates callers and invalidates external writes', async () => {
  const storage = createMemoryStorage(); let reads = 0, fail = false;
  const repository = createSkinRepository({
    get: async key => { reads++; return storage.get(key); },
    set: async value => { if (fail) throw new Error('disk full'); return storage.set(value); },
  }, undefined, undefined, true);
  const first = await repository.snapshot();
  first.active.name = 'caller mutation';
  (await repository.get('qingzhou')).quotes.push('caller mutation');
  const next = await repository.snapshot();
  assert.notEqual(next.active.name, first.active.name);
  assert.ok(!next.active.quotes.includes('caller mutation'));
  assert.equal(reads, 1, 'reopening must not re-read and re-validate model binaries');
  assert.deepEqual(await repository.welcome('qingzhou', 1), { activeId: 'qingzhou', revision: 1 },
    'an unchanged render cache needs no model bytes over the message channel');
  assert.ok((await repository.welcome('other', 1)).active);
  fail = true;
  await assert.rejects(repository.mutate({ action: 'update', id: 'qingzhou', revision: 1, patch: { name: 'failed write' } }), /disk full/);
  assert.equal((await repository.get('qingzhou')).revision, 1);
  fail = false;
  const updated = await repository.mutate({ action: 'update', id: 'qingzhou', revision: 1, patch: { name: 'saved draft' } });
  updated.skin.name = 'caller mutation';
  assert.equal((await repository.get('qingzhou')).name, 'saved draft');
  assert.equal((await repository.welcome()).active.revision, 1, 'welcome reads the saved skin, never a pending draft');
  await storage.set({ qingzhou_skins_v1: undefined }); repository.invalidate();
  assert.equal((await repository.get('qingzhou')).revision, 1);
  assert.equal(reads, 2);
});

test('studio screenshot returns an image for the selected revision and rejects stale or stopped runs', async () => {
  let live = true, duringCapture = async () => {};
  const calls = [], image = 'data:image/png;base64,AAAA';
  const service = createSkinService({ storage: createMemoryStorage(), emit() {}, isRunCurrent: () => live,
    openEditor: async (id, sessionId) => { calls.push({ id, sessionId }); return { id: 12 }; },
    captureEditor: async (tabId, id, revision, sessionId) => {
      assert.deepEqual([tabId, id, revision, sessionId], [12, 'dafeiyu', 1, 's']);
      await duringCapture(); return { image, width: 300, height: 320 };
    },
  });
  const context = { sessionId: 's', runId: 'r' };
  const shot = await service.execute({ action: 'screenshot', id: 'dafeiyu', revision: 1 }, context);
  assert.equal(shot._image, image); assert.equal(shot.actionable, false); assert.equal(shot.scope, 'skin-preview');
  assert.deepEqual(calls[0], { id: 'dafeiyu', sessionId: 's' });
  await assert.rejects(service.execute({ action: 'screenshot', id: 'dafeiyu', revision: 99 }, context), { code: 'SKIN_CONFLICT' });
  duringCapture = async () => { live = false; };
  await assert.rejects(service.execute({ action: 'screenshot', id: 'dafeiyu' }, context), { code: 'SKIN_RUN_EXPIRED' });
  live = true;
  duringCapture = async () => { await service.execute({ action: 'update', id: 'dafeiyu', revision: 1, patch: { name: 'Changed' } }, context); };
  await assert.rejects(service.execute({ action: 'screenshot', id: 'dafeiyu' }, context), { code: 'SKIN_CONFLICT' });
  for (const invalid of [null, { image: 'https://example.com/image.png', width: 1, height: 1 },
    { image, width: 2048, height: 1 }, { image: 'data:image/svg+xml;base64,AAAA', width: 1, height: 1 }]) {
    assert.throws(() => readSkinPreview(invalid), { code: 'SKIN_PREVIEW_UNAVAILABLE' });
  }
});
import { createDefaultSkinLibrary } from '../../src/shared/skins/defaults.js';
import { chooseSkinQuote, exportSkinPackage, normalizeSkin, parseSkinPackage, SKIN_STORAGE_KEY, sameSkinData } from '../../src/shared/skins/model.js';
import { createMemoryStorage } from '../support/memory-storage.mjs';
import { vrmFixture } from '../fixtures/skins/vrm-fixture.mjs';

test('character looks, saved comparisons and expression overrides survive restart and portable import', async () => {
  const storage = createMemoryStorage(), repository = createSkinRepository(storage);
  const src = GLB_DATA_PREFIX + vrmFixture().toString('base64');
  const { skin: original } = await repository.mutate({ action: 'create', skin: { name: 'Avatar',
    visual: { type: 'model3d', src }, quotes: [], assets: {} } });
  const character = { id: original.id, name: original.name };
  const { skin: look } = await repository.mutate({ action: 'create', skin: { ...original, character, name: 'Happy look' } });
  const { skin: edited } = await repository.mutate({ action: 'update', id: look.id, revision: look.revision,
    patch: { visual: { type: 'model3d', expressions: { happy: .8 } } } });
  assert.deepEqual(edited.visual.expressions, { happy: .8 });
  assert.equal((await repository.get(look.id, true)).visual.expressions, undefined);
  assert.equal((await repository.snapshot()).activeId, 'qingzhou', 'new looks and drafts do not apply themselves');
  assert.deepEqual((await repository.snapshot()).skins.find(skin => skin.id === look.id).character, character);
  const restarted = createSkinRepository(storage);
  assert.deepEqual((await restarted.get(look.id)).character, character);
  assert.deepEqual((await restarted.get(look.id)).visual.expressions, { happy: .8 });
  for (const expressions of [{ missing: 1 }, { happy: -1 }, { happy: 1.1 }, { happy: '1' }]) {
    await assert.rejects(restarted.mutate({ action: 'update', id: look.id, revision: edited.revision,
      patch: { visual: { type: 'model3d', expressions } } }), { code: 'SKIN_INVALID' });
  }
  const { skin: imported } = await restarted.mutate({ action: 'import', package: exportSkinPackage(edited) });
  assert.notEqual(imported.id, look.id); assert.deepEqual(imported.character, character);
  assert.deepEqual(imported.visual.expressions, { happy: .8 });
  const { skin: reverted } = await restarted.mutate({ action: 'revert', id: look.id, revision: edited.revision });
  assert.equal(reverted.visual.expressions, undefined);
  assert.deepEqual(reverted.character, character); assert.equal((await restarted.get(original.id)).name, 'Avatar');
  const { skin: reset } = await restarted.mutate({ action: 'update', id: imported.id, revision: imported.revision,
    patch: { visual: { type: 'model3d', expressions: {} } } });
  assert.deepEqual(reset.visual.expressions, {}, 'the complete override map is replaced, allowing source expressions again');
});

test('saved reads are isolated from callers and never replace the current draft', async () => {
  const service = createSkinService({ storage: createMemoryStorage(), emit() {}, openEditor: async () => ({}), isRunCurrent: () => true });
  await service.execute({ action: 'update', id: 'dafeiyu', revision: 1, patch: { name: 'New look' } });
  const { skin: saved } = await service.execute({ action: 'get', id: 'dafeiyu', saved: true });
  assert.equal(saved.revision, 1); saved.name = 'Caller change';
  assert.equal((await service.execute({ action: 'get', id: 'dafeiyu' })).skin.name, 'New look');
  assert.notEqual((await service.execute({ action: 'get', id: 'dafeiyu', saved: true })).skin.name, saved.name);
});

test('skins keep drafts separate from the active saved skin across restarts', async () => {
  const storage = createMemoryStorage(), repository = createSkinRepository(storage);
  const original = await repository.get('qingzhou');
  const edited = await repository.mutate({ action: 'update', id: original.id, revision: 1, patch: { quotes: ['New words'] } });
  assert.equal(edited.skin.revision, 2);
  assert.notDeepEqual((await repository.snapshot()).active.quotes, ['New words']);
  const restarted = createSkinRepository(storage);
  assert.deepEqual((await restarted.get(original.id)).quotes, ['New words']);
  await restarted.mutate({ action: 'apply', id: original.id, revision: 2 });
  assert.deepEqual((await createSkinRepository(storage).snapshot()).active.quotes, ['New words']);
});

test('concurrent editors cannot silently overwrite a changed revision', async () => {
  const repository = createSkinRepository(createMemoryStorage());
  const outcomes = await Promise.allSettled([
    repository.mutate({ action: 'update', id: 'dafeiyu', revision: 1, patch: { name: 'First' } }),
    repository.mutate({ action: 'update', id: 'dafeiyu', revision: 1, patch: { name: 'Second' } }),
  ]);
  assert.equal(outcomes[0].status, 'fulfilled');
  assert.equal(outcomes[1].reason.code, 'SKIN_CONFLICT');
  assert.equal((await repository.get('dafeiyu')).name, 'First');
  await assert.rejects(repository.mutate({ action: 'apply', id: 'dafeiyu', revision: 1 }), { code: 'SKIN_CONFLICT' });
});

test('studio summary replies omit the active binary while retaining the edited draft and save state', async () => {
  const service=createSkinService({storage:createMemoryStorage(),emit(){},isRunCurrent:()=>true,openEditor:async()=>({})});
  const created=await service.execute({action:'create',skin:{name:'VRM',visual:{type:'model3d',src:GLB_DATA_PREFIX+vrmFixture().toString('base64')},quotes:[],assets:{}}});
  const {id,revision}=created.skin;
  const applied=await service.execute({action:'apply',id,revision,summaryOnly:true});
  assert.equal(applied.skin.visual.src,created.skin.visual.src);assert.equal('active' in applied.snapshot,false);
  const listed=await service.execute({action:'list',summaryOnly:true});
  assert.equal(listed.activeId,id);assert.equal('active' in listed,false);
  const edited=await service.execute({action:'update',id,revision,summaryOnly:true,patch:{visual:{type:'model3d',source:'return {root:model}; // edit'}}});
  assert.equal(edited.skin.visual.src,created.skin.visual.src);assert.equal('active' in edited.snapshot,false);
  assert.equal(edited.snapshot.skins.find(s=>s.id===id).modified,true);
  assert.equal((await service.execute({action:'list'})).active.visual.source,created.skin.visual.source);
  const restored=await service.execute({action:'revert',id,revision:edited.skin.revision,summaryOnly:true});
  assert.equal(restored.skin.visual.source,created.skin.visual.source);
});

test('portable skins retain source, image bytes and phrases and imports get new identities', async () => {
  let id = 0;
  const repository = createSkinRepository(createMemoryStorage(), () => {}, () => `import-${++id}`);
  for (const entry of createDefaultSkinLibrary().entries) {
    const original = entry.draft;
    const restored = parseSkinPackage(JSON.parse(JSON.stringify(exportSkinPackage(original))));
    assert.deepEqual(restored, original);
    const imported = await repository.mutate({ action: 'import', package: exportSkinPackage(original) });
    assert.notEqual(imported.skin.id, original.id);
    assert.deepEqual(imported.skin.visual, original.visual);
    assert.deepEqual(imported.skin.quotes, original.quotes);
  }
  assert.equal((await repository.snapshot()).skins.length, 4);
});

test('invalid imports, network images and unsupported versions cannot change storage', async () => {
  const storage = createMemoryStorage(), repository = createSkinRepository(storage);
  const sample = (await repository.get('qingzhou'));
  for (const visual of [{ type: 'image2d', src: 'https://example.com/a.png' }, { type: 'image2d', src: 'data:image/svg+xml;base64,PHN2Zz4=' }, { type: 'scene3d', source: 'x'.repeat(262145) }]) {
    await assert.rejects(repository.mutate({ action: 'import', package: exportCandidate({ ...sample, visual }) }));
  }
  await assert.rejects(repository.mutate({ action: 'import', package: { ...exportCandidate(sample), version: 99 } }), { code: 'SKIN_VERSION_UNSUPPORTED' });
  assert.throws(() => normalizeSkin({ ...sample, quotes: [42] }), { code: 'SKIN_INVALID' });
  await assert.rejects(repository.mutate({ action: 'update', id: sample.id, revision: 1, patch: { id: 'overwrite' } }));
  assert.equal(storage.writes.length, 0);
});

test('cancelled queued writes and expired agent runs leave the skin intact', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const storage = createMemoryStorage(); let pause = true;
  const repository = createSkinRepository({ ...storage, async get(key) { if (pause) { pause = false; await gate; } return storage.get(key); } });
  const first = repository.snapshot();
  const controller = new AbortController();
  const writing = repository.mutate({ action: 'update', id: 'qingzhou', revision: 1, patch: { name: 'Late' } }, () => controller.signal.throwIfAborted());
  controller.abort(); release(); await first;
  await assert.rejects(writing, /abort/i);
  const service = createSkinService({ storage, emit() {}, isRunCurrent: () => false, openEditor: async () => ({}) });
  await assert.rejects(service.execute({ action: 'update', id: 'qingzhou', revision: 1, patch: { name: 'Expired' } }, { sessionId: 's', runId: 'r' }), { code: 'SKIN_RUN_EXPIRED' });
  assert.equal(storage.writes.length, 0);
});

test('storage failures recover, deleting an active skin selects a valid fallback', async () => {
  const base = createMemoryStorage(); let fail = true;
  const repository = createSkinRepository({ ...base, async set(value) { if (fail) { fail = false; throw new Error('disk'); } await base.set(value); } });
  await assert.rejects(repository.mutate({ action: 'apply', id: 'dafeiyu', revision: 1 }), /disk/);
  await repository.mutate({ action: 'apply', id: 'dafeiyu', revision: 1 });
  const result = await repository.mutate({ action: 'delete', id: 'dafeiyu', revision: 1 });
  assert.equal(result.snapshot.activeId, 'qingzhou');
  await assert.rejects(repository.mutate({ action: 'delete', id: 'qingzhou', revision: 1 }), { code: 'SKIN_LAST_ENTRY' });
  assert.equal(base.snapshot()[SKIN_STORAGE_KEY].entries.length, 1);
});

test('revert restores the latest complete save and rejects stale writers across restarts', async () => {
  const storage = createMemoryStorage(), repository = createSkinRepository(storage);
  const original = await repository.get('dafeiyu');
  const saved = (await repository.mutate({ action: 'update', id: original.id, revision: 1, patch: {
    name: 'My saved character', quotes: ['Saved words'], assets: { accent: 'builtin:logo-night' },
  } })).skin;
  await repository.mutate({ action: 'apply', id: original.id, revision: saved.revision });
  await repository.mutate({ action: 'update', id: original.id, revision: saved.revision, patch: {
    name: 'Draft', quotes: ['Draft words'], assets: {}, visual: { type: 'image2d', src: 'builtin:logo-day' },
  } });
  const restarted = createSkinRepository(storage);
  const result = await restarted.mutate({ action: 'revert', id: original.id, revision: 3 });
  assert.deepEqual(result.skin, { ...saved, revision: 4 });
  assert.deepEqual(result.snapshot.active, result.skin);
  assert.equal(result.snapshot.skins.find(skin => skin.id === original.id).modified, false);
  await assert.rejects(restarted.mutate({ action: 'update', id: original.id, revision: 3, patch: { name: 'Late edit' } }), { code: 'SKIN_CONFLICT' });
  await assert.rejects(restarted.mutate({ action: 'apply', id: original.id, revision: 3 }), { code: 'SKIN_CONFLICT' });
});

test('only packaged editor and sidepanel pages can call skin commands', () => {
  for (const path of ['dom/skins/editor.html?skin=test', 'sidepanel/sidepanel.html']) assertSkinSender({ id: 'qz', url: `chrome-extension://qz/${path}` }, 'qz');
  for (const sender of [{ id: 'qz', url: 'https://example.com' }, { id: 'other', url: 'chrome-extension://qz/dom/skins/editor.html' }, { id: 'qz', url: 'chrome-extension://qz/dom/skins/sandbox.html' }]) {
    assert.throws(() => assertSkinSender(sender, 'qz'), { code: 'SKIN_FORBIDDEN' });
  }
});

test('quotes avoid immediate repeats and handle empty lists', () => {
  assert.equal(chooseSkinQuote(['one', 'two'], 'one', () => 0), 'two');
  assert.equal(chooseSkinQuote([], '', () => 0), '');
  assert.equal(chooseSkinQuote(['one'], 'one', () => 0), 'one');
});
function exportCandidate(skin) { return { format: 'qingzhou-skin', version: 1, skin }; }

test('skin data comparison detects edits without serializing model payloads', () => {
  const skin=createDefaultSkinLibrary().entries[1].draft;
  assert.equal(sameSkinData(skin,structuredClone(skin)),true);
  assert.equal(sameSkinData(skin,{...skin,revision:2}),false);
  assert.equal(sameSkinData(skin,{...skin,visual:{...skin.visual,source:'return {}'}}),false);
  assert.equal(sameSkinData({models:{a:{src:'one'},b:{src:'two'}}},{models:{b:{src:'two'},a:{src:'one'}}}),true);
  assert.equal(sameSkinData(['a'],{0:'a'}),false);
  assert.equal(sameSkinData({a:undefined},{b:undefined}),false);
});

test('native and fallback binary decoders preserve all bytes and reject corrupt input', () => {
  const bytes=Buffer.from(Array.from({length:1025},(_,i)=>i%256));
  const source=GLB_DATA_PREFIX+bytes.toString('base64'), native=Uint8Array.fromBase64;
  try {
    for(const decoder of [native,undefined]) {
      Uint8Array.fromBase64=decoder;
      assert.deepEqual(Buffer.from(glbDataBytes(source)),bytes);
      for(const invalid of ['!!!!','A','===']) assert.throws(()=>glbDataBytes(GLB_DATA_PREFIX+invalid),{code:'SKIN_MODEL_INVALID'});
    }
  } finally { Uint8Array.fromBase64=native; }
});

test('GLB import retains skinned animations and supports partial customization without resending binary', async () => {
  const bytes = await readFile(new URL('../fixtures/skins/Fox.glb', import.meta.url));
  const info = inspectGlb(bytes);
  assert.deepEqual(info.animations, ['Survey', 'Walk', 'Run']); assert.ok(info.nodes.length > 10);
  const repository = createSkinRepository(createMemoryStorage());
  const src = GLB_DATA_PREFIX + bytes.toString('base64');
  const created = await repository.mutate({ action: 'create', skin: { name: 'Fox', visual: { type: 'model3d', src }, quotes: ['Hello'], assets: {} } });
  const result = await repository.mutate({ action: 'update', id: created.skin.id, revision: 1, patch: {
    visual: { type: 'model3d', animation: 'Walk', rotationY: 90, source: 'model.scale.setScalar(1.1); return {root:model};' },
  } });
  assert.equal(result.skin.visual.src, src); assert.equal(result.skin.visual.animation, 'Walk');
  const portable = parseSkinPackage(exportSkinPackage(result.skin));
  assert.deepEqual(Buffer.from(glbDataBytes(portable.visual.src)), bytes);
  await repository.mutate({ action: 'apply', id: created.skin.id, revision: 2 });
  assert.equal((await repository.snapshot()).active.visual.animation, 'Walk');
  await repository.mutate({ action: 'update', id: created.skin.id, revision: 2, patch: {
    visual: { type: 'model3d', animation: 'Run', animationSpeed: 2, rotationY: -45, source: 'throw new Error("broken draft");' },
  } });
  const restored = await repository.mutate({ action: 'revert', id: created.skin.id, revision: 3 });
  assert.deepEqual(restored.skin, { ...result.skin, revision: 4 });
  assert.deepEqual(Buffer.from(glbDataBytes(restored.skin.visual.src)), bytes);
});

test('GLB containers reject external resources, unsupported decoders and corrupt lengths before persistence', () => {
  const glb = data => {
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, ...data }));
    const length = Math.ceil(json.length / 4) * 4, bytes = Buffer.alloc(20 + length, 32);
    bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20); return bytes;
  };
  assert.throws(() => inspectGlb(glb({ images: [{ uri: 'https://example.invalid/texture.png' }] })), { code: 'SKIN_MODEL_EXTERNAL' });
  assert.throws(() => inspectGlb(glb({ buffers: [{ uri: '../outside.bin' }] })), { code: 'SKIN_MODEL_EXTERNAL' });
  assert.throws(() => inspectGlb(glb({ extensionsRequired: ['KHR_draco_mesh_compression'] })), { code: 'SKIN_MODEL_COMPRESSION' });
  const invalid = glb({}); invalid.writeUInt32LE(9999, 8);
  assert.throws(() => inspectGlb(invalid), { code: 'SKIN_MODEL_INVALID' });
  assert.throws(() => inspectGlb(new Uint8Array(5)), { code: 'SKIN_MODEL_INVALID' });
});

test('40 MiB GLB survives saving, restart and portable reimport within the reply budget', async () => {
  // Generate the large binary at runtime; keep large assets out of the fixture tree.
  const bytes = Buffer.alloc(40 * 1024 * 1024);
  const jsonLength = 228, binaryOffset = 20 + jsonLength + 8;
  const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: bytes.length - binaryOffset }] });
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonLength, 12); bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.fill(32, 20, 20 + jsonLength); bytes.write(json, 20);
  bytes.writeUInt32LE(bytes.length - binaryOffset, 20 + jsonLength);
  bytes.writeUInt32LE(0x004e4942, 24 + jsonLength);
  const src = GLB_DATA_PREFIX + bytes.toString('base64');
  // Retain only the latest serialized storage value rather than a history of large writes.
  let persisted;
  const storage = {
    async get(key) { return { [key]: persisted === undefined ? undefined : JSON.parse(persisted) }; },
    async set(value) { persisted = JSON.stringify(value[SKIN_STORAGE_KEY]); },
  };
  const repository = createSkinRepository(storage);
  const { skin } = await repository.mutate({ action: 'create', skin: {
    name: 'Large GLB', visual: { type: 'model3d', src }, quotes: ['Hello'], assets: {},
  } });
  const applied = await repository.mutate({ action: 'apply', id: skin.id, revision: skin.revision });
  assert.equal(applied.snapshot.active.visual.src, src);
  // Apply replies carry the binary twice: the edited skin and the active snapshot.
  assert.ok(prepareMessage({ type: 'skin_command_result', result: applied }).bytes > 100 * 1024 * 1024);
  const restarted = createSkinRepository(storage);
  const exported = exportSkinPackage(await restarted.get(skin.id));
  const imported = await restarted.mutate({ action: 'import', package: JSON.parse(JSON.stringify(exported)) });
  assert.notEqual(imported.skin.id, skin.id);
  assert.equal(imported.skin.visual.src, src);
  assert.equal(Buffer.compare(Buffer.from(glbDataBytes(imported.skin.visual.src)), bytes), 0);
  const before = persisted;
  assert.throws(() => inspectGlb(new Uint8Array(MAX_GLB_BYTES + 1)), { code: 'SKIN_MODEL_TOO_LARGE' });
  await assert.rejects(restarted.mutate({ action: 'update', id: skin.id, revision: skin.revision, patch: {
    visual: { type: 'model3d', src: src + 'AAAA' },
  } }), { code: 'SKIN_MODEL_INVALID' });
  assert.equal(persisted, before);
});

test('studio context follows only the current chat and rejects ambiguous or foreign editors', async () => {
  const { selectSkinEditor } = await import('../../src/background/skins/service.js');
  const tab = (skin, session = 's', active = false) => ({ url: `chrome-extension://qz/dom/skins/editor.html?skin=${skin}&session=${session}`, active });
  assert.deepEqual(selectSkinEditor([tab('one'), tab('two', 'other', true)], 'qz', 's'), { skinId: 'one' });
  assert.deepEqual(selectSkinEditor([tab('one'), tab('two', 's', true)], 'qz', 's'), { skinId: 'two' });
  assert.equal(selectSkinEditor([tab('one'), tab('two')], 'qz', 's'), null);
  assert.equal(selectSkinEditor([tab('one')], 'qz', ''), null);
  assert.equal(selectSkinEditor([{ url: 'https://qz/dom/skins/editor.html?skin=x&session=s' }], 'qz', 's'), null);
  assert.equal(selectSkinEditor([tab('one')], 'foreign', 's'), null);
  assert.deepEqual(selectSkinEditor([{ ...tab('one'), url: tab('one').url + '&character=fish' }], 'qz', 's'), { skinId: 'one', characterId: 'fish' });
  assert.deepEqual(selectSkinEditor([{ ...tab('one'), url: tab('one').url + '&character=bad%20id' }], 'qz', 's'), { skinId: 'one' });
});

test('chat tools inspect GLB metadata without returning binary and apply only current revisions', async () => {
  const { default: register } = await import('../../src/capabilities/skins/tools.js');
  const storage = createMemoryStorage();
  const service = createSkinService({ storage, emit() {}, isRunCurrent: (s, r) => s === 's' && r === 'r', openEditor: async () => ({}) });
  const src = GLB_DATA_PREFIX + (await readFile(new URL('../fixtures/skins/Fox.glb', import.meta.url))).toString('base64');
  const created = await service.execute({ action: 'create', skin: { name: 'Fox', visual: { type: 'model3d', src }, quotes: [], assets: {} } });
  let tool;
  register({ registerTool: definition => { tool = definition; }, getToolRuntimeDependencies: () => ({ skins: service }),
    ToolExecutionError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
  });
  const call = args => tool.execute(args, new AbortController().signal, { sessionId: 's', runId: 'r' });
  const got = await call({ action: 'get', id: created.skin.id });
  assert.equal(got.skin.visual.src, undefined); assert.ok(got.modelInfo.animations.includes('Walk'));
  assert.ok(JSON.stringify(got).length < 10000);
  const updated = await call({ action: 'update', id: created.skin.id, revision: 1, patch: JSON.stringify({ visual: { type: 'model3d', rotationY: 45 } }) });
  assert.equal(updated.revision, 2); assert.ok(JSON.stringify(updated).length < 1000);
  await assert.rejects(call({ action: 'apply', id: created.skin.id, revision: 1 }), { code: 'SKIN_CONFLICT' });
  const applied = await call({ action: 'apply', id: created.skin.id, revision: 2 });
  assert.equal(applied.applied, true);
  assert.equal((await service.execute({ action: 'get', id: created.skin.id })).skin.visual.src, src);
});

for (const version of ['0', '1']) test(`VRM ${version} chat edits retain local bytes, metadata and restore points across export and restart`, async () => {
  const storage = createMemoryStorage();
  const service = createSkinService({ storage, emit() {}, isRunCurrent: () => true, openEditor: async () => ({}) });
  const bytes = vrmFixture(version), src = GLB_DATA_PREFIX + bytes.toString('base64');
  const { skin } = await service.execute({ action: 'create', skin: { name: 'Avatar', visual: { type: 'model3d', src }, quotes: [], assets: {} } });
  let tool;
  const { default: register } = await import('../../src/capabilities/skins/tools.js');
  register({ registerTool: definition => { tool = definition; }, getToolRuntimeDependencies: () => ({ skins: service }) });
  const call = args => tool.execute(args, new AbortController().signal, { sessionId: 's', runId: 'r' });
  const got = await call({ action: 'get', id: skin.id });
  assert.equal(got.modelInfo.format, 'vrm');
  assert.equal(got.modelInfo.vrm.version, version);
  assert.equal(got.modelInfo.vrm.humanBones.head, 'head');
  assert.deepEqual(got.modelInfo.vrm.expressions, ['happy']);
  assert.equal(got.modelInfo.vrm.springBones, true);
  assert.equal(got.skin.visual.src, undefined);
  assert.ok(JSON.stringify(got).length < 10000);
  const source = 'vrm.humanoid.getRawBoneNode("head").scale.setScalar(1.2); vrm.expressionManager.setValue("happy", .6); return {root:model};';
  await call({ action: 'update', id: skin.id, revision: 1, patch: JSON.stringify({ visual: { type: 'model3d', source } }) });
  await call({ action: 'apply', id: skin.id, revision: 2 });
  const restarted = createSkinRepository(storage);
  assert.equal((await restarted.snapshot()).active.visual.source, source);
  await call({ action: 'update', id: skin.id, revision: 2, patch: JSON.stringify({ visual: { type: 'model3d', source: 'throw new Error("draft");' } }) });
  await call({ action: 'revert', id: skin.id, revision: 3 });
  const portable = exportSkinPackage(await restarted.get(skin.id));
  const imported = await restarted.mutate({ action: 'import', package: JSON.parse(JSON.stringify(portable)) });
  assert.equal(imported.skin.visual.source, source);
  assert.deepEqual(Buffer.from(glbDataBytes(imported.skin.visual.src)), bytes);
});

test('VRM validation rejects malformed metadata and external textures before a write', async () => {
  const storage = createMemoryStorage(), repository = createSkinRepository(storage);
  for (const modify of [
    data => { data.extensions.VRMC_vrm.specVersion = '9.0'; },
    data => { data.extensions.VRMC_vrm.humanoid.humanBones.head.node = 9999; },
    data => { data.images = [{ uri: 'https://example.invalid/texture.png' }]; },
  ]) {
    const src = GLB_DATA_PREFIX + vrmFixture('1', modify).toString('base64');
    await assert.rejects(repository.mutate({ action: 'create', skin: { name: 'Broken', visual: { type: 'model3d', src }, quotes: [], assets: {} } }));
  }
  assert.equal(storage.writes.length, 0);
});

test('multi-character scenes merge by id, omit all model bytes from chat and restore the whole cast', async () => {
  const storage = createMemoryStorage();
  const service = createSkinService({ storage, emit() {}, isRunCurrent: () => true, openEditor: async () => ({}) });
  const src = GLB_DATA_PREFIX + vrmFixture().toString('base64');
  const { skin } = await service.execute({ action:'create', skin:{name:'Two characters', visual:{type:'scene3d', source:'return {root:model};',
    models:{fish:{name:'Whale',src},claude:{name:'Claude',src,position:[1.5,0,0]}}}, quotes:[],assets:{}} });
  let tool;
  const { default: register } = await import('../../src/capabilities/skins/tools.js');
  register({registerTool:definition=>{tool=definition;},getToolRuntimeDependencies:()=>({skins:service})});
  const call = args=>tool.execute(args,new AbortController().signal,{sessionId:'s',runId:'r'});
  const got=await call({action:'get',id:skin.id});
  assert.equal(got.skin.visual.models.fish.src,undefined);assert.equal(got.skin.visual.models.claude.src,undefined);
  assert.equal(got.modelInfo.fish.vrm.humanBones.head,'head');assert.equal(got.modelInfo.claude.name,'Claude');
  assert.ok(JSON.stringify(got).length<10000);
  const source='characters.fish.vrm.humanoid.getRawBoneNode("leftUpperArm").rotation.z = -.7; return {root:model};';
  await call({action:'update',id:skin.id,revision:1,patch:JSON.stringify({visual:{type:'scene3d',source,models:{claude:{position:[0,.5,.7],scale:.6}}}})});
  await call({action:'apply',id:skin.id,revision:2});
  const repository=createSkinRepository(storage),saved=(await repository.snapshot()).active;
  assert.equal(saved.visual.models.fish.src,src);assert.equal(saved.visual.models.claude.src,src);
  assert.equal(saved.visual.models.fish.scale,1);assert.equal(saved.visual.models.claude.scale,.6);
  await call({action:'update',id:skin.id,revision:2,patch:JSON.stringify({visual:{type:'scene3d',models:{fish:null}}})});
  assert.deepEqual(Object.keys((await repository.get(skin.id)).visual.models),['claude']);
  await call({action:'revert',id:skin.id,revision:3});
  const restored=await repository.get(skin.id);assert.deepEqual(restored,{...saved,revision:4});
  const imported=await repository.mutate({action:'import',package:exportSkinPackage(restored)});
  assert.deepEqual(imported.skin.visual,restored.visual);
  const writes=storage.writes.length;
  await assert.rejects(repository.mutate({action:'update',id:skin.id,revision:4,patch:{visual:{type:'scene3d',models:{fish:{scale:Infinity}}}}}));
  await assert.rejects(repository.mutate({action:'update',id:skin.id,revision:4,patch:{visual:{type:'scene3d',models:{fish:null,claude:null}}}}));
  await assert.rejects(repository.mutate({action:'update',id:skin.id,revision:4,patch:{visual:{type:'scene3d',models:{a:{name:'a',src},b:{name:'b',src},c:{name:'c',src}}}}}));
  assert.equal(storage.writes.length,writes);
  // Character IDs remain data, including names inherited by normal JavaScript objects.
  const models = Object.fromEntries([['__proto__', {name:'Extra',src}], ['constructor', {name:'Other',src}]]);
  await repository.mutate({action:'update',id:skin.id,revision:4,patch:{visual:{type:'scene3d',models}}});
  const unusual=(await repository.get(skin.id)).visual.models;
  assert.equal(Object.hasOwn(unusual,'__proto__'),true);assert.equal(unusual.__proto__.src,src);
  assert.equal(unusual.constructor.name,'Other');
});

test('Side Panel and editor transports preserve the sender and share skin command results', async () => {
  const { createBackgroundApi } = await import('../../src/background/background-api.js');
  const { createSidepanelTransport } = await import('../../src/background/transports/sidepanel.js');
  const { createRuntimeMessageTransport } = await import('../../src/background/transports/runtime-message.js');
  const service = createSkinService({ storage: createMemoryStorage(), emit() {}, isRunCurrent: () => true, openEditor: async () => ({}) });
  const api = createBackgroundApi({ system: { ready: async () => {} }, skins: { command(input, sender) { assertSkinSender(sender, 'qz'); return service.execute(input); } } });
  const command = { action: 'get', id: 'qingzhou' }, replies = [];
  await createSidepanelTransport(api).dispatch({ type: 'skin_command', command, requestId: 'r' }, {
    sender: { id: 'qz', url: 'chrome-extension://qz/sidepanel/sidepanel.html' }, postMessage: message => replies.push(message),
  });
  const runtime = createRuntimeMessageTransport(api);
  const result = await new Promise(resolve => runtime.listener({ type: 'skin_command', command }, { id: 'qz', url: 'chrome-extension://qz/dom/skins/editor.html' }, resolve));
  assert.equal(replies[0].requestId, 'r'); assert.deepEqual(replies[0].result, result.result);
  const rejected = await new Promise(resolve => runtime.listener({ type: 'skin_command', command }, { id: 'qz', url: 'https://example.com/' }, resolve));
  assert.equal(rejected.ok, false); assert.equal(rejected.code, 'SKIN_FORBIDDEN');
});

test('entering the studio uses the current draft without a skin picker and isolates other chats/windows', async () => {
  const { selectSkinEditor } = await import('../../src/background/skins/editor-tabs.js');
  const tab = (skin, session = '', windowId = 7) => ({id:1, windowId, active:true, url:`chrome-extension://qz/dom/skins/editor.html?skin=${skin}&session=${session}`});
  assert.deepEqual(selectSkinEditor([tab('dafeiyu')], 'qz', 's', 7), {skinId:'dafeiyu'});
  assert.equal(selectSkinEditor([tab('dafeiyu','other')], 'qz', 's', 7), null);
  assert.equal(selectSkinEditor([tab('dafeiyu','',8)], 'qz', 's', 7), null);
  assert.equal(selectSkinEditor([tab('dafeiyu'), tab('qingzhou')], 'qz', 's', 7), null);
  const opens = [];
  const service = createSkinService({storage:createMemoryStorage(),emit(){},isRunCurrent:()=>true,
    extensionId:'qz', getEditorTabs:async()=>[tab('dafeiyu')], getCurrentWindowId:async()=>7,
    openEditor:async(...args)=>{ opens.push(args.slice(0,3)); return {id:1}; }});
  const context = {sessionId:'s',runId:'r',sourceWindowId:7};
  const result = await service.execute({action:'get'},context);
  assert.equal(result.skin.id,'dafeiyu');
  assert.deepEqual(opens,[['dafeiyu','s',7]]);
  await service.execute({action:'get',id:'qingzhou'});
  assert.equal(opens.length,1,'inspector reads do not reopen tabs');
  await service.execute({action:'open',sessionId:'s'});
  assert.deepEqual(opens[1],['dafeiyu','s',7]);
});

test('studio tab reuse preserves the renderer, serializes opens and rejects cancelled work', async () => {
  const { createSkinEditorTabs } = await import('../../src/background/skins/editor-tabs.js');
  const stored = []; const updates = [];
  const tabs = {
    query:async query=>stored.filter(tab=>query.windowId === undefined || query.windowId === tab.windowId),
    create:async value=>{const tab={...value,pendingUrl:value.url,url:'about:blank',active:true,id:stored.length+1};stored.push(tab);return tab;},
    update:async(id,patch)=>{updates.push(patch);const tab=stored.find(tab=>tab.id===id);Object.assign(tab,patch);if(patch.url)delete tab.pendingUrl;return tab;},
  };
  const editor=createSkinEditorTabs(tabs,'qz');
  const [first,second]=await Promise.all([editor.open('dafeiyu','s',7),editor.open('dafeiyu','s',7)]);
  assert.equal(first.id,second.id);assert.equal(stored.length,1);
  assert.deepEqual(updates,[{active:true}],'repeat opens never navigate or reload the model');
  await editor.open('dafeiyu','other',7);assert.equal(stored.length,2);
  await editor.open('dafeiyu','s',8);assert.equal(stored.length,3);
  await editor.open('qingzhou','',7);const unbound=stored.at(-1);
  const adopted=await editor.open('qingzhou','s',7);
  assert.equal(adopted.id,unbound.id);assert.equal(stored.length,4);
  assert.equal(new URL(unbound.url).searchParams.get('session'),'s');
  const aborted=new AbortController();aborted.abort();
  await assert.rejects(editor.open('new','s',7,()=>aborted.signal.throwIfAborted()),{name:'AbortError'});
  assert.equal(stored.length,4);
  await editor.open('new','s',7);assert.equal(stored.length,5,'failed queue entry must not block future opens');
});
