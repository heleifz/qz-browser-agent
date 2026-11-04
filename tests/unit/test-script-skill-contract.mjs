import assert from 'node:assert/strict';
import test from 'node:test';
import { scriptExecutionFixture } from '../support/script-execution-fixture.mjs';
import { getActiveSkillToolSchemasSync } from '../../src/background/skills/skill-tool-runtime.js';
import { getToolResultTraces, presentToolResult, traceMessages } from '../../src/shared/contracts/tool-result-presentation.js';
import { isToolValue } from '../../src/shared/contracts/tool-error.js';
import { planTabBatch } from '../../src/background/tools/tab-batch.js';
import { skillResultData } from '../../src/sidepanel/tools/primitives/skill-result-data.js';
import { createToolRuntimeDetails } from '../../src/sidepanel/tools/tool-runtime-details.js';
import { buildScriptRequest, presentScriptResult } from '../../services/mcp-bridge/src/script-call.mjs';

const skill = (code, runtime = 'script') => ({ format: 'qingzhou.skill', schemaVersion: 2, name: 'script-contract', scope: 'resident', content: 'Contract fixture', resources: [
  { path: 'plugin.json', type: 'json', content: JSON.stringify({ format: 'qingzhou.plugin', schemaVersion: 1, id: 'script-contract', name: 'Script contract', settings: { fields: [{ key: 'token', type: 'secret', label: 'Token' }] }, tools: [
    { name: 'run', description: 'Run fixture', runtime, script: 'run.js', behavior: { orchestration: true },
      parameters: { type: 'object', properties: { tabRef: { type: 'string' }, tabAlias: { type: 'string' }, target: { type: 'string' }, value: {} } } },
  ] }) },
  { path: 'run.js', type: 'script', content: code },
] });
const name = () => getActiveSkillToolSchemasSync()[0].function.name;

test('CLI, inline script and new Skill return the same business values and errors', async () => {
  for (const value of [null, false, 42, 'text', '{"json":"string"}', [1, { ok: false }], { ok: true, result: { nested: true } },
    { ok: false, error: 'data', code: 'BUSINESS', message: 'authored', _display: { script: { trace: ['authored'] } } }]) {
    const code = 'trace("contract"); return args.value;';
    const f = await scriptExecutionFixture([skill(code)]);
    const presentation = {};
    const result = await f.execute(name(), { value }, { resultPresentation: presentation });
    const inline = await f.execute('run_script', { code, args: { value } });
    assert.deepEqual(result, value);
    assert.deepEqual(inline, value);
    assert.deepEqual(getToolResultTraces(result, presentation), ['Script started.', 'contract']);
    assert.equal(presentation._plugin.id, 'script-contract', 'scalar/array results keep sidebar presentation separately');
    assert.deepEqual(presentToolResult(result, presentation).result, value);
    const stored = JSON.parse(JSON.stringify(presentToolResult(result, presentation)));
    const view = createToolRuntimeDetails({ genericRenderer: {} }).project({ name: name(), result: stored, hasResult: true, isError: false });
    assert.equal(view.state, 'completed');
    assert.deepEqual(view.result, value, 'sidebar projection unwraps exactly one host envelope');
    assert.deepEqual(skillResultData(view.result, view.originalResult), value, 'renderer paths stay relative to authored business data after reload');
    if (value && typeof value === 'object') assert.ok(isToolValue(result), 'business error keys cannot become execution failures');
    const request = buildScriptRequest({ sessionId: 's', code, args: { value } });
    assert.equal(request.args.timeout, 120);
    const cli = presentScriptResult({ isError: false, result, traces: getToolResultTraces(result, presentation) });
    assert.equal(cli.exitCode, 0);
    assert.deepEqual(JSON.parse(cli.text).result, value);
  }
  for (const code of ['throw new Error("boom");', 'return new Map([["key", 1]]);', 'const a = {}; a.self = a; return a;']) {
    const f = await scriptExecutionFixture([skill(code)]);
    const actual = await f.execute(name(), {});
    const expected = await f.execute('run_script', { code });
    assert.equal(actual.code, expected.code);
    assert.equal(actual.message, expected.message);
    assert.equal(actual.hint, expected.hint);
    assert.equal(isToolValue(actual), false);
    assert.ok(actual.code);
    assert.ok(Object.keys(actual).every(key => ['code', 'message', 'hint', 'details'].includes(key)));
  }
});

test('a script Skill owns its argument schema; page-looking fields stay data until a child uses them', async () => {
  const f = await scriptExecutionFixture([skill('return {tabRef:args.tabRef, tabAlias:args.tabAlias, target:args.target};')]);
  const args = { tabRef: 'not-created-yet', tabAlias: 'business value', target: 'uid:not-a-page-element' };
  assert.deepEqual(await f.execute(name(), args), args);
  const definition = f.runtime.resolveDefinition(name());
  assert.equal(definition.model.preserveResult, true);
  assert.equal(definition.timeout({}, name()), 120_000);
  assert.equal(definition.timeout({ timeout: 0 }, name()), 0);
  assert.ok(!definition.parameters.required.includes('timeout'));
  assert.deepEqual(f.runtime.getBatchTabPolicy(name(), args), { kind: 'script' });
  const batch = [1, 2].map(id => ({ id, args }));
  const plan = planTabBatch(batch, item => ({ args: item.args, policy: f.runtime.getBatchTabPolicy(name(), item.args) }));
  assert.ok(batch.every(item => plan.independent(item) && plan.args(item) === args));
  assert.notEqual(plan.lane(batch[0]), plan.lane(batch[1]));
  assert.deepEqual(plan.dependencies(batch[1]), { execution: [], commit: [] });
  assert.equal(f.messages[0].strictResult, true);
  assert.equal(f.messages[0].fetchBridge, true);
  assert.equal(f.settings[0].includeSecrets, true);
  assert.equal(f.networks[0].config.token, 'fixture-secret');
});

test('old inner Skill keeps its required timeout, result envelope and permissive serialization', async () => {
  const f = await scriptExecutionFixture([skill('return new Map([["key", 1]]);', 'inner')]);
  assert.ok(f.runtime.resolveDefinition(name()).parameters.required.includes('timeout'));
  assert.notEqual(f.runtime.getBatchTabPolicy(name(), {})?.kind, 'script', 'manifest behavior cannot grant orchestration');
  await assert.rejects(f.execute(name(), {}), { code: 'MISSING_REQUIRED_ARGUMENTS' });
  const result = await f.execute(name(), { timeout: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.result.__qz_type, 'Map');
  assert.notEqual(f.messages[0].strictResult, true);
});

test('concurrent tool traces keep sequence, public alias and host identity through CLI presentation', async () => {
  let release;
  const slow = new Promise(resolve => { release = resolve; });
  const f = await scriptExecutionFixture([], async call => {
    if (call.args.tabRef === 'slow') await slow;
    else release();
    return call.args.tabRef;
  });
  const presentation = {};
  const value = await f.execute('run_script', { code: `return await Promise.all(['slow','fast'].map(tabRef => tools.evaluate({tabRef, code:() => 1})));` },
    { resultPresentation: presentation });
  assert.deepEqual(value, ['slow', 'fast']);
  const rows = presentation._display.script.trace.filter(row => row.sequence);
  for (const [sequence, alias] of [[1, 'slow'], [2, 'fast']]) {
    const pair = rows.filter(row => row.sequence === sequence);
    assert.deepEqual(pair.map(row => row.level), ['tool.start', 'tool.end']);
    assert.ok(pair.every(row => row.tabRef === alias && row.toolCallId.startsWith('host-')));
    assert.equal(pair[0].toolCallId, pair[1].toolCallId);
  }
  const traces = getToolResultTraces(value, presentation);
  assert.ok(traces.some(line => line.includes('#1 tabRef="slow" call=host-')));
  assert.deepEqual(traceMessages([{ level: 'tool.error', message: 'evaluate boom' }, 'old trace']), ['evaluate failed: boom', 'old trace']);
});
