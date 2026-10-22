// One list of website examples. Detail pages, homepage cards, and translations
// are generated from this file. Paths are relative to the website root.
window.QZ_EXAMPLES = {
  storeUrl: "https://chromewebstore.google.com/detail/dknbdgkgoinlgjpfebapkklbmjjgdblm",
  copy: {
    en: {
      nav: "Examples",
      title: "Watch it run once, then import it and run it yourself.",
      lede: "Four session exports from 轻舟（qz）. Open one to see the result, download the file, and import it locally.",
      open: "Open example",
      back: "All examples",
      kind: "Session export",
      download: "Download the session and import it into qz",
      downloadHint: "After downloading, open the file in Chrome and click the import button on the page.",
      fileHint: "Before opening a <code>file://</code> URL, turn on “Allow access to file URLs” in the qz details at <code>chrome://extensions</code>.",
      chrome: "Add to Chrome",
      play: "Play",
      thread: "Exported conversation",
      missing: "This session export is not on the site yet.",
    },
    "zh-CN": {
      nav: "例子",
      title: "看它干一遍，再导入自己跑",
      lede: "四份来自轻舟（qz）的会话导出。打开看结果，下载文件，在本地导入。",
      open: "打开例子",
      back: "全部例子",
      kind: "会话导出",
      download: "下载会话，导入轻舟",
      downloadHint: "下载后用 Chrome 打开文件，点页面里的导入按钮。",
      fileHint: "用 <code>file://</code> 打开前，先在 <code>chrome://extensions</code> 的轻舟详情里打开「允许访问文件网址」。",
      chrome: "添加到 Chrome",
      play: "播放",
      thread: "导出的对话",
      missing: "这份会话导出还没有放进站点。",
    },
  },
  items: [
    {
      slug: "travel",
      title: { en: "Three days in Hangzhou", "zh-CN": "杭州三日游" },
      summary: { en: "A Hangzhou itinerary, researched in parallel.", "zh-CN": "并行查出杭州行程" },
      cover: {
        src: "assets/examples/travel.webp",
        width: 840,
        height: 1544,
        alt: {
          en: "Parallel tasks researching a Hangzhou itinerary",
          "zh-CN": "并行查询杭州行程的任务",
        },
      },
      media: {
        kind: "loop",
        src: "assets/media/parallel.mp4",
        poster: "assets/examples/travel.webp",
        width: 840,
        height: 1544,
        alt: {
          en: "Parallel tasks researching a Hangzhou itinerary",
          "zh-CN": "并行查询杭州行程的任务",
        },
      },
      sessions: [
        { id: "default", file: "examples/sessions/travel-zh.html" },
      ],
    },
    {
      slug: "llm-compare",
      title: { en: "Model comparison", "zh-CN": "模型对比表" },
      summary: { en: "A comparison across sites, saved as one table.", "zh-CN": "多站对比落成一张表" },
      cover: {
        src: "assets/examples/llm-compare.webp",
        width: 1200,
        height: 648,
        alt: {
          en: "Comparison table saved from several model pages",
          "zh-CN": "多站对比后落成的模型表",
        },
      },
      media: {
        kind: "click",
        src: "assets/demo-en.mp4",
        poster: "assets/examples/demo-poster.jpg",
        width: 1280,
        height: 720,
        alt: {
          en: "Cover frame of the qz demo",
          "zh-CN": "轻舟演示的封面帧",
        },
      },
      sessions: [
        { id: "default", file: "examples/sessions/llm-compare-zh.html" },
      ],
    },
    {
      slug: "arxiv",
      title: { en: "Paper table → Skill", "zh-CN": "论文表 → Skill" },
      summary: { en: "A paper table, saved as a Skill.", "zh-CN": "论文表存成 Skill" },
      cover: {
        src: "assets/examples/arxiv.webp",
        width: 840,
        height: 2011,
        alt: {
          en: "Paper table saved from a research run",
          "zh-CN": "检索结果里的论文表",
        },
      },
      media: {
        kind: "click",
        src: "assets/demo-en.mp4",
        poster: "assets/examples/demo-poster.jpg",
        width: 1280,
        height: 720,
        alt: {
          en: "Cover frame of the qz demo",
          "zh-CN": "轻舟演示的封面帧",
        },
      },
      sessions: [
        {
          id: "first",
          file: "examples/sessions/arxiv-skill-zh.html",
          label: { en: "First run", "zh-CN": "第一次跑" },
        },
        {
          id: "reuse",
          file: "examples/sessions/arxiv-skill-reuse-zh.html",
          label: { en: "A week later", "zh-CN": "一周后再用" },
        },
      ],
    },
    {
      slug: "github-weekly",
      title: { en: "Open-source weekly", "zh-CN": "开源项目周报" },
      summary: {
        en: "Several tabs read open-source projects at once, then deliver a weekly report.",
        "zh-CN": "多个 Tab 同时读开源项目，最后交一份周报",
      },
      cover: {
        src: "assets/examples/github-weekly.webp",
        width: 840,
        height: 1426,
        alt: {
          en: "Weekly report assembled from open-source projects",
          "zh-CN": "读完开源项目后交上的周报",
        },
      },
      media: {
        kind: "click",
        src: "assets/demo-en.mp4",
        poster: "assets/examples/demo-poster.jpg",
        width: 1280,
        height: 720,
        alt: {
          en: "Cover frame of the qz demo",
          "zh-CN": "轻舟演示的封面帧",
        },
      },
      sessions: [
        { id: "default", file: "examples/sessions/github-weekly-zh.html" },
      ],
    },
  ],
};
