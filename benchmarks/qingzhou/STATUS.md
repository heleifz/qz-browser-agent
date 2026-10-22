# 状态与卡点（2026-10-23，v0.2.0 五类再平衡 + runner）

## 已完成

- **30/30 ready**。五类均 5–7 题且各有 easy/medium/hard：
  research 7（2/3/2）· compare 6（2/2/2）· form_fill 6（2/3/1）· batch_collect 6（2/2/2）· skill_reuse 5（2/1/2）。
- 来源：OM2W 8 · WebVoyager 4 · 自建 18。20 题规则自动判，10 题进人工/LLM 清单。
- Skill 复用全部改为两段式（create → 新会话 reuse，换输入页），判分写明。
- 自建题金标准取自静态沙盒站（books/quotes.toscrape、the-internet、Wikipedia infobox），2026-10-23 核对。
- 最小执行器 `scripts/run_eval.py` + 判分 `scripts/judge.py`；`results/` 已 gitignore。

## 试跑发现（product-expert，Grok）

| 题 | 结果 | 说明 |
|---|---|---|
| self:batch-tables-001 (easy) | pass 13s | runner dry-run |
| self:iframe-001 (medium) | pass 18s | TinyMCE 可编辑 |
| self:batch-einstein-001 (hard) | pass 62s | 10 页扫描，einstein_total=10 |
| self:skill-books-first5 (easy) | 1 fail / 1 pass | 首次 create 后上下文溢出；第二次通过 |
| self:skill-category-summary (hard) | 2/2 fail | create / reuse 均触发「上下文超限 112k」 |
| self:skill-wiki-designers (hard) | fail | create 后上下文溢出 |

**观察（仅记录，未提研发）**
1. Skill 创建/加载链路容易把上下文推过 112k（多次 `load_skill` + skill-author 工具结果各约 6k 字符），4/5 次 Skill 运行死于 `context_overflow`。
2. `create_skill` 回报保存为新名字，但 `skills list` 里看不到该名字，疑似按 displayName 覆盖了旧 Skill（同名前缀的旧技能 updatedAt 被刷新）。

## 仍须注意

1. `temporal` 题按直播页判分。
2. 表单题 v0 判 agent 的回读行，DOM 状态校验待做。
3. HF 官方 OM2W JSON 有权限后与镜像 diff。
4. 历次试跑会在 product-expert 留下 `qzb-*` Skill；CLI 无删除命令，需手动清理。

## 下一步

1. 首轮全量基线（需用户点头再跑，成本约 30 题 × 单模型）。
2. 用户同意后再把上述观察交研发。
