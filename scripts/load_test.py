#!/usr/bin/env python3
"""
Concurrent load tester for the Task Management API.

Hits GET /tasks with the filter combinations named in the bug report
(status, date range, assignee) and reports p50/p95/p99 latency per
filter combo. Also runs a concurrency burst against a single task ID,
recorded here so Phase 3's race-condition test has a contention
baseline to compare against once writes replace these reads.

Stdlib only, no extra deps to install. Lives outside src/ and is not
part of npm test.

Usage:
    python3 scripts/load_test.py
    python3 scripts/load_test.py --base-url http://localhost:3000 --requests 500 --concurrency 50
    python3 scripts/load_test.py --json > BASELINE_raw.json
    python3 scripts/load_test.py --baseline scripts/baseline-metrics.json --fail-on-regression
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional


@dataclass
class RequestResult:
    status: int
    latency_ms: float
    error: str = ""


def do_request(method: str, url: str) -> RequestResult:
    req = urllib.request.Request(url, method=method)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
            latency_ms = (time.perf_counter() - start) * 1000
            return RequestResult(status=resp.status, latency_ms=latency_ms)
    except urllib.error.HTTPError as e:
        latency_ms = (time.perf_counter() - start) * 1000
        return RequestResult(status=e.code, latency_ms=latency_ms, error=str(e))
    except Exception as e:
        latency_ms = (time.perf_counter() - start) * 1000
        return RequestResult(status=0, latency_ms=latency_ms, error=str(e))


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * (pct / 100)
    f = int(k)
    c = min(f + 1, len(ordered) - 1)
    if f == c:
        return ordered[f]
    return ordered[f] + (ordered[c] - ordered[f]) * (k - f)


def run_concurrent_gets(url: str, requests_count: int, concurrency: int) -> list[RequestResult]:
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(do_request, "GET", url) for _ in range(requests_count)]
        for f in concurrent.futures.as_completed(futures):
            results.append(f.result())
    return results


def summarize(name: str, results: list[RequestResult]) -> dict:
    latencies = [r.latency_ms for r in results]
    errors = [r for r in results if r.status == 0 or r.status >= 400]
    return {
        "combo": name,
        "count": len(results),
        "errors": len(errors),
        "p50_ms": round(percentile(latencies, 50), 2),
        "p95_ms": round(percentile(latencies, 95), 2),
        "p99_ms": round(percentile(latencies, 99), 2),
        "max_ms": round(max(latencies), 2) if latencies else 0,
    }


def fetch_sample_task(base_url: str) -> Optional[dict]:
    """Pull one real task so filter combos use a status/assigneeId that
    actually exists in the seeded data, instead of a guess."""
    url = f"{base_url}/tasks"
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            body = json.loads(resp.read())
    except Exception as e:
        print(f"Failed to fetch sample task: {e}", file=sys.stderr)
        return None

    tasks = body.get("data", body) if isinstance(body, dict) else body
    if not tasks:
        return None

    for task in tasks:
        if task.get("assigneeId") and task.get("dueDate"):
            return task
    return tasks[0]


def build_filter_combos(sample_task: dict) -> list[dict]:
    now = datetime.now(timezone.utc)
    date_from = (now - timedelta(days=90)).strftime("%Y-%m-%d")
    date_to = (now + timedelta(days=90)).strftime("%Y-%m-%d")
    status = sample_task.get("status", "IN_PROGRESS")
    assignee_id = sample_task.get("assigneeId")

    combos = [
        {"name": "no_filter", "params": {}},
        {"name": "status_only", "params": {"status": status}},
        {"name": "date_range_only", "params": {"dueDateFrom": date_from, "dueDateTo": date_to}},
        {"name": "status_and_date_range", "params": {"status": status, "dueDateFrom": date_from, "dueDateTo": date_to}},
    ]

    if assignee_id:
        combos.append({"name": "assignee_only", "params": {"assigneeId": assignee_id}})
        combos.append({"name": "status_and_assignee", "params": {"status": status, "assigneeId": assignee_id}})
        combos.append({"name": "date_range_and_assignee", "params": {"assigneeId": assignee_id, "dueDateFrom": date_from, "dueDateTo": date_to}})
        combos.append({"name": "all_filters", "params": {"status": status, "assigneeId": assignee_id, "dueDateFrom": date_from, "dueDateTo": date_to}})

    return combos


def print_table(summaries: list[dict]):
    headers = ["combo", "count", "errors", "p50_ms", "p95_ms", "p99_ms", "max_ms"]
    widths = {h: max(len(h), max((len(str(s[h])) for s in summaries), default=0)) for h in headers}
    line = "  ".join(h.ljust(widths[h]) for h in headers)
    print(line)
    print("-" * len(line))
    for s in summaries:
        print("  ".join(str(s[h]).ljust(widths[h]) for h in headers))


def load_baseline(path: str) -> dict[str, dict]:
    with open(path) as f:
        data = json.load(f)
    return {item["combo"]: item for item in data}


def compare_to_baseline(summaries: list[dict], baseline: dict[str, dict]) -> tuple[list[dict], bool]:
    comparisons = []
    any_regression = False
    for s in summaries:
        base = baseline.get(s["combo"])
        if not base:
            comparisons.append({**s, "baseline_p50_ms": None, "regression": None})
            continue
        regressed = any(s[k] >= base[k] for k in ("p50_ms", "p95_ms", "p99_ms"))
        any_regression = any_regression or regressed
        comparisons.append({
            **s,
            "baseline_p50_ms": base["p50_ms"],
            "baseline_p95_ms": base["p95_ms"],
            "baseline_p99_ms": base["p99_ms"],
            "regression": regressed,
        })
    return comparisons, any_regression


def print_comparison_table(comparisons: list[dict]):
    headers = ["combo", "p50_ms", "baseline_p50_ms", "p95_ms", "baseline_p95_ms", "p99_ms", "baseline_p99_ms", "regression"]
    widths = {h: max(len(h), max((len(str(c.get(h, ""))) for c in comparisons), default=0)) for h in headers}
    line = "  ".join(h.ljust(widths[h]) for h in headers)
    print(line)
    print("-" * len(line))
    for c in comparisons:
        print("  ".join(str(c.get(h, "")).ljust(widths[h]) for h in headers))


def main():
    parser = argparse.ArgumentParser(description="Load test the Task Management API")
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--requests", type=int, default=200, help="requests per filter combo")
    parser.add_argument("--concurrency", type=int, default=20)
    parser.add_argument("--burst-requests", type=int, default=50, help="requests in the single-task concurrency burst")
    parser.add_argument("--burst-concurrency", type=int, default=50)
    parser.add_argument("--json", action="store_true", help="print raw JSON instead of a table")
    parser.add_argument("--baseline", help="path to a baseline JSON file (e.g. scripts/baseline-metrics.json) to compare against")
    parser.add_argument("--fail-on-regression", action="store_true", help="exit 1 if any combo fails to beat the baseline")
    args = parser.parse_args()

    sample_task = fetch_sample_task(args.base_url)
    if not sample_task:
        print("Could not fetch a sample task. Is the API running and seeded?", file=sys.stderr)
        sys.exit(1)

    summaries = []

    for combo in build_filter_combos(sample_task):
        query = f"?{urllib.parse.urlencode(combo['params'])}" if combo["params"] else ""
        url = f"{args.base_url}/tasks{query}"
        results = run_concurrent_gets(url, args.requests, args.concurrency)
        summaries.append(summarize(combo["name"], results))

    # Concurrency burst against one task ID. Reads only for now, this is the
    # baseline; Phase 3's race-condition test will point concurrent writes
    # at the same endpoint and check for corrupted or duplicate rows.
    burst_url = f"{args.base_url}/tasks/{sample_task['id']}"
    burst_results = run_concurrent_gets(burst_url, args.burst_requests, args.burst_concurrency)
    summaries.append(summarize(f"burst_single_task[{sample_task['id']}]", burst_results))

    if args.baseline:
        baseline = load_baseline(args.baseline)
        comparisons, any_regression = compare_to_baseline(summaries, baseline)
        if args.json:
            print(json.dumps(comparisons, indent=2))
        else:
            print_comparison_table(comparisons)
        if args.fail_on_regression and any_regression:
            print("\nRegression detected: at least one combo did not beat the baseline.", file=sys.stderr)
            sys.exit(1)
        return

    if args.json:
        print(json.dumps(summaries, indent=2))
    else:
        print_table(summaries)


if __name__ == "__main__":
    main()