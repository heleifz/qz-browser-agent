# 状态与卡点（2026-10-23，v0.2.5；首轮全量基线已完成）

## 首轮全量基线（2026-10-23，Grok 4.7，并发 3）

- run `20261023-baseline-grok47`（重跑 `20261023-baseline-grok47-retry1`），详见 [`baselines/2026-10-23-grok-4.7.md`](baselines/2026-10-23-grok-4.7.md) / `.json`。
- **首跑 29/30 = 96.7%**；含 1 次基础设施重跑 30/30。
- 五类首跑：research 7/7 · compare 5/6 · form_fill 6/6 · batch_collect 6/6 · skill_reuse 5/5；难度：easy 10/10 · medium 11/11 · hard 8/9。
- 唯一失败：`om2w:1b867…`（AHR 对比图，hard）context_overflow（反复截图 + 隐藏 sticky 头，112,179/112,000）；重跑 58s pass。
- 8 道 human/llm_judge 题由执行 agent 按 transcript + 金标人工判，全部 pass（理由逐题记录）。
- 成本：qz 只暴露末次调用 usage，首跑成本区间 $0.94（下界）～$21（粗略上界）。
- 题目问题（只记录未改）：SmartAsset 题 taxable/household 歧义；HGX 金标版本漂移（595→615）；arxiv「top results」标准模糊；GitHub pricing 需登录。另：自建题天花板效应明显，区分度不足。

## 已完成

- **30/30 ready**。五类均 5–7 题且各有 easy/medium/hard：
  research 7（2/3/2）· compare 6（2/2/2）· form_fill 6（2/3/1）· batch_collect 6（2/2/2）· skill_reuse 5（2/1/2）。
- 来源：OM2W 7 · WebVoyager 4 · 自建 19。21 题规则自动判，9 题进人工/LLM 清单。
- Skill 复用全部两段式（create → 新会话 reuse，换输入页）。
- **v0.2.1**：替换两道因 create 阶段 context_overflow（~112k）不可跑的 hard Skill（`skill-cat-cheapest`、`skill-author-bio`）；收紧 `skill-books-first5`。
- **v0.2.2**：收紧 medium `self:skill-tag-quotes`——去掉 tag 翻页（friendship/reading 单页）。
- **v0.2.3**：`om2w:…medicare…`（medicare.gov 从 box egress 稳定 403 / Akamai）→ `self:form-httpbin-pizza-001`（httpbin 多字段 pizza 表单，rule 判分）。
- **v0.2.4**：`self:shadowdom-001` 金标过时——页面两处 `<my-paragraph>` 均填充 slot，模板默认文案 `My default text` 不可见；试跑 `20261023-smoke-challenge-v023` 因缺该串判 fail，实为可见文案（`Let's have some different text!` / `In a list!`）。已改写题面与 `must_include`，复跑 `20261023-shadow-v024` **pass**（18.9s）。
- **v0.2.5**（用户拍板方案 A）：`om2w:…b4aa7315…`（Find HGX H100 driver）`start_url` 从 `https://www.nvidia.com/` 改为 `https://www.nvidia.com/en-us/drivers/`，避开根域 → `nvidia.cn` 跳转；题面与 human 判分标准不变。
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

### run `20261023-043805-40dfdc`（medium form_fill，v0.2.3）
| 题 | 结果 | 说明 |
|---|---|---|
| self:form-httpbin-pizza-001 (medium) | **pass** 28.6s | httpbin pizza 多字段（radio/checkbox/submit）回读完整；rule must_include 全命中；working_url=`/post` |

### run `20261023-smoke-challenge-v023`（未测挑战抽检）
| 题 | 结果 | 说明 |
|---|---|---|
| self:compare-multi-001 (hard) | **pass** 14.6s | Python+JS 多源表；金标全命中 |
| self:form-inputs-hard-001 (hard) | **pass** 32.1s | 多页 inputs→dropdown→checkboxes→login 回读格式正确 |
| self:shadowdom-001 (medium) | **fail**（金标过时） | 缺 `My default text`；页面 slot 已覆盖默认文案 → 触发 v0.2.4 改写 |

### run `20261023-shadow-v024`（v0.2.4 复验）
| 题 | 结果 | 说明 |
|---|---|---|
| self:shadowdom-001 (medium) | **pass** 18.9s | 新金标可见行全命中 |

### run `20261023-challenge-v024`（未测挑战 rule 抽检）
| 题 | 结果 | 说明 |
|---|---|---|
| self:compare-books-categories-001 (medium) | **pass** 76.7s | Travel/Poetry 多源对比；金标 count/cheapest/more_books 全命中；线上金标复核一致 |
| self:batch-mystery-001 (hard) | **pass** 47.9s | Mystery 分类 2 页共 32 本；`total=32` + cheapest `Tastes Like Fear` £10.69；table_rows=32 |
| self:skill-login-check (easy) | **pass** 91.2s | create 存 `qzb-login-check-*`；reuse 命中 `Your password is invalid!` 且引用 Skill |

### run `20261023-nvidia-v025`（v0.2.5 HGX 方案 A）
| 题 | 结果 | 说明 |
|---|---|---|
| om2w:b4aa7315… (hard research) | **completed** 197.6s（human 可判 pass） | 自 `en-us/drivers/` 到达 datacenter release notes；回报 **595.112.07** + HGX H100 + Ubuntu 22.04 + x86_64；working_url=`docs.nvidia.com/.../tesla-release-notes-595-112-07/`；未落 CN |

**观察（仅记录，未提研发）**
1. 短页 +「先写短 Skill」后，多数 Skill create 落在 ~28–44k；但 product-expert 上堆积的历次 `qzb-*` Skill 仍可能把 create 顶到 112k 溢出线。
2. `create_skill` 仍偶发「saved=true 但 skills list 无新名」或「create 会话 overflow 但 Skill 已写入」；runner/judge 已用 tool_saved / skills_new_or_updated 兜底。
3. CLI 无 Skill 删除命令；全量基线前建议在扩展 UI 手动清掉试跑残留 `qzb-*`。
4. medicare.gov 在评测 egress 上稳定 403，开源 OM2W 表单题需自建可判替身（httpbin）。
5. the-internet Shadow DOM demo 的可见文案依赖 slot 填充；金标需按渲染结果而非 template 默认值。
6. Skill reuse 偶发 `PAGE_CONTEXT_UNAVAILABLE`（skill 工具挂不上页），agent 手工复现流程仍能过金标；判分按引用 Skill + 金标放行。
7. **nvidia.com 地理跳转（已处理）**：根域 → CN；方案 A 直连 `en-us/drivers/` 保持 EN 驱动查找页。

## 仍须注意

1. `temporal` 题（`wv:Apple--2`）按直播页判分。
2. 表单题 v0 判 agent 的回读行，DOM 状态校验待做（不阻塞可跑/可判分）。
3. HF 官方 OM2W JSON 有权限后与镜像 diff。
4. 多数此前未测的 rule 挑战题本轮已抽检过；剩余未小规模试跑的 rule/WV 可随全量基线覆盖。

## 下一步

1. ~~首轮全量基线~~ 已完成（见上）。下一轮前清理 product-expert 上本轮新增的 `qzb-*-bef4a7` 5 个 Skill。
1b. 产品侧候选（待用户定）：加难自建题 / 提高真实站占比以解决天花板效应；评测器补累计 token/成本采集；Skill 题 create 判定在并发下改为只看本题前缀。
2. 用户同意后再把 Skill 上下文 / 同名覆盖 / PAGE_CONTEXT_UNAVAILABLE 观察交研发。
