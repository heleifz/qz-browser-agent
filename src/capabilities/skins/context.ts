import type { ContextCapability } from '#sdk/background/context';
import { skinT as t } from '#sdk/shared/skin-messages';
export default ((host) => [{
  id: 'skin-studio', get title() { return t('studio'); }, maxChars: 600,
  async read({ sessionId, signal }) {
    const editor = await host.getSkinEditorContext?.(sessionId);
    if (!editor || signal?.aborted) return null;
    return JSON.stringify({ skinId: editor.skinId, tool: 'manage_skin', instruction: 'Read with get before editing; update refreshes the draft. Use manage_skin action:screenshot to see the actual rendered preview. This is an extension studio: use this tool instead of browser page screenshot, DOM or script tools.' });
  },
}]) satisfies ContextCapability;
