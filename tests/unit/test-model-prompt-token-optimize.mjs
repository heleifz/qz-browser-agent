import assert from 'node:assert/strict';
import test from 'node:test';
import { getAgentPrompts } from '../../src/background/agent/prompts.js';
import { withLanguage } from '../../src/shared/i18n/index.js';
import { localizeToolFailurePayload } from '../../src/shared/tools/tool-error-localization.js';

globalThis.chrome = {};
const { resolveToolDefinition } = await import('../../src/background/tools/runtime.js');

for (const language of ['en', 'zh-CN']) test(`unified observation/action vocabulary in ${language}`, () => {
  const prompt = getAgentPrompts(language).SYSTEM_PROMPT;
  assert.doesNotMatch(prompt, /depth\/limit|Global ↑|Local folds|全局 ↑|局部折叠/);
  const tool = name => resolveToolDefinition(name, { language });
  const ax = tool('get_ax_tree'), flow = tool('run_flow');
  assert.deepEqual(ax.parameters.properties.scope.enum, ['viewport', 'full']);
  assert.deepEqual(flow.parameters.properties.observationScope.enum, ['viewport', 'full']);
  for (const text of [prompt, ax.description, flow.description]) {
    assert.match(text, /get_ax_tree|snapshot|快照/);
    assert.doesNotMatch(text, /full_page|viewportTruncated|2000 geometry|2,000 geometry|验证后批量|单步试通|verify.then.batch|first.*representative action/i);
  }
  for (const token of ['viewport', 'scope:"full"', 'root', 'next_turn_start', 'observationScope', 'tools.$watch', 'tools.$settle', 'already_complete', 'wait_for_user', 'ask_user']) {
    assert.ok(prompt.includes(token), `${language}: missing ${token}`);
  }
  assert.match(flow.parameters.properties.observationScope.description, /120[\s\S]*16[\s\S]*40[\s\S]*16000/);
  assert.match(tool('act_on_element').description, /run_flow[\s\S]*pageAfter\/urlChanged\/titleChanged/);
  assert.match(tool('wait_for_navigation').description, /next:true[\s\S]*tools\.\$watch/);
  assert.match(tool('wait_for_element').parameters.properties.selector.description, /CSS/);
  const descriptions = ['get_ax_tree', 'run_flow', 'run_script', 'act_on_element', 'inspect_element',
    'read_article', 'read_dom', 'find_elements', 'upload_files', 'screenshot', 'act_on_screen',
    'open_tab', 'navigate', 'wait_for_navigation', 'wait_for_element'].map(name => tool(name).description);
  assert.doesNotMatch(descriptions.join('\n'), /不要|切勿|务必|而不是|不需要|do not|don't|rather than|no need|must first/i);
  const stale = withLanguage(language, () => localizeToolFailurePayload({ code: 'STALE_ELEMENT_UID', error: 'stale' }));
  assert.match(stale.error, /get_ax_tree/);
  assert.match(stale.error, language === 'en' ? /aliases/ : /别名/);
  const lifecycle = withLanguage(language, () => localizeToolFailurePayload({ code: 'RUN_SCRIPT_SELF_UNLOADING_TOOL_BLOCKED', error: 'unload' }));
  assert.match(lifecycle.error, /run_flow/);
});
