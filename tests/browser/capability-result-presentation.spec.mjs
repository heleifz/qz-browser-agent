import { expect, test } from "./fixtures.mjs";

test("script renders public errors and preserves error-shaped returned business data in live and exported output", async ({ page }) => {
  await page.goto("/__test_health");
  const results = await page.evaluate(async () => {
    const { renderToolEvent, disposeRendererTree } = await import("/extension/sidepanel/tools/tool-renderer.js");
    const examples = [];
    for (const staticOutput of [false, true]) {
      const root = renderToolEvent({
        name: "run_script", args: { timeout: 10, code: "throw new Error('failure');" },
        result: { code: "SCRIPT_EVALUATION_FAILED", message: "外层执行失败", hint: "检查已执行的动作后重试。", details: { trace: [{ message: "before failure", level: "debug" }] } },
      }, { expanded: true, static: staticOutput });
      document.body.append(root);
      const details = root.querySelector(".tool-details");
      const text = details.textContent;
      const business = renderToolEvent({
        name: "run_script", args: { timeout: 10, code: "return {error:'内层业务数据'}" },
        result: { ok: true, result: { error: "内层业务数据" } },
      }, { expanded: true, static: staticOutput });
      document.body.append(business);
      examples.push({ staticOutput, codeBlocks: details.querySelectorAll(".js-code-block").length,
        codeBeforeError: text.indexOf("运行代码") < text.indexOf("外层执行失败"),
        error: details.querySelector(".tool-error-section")?.textContent || text,
        trace: Boolean(details.querySelector(".tool-script-trace")),
        hint: text.includes("检查已执行的动作后重试。"),
        businessError: Boolean(business.querySelector(".tool-error-section")),
        businessText: business.querySelector(".tool-details").textContent,
      });
      disposeRendererTree(root); root.remove();
      disposeRendererTree(business); business.remove();
    }
    return examples;
  });
  for (const result of results) {
    expect(result.codeBlocks).toBe(1);
    expect(result.codeBeforeError, JSON.stringify(results)).toBe(true);
    expect(result.error).toContain("外层执行失败");
    expect(result.trace).toBe(true);
    expect(result.hint).toBe(true);
    expect(result.businessError).toBe(false);
    expect(result.businessText).toContain("内层业务数据");
    expect(result.error).not.toContain("内层业务数据");
  }
});
