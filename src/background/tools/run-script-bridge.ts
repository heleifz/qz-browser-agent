import { t } from "../../shared/i18n/backend.js";
import { resolveFlowExecution, type FlowToolPolicy } from "./flow-execution.js";
import { getLanguage, withLanguage } from "../../shared/i18n/index.js";
import { projectToolArtifacts } from "../../shared/tools/tool-artifacts.js";
import { positiveArtifactNumber as positiveNumber } from "../../shared/tools/artifact-projection.js";
import type { ToolContext } from "../../sdk/background.js";
import type { RegisteredTool } from "./registry.js";
import type { ToolBehavior } from "../../shared/contracts/tool.js";
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
  buildRunProfile(input: { sessionId: string; canManageSessions: boolean | undefined }): Promise<NonNullable<ToolContext["runProfile"]>>;
  getRunToolContext?(sessionId: string, runId: string): Promise<RunScriptToolContext | null>;
  applyNestedToolResult?(input: { sessionId: string; runId: string; toolName: string; args: Fields; result: unknown; isError: boolean }): Promise<unknown>;
  toolRuntime: {
    getSchemas(context: ToolContext): RegisteredTool["schema"][];
    resolveDefinition(name: string, options: { skillToolRegistrySnapshot?: unknown; toolRegistrySnapshot?: unknown; language?: string }): FlowToolPolicy | null;
    execute(name: string, args: unknown, signal: AbortSignal | undefined, context: ToolContext): Promise<unknown>;
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

  async function handleToolCall(message: Fields = {}, sender: BridgeSender = {}, watch: { ready?: () => void; signal?: AbortSignal } = {}): Promise<Fields> {
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
    const stoppedError = stoppedBridgeError(sessionId, runId, toolName);
    if (stoppedError) return respondFailure(stoppedError, { toolName });

    let flow: ReturnType<typeof resolveFlowExecution> | undefined;
    try {
      if (message.flowRequestId) flow = resolveFlowExecution(String(message.flowRequestId), sessionId, runId);
    } catch (error) {
      return respondFailure({ code: plainObject(error).code, error: String(error) }, { toolName });
    }

    if (flow && toolName.startsWith("__flow_")) {
      try {
        const args = plainObject(message.args);
        if (toolName === "__flow_emit__") return { ok: true, result: flow.emit(args.value) };
        if (toolName === "__flow_watch_result__" || toolName === "__flow_watch_cancel__") {
          return await flow.consumeWatch(String(args.id || ""), toolName === "__flow_watch_cancel__");
        }
        if (toolName === "__flow_watch__") {
          const context = await resolveToolContext(sessionId, runId);
          const name = String(args.name || "");
          const definition = toolRuntime.resolveDefinition(name, context);
          if (!definition?.behavior?.flowWait) return respondFailure({ code: "FLOW_TOOL_UNSUPPORTED", error: "Only passive wait tools can be watched." }, { toolName: name });
          return { ok: true, result: await flow.watch((ready, signal) => handleToolCall({ ...message, toolName: name, args: args.args }, sender, { ready, signal })) };
        }
      } catch (error) { return respondFailure({ code: plainObject(error).code, error: String(error) }, { toolName }); }
    }

    if (toolName === "__list_tools__") {
      const toolContext = await resolveToolContext(sessionId, runId);
      language = toolContext.language || language;
      return {
        ok: true,
        result: {
          tools: toolRuntime.getSchemas(toolContext).filter(schema => !flow || flow.allows(schema.function?.name || "", toolRuntime.resolveDefinition(schema.function?.name || "", toolContext) || {})).map(schema => ({
            name: schema.function?.name || "",
            description: schema.function?.description || "",
            parameters: schema.function?.parameters || {},
          })),
        },
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

    try {
      const toolContext = await resolveToolContext(sessionId, runId);
      language = toolContext.language || language;
      const runSignal = supervisor.getAbortSignal(sessionId, runId) || undefined;
      const signals = [runSignal, flow?.signal, watch.signal].filter((value): value is AbortSignal => Boolean(value));
      const signal = signals.length ? AbortSignal.any(signals) : undefined;
      const contextStopped = stoppedBridgeError(sessionId, runId, toolName, signal);
      if (contextStopped) return respondFailure(contextStopped, { toolName });
      const toolArgs = plainObject(message.args);
      const definition = toolRuntime.resolveDefinition(toolName, { skillToolRegistrySnapshot: toolContext.skillToolRegistrySnapshot, toolRegistrySnapshot: toolContext.toolRegistrySnapshot, language: toolContext.language });
      const context = {
        ...toolContext,
        sessionId,
        runId,
        runScriptToolDepth: depth,
        source: "run_script",
        senderTabId: sender?.tab?.id || null,
        ...(flow ? { flowPageLeaf: true, flowWaitReady: watch.ready, toolCallId: flow.context.toolCallId, spanId: flow.context.spanId } : {}),
      };
      if (flow) flow.observe = async (tabId, observationSignal = flow.signal) => {
        const stopped = stoppedBridgeError(sessionId, runId, "get_ax_tree", flow.signal);
        if (stopped) throw Object.assign(new Error(String(plainObject(stopped).error)), stopped);
        const result = await toolRuntime.execute("get_ax_tree", { tabId, limit: 40, depth: 8 }, AbortSignal.any([observationSignal, AbortSignal.timeout(5000)]), {
          ...context, ...await resolveToolContext(sessionId, runId), flowWaitReady: undefined,
        });
        if (plainObject(result).error) throw new Error(String(plainObject(result).error));
        return result;
      };
      const execute = () => toolRuntime.execute(toolName, toolArgs, signal, context);
      const result = await (flow ? flow.call(toolName, toolArgs, execute, definition || {}, signal) : execute());
      // A host or zero-timeout handler may complete after its run was revoked.
      const executionStopped = stoppedBridgeError(sessionId, runId, toolName, signal);
      if (executionStopped) return respondFailure(executionStopped, { toolName });
      const output = plainObject(result);
      const isError = output.ok === false || output.isError === true || output.error != null;
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
            toolCallId: flow?.context.toolCallId || "",
            sourceTool: toolName,
            artifacts,
          });
          scheduleArtifactRefresh(sessionId, { action: "artifacts", touchSession: true, delay: 400 });
        } catch (error) {
          logger?.debug?.("[轻舟] record run_script resource artifacts failed:", error instanceof Error ? error.message : error);
        }
      }
      const observation = nestedObservation(flow && typeof output._image === "string" ? { nestedObservation: true } : definition?.behavior, toolArgs, result);
      return {
        ok: true,
        result: stripNestedToolPresentation(result, Boolean(observation)),
        ...(observation ? { observation } : {}),
        artifacts,
        isError: Boolean(output.error),
      };
    } catch (error) {
      const failure = plainObject(error);
      const localized = plainObject(withLanguage(language, () => localizeToolFailureError(error, {
        toolName,
        code: failure.code || "RUN_SCRIPT_TOOL_CALL_FAILED",
      })));
      return respondFailure({
        error: localized?.message || String(localized || error),
        code: localized?.code || failure.code || "RUN_SCRIPT_TOOL_CALL_FAILED",
        codeLabel: localized?.codeLabel,
        details: localized?.details || failure.details || { toolName },
      }, { toolName });
    }
  }

  async function resolveToolContext(sessionId: string, runId: string): Promise<ToolContext> {
    const runtime = plainObject(getRuntime(sessionId));
    const runContext = await getRunToolContext(sessionId, runId) || {};
    const snapshotContext = plainObject(runContext.dynamicContext);
    const workingTab = pageTab(runtime.workingTab) || pageTab(snapshotContext.workingTab);
    const dynamicContext = {
      ...snapshotContext,
      workingTab,
      pageUrl: String(runtime.workingUrl || workingTab?.url || snapshotContext.pageUrl || ""),
      taskSiteTabs: Array.isArray(runtime.visitedTaskSites)
        ? runtime.visitedTaskSites.map(pageTab).filter(value => value !== null)
        : (Array.isArray(snapshotContext.taskSiteTabs) ? snapshotContext.taskSiteTabs.map(pageTab).filter(value => value !== null) : []),
    };
    const canManage = runContext.runProfile ? undefined : await canManageSessions(sessionId);
    return {
      workingTab,
      workingTabId: positiveNumber(runtime.workingTabId || workingTab?.id) || null,
      sourceWindowId: positiveNumber(snapshotContext.sourceWindowId) || null,
      dynamicContext,
      loadedPluginSkillNames: mergeStringLists(
        runContext.loadedPluginSkillNames,
        runtime.loadedPluginSkillNames,
      ),
      runProfile: runContext.runProfile || await buildRunProfile({ sessionId, canManageSessions: canManage }),
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

function stripNestedToolPresentation(result: unknown, stripImage = false) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const { _display, ...rest } = plainObject(result);
  if (!stripImage) return rest;
  const { _image, _imageDetail, ...withoutImage } = rest;
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
  const details = plainObject(localized?.details, plainObject(input.details, { toolName }));
  return {
    ok: false,
    error: localized?.error || localized?.message || String(input.error || input.message || "run_script tool bridge failed"),
    code: localized?.code || input.code || "RUN_SCRIPT_TOOL_CALL_FAILED",
    codeLabel: localized?.codeLabel,
    diagnostic: localized?.diagnostic,
    details,
    result: localized,
    isError: true,
  };
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
