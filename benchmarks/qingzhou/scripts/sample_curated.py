#!/usr/bin/env python3
"""Rebuild curated JSONL + manifest.json from raw/ with fixed seed.

Seed and quotas are the source of truth for reproducibility.
"""
from __future__ import annotations

import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = 20261023
WV_TARGET = 6
OM_QUOTA = {"easy": 7, "medium": 7, "hard": 4}  # 18
SKIP_WV_SITES = {"Booking", "Google Flights", "Google Map"}
PREFERRED_WV_SITES = [
    "Wikipedia", "GitHub", "ArXiv", "Google Search", "Amazon", "Coursera",
    "ESPN", "BBC News", "Allrecipes", "Apple",
]

DOMAIN_HINTS = [
    (r"\bgamestop\b", "https://www.gamestop.com/"),
    (r"\bwalmart\b", "https://careers.walmart.com/"),
    (r"\bqatar airways\b", "https://www.qatarairways.com/"),
    (r"\bgov\.uk\b|\bvisa.*uk\b", "https://www.gov.uk/"),
    (r"\bdiscogs\b", "https://www.discogs.com/"),
    (r"\breddit\b", "https://www.reddit.com/"),
    (r"\bamazon\b", "https://www.amazon.com/"),
    (r"\bebay\b", "https://www.ebay.com/"),
    (r"\bairbnb\b", "https://www.airbnb.com/"),
    (r"\btripadvisor\b", "https://www.tripadvisor.com/"),
    (r"\bimdb\b", "https://www.imdb.com/"),
    (r"\bgithub\b", "https://github.com/"),
    (r"\barxiv\b", "https://arxiv.org/"),
    (r"\bwikipedia\b", "https://en.wikipedia.org/"),
    (r"\bespn\b", "https://www.espn.com/"),
    (r"\bcoursera\b", "https://www.coursera.org/"),
]


def load_wv(path: Path):
    rows = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def difficulty_from_labels(item: dict) -> str:
    vals = []
    for k, v in item.items():
        if k.endswith("_human_label") and v in ("0", "1"):
            vals.append(int(v))
    if not vals:
        return "medium"
    rate = sum(vals) / len(vals)
    if rate >= 0.7:
        return "easy"
    if rate <= 0.35:
        return "hard"
    return "medium"


def infer_website(task: str):
    t = task.lower()
    for pat, url in DOMAIN_HINTS:
        if re.search(pat, t, re.I):
            return url
    return None


def map_core(text: str) -> str:
    t = text.lower()
    if any(k in t for k in ["fill", "submit", "sign up", "register", "checkout", "add to cart", "set it as", "apply"]):
        return "form_fill"
    if any(k in t for k in ["compare", "difference between", "cheapest among"]):
        return "compare"
    return "research"


def map_dims(text: str, core: str):
    dims = ["navigation"]
    t = text.lower()
    if core == "form_fill":
        dims.append("form")
    if any(k in t for k in ["find", "locate", "what is", "how much", "hours", "price", "recipe"]):
        dims.append("extraction")
    if len(text.split()) > 25:
        dims.append("long_horizon")
    out = []
    for d in dims:
        if d not in out:
            out.append(d)
    return out


def sample_webvoyager(rng: random.Random, rows: list[dict]) -> list[dict]:
    stable = [x for x in rows if x["web_name"] not in SKIP_WV_SITES]
    by_site = defaultdict(list)
    for x in stable:
        by_site[x["web_name"]].append(x)
    picked = []
    for site in PREFERRED_WV_SITES:
        if site in by_site and len(picked) < WV_TARGET:
            pool = sorted(by_site[site], key=lambda t: t["id"])
            picked.append(pool[rng.randrange(len(pool))])
    if len(picked) < WV_TARGET:
        rest = [x for x in stable if x["id"] not in {p["id"] for p in picked}]
        rest.sort(key=lambda t: t["id"])
        rng.shuffle(rest)
        while len(picked) < WV_TARGET and rest:
            picked.append(rest.pop())
    out = []
    for x in picked:
        out.append({
            "id": f"wv:{x['id']}",
            "source": "open:webvoyager",
            "source_task_id": x["id"],
            "core_task": map_core(x["ques"]),
            "prompt": x["ques"],
            "start_url": x["web"],
            "locale": "en",
            "requires_login": False,
            "success_criteria": {
                "type": "reference_or_human",
                "notes": "Prefer WebVoyager reference_answer.json when present; else llm_judge/human.",
            },
            "judge": "llm_judge",
            "tags": map_dims(x["ques"], map_core(x["ques"])) + [f"site:{x['web_name']}"],
            "timeout_s": 600,
            "license_note": "Apache-2.0 (MinorJerry/WebVoyager)",
            "difficulty": "unknown",
            "status": "ready",
            "website_status": "official",
        })
    return out, picked


def sample_om2w(rng: random.Random, rows: list[dict]) -> list[dict]:
    by_diff = defaultdict(list)
    for item in rows:
        item = dict(item)
        item["_diff"] = difficulty_from_labels(item)
        by_diff[item["_diff"]].append(item)
    picked = []
    for d, n in OM_QUOTA.items():
        pool = sorted(by_diff[d], key=lambda t: t["task_id"])
        rng.shuffle(pool)
        picked.extend(pool[:n])
    out = []
    for item in picked:
        url = infer_website(item["confirmed_task"])
        if url:
            wstatus, status = "inferred_pending_verify", "partial"
        else:
            url, wstatus, status = "", "missing_hf_gated", "pending_website"
        core = map_core(item["confirmed_task"])
        out.append({
            "id": f"om2w:{item['task_id']}",
            "source": "open:online-mind2web",
            "source_task_id": item["task_id"],
            "core_task": core,
            "prompt": item["confirmed_task"],
            "start_url": url,
            "locale": "en",
            "requires_login": False,
            "success_criteria": {
                "type": "task_completion",
                "notes": "Must start from the official website field once HF access fills start_url.",
            },
            "judge": "human",
            "tags": map_dims(item["confirmed_task"], core) + [f"difficulty:{item['_diff']}"],
            "timeout_s": 900 if item["_diff"] == "hard" else 600,
            "license_note": "CC BY 4.0. Task text from public human_label.json; official website pending HF gated download.",
            "difficulty": item["_diff"],
            "status": status,
            "website_status": wstatus,
        })
    return out, picked


SELF_TASKS = [
    {
        "id": "self:form-login-001",
        "source": "self",
        "core_task": "form_fill",
        "prompt": "Open the login page. Fill username tomsmith and password SuperSecretPassword! then click Login. Confirm the success message contains \"You logged into a secure area!\". Do not change the password.",
        "start_url": "https://the-internet.herokuapp.com/login",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "dom_text", "must_include": ["You logged into a secure area!"]},
        "judge": "rule",
        "tags": ["form", "navigation"],
        "timeout_s": 180,
        "license_note": "internal",
        "difficulty": "easy",
        "status": "ready",
        "website_status": "verified_200",
    },
    {
        "id": "self:form-controls-001",
        "source": "self",
        "core_task": "form_fill",
        "prompt": "On the checkboxes page, ensure the first checkbox is unchecked and the second checkbox is checked. Then open /dropdown and select Option 2. Report the final checkbox states and selected dropdown value.",
        "start_url": "https://the-internet.herokuapp.com/checkboxes",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "state", "notes": "checkbox1=false, checkbox2=true, dropdown=Option 2"},
        "judge": "rule",
        "tags": ["form", "navigation"],
        "timeout_s": 180,
        "license_note": "internal",
        "difficulty": "easy",
        "status": "ready",
        "website_status": "verified_200",
    },
    {
        "id": "self:iframe-001",
        "source": "self",
        "core_task": "form_fill",
        "prompt": "Open the iframe page. Inside the TinyMCE editor iframe, clear the existing text and type exactly: Qingzhou iframe smoke test. Do not leave the page.",
        "start_url": "https://the-internet.herokuapp.com/iframe",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "iframe_text", "must_include": ["Qingzhou iframe smoke test"]},
        "judge": "rule",
        "tags": ["form", "iframe", "navigation"],
        "timeout_s": 240,
        "license_note": "internal",
        "difficulty": "medium",
        "status": "ready",
        "website_status": "verified_200",
    },
    {
        "id": "self:shadowdom-001",
        "source": "self",
        "core_task": "form_fill",
        "prompt": "Open the shadow DOM page. Read both lines of text inside shadow roots. Quote both lines exactly in your final answer. Do not invent text.",
        "start_url": "https://the-internet.herokuapp.com/shadowdom",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "text_match", "notes": "Must quote both shadow-root text lines on the page"},
        "judge": "rule",
        "tags": ["extraction", "shadow_dom"],
        "timeout_s": 180,
        "license_note": "internal",
        "difficulty": "medium",
        "status": "ready",
        "website_status": "verified_200",
    },
    {
        "id": "self:batch-books-001",
        "source": "self",
        "core_task": "batch_collect",
        "prompt": "Open Books to Scrape. Extract the first 8 books on the homepage into a table with columns: title, price, rating.",
        "start_url": "https://books.toscrape.com/",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "table", "min_rows": 8, "required_columns": ["title", "price", "rating"]},
        "judge": "rule",
        "tags": ["extraction", "batch_collect", "navigation"],
        "timeout_s": 300,
        "license_note": "internal",
        "difficulty": "easy",
        "status": "ready",
        "website_status": "verified_200",
    },
    {
        "id": "self:skill-reuse-001a",
        "source": "self",
        "core_task": "skill_reuse",
        "prompt": "On Books to Scrape, collect the first 5 books (title and price) into a table. Save this workflow as a Skill named books-first5 if supported; otherwise describe the exact reusable steps.",
        "start_url": "https://books.toscrape.com/",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "skill_created_or_described", "skill_name": "books-first5", "min_rows": 5},
        "judge": "human",
        "tags": ["skill", "extraction", "batch_collect"],
        "timeout_s": 420,
        "license_note": "internal",
        "difficulty": "medium",
        "status": "ready",
        "website_status": "verified_200",
        "pair": "self:skill-reuse-001b",
    },
    {
        "id": "self:skill-reuse-001b",
        "source": "self",
        "core_task": "skill_reuse",
        "prompt": "Reuse the Skill books-first5 (or the reusable steps from the previous task) on Books to Scrape to collect the first 5 books again (title and price).",
        "start_url": "https://books.toscrape.com/",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "skill_reused", "skill_name": "books-first5", "min_rows": 5},
        "judge": "human",
        "tags": ["skill", "extraction", "batch_collect"],
        "timeout_s": 300,
        "license_note": "internal",
        "difficulty": "medium",
        "status": "ready",
        "website_status": "verified_200",
        "pair": "self:skill-reuse-001a",
        "depends_on": ["self:skill-reuse-001a"],
    },
    {
        "id": "self:parallel-smoke-001",
        "source": "self",
        "core_task": "research",
        "prompt": "Run at most 3 parallel subtasks: (1) /checkboxes — how many checkboxes are checked; (2) /dropdown — default selected option; (3) /tables — email of the first row in Example 1. Return one combined answer. If subtasks are unavailable, do them sequentially under 4 minutes.",
        "start_url": "https://the-internet.herokuapp.com/",
        "locale": "en",
        "requires_login": False,
        "success_criteria": {"type": "multi_fact", "must_answer": ["checkbox_count", "dropdown_default", "first_email"]},
        "judge": "rule",
        "tags": ["parallel", "navigation", "extraction", "recovery"],
        "timeout_s": 240,
        "license_note": "internal",
        "difficulty": "medium",
        "status": "ready",
        "website_status": "verified_200",
    },
]


def write_jsonl(path: Path, rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def main():
    rng = random.Random(SEED)
    raw = ROOT / "raw"
    wv_path = raw / "webvoyager.jsonl"
    hl_path = raw / "human_label.json"
    if not wv_path.exists() or not hl_path.exists():
        raise SystemExit("Missing raw sources. Run scripts/fetch_sources.sh first.")

    wv_tasks, wv_picked = sample_webvoyager(rng, load_wv(wv_path))
    # fresh rng stream separation: re-seed before OM2W so order is independent of WV length
    rng_om = random.Random(SEED + 1)
    om_tasks, om_picked = sample_om2w(rng_om, json.loads(hl_path.read_text()))
    self_tasks = SELF_TASKS

    write_jsonl(ROOT / "datasets/opensource/webvoyager_curated.jsonl", wv_tasks)
    write_jsonl(ROOT / "datasets/opensource/online_mind2web_curated.jsonl", om_tasks)
    write_jsonl(ROOT / "datasets/self/self_curated.jsonl", self_tasks)

    all_tasks = wv_tasks + om_tasks + self_tasks
    audit = {
        "seed": SEED,
        "om_seed_offset": SEED + 1,
        "webvoyager": {
            "source_file": "raw/webvoyager.jsonl",
            "skipped_sites": sorted(SKIP_WV_SITES),
            "picked_ids": [x["source_task_id"] for x in wv_tasks],
            "picked_sites": [x["web_name"] for x in wv_picked],
        },
        "online_mind2web": {
            "source_file": "raw/human_label.json",
            "hf_dataset": "osunlp/Online-Mind2Web",
            "hf_status": "gated_401_without_auth",
            "difficulty_proxy": "fraction of agents with human_label==1 among 0/1 labels",
            "quota": OM_QUOTA,
            "picked_ids": [x["source_task_id"] for x in om_tasks],
            "website_inferred": sum(1 for t in om_tasks if t["website_status"] == "inferred_pending_verify"),
            "website_missing": sum(1 for t in om_tasks if t["website_status"] == "missing_hf_gated"),
        },
        "self": {"count": len(self_tasks), "ids": [x["id"] for x in self_tasks]},
    }
    (ROOT / "datasets/opensource/sampling_audit.json").write_text(
        json.dumps(audit, indent=2, ensure_ascii=False) + "\n"
    )

    manifest = {
        "name": "qingzhou-eval-v0.1",
        "version": "0.1.0",
        "created": "2026-10-23",
        "seed": SEED,
        "policy": {
            "curated_target": "25-30",
            "parallel_max": 3,
            "single_model": True,
            "no_webarena": True,
            "release_gate": "must_run_curated",
        },
        "counts": {
            "total": len(all_tasks),
            "webvoyager": len(wv_tasks),
            "online_mind2web": len(om_tasks),
            "self": len(self_tasks),
            "ready": sum(1 for t in all_tasks if t["status"] == "ready"),
            "partial_or_pending": sum(1 for t in all_tasks if t["status"] != "ready"),
        },
        "by_core_task": dict(Counter(t["core_task"] for t in all_tasks)),
        "tasks": all_tasks,
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(manifest["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
