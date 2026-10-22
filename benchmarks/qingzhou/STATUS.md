# 状态与卡点（2026-10-23，v0.2.1 Skill 溢出改写）

## 已完成

- **30/30 ready**。五类均 5–7 题且各有 easy/medium/hard：
  research 7（2/3/2）· compare 6（2/2/2）· form_fill 6（2/3/1）· batch_collect 6（2/2/2）· skill_reuse 5（2/1/2）。
- 来源：OM2W 8 · WebVoyager 4 · 自建 18。20 题规则自动判，10 题进人工/LLM 清单。
- Skill 复用全部两段式（create → 新会话 reuse，换输入页）。
- **v0.2.1**：替换两道因 create 阶段 context_overflow（~112k）不可跑的 hard Skill：
  - `self:skill-category-summary` → `self:skill-cat-cheapest`（Philosophy 单页 create → Music 单页 reuse；count+cheapest；金标 count=13 / Orchestra of Exiles / 12.36）
  - `self:skill-wiki-designers` → `self:skill-author-bio`（quotes.toscrape 短作者页；Einstein create → Austen+Rowling 表）
  - 收紧 `self:skill-books-first5`：明确先写短 Skill、只要 title+price、禁止反复 load_skill
- 最小执行器 `scripts/run_eval.py` + 判分 `scripts/judge.py`；`results/` 已 gitignore。

## 试跑（product-expert，Grok，run `20261023-skill-v021`，Asia/Shanghai）

| 题 | 结果 | 说明 |
|---|---|---|
| self:skill-cat-cheapest (hard) | **pass** 42.6s | create~38k / reuse~28k tokens；无 overflow；reuse 金标命中 |
| self:skill-author-bio (hard) | **pass** 46.6s | create~44k / reuse~37k tokens；无 overflow；表 2 行金标命中 |
| self:skill-books-first5 (easy) | **pass** 51.3s | 收紧后通过；create_skill saved 但 index 未刷新新名（疑似同名前缀覆盖），judge 按 tool_saved 放行 |

**scoreboard**：3/3 pass，auto_pass_rate=1.0，failure_buckets 空（无 context_overflow）。

**观察（仅记录，未提研发）**
1. 短页 +「先写短 Skill、禁止反复 load_skill」后，Skill create 阶段 prompt tokens 落在 ~28–44k，远低于先前 112k 溢出线。
2. `create_skill` 仍偶发「saved=true 但 skills list 无新名」（books-first5）；runner/judge 已用 tool_saved 兜底。

## 仍须注意

1. `temporal` 题按直播页判分。
2. 表单题 v0 判 agent 的回读行，DOM 状态校验待做。
3. HF 官方 OM2W JSON 有权限后与镜像 diff。
4. 历次试跑会在 product-expert 留下 `qzb-*` Skill；CLI 无删除命令，需手动清理。
5. medium `self:skill-tag-quotes` 仍含 tag 页翻页，本轮未重跑；若全量基线再溢出再收紧。

## 下一步

1. 首轮全量基线（需用户点头再跑，成本约 30 题 × 单模型）。
2. 用户同意后再把 Skill 上下文 / 同名覆盖观察交研发。
