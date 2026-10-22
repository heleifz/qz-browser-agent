#!/usr/bin/env python3
"""Merge several v0.3 run dirs into one summary (json + md tables).
  python3 scripts/aggregate_v03.py OUT.json run_dir[:ids-filter] ...
Later runs override earlier ones for the same task id (used for the one allowed rerun)."""
import json, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]); runs = sys.argv[2:]
merged, first_try = {}, {}
for r in runs:
    for l in (ROOT / "results" / r / "judgments.jsonl").read_text().splitlines():
        j = json.loads(l); j["run"] = r
        first_try.setdefault(j["id"], j)
        merged[j["id"]] = j
rows = list(merged.values())
def grp(key):
    g = defaultdict(lambda: [0, 0])
    for j in rows:
        g[j[key]][1] += 1; g[j[key]][0] += j["verdict"] == "pass"
    return {k: f"{v[0]}/{v[1]}" for k, v in sorted(g.items())}
eff = lambda j: j.get("efficiency") or {}
sm = lambda f: round(sum(f(j) or 0 for j in rows), 4)
res = {
    "n": len(rows), "pass": sum(j["verdict"] == "pass" for j in rows),
    "pass_first_try_strict": sum(first_try[i]["verdict"] == "pass" for i in first_try),
    "by_core_task": grp("core_task"), "by_difficulty": grp("difficulty"),
    "pass_within_budget": sum(bool(j.get("pass_within_budget")) for j in rows),
    "over_budget": {j["id"]: eff(j).get("over_budget") for j in rows if eff(j).get("over_budget")},
    "bypass": {"any": sum(bool(eff(j).get("bypass")) for j in rows), "run_script": sum(bool(eff(j).get("bypass_run_script")) for j in rows),
               "direct_api_or_fetch": sum(bool(eff(j).get("bypass_api")) for j in rows)},
    "cost_usd": {"lower": sm(lambda j: j["usage"].get("cost_usd_cum_lower")), "mid": sm(lambda j: j["usage"].get("cost_usd_cum_mid_est")),
                 "upper": sm(lambda j: j["usage"].get("cost_usd_cum_upper_est"))},
    "elapsed_s_sum": round(sum(j.get("elapsed_s") or 0 for j in rows), 1),
    "tool_calls_sum": sum(eff(j).get("tool_calls", 0) for j in rows),
    "screenshots_sum": sum(eff(j).get("screenshots", 0) for j in rows),
    "compacts_sum": sum(eff(j).get("compacts", 0) for j in rows),
    "tasks": [{"id": j["id"], "core": j["core_task"], "difficulty": j["difficulty"], "verdict": j["verdict"], "run": j["run"],
               "elapsed_s": j.get("elapsed_s"), "tool_calls": eff(j).get("tool_calls"), "screenshots": eff(j).get("screenshots"),
               "bypass": eff(j).get("bypass"), "bypass_api": eff(j).get("bypass_api"), "over_budget": eff(j).get("over_budget"),
               "cost": [j["usage"].get("cost_usd_cum_lower"), j["usage"].get("cost_usd_cum_mid_est"), j["usage"].get("cost_usd_cum_upper_est")]}
              for j in sorted(rows, key=lambda j: (j["core_task"], j["id"]))],
}
out.write_text(json.dumps(res, ensure_ascii=False, indent=1))
print(json.dumps({k: v for k, v in res.items() if k != "tasks"}, ensure_ascii=False, indent=1))
for t in res["tasks"]: print(t)
