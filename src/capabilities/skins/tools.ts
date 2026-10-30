import modelText from './model-messages.js';
import type { ToolExtensionAPI } from '#sdk/background';
import { skinT as t, skinErrorText } from '#sdk/shared/skin-messages';
import { glbDataBytes, inspectGlb } from '#sdk/shared/skins';
import type { SkinSnapshot, WelcomeSkin } from '#sdk/shared/skins';
import { ImageLimitError } from '#sdk/shared/images';
import { resolveSkinImages } from './image-input.js';
export default function(qz: ToolExtensionAPI) {
  qz.registerTool({
    name: 'manage_skin',
    get title() { return t('tool'); },
    get description() { return `${modelText('toolDescription')}\n\n${modelText('imageInstructions')}`; },
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['list', 'get', 'open', 'create', 'update', 'apply', 'revert', 'screenshot'], description: 'Operation. screenshot returns the current studio preview as an image.' },
      id: { type: 'string', description: 'Skin id from list/get.' },
      revision: { type: 'integer', description: 'Current revision from get, required for writes.' },
      patch: { type: 'string', description: 'JSON object with name, visual, quotes and/or assets; required for update. image2d src/darkSrc accept raster data URLs, direct HTTP(S) image URLs, or asset:image: IDs from collect_images.' },
      skin: { type: 'string', description: 'For create: JSON object with name, visual, quotes and assets. image2d src/darkSrc accept raster data URLs, direct HTTP(S) image URLs, or asset:image: IDs from collect_images.' },
    }, required: ['action'] } as const,
    execute: async (args, signal, context) => {
      try {
        const service = qz.getToolRuntimeDependencies(context).skins;
        if (!service) throw Object.assign(new Error('SKIN_FORBIDDEN'), { code: 'SKIN_FORBIDDEN' });
        // Editing starts beside the live preview, including calls that skip an explicit open.
        const opened = ['update', 'revert'].includes(args.action)
          ? await service.execute({ action: 'open', id: args.id }, context, signal) as { id: string } : null;
        const result = await service.execute({ action: args.action, id: args.id, revision: args.revision,
          ...(opened ? { id: opened.id } : {}),
          ...(args.patch === undefined ? {} : { patch: args.action === 'update'
            ? await resolveSkinImages(JSON.parse(args.patch), qz, signal) : JSON.parse(args.patch) }),
          ...(args.skin === undefined ? {} : { skin: args.action === 'create'
            ? await resolveSkinImages(JSON.parse(args.skin), qz, signal) : JSON.parse(args.skin) }) }, context, signal);
        if (args.action === 'list') { const snapshot = result as SkinSnapshot; return { activeId: snapshot.activeId, skins: snapshot.skins }; }
        if ('skin' in result) {
          const skin = result.skin as WelcomeSkin;
          if (args.action === 'create') await service.execute({ action: 'open', id: skin.id }, context, signal);
          if (args.action !== 'get') return { id: skin.id, revision: skin.revision, name: skin.name, previewUpdated: true, applied: args.action === 'apply' };
          if (skin.visual.type === 'model3d') {
            const { src, ...visual } = skin.visual;
            return { skin: { ...skin, visual }, modelInfo: inspectGlb(glbDataBytes(src)), modelStoredLocally: true };
          }
          if (skin.visual.type === 'scene3d' && skin.visual.models) {
            const models = Object.fromEntries(Object.entries(skin.visual.models).map(([id, { src, ...character }]) => [id, character]));
            const modelInfo = Object.fromEntries(Object.entries(skin.visual.models).map(([id, character]) => [id,
              { name: character.name, ...inspectGlb(glbDataBytes(character.src)) }]));
            return { skin: { ...skin, visual: { ...skin.visual, models } }, modelInfo, modelStoredLocally: true };
          }
        }
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof qz.ToolExecutionError) throw error;
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'SKIN_INVALID';
        throw new qz.ToolExecutionError(code, error instanceof ImageLimitError ? error.message : skinErrorText({ code }), {
          recovery: code.startsWith('SKIN_IMAGE_') || error instanceof ImageLimitError
            ? 'Use a valid PNG/JPEG/WebP/GIF data URL or direct HTTP(S) image URL. For redirects or protected images, use collect_images on the page and pass its assetId as visual.src. Recollect missing assets. No skin changes were saved.'
            : 'Read the current skin with manage_skin get, inspect the preview, then retry with the current revision.' });
      }
    },
  });
}
