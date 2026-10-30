import type { SkinLibrary, WelcomeSkin } from './model.js';
import { DAFEIYU_SCENE } from './dafeiyu-scene.js';
export function createDefaultSkinLibrary(): SkinLibrary {
  const skins: WelcomeSkin[] = [
    { schemaVersion: 1, id: 'qingzhou', revision: 1, name: '轻舟 · Qingzhou',
      visual: { type: 'image2d', src: 'builtin:logo-day', darkSrc: 'builtin:logo-night' },
      quotes: ['万重山外，一舟轻渡'], assets: {} },
    { schemaVersion: 1, id: 'dafeiyu', revision: 1, name: '蓝发角色 · 代码示例',
      visual: { type: 'scene3d', source: DAFEIYU_SCENE },
      quotes: ['今天也一起，慢慢游向答案。', '再大的问题，也可以一口一口吃掉。', '你负责奇思妙想，我负责陪你启航。'], assets: {} },
  ];
  return { schemaVersion: 1, activeId: 'qingzhou', entries: skins.map(skin => ({ draft: skin, saved: structuredClone(skin) })) };
}
