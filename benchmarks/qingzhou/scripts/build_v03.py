#!/usr/bin/env python3
"""Build qingzhou-eval v0.3 DRAFT task set (design only, not yet run).

Single source of truth for v0.3 task definitions. Writes:
  datasets/v0.3/qingzhou_v03_draft.jsonl
  datasets/v0.3/manifest_v03_draft.json

All tasks are status="draft": run_eval.py skips them unless you pass
--files datasets/v0.3/qingzhou_v03_draft.jsonl --include-not-ready.
Gold values were pulled from the live sites / official APIs on 2026-10-22
(America/New_York) with curl; see each task's `gold_source` and
`drift_policy`. Design doc: docs/v0.3-design.md.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.3.0-draft"
VERIFIED = "2026-10-22"
OM_LIC = "CC BY 4.0 Online-Mind2Web; website from public mirror (datasets/opensource/om2w_website_join.json)"
WV_LIC = "Apache-2.0 (MinorJerry/WebVoyager)"

TASKS: list[dict] = []

# Soft budgets (recorded, not gating). Defaults per difficulty; tasks override.
DEFAULT_BUDGET = {
    "medium": {"max_tool_calls": 20, "max_elapsed_s": 240, "max_screenshots": 4},
    "hard": {"max_tool_calls": 35, "max_elapsed_s": 420, "max_screenshots": 6},
}


def add(**t):
    t.setdefault("locale", "en")
    t.setdefault("requires_login", False)
    t.setdefault("tags", [])
    t.setdefault("status", "draft")
    t.setdefault("temporal", False)
    t.setdefault("license_note", "internal")
    t.setdefault("website_status", f"curl_200_{VERIFIED}")
    t.setdefault("gold_verified_at", VERIFIED)
    b = dict(DEFAULT_BUDGET.get(t["difficulty"], DEFAULT_BUDGET["hard"]))
    b.update(t.pop("budget", {}) or {})
    t["budget"] = b
    t["tags"] = list(dict.fromkeys(t["tags"] + [f"difficulty:{t['difficulty']}", "v0.3"]))
    for k in ["id", "source", "core_task", "prompt", "start_url", "success_criteria", "judge", "timeout_s",
              "difficulty", "hardness", "drift_policy"]:
        assert k in t, (t.get("id"), k)
    TASKS.append(t)


def self_task(sid, core, difficulty, prompt, url, criteria, hardness, drift_policy, gold_source,
              timeout=600, judge="rule", tags=(), budget=None, locale="en", temporal=False, **extra):
    add(id=f"v03:{sid}", source="self", core_task=core, difficulty=difficulty, prompt=prompt, start_url=url,
        success_criteria=criteria, judge=judge, timeout_s=timeout, tags=list(tags), hardness=hardness,
        drift_policy=drift_policy, gold_source=gold_source, budget=budget or {}, locale=locale,
        temporal=temporal, **extra)


def skill(sid, difficulty, name, create_url, create_prompt, reuse_url, reuse_prompt, reuse_check, hardness,
          drift_policy, gold_source, timeout=600, tags=(), budget=None, locale="en"):
    add(id=f"v03:{sid}", source="self", core_task="skill_reuse", difficulty=difficulty,
        prompt=f"[two-stage] create: {create_prompt[:160]} || reuse: {reuse_prompt[:160]}",
        start_url=create_url, judge="rule", timeout_s=timeout, tags=["skill", "two_stage", *tags],
        skill_name=name, hardness=hardness, drift_policy=drift_policy, gold_source=gold_source,
        budget=budget or {"max_tool_calls": 45, "max_elapsed_s": 600, "max_screenshots": 6}, locale=locale,
        stages=[
            {"name": "create", "start_url": create_url, "new_session": True,
             "prompt": (f"{create_prompt}\nWorkflow: FIRST write a SHORT reusable Skill named `{{skill_name}}` "
                        "that takes the input(s) as parameters (keep the Skill body brief; do not load_skill repeatedly "
                        "while drafting). THEN run it once on the input above. Reply with the exact Skill name you "
                        "saved and the result.")},
            {"name": "reuse", "start_url": reuse_url, "new_session": True,
             "prompt": (f"Use the existing Skill `{{skill_name}}` (load it at most once; do not rebuild the workflow "
                        f"from scratch; adapt it only where this site differs). {reuse_prompt} "
                        "End by stating which Skill you used.")},
        ],
        success_criteria={"type": "skill_two_stage", "skill_name": "{skill_name}",
                          "create": {"skill_must_exist": True},
                          "reuse": {**reuse_check, "skill_must_be_referenced": True}})


def om(tid, core, difficulty, prompt, url, criteria, hardness, keep_reason, drift_policy, judge="rule",
       timeout=900, original_prompt="", budget=None, temporal=False):
    add(id=f"om2w-v03:{tid}", source="open:online-mind2web", source_task_id=tid, core_task=core,
        difficulty=difficulty, prompt=prompt, start_url=url, success_criteria=criteria, judge=judge,
        timeout_s=timeout, license_note=OM_LIC, website_status=f"curl_200_{VERIFIED}", hardness=hardness,
        keep_reason=keep_reason, drift_policy=drift_policy, original_prompt=original_prompt,
        budget=budget or {}, tags=["navigation", "control_open_source"], temporal=temporal,
        derived_from=f"om2w:{tid}")


def wv(sid, core, difficulty, prompt, url, criteria, hardness, keep_reason, drift_policy, judge="rule",
       original_prompt="", budget=None, temporal=False):
    add(id=f"wv-v03:{sid}", source="open:webvoyager", source_task_id=sid, core_task=core, difficulty=difficulty,
        prompt=prompt, start_url=url, success_criteria=criteria, judge=judge, timeout_s=600, license_note=WV_LIC,
        hardness=hardness, keep_reason=keep_reason, drift_policy=drift_policy, original_prompt=original_prompt,
        budget=budget or {}, tags=["navigation", "control_open_source"], temporal=temporal,
        derived_from=f"wv:{sid}")


# =============================================================== research 调研整理
self_task(
    "research-python-match-chain", "research", "hard",
    "Research task (stay on official python.org sites: docs.python.org, peps.python.org, www.python.org, devguide.python.org). "
    "Find: (1) the Python version that introduced the `match` statement (structural pattern matching); (2) the number and authors of the "
    "PEP that is its *specification*; (3) the number and author of the separate *tutorial* PEP; (4) that Python version's first release date "
    "(x.y.0) and its end-of-life date as listed in the devguide 'Status of Python versions' table, plus its release-schedule PEP number. "
    "Do not read the full PEP texts; header fields are enough. Finish with exactly one line:\n"
    "version=<x.y>; spec_pep=<n>; spec_authors=<names>; tutorial_pep=<n>; tutorial_author=<name>; first_release=<YYYY-MM-DD>; eol=<YYYY-MM-DD>; schedule_pep=<n>",
    "https://docs.python.org/3/whatsnew/index.html",
    {"type": "must_include",
     "must_include": ["version=3.10", "spec_pep=634", "Brandt Bucher", "Guido van Rossum", "tutorial_pep=636",
                      "Moisset", "first_release=2021-10-04", "eol=2026-10-01", "schedule_pep=619"],
     "must_not_include": ["spec_pep=622"],
     "notes": "PEP 622 was superseded (Replaces: 622) — a model that stops at PEP 622 fails. devguide 3.10 row: end-of-life 2026-10-01."},
    hardness="长链路 4 站 8 跳；需区分 spec/tutorial/被替代 PEP（622 陷阱）；devguide 表格读数",
    drift_policy="全部为已发布历史事实（3.10 已 EOL），预期不漂移；devguide 若改 EOL 日期需复核",
    gold_source="peps.python.org/pep-0634, pep-0636; devguide.python.org/versions (curl 2026-10-22)",
    tags=["multi_hop", "cross_site", "table_read", "trap"], budget={"max_tool_calls": 25, "max_elapsed_s": 300})

self_task(
    "research-nobel-advisor-chain", "research", "hard",
    "Use English Wikipedia only. For each of the three 2001 Nobel Prize in Physics laureates (Eric Cornell, Wolfgang Ketterle, Carl Wieman), "
    "follow the 'Doctoral advisor' field in the infobox upward (advisor, then the advisor's advisor, ...) for at most 3 hops, and find the NEAREST "
    "ancestor who is himself/herself a Nobel laureate. If a person lists two advisors, check both. If the chain ends (no advisor listed / no "
    "article) before finding a laureate, answer NONE. Show the chain you followed for each, then finish with exactly one line:\n"
    "cornell=<name> (<Nobel year>); ketterle=<name (year) or NONE>; wieman=<name> (<Nobel year>)",
    "https://en.wikipedia.org/wiki/2001_in_science",
    {"type": "must_include",
     "must_include": ["cornell=Norman Ramsey", "1989", "ketterle=NONE", "2005", "Pritchard", "Kleppner"],
     "any_of": [["wieman=Theodor W. Hänsch", "wieman=Theodor Hänsch", "wieman=Theodor W. Hansch", "wieman=Theodor Hansch", "wieman=Hänsch", "wieman=Hansch"]],
     "notes": "Snapshot 2026-10-22: Cornell→David E. Pritchard→Daniel Kleppner→Norman Ramsey (Nobel 1989). Wieman→Theodor W. Hänsch (Nobel 2005). Ketterle→Herbert Walther (no advisor field) / Hartmut Figger (no article) → NONE. Hallucinating a laureate for Ketterle fails."},
    hardness="多跳推理（最多 3 跳×3 人×双导师分支）；需诚实给出 NONE，测幻觉",
    drift_policy="Wikipedia 可被编辑：跑前用 scripts 中 API 复核 4 个 infobox（doctoral_advisor 字段）；不一致时以跑时页面为准并记录",
    gold_source="en.wikipedia.org API parse section=0 (Eric_Allin_Cornell, Wolfgang_Ketterle, Carl_Wieman, David_E._Pritchard, Daniel_Kleppner, Herbert_Walther)",
    tags=["multi_hop", "honesty", "no_hallucination"], budget={"max_tool_calls": 30, "max_elapsed_s": 360})

self_task(
    "research-attention-provenance", "research", "medium",
    "关于论文《Attention Is All You Need》，请跨站核实其出处信息：(1) 在 arXiv 摘要页读取 v1 提交日期、最新版本号及其日期、作者人数、主分类；"
    "(2) 在 NeurIPS 官方论文集 papers.nips.cc 找到该论文页面，读出会议名称与卷号（BibTeX 里的 volume）；(3) 指出 arXiv 标题与论文集标题在大小写上的差异。"
    "只看这两个站点，不要下载 PDF。最后一行严格输出：\n"
    "v1=<YYYY-MM-DD>; latest=v<n> (<YYYY-MM-DD>); authors=<n>; primary=<分类代码>; venue=<会议 年份>; volume=<n>",
    "https://arxiv.org/abs/1706.03762",
    {"type": "must_include",
     "must_include": ["v1=2017-06-12", "latest=v7", "2023-08-02", "authors=8", "primary=cs.CL", "volume=30"],
     "any_of": [["NIPS 2017", "NeurIPS 2017"], ["Attention is All you Need", "all you need"]],
     "notes": "arXiv: v1 Mon 12 Jun 2017, v7 Wed 2 Aug 2023, 8 authors, cs.CL. papers.nips.cc: 'Advances in Neural Information Processing Systems 30 (NIPS 2017)', title 'Attention is All you Need'."},
    hardness="跨 2 站核对 + 版本历史读数 + 细节差异判断；中文题面",
    drift_policy="arXiv 可能出 v8（极少）：若 latest 变化以跑时 abs 页为准；其余为历史事实",
    gold_source="arxiv.org/abs/1706.03762; papers.nips.cc 2017 hash 3f5ee243... Abstract + Bibtex (curl 2026-10-22)",
    locale="zh-CN", tags=["cross_site", "version_history", "zh_prompt"], budget={"max_tool_calls": 15, "max_elapsed_s": 200})

self_task(
    "research-node-lts-choice", "research", "hard",
    "我要在 2026 年底上线一个 Node.js 服务，要求它跑的 Node 主版本在 2027-12-31 之前一直有官方安全支持，而且上线时必须已经是 LTS（不接受 Current）。"
    "请以 nodejs.org 官方发布页 / nodejs/Release 仓库的 schedule 为准（可用 endoflife.date 交叉核对），回答：应该选哪个主版本？"
    "并说明为什么 Node 22 不行、Node 26 现在是否可选（看它进入 LTS 的日期与今天的关系）。最后一行严格输出：\n"
    "choice=Node <n>; choice_eol=<YYYY-MM-DD>; node22_eol=<YYYY-MM-DD>; node26_lts_start=<YYYY-MM-DD>",
    "https://nodejs.org/en/about/previous-releases",
    {"type": "must_include",
     "must_include": ["node22_eol=2027-04-30", "node26_lts_start=2026-10-28"],
     "any_of": [["choice=Node 24; choice_eol=2028-04-30", "choice=Node 26; choice_eol=2029-04-30"]],
     "must_not_include": ["choice=Node 22", "choice=Node 20"],
     "notes": "schedule.json: v22 end 2027-04-30; v24 lts 2025-10-28 end 2028-04-30; v26 lts 2026-10-28 end 2029-04-30. Before 2026-10-28 only Node 24 satisfies 'already LTS'; after that date Node 26 also passes. Rule accepts either pair so the task survives the date flip."},
    hardness="带约束的模糊需求：需把『2027 年底』『已是 LTS』两个条件同时套上日期表；判断随时间翻转",
    drift_policy="EOL 日期固定；choice 在 2026-10-28 后可能从 24 变 26，rule 已两者都接受；2028 年后需重写",
    gold_source="raw.githubusercontent.com/nodejs/Release/main/schedule.json; endoflife.date/api/nodejs.json (curl 2026-10-22)",
    locale="zh-CN", temporal=True, tags=["judgment", "constraints", "cross_site", "zh_prompt"],
    budget={"max_tool_calls": 15, "max_elapsed_s": 240})

# =============================================================== compare 多源对比
self_task(
    "compare-http-rfcs", "compare", "hard",
    "Compare the current core specifications of HTTP/1.1, HTTP/2 and HTTP/3. Start from Wikipedia to find the RFC numbers, then verify each on the "
    "RFC Editor (rfc-editor.org) or IETF Datatracker page: publication month/year, which RFCs it obsoletes, its standards status, and the transport it runs on. "
    "Output a markdown table with columns: version, rfc, published, obsoletes, status, transport (one row per version). Then one line:\n"
    "only_internet_standard=<version that is INTERNET STANDARD>; obsoletes_two=<version that obsoletes two RFCs>",
    "https://en.wikipedia.org/wiki/HTTP",
    {"type": "must_include",
     "must_include": ["9112", "9113", "9114", "June 2022", "7230", "7540", "8740", "QUIC",
                      "only_internet_standard=HTTP/1.1", "obsoletes_two=HTTP/2"],
     "min_rows": 3,
     "must_not_include": ["obsoletes_two=HTTP/3"],
     "notes": "rfc-editor JSON: 9112 obsoletes RFC7230 (INTERNET STANDARD); 9113 obsoletes RFC7540+RFC8740 (PROPOSED STANDARD); 9114 obsoletes none (PROPOSED STANDARD), runs over QUIC (RFC 9000). Wikipedia may still cite 7540/7230 as older refs — must use current ones."},
    hardness="跨 3 站（Wikipedia→rfc-editor/datatracker）；新旧 RFC 混淆陷阱；表格+结论",
    drift_policy="RFC 元数据只会因新 RFC 发布而变（obsoleted_by）；跑前用 rfc-editor JSON 复核",
    gold_source="https://www.rfc-editor.org/rfc/rfc911{2,3,4}.json (curl 2026-10-22)",
    tags=["cross_site", "multi_source", "trap"])

self_task(
    "compare-ecb-fx-chart", "compare", "hard",
    "Use the ECB's official euro reference rate page for the US dollar (chart/time series). Compare March 2020 with September 2022: for each month find the "
    "minimum and maximum daily EUR/USD reference rate and the dates they occurred, then say which month had the wider range (max−min) and whether EUR/USD "
    "fell below parity (1.0000) in either month. Use only ECB pages/data files (no third-party FX sites). Finish with exactly:\n"
    "2020-03 min=<rate> (<YYYY-MM-DD>) max=<rate> (<YYYY-MM-DD>); 2022-09 min=<rate> (<YYYY-MM-DD>) max=<rate> (<YYYY-MM-DD>); wider=<YYYY-MM>; below_parity=<YYYY-MM or none>",
    "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html",
    {"type": "must_include",
     "must_include": ["min=1.0707 (2020-03-20)", "max=1.1456 (2020-03-09)", "min=0.9565 (2022-09-28)",
                      "max=1.0175 (2022-09-13)", "wider=2020-03", "below_parity=2022-09"],
     "notes": "eurofxref-hist.csv: 2020-03 min 1.0707 on 03-20, max 1.1456 on 03-09 (range .0749); 2022-09 min 0.9565 on 09-28, max 1.0175 on 09-13 (range .0610)."},
    hardness="图表/动态时间序列读数（需切区间或取 ECB 数据文件）；精确到 4 位小数与日期；计算后判断",
    drift_policy="ECB 历史参考汇率不回溯修订，预期稳定",
    gold_source="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip (curl 2026-10-22)",
    tags=["chart_read", "dynamic_load", "calculation"], budget={"max_tool_calls": 25, "max_elapsed_s": 360, "max_screenshots": 4})

self_task(
    "compare-lifecycle-3stack", "compare", "hard",
    "Our stack is Node.js 20 + Python 3.12 + Ubuntu 22.04 LTS. Look up, on each project's OWN official lifecycle page (nodejs.org / nodejs Release schedule, "
    "devguide.python.org/versions, ubuntu.com/about/release-cycle), the initial release date and the end of standard/security support for each. "
    "Note where official pages give only a month (or where endoflife.date disagrees with the official page) instead of guessing a day. "
    "Output a 3-row markdown table (component, released, end_of_support, source_url) and finish with exactly:\n"
    "ends_first=<component>; ends_last=<component>; already_eol=<components already past end of support as of today, or none>",
    "https://nodejs.org/en/about/previous-releases",
    {"type": "must_include",
     "must_include": ["2023-04-18", "2026-04-30", "2023-10-02", "2028-10", "2022", "ends_first=Node",
                      "ends_last=Python", "already_eol=Node"],
     "any_of": [["2027-04", "April 2027", "Apr 2027", "2027-05", "May 2027", "2027-06", "June 2027", "Jun 2027"]],
     "min_rows": 3,
     "notes": "Node 20: 2023-04-18 → 2026-04-30 (already EOL on 2026-10-22). Python 3.12: 2023-10-02 → 2028-10. Ubuntu 22.04: released 2022-04-21; standard support ends 2027 (Canonical page month-granular; endoflife.date says 2027-06-01) — any 2027-04..06 accepted if sourced."},
    hardness="跨 3 个官方站 + 粒度不一致（月 vs 日）需显式说明；含『今天』时间判断",
    drift_policy="EOL 为既定计划；Ubuntu 月份口径以 any_of 容忍；already_eol 在 2027 年后会扩大（需改金标）",
    gold_source="nodejs/Release schedule.json; devguide.python.org/versions; endoflife.date/api/ubuntu.json (curl 2026-10-22)",
    temporal=True, tags=["cross_site", "multi_source", "judgment", "granularity_conflict"])

self_task(
    "compare-mortgage-two-calculators", "compare", "hard",
    "用两个不同的公开房贷计算器算同一笔贷款，并对比结果：房价 $400,000，首付 20%，30 年固定，年利率 6.5%。"
    "站点 A：calculator.net 的 Mortgage Calculator；站点 B：mortgagecalculator.org。两站都要把房价/首付/期限/利率改成上述值后重新计算。"
    "请分别报告：月供中的本息部分（principal & interest）、站点显示的每月总支出（含税费/保险等默认项）。解释两站总月供为何不同（指出各自默认附加项），"
    "并确认本息部分是否一致。不要改动其它高级选项。最后一行严格输出：\n"
    "pi_a=<金额>; pi_b=<金额>; pi_match=<yes|no>; total_a=<金额>; total_b=<金额>",
    "https://www.calculator.net/mortgage-calculator.html",
    {"type": "must_include",
     "must_include": ["pi_a=$2,022.62", "pi_b=$2,022.62", "pi_match=yes", "total_a=", "total_b="],
     "notes": "Loan 320,000 @6.5%/12, 360 months → P&I 2,022.62 (closed form). Totals differ because each site preloads different property tax/insurance/PMI/HOA defaults; total_* are reviewed against end-page screenshot, not gated. Number normalization strips thousands separators."},
    hardness="两站表单交互 + 结果对比 + 解释差异（默认附加项陷阱）；中文题面",
    drift_policy="本息为数学确定值；站点默认税费会变 → total 不入 gate",
    gold_source="closed-form amortization; field names verified via curl of both forms 2026-10-22",
    locale="zh-CN", tags=["form", "cross_site", "calculation", "zh_prompt"])

# =============================================================== form_fill 表单填写
self_task(
    "form-demoqa-practice", "form_fill", "hard",
    "Fill and submit the DEMOQA Student Registration practice form. First click Submit on the EMPTY form once and note which required fields are flagged. "
    "Then fill: First Name 'Qing', Last Name 'Zhou', Email 'qz.bench@example.com', Gender 'Other', Mobile '9876543210' (exactly 10 digits), "
    "Date of Birth 15 March 1990 (use the date picker; typing may not work), Subjects 'Maths' and 'Computer Science' (autocomplete chips), "
    "Hobbies 'Sports' and 'Music', Current Address '1 Benchmark Road', State 'Haryana' then City 'Panipat' (City is only enabled after State). "
    "Do NOT upload a picture. Submit, and copy every Label/Value row from the confirmation modal as a markdown table.",
    "https://demoqa.com/automation-practice-form",
    {"type": "must_include",
     "must_include": ["Thanks for submitting the form", "Qing Zhou", "qz.bench@example.com", "Other", "9876543210",
                      "15 March,1990", "Maths, Computer Science", "Sports, Music", "1 Benchmark Road", "Haryana Panipat"],
     "min_rows": 8,
     "notes": "Modal formats per DEMOQA app: Date of Birth '15 March,1990'; State and City 'Haryana Panipat'. Empty-submit flags (First Name, Last Name, Gender, Mobile) are reviewed, not gated. Site shows ads/overlays — part of the difficulty."},
    hardness="React 表单：日期选择器、自动补全 chips、条件字段（State→City）、10 位校验、广告遮挡",
    drift_policy="练习站，字段与 modal 格式多年稳定；首跑需人工确认 modal 格式一次",
    gold_source="demoqa.com app behavior (page 200 via curl 2026-10-22; SPA content not curl-verifiable)",
    tags=["conditional_field", "datepicker", "autocomplete", "validation"])

self_task(
    "form-usgs-quake-search", "form_fill", "hard",
    "Use the USGS Earthquake Hazards Program search form (not a news site) to find ALL earthquakes worldwide with magnitude ≥ 7.0 between "
    "2023-01-01 00:00 and 2023-12-31 23:59:59 UTC. Report: the total count; the largest event (magnitude, place text, UTC date); and how many of the "
    "results have 'Indonesia' in their place text. Do not open every event page. Finish with exactly:\n"
    "count=<n>; largest=M<mag> <place> (<YYYY-MM-DD>); indonesia=<n>",
    "https://earthquake.usgs.gov/earthquakes/search/",
    {"type": "must_include",
     "must_include": ["count=19", "largest=M7.8", "2023-02-06", "indonesia=5"],
     "any_of": [["Kahramanmaras", "Kahramanmaraş", "Pazarcik", "Pazarcık", "Turkey", "Türkiye"]],
     "notes": "FDSN query 2023 M≥7: 19 events; max M7.8 Pazarcik/Kahramanmaras 2023-02-06 01:17 UTC; 'Indonesia' in place: Tanimbar, Gili Air, Teluk Dalam, Java, Tobelo = 5 (Banda Sea not counted — literal rule). Catalog revisions rare; if live count differs re-pull via fdsnws and update."},
    hardness="多字段高级搜索表单（日期区间/震级/全球范围/输出选项）+ 结果列表统计；字面计数陷阱（Banda Sea）",
    drift_policy="历史目录，偶有震级修订；跑前用 fdsnws/event/1/query 复核",
    gold_source="https://earthquake.usgs.gov/fdsnws/event/1/query?starttime=2023-01-01&endtime=2024-01-01&minmagnitude=7 (curl 2026-10-22)",
    tags=["advanced_search", "aggregation", "trap"])

self_task(
    "form-quotes-viewstate", "form_fill", "medium",
    "On Quotes to Scrape's ViewState search form, choose author 'Mark Twain' (the Tag dropdown reloads after you pick an author). "
    "Report how many tags the Tag dropdown offers for him, then run TWO separate searches: tag 'truth' and tag 'life'. For each, quote every result in full. "
    "Finish with exactly:\ntag_options=<n>; truth_results=<n>; life_results=<n>",
    "https://quotes.toscrape.com/search.aspx",
    {"type": "must_include",
     "must_include": ["tag_options=11", "truth_results=2", "life_results=2",
                      "A lie can travel half way around the world while the truth is putting on its shoes",
                      "Never tell the truth to people who are not worthy of it",
                      "Good friends, good books, and a sleepy conscience",
                      "The fear of death follows from the fear of life"],
     "notes": "Dependent dropdown via __doPostBack; second search needs author re-selected or ViewState preserved. Gold via POST /filter.aspx 2026-10-22."},
    hardness="依赖下拉（postback 刷新）+ ViewState 状态保持 + 两次检索",
    drift_policy="沙盒站静态数据，稳定",
    gold_source="POST https://quotes.toscrape.com/filter.aspx (curl 2026-10-22)",
    tags=["dependent_dropdown", "viewstate", "multi_submit"])

self_task(
    "form-hockey-search-paginate", "form_fill", "hard",
    "On Scrape This Site's 'Hockey Teams: Forms, Searching and Pagination' page, use the search box to find teams matching 'New York'. "
    "Results are paginated — either page through or use the per-page selector, but make sure you cover ALL matching rows. Then compute: "
    "the total rows; the New York Rangers season with the most wins; the season (either team) with the best goal differential (+/-); "
    "and in how many seasons the Islanders won more games than the Rangers. Finish with exactly:\n"
    "rows=<n>; rangers_most_wins=<year> (<wins>); best_diff=<team> <year> (<+/->); islanders_beat_rangers=<n>",
    "https://www.scrapethissite.com/pages/forms/",
    {"type": "must_include",
     "must_include": ["rows=42", "rangers_most_wins=1993 (52)", "best_diff=New York Rangers 1991",
                      "islanders_beat_rangers=5"],
     "any_of": [["1991 (+75)", "1991 (75)", "1991 (+ 75)"]],
     "notes": "?q=New+York&per_page=100 → 42 rows (21 per team, 1990–2011). Rangers 1993 52 W; best +/- Rangers 1991 +75; Islanders > Rangers wins in 5 of 21 seasons."},
    hardness="搜索表单 + 分页/每页数量选择 + 跨行聚合计算",
    drift_policy="沙盒站静态数据，稳定",
    gold_source="https://www.scrapethissite.com/pages/forms/?q=New+York&per_page=100 (curl 2026-10-22)",
    tags=["search_form", "pagination", "aggregation"])

# =============================================================== batch_collect 批量采集
self_task(
    "batch-quotes-infinite-scroll", "batch_collect", "hard",
    "On https://quotes.toscrape.com/scroll (infinite scroll — new quotes load only when you scroll), load ALL quotes. Do not print them all. "
    "Report only aggregates. Finish with exactly:\n"
    "total=<n>; authors=<distinct authors>; top3=<author:n, author:n, author:n>; top_tag=<tag>:<n>; untagged=<n>",
    "https://quotes.toscrape.com/scroll",
    {"type": "must_include",
     "must_include": ["total=100", "authors=50", "Albert Einstein:10", "J.K. Rowling:9", "Marilyn Monroe:7",
                      "top_tag=love:14", "untagged=3"],
     "notes": "Via /api/quotes?page=1..10: 100 quotes, 50 authors, love 14, 3 untagged. Printing all 100 rows counts as over-execution (budget flag)."},
    hardness="无限滚动加载完整性 + 聚合统计；不许全量打印（测过度执行）",
    drift_policy="沙盒站静态数据，稳定",
    gold_source="https://quotes.toscrape.com/api/quotes?page=N (curl 2026-10-22)",
    tags=["infinite_scroll", "aggregation", "no_dump"], budget={"max_tool_calls": 20, "max_elapsed_s": 240})

self_task(
    "batch-oscars-ajax", "batch_collect", "hard",
    "On Scrape This Site's 'Oscar Winning Films: AJAX and Javascript' page, load the film tables for EVERY year 2010 through 2015 (each year loads via AJAX). "
    "For each year report the Best Picture winner and the film(s) with the most awards. Then list the years in which some other film won STRICTLY more "
    "awards than the Best Picture winner (ties don't count). Finish with exactly:\n"
    "films_total=<n>; max_awards=<title> (<n>, <year>); bp_outawarded_years=<comma-separated years>",
    "https://www.scrapethissite.com/pages/ajax-javascript/",
    {"type": "must_include",
     "must_include": ["films_total=87", "max_awards=Gravity (7, 2013)", "bp_outawarded_years=2012, 2013, 2015",
                      "The King's Speech", "The Artist", "Argo", "12 Years a Slave", "Birdman", "Spotlight"],
     "must_not_include": ["bp_outawarded_years=2010", "bp_outawarded_years=2011"],
     "notes": "AJAX ?ajax=true&year=Y: counts 13+15+15+12+16+16=87. BP vs top: 2010 tie(4/4), 2011 tie(5/5), 2012 Argo 3<Life of Pi 4, 2013 12YaS 3<Gravity 7, 2014 tie(4/4), 2015 Spotlight 2<Mad Max 6."},
    hardness="AJAX 动态加载 6 次 + 跨年聚合 + 并列判断（严格大于）",
    drift_policy="沙盒站静态数据，稳定",
    gold_source="https://www.scrapethissite.com/pages/ajax-javascript/?ajax=true&year=2010..2015 (curl 2026-10-22)",
    tags=["ajax", "dynamic_load", "aggregation", "tie_rule"])

self_task(
    "batch-webscraper-load-more", "batch_collect", "hard",
    "On the Web Scraper test e-commerce site, open Computers → Laptops in the 'Load more' version (products appear in batches; click 'More' until it stops). "
    "Collect every laptop's title and price, but DO NOT print the full list. Report aggregates only. Finish with exactly:\n"
    "total=<n>; under_500=<n with price < $500>; cheapest=<title> ($<price>); most_expensive=<title> ($<price>); thinkpad=<n titles containing 'ThinkPad'>",
    "https://webscraper.io/test-sites/e-commerce/more/computers/laptops",
    {"type": "must_include",
     "must_include": ["total=117", "under_500=38", "cheapest=Asus VivoBook X441NA-GA190 ($295.99)",
                      "Asus ROG Strix SCAR Edition GL503VM-ED115T", "1799", "thinkpad=10"],
     "notes": "Gold from the static-pagination twin (/static/computers/laptops?page=1..20): 117 items; same catalog as /more. Titles as shown in the card `title` attribute (cards may visually truncate — agent must read full title)."},
    hardness="『加载更多』按钮循环至结束 + 117 条完整性 + 截断标题陷阱 + 不许全量打印",
    drift_policy="测试站数据长期固定；跑前用 static 版复核计数",
    gold_source="https://webscraper.io/test-sites/e-commerce/static/computers/laptops?page=1..20 (curl 2026-10-22)",
    tags=["load_more", "dynamic_load", "aggregation", "no_dump", "truncation_trap"])

self_task(
    "batch-pypi-release-history", "batch_collect", "medium",
    "在 PyPI 上打开 requests 包的 Release history，收集 2023-01-01 至 2024-12-31 之间发布的所有版本（版本号 + 发布日期），并标出被 yanked 的版本及原因。"
    "只用 pypi.org 页面，不要逐个打开每个版本页（除非需要看 yanked 原因）。输出 markdown 表（version, date, yanked），最后一行严格输出：\n"
    "count=<n>; first=<version> (<YYYY-MM-DD>); last=<version> (<YYYY-MM-DD>); yanked=<逗号分隔版本>",
    "https://pypi.org/project/requests/#history",
    {"type": "must_include",
     "must_include": ["count=8", "first=2.28.2 (2023-01-12)", "last=2.32.3 (2024-05-29)", "yanked=2.32.0, 2.32.1",
                      "2.29.0", "2.30.0", "2.31.0", "2.32.2", "CVE-2024-35195"],
     "min_rows": 8,
     "notes": "PyPI JSON: 2.28.2 2023-01-12, 2.29.0 04-26, 2.30.0 05-03, 2.31.0 05-22, 2.32.0 2024-05-20 (yanked), 2.32.1 05-20 (yanked: conflicts with CVE-2024-35195 mitigation), 2.32.2 05-21, 2.32.3 05-29. UTC dates."},
    hardness="长列表（160 个版本）按日期窗口筛选 + yanked 标记识别；中文题面",
    drift_policy="历史区间，不会再增加；yanked 状态理论上可变（极少）",
    gold_source="https://pypi.org/pypi/requests/json (curl 2026-10-22)",
    locale="zh-CN", tags=["long_list", "filter", "zh_prompt"], budget={"max_tool_calls": 15, "max_elapsed_s": 200})

# =============================================================== skill_reuse Skill 复用（跨站泛化）
skill("skill-pkg-releases-cross-registry", "hard", "qzb-pkg-releases-{run}",
      "https://pypi.org/project/Flask/#history",
      "On PyPI, open the Flask package's release history and list every version released in calendar year 2023 (version + date). "
      "Return `package=<name>; count_2023=<n>; versions=<v1 (date), ...>`.",
      "https://rubygems.org/gems/sinatra/versions",
      "Now apply it to a DIFFERENT registry: RubyGems. For the gem `sinatra`, list every version released in calendar year 2023 (skip prereleases). "
      "Return the same one-line format.",
      {"type": "must_include", "must_include": ["package=sinatra", "count_2023=3", "3.0.6", "3.1.0", "3.2.0"],
       "notes": "rubygems API: sinatra 2023 → 3.0.6 (04-11), 3.1.0 (08-07), 3.2.0 (12-29). Create-stage Flask gold (not gated): 8 versions 2.2.3, 2.2.4, 2.3.0, 2.3.1, 2.3.2, 2.2.5, 2.3.3, 3.0.0."},
      hardness="Skill 跨站泛化：PyPI → RubyGems（页面结构完全不同）",
      drift_policy="2023 历史区间，稳定",
      gold_source="pypi.org/pypi/flask/json; rubygems.org/api/v1/versions/sinatra.json (curl 2026-10-22)",
      tags=["cross_site_generalization"])

skill("skill-arxiv-card-multi", "hard", "qzb-arxiv-card-{run}",
      "https://arxiv.org/abs/1706.03762",
      "On this arXiv abstract page, extract a metadata card: `id=<arxiv id>; v1=<YYYY-MM-DD>; latest=v<n> (<YYYY-MM-DD>); authors=<count>; primary=<category code>`.",
      "https://arxiv.org/abs/2005.14165",
      "Run it on BOTH https://arxiv.org/abs/2005.14165 and https://arxiv.org/abs/1512.03385 and return one markdown table with columns id, v1, latest, authors, primary. "
      "Note that one of them has only a single version.",
      {"type": "must_include",
       "must_include": ["2005.14165", "2020-05-28", "v4", "2020-07-22", "31", "1512.03385", "2015-12-10", "v1", "cs.CV", "cs.CL"],
       "min_rows": 2,
       "notes": "GPT-3 2005.14165: v1 2020-05-28, latest v4 2020-07-22, 31 authors, cs.CL. ResNet 1512.03385: only v1 2015-12-10, 4 authors, cs.CV. Author count 31 requires expanding 'and N other authors'."},
      hardness="多输入复用 + 边界（单版本、作者列表被折叠需展开计数）",
      drift_policy="arXiv 历史版本稳定；若作者再发新版本以跑时页面为准",
      gold_source="arxiv.org/abs/{2005.14165,1512.03385} (curl 2026-10-22)",
      tags=["multi_input", "edge_case"])

skill("skill-mortgage-params", "hard", "qzb-mortgage-pi-{run}",
      "https://www.calculator.net/mortgage-calculator.html",
      "On calculator.net's Mortgage Calculator, compute the monthly principal & interest for: home price $400,000, down payment 20%, term 30 years, rate 6.5%. "
      "The Skill must take price / down % / years / rate as parameters. Return `pi=<amount>; total_interest=<amount>`.",
      "https://www.calculator.net/mortgage-calculator.html",
      "Run it with NEW parameters: home price $500,000, down payment 10%, term 15 years, rate 5.75%. Return the same one-line format.",
      {"type": "must_include", "must_include": ["pi=$3,736.85"],
       "any_of": [["total_interest=$222,632", "222,632.17", "222,632.1"]],
       "notes": "Loan 450,000 @5.75%/12 × 180 → P&I 3,736.85; total interest 222,632.17 (site may round). Create gold (not gated): 2,022.62 / 408,142.36."},
      hardness="参数化表单 Skill：换 4 个参数复用；测 Skill 是否真正参数化而非写死",
      drift_policy="数学确定值，稳定",
      gold_source="closed-form amortization (2026-10-22)",
      tags=["parameterized", "form"])

skill("skill-rfc-meta-cross-site", "hard", "qzb-rfc-meta-{run}",
      "https://www.rfc-editor.org/info/rfc9114",
      "From the RFC Editor info page for RFC 9114, extract: `rfc=<n>; title=<title>; published=<Month YYYY>; status=<status>; obsoletes=<list or none>; authors=<names>`.",
      "https://datatracker.ietf.org/doc/rfc9000/",
      "Apply it on a DIFFERENT site — IETF Datatracker — for RFC 9000 (https://datatracker.ietf.org/doc/rfc9000/) and RFC 9110 (https://datatracker.ietf.org/doc/rfc9110/). "
      "Return one markdown table with the same fields.",
      {"type": "must_include",
       "must_include": ["9000", "QUIC: A UDP-Based Multiplexed and Secure Transport", "May 2021", "Iyengar", "Thomson",
                        "9110", "HTTP Semantics", "June 2022", "Fielding", "7231"],
       "any_of": [["Internet Standard", "INTERNET STANDARD"], ["Proposed Standard", "PROPOSED STANDARD"]],
       "min_rows": 2,
       "notes": "rfc-editor JSON: 9000 May 2021 PROPOSED STANDARD, authors Iyengar/Thomson, obsoletes none; 9110 June 2022 INTERNET STANDARD, Fielding/Nottingham/Reschke, obsoletes 2818, 7230–7235 etc."},
      hardness="Skill 跨站泛化：rfc-editor → datatracker；多输入；长 obsoletes 列表",
      drift_policy="RFC 元数据稳定（仅 obsoleted_by 可能新增）",
      gold_source="https://www.rfc-editor.org/rfc/rfc{9000,9110,9114}.json (curl 2026-10-22)",
      tags=["cross_site_generalization", "multi_input"])

# =============================================================== open-source controls 开源对照
om("b4aa7315e31dfcdc52baf7771be260c9", "research", "hard",
   "Find the latest NVIDIA Data Center driver that supports HGX H100 on Ubuntu 22.04 (x86_64 / AMD64) using NVIDIA's official driver pages. "
   "Stop as soon as you have it — do not enumerate other branches. Report exactly: driver_version=<x.y.z>; release_date=<YYYY-MM-DD>; "
   "url=<nvidia.com or docs.nvidia.com page you got it from>.",
   "https://www.nvidia.com/en-us/drivers/",
   {"type": "must_include", "must_include": ["H100", "22.04"],
    "must_match": [r"driver_version=\d{3}\.\d{1,3}(\.\d{1,3})?", r"url=https?://[^ ]*nvidia\.com"],
    "review": "human checks driver_version is the newest datacenter release listed on the run day (rule only gates format + domain)",
    "notes": "2026-10-23 baseline saw 595.112.07 then 615.71.10 (released 2026-10-19) — gold is 'latest at run time'."},
   hardness="真实厂商站多级筛选 + 地理跳转（nvidia.cn）+ 文档站绕行",
   keep_reason="首轮基线中耗时第二（173s）、上下文 98k，真实站点导航最长；版本漂移已改为『跑时最新 + 格式/域名 rule』",
   drift_policy="金标随发布漂移：rule 只判格式与域名，版本号由人工按跑时页面核对",
   judge="rule", original_prompt="Find the HGX H100 driver for Ubuntu 22.04 on AMD64 CPU.", temporal=True,
   budget={"max_tool_calls": 30, "max_elapsed_s": 300})

om("71f8de1834599fba443f40dbbfab8edd", "research", "hard",
   "On arXiv Advanced Search, search all fields for 'reinforcement learning', restrict to Computer Science AND Mathematics (include cross-listed), "
   "date range 2024-09-01 to 2025-01-31 using the default date type 'Submission date (most recent)'. "
   "Report ONLY: the total number of results shown and the first 5 results (title + arXiv id) in the default order. Do NOT collect or save further pages. "
   "Finish with: total=<n>.",
   "https://arxiv.org/search/advanced",
   {"type": "must_include", "must_include": ["total="],
    "numbers_near": [{"key": "total", "value": 2345, "rel_tol": 0.03}],
    "review": "human spot-checks the 5 titles against the live result page",
    "notes": "curl 2026-10-22 with date_type=submitted_date → 'Showing 1–50 of 2,345 results'. Baseline agent reported 2,383 (different date type). Tolerance ±3% covers date-type choice and late cross-lists."},
   hardness="多约束高级搜索表单 + 结果计数；考『适可而止』",
   keep_reason="基线最严重的过度执行（抓 2,383 篇、527s）；收紧为『只报总数+前 5』后最能测执行边界",
   drift_policy="过去日期区间，计数仅因撤稿/交叉列出微变，±3% 容忍",
   original_prompt="Search for papers related to reinforcement learning under the topics of computer science and mathematics on arxiv, with recent submission dates between September 2024 and January 2025.",
   budget={"max_tool_calls": 12, "max_elapsed_s": 180})

om("1b867afecf072cb877ebfa4069263746", "compare", "hard",
   "On America's Health Rankings, open the measure 'Unemployment - Women' and display the comparison of Illinois vs Michigan. Read the chart (hover or "
   "use the data table if present) and report each state's value for the most recent year shown and for 2020. Take at most 2 screenshots; do NOT try to "
   "hide page elements. Finish with exactly: latest_year=<YYYY>; IL_latest=<x%>; MI_latest=<x%>; IL_2020=<x%>; MI_2020=<x%>; higher_latest=<IL|MI>.",
   "https://www.americashealthrankings.org/",
   {"type": "must_include", "must_include": ["latest_year=", "IL_latest=", "MI_latest=", "IL_2020=", "MI_2020=", "higher_latest="],
    "must_match": [r"IL_latest=\d+(\.\d+)?%", r"MI_latest=\d+(\.\d+)?%"],
    "review": "human compares the 5 numbers to the live chart/data table (±0.1pt)",
    "notes": "Gate is format; numeric correctness reviewed. URL pattern /explore/measures/unemployment_women/IL/compare/MI (curl 200 2026-10-22)."},
   hardness="交互式图表读数 + 对比；基线唯一失败（截图完美主义导致 context overflow）",
   keep_reason="唯一首跑失败题，直接对应『截图循环/上下文膨胀』短板；改为读数而非截干净图",
   drift_policy="年度数据会更新最新年；2020 值固定。人工按跑时页面核对",
   judge="rule", original_prompt="Display the figure comparing unemployment trends among women in Illinois and Michigan.",
   temporal=True, budget={"max_tool_calls": 20, "max_elapsed_s": 240, "max_screenshots": 2})

om("bc2ce7f206045dd2d322e5695a947219", "form_fill", "medium",
   "Use SmartAsset's federal income tax calculator. Enter annual (household) income $158,500, ZIP code 97007, filing status Single; leave other inputs at defaults. "
   "Report the federal income tax the calculator displays, the tax year it says it uses, and whether the income field is gross income (before the standard deduction) "
   "or taxable income. Finish with exactly: federal_tax=<$ amount>; tax_year=<YYYY>; income_basis=<gross|taxable>.",
   "https://smartasset.com/taxes/income-taxes",
   {"type": "must_include", "must_include": ["income_basis=gross"],
    "must_match": [r"federal_tax=\$\d{1,3}(,\d{3})+", r"tax_year=20\d\d"],
    "review": "human checks federal_tax equals the page value for the stated tax_year (2025 table → $27,107)",
    "notes": "Rewritten to remove taxable/household ambiguity (baseline issue). 2025 tables: 158,500 − 15,750 std = 142,750 → $27,107."},
   hardness="真实计算器表单（JS 动态结果）+ 口径澄清",
   keep_reason="唯一保留的真实商业站表单；原题口径歧义已改写为可判",
   drift_policy="税表随年度更新：rule 判格式与 income_basis；金额按 tax_year 人工核对",
   judge="rule", original_prompt="Estimate the federal income tax I would owe on $158,500 of taxable income in ZIP code 97007, filing as single.",
   temporal=True, timeout=600)

wv("Apple--2", "compare", "medium",
   "Compare the iPhone 14 Pro and iPhone 15 Pro directly on apple.com (compare page or newsroom/archived spec pages on apple.com only): chip, launch price "
   "(starting, US), and whether each is still sold new by Apple today. Finish with exactly: 14pro_chip=<chip>; 15pro_chip=<chip>; 14pro_price=$<n>; "
   "15pro_price=$<n>; still_sold=<none|14 Pro|15 Pro|both>.",
   "https://www.apple.com/iphone/compare/",
   {"type": "must_include", "must_include": ["14pro_chip=A16 Bionic", "15pro_chip=A17 Pro", "14pro_price=$999", "15pro_price=$999",
                                              "still_sold=none"],
    "notes": "Both discontinued (Apple compare shows 'Not available' / no longer sold new as of 2026-10). Launch prices $999 (Apple newsroom)."},
   hardness="停售机型：需在官网找历史规格+判断在售状态",
   keep_reason="WV 唯一需要『停售判断』的对比题；改为 rule 可判",
   drift_policy="规格/发布价固定；still_sold=none 在未来仍成立",
   original_prompt="Compare the prices and chips for the iPhone 14 Pro and iPhone 15 Pro models directly from Apple's website.",
   budget={"max_tool_calls": 20, "max_elapsed_s": 240})


def main():
    out = ROOT / "datasets" / "v0.3"
    out.mkdir(parents=True, exist_ok=True)
    ids = [t["id"] for t in TASKS]
    assert len(ids) == len(set(ids)), "duplicate ids"
    (out / "qingzhou_v03_draft.jsonl").write_text("".join(json.dumps(t, ensure_ascii=False) + "\n" for t in TASKS))
    core = Counter(t["core_task"] for t in TASKS)
    diff = Counter(t["difficulty"] for t in TASKS)
    src = Counter(t["source"] for t in TASKS)
    cx = defaultdict(Counter)
    for t in TASKS:
        cx[t["core_task"]][t["difficulty"]] += 1
    manifest = {
        "name": "qingzhou-eval", "version": VERSION, "status": "draft", "created": VERIFIED,
        "supersedes_for_capability_score": "0.2.5 (kept as regression/smoke set)",
        "policy": {"parallel_max": 3, "skill_tasks_serialized": True, "single_model": True, "no_webarena": True,
                   "requires_login": False, "budgets_are_soft": True},
        "counts": {"total": len(TASKS), "by_core_task": dict(core), "by_difficulty": dict(diff), "by_source": dict(src),
                   "by_judge": dict(Counter(t["judge"] for t in TASKS)),
                   "zh_prompts": sum(1 for t in TASKS if t["locale"] == "zh-CN"),
                   "temporal": sum(1 for t in TASKS if t.get("temporal"))},
        "core_x_difficulty": {k: dict(v) for k, v in cx.items()},
        "tasks": TASKS,
    }
    (out / "manifest_v03_draft.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(json.dumps(manifest["counts"], ensure_ascii=False))
    print(json.dumps(manifest["core_x_difficulty"], ensure_ascii=False))


if __name__ == "__main__":
    main()
