import { t } from "./i18n.js";
import { toolT } from "./tool-messages.js";
import { defineToolMetadata as toolMeta } from "#sdk/shared/metadata";
import type { CapabilityMetadata } from "#sdk/shared/metadata";

const tools = () => Object.freeze({
  run_flow: toolMeta(toolT("runFlowTitle"), ["script"], { profileFamily: "script", resultFamily: "script", familyId: "process", pageContext: true }),
  run_script: toolMeta(t("executeScript"), ["script"], { profileFamily: "script", resultFamily: "script", familyId: "process", pageContext: true }),
});

export default { get tools() { return tools(); } } satisfies CapabilityMetadata;


