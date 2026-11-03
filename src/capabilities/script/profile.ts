import { t } from "./i18n.js";
import type { RendererServices } from "#sdk/sidepanel";
import * as presentation from "#sdk/sidepanel/presentation";

/** Read caller feedback while retaining stored pre-contract script results. */
export function appendScriptFeedback(parent: HTMLElement, value: unknown) {
  const envelope = presentation.getResultEnvelope(value);
  const details = envelope?.details && typeof envelope.details === "object" ? envelope.details as Record<string, unknown> : {};
  const trace = envelope?.ok === true ? envelope.trace : details.trace ?? envelope?.trace;
  if (Array.isArray(trace) && trace.length) presentation.appendScriptTrace(parent, trace);
  if (typeof envelope?.hint === "string" && envelope.hint.trim()) presentation.appendCompactLine(parent, { title: envelope.hint });
}

export function createScriptProfile(genericRenderer: Pick<RendererServices["generic"], "appendJsonCodeBlock">) {
  if (!genericRenderer) throw new Error("script profile generic renderer is required");

  function render(parent: HTMLElement, _args: unknown, result: unknown, originalResult: unknown) {
    const envelope = presentation.getResultEnvelope(originalResult)
      || presentation.getResultEnvelope(result);
    const value = envelope && Object.prototype.hasOwnProperty.call(envelope, "result")
      ? presentation.normalizeFriendlyValue(envelope.result)
      : (result ?? originalResult);
    appendScriptFeedback(parent, envelope);
    if (value === undefined || value === null || value === "") {
      presentation.appendCompactLine(parent, {
        title: t("noReturnValue"),
        subtitle: t("theScriptRanWithoutAReturnValueOrReturned"),
      });
      return true;
    }
    genericRenderer.appendJsonCodeBlock(parent, "result", value);
    return true;
  }

  return { render };
}
