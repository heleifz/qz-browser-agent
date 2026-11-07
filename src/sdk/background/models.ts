/** Model directories live in Background; UI requests only the matched metadata it needs. */
export { getOfficialProviderModelOptions } from "../../shared/models/model-capabilities.js";
export { getModelsDevProviderIndex, getModelsDevProviders, loadBundledModelsDevProviders, refreshModelsDevProviders } from "../../shared/models/models-dev.js";
export { createModelsDevProviderIndex, modelsDevProviderRoute, compatibleModelsDevModels, type ModelsDevProviderIndex } from "../../shared/models/models-dev-providers.js";

export { matchProviderModelCapabilities as matchConfiguredModelCapabilities } from '../../background/llm/model-directory.js';
