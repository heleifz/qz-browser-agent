#!/usr/bin/env python3
"""Minimal, repeatable runner for qingzhou-eval.

Reads curated JSONL, runs each task through the qz CLI on ONE paired browser
client, and stores per-task transcript / timing / status under results/<run_id>/.

  python3 scripts/run_eval.py --ids self:form-login-001,self:batch-tables-001
  python3 scripts/run_eval.py --core batch_collect --difficulty hard -j 2
  python3 scripts/run_eval.py --all --client product-expert -j 3
  python3 scripts/run_eval.py --ids ... --dry-run      # print plan only

Nothing runs unless you pass --ids / --core / --difficulty / --source / --all.
Concurrency is clamped to <= 3. Judging is a separate step (scripts/judge.py).
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import secrets
import shlex
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FILES = [
    "datasets/opensource/online_mind2web_curated.jsonl",
    "datasets/opensource/webvoyager_curated.jsonl",
    "datasets/self/self_curated.jsonl",
]
DEFAULT_QZ = "npx --yes --registry=https://registry.npmjs.org/ qz-browser-agent@latest"
MAX_CONCURRENCY = 3
_print_lock = threading.Lock()


def log(*a):
    with _print_lock:
        print(*a, flush=True)


def now_iso():
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def load_tasks(files):
    tasks = []
    for f in files:
        p = (ROOT / f) if not os.path.isabs(f) else Path(f)
        for line in p.read_text().splitlines():
            if line.strip():
                tasks.append(json.loads(line))
    return tasks


def select(tasks, a):
    if not (a.all or a.ids or a.core or a.difficulty or a.source):
        sys.exit("Refusing to run without a selector: pass --ids/--core/--difficulty/--source or --all.")
    out = tasks
    if a.ids:
        want = [s.strip() for s in a.ids.split(",") if s.strip()]
        idx = {t["id"]: t for t in tasks}
        missing = [w for w in want if w not in idx]
        if missing:
            sys.exit(f"Unknown ids: {missing}")
        out = [idx[w] for w in want]
    if a.core:
        out = [t for t in out if t["core_task"] in a.core.split(",")]
    if a.difficulty:
        out = [t for t in out if t["difficulty"] in a.difficulty.split(",")]
    if a.source:
        out = [t for t in out if t["source"] in a.source.split(",")]
    out = [t for t in out if t.get("status") == "ready" or a.include_not_ready]
    if a.limit:
        out = out[: a.limit]
    return out


class QZ:
    def __init__(self, cmd, client):
        self.base = shlex.split(cmd)
        self.client = client

    def run(self, args, timeout, stdin=None):
        full = self.base + args + ["--client", self.client, "--json"]
        t0 = time.time()
        try:
            p = subprocess.run(full, input=stdin, capture_output=True, text=True, timeout=timeout, cwd="/tmp")
            out, err, code = p.stdout, p.stderr, p.returncode
        except subprocess.TimeoutExpired as e:
            out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
            err = "TIMEOUT"
            code = -9
        data = None
        try:
            data = json.loads(out) if out.strip() else None
        except json.JSONDecodeError:
            m = re.search(r"\{.*\}\s*$", out, re.S)
            if m:
                try:
                    data = json.loads(m.group(0))
                except json.JSONDecodeError:
                    pass
        return {"code": code, "data": data, "stderr": err[-4000:], "elapsed_s": round(time.time() - t0, 2)}

    def skills(self):
        r = self.run(["skills", "list"], timeout=60)
        items = (((r.get("data") or {}).get("result") or {}).get("items")) or []
        return {i["name"]: i.get("updatedAt") for i in items if not i.get("builtin")}


def final_answer(transcript):
    for m in reversed(transcript or []):
        if m.get("type") == "assistant" and (m.get("content") or "").strip():
            return m["content"]
    return ""


def run_one_prompt(qz: QZ, prompt: str, timeout_s: int, title: str):
    created = qz.run(["create", "-", "--title", title, "--wait", "--timeout", str(timeout_s)], timeout=timeout_s + 90, stdin=prompt)
    res = (created.get("data") or {}).get("result") or {}
    sid = (res.get("session") or {}).get("id") or res.get("sessionId") or ((res.get("snapshot") or {}).get("sessionId"))
    shown = qz.run(["show", sid], timeout=120) if sid else {"data": None, "code": None}
    snap = ((shown.get("data") or {}).get("result")) or {}
    status = snap.get("status") or ((snap.get("state") or {}).get("status"))
    if created["code"] == -9:
        status = "timeout"
        if sid:
            qz.run(["cancel", sid], timeout=60)
    elif not sid:
        status = "error"
    runtime = (snap.get("state") or {}).get("runtime") or {}
    usage = runtime.get("contextUsage") or {}
    return {
        "session_id": sid,
        "status": status or "unknown",
        "exit_code": created["code"],
        "elapsed_s": created["elapsed_s"],
        "stderr_tail": created["stderr"][-1500:],
        "final_answer": final_answer(snap.get("transcript")),
        "working_url": runtime.get("workingUrl"),
        "started_at": runtime.get("startedAt"),
        "ended_at": runtime.get("endedAt"),
        "usage": {k: usage.get(k) for k in ["prompt_tokens", "completion_tokens", "total_tokens", "cost_in_usd_ticks"]},
        "artifacts": snap.get("artifacts"),
        "transcript": snap.get("transcript"),
    }


def create_tool_saved(transcript):
    for m in transcript or []:
        if m.get("type") == "tool" and (m.get("name") or "").endswith("create_skill") and '"saved": true' in (m.get("result") or ""):
            return True
    return False


def build_prompt(start_url, prompt):
    if start_url and start_url not in prompt:
        return f"Start at {start_url}\n\n{prompt}"
    return prompt


def safe(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:120]


def run_task(qz: QZ, task: dict, out_dir: Path, run_tag: str, timeout_override):
    tdir = out_dir / "tasks" / safe(task["id"])
    tdir.mkdir(parents=True, exist_ok=True)
    timeout = timeout_override or task.get("timeout_s", 600)
    t0 = time.time()
    rec = {"id": task["id"], "core_task": task["core_task"], "difficulty": task["difficulty"], "source": task["source"],
           "judge": task["judge"], "started_at": now_iso(), "stages": []}
    log(f"[start] {task['id']}")
    if task.get("stages"):
        skill_name = task["skill_name"].replace("{run}", run_tag)
        rec["skill_name"] = skill_name
        before = qz.skills()
        for i, st in enumerate(task["stages"]):
            p = build_prompt(st.get("start_url"), st["prompt"].replace("{skill_name}", skill_name))
            r = run_one_prompt(qz, p, timeout, f"qzbench {task['id']} {st['name']}")
            r["stage"] = st["name"]
            r["prompt"] = p
            if st["name"] == "create":
                base = task["skill_name"].replace("{run}", "").rstrip("-_").lower()
                changed = []
                for attempt in range(3):  # skill index can lag the agent's reply
                    after = qz.skills()
                    changed = sorted(k for k, v in after.items() if before.get(k) != v)
                    if any(base in k.lower() for k in changed):
                        break
                    time.sleep(3)
                r["skills_new_or_updated"] = changed
                r["skills_after"] = sorted(after)
            (tdir / f"stage{i}_{st['name']}.json").write_text(json.dumps(r, ensure_ascii=False, indent=1))
            rec["stages"].append({k: v for k, v in r.items() if k != "transcript"})
            if r["status"] in ("timeout", "error"):
                saved = bool(r.get("skills_new_or_updated")) or create_tool_saved(r.get("transcript"))
                if st["name"] == "create" and saved:
                    r["note"] = "create turn ended in error but the Skill was saved; continuing to reuse"
                    rec["stages"][-1]["note"] = r["note"]
                    continue
                break
        statuses = [s["status"] for s in rec["stages"]]
        reuse_done = len(statuses) == len(task["stages"]) and statuses[-1] == "completed"
        rec["status"] = "completed" if reuse_done else (statuses[-1] if statuses else "error")
        rec["stage_statuses"] = statuses
    else:
        p = build_prompt(task.get("start_url"), task["prompt"])
        r = run_one_prompt(qz, p, timeout, f"qzbench {task['id']}")
        r["prompt"] = p
        (tdir / "stage0_main.json").write_text(json.dumps(r, ensure_ascii=False, indent=1))
        rec["stages"].append({k: v for k, v in r.items() if k != "transcript"})
        rec["status"] = r["status"]
    rec["elapsed_s"] = round(time.time() - t0, 2)
    rec["ended_at"] = now_iso()
    (tdir / "result.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1))
    log(f"[done]  {task['id']} status={rec['status']} {rec['elapsed_s']}s")
    return rec


def git_head():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except Exception:
        return ""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--client", default=os.environ.get("QZ_BENCH_CLIENT", "product-expert"), help="qz client name or UUID (default product-expert)")
    ap.add_argument("--qz", default=os.environ.get("QZ_BENCH_CMD", DEFAULT_QZ), help="qz CLI command prefix")
    ap.add_argument("-j", "--concurrency", type=int, default=1)
    ap.add_argument("--files", default=",".join(DEFAULT_FILES))
    ap.add_argument("--ids"); ap.add_argument("--core"); ap.add_argument("--difficulty"); ap.add_argument("--source")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--include-not-ready", action="store_true")
    ap.add_argument("--timeout", type=int, help="override per-stage timeout seconds")
    ap.add_argument("--run-id")
    ap.add_argument("--results-dir", default=str(ROOT / "results"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    conc = max(1, min(a.concurrency, MAX_CONCURRENCY))
    tasks = select(load_tasks(a.files.split(",")), a)
    run_tag = secrets.token_hex(3)
    run_id = a.run_id or dt.datetime.now().strftime("%Y%m%d-%H%M%S") + f"-{run_tag}"
    if a.dry_run:
        for t in tasks:
            stages = [s["name"] for s in t.get("stages", [])] or ["main"]
            print(f"{t['id']:45} {t['core_task']:13} {t['difficulty']:6} stages={stages} timeout={a.timeout or t['timeout_s']}")
        print(f"{len(tasks)} task(s); client={a.client}; concurrency={conc}")
        return
    out = Path(a.results_dir) / run_id
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / "manifest.json").read_text())
    meta = {"run_id": run_id, "run_tag": run_tag, "client": a.client, "concurrency": conc, "qz_cmd": a.qz,
            "dataset": manifest.get("name"), "dataset_version": manifest.get("version"), "git_head": git_head(),
            "task_ids": [t["id"] for t in tasks], "started_at": now_iso()}
    (out / "run_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    qz = QZ(a.qz, a.client)
    results = []
    with cf.ThreadPoolExecutor(max_workers=conc) as ex:
        futs = {ex.submit(run_task, qz, t, out, run_tag, a.timeout): t for t in tasks}
        for f in cf.as_completed(futs):
            try:
                results.append(f.result())
            except Exception as e:  # keep the run going
                t = futs[f]
                log(f"[error] {t['id']}: {e!r}")
                results.append({"id": t["id"], "status": "runner_error", "error": repr(e)})
    with (out / "summary.jsonl").open("w") as fh:
        for r in sorted(results, key=lambda r: r["id"]):
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    meta["ended_at"] = now_iso()
    (out / "run_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    log(f"results: {out}")


if __name__ == "__main__":
    main()
