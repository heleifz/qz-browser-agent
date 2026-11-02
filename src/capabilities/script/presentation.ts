import { t } from "./i18n.js";
import { getResultEnvelope } from "#sdk/sidepanel/presentation";
import type { ToolPresentationDefinition } from "#sdk/sidepanel";
import type { RendererServices } from "#sdk/sidepanel";
import { isToolResultErrorLike, isPageContextToolName } from "#sdk/sidepanel/presentation";

export const presentations = (host: RendererServices): readonly ToolPresentationDefinition[] => ["run_script", "script"].map(id => ({
  id,
  resultIsError: ({ result }) => {
    const envelope = getResultEnvelope(result);
    return envelope?.ok === true && !isToolResultErrorLike(envelope) ? false : undefined;
  },
  argsSummary: ({ tool, args, result }) => {
    if (!isPageContextToolName(tool)) return undefined;
    const drive = String(tool.runId || "").startsWith("drive-");
    const page = result && typeof result === "object" ? result as Record<string, unknown> : {};
    // A script's returned title/url are user data, not the page it executed on.
    const target = host.pageDisplayTarget(args, drive ? { _pageTitle: page._pageTitle, _pageUrl: page._pageUrl } : result, {
      maxLength: 42, fallbackToTabId: drive, fallbackLabel: drive ? "" : t("currentPage"),
    });
    return target ? `(${target})` : "";
  },
  timelineBadge: () => ({ label: t("script"), order: 40 }),
  describeRun: ({ args, surface }) => String(args.target || "").trim().toLowerCase() === "inner"
    ? surface === "timeline" ? t("executeInternalCode") : t("executeInternalScript")
    : surface === "timeline" ? t("executeCode") : t("executePageScript"),
  compactParams: ({ args }) => { const { code: _, ...rest } = args; return rest; },
}));
