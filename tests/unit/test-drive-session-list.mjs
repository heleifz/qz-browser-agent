import assert from 'node:assert/strict';
import test from 'node:test';
import { createMcpRuntime } from '../../src/background/mcp/mcp-runtime.js';
import { createSessionRepository } from '../../src/background/session/repository.js';
import { createSessionSupervisor } from '../../src/background/session/supervisor.js';
import { createSessionState } from '../../src/sidepanel/features/sessions/session-state.js';
import { createSessionListSummaryFromAgentEvent } from '../../src/shared/session/session-list-summary.js';
import { createMemoryStorage } from '../support/memory-storage.mjs';

test('one drive session retains one task entry across exec, batches, scripts and nested calls; N creates retain N entries', async () => {
  const repository = createSessionRepository({ storage: createMemoryStorage() });
  const supervisor = createSessionSupervisor({ createAgent() { throw new Error('direct drive must not start an agent'); } });
  const state = createSessionState();
  const creates = [], lastEvent = new Map();
  let runtime;
  runtime = createMcpRuntime({
    sessions: {
      supervisor,
      listMetadata: repository.listMetadata,
      async createMetadata(input) {
        creates.push(input.id);
        const record = await repository.createMetadata(input);
        state.mergeRecord(record);
        return record;
      },
      getRuntime: id => supervisor.getRuntime(id) || {},
      setRuntime: (id, patch) => supervisor.setRuntime(id, { ...supervisor.getRuntime(id), ...patch }),
      recordToolEvent(event) { lastEvent.set(event.sessionId, event); state.applyEvent(event); },
      async persistTranscript(id) {
        const summary = createSessionListSummaryFromAgentEvent(lastEvent.get(id));
        const updated = await repository.updateMetadata(id, record => ({ ...record, listSummary: summary }));
        state.mergeRecord(updated.session);
      },
    },
    tools: {
      canManageSessions: async () => false, buildRunProfile: async () => ({}),
      loadedSkillNames: () => [], recordLoadedSkillNames() {},
      runtime: {
        getSchemas: () => [], getTabAliases: () => ({ page: 1 }),
        getBatchTabPolicy: () => ({ kind: 'target', implicit: false }),
        async execute(name, args, _signal, context) {
          if (name === 'run_script') {
            for (let i = 0; i < 2; i++) await runtime.recordNestedTool({
              sessionId: context.sessionId, runId: context.runId, name: 'read_article',
              args: { tabRef: 'page' }, result: { text: 'Nested article' }, isError: false,
            });
            return { ok: true, result: 2 };
          }
          return { text: 'Public article', title: 'Same article' };
        },
      },
    },
    skills: {}, artifacts: {}, trace: {}, userInputPermissions: {}, async dispatchSidepanel() {},
  });
  const { sessionId } = await runtime.createDriveSession({ title: "Inspect example page", clientName: 'qz-cli' });
  const before = await repository.getMetadata(sessionId);
  const read = id => runtime.executeTool({ sessionId: id, name: 'read_article', args: { tabRef: 'page', limit: 100 } });
  for (let i = 0; i < 10; i++) {
    await read(sessionId);
    await runtime.executeTool({ sessionId, calls: [
      { id: 'read', name: 'read_article', args: { tabRef: 'page' } },
      { id: 'read', name: 'read_article', args: { tabRef: 'page' } },
    ] });
    await runtime.executeTool({ sessionId, name: 'run_script', args: { tabRef: 'page', timeout: 1, code: 'async () => 2' } });
    assert.deepEqual(Object.keys(await repository.listMetadata()), [sessionId]);
    assert.equal(state.list().length, 1, 'summary and tool events update the same task entry');
    assert.equal(state.getRecord(sessionId).createdAt, before.createdAt);
  }
  assert.deepEqual(creates, [sessionId]);
  assert.equal(state.getTranscript(sessionId).length, 60);
  for (const input of [{ name: 'read_article', args: { tabRef: 'page' } }, { sessionId: 'unknown', name: 'read_article', args: { tabRef: 'page' } }]) {
    await assert.rejects(runtime.executeTool(input), error => ['DRIVE_SESSION_REQUIRED', 'DRIVE_SESSION_NOT_FOUND'].includes(error.code));
  }
  assert.deepEqual(creates, [sessionId], 'missing and unknown IDs must not create entries');
  const additional = await Promise.all(Array.from({ length: 9 }, () => runtime.createDriveSession({ title: "Inspect example page", clientName: 'qz-cli' })));
  const ids = [sessionId, ...additional.map(item => item.sessionId)];
  await Promise.all(ids.map(read));
  const records = await repository.listMetadata();
  assert.equal(creates.length, 10);
  assert.equal(Object.keys(records).length, 10);
  assert.equal(new Set(Object.values(records).map(record => record.id)).size, 10);
  assert.equal(new Set(Object.values(records).map(record => record.title)).size, 1, 'identical CLI titles must not merge distinct sessions');
  state.mergeRecords(records);
  assert.equal(state.list().length, 10);
  for (const id of ids) assert.equal(state.getRecord(id).id, id);
});
