import { test, expect } from './fixtures.mjs';
import { exerciseOuterScripts } from '../support/outer-script-acceptance.mjs';

test('outer script coordinates actual navigation, AJAX, queues and popup cancellation', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const { launchIsolatedExtensionMcp } = await import('../support/isolated-extension-mcp.mjs');
  const environment = await launchIsolatedExtensionMcp({ profilePrefix: 'qz-outer-script-', requestTimeoutSeconds: 90 });
  try {
    await exerciseOuterScripts({ endpoint: environment.bridge.endpoint, page: environment.page,
      context: environment.context, expect, step: test.step, testInfo });
  } finally { await environment.close(); }
});
