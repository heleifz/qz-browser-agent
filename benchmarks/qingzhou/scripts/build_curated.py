#!/usr/bin/env python3
"""Build qingzhou-eval curated set (v0.2.0, five-category rebalance).

Single source of truth for task definitions. Regenerates:
  datasets/opensource/online_mind2web_curated.jsonl
  datasets/opensource/webvoyager_curated.jsonl
  datasets/self/self_curated.jsonl
  manifest.json
Gold values for self tasks were computed from the live demo sites on
2026-10-23 (books.toscrape.com / quotes.toscrape.com / the-internet are static
scraping sandboxes, so the gold is stable).
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "0.2.0"

OM_LIC = "CC BY 4.0 Online-Mind2Web; website from public mirror (datasets/opensource/om2w_website_join.json)"
WV_LIC = "Apache-2.0 (MinorJerry/WebVoyager)"
TIS = "https://the-internet.herokuapp.com"
BOOKS = "https://books.toscrape.com"
QUOTES = "https://quotes.toscrape.com"

TASKS: list[dict] = []


def add(**t):
    t.setdefault("locale", "en")
    t.setdefault("requires_login", False)
    t.setdefault("tags", [])
    t.setdefault("status", "ready")
    t.setdefault("temporal", False)
    if t["source"] == "self":
        t.setdefault("license_note", "internal")
        t.setdefault("website_status", "verified_200")
    t["tags"] = list(dict.fromkeys(t["tags"] + [f"difficulty:{t['difficulty']}"]))
    for k in ["id", "source", "core_task", "prompt", "start_url", "success_criteria", "judge", "timeout_s", "difficulty"]:
        assert k in t, (t.get("id"), k)
    TASKS.append(t)


def om(tid, core, difficulty, prompt, url, ref_len, judge="human", criteria_notes="", tags=(), temporal=False, timeout=None, **extra):
    add(id=f"om2w:{tid}", source="open:online-mind2web", source_task_id=tid, core_task=core,
        prompt=prompt, start_url=url, difficulty=difficulty, judge=judge,
        success_criteria={"type": "task_completion", "reference_length": ref_len,
                          "notes": criteria_notes or "Judge vs live site per OM2W task_completion rubric."},
        timeout_s=timeout or (900 if difficulty == "hard" else 600), license_note=OM_LIC,
        website_status="public_mirror_official", reference_length=ref_len, tags=["navigation", *tags],
        temporal=temporal, **extra)


def wv(sid, core, difficulty, prompt, url, criteria, judge="llm_judge", tags=(), temporal=False, original_prompt=None):
    t = dict(id=f"wv:{sid}", source="open:webvoyager", source_task_id=sid, core_task=core, prompt=prompt,
             start_url=url, difficulty=difficulty, judge=judge, success_criteria=criteria, timeout_s=600,
             license_note=WV_LIC, website_status="official", tags=["navigation", *tags], temporal=temporal)
    if original_prompt:
        t["original_prompt"] = original_prompt
    add(**t)


def prefixes(items, n=22):
    return [s[:n] for s in items]


# ---------------------------------------------------------------- research (7)
om("5e1b8254c123c80178cc28e0afdb14f0_110325", "research", "easy",
   "Find a help page about \u201chow presale works\u201d on ticketmaster.", "https://ticketmaster.com/", 4,
   criteria_notes="Pass if the agent ends on / links a Ticketmaster help article about presales and summarizes it.")
wv("Google Search--2", "research", "easy",
   "Using Google Search starting at google.com, find the official NBA team page or Wikipedia page for the Los Angeles Lakers and report: (1) the page title, (2) the official team website domain if shown, (3) the arena name listed on that page.",
   "https://www.google.com/",
   {"type": "must_include", "must_include": ["Crypto.com Arena"], "notes": "Arena name is the objective anchor; title/domain checked by reviewer if needed."},
   judge="rule", original_prompt="Search for the latest news title about the NBA team the Los Angeles Lakers.")
wv("GitHub--23", "research", "medium",
   "Find the wiki page of ohmyzsh on GitHub and tell me how to change the theme of zsh to agnoster.",
   "https://github.com/",
   {"type": "must_include", "must_include": ["ZSH_THEME", "agnoster"], "notes": "Must cite setting ZSH_THEME=\"agnoster\" in ~/.zshrc."},
   judge="rule")
om("6ca20f1da01edeb49a7a42c816d8c6fe", "research", "medium",
   "Find the Eligibility to get the child benefit and How it works and how to claim", "https://www.gov.uk/", 8,
   criteria_notes="Must summarize eligibility + how it works + how to claim from gov.uk Child Benefit pages.", tags=["long_horizon"])
add(id="self:shadowdom-001", source="self", core_task="research", difficulty="medium",
    prompt="Open the shadow DOM page. Read both lines of text rendered inside shadow roots. Quote both lines exactly in your final answer, one per line. Do not invent text.",
    start_url=f"{TIS}/shadowdom", judge="rule", timeout_s=180, tags=["extraction", "shadow_dom"],
    success_criteria={"type": "must_include", "must_include": ["Let's have some different text!", "My default text"],
                      "notes": "Shadow-root text; both lines required."})
om("b4aa7315e31dfcdc52baf7771be260c9", "research", "hard",
   "Find the HGX H100 driver for Ubuntu 22.04 on AMD64 CPU.", "https://www.nvidia.com/", 11,
   criteria_notes="Must reach NVIDIA driver search results / download page matching HGX H100 + Ubuntu 22.04 + x86_64; report driver version.",
   tags=["extraction", "multi_constraint"])
om("71f8de1834599fba443f40dbbfab8edd", "research", "hard",
   "Search for papers related to reinforcement learning under the topics of computer science and mathematics on arxiv, with recent submission dates between September 2024 and January 2025.",
   "https://arxiv.org/", 11,
   criteria_notes="Must use arXiv advanced search with cs+math classification and date range 2024-09..2025-01; report the query and top results.",
   tags=["extraction", "filter", "date_range"])

# ---------------------------------------------------------------- compare (6)
om("bf3b311cc8dce16d3de844f4b5875dfd", "compare", "easy",
   "Compare Apple watches and  learn more about the ultra version on apple.", "https://www.apple.com/", 4,
   criteria_notes="Must open Apple Watch compare view and the Ultra page; summarize Ultra vs at least one other model.", tags=["compare"])
wv("GitHub--29", "compare", "easy",
   "Compare the maximum number of private repositories allowed in the Free and Pro plans in GitHub Pricing.",
   "https://github.com/",
   {"type": "reference_or_human", "notes": "Read GitHub Pricing; both Free and Pro currently allow unlimited private repos \u2014 answer must state both plans explicitly."},
   tags=["compare"])
wv("Apple--2", "compare", "medium",
   "Compare the prices and chips for the iPhone 14 Pro and iPhone 15 Pro models directly from Apple's website.",
   "https://www.apple.com/",
   {"type": "reference_or_human", "notes": "If a model is no longer sold, agent must say so and use Apple's compare page specs; price/chip pair per model required."},
   tags=["compare", "price_sensitive"], temporal=True)
add(id="self:compare-books-categories-001", source="self", core_task="compare", difficulty="medium",
    prompt=("On Books to Scrape, open the Travel category and the Poetry category (check every page of each). Compare them. "
            "Finish with exactly this line format: travel_count=<n>; poetry_count=<n>; travel_cheapest=<title> (<price>); "
            "poetry_cheapest=<title> (<price>); more_books=<Travel|Poetry>"),
    start_url=f"{BOOKS}/", judge="rule", timeout_s=420, tags=["compare", "multi_source", "pagination"],
    success_criteria={"type": "must_include", "must_include": [
        "travel_count=11", "poetry_count=19", "The Road to Little Dribbling", "23.21",
        "Poems That Make Grown Women Cry", "14.19", "more_books=Poetry"]})
add(id="self:compare-multi-001", source="self", core_task="compare", difficulty="hard",
    prompt=("Multi-source compare: (1) Open https://en.wikipedia.org/wiki/Python_(programming_language) and extract: official website (from infobox), first release year, and designer. "
            "(2) Open https://en.wikipedia.org/wiki/JavaScript and extract the same three fields. "
            "(3) Return one markdown table with columns: language, official_website, first_release_year, designer. Use \"not listed\" if missing; do not invent."),
    start_url="https://en.wikipedia.org/wiki/Python_(programming_language)", judge="rule", timeout_s=360,
    tags=["compare", "multi_source", "extraction"],
    success_criteria={"type": "must_include", "must_include": ["python.org", "1991", "Guido van Rossum", "1995", "Brendan Eich"], "min_rows": 2})
om("1b867afecf072cb877ebfa4069263746", "compare", "hard",
   "Display the figure comparing unemployment trends among women in Illinois and Michigan.", "https://www.americashealthrankings.org/", 15,
   criteria_notes="Must end on the AHR chart with Illinois and Michigan both selected for unemployment (women) and describe the trend difference.",
   tags=["compare", "chart"])

# ---------------------------------------------------------------- form_fill (6)
add(id="self:form-login-001", source="self", core_task="form_fill", difficulty="easy",
    prompt="Open the login page. Fill username tomsmith and password SuperSecretPassword! then click Login. Reply with the exact success message text shown.",
    start_url=f"{TIS}/login", judge="rule", timeout_s=180, tags=["form"],
    success_criteria={"type": "must_include", "must_include": ["You logged into a secure area!"]})
add(id="self:form-controls-001", source="self", core_task="form_fill", difficulty="easy",
    prompt=("On the checkboxes page, make the first checkbox unchecked and the second checkbox checked. Then open /dropdown and select Option 2. "
            "Finish with exactly: checkbox1=<checked|unchecked>; checkbox2=<checked|unchecked>; dropdown=<selected option text>"),
    start_url=f"{TIS}/checkboxes", judge="rule", timeout_s=180, tags=["form"],
    success_criteria={"type": "must_include", "must_include": ["checkbox1=unchecked", "checkbox2=checked", "dropdown=Option 2"],
                      "notes": "v0 judges the agent's read-back; DOM-state check is a later runner feature."})
add(id="self:iframe-001", source="self", core_task="form_fill", difficulty="medium",
    prompt=("Open the iframe page. Inside the TinyMCE editor iframe, clear the existing text and type exactly: Qingzhou iframe smoke test. "
            "Then read the editor content back. If the editor is read-only, say READ_ONLY and quote the notice. Finish with: editor_text=<text>"),
    start_url=f"{TIS}/iframe", judge="rule", timeout_s=240, tags=["form", "iframe"],
    success_criteria={"type": "must_include", "must_include": ["editor_text=Qingzhou iframe smoke test"],
                      "notes": "Must edit inside iframe#mce_0_ifr. READ_ONLY answer = honest fail (env issue bucket)."})
om("bc2ce7f206045dd2d322e5695a947219", "form_fill", "medium",
   "Estimate the federal income tax I would owe on $158,500 of taxable income in ZIP code 97007, filing as single.",
   "https://smartasset.com/", 6,
   criteria_notes="Must fill SmartAsset income tax calculator (income, ZIP, filing status) and report the federal tax estimate shown.",
   tags=["form", "calculator"])
om("3adeea7627f4343069f38adae40f73d0_110325", "form_fill", "medium",
   "Within 25 Miles of 96817, find a nursing home that accepts medicare.", "https://www.medicare.gov/", 8,
   criteria_notes="Must use Medicare Care Compare search form: nursing homes, ZIP 96817, 25 mi radius; report one facility.",
   tags=["form", "filter"])
add(id="self:form-inputs-hard-001", source="self", core_task="form_fill", difficulty="hard",
    prompt=("Open /inputs and type 42 into the number input. Then go to /dropdown and select Option 1. Then go to /checkboxes and leave only the first checkbox checked. "
            "Finally open /login, fill username tomsmith and password SuperSecretPassword! and submit. "
            "Finish with exactly: number=<value>; dropdown=<value>; checkbox1=<checked|unchecked>; checkbox2=<checked|unchecked>; login=<success|fail>"),
    start_url=f"{TIS}/inputs", judge="rule", timeout_s=300, tags=["form", "multi_page"],
    success_criteria={"type": "must_include", "must_include": [
        "number=42", "dropdown=Option 1", "checkbox1=checked", "checkbox2=unchecked", "login=success"]})

# ---------------------------------------------------------------- batch_collect (6)
HOME8 = ["A Light in the Attic", "Tipping the Velvet", "Soumission", "Sharp Objects",
         "Sapiens: A Brief History of Humankind", "The Requiem Red", "The Dirty Little Secrets of Getting Your Dream Job",
         "The Coming Woman: A Novel Based on the Life of the Infamous Feminist, Victoria Woodhull"]
add(id="self:batch-tables-001", source="self", core_task="batch_collect", difficulty="easy",
    prompt="Open the tables page. Extract every row of Example 1 into a markdown table with columns: last_name, first_name, email, due, website. Print the complete table in your final answer.",
    start_url=f"{TIS}/tables", judge="rule", timeout_s=180, tags=["extraction", "table"],
    success_criteria={"type": "gold_items", "items": ["jsmith@gmail.com", "fbach@yahoo.com", "jdoe@hotmail.com", "tconway@earthlink.net", "$100.00"],
                      "min_fraction": 1.0, "min_rows": 4})
add(id="self:batch-books-001", source="self", core_task="batch_collect", difficulty="easy",
    prompt="Open Books to Scrape. Extract the first 8 books on the homepage into a markdown table with columns: title, price, rating. Use full titles. Print the complete table in your final answer.",
    start_url=f"{BOOKS}/", judge="rule", timeout_s=300, tags=["extraction"],
    success_criteria={"type": "gold_items", "items": prefixes(HOME8, 18), "min_fraction": 1.0, "min_rows": 8})
add(id="self:batch-quotes-001", source="self", core_task="batch_collect", difficulty="medium",
    prompt="Open Quotes to Scrape. Collect all 10 quotes on page 1 into a markdown table with columns: quote, author, tags (comma-separated). Print the complete table in your final answer.",
    start_url=f"{QUOTES}/", judge="rule", timeout_s=300, tags=["extraction", "nested_fields"],
    success_criteria={"type": "gold_items", "items": [
        "Albert Einstein", "J.K. Rowling", "Jane Austen", "Marilyn Monroe", "Andr\u00e9 Gide", "Thomas A. Edison",
        "Eleanor Roosevelt", "Steve Martin", "change", "deep-thoughts", "abilities", "simile"],
        "min_fraction": 0.9, "min_rows": 10})
add(id="self:batch-pages-001", source="self", core_task="batch_collect", difficulty="medium",
    prompt="On Books to Scrape, collect every book from page 1 and page 2 (use Next). Produce a markdown table with columns: title, price, rating, page. Print all 40 rows in your final answer.",
    start_url=f"{BOOKS}/", judge="rule", timeout_s=420, tags=["extraction", "pagination"],
    success_criteria={"type": "gold_items", "items": prefixes(HOME8[:5], 18) + ["In Her Wake", "How Music Works", "Chase Me", "Black Dust"],
                      "min_fraction": 1.0, "min_rows": 38})
add(id="self:batch-mystery-001", source="self", core_task="batch_collect", difficulty="hard",
    prompt=("On Books to Scrape, open the Mystery category and collect EVERY book across all of its pages into a markdown table with columns: title, price, rating. "
            "Print all rows, then a final line: total=<n>; cheapest=<title> (<price>)"),
    start_url=f"{BOOKS}/", judge="rule", timeout_s=600, tags=["extraction", "pagination", "category_nav"],
    success_criteria={"type": "must_include", "must_include": ["total=32", "Tastes Like Fear", "10.69"], "min_rows": 30})
add(id="self:batch-einstein-001", source="self", core_task="batch_collect", difficulty="hard",
    prompt=("On Quotes to Scrape, go through ALL pages (follow Next until it ends) and collect every quote whose author is Albert Einstein. "
            "Print a markdown table with columns: quote, tags, page_number, then a final line: einstein_total=<n>"),
    start_url=f"{QUOTES}/", judge="rule", timeout_s=720, tags=["extraction", "pagination", "filter", "long_horizon"],
    success_criteria={"type": "must_include", "must_include": ["einstein_total=10"], "min_rows": 9})

# ---------------------------------------------------------------- skill_reuse (5, two-stage)
def skill(sid, difficulty, name, create_prompt, reuse_prompt, create_url, reuse_url, reuse_check, timeout=600, tags=()):
    add(id=f"self:{sid}", source="self", core_task="skill_reuse", difficulty=difficulty,
        prompt=f"[two-stage] create: {create_prompt} || reuse: {reuse_prompt}",
        start_url=create_url, judge="rule", timeout_s=timeout, tags=["skill", "two_stage", *tags],
        skill_name=name,
        stages=[
            {"name": "create", "start_url": create_url, "new_session": True,
             "prompt": (f"{create_prompt} After it works, save this workflow as a reusable Skill named `{{skill_name}}` "
                        f"(parameterize the input so it can run on a different page). Reply with the exact Skill name you saved.")},
            {"name": "reuse", "start_url": reuse_url, "new_session": True,
             "prompt": (f"Use the existing Skill `{{skill_name}}` (do not rebuild the workflow from scratch). {reuse_prompt} "
                        f"End by stating which Skill you used.")},
        ],
        success_criteria={"type": "skill_two_stage", "skill_name": "{skill_name}",
                          "create": {"skill_must_exist": True},
                          "reuse": {**reuse_check, "skill_must_be_referenced": True},
                          "notes": "Stage 1 pass = new/updated non-builtin Skill with the name exists after the run. Stage 2 pass = gold check AND transcript/answer references the Skill. Both required."})

skill("skill-books-first5", "easy", "qzb-books-first5-{run}",
      "On Books to Scrape homepage, collect the first 5 books (title, price) into a markdown table.",
      "Run it on Books to Scrape catalogue page 2 (https://books.toscrape.com/catalogue/page-2.html) and print the 5-row table.",
      f"{BOOKS}/", f"{BOOKS}/catalogue/page-2.html",
      {"type": "gold_items", "items": ["In Her Wake", "How Music Works", "Foolproof Preserving", "Chase Me", "Black Dust"], "min_fraction": 1.0})
skill("skill-login-check", "easy", "qzb-login-check-{run}",
      "On the-internet login page, log in with username tomsmith / password SuperSecretPassword! and report the flash message text.",
      "Run it with username tomsmith and password wrongpass on https://the-internet.herokuapp.com/login and report the exact flash message.",
      f"{TIS}/login", f"{TIS}/login",
      {"type": "must_include", "must_include": ["Your password is invalid!"]}, timeout=420, tags=["form"])
skill("skill-tag-quotes", "medium", "qzb-tag-quotes-{run}",
      "On Quotes to Scrape, open the tag page for 'love', follow pagination to the end, and report the total number of quotes and the sorted list of distinct authors.",
      "Run it for the tag 'inspirational' and finish with: total=<n>; authors=<comma-separated>",
      f"{QUOTES}/tag/love/", f"{QUOTES}/tag/inspirational/",
      {"type": "must_include", "must_include": ["total=13"]}, tags=["pagination"])
skill("skill-category-summary", "hard", "qzb-category-summary-{run}",
      "On Books to Scrape, open the Travel category, visit every page of it, and report: count of books and the cheapest book (title, price).",
      "Run it on the Mystery category (it spans multiple pages) and finish with: count=<n>; cheapest=<title> (<price>)",
      f"{BOOKS}/", f"{BOOKS}/",
      {"type": "must_include", "must_include": ["count=32", "Tastes Like Fear", "10.69"]}, timeout=900, tags=["pagination", "category_nav"])
skill("skill-wiki-designers", "hard", "qzb-wiki-designers-{run}",
      "On the Wikipedia page https://en.wikipedia.org/wiki/Python_(programming_language), read the infobox and report 'Designed by' and 'First appeared'.",
      "Run it on BOTH https://en.wikipedia.org/wiki/Rust_(programming_language) and https://en.wikipedia.org/wiki/Go_(programming_language) and return one markdown table with columns: language, designed_by, first_appeared. Use the infobox only; write \"not listed\" if a field is absent.",
      "https://en.wikipedia.org/wiki/Python_(programming_language)", "https://en.wikipedia.org/wiki/Rust_(programming_language)",
      {"type": "must_include", "must_include": ["2012", "2009", "Robert Griesemer", "Rob Pike", "Ken Thompson"], "min_rows": 2,
       "notes": "Rust infobox has no 'Designed by' as of 2026-10-23 (\"not listed\" is correct); Go lists three designers."},
      timeout=900, tags=["multi_input", "extraction"])


def main():
    ids = [t["id"] for t in TASKS]
    assert len(ids) == len(set(ids)), "duplicate ids"
    splits = {
        "datasets/opensource/online_mind2web_curated.jsonl": [t for t in TASKS if t["source"] == "open:online-mind2web"],
        "datasets/opensource/webvoyager_curated.jsonl": [t for t in TASKS if t["source"] == "open:webvoyager"],
        "datasets/self/self_curated.jsonl": [t for t in TASKS if t["source"] == "self"],
    }
    for rel, rows in splits.items():
        p = ROOT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    by_core = Counter(t["core_task"] for t in TASKS)
    grid = defaultdict(Counter)
    for t in TASKS:
        grid[t["core_task"]][t["difficulty"]] += 1
    manifest = {
        "name": "qingzhou-eval-v0.1",
        "version": VERSION,
        "created": "2026-10-23",
        "revised": "2026-10-23",
        "seed": 20261023,
        "policy": {"curated_target": "~30", "parallel_max": 3, "single_model": True, "no_webarena": True,
                   "release_gate": "must_run_curated", "per_core_task": "5-7, each with easy/medium/hard"},
        "counts": {"total": len(TASKS), "online_mind2web": len(splits["datasets/opensource/online_mind2web_curated.jsonl"]),
                   "webvoyager": len(splits["datasets/opensource/webvoyager_curated.jsonl"]),
                   "self": len(splits["datasets/self/self_curated.jsonl"]),
                   "ready": sum(t["status"] == "ready" for t in TASKS),
                   "partial_or_pending": sum(t["status"] != "ready" for t in TASKS),
                   "auto_judged_rule": sum(t["judge"] == "rule" for t in TASKS),
                   "needs_review": sum(t["judge"] != "rule" for t in TASKS),
                   "temporal": sum(bool(t.get("temporal")) for t in TASKS)},
        "by_core_task": dict(by_core),
        "by_difficulty": dict(Counter(t["difficulty"] for t in TASKS)),
        "core_x_difficulty": {k: dict(v) for k, v in grid.items()},
        "tasks": TASKS,
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({k: manifest[k] for k in ["version", "counts", "by_core_task", "by_difficulty", "core_x_difficulty"]}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
