import type { UiExtensionAPI } from '#sdk/sidepanel';
import { createSkinViewer, readWelcomePreview, readWelcomeVisual, writeWelcomeVisual } from '#sdk/sidepanel/skins';
import { chooseSkinQuote } from '#sdk/shared/skins';
import type { SkinCommand, SkinWelcome, WelcomeSkin } from '#sdk/shared/skins';
import { skinT as t, skinErrorText } from '#sdk/shared/skin-messages';

export default function(qz: UiExtensionAPI) {
  async function request<T>(command: SkinCommand): Promise<T> {
    const response = await qz.request('skin_command', { command }, 15000);
    qz.signal.throwIfAborted();
    if (response.error || response.ok === false) throw Object.assign(new Error(String(response.error)), { code: response.code });
    return response.result as T;
  }
  const actions = qz.root.querySelector('.header-actions');
  if (actions) {
    const button = qz.root.createElement('button');
    button.id = 'skin-open-studio'; button.type = 'button';
    button.className = 'qz-icon-btn qz-icon-btn--md icon-btn';
    button.title = t('studio'); button.setAttribute('aria-label', t('studio'));
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.5-3.3 1.5 1.5 0 0 1 1.1-2.5H17a4 4 0 0 0 4-4A8.5 8.5 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="11" cy="7" r=".8"/><circle cx="15.5" cy="8.5" r=".8"/></svg>';
    actions.insertBefore(button, actions.querySelector('#btn-settings'));
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await request({ action: 'open', sessionId: qz.getCurrentSessionId() || '' }); }
      catch (error) { if (!qz.signal.aborted) qz.showToast(skinErrorText(error), { tone: 'error' }); }
      finally { if (!qz.signal.aborted) button.disabled = false; }
    }, { signal: qz.signal });
    qz.onDispose(() => button.remove());
  }
  let welcome: HTMLElement | null = null, viewer: ReturnType<typeof createSkinViewer> | undefined;
  let active: WelcomeSkin | undefined, signature = '', quote = '', generation = 0, defaultQuote = '', failed = false;
  let recovering = false;
  function mount() {
    const next = qz.chat.messages.querySelector<HTMLElement>('#welcome');
    if (next !== welcome) {
      viewer?.dispose(); viewer = undefined; welcome = next; signature = '';
      defaultQuote = welcome?.querySelector('.welcome-subtitle')?.textContent || '';
      if (active) quote = chooseSkinQuote(active.quotes, quote);
    }
    if (!welcome) return;
    const brand = welcome.querySelector<HTMLElement>('.welcome-brand');
    const icon = brand?.querySelector<HTMLElement>('.welcome-icon');
    if (!brand || !icon) return;
    if (!viewer) {
      const cached = readWelcomePreview();
      if (cached) {
        icon.classList.add('qz-skin-viewer'); icon.dataset.skinVisual = cached.type;
        const subtitle = welcome.querySelector<HTMLElement>('.welcome-subtitle');
        if (subtitle) { subtitle.removeAttribute('data-i18n'); subtitle.textContent = quote = cached.quote; }
      }
      viewer = createSkinViewer(icon, { welcomePreview: cached, rememberView: true, onStatus(ready, error) {
      failed = Boolean(error);
      icon.classList.toggle('skin-preview-failed', Boolean(error));
      icon.classList.toggle('skin-preview-ready', ready);
      if (error) icon.title = t('fallback'); else icon.removeAttribute('title');
      if (error && !recovering) { recovering = true; signature = ''; void writeWelcomeVisual(); void refresh(true); }
      } });
    }
    const skinChanged = active && signature !== `${active.id}:${active.revision}`;
    if (active && skinChanged) {
      signature = `${active.id}:${active.revision}`;
      icon.classList.add('qz-skin-viewer'); icon.dataset.skinVisual = active.visual.type;
      viewer.setSkin(active);
    }
    if (active) {
      const subtitle = welcome.querySelector<HTMLElement>('.welcome-subtitle');
      if (subtitle) {
        if (active.id === 'qingzhou' && active.revision === 1) {
          subtitle.setAttribute('data-i18n', 'core.tagline');
          if (skinChanged) subtitle.textContent = defaultQuote;
          else defaultQuote = subtitle.textContent || defaultQuote;
        } else {
          subtitle.removeAttribute('data-i18n');
          if (!active.quotes.includes(quote)) quote = chooseSkinQuote(active.quotes, quote);
          subtitle.textContent = quote;
        }
      }
    }
    viewer.setVisible(qz.chat.messages.dataset.chatState === 'landing');
  }
  async function refresh(force = false) {
    const epoch = ++generation;
    try {
      // Reopening usually validates a small revision reply; model bytes stay in the local render cache.
      const cached = force ? undefined : active || await readWelcomeVisual();
      if (qz.signal.aborted || epoch !== generation) return;
      let snapshot = await request<SkinWelcome>({ action: 'welcome', id: cached?.id, revision: cached?.revision });
      if (!snapshot.active && (!cached || cached.id !== snapshot.activeId || cached.revision !== snapshot.revision)) {
        snapshot = await request<SkinWelcome>({ action: 'welcome' });
      }
      if (qz.signal.aborted || epoch !== generation) return;
      active = snapshot.active || cached;
      if (!active) return;
      mount();
      if (snapshot.active) void writeWelcomeVisual(active);
    } catch { /* Keep the packaged 2D welcome available when storage or Background is unavailable. */ }
  }
  const observer = new MutationObserver(mount);
  observer.observe(qz.chat.messages, { childList: true, attributes: true, attributeFilter: ['data-chat-state'] });
  for (const event of ['ui_chat_branding', 'ui_workspace_started']) qz.on(event, mount);
  qz.on('ui_chat_reset', () => {
    if (active) quote = chooseSkinQuote(active.quotes, quote);
    if (failed) signature = ''; // Retry a failed or lost WebGL context instead of retaining it.
    mount(); viewer?.reset();
  });
  qz.on('skins_changed', () => void refresh());
  qz.onDispose(() => {
    generation++; observer.disconnect(); viewer?.dispose();
    const icon = welcome?.querySelector<HTMLElement>('.welcome-icon');
    icon?.classList.remove('qz-skin-viewer', 'skin-preview-failed', 'skin-preview-ready');
    if (icon) { delete icon.dataset.skinVisual; delete icon.dataset.visual; icon.removeAttribute('tabindex'); }
  });
  mount(); void refresh();
}
