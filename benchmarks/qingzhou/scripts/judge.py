#!/usr/bin/env python3
"""Judge a qingzhou-eval run.

  python3 scripts/judge.py results/<run_id>

Auto-judges tasks with judge=rule (must_include / any_of / must_not_include /
must_match / numbers_near / gold_items / min_rows / skill_two_stage).
Everything else (llm_judge / human) goes to a review queue; rule tasks that
carry a `review` note are judged AND queued for a human spot-check.
Also computes per-task efficiency (tool calls, screenshots, compacts, elapsed)
against the task's soft `budget`, and aggregates token/cost (v0.3).
Writes judgments.jsonl, review_queue.jsonl, review_queue.md, scoreboard.json.
Task definitions: manifest.json + datasets/v0.3/manifest_v03_draft.json, or
the --files recorded in results/<run_id>/run_meta.json.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u00c2", "")  # stray mojibake before £
    s = s.replace("**", "").replace("`", "")  # markdown emphasis / code ticks around key=value
    s = s.replace("$", "")  # "$2,022.62" == "2,022.62"
    s = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", s)  # thousands separators: 2,022.62 -> 2022.62
    s = re.sub(r"\s*=\s*", "=", s)
    s = re.sub(r"\s*,\s*", ",", s)  # list spacing: "2012, 2013" == "2012,2013"
    s = re.sub(r"\s+", " ", s)
    return s.lower().strip()


NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def table_rows(text: str) -> int:
    rows = [l for l in (text or "").splitlines() if l.strip().startswith("|")]
    rows = [l for l in rows if not re.match(r"^\s*\|[\s:|-]+\|\s*$", l)]
    return max(0, len(rows) - 1) if rows else 0  # minus header


def check_text(crit: dict, text: str):
    t = norm(text)
    detail = {}
    ok = True
    if crit.get("must_include"):
        miss = [m for m in crit["must_include"] if norm(m) not in t]
        detail["missing"] = miss
        ok &= not miss
    if crit.get("type") == "gold_items" or crit.get("items"):
        items = crit.get("items", [])
        hit = [i for i in items if norm(i) in t]
        frac = len(hit) / len(items) if items else 1.0
        detail["gold_fraction"] = round(frac, 3)
        detail["gold_missing"] = [i for i in items if i not in hit]
        ok &= frac >= crit.get("min_fraction", 1.0)
    if crit.get("any_of"):  # list of groups; each group needs >= 1 hit
        miss_groups = [g for g in crit["any_of"] if not any(norm(x) in t for x in g)]
        detail["any_of_missing"] = miss_groups
        ok &= not miss_groups
    if crit.get("must_not_include"):
        bad = [m for m in crit["must_not_include"] if norm(m) in t]
        detail["forbidden_hit"] = bad
        ok &= not bad
    if crit.get("must_match"):  # regexes on the raw answer, case-insensitive
        nomatch = [r for r in crit["must_match"] if not re.search(r, text or "", re.I)]
        detail["regex_missing"] = nomatch
        ok &= not nomatch
    for spec in crit.get("numbers_near") or []:  # {"key": "total", "value": 2345, "rel_tol": 0.03}
        key = norm(spec["key"])
        m = re.search(re.escape(key) + r"=(-?\d+(?:\.\d+)?)", t)
        got = float(m.group(1)) if m else None
        tol = abs(spec["value"]) * spec.get("rel_tol", 0) + spec.get("abs_tol", 0)
        hit = got is not None and abs(got - spec["value"]) <= tol
        detail.setdefault("numbers_near", []).append({"key": spec["key"], "got": got, "want": spec["value"], "ok": hit})
        ok &= hit
    if crit.get("min_rows"):
        n = table_rows(text)
        detail["table_rows"] = n
        ok &= n >= crit["min_rows"]
    return ok, detail


def efficiency(task: dict, res: dict, tdir: Path) -> dict:
    """Soft budget check from transcripts. Never changes the verdict."""
    calls = shots = compacts = scripts = turns = 0
    chars = 0
    for f in sorted(tdir.glob("stage*_*.json")):
        d = json.loads(f.read_text())
        for m in d.get("transcript") or []:
            chars += len(json.dumps(m, ensure_ascii=False))
            ty, name = m.get("type"), (m.get("name") or "").lower()
            if ty == "tool":
                calls += 1
                shots += "screenshot" in name
                scripts += "run_script" in name
            elif ty == "compact":
                compacts += 1
            elif ty == "assistant":
                turns += 1
    eff = {"tool_calls": calls, "screenshots": shots, "run_scripts": scripts, "compacts": compacts,
           "assistant_turns": turns, "elapsed_s": res.get("elapsed_s"), "transcript_chars": chars}
    b = task.get("budget") or {}
    over = []
    if b.get("max_tool_calls") is not None and calls > b["max_tool_calls"]:
        over.append(f"tool_calls {calls}>{b['max_tool_calls']}")
    if b.get("max_screenshots") is not None and shots > b["max_screenshots"]:
        over.append(f"screenshots {shots}>{b['max_screenshots']}")
    if b.get("max_elapsed_s") is not None and (res.get("elapsed_s") or 0) > b["max_elapsed_s"]:
        over.append(f"elapsed {res.get('elapsed_s')}>{b['max_elapsed_s']}")
    eff["over_budget"] = over
    return eff


def usage_summary(res: dict) -> dict:
    """Token/cost per task. Prefer cumulative samples (run_eval --usage-poll); else last-call only."""
    tot = {"prompt_tokens_last": 0, "completion_tokens_last": 0, "cost_usd_last_calls": 0.0,
           "cost_usd_cum_lower": None, "cost_usd_cum_upper_est": None, "llm_calls_sampled": 0}
    lower = upper = 0.0
    have_cum = False
    for st in res.get("stages") or []:
        u = st.get("usage") or {}
        tot["prompt_tokens_last"] += u.get("prompt_tokens") or 0
        tot["completion_tokens_last"] += u.get("completion_tokens") or 0
        tot["cost_usd_last_calls"] += (u.get("cost_in_usd_ticks") or 0) / 1e10
        c = st.get("usage_cum") or {}
        if c:
            have_cum = True
            lower += c.get("cost_usd_lower") or 0
            upper += c.get("cost_usd_upper_est") or 0
            tot["llm_calls_sampled"] += c.get("calls_sampled") or 0
    if have_cum:
        tot["cost_usd_cum_lower"], tot["cost_usd_cum_upper_est"] = round(lower, 4), round(upper, 4)
    tot["cost_usd_last_calls"] = round(tot["cost_usd_last_calls"], 4)
    return tot


def full_text(stage_file: Path) -> tuple[str, list]:
    d = json.loads(stage_file.read_text())
    return d.get("final_answer") or "", d.get("transcript") or []


def skill_referenced(name: str, answer: str, transcript: list) -> bool:
    n = name.lower()
    if n in (answer or "").lower():
        return True
    for m in transcript:
        blob = json.dumps(m, ensure_ascii=False).lower()
        if m.get("type") == "tool" and (n in blob or ("skill" in (m.get("name") or "").lower() and n.split("-")[1] in blob)):
            return True
    return False


def failure_bucket(status: str, answer: str) -> str:
    a = (answer or "").lower()
    if status == "timeout":
        return "timeout"
    if "context is too long" in a or "exceeds the model's input limit" in a:
        return "context_overflow"
    if "captcha" in a or "verify you are human" in a or "access denied" in a:
        return "site_blocked"
    if status == "error":
        return "agent_error"
    return "other"


def judge_task(task: dict, res: dict, tdir: Path):
    out = {"id": task["id"], "core_task": task["core_task"], "difficulty": task["difficulty"], "judge": task["judge"],
           "run_status": res.get("status"), "elapsed_s": res.get("elapsed_s")}
    if res.get("status") != "completed":
        last = (res.get("stages") or [{}])[-1]
        out.update(verdict="fail", reason=f"run status {res.get('status')}", auto=True,
                   failure_bucket=failure_bucket(res.get("status"), last.get("final_answer", "")),
                   failed_stage=last.get("stage", "main"), final_answer=last.get("final_answer", ""))
        return out
    crit = task["success_criteria"]
    if task["judge"] != "rule":
        ans, _ = full_text(tdir / "stage0_main.json")
        out.update(verdict="needs_review", auto=False, final_answer=ans)
        return out
    if crit.get("type") == "skill_two_stage":
        name = res.get("skill_name", "")
        st = {s["stage"]: s for s in res.get("stages", [])}
        created = st.get("create", {})
        new = created.get("skills_new_or_updated") or []
        base = task["skill_name"].replace("{run}", "").rstrip("-_").lower()
        exists = any(name.lower() == k.lower() for k in new)
        other_names = [k for k in new if base in k.lower() and k.lower() != name.lower()]
        tool_saved = False
        saved_named_base = False
        cfile = tdir / "stage0_create.json"
        if cfile.exists():
            for m in json.loads(cfile.read_text()).get("transcript") or []:
                if m.get("type") == "tool" and (m.get("name") or "").endswith("create_skill") and '"saved": true' in (m.get("result") or ""):
                    tool_saved = True
                    saved_named_base |= base in (str(m.get("args") or "") + str(m.get("result") or "")).lower()
        # v0.3: a lone *unrelated* new skill no longer counts (it may belong to a concurrent task).
        other = (not exists) and bool(other_names or (tool_saved and (not new or saved_named_base)))
        ans, tr = full_text(tdir / "stage1_reuse.json") if (tdir / "stage1_reuse.json").exists() else ("", [])
        gold_ok, det = check_text(crit["reuse"], ans)
        ref = skill_referenced(name, ans, tr) or any(k.lower() in (ans or "").lower() for k in new)
        out["detail"] = {"create_stage_status": created.get("status"), "skill_name": name, "skills_new_or_updated": new, "create_ok": exists or other,
                         "create_note": ("saved under a different/existing name: " + ",".join(other_names or new)) if other and (other_names or new) else ("create_skill reported saved but index shows no change" if other else ""),
                         "create_tool_saved": tool_saved, "reuse_gold_ok": gold_ok,
                         "reuse_skill_referenced": ref, **det}
        ok = (exists or other) and gold_ok and ref
        out.update(verdict="pass" if ok else "fail", auto=True, final_answer=ans)
        return out
    ans, _ = full_text(tdir / "stage0_main.json")
    ok, det = check_text(crit, ans)
    out.update(verdict="pass" if ok else "fail", auto=True, detail=det, final_answer=ans)
    return out


def load_task_defs(run: Path) -> dict:
    tasks = {}
    for mf in [ROOT / "manifest.json", ROOT / "datasets" / "v0.3" / "manifest_v03_draft.json"]:
        if mf.exists():
            tasks.update({t["id"]: t for t in json.loads(mf.read_text())["tasks"]})
    meta = run / "run_meta.json"
    if meta.exists():
        for f in json.loads(meta.read_text()).get("files") or []:
            p = Path(f) if Path(f).is_absolute() else ROOT / f
            if p.exists():
                for line in p.read_text().splitlines():
                    if line.strip():
                        t = json.loads(line)
                        tasks[t["id"]] = t
    return tasks


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    run = Path(sys.argv[1])
    tasks = load_task_defs(run)
    judgments, queue = [], []
    for line in (run / "summary.jsonl").read_text().splitlines():
        res = json.loads(line)
        task = tasks.get(res["id"])
        if not task:
            continue
        tdir = run / "tasks" / re.sub(r"[^A-Za-z0-9._-]+", "_", res["id"])[:120]
        j = judge_task(task, res, tdir)
        if tdir.exists():
            j["efficiency"] = efficiency(task, res, tdir)
        j["usage"] = usage_summary(res)
        if j["verdict"] == "pass":
            j["pass_within_budget"] = not (j.get("efficiency") or {}).get("over_budget")
        review_note = (task.get("success_criteria") or {}).get("review")
        if review_note and j["verdict"] in ("pass", "fail") and j.get("auto"):
            j["spot_check"] = review_note
        judgments.append(j)
        if j["verdict"] == "needs_review" or j.get("spot_check"):
            queue.append({"id": task["id"], "judge": task["judge"], "prompt": task["prompt"], "start_url": task["start_url"],
                          "success_criteria": task["success_criteria"], "temporal": task.get("temporal", False),
                          "final_answer": j.get("final_answer", ""),
                          "session_id": (res.get("stages") or [{}])[0].get("session_id"),
                          "working_url": (res.get("stages") or [{}])[0].get("working_url")})
    (run / "judgments.jsonl").write_text("".join(json.dumps(j, ensure_ascii=False) + "\n" for j in judgments))
    (run / "review_queue.jsonl").write_text("".join(json.dumps(q, ensure_ascii=False) + "\n" for q in queue))
    md = ["# 待人工/LLM 判分清单", ""]
    for q in queue:
        md += [f"## {q['id']} ({q['judge']}{', temporal' if q['temporal'] else ''})", f"- 起始: {q['start_url']}",
               f"- 题面: {q['prompt']}", f"- 判分: {json.dumps(q['success_criteria'], ensure_ascii=False)}",
               f"- 会话: {q['session_id']} · 结束页: {q['working_url']}", "", "```", (q["final_answer"] or "")[:3000], "```", ""]
    (run / "review_queue.md").write_text("\n".join(md))
    board = {"total": len(judgments), "pass": 0, "fail": 0, "needs_review": 0, "by_core_task": defaultdict(lambda: defaultdict(int)),
             "by_difficulty": defaultdict(lambda: defaultdict(int))}
    for j in judgments:
        board[j["verdict"]] += 1
        board["by_core_task"][j["core_task"]][j["verdict"]] += 1
        board["by_difficulty"][j["difficulty"]][j["verdict"]] += 1
    board["failure_buckets"] = dict(Counter(j["failure_bucket"] for j in judgments if j.get("failure_bucket")))
    board["pass_within_budget"] = sum(1 for j in judgments if j.get("pass_within_budget"))
    board["over_budget_tasks"] = {j["id"]: j["efficiency"]["over_budget"] for j in judgments
                                  if (j.get("efficiency") or {}).get("over_budget")}
    board["spot_check_pending"] = sum(1 for j in judgments if j.get("spot_check"))
    cost = {"cost_usd_last_calls_sum": round(sum(j["usage"]["cost_usd_last_calls"] for j in judgments), 4),
            "prompt_tokens_last_sum": sum(j["usage"]["prompt_tokens_last"] for j in judgments)}
    cum = [j["usage"] for j in judgments if j["usage"].get("cost_usd_cum_lower") is not None]
    if cum:
        cost["cost_usd_cum_lower_sum"] = round(sum(u["cost_usd_cum_lower"] for u in cum), 4)
        cost["cost_usd_cum_upper_est_sum"] = round(sum(u["cost_usd_cum_upper_est"] for u in cum), 4)
        cost["tasks_with_cum_usage"] = len(cum)
    effs = [j["efficiency"] for j in judgments if j.get("efficiency")]
    if effs:
        cost["tool_calls_sum"] = sum(e["tool_calls"] for e in effs)
        cost["screenshots_sum"] = sum(e["screenshots"] for e in effs)
        cost["compacts_sum"] = sum(e["compacts"] for e in effs)
    board["cost"] = cost
    decided = board["pass"] + board["fail"]
    board["auto_pass_rate"] = round(board["pass"] / decided, 3) if decided else None
    (run / "scoreboard.json").write_text(json.dumps(board, ensure_ascii=False, indent=1))
    for j in judgments:
        extra = j.get("detail") or ({"bucket": j.get("failure_bucket"), "stage": j.get("failed_stage")} if j.get("failure_bucket") else {})
        print(f"{j['verdict']:12} {j['id']:45} {j.get('elapsed_s')}s {json.dumps(extra, ensure_ascii=False)[:200]}")
    print(json.dumps({k: board[k] for k in ['total', 'pass', 'fail', 'needs_review', 'auto_pass_rate']}))


if __name__ == "__main__":
    main()
