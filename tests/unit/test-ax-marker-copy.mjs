import assert from 'node:assert/strict';
import test from 'node:test';
import { withLanguage } from '../../src/shared/i18n/index.js';
import { toolT } from '../../src/capabilities/accessibility/tool-messages.js';
import { getAgentPrompts } from '../../src/background/agent/prompts.js';
import { localizeToolFailurePayload } from '../../src/shared/tools/tool-error-localization.js';

for (const language of ['zh-CN', 'en']) test(`AX markers state facts and read operations · ${language}`, () => withLanguage(language, () => {
  const target = 'uid:t8.abc123.7';
  const capability = toolT('readViewportRoot', { target });
  const markers = ['aboveViewport', 'belowViewport', 'foldedAbove', 'foldedBelow', 'unmeasuredViewport'].map(key => toolT(key, { count: 3, capability }));
  for (const marker of markers) {
    assert.match(marker, /3/);
    assert.doesNotMatch(marker, /depth|limit|仍受|限制|still|subject to|\{count\}|\{capability\}/i);
  }
  for (const marker of markers.slice(0, 4)) assert.match(marker, /scope:"full"/);
  assert.match(markers[0], /^↑/); assert.match(markers[1], /^↓/);
  assert.match(markers[2], /root="uid:t8\.abc123\.7"/);
  assert.match(markers[3], /root="uid:t8\.abc123\.7"/);
  assert.equal(markers[3], language === 'zh-CN'
    ? '↓ 此区块下方省略 3 项内容；用 root="uid:t8.abc123.7" 或 scope:"full" 读取'
    : '↓ This block omits 3 content items below; read with root="uid:t8.abc123.7" or scope:"full"');
  assert.equal(markers[4], language === 'zh-CN' ? '几何信息缺失：3 个节点。' : 'Geometry unavailable: 3 nodes.');
  assert.doesNotMatch(toolT('getAxTreeScope'), /depth|limit|仍受|still/);
  assert.match(toolT('getAxTreeDepth'), /16[\s\S]*1–40/);
  assert.match(toolT('getAxTreeLimit'), /120[\s\S]*20–300/);
  assert.match(toolT('getAxTreeDescription'), /items[\s\S]*\(truncated, N more\)/);
  assert.doesNotMatch(getAgentPrompts(language).SYSTEM_PROMPT, /depth\/limit|Global ↑|Local folds|全局 ↑|局部折叠|\(truncated, N more\)/);
  for (const code of ['STALE_ELEMENT_UID', 'STALE_ELEMENT_UID_PAGE_CHANGED', 'ELEMENT_UID_SESSION_MISMATCH', 'ELEMENT_UID_TAB_MISMATCH']) {
    const localized = localizeToolFailurePayload({ code, error: 'old diagnostic' });
    assert.equal(localized.code, code);
    assert.match(localized.error, /get_ax_tree/);
    assert.doesNotMatch(localized.error, /then retry|仍受|still|不要/);
  }
}));
