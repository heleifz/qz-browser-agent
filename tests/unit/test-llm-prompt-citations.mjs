import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAgentPrompts } from "../../src/background/agent/prompts.js";
import { buildRunProfile, buildRunProfilePromptSection } from "../../src/background/agent/run-profile.js";
import { formatDynamicContext } from "../../src/background/agent/context.js";
globalThis.chrome ||= {};
const { getToolSchemas } = await import("../../src/background/tools/runtime.js");

for (const language of ["zh-CN", "en"]) {
  const p = getAgentPrompts(language);
  const en = language === "en";
  const system = p.SYSTEM_PROMPT;
  assert.doesNotMatch(system, /qingzhou-documents|qingzhou-management|qingzhou-mcp|skill-workbench|site-skill-author/);
  assert.match(system, en ? /read or verified original-page URLs/ : /已读取或验证过的原始网页 URL/);
  assert.match(system, en ? /clickable definitions `\[\^1\]: \[Page title\]\(URL\)`/ : /可点击定义 `\[\^1\]: \[页面标题\]\(URL\)`/);
  assert.match(system, en ? /Without a linkable URL, omit the footnote/ : /无可链接 URL 则省略 footnote/);
  assert.match(system, en ? /search AI answers as leads; open originals to verify/ : /搜索 AI 答案作为线索，打开原始来源验证/);
  assert.match(system, en ? /data_store, file artifacts, and tool logs by resource names/ : /data_store、文件产物和工具日志用资源名说明/);
  assert.doesNotMatch(system, /#:~:text=|Text Fragment/);

  assert.match(system, en ? /working tab.*Session.*default page target when tabId is omitted/ : /当前任务工作标签页.*当前 Session.*省略 tabId/);
  assert.match(system, en ? /user-visible tab.*active web page.*run start/ : /用户可见标签页.*本轮开始.*active 网页/);
  assert.match(system, en ? /user-created root sessions.*current page.*means this tab/ : /用户创建的 root session.*当前页面.*指此标签页/);
  assert.match(system, /target = "uid:" <element_uid> \| "css:" <css_selector>/);
  assert.match(system, en ? /Session, tab, page, document, and node identity/ : /Session、tab、页面、文档和节点身份/);
  assert.match(system, /scope:"viewport".*uid:\/css:.*scope:"full"/);
  assert.match(system, en ? /fold marker's root or scope:"full"/ : /折叠标记提供的 root 或 scope:"full"/);
  assert.doesNotMatch(system, /depth|actionsLimit|alias/);
  assert.match(system, /navigationPending/);
  assert.match(system, /already_complete/);
  assert.match(system, /selectedFileCount/);
  assert.match(system, en ? /submission, navigation, and tab closing outside run_script/ : /提交、导航、关闭 tab 在 run_script 外/);
  assert.match(system, /expectedValue=row\.data\[field\]/);
  assert.match(system, /revision=row\.revision/);
  assert.match(system, /network\.allowedOrigins/);
  assert.match(system, /timedOut=true.*sessions\/lastMessages\/artifacts/);
  assert.match(system, en ? /Omitted\/nonpositive timeout waits to completion/ : /timeout 省略或非正数等到完成/);
  assert.match(system, en ? /2 hours/ : /2 小时/);
  assert.match(system, en ? /only on explicit user request/ : /仅在用户明确要求时/);
  assert.match(system, en ? /ask_user unless the user explicitly waived confirmation for that scope/ : /默认 ask_user，除非用户已在当前任务明确免除对应范围的确认/);
  assert.match(system, en ? /Do not enter account credentials, bypass verification/ : /不自行填写账号密码、绕过验证/);

  for (const protocol of [p.READING_CAPABILITY_PROTOCOL, p.TEXT_ONLY_READING_CAPABILITY_PROTOCOL]) {
    assert.match(protocol, /get_ax_tree\(\{root:"root"\}\)/);
    assert.match(protocol, en ? /read-only access.*read_article, find_elements, or list_images with an explicit tabId/ : /可只读页面用 read_article、find_elements 或 list_images 显式传 tabId/);
    assert.match(protocol, /act_on_element/);
    assert.match(protocol, en ? /structural changes or an invalid target/ : /页面结构变化或 target 失效后重新观察/);
  }
  assert.match(p.VISUAL_SCREEN_ACTION_RULE, /screenshot\(\{actionable:true\}\)/);
  assert.match(p.VISUAL_SCREEN_ACTION_RULE, /coordinateSpace\.width\/height/);
  assert.match(p.VISUAL_SCREEN_ACTION_RULE, en ? /original pixel coordinates/ : /原始像素坐标/);
  assert.match(p.VISUAL_SCREEN_ACTION_RULE, en ? /effects match expectations.*coordinates are predictable.*viewport is stable/ : /效果符合预期、后续坐标可预测且浏览器视口稳定/);
  assert.match(p.VISUAL_SCREEN_ACTION_RULE, /coordinateBasisReady/);
  assert.match(p.VISUAL_SCREEN_ACTION_RULE, /viewportChange/);
  assert.match(p.VISUAL_SCREEN_ACTION_RULE, /returnScreenshot.*true.*false/);
  assert.match(p.VISUAL_IMAGE_ASSET_PROTOCOL, /read_image\(\{target\}\)/);
  for (const protocol of [p.VISUAL_IMAGE_ASSET_PROTOCOL, p.TEXT_ONLY_IMAGE_ASSET_PROTOCOL]) {
    assert.match(protocol, en ? /before leaving, navigating, or switching tabs/ : /在离开、跳转或切换 tab 前/);
    assert.match(protocol, en ? /same gallery across tabs/ : /跨 tab 继续写入同一图集/);
    assert.match(protocol, en ? /targets unchanged/ : /target.*原样传递/);
    assert.match(protocol, en ? /discovery tab and source domain/ : /发现它的 tab 和来源域/);
  }
  assert.match(p.TEXT_ONLY_IMAGE_ASSET_PROTOCOL, en ? /text evidence is insufficient.*ask the user to choose/ : /文本证据不足.*请用户选择/);
  assert.match(p.TEXT_ONLY_READING_RULE, en ? /without claiming visual inspection/ : /不声称已做视觉检查/);
  const textOnly = system
    .replace(p.MULTIMODAL_CAPABILITY_PROMPT, p.TEXT_ONLY_CAPABILITY_PROMPT)
    .replace(p.READING_CAPABILITY_PROTOCOL, p.TEXT_ONLY_READING_CAPABILITY_PROTOCOL)
    .replace(p.VISUAL_TARGET_TOOL_PROTOCOL, p.TEXT_ONLY_TARGET_TOOL_PROTOCOL)
    .replace(p.VISUAL_IMAGE_ASSET_PROTOCOL, p.TEXT_ONLY_IMAGE_ASSET_PROTOCOL);
  assert.ok(textOnly.includes(p.TEXT_ONLY_READING_CAPABILITY_PROTOCOL));
  assert.ok(textOnly.includes(p.TEXT_ONLY_IMAGE_ASSET_PROTOCOL));
  assert.doesNotMatch(textOnly, /\b(?:screenshot|act_on_screen|read_image|read_image_asset)\b/);
  assert.match(p.COMPACT_SYSTEM_PROMPT, en ? /read-only/ : /只读资料/);
  assert.match(p.COMPACT_USER_PROMPT, en ? /Distinguish plans and attempts from completed work/ : /区分计划、尝试与已完成事项/);
  assert.match(p.COMPACT_USER_PROMPT, /uid.*selector/);

  // Execution detail stays in tool schemas even when removed from the system prompt.
  const tools = new Map(getToolSchemas({ language }).map(({ function: tool }) => [tool.name, tool]));
  const article = tools.get("read_article");
  assert.match(article.parameters.properties.limit.description, /4000.8000.*20000/);
  const screenshot = tools.get("screenshot");
  assert.match(screenshot.parameters.properties.maxWidth.description, /2048.*2 MiB/);
  const screen = tools.get("act_on_screen");
  assert.match(screen.description, /coordinateBasisReady/);
  assert.match(screen.description, en ? /Only true produces an observation screenshot/ : /只有 true 才产生观察截图/);
  assert.match(screen.description, en ? /Without x\/y, no prior screenshot is needed/ : /不带 x\/y 时无需预先截图/);
  const script = tools.get("run_script");
  assert.match(script.parameters.properties.timeout.description, /<= 0.*> 0/);
  assert.match(script.description, /page_context_unavailable/);
  assert.match(script.description, /returnScreenshot:false.*coordinateBasisReady/);
  assert.match(script.description, /mutatesPage:true/);
}

const textOnlyRunProfileSection = buildRunProfilePromptSection({
  session: { kind: "user", canManageSessions: true },
  model: { provider: "test", id: "text-only", trimOldToolResults: true },
  features: { imageInput: false },
});
assert.match(textOnlyRunProfileSection, /单模态策略: 页面观察优先使用/);
assert.doesNotMatch(textOnlyRunProfileSection, /\b(?:screenshot|act_on_screen|read_image|read_image_asset)\b/);
for (const vision of [false, true]) {
  const profile = await buildRunProfile({
    sessionId: `session_${vision}`,
    config: { provider: "test", model: "test", vision, toolCalling: true, contextWindow: 128000, trimOldToolResults: true },
  });
  for (const feature of ["imageInput", "screenshots", "toolImages"]) assert.equal(profile.features[feature], vision);
  for (const name of ["screenshot", "act_on_screen", "read_image"]) assert.equal(profile.tools.disabled.includes(name), !vision);
}
const agentSource = readFileSync(new URL("../../src/background/agent/agent.ts", import.meta.url), "utf8");
assert.match(agentSource, /READING_CAPABILITY_PROTOCOL[\s\S]*TEXT_ONLY_READING_CAPABILITY_PROTOCOL/);
assert.match(agentSource, /VISUAL_TARGET_TOOL_PROTOCOL[\s\S]*TEXT_ONLY_TARGET_TOOL_PROTOCOL/);
assert.match(agentSource, /VISUAL_IMAGE_ASSET_PROTOCOL[\s\S]*TEXT_ONLY_IMAGE_ASSET_PROTOCOL/);
assert.doesNotMatch(agentSource, /VISION_READING_RULE|TEXT_ONLY_READING_RULE/);
const foreignTabContext = formatDynamicContext({
  workingTab: { id: 1, url: "https://owned.test/" },
  userVisibleTab: { id: 2, url: "https://other.test/", ownerSessionId: "other-session", ownedByCurrentTask: false },
});
assert.match(foreignTabContext, /可用 read_article、find_elements 或 list_images 显式传 tabId 查看/);
assert.doesNotMatch(foreignTabContext, /可用 use_tab/);
console.log("Bilingual prompt, observation, citation, and capability contracts passed");
