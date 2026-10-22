# 轻舟精选评测集（qingzhou-eval-v0.1）

第一期能力 benchmark：约 30 题精选集，用于发版前必跑与版本间对比。  
**不做 WebArena / BrowserGym 自托管。**

本地路径（box）：`/workspace/qingzhou-benchmark/`  
仓库路径（fork）：`benchmarks/qingzhou/`  
当前版本：**0.2.3**（30 ready；含 runner + judge；medicare→httpbin 表单）。

## 原则

调研 → 收集 → 验证 → 思考 → 抽象。决策靠数据：先有可重复测量，再谈成功率门槛。

## 配额（v0.2.3）

| 块 | 数量 | 说明 |
|---|---|---|
| Online-Mind2Web | 7 | website 来自公开镜像 join |
| WebVoyager | 4 | 2 道调研 + 2 道 compare |
| 自建 | 19 | 确定性沙盒站（books/quotes.toscrape、the-internet、Wikipedia、httpbin），规则判分 |
| **合计** | **30** | 全部 `status=ready`；21 题规则自动判，9 题进人工/LLM 清单 |

## 五类 × 难度

| core_task | easy | medium | hard | 合计 |
|---|---|---|---|---|
| research 调研整理 | 2 | 3 | 2 | 7 |
| compare 多源对比 | 2 | 2 | 2 | 6 |
| form_fill 表单填写 | 2 | 3 | 1 | 6 |
| batch_collect 批量采集 | 2 | 2 | 2 | 6 |
| skill_reuse Skill 复用 | 2 | 1 | 2 | 5 |

Skill 复用题是两段式：`stages[0]=create`（完成任务并存成 Skill，名字含本次运行 tag），`stages[1]=reuse`（新会话、换输入页调用该 Skill）。判分：create 后 `qz skills list` 出现新/更新的非内置 Skill，且 reuse 结果命中金标准、并在回答或工具调用里引用该 Skill。

## 运行（runner）

```bash
cd benchmarks/qingzhou
# 只看计划
python3 scripts/run_eval.py --core skill_reuse --dry-run
# 跑指定题（默认 client=product-expert，可用 --client 或 QZ_BENCH_CLIENT 覆盖）
python3 scripts/run_eval.py --ids self:batch-tables-001,self:iframe-001 -j 2
# 按类/难度
python3 scripts/run_eval.py --core batch_collect --difficulty hard -j 3
# 全量（发版门禁时才用；并发强制 ≤3）
python3 scripts/run_eval.py --all -j 3
# 判分
python3 scripts/judge.py results/<run_id>
```

不带选择器会拒绝运行，防止误跑全量。输出在 `results/<run_id>/`（已 gitignore）：
`run_meta.json`、`summary.jsonl`、`tasks/<id>/stageN_*.json`（完整 transcript、耗时、状态、token/cost、结束页、artifacts）、
`judgments.jsonl`、`scoreboard.json`、`review_queue.md|jsonl`（待人工/LLM 判）。

## 成本与跑法

- 单模型；并行 ≤ 3。
- 发版前必跑精选；重大改动可加跑。
- 标了 `temporal` 的题按直播页判分。
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

- `manifest.json` — 精选清单汇总（version 0.2.3）
- `schema.json` — 统一任务字段（含 `compare`）
- `datasets/opensource/*.jsonl` — 开源精选
- `datasets/opensource/om2w_website_join.json` — OM2W website 回填子集
- `datasets/opensource/sampling_audit.json` — 抽样/替换/改写审计
- `datasets/self/self_curated.jsonl` — 自建
- `STATUS.md` — 卡点与待办
- `scripts/build_curated.py` — 题目定义唯一来源（重建 JSONL + manifest）
- `scripts/run_eval.py` — 执行器
- `scripts/judge.py` — 判分（规则自动判 + 待审清单）
- `scripts/fetch_sources.sh` / `sample_curated.py` — 开源数据下载与 v0.1 抽样（历史）

## 与仓库现有 benchmarks 的关系

`tests/benchmarks/` 测渲染/性能，不是任务成功率。本目录是产品侧任务成功率精选集。
