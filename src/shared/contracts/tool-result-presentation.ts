/** Host-owned presentation travels beside a tool's business result. */
export interface ToolResultPresentation {
  _pageTitle?: string;
  _pageUrl?: string;
  _pageContext?: Readonly<Record<string, string | number | boolean>>;
  _display?: unknown;
  _plugin?: unknown;
}

const presentations = new WeakMap<object, ToolResultPresentation>();

export function getToolResultPresentation(result: unknown): ToolResultPresentation {
  return result && typeof result === "object" ? presentations.get(result) || {} : {};
}

export function bindToolResultPresentation<T>(result: T, presentation: ToolResultPresentation): T {
  if (result && typeof result === "object") {
    presentations.set(result, { ...getToolResultPresentation(result), ...presentation });
  }
  return result;
}

export function copyToolResultPresentation<T>(source: unknown, target: T): T {
  return bindToolResultPresentation(target, getToolResultPresentation(source));
}
