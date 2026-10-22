# 轻舟精选评测集（qingzhou-eval-v0.1）

第一期能力 benchmark：约 30 题精选集，用于发版前必跑与版本间对比。  
**不做 WebArena / BrowserGym 自托管。**

本地路径（box）：`/workspace/qingzhou-benchmark/`  
仓库路径（fork）：`benchmarks/qingzhou/`  
当前版本：**0.1.1**（全量复核，32 ready）。

## 原则

调研 → 收集 → 验证 → 思考 → 抽象。决策靠数据：先有可重复测量，再谈成功率门槛。

## 配额（v0.1.1）

| 块 | 数量 | 说明 |
|---|---|---|
| Online-Mind2Web | 14 | 主集；website 来自公开镜像 join；不可达站已替换 |
| WebVoyager | 8 | 含 2 道 compare；时效题已改写 |
| 自建 | 10 | 表单梯度、iframe、Shadow DOM、批量分页、Skill 对、多源对比 |
| **合计** | **32** | 全部 `status=ready` |

随机种子：`SEED=20261023`。审计见 `datasets/opensource/sampling_audit.json`。

## 五类核心覆盖

| core_task | 题数 | 含 hard |
|---|---|---|
| research（调研整理） | 19 | 是 |
| compare（多源对比） | 4 | 是（含双 Wikipedia） |
| form_fill（表单填写） | 5 | 是（多页 hard） |
| batch_collect（批量采集） | 2 | 是（分页） |
| skill_reuse（Skill 复用） | 2 | 中等（成对 a→b） |

## 成本与跑法

- 单模型；并行 ≤ 3。
- 发版前必跑精选（仅 ready）；重大改动可加跑。
- 报告：总分 + 分来源 + 分五类 + 失败桶；带评测集版本、扩展 commit、模型、时间戳。
- 标了 `temporal` / `price_sensitive` 的题按直播页判分。
- 暂不定成功率门槛数字。

## 数据来源与许可

- **WebVoyager**：Apache-2.0。官方 `data/WebVoyager_data.jsonl`。
- **Online-Mind2Web**：数据 CC BY 4.0。HF `osunlp/Online-Mind2Web` **仍 gated**。v0.1.1 用公开第三方镜像恢复 `website`（见 `om2w_website_join.json` provenance）。有 HF 权限后应下载官方 JSON 做校验。
- **自建**：内部题；演示站 the-internet.herokuapp.com、books.toscrape.com、Wikipedia。

## 如何重建

```bash
cd benchmarks/qingzhou   # 或 /workspace/qingzhou-benchmark
./scripts/fetch_sources.sh   # 下载 raw/（不提交）
# website join 已提交：datasets/opensource/om2w_website_join.json
```

不要把 `raw/` 下全量开源数据提交进 git。

## 文件

- `manifest.json` — 精选清单汇总（version 0.1.1）
- `schema.json` — 统一任务字段（含 `compare`）
- `datasets/opensource/*.jsonl` — 开源精选
- `datasets/opensource/om2w_website_join.json` — OM2W website 回填子集
- `datasets/opensource/sampling_audit.json` — 抽样/替换/改写审计
- `datasets/self/self_curated.jsonl` — 自建
- `STATUS.md` — 卡点与待办
- `scripts/` — 下载与抽样

## 与仓库现有 benchmarks 的关系

`tests/benchmarks/` 测渲染/性能，不是任务成功率。本目录是产品侧任务成功率精选集。
