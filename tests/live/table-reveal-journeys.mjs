import { runStreamUiJourneys } from "./stream-ui-journeys.mjs";

const format = "请实际打开并读取来源页面，再用中文给出建议。最终回答先写约 300 字背景，再用 Markdown 表格对照（至少 6 行），再写约 1000 字的具体建议和带链接的脚注来源。不要在工具执行前输出长说明。";

export const tableRevealScenarios = [
  { id: "public-python-storage", width: 430, theme: "dark", required: ["csv", "json", "sqlite3"], tools: ["open_tab", "read_article"], table: true,
    prompt: `我正在选小型库存系统的数据存储格式。阅读 https://docs.python.org/3/library/csv.html、https://docs.python.org/3/library/json.html 和 https://docs.python.org/3/library/sqlite3.html，比较 CSV、JSON 和 SQLite 的类型、更新方式、事务、导出和适用规模。${format}` },
  { id: "public-css-layout", width: 360, theme: "light", required: ["grid", "flex"], tools: ["open_tab", "read_article"], table: true,
    prompt: `我要做一个窄屏图片素材管理界面。读取 https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_grid_layout 和 https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_flexible_box_layout，对比 Grid 与 Flexbox，并给出缩略图网格和工具栏的布局建议。${format}` },
  { id: "public-http-cache", width: 560, theme: "dark", required: ["Cache-Control", "ETag"], tools: ["open_tab", "read_article"], table: true,
    prompt: `我需要给一个包含用户资料和公共图片的网站设置缓存。读取 https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Caching，对比 no-store、no-cache、private、public、max-age 和 immutable，说明 ETag 如何配合。${format}` },
];

export function runTableRevealJourneys(options) {
  return runStreamUiJourneys({ ...options, scenarios: tableRevealScenarios });
}
