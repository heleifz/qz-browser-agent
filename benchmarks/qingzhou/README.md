# 轻舟精选评测集（qingzhou-eval-v0.1）

第一期能力 benchmark：约 25–30 题精选集，用于发版前必跑与版本间对比。  
**不做 WebArena / BrowserGym 自托管。**

本地路径（box）：`/workspace/qingzhou-benchmark/`  
仓库路径（fork）：`benchmarks/qingzhou/`

## 原则

调研 → 收集 → 验证 → 思考 → 抽象。决策靠数据：先有可重复测量，再谈成功率门槛。

## 配额（已定）

| 块 | 数量 | 说明 |
|---|---|---|
| Online-Mind2Web | 18（easy 7 / medium 7 / hard 4） | 主集；难度代理见下 |
| WebVoyager | 6 | 辅集；跳过 Booking / Google Flights / Google Map |
| 自建 | 8 | Skill 复用、批量采集、表单、iframe、Shadow DOM、并发冒烟 |
| **合计** | **32** | 略高于 25–30，可接受；全量开源不进门禁 |

随机种子：`SEED=20261023`（OM2W 抽样使用 `SEED+1`）。审计见 `datasets/opensource/sampling_audit.json`。

## 成本与跑法

- 单模型；并行 ≤ 3。
- 发版前必跑精选；重大改动可加跑。
- 报告：总分 + 分来源 + 分五类 + 失败桶；带评测集版本、扩展 commit、模型、时间戳。
- 暂不定成功率门槛数字。

## 数据来源与许可

- **WebVoyager**：Apache-2.0。官方 `data/WebVoyager_data.jsonl` 可公开下载。精选 `start_url` 来自官方字段。
- **Online-Mind2Web**：数据 CC BY 4.0。Hugging Face `osunlp/Online-Mind2Web` **gated**（未登录 HTTP 401）。当前用 GitHub 公开的 `human_label.json` 取 `task_id` + `confirmed_task` 做分层抽样；**官方 `website` 字段缺失**，多数题标 `pending_website` / `partial`。拿到 HF 权限后应用官方 website 回填。
- **自建**：内部题；演示站 URL 已核验 HTTP 200（the-internet.herokuapp.com、books.toscrape.com）。
- **难度代理（OM2W）**：`human_label.json` 中各 agent 标签为 0/1 的成功率 ≥0.7 → easy，≤0.35 → hard，其余 medium（忽略 label=2）。

## 如何重建

```bash
cd benchmarks/qingzhou   # 或 /workspace/qingzhou-benchmark
./scripts/fetch_sources.sh   # 下载 raw/（不提交）
python3 scripts/sample_curated.py
```

不要把 `raw/` 下全量开源数据提交进 git。

## 文件

- `manifest.json` — 精选清单汇总
- `schema.json` — 统一任务字段
- `datasets/opensource/*.jsonl` — 开源精选
- `datasets/self/self_curated.jsonl` — 自建
- `STATUS.md` — 卡点与待补全
- `scripts/` — 下载与抽样

## 与仓库现有 benchmarks 的关系

`tests/benchmarks/` 测渲染/性能，不是任务成功率。本目录是产品侧任务成功率精选集。
