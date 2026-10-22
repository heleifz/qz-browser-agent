// Per-locale example lists. Detail pages, homepage cards, and translations
// are generated from this file. Paths are relative to the website root.
//
// An entry needs `slug` and `file` (the session export). `video` is an optional
// mp4. `poster` is an optional image; with a video and no poster, the generator
// extracts a frame. `posterTime` is the extract point in seconds (default 1).
// `title` and `summary` override the session title and the first user message.
//
// fallback: while a locale list is empty, the homepage shows that locale's
// cards from locales[fallback], using fallbackCopy for the empty locale.
// The cards link to the fallback locale's pages. One flag, read only here.
window.QZ_EXAMPLES = {
  storeUrl: "https://chromewebstore.google.com/detail/dknbdgkgoinlgjpfebapkklbmjjgdblm",
  fallback: "zh",
  copy: {
    en: {
      nav: "Examples",
      title: "Real tasks, start to finish.",
      lede: "Each example is a real qz session. The frame on the left is from that session. Follow every step on the right, then import it into qz and pick up the conversation.",
      open: "Open example",
      back: "All examples",
      kind: "Session export",
      download: "Import into qz to continue",
      chrome: "Add to Chrome",
      thread: "Exported conversation",
      missing: "This session export is not on the site yet.",
    },
    "zh-CN": {
      nav: "例子",
      title: "真实任务，完整过程。",
      lede: "每个例子都是轻舟的一次真实会话。左边是这次会话自己的画面，右边是它每一步怎么想、怎么做；导入轻舟，就能接着这段对话继续问。",
      open: "打开例子",
      back: "全部例子",
      kind: "会话导出",
      download: "导入轻舟继续对话",
      chrome: "添加到 Chrome",
      thread: "导出的对话",
      missing: "这份会话导出还没有放进站点。",
    },
  },
  fallbackCopy: {
    en: {
      travel: {
        title: "Three days in Hangzhou",
        summary: "Checks sights, hours, and tickets, then merges them into a day-by-day plan.",
        alt: "Three-day Hangzhou route from the session",
      },
      "llm-compare": {
        title: "Model comparison",
        summary: "Reads several model sites and builds one comparison table.",
        alt: "Comparison table saved from several model pages",
      },
      arxiv: {
        title: "Paper table → Skill",
        summary: "Builds an arXiv paper table, then saves it as a reusable Skill in one sentence.",
        alt: "Paper table and saved Skill from the briefing",
        sessionAlt: {
          reuse: "This week's papers retrieved with the saved Skill",
        },
        related: { first: "First run", reuse: "A week later" },
      },
      "github-weekly": {
        title: "Open-source weekly",
        summary: "Sub-tasks read open-source projects in parallel and sum it up in a weekly report.",
        alt: "Weekly report assembled from open-source projects",
      },
    },
  },
  locales: {
    zh: [
      {
        slug: "travel",
        title: "杭州三日游",
        summary: "查景点、开放时间和门票，汇成每日路线表。",
        file: "examples/sessions/travel-zh.html",
        poster: "assets/examples/travel-zh.webp",
        alt: "杭州三日游的行程速览",
      },
      {
        slug: "llm-compare",
        title: "模型对比表",
        summary: "读多个模型的官网，整理成一张对比表。",
        file: "examples/sessions/llm-compare-zh.html",
        poster: "assets/examples/llm-compare-zh.webp",
        alt: "多站对比后落成的模型表",
      },
      {
        slug: "arxiv",
        session: "first",
        title: "论文表 → Skill",
        summary: "整理一张 arXiv 论文表，一句话存成 Skill，下次直接复用。",
        file: "examples/sessions/arxiv-skill-zh.html",
        poster: "assets/examples/arxiv-zh.webp",
        alt: "Browser Agent 论文速览的论文表与 Skill",
        related: [{ slug: "arxiv-reuse", id: "reuse", label: "一周后再用" }],
      },
      {
        slug: "arxiv-reuse",
        group: "arxiv",
        session: "reuse",
        card: false,
        title: "论文表 → Skill",
        summary: "整理一张 arXiv 论文表，一句话存成 Skill，下次直接复用。",
        file: "examples/sessions/arxiv-skill-reuse-zh.html",
        poster: "assets/examples/arxiv-reuse-zh.webp",
        alt: "用已保存的 Skill 检出的本周论文表",
        related: [{ slug: "arxiv", id: "first", label: "第一次跑" }],
      },
      {
        slug: "github-weekly",
        title: "开源项目周报",
        summary: "几个子任务并行读开源项目动态，汇总成一份周报。",
        file: "examples/sessions/github-weekly-zh.html",
        poster: "assets/examples/github-weekly-zh.webp",
        alt: "读完开源项目后交上的周报",
      },
    ],
    en: [],
  },
};
