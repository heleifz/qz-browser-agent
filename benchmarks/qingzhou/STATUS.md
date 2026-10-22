# 状态与卡点（2026-10-23，v0.2.2 Skill medium 单页化）

## 已完成

- **30/30 ready**。五类均 5–7 题且各有 easy/medium/hard：
  research 7（2/3/2）· compare 6（2/2/2）· form_fill 6（2/3/1）· batch_collect 6（2/2/2）· skill_reuse 5（2/1/2）。
- 来源：OM2W 8 · WebVoyager 4 · 自建 18。20 题规则自动判，10 题进人工/LLM 清单。
- Skill 复用全部两段式（create → 新会话 reuse，换输入页）。
- **v0.2.1**：替换两道因 create 阶段 context_overflow（~112k）不可跑的 hard Skill（`skill-cat-cheapest`、`skill-author-bio`）；收紧 `skill-books-first5`。
- **v0.2.2**：收紧 medium `self:skill-tag-quotes`——去掉 tag 翻页：
  - create：`/tag/friendship/` 单页（total=5）
  - reuse：`/tag/reading/` 单页（total=7 + 7 作者金标）
  - 原因：love/inspirational 多页翻页与 hard Skill 同源溢出风险
- 最小执行器 `scripts/run_eval.py` + 判分 `scripts/judge.py`；`results/` 已 gitignore。

## 试跑（product-expert，Grok）

### run `20261023-skill-v021`（hard/easy Skill）
| 题 | 结果 | 说明 |
|---|---|---|
| self:skill-cat-cheapest (hard) | **pass** 42.6s | create~38k / reuse~28k；无 overflow |
| self:skill-author-bio (hard) | **pass** 46.6s | create~44k / reuse~37k；无 overflow |
| self:skill-books-first5 (easy) | **pass** 51.3s | 收紧后通过；create_skill saved 但 index 偶发未刷名，judge 按 tool_saved 放行 |

### run `20261023-skill-v022`（medium Skill）
| 题 | 结果 | 说明 |
|---|---|---|
| self:skill-tag-quotes (medium) | **pass** 38.4s | create 仍报 context_overflow(~112k) 但 Skill 已保存；reuse~29k tokens，金标 total=7 + 7 作者命中；judge 按 tool_saved + reuse 金标放行 |

**scoreboard（v022）**：1/1 pass，auto_pass_rate=1.0。

**观察（仅记录，未提研发）**
1. 短页 +「先写短 Skill」后，多数 Skill create 落在 ~28–44k；但 product-expert 上堆积的历次 `qzb-*` Skill（本轮 create 结束时 index 已有 6 个非内置）仍可能把 create 顶到 112k 溢出线——单页化不能单独消掉该风险。
2. `create_skill` 仍偶发「saved=true 但 skills list 无新名」或「create 会话 overflow 但 Skill 已写入」；runner/judge 已用 tool_saved / skills_new_or_updated 兜底。
3. CLI 无 Skill 删除命令；全量基线前建议在扩展 UI 手动清掉试跑残留 `qzb-*`。

## 仍须注意

1. `temporal` 题（`wv:Apple--2`）按直播页判分。
2. 表单题 v0 判 agent 的回读行，DOM 状态校验待做（不阻塞可跑/可判分）。
3. HF 官方 OM2W JSON 有权限后与镜像 diff。

## 下一步

1. **首轮全量基线**（需用户点头再跑，成本约 30 题 × 单模型；建议先清 `qzb-*` 残留）。
2. 用户同意后再把 Skill 上下文 / 同名覆盖观察交研发。
