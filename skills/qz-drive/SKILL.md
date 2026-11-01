---
name: qz-drive
description: Operate the already connected browser with qingzhou_execute_tool or qz exec. Use when the current browser should be driven directly and qz should not plan the task or configure a model.
---

用 qingzhou_execute_tool 操作已经连接的浏览器。不要配置轻舟模型，不要调用 qz create。独立的打开和阅读放进同一次 calls。元素用 uid: 或 css:。同一站点已有 Skill 时先 load_skill。文档用 qingzhou-documents。报错时把工具返回的那一句原样告诉用户。

并行时每路用自己的 sessionId。不传 sessionId 时，这一条 MCP 连接共用一个新的 id。`qz exec` 不传则会新建会话，结果里带 sessionId，之后的调用带上它。

如果没有 qingzhou_execute_tool，用 `qz exec` 传同一份 JSON。stdin 写法是 `qz exec <<'JSON'`。stdout 是 JSON。

Use the browser to open and read every page. Do not use curl or wget to fetch page content. bash remains available only for local files.
