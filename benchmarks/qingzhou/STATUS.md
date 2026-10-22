# 状态与卡点（2026-10-23，v0.1.1 全量复核）

## 已完成

- **32/32 ready**（pending_website = 0）。
- Online-Mind2Web **14** 题：官方 `website` / `reference_length` / `level` 已从**公开第三方镜像**回填（见 `datasets/opensource/om2w_website_join.json` 与 sampling_audit）。HF `osunlp/Online-Mind2Web` 仍 gated，有权限后应改回官方文件校验。
- WebVoyager **8** 题：补 2 道 compare；3 道时效题已改写协议。
- 自建 **10** 题：补 hard 表单、分页批量、多源对比；收紧 Skill / Shadow DOM 判分。
- 五类核心均有题，且含 hard：`research` / `compare` / `form_fill` / `batch_collect` / `skill_reuse`。
- 难度分布约 easy 10 / medium 14 / hard 8。

## 本轮替换与改写（摘要）

| 动作 | 说明 |
|---|---|
| 丢弃 OM2W | stubhub / mayo / drugs / united / mta / jcpenney / bestbuy / thumbtack（403、000 或过脆） |
| 新增 OM2W | Apple MacBook Air、Apple Watch 对比、NVIDIA HGX 驱动、arXiv RL 日期窗 |
| OM2W 更新 | Ticketmaster / recreation.gov / medicare / eventbrite / AKC obedience 等用镜像刷新题面 |
| WV 改写 | ArXiv「昨天」、Google「最新新闻」、ESPN「过去一周」→ 可复现的 live 判分协议 |
| WV 新增 | Apple--2、GitHub--29（compare） |
| 自建新增 | form-inputs-hard、batch-pages、compare-multi |
| 自建丢弃 | parallel-smoke（非五类支柱） |

细节见 `datasets/opensource/sampling_audit.json`。

## 仍须注意（非阻塞）

1. 部分题标了 `temporal` / `price_sensitive`：门禁应 **对直播页判分**，不要冻黄金答案。
2. Amazon / Coursera / 票务 / 金融站可能对数据中心 IP 限流或出验证码；失败记桶，不单算模型能力。
3. HF 官方 JSON 仍建议在有权限时做一次 diff，确认镜像与官方一致。
4. 评测执行器（`npm run benchmark -- task-success`）尚未实现——本目录仍是题集与规格。

## 下一步（产品侧）

1. 用 `product-expert`（本机轻舟 + Grok）抽 2–3 道难题试跑，写入结果目录（不阻塞题集入库）。
2. 用户同意后再把题集规格交给研发；**未经同意不提研发需求**。
