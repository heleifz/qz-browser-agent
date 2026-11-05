import { test, expect } from './fixtures.mjs';
import { exerciseOuterScripts } from '../support/outer-script-acceptance.mjs';

for (const mode of ['navigation', 'interleavings', 'skills']) test(mode === 'skills' ? 'installed script Skills return business values and preserve legacy callers, traces and live/static cards' : mode === 'interleavings' ? 'outer script interleaved branches preserve lanes across navigation and caught errors'
  : 'outer script coordinates actual navigation, AJAX, queues and popup cancellation', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const { launchIsolatedExtensionMcp } = await import('../support/isolated-extension-mcp.mjs');
  const environment = await launchIsolatedExtensionMcp({ profilePrefix: 'qz-outer-script-', requestTimeoutSeconds: 90 });
  try {
    await exerciseOuterScripts({ endpoint: environment.bridge.endpoint, page: environment.page,
      context: environment.context, expect, step: test.step, testInfo, interleavings: mode === 'interleavings', skillScripts: mode === 'skills' });
  } finally { await environment.close(); }
});
