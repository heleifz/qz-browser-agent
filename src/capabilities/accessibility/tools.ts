import { toolT } from "./tool-messages.js";
import { t } from "./i18n.js";
import type { ToolExtension, ToolExtensionAPI } from "#sdk/background";
import { isPageOverview, type PageAction as Action, type PageCanvas as Canvas, type PageOverview } from "#sdk/shared/browser";
import { collectSnapshotInputs } from "#sdk/background/browser";
import { buildPageSnapshot, type SnapshotDisplayNode } from "./snapshot-tree.js";
type AccessibilityHost = Pick<ToolExtensionAPI,
  "registerTool" | "ToolExecutionError" | "clampLimit" | "makeSessionTabTargetError"
  | "sendToContent" | "withDebugger" | "subscribeDebuggerEvents"> & Pick<ToolExtensionAPI["element"],
  "makeSnapshotId" | "elementTargetForUid" | "registerElementRef" | "resolveElementReference"
  | "backendNodeIdForSelector" | "elementTargetGrammar">;
interface SnapshotContext { tabId: number; snapshotId: string; sessionId?: string; pageUrl?: string }
type DisplayNode = SnapshotDisplayNode;

/** Registers the compact accessibility-tree snapshot tool. */
export function registerAccessibilityTools({
  registerTool,
  ToolExecutionError,
  clampLimit,
  makeSnapshotId,
  elementTargetForUid,
  registerElementRef,
  resolveElementReference,
  backendNodeIdForSelector,
  makeSessionTabTargetError,
  sendToContent,
  withDebugger,
  subscribeDebuggerEvents,
  elementTargetGrammar: ELEMENT_TARGET_GRAMMAR,
}: AccessibilityHost) {
function cleanAxValue(value: unknown) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function truncateInline(value: unknown, max: number) {
  const text = cleanAxValue(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function attachSnapshotRefsToActions(actions: Action[], nodes: DisplayNode[], { tabId, snapshotId, sessionId = "", pageUrl = "" }: SnapshotContext) {
  const candidates = Array.isArray(nodes) ? nodes : [];
  const used = new Set<string>();
  return (Array.isArray(actions) ? actions : []).map((action, index) => {
    const matched = findBestActionNode(action, candidates, used);
    const uid = matched?.uid || `${snapshotId}_a${index}`;
    used.add(uid);
    const next = { ...action, uid, target: elementTargetForUid(uid) };
    registerElementRef({
      uid,
      tabId,
      sessionId,
      pageUrl,
      selector: next.selector,
      index: 0,
      backendNodeId: matched?.backendNodeId,
      role: next.role || matched?.role,
      name: next.name || next.text || matched?.name,
      url: next.href || matched?.url,
      snapshotId,
    });
    return next;
  });
}

function compactAxActionsForModel(actions: Action[]) {
  return (Array.isArray(actions) ? actions : []).map((action, index) => {
    const target = action?.target || elementTargetForUid(action?.uid);
    const next = {
      i: Number.isFinite(Number(action?.i)) ? Number(action.i) : index,
      target,
      role: truncateInline(action?.role, 40),
      type: truncateInline(action?.type, 40),
      name: truncateInline(action?.name, 100),
      text: truncateInline(action?.text, 120),
      textLength: Number.isFinite(Number(action?.textLength)) && Number(action.textLength) > 0
        ? Number(action.textLength)
        : undefined,
      value: truncateInline(action?.value, 80),
      placeholder: truncateInline(action?.placeholder, 80),
      href: truncateInline(action?.href, 160),
      disabled: action?.disabled ? true : undefined,
      editable: action?.editable ? true : undefined,
      checked: typeof action?.checked === "boolean" ? action.checked : undefined,
      accept: truncateInline(action?.accept, 120),
      multiple: action?.multiple ? true : undefined,
      selectedFileCount: Number.isFinite(Number(action?.selectedFileCount))
        ? Number(action.selectedFileCount)
        : undefined,
      inViewport: typeof action?.inViewport === "boolean" ? action.inViewport : undefined,
      rect: action?.rect && typeof action.rect === "object" ? action.rect : undefined,
    };
    for (const key of Object.keys(next) as (keyof typeof next)[]) {
      if (next[key] == null || next[key] === "") delete next[key];
    }
    return next;
  });
}

function compactAxHeadingsForModel(headings: NonNullable<PageOverview["headings"]>) {
  return (Array.isArray(headings) ? headings : [])
    .map(heading => ({
      level: Number.isFinite(Number(heading?.level)) ? Number(heading.level) : null,
      text: truncateInline(heading?.text, 160),
    }))
    .filter(heading => heading.text);
}

function compactAxCanvasesForModel(canvases: Canvas[]) {
  return (Array.isArray(canvases) ? canvases : [])
    .slice(0, 8)
    .map((canvas) => {
      const rect = canvas?.rect && typeof canvas.rect === "object"
        ? {
            x: Number(canvas.rect.x),
            y: Number(canvas.rect.y),
            w: Number(canvas.rect.w),
            h: Number(canvas.rect.h),
          }
        : null;
      if (!rect || !Object.values(rect).every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) return null;
      const bitmapWidth = Number(canvas?.bitmapSize?.width);
      const bitmapHeight = Number(canvas?.bitmapSize?.height);
      const next = {
        name: truncateInline(canvas?.name, 160),
        rect,
        inViewport: typeof canvas?.inViewport === "boolean" ? canvas.inViewport : undefined,
        bitmapSize: Number.isFinite(bitmapWidth) && Number.isFinite(bitmapHeight)
          ? { width: bitmapWidth, height: bitmapHeight }
          : undefined,
      };
      for (const key of Object.keys(next) as (keyof typeof next)[]) {
        if (next[key] == null || next[key] === "") delete next[key];
      }
      return next;
    })
    .filter(Boolean);
}

function findBestActionNode(action: Action, nodes: DisplayNode[], used: Set<string>) {
  let best: DisplayNode | null = null;
  let bestScore = 0;
  for (const node of nodes) {
    if (!node?.uid || used.has(node.uid)) continue;
    const score = scoreActionNodeMatch(action, node);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return bestScore >= 3 ? best : null;
}

function scoreActionNodeMatch(action: Action, node: DisplayNode) {
  let score = 0;
  const actionHref = cleanAxValue(action.href);
  const nodeUrl = cleanAxValue(node.url);
  const actionRole = normalizeRole(action.role);
  const nodeRole = normalizeRole(node.role);
  const actionText = cleanAxValue(action.name || action.text || action.value || action.placeholder);
  const nodeText = cleanAxValue(node.name || node.value);

  if (actionHref && nodeUrl && sameUrlPrefix(actionHref, nodeUrl)) score += 5;
  if (actionRole && nodeRole && actionRole === nodeRole) score += 2;
  if (actionText && nodeText) {
    if (actionText === nodeText) score += 4;
    else if (actionText.includes(nodeText) || nodeText.includes(actionText)) score += 2;
  }
  return score;
}

function normalizeRole(role: unknown) {
  const value = String(role || "").toLowerCase();
  if (value === "a") return "link";
  if (value === "input" || value === "textarea") return "textbox";
  return value;
}

function sameUrlPrefix(a: string, b: string) {
  const left = String(a || "").split("#")[0];
  const right = String(b || "").split("#")[0];
  return left === right || left.startsWith(right) || right.startsWith(left);
}

registerTool({
  name: "get_ax_tree",
  model: { projectResult: projectAxResultForModel },
  get description() { return toolT("getAxTreeDescription", { targetGrammar: ELEMENT_TARGET_GRAMMAR }); },
  get parameters() { return {
    type: "object",
    properties: {
      tabId: { type: "number", description: toolT("getAxTreeTabId") },
      root: { type: "string", description: toolT("getAxTreeRoot") },
      depth: { type: "number", description: toolT("getAxTreeDepth") },
      limit: { type: "number", description: toolT("getAxTreeLimit") },
      actionsLimit: { type: "number", description: toolT("getAxTreeActionsLimit") },
    },
  } as const; },
  page: "owned",
  timeout: { defaultMs: 30000, maxMs: 300000 },
  execute: async ({ tabId, root = "root", depth = 16, limit = 120, actionsLimit = 40 }, _signal, context = {}) => {
    const axDepth = Number.isFinite(Number(depth)) ? clampLimit(depth, 1, 40) : 16;
    const snapshotLimit = Number.isFinite(Number(limit)) ? clampLimit(limit, 20, 300) : 120;
    const actionMax = Number.isFinite(Number(actionsLimit)) ? clampLimit(actionsLimit, 5, 80) : 40;
    let snapshotId = "";
    const sessionId = String(context.sessionId || "").trim();
    const requestedRoot = String(root || "root").trim() || "root";
    let targetTabId = tabId;
    let resolvedRoot = requestedRoot;
    let overviewSelector = "body";
    let rootBackendNodeId = 0;
    let rootFrameId = "";

    if (requestedRoot !== "root") {
      const rootRef = await resolveElementReference(tabId, { target: requestedRoot, allowBackendOnly: true }, context);
      targetTabId = rootRef.tabId;
      resolvedRoot = rootRef.target || requestedRoot;
      overviewSelector = rootRef.selector || "";
      rootBackendNodeId = Number(rootRef.ref?.backendNodeId || 0);
      rootFrameId = String(rootRef.ref?.frameId || "");
      if (!rootBackendNodeId && overviewSelector && targetTabId) {
        rootBackendNodeId = await backendNodeIdForSelector(targetTabId, overviewSelector, context);
      }
      if (!rootBackendNodeId) {
        throw new ToolExecutionError("AX_ROOT_UNRESOLVED", t("cannotResolveAxRoot", { selector: String(requestedRoot) }), {
          root: requestedRoot,
          target: resolvedRoot,
          selector: overviewSelector || undefined,
        });
      }
    }

    if (!targetTabId) throw makeSessionTabTargetError("SESSION_TAB_TARGET_REQUIRED", {
      toolName: "get_ax_tree",
      sessionId: context?.sessionId || "",
      depth,
      root: requestedRoot,
    });

    snapshotId = makeSnapshotId(targetTabId);
    let overview: PageOverview;
    try {
      const result = await sendToContent(targetTabId, "pageOverview", {
        limit: actionMax,
        selector: overviewSelector || "body",
      });
      if (!isPageOverview(result)) throw new ToolExecutionError("PAGE_OVERVIEW_FAILED", t("pageOverviewResponseIsInvalid"));
      overview = result;
    } catch (err) {
      overview = {
        error: err instanceof Error ? err.message : String(err),
        code: err instanceof ToolExecutionError ? err.code : "PAGE_OVERVIEW_FAILED",
      };
    }

    const pageUrl = String(overview?.url || "").trim();
    const ax = await withDebugger(targetTabId, async (_target, send) => {
      const fetchDepth = rootBackendNodeId ? 40 : axDepth;
      const subscribe = (listener: (method: string, params: Record<string, unknown>) => void) =>
        subscribeDebuggerEvents ? subscribeDebuggerEvents(targetTabId!, listener) : () => {};
      const inputs = await collectSnapshotInputs(targetTabId!, send, subscribe, fetchDepth);
      const built = buildPageSnapshot(inputs.sources as unknown as Parameters<typeof buildPageSnapshot>[0], {
        snapshotId,
        limit: snapshotLimit,
        maxDepth: axDepth,
        rootBackendNodeId: rootBackendNodeId || undefined,
        rootFrameId: rootFrameId || undefined,
      });
      for (const node of built.nodes) {
        registerElementRef({
          uid: node.uid,
          tabId: targetTabId!,
          sessionId,
          pageUrl,
          backendNodeId: node.backendNodeId,
          frameId: node.frameId,
          oopif: node.oopif,
          role: node.role,
          name: node.name,
          url: node.url,
          snapshotId,
        });
      }
      return { ...built, frames: inputs.frames.map((frame, index) => ({
        index: index + 1,
        frameId: frame.frameId,
        oopif: frame.oopif,
        url: frame.url,
      })) };
    }, context);

    const actions = attachSnapshotRefsToActions(overview?.actions || [], ax.nodes, {
      tabId: targetTabId,
      snapshotId,
      sessionId,
      pageUrl,
    });
    return {
      tabId: targetTabId,
      title: overview?.title,
      url: overview?.url,
      viewport: overview?.viewport,
      snapshotId,
      root: resolvedRoot,
      rootFound: ax.rootFound,
      depth: axDepth,
      nodeCount: ax.nodeCount,
      semanticNodeCount: ax.semanticNodeCount,
      returnedNodeCount: ax.returnedNodeCount,
      truncatedNodeCount: ax.truncatedNodeCount,
      outlineTruncated: ax.outlineTruncated,
      frames: ax.frames,
      snapshot: ax.snapshot,
      headings: compactAxHeadingsForModel(overview?.headings || []),
      actions: compactAxActionsForModel(actions),
      canvases: compactAxCanvasesForModel(overview?.canvases || []),
      pageOverviewError: overview?.error ? {
        error: overview.error,
        code: overview.code,
      } : undefined,
    };
  },
});


}

/** The model gets actionable fields; UI diagnostics remain in the original result. */
function projectAxResultForModel(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const { nodes, ...out } = result as Record<string, unknown>;
  if (Array.isArray(out.actions)) out.actions = out.actions.map((action: Record<string, unknown>) => ({
    target: action.target,
    selector: action.selector,
    role: action.role,
    name: action.name,
    text: action.text,
    value: action.value,
    placeholder: action.placeholder,
    href: action.href,
    disabled: action.disabled,
    editable: action.editable,
    inViewport: action.inViewport,
  }));
  return out;
}


export default ((host) => { registerAccessibilityTools({ ...host, ...host.element }); }) satisfies ToolExtension;
