import { validateElementLocator, type ElementLocator } from "./contracts/element-locator.js";

type Arguments = Record<string, unknown>;
type TabRef = string | number;
type PageFunction = string | ((...args: never[]) => unknown);
type CallTool = (name: string, args?: Arguments) => Promise<unknown>;
type ActionOptions = Arguments & { waitFor?: "navigation" | "popup"; waitOptions?: Arguments };

/** Stateless script bindings. Every operation uses the host's normal tool execution path. */
export function createQzSdk(callTool: CallTool) {
  const locators = new WeakMap<object, { tabRef: TabRef; query: ElementLocator }>();
  const invalid = (message: string): never => {
    throw Object.assign(new TypeError(message), { code: "INVALID_ARGUMENTS" });
  };
  function options(value: Arguments = {}, reserved: readonly string[] = []): Arguments {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Pass an options object.");
    for (const key of reserved) {
      if (Object.hasOwn(value, key)) return invalid(`The bound SDK operation does not accept ${key}.`);
    }
    return { ...value };
  }
  function tab(tabRef: TabRef) {
    if (!(typeof tabRef === "string" && tabRef.trim() || typeof tabRef === "number" && Number.isInteger(tabRef) && tabRef > 0)) {
      return invalid("Pass an explicit tabRef returned by openTab/listTabs or its alias.");
    }
    const call = (name: string, args: Arguments = {}) => callTool(name, {
      ...options(args, ["tabRef", "tabId"]), tabRef,
    });
    function locator(input: string | ElementLocator) {
      const query = typeof input === "string" ? { target: input } : { ...input };
      try { validateElementLocator(query); }
      catch (error) {
        throw Object.assign(new TypeError(error instanceof Error ? error.message : String(error)), error, { code: "INVALID_ARGUMENTS" });
      }
      Object.freeze(query);
      const bindingKeys = ["target", "selector", "locator", "index"];
      const boundCall = (name: string, args: Arguments = {}) => call(name, {
        ...options(args, bindingKeys), locator: { ...query },
      });
      function action(name: string, params: Arguments = {}, inputOptions: ActionOptions = {}) {
        const { waitFor, waitOptions, ...rest } = options(inputOptions,
          ["tabRef", "tabId", ...bindingKeys, "action", ...Object.keys(params)]);
        if (waitFor !== undefined && waitFor !== "navigation" && waitFor !== "popup") {
          return invalid("Action waitFor must be navigation or popup.");
        }
        if (waitOptions !== undefined && waitFor === undefined) return invalid("waitOptions requires waitFor.");
        const args = { ...rest, ...params, locator: { ...query }, action: name };
        if (!waitFor) return call("act_on_element", args);
        return call(`wait_for_${waitFor}`, {
          ...(rest.timeout !== undefined ? { timeout: rest.timeout } : {}),
          ...options(waitOptions as Arguments | undefined, ["tabRef", "tabId", "trigger"]),
          trigger: { name: "act_on_element", args: { ...args, tabRef } },
        });
      }
      const element = Object.freeze({
        nth(index: number) { return locator({ ...query, nth: index }); },
        async count() {
          const result = await boundCall("find_elements", { countOnly: true }) as { count: number };
          return result.count;
        },
        click(opts?: ActionOptions) { return action("click", {}, opts); },
        doubleClick(opts?: ActionOptions) { return action("double_click", {}, opts); },
        hover(opts?: ActionOptions) { return action("hover", {}, opts); },
        fill(value: string, opts?: ActionOptions) { return action("fill", { value }, opts); },
        press(key: string, opts?: ActionOptions) { return action("press", { key }, opts); },
        select(value: string, opts?: ActionOptions) { return action("select", { value }, opts); },
        check(opts?: ActionOptions) { return action("check", {}, opts); },
        uncheck(opts?: ActionOptions) { return action("uncheck", {}, opts); },
        scroll(opts?: ActionOptions) { return action("scroll", {}, opts); },
        dragTo(destination: object, opts?: ActionOptions) {
          const end = locators.get(destination);
          if (!end || end.tabRef !== tabRef) return invalid("Drag destination must be a locator bound to the same tabRef.");
          return action("drag", { destination: { locator: { ...end.query } } }, opts);
        },
        wait(opts: Arguments = {}) { return boundCall("wait_for_element", opts); },
        inspect(opts: Arguments = {}) { return boundCall("inspect_element", opts); },
        read(opts: Arguments = {}) {
          return boundCall("read_article", { limit: 4000, ...options(opts, ["source"]), source: "target" });
        },
      });
      locators.set(element, { tabRef, query });
      return element;
    }
    return Object.freeze({
      tabRef,
      locator,
      goto(url: string, opts: Arguments = {}) { return call("navigate", { ...options(opts, ["url"]), url }); },
      read(opts: Arguments = {}) { return call("read_article", { limit: 4000, ...opts }); },
      find(opts: Arguments = {}) { return call("find_elements", opts); },
      axTree(opts: Arguments = {}) { return call("get_ax_tree", opts); },
      screenshot(opts: Arguments = {}) { return call("screenshot", opts); },
      evaluate(code: PageFunction, args?: unknown, opts: Arguments = {}) {
        return call("evaluate", { ...options(opts, ["code", "args"]), code, ...(args !== undefined ? { args } : {}) });
      },
      close(opts: Arguments = {}) { return call("close_tab", opts); },
      setMode(mode: "desktop" | "mobile", opts: Arguments = {}) {
        return call("set_page_mode", { ...options(opts, ["mode"]), mode });
      },
      waitForURL(urlPattern: string | RegExp, opts: Arguments = {}) {
        const regex = urlPattern instanceof RegExp;
        if (!regex && typeof urlPattern !== "string") return invalid("Pass a URL pattern string or RegExp.");
        const waitOptions = options(opts, ["urlPattern"]);
        if (regex && Object.hasOwn(waitOptions, "flags")) return invalid("Set flags on the RegExp and omit options.flags.");
        return call("wait_for_url", {
          ...waitOptions,
          urlPattern: regex ? urlPattern.source : urlPattern,
          ...(regex ? { flags: urlPattern.flags } : {}),
        });
      },
      waitForLoad(opts: Arguments = {}) { return call("wait_for_load", opts); },
      waitForFunction(code: PageFunction, args?: unknown, opts: Arguments = {}) {
        return call("wait_for_function", { ...options(opts, ["code", "args"]), code, ...(args !== undefined ? { args } : {}) });
      },
    });
  }
  return Object.freeze({
    tab,
    openTab(opts: Arguments) { return callTool("open_tab", options(opts)); },
    listTabs(opts: Arguments = {}) { return callTool("list_tabs", options(opts)); },
    listTools(opts: Arguments = {}) { return callTool("list_tools", options(opts)); },
    call(name: string, args: Arguments = {}) { return callTool(name, options(args)); },
  });
}
