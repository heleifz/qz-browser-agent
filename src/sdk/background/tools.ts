/** Public tools contracts and operations, independent of extension implementation paths. */
export { ToolExecutionError, requireToolFields, throwMissingToolArgs } from "../../background/tools/arguments.js";
export { delayTimeout, pageWaitTimeout, scriptTimeout, sessionWaitTimeout } from "../../background/tools/timing.js";
export { publishTimeoutTrace } from "../../background/tools/script-timeout-trace.js";
export { runWaitWithTrigger, waitTriggerParameter } from "../../background/tools/wait-observation.js";
export type { WaitObservation, WaitTrigger } from "../../background/tools/wait-observation.js";
export { diagnosticTrace, formatTraceFields, shouldTraceStreamDelta, trace } from "../../background/trace.js";
export { toolError, markToolValue, isToolValue } from "../../shared/contracts/tool-error.js";
export type { ToolError } from "../../shared/contracts/tool-error.js";
export { bindToolResultPresentation, getToolResultPresentation } from "../../shared/contracts/tool-result-presentation.js";
