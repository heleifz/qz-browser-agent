# 状态与卡点（2026-10-23）

## 已完成

- WebVoyager 6 题精选，官方 website，status=ready。
- 自建 8 题，演示 URL 已 curl 核验 200，status=ready。
- Online-Mind2Web 18 题：有 task_id 与题面（来自公开 human_label.json），可复现抽样。
- schema / manifest / 抽样种子与脚本。

## 卡点

1. **HF gated**：`osunlp/Online-Mind2Web` 需登录并接受条款。未授权时无法下载含官方 `website` / `reference_length` 的 `Online_Mind2Web.json`。
2. **因此 18 道 OM2W 题中**：多数 `start_url` 为空（`website_status=missing_hf_gated`），少数为关键词推断（`inferred_pending_verify`），**不能当作已可跑的正式门禁题**，直到回填官方 website。
3. **未实现**：评测执行器（`npm run benchmark -- task-success`）——本目录只建题集与规格。

## 下一步

1. 用有权限的账号：`huggingface-cli download osunlp/Online-Mind2Web Online_Mind2Web.json`
2. 按 `source_task_id` join 回填 `start_url`，将 status 改为 ready。
3. 技术主管：推送分支 `product/benchmark-v0`（若本环境未推成功）。
