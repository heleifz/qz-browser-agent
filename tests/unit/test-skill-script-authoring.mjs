import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { compileInnerWorker } from '../../scripts/build-extension.mjs';
import { runInnerWorker } from '../support/inner-runner-fixture.mjs';
import { findBuiltinSkill } from '../../src/shared/skills/builtin-skills.js';
import { wrapRunScriptSource } from '../../src/shared/run-script-source.js';
import {
  commitSkillToolRegistryCandidate, prepareSkillToolRegistryFromSkills,
  executeSkillTool, getActiveSkillToolSchemasSync,
} from '../../src/background/skills/skill-tool-runtime.js';

const compiled = await compileInnerWorker({ mode: 'production' });
const blocks = (content, language) => [...content.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```', 'g'))].map(match => match[1]);

for (const language of ['en', 'zh-CN']) test(`${language} authored Skill examples run outside pages with explicit page arguments`, async () => {
  const workbench = findBuiltinSkill('skill-workbench', language).content;
  const site = findBuiltinSkill('site-skill-author', language).content;
  for (const content of [workbench, site]) {
    assert.doesNotMatch(content, /runtime:\s*"(?:page|inner)"|"needsPage":\s*true/);
    for (const manifest of blocks(content, 'json').map(JSON.parse)) {
      for (const tool of manifest.tools || []) if (tool.script) assert.equal(tool.runtime, 'script');
    }
  }
  const workbenchManifest = blocks(workbench, 'json').map(JSON.parse).find(value => value.id === 'page-inspector');
  const siteManifest = blocks(site, 'json').map(JSON.parse).find(value => value.id === 'example-site-tools');
  const scripts = [blocks(workbench, 'js')[0], ...blocks(site, 'js')];
  assert.equal(scripts.length, 3);
  for (const [index, script] of scripts.entries()) {
    const manifest = structuredClone(index === 0 ? workbenchManifest : siteManifest);
    const tool = manifest.tools[0];
    const skill = { format: 'qingzhou.skill', schemaVersion: 2, name: 'authored-example', scope: 'resident', resources: [
      { path: 'plugin.json', type: 'json', content: JSON.stringify(manifest) },
      { path: tool.script, type: 'script', content: script },
    ] };
    const before = JSON.stringify(skill);
    const candidate = prepareSkillToolRegistryFromSkills([skill]);
    assert.deepEqual(candidate.diagnostics, []);
    assert.equal(JSON.stringify(skill), before, 'registration never rewrites the authored package');
    commitSkillToolRegistryCandidate(candidate);
    const schema = getActiveSkillToolSchemasSync({ language })[0].function;
    assert.deepEqual(schema.parameters.required, ['timeout', 'tabRef']);
    const calls = [];
    const dispatch = async (name, payload, _signal, context) => {
      assert.equal(name, 'run_skill_script');
      assert.equal(payload.target, 'inner');
      assert.equal(payload.tabId, undefined);
      assert.equal(context.skillExecution.plugin.id, manifest.id);
      const execution = await runInnerWorker(compiled, wrapRunScriptSource(script), {
        scriptArgs: payload.args, fetchBridge: true,
        async onMessage(message, respond) {
          assert.equal(message.type, 'tool_call', 'no DOM or authenticated fetch runs in the outer worker');
          assert.equal(message.toolName, 'evaluate');
          assert.equal(message.args.tabRef, 'research');
          calls.push(message);
          const page = {
            document: { title: 'Example', cookie: 'session=test', scripts: [], body: { innerText: 'Example text' },
              querySelectorAll: () => [{ innerText: ' Link ', href: 'https://example.com/link' }] },
            location: { href: 'https://example.com/research' }, window: {}, URL,
            async fetch(url, options) {
              assert.equal(url, 'https://example.com/api/hot');
              assert.equal(options.credentials, 'include');
              return { ok: true, status: 200, json: async () => ({ data: { items: [
                { title: 'One', author: 'Author', url: '/one' }, { title: 'Two', url: '/two' },
              ] } }) };
            },
          };
          // A fresh page realm catches accidental closures over outer args, tools or local variables.
          const result = await runInNewContext(`(${message.args.code})`, page)(message.args.args);
          respond({ type: 'tool_response', callId: message.callId, response: { ok: true, result: JSON.parse(JSON.stringify(result)) } });
        },
      });
      assert.equal(execution.result.ok, true, execution.result.error);
      return execution.result.result;
    };
    const execute = limit => executeSkillTool(schema.name, { timeout: 10, tabRef: 'research', limit }, null,
      { sessionId: 'authoring-test' }, dispatch, { skillSettings: { getExecutionConfig: async () => ({}) } });
    const result = await execute(1);
    assert.equal(calls.length, 1);
    if (index === 0) assert.deepEqual(result, { title: 'Example', url: 'https://example.com/research',
      linkCount: 1, textLength: 12, links: [{ text: 'Link', href: 'https://example.com/link' }] });
    else if (index === 1) assert.deepEqual(result.cookies, ['session']);
    else {
      assert.equal(result.count, 1);
      assert.equal(result.rows[0].url, 'https://example.com/one');
      assert.equal((await execute(51)).code, 'ARGUMENT');
      assert.equal(calls.length, 1, 'invalid arguments never enter the page');
    }
  }
});
