import { defineToolMetadata } from '#sdk/shared/metadata';
import { skinT as t } from '#sdk/shared/skin-messages';
export default { get tools() { return { manage_skin: defineToolMetadata(t('tool'), ['settings']) }; } };
