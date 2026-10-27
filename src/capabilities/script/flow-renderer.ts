import type { RendererDefinition, ToolView } from "#sdk/sidepanel";
import { appendCodeDetail, createCopyableCodeBlock, getToolDisplayName } from "#sdk/sidepanel/presentation";
import { formatDurationMsForUi } from "#sdk/sidepanel/components";
import { t } from "./i18n.js";
import { flowText, projectFlowResult } from "./flow-result.js";

export function flowSummary(view: Pick<ToolView, "args" | "originalResult">): string {
  const comment = typeof view.args.code === "string" ? view.args.code.match(/^\s*\/\/\s*([^\n]+)/)?.[1] : "";
  const tools = projectFlowResult(view.originalResult).display?.steps.map(step => getToolDisplayName(step.tool)) || [];
  return comment?.slice(0, 120) || [...new Set(tools)].slice(0, 3).join(" → ") || t("flowTitle");
}

const stateLabel = (state: string): string => ({
  preparing: t("flowPreparing"), queued: t("flowQueued"), running: t("flowRunning"),
  completed: t("flowCompleted"), error: t("flowFailed"), aborted: t("flowStopped"),
})[state] || state;
const outcomeLabel = (outcome: string): string => ({
  navigated: t("flowNavigated"), loaded: t("flowLoaded"), already_complete: t("flowAlreadyLoaded"), condition_met: t("flowConditionMet"),
})[outcome] || "";

/** Stable native disclosures and keyed rows survive streaming updates and renderer adoption. */
export function createFlowRenderer(): RendererDefinition {
  function create(document: Document) {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
      const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
    };
    const root = el("section", "qz-flow");
    const header = el("div", "qz-flow-header");
    const icon = el("span", "qz-flow-icon"); icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 8v8m0-4h8a4 4 0 0 0 4-4"/><circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/></svg>';
    const heading = el("div", "qz-flow-heading");
    const title = el("strong", "qz-flow-title");
    const count = el("span", "qz-flow-count");
    heading.append(title, count);
    const status = el("span", "qz-flow-status"); status.setAttribute("role", "status");
    header.append(icon, heading, status);
    const rail = el("div", "qz-flow-progress"); rail.setAttribute("aria-hidden", "true");
    const railFill = el("span", ""); rail.append(railFill);
    const list = el("ol", "qz-flow-steps qz-scroll qz-scroll--native"); list.setAttribute("aria-label", t("flowSteps"));
    const note = el("p", "qz-flow-note");
    const error = el("p", "qz-flow-error");
    root.append(header, rail, note, list, error);
    const disclosure = (label: string, key: string) => {
      const details = el("details", "qz-flow-disclosure"); details.dataset.flowDetail = key;
      const summary = el("summary", "qz-btn qz-btn--ghost qz-btn--sm");
      const caret = el("span", "qz-flow-caret", "▸"); caret.setAttribute("aria-hidden", "true");
      const caption = el("span", "", label); summary.append(caret, caption);
      const body = el("div", "qz-flow-detail-body"); details.append(summary, body); root.append(details);
      let previous = "";
      return { details, caption, update(value: unknown, code = false) {
        const bounded = flowText(value, code ? 32000 : 16000);
        details.hidden = !bounded.text;
        if (previous === bounded.text) return;
        previous = bounded.text; body.replaceChildren();
        if (bounded.truncated) body.append(el("p", "qz-flow-note", t("flowPreview")));
        if (code) appendCodeDetail(body, t("runCode"), bounded.text);
        else {
          const pre = el("pre", "code-block qz-scroll qz-scroll--native", bounded.text);
          pre.dir = "ltr"; body.append(createCopyableCodeBlock(pre));
        }
      } };
    };
    const observation = disclosure(t("flowObservation"), "observation");
    const result = disclosure(t("flowResult"), "result");
    const source = disclosure(t("flowSource"), "source");
    const rows = new Map<number, { root: HTMLLIElement; number: HTMLElement; tool: HTMLElement; target: HTMLElement; detail: HTMLElement; state: HTMLElement; duration: HTMLElement }>();
    let disposed = false;
    function update(view: ToolView): undefined {
      if (disposed) return;
      const projected = projectFlowResult(view.originalResult ?? view.result);
      const steps = projected.display?.steps || [];
      title.textContent = flowSummary(view); title.title = title.textContent;
      root.dataset.state = view.state;
      status.textContent = stateLabel(view.state);
      const settled = steps.filter(step => !["queued", "running"].includes(step.state)).length;
      count.textContent = projected.display ? t("flowCount", { done: settled + projected.display.omitted, total: projected.display.total }) : t("flowLegacy");
      railFill.style.inlineSize = view.state === "completed" ? "100%" : `${steps.length ? settled / steps.length * 100 : 0}%`;
      note.textContent = projected.display?.omitted ? t("flowOmitted", { count: projected.display.omitted }) : !steps.length ? (view.isRunning ? t("flowStarting") : t("flowLegacy")) : "";
      note.hidden = !note.textContent;
      error.textContent = projected.error || (view.state === "aborted" ? t("flowStopNote") : ""); error.hidden = !error.textContent;
      const followTail = !rows.size || list.scrollHeight - list.scrollTop - list.clientHeight < 24;
      const ids = new Set(steps.map(step => step.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.root.remove(); rows.delete(id); }
      steps.forEach((step, index) => {
        let row = rows.get(step.id);
        if (!row) {
          const node = el("li", "qz-flow-step"); node.dataset.flowStep = String(step.id);
          const number = el("span", "qz-flow-step-number", String(step.id)); number.setAttribute("aria-hidden", "true");
          const main = el("div", "qz-flow-step-main");
          const tool = el("strong", "qz-flow-step-tool"), target = el("span", "qz-flow-step-target"), detail = el("span", "qz-flow-step-outcome");
          main.append(tool, target, detail);
          const meta = el("div", "qz-flow-step-meta"), state = el("span", "qz-flow-step-state"), duration = el("span", "qz-flow-step-duration");
          meta.append(state, duration); node.append(number, main, meta);
          row = { root: node, number, tool, target, detail, state, duration }; rows.set(step.id, row);
        }
        const unfinished = ["queued", "running"].includes(step.state);
        const state = unfinished && !view.isRunning && !["running", "preparing"].includes(view.state)
          ? view.state === "aborted" ? "aborted" : "error" : step.state;
        row.root.dataset.state = state;
        row.tool.textContent = getToolDisplayName(step.tool); row.tool.title = step.tool;
        row.target.textContent = step.target || (step.tabId ? `tab ${step.tabId}` : step.tool); row.target.title = row.target.textContent; row.target.dir = "auto";
        row.detail.textContent = step.code || outcomeLabel(step.outcome || ""); row.detail.hidden = !row.detail.textContent;
        row.state.textContent = stateLabel(state);
        row.duration.textContent = step.elapsedMs === undefined ? "" : formatDurationMsForUi(step.elapsedMs);
        if (list.children[index] !== row.root) list.insertBefore(row.root, list.children[index] || null);
      });
      if (followTail) list.scrollTop = list.scrollHeight;
      observation.caption.textContent = projected.observationUnavailable ? t("flowObservationUnavailable") : projected.snapshotTruncated ? t("flowObservationPreview") : t("flowObservation");
      observation.update(projected.snapshot);
      result.update(projected.result);
      source.update(view.args.code || view.rawArgsText, true);
    }
    return { root, update, dispose(): undefined { disposed = true; rows.clear(); } };
  }
  return {
    id: "script.flow", showRawData: false,
    mount(container, view, context) {
      const control = create(context.document); container.append(control.root); control.update(view);
      return { update: control.update, dispose: control.dispose };
    },
    renderStatic(view, context) { const control = create(context.document); control.update(view); return control.root; },
  };
}
