export function flowFixture(state = 'completed') {
  const steps = [
    { id: 1, tool: 'open_tab', target: 'https://example.com/catalog', state: 'completed', elapsedMs: 218 },
    { id: 2, tool: 'act_on_element', target: 'click · css:a.next', state: 'completed', elapsedMs: 146, outcome: 'navigated' },
    { id: 3, tool: 'wait_for_element', target: '.product-card · In stock', state: 'completed', elapsedMs: 684, outcome: 'condition_met' },
    { id: 4, tool: 'read_article', target: 'css:main', state: state === 'completed' ? 'completed' : state === 'error' ? 'error' : 'running',
      ...(state === 'completed' ? { elapsedMs: 94 } : state === 'error' ? { elapsedMs: 1200, code: 'STALE_ELEMENT_UID' } : {}) },
  ];
  return {
    type: 'tool', name: 'run_flow', toolCallId: 'flow-demo', runId: 'flow-run',
    rendererId: 'script.flow', profileFamily: 'script.flow',
    isRunning: state === 'running', isError: state === 'error' || state === 'aborted', phase: state === 'aborted' ? 'aborted' : state === 'running' ? 'running' : 'done',
    args: { timeout: 60, code: '// 浏览目录，翻页并核对库存\nasync () => {\n  const tab = await tools.open_tab({url: "https://example.com/catalog"});\n  await tools.act_on_element({tabId: tab.id, target: "css:a.next", action: "click"});\n  await tools.wait_for_element({tabId: tab.id, selector: ".product-card", text: "In stock"});\n  return await tools.read_article({tabId: tab.id, selector: "css:main"});\n}' },
    result: {
      ...(state === 'running' || state === 'aborted' ? {} : { ok: state !== 'error', result: state === 'error' ? null : { products: 12, available: 8 } }),
      ...(state === 'error' ? { error: '目标引用已过期，当前快照可提供新的引用。', code: 'STALE_ELEMENT_UID' } : {}),
      _display: { flow: { version: 1, total: 4, omitted: 0, steps } },
      ...(state === 'completed' ? { finalObservation: { purpose: 'next_turn_start', tabId: 8, snapshot: {
        scope: 'viewport', url: 'https://example.com/catalog?page=2', title: 'Catalog',
        snapshot: 'RootWebArea "Catalog"\n  main target=uid:t8.abc123.1 alias=@abc123.1\n    button "Next page" target=uid:t8.abc123.2 alias=@abc123.2\n↓ 18 AX nodes omitted',
      } } } : {}),
    },
  };
}
