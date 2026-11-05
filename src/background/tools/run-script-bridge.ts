import { copyToolResultPresentation } from "../../shared/contracts/tool-result-presentation.js";
import { isToolFailure, toolError } from "../../shared/contracts/tool-error.js";
import { type DriveToolObservation, driveToolSignature, isDriveToolDefault, isDriveToolForbidden, prepareDriveToolCall } from "../mcp/external-drive.js";
import { t } from "../../shared/i18n/backend.js";
import { getLanguage, withLanguage } from "../../shared/i18n/index.js";
import { projectToolArtifacts } from "../../shared/tools/tool-artifacts.js";
import { positiveArtifactNumber as positiveNumber } from "../../shared/tools/artifact-projection.js";
import type { ToolContext } from "../../sdk/background.js";
import { getToolCallParent } from "./call-lifecycle.js";
import type { RegisteredTool } from "./registry.js";
import type { ToolBehavior, ToolModelPolicy } from "../../shared/contracts/tool.js";
import { toolBehaviorEnabled } from "./behavior.js";
type Fields = Record<string, unknown>;
interface RunScriptToolContext extends ToolContext { loadedPluginSkillNames?: unknown; skillToolRegistrySnapshot?: unknown }
interface BridgeHost {
  ready?(): Promise<unknown>;
  normalizeSessionId?(value: unknown): string;
  supervisor: { isRunCurrent(sessionId: string, runId: string): boolean; hasAgent(sessionId: string): boolean; getAbortSignal(sessionId: string, runId: string): AbortSignal | null | undefined };
  getRuntime(sessionId: string): Fields | null | undefined;
  isTerminalRuntimeForRun?(runtime: Fields | null | undefined, runId: string): boolean;
  canManageSessions(sessionId: string): Promise<boolean>;
  buildRunProfile(input: { sessionId: string; canManageSessions: boolean | undefined; externalDrive: boolean }): Promise<NonNullable<ToolContext["runProfile"]>>;
  getRunToolContext?(sessionId: string, runId: string): Promise<RunScriptToolContext | null>;
  recordDriveTool?(input: DriveToolObservation): Promise<unknown>;
  applyNestedToolResult?(input: { sessionId: string; runId: string; toolName: string; args: Fields; result: unknown; isError: boolean }): Promise<unknown>;
  toolRuntime: {
    getSchemas(context: ToolContext): RegisteredTool["schema"][];
    resolveDefinition(name: string, options: { skillToolRegistrySnapshot?: unknown; toolRegistrySnapshot?: unknown; language?: string }): { behavior?: Readonly<ToolBehavior>; model?: Readonly<ToolModelPolicy> } | null;
    execute(name: string, args: unknown, signal: AbortSignal | undefined, context: ToolContext): Promise<unknown>;
    getTabAliases?(sessionId: string): Readonly<Record<string, number>>;
  };
  collectArtifacts(name: string, args: Fields, result: unknown): Fields[];
  appendArtifacts?(input: { sessionId: string; runId: string; toolCallId: string; sourceTool: string; artifacts: Fields[] }): Promise<unknown>;
  scheduleArtifactRefresh?(sessionId: string, options: { action: string; touchSession: boolean; delay: number }): unknown;
  logger?: Pick<Console, "debug">;
}
interface BridgeSender { tab?: { id?: number } }
import {
  localizeToolFailureError,
  localizeToolFailurePayload,
} from "../../shared/tools/tool-error-localization.js";

export function createRunScriptArtifactCollector({ getToolIdentity }: { getToolIdentity(name: string): { capabilityId?: string } }) {
  if (typeof getToolIdentity !== "function") throw new TypeError("getToolIdentity is required");
  return (toolName = "", args: unknown = {}, result: unknown = {}) =>
    projectToolArtifacts(getToolIdentity(toolName).capabilityId || toolName, args, result, "resource");
}

export function createRunScriptBridge({
  ready = async () => {},
  normalizeSessionId = value => String(value || "").trim(),
  supervisor,
  getRuntime,
  isTerminalRuntimeForRun,
  canManageSessions,
  buildRunProfile,
  getRunToolContext = async () => null,
  applyNestedToolResult = async () => false,
  recordDriveTool,
  toolRuntime,
  collectArtifacts,
  appendArtifacts = async () => {},
  scheduleArtifactRefresh = () => {},
  logger = console,
}: BridgeHost) {
  if (!supervisor || typeof supervisor.isRunCurrent !== "function") throw new TypeError("supervisor is required");
  if (typeof getRuntime !== "function") throw new TypeError("getRuntime is required");
  if (typeof canManageSessions !== "function") throw new TypeError("canManageSessions is required");
  if (typeof buildRunProfile !== "function") throw new TypeError("buildRunProfile is required");
  if (!toolRuntime || typeof toolRuntime.execute !== "function") throw new TypeError("toolRuntime is required");
  if (typeof toolRuntime.resolveDefinition !== "function") throw new TypeError("toolRuntime.resolveDefinition is required");
  if (typeof collectArtifacts !== "function") throw new TypeError("collectArtifacts is required");

  async function handleToolCall(message: Fields = {}, sender: BridgeSender = {}) {
    let rawResult: unknown, externalDrive = false;
    const response = await executeToolCall(message, sender, result => { rawResult = result; }, mode => { externalDrive = mode; });
    const sessionId = normalizeSessionId(message.sessionId);
    const runId = String(message.runId || "").trim();
    const name = String(message.toolName || "").trim();
    const parent = getToolCallParent(message.parentCallId, sessionId, runId);
    if (recordDriveTool && externalDrive && name && name !== "__list_tools__"
      && plainObject(response).code !== "RUN_STOPPED" && supervisor.isRunCurrent(sessionId, runId)
      && (message.parentCallId === undefined || parent && !parent.signal?.aborted)) {
      try {
        await recordDriveTool({ sessionId, runId, name, args: plainObject(message.args),
          result: rawResult ?? response.result ?? response, isError: response.isError === true });
      } catch (error) {
        logger.debug("[轻舟] persist nested drive tool failed:", error instanceof Error ? error.message : error);
      }
    }
    return response;
  }

  async function executeToolCall(message: Fields, sender: BridgeSender, observe: (result: unknown) => void, observeMode: (externalDrive: boolean) => void) {
    await ready();
    let language = getLanguage();
    const respondFailure = (payload: unknown, options: { toolName?: string } = {}) =>
      withLanguage(language, () => failureResponse(payload, options));
    const toolName = String(message.toolName || "").trim();
    if (!toolName) {
      return respondFailure({
        error: "run_script tool bridge requires toolName",
        code: "MISSING_TOOL_NAME",
        details: {},
      }, { toolName: "run_script" });
    }

    const sessionId = normalizeSessionId(message.sessionId);
    const runId = String(message.runId || "").trim();
    // Current script transports always include a parent ID. Legacy direct host
    // calls without the field retain their run-scoped cancellation contract.
    const parent = getToolCallParent(message.parentCallId, sessionId, runId);
    const runSignal = supervisor.getAbortSignal(sessionId, runId);
    const signal = message.parentCallId !== undefined && !parent ? AbortSignal.abort()
      : parent?.signal && runSignal ? AbortSignal.any([parent.signal, runSignal]) : parent?.signal || runSignal || undefined;
    const stoppedError = stoppedBridgeError(sessionId, runId, toolName, signal);
    if (stoppedError) return respondFailure(stoppedError, { toolName });
    try {
      const toolContext = await resolveToolContext(sessionId, runId, parent, observeMode);
      language = toolContext.language || language;
      const contextStopped = stoppedBridgeError(sessionId, runId, toolName, signal);
      if (contextStopped) return respondFailure(contextStopped, { toolName });
      const driveRun = toolContext.externalDrive === true;
      if (driveRun && toolName !== "__list_tools__" && isDriveToolForbidden(toolName)) {
        return respondFailure({
          error: t("drive.toolForbidden", { name: toolName }),
          code: "DRIVE_TOOL_FORBIDDEN",
          details: { toolName },
        }, { toolName });
      }

      if (toolName === "__list_tools__") {
        const tools = [];
        for (const schema of toolRuntime.getSchemas(toolContext)) {
          const name = schema.function?.name || "";
          if (!name || (driveRun && !isDriveToolDefault(name))) continue;
          tools.push(driveRun
            ? driveToolSignature({
              name,
              description: schema.function?.description || "",
              parameters: schema.function?.parameters || {},
            })
            : {
              name,
              description: schema.function?.description || "",
              parameters: schema.function?.parameters || {},
            });
        }
        return {
          ok: true,
          result: { tools },
          isError: false,
        };
      }

      const depth = Math.max(0, Math.floor(Number(message.depth) || 0));
      if (depth > 3) {
        return respondFailure({
          error: `run_script nested tool call depth exceeded while calling ${toolName}`,
          code: "RUN_SCRIPT_TOOL_DEPTH_EXCEEDED",
          details: { toolName, depth, maxDepth: 3 },
        }, { toolName });
      }

      let toolArgs = plainObject(message.args);
      if (driveRun && toolName !== "__list_tools__") {
        const prepared = prepareDriveToolCall(toolName, toolArgs);
        if (!prepared.ok) {
          return respondFailure(prepared.error, { toolName });
        }
        toolArgs = prepared.args;
      }
      const definition = toolRuntime.resolveDefinition(toolName, { skillToolRegistrySnapshot: toolContext.skillToolRegistrySnapshot, toolRegistrySnapshot: toolContext.toolRegistrySnapshot, language: toolContext.language });
      const result = await toolRuntime.execute(toolName, toolArgs, signal, {
        ...toolContext,
        sessionId,
        runId,
        runScriptToolDepth: depth,
        source: "run_script",
        senderTabId: sender?.tab?.id || null,
      });
      // A host or zero-timeout handler may complete after its run was revoked.
      const executionStopped = stoppedBridgeError(sessionId, runId, toolName, signal);
      if (executionStopped) return respondFailure(executionStopped, { toolName });
      observe(result);
      const output = plainObject(result);
      const isError = isToolFailure(output);
      await applyNestedToolResult({ sessionId, runId, toolName, args: toolArgs, result, isError });
      const resultStopped = stoppedBridgeError(sessionId, runId, toolName, signal);
      if (resultStopped) return respondFailure(resultStopped, { toolName });
      if (isError) {
        return respondFailure(result, { toolName });
      }

      const artifacts = collectArtifacts(toolName, toolArgs, result);
      if (artifacts.length) {
        try {
          await appendArtifacts({
            sessionId,
            runId,
            toolCallId: "",
            sourceTool: toolName,
            artifacts,
          });
          scheduleArtifactRefresh(sessionId, { action: "artifacts", touchSession: true, delay: 400 });
        } catch (error) {
          logger?.debug?.("[轻舟] record run_script resource artifacts failed:", error instanceof Error ? error.message : error);
        }
      }
      const modelResult = definition?.model?.projectResult ? definition.model.projectResult(result) : result;
      const observation = nestedObservation(definition?.behavior, toolArgs, result);
      return {
        ok: true,
        result: omitObservationImage(modelResult, Boolean(observation)),
        ...(observation ? { observation } : {}),
        artifacts,
        isError: false,
      };
    } catch (error) {
      const failure = plainObject(error);
      const localized = plainObject(withLanguage(language, () => localizeToolFailureError(error, {
        toolName,
        code: failure.code || "RUN_SCRIPT_TOOL_CALL_FAILED",
      })));
      return respondFailure(copyToolResultPresentation(error, {
        error: localized?.message || String(localized || error),
        code: localized?.code || failure.code || "RUN_SCRIPT_TOOL_CALL_FAILED",
        hint: localized.hint || failure.hint,
        details: localized?.details || failure.details || { toolName },
      }), { toolName });
    }
  }

  async function resolveToolContext(sessionId: string, runId: string, parent: ToolContext | undefined, observeMode: (externalDrive: boolean) => void): Promise<ToolContext> {
    const runtime = plainObject(getRuntime(sessionId));
    const runContext = { ...parent, ...await getRunToolContext(sessionId, runId) };
    const externalDrive = (parent?.externalDrive ?? runContext.externalDrive) === true;
    observeMode(externalDrive);
    const snapshotContext = plainObject(runContext.dynamicContext);
    const dynamicContext = {
      ...snapshotContext,
      taskSiteTabs: Array.isArray(runtime.visitedTaskSites)
        ? runtime.visitedTaskSites.map(pageTab).filter(value => value !== null)
        : (Array.isArray(snapshotContext.taskSiteTabs) ? snapshotContext.taskSiteTabs.map(pageTab).filter(value => value !== null) : []),
    };
    const canManage = runContext.runProfile ? undefined : await canManageSessions(sessionId);
    return {
      externalDrive,
      sourceWindowId: positiveNumber(snapshotContext.sourceWindowId) || null,
      dynamicContext,
      loadedPluginSkillNames: mergeStringLists(
        runContext.loadedPluginSkillNames,
        runtime.loadedPluginSkillNames,
      ),
      runProfile: runContext.runProfile || await buildRunProfile({ sessionId, canManageSessions: canManage, externalDrive }),
      skillToolRegistrySnapshot: runContext.skillToolRegistrySnapshot || null,
      toolRegistrySnapshot: runContext.toolRegistrySnapshot, language: runContext.language,
    };
  }

  function stoppedBridgeError(sessionId: string, runId: string, toolName: string, signal?: AbortSignal) {
    const runtime = getRuntime(sessionId);
    const stopped = signal?.aborted || (runId
      ? !supervisor.isRunCurrent(sessionId, runId)
      : (!supervisor.hasAgent(sessionId) && isTerminalRuntimeForRun?.(runtime, "")));
    if (!stopped) return null;
    return localizeToolFailurePayload({
      ok: false,
      error: t("browser.runScriptStopped"),
      code: "RUN_STOPPED",
      details: { sessionId, runId, toolName, runtimeStatus: runtime?.status || "" },
    }, { toolName });
  }

  return Object.freeze({ handleToolCall });
}

function omitObservationImage(result: unknown, stripImage = false) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  if (!stripImage) return result;
  const { _image, _imageDetail, ...withoutImage } = plainObject(result);
  return withoutImage;
}

function nestedObservation(behavior: Readonly<ToolBehavior> | undefined, args: Fields = {}, result: unknown = {}) {
  const output = plainObject(result);
  if (!toolBehaviorEnabled(behavior?.nestedObservation, args) || typeof output._image !== "string" || !output._image) return null;
  return {
    _image: output._image,
    ...(output._imageDetail ? { _imageDetail: output._imageDetail } : {}),
  };
}

function failureResponse(payload: unknown, { toolName = "" } = {}) {
  const input = plainObject(payload, { error: String(payload || "run_script tool bridge failed") });
  const localized = plainObject(localizeToolFailurePayload({
    ...input,
    ok: false,
    code: input.code || "RUN_SCRIPT_TOOL_CALL_FAILED",
  }, {
    toolName,
    code: input.code || "RUN_SCRIPT_TOOL_CALL_FAILED",
    isError: true,
  }));
  const failure = copyToolResultPresentation(payload, toolError(String(localized.code || input.code || "RUN_SCRIPT_TOOL_CALL_FAILED"),
    String(localized.message || localized.error || input.message || input.error || "Script tool call failed."), {
      hint: typeof localized.hint === "string" ? localized.hint : typeof input.hint === "string" ? input.hint : undefined,
      details: plainObject(localized.details || input.details),
    }));
  return { ok: false, ...failure, result: failure, isError: true };

}

function plainObject(value: unknown, fallback?: Fields): Fields;
function plainObject(value: unknown, fallback: null): Fields | null;
function plainObject(value: unknown, fallback: Fields | null = {}): Fields | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Fields : fallback;
}

function mergeStringLists(...values: unknown[]) {
  const out = new Set<string>();
  for (const value of values) {
    const items = value instanceof Set ? [...value] : (Array.isArray(value) ? value : []);
    for (const item of items) {
      const text = String(item || "").trim().toLowerCase();
      if (text) out.add(text);
    }
  }
  return [...out];
}

function pageTab(value: unknown): (Fields & { url: string }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const tab = plainObject(value);
  return { ...tab, url: String(tab.url || "") };
}
