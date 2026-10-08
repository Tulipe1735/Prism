"""Post-hoc audit of all blocks, including preparation failures; no filtering of negatives."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path("work/codex-prism-supplement-2026-10-05")
sha = lambda data: hashlib.sha256(data).hexdigest()
blocks = []
for directory in sorted(ROOT.iterdir()):
    if not directory.is_dir() or not (directory / "plan.json").exists():
        continue
    plan = json.loads((directory / "plan.json").read_text())
    raw = directory / "records.jsonl"
    rows = [json.loads(line) for line in raw.read_text().splitlines()] if raw.exists() else []
    freeze = json.loads((directory / "freeze.json").read_text())
    mismatches, retained = [], []
    for path, expected in freeze["files"].items():
        p = pathlib.Path(path)
        if p.exists() and sha(p.read_bytes()) == expected:
            continue
        original = directory / "method-source" / p.name
        if original.exists() and sha(original.read_bytes()) == expected:
            retained.append(path)
        else:
            mismatches.append(path)
    blocks.append({"directory": str(directory), "planned": plan.get("planned", len(plan.get("episodes", []))),
                   "recorded": len(rows), "infra_errors": sum(r["status"] == "infra_error" for r in rows),
                   "completed_scored_rows": sum(r["status"] == "recorded" for r in rows),
                   "real_model_requests": sum(r.get("real_model_requests", r.get("model_requests", 0)) for r in rows),
                   "fatal_runner_error": json.loads((directory / "failure.json").read_text()) if (directory / "failure.json").exists() else None,
                   "frozen_files_recovered_from_retained_method_source": retained,
                   "unexplained_frozen_file_mismatches": mismatches})

mechanism = [json.loads(line) for line in (ROOT / "mechanism-precheck/records.jsonl").read_text().splitlines()]
relations = [json.loads(line) for line in (ROOT / "independent-relation-check-v3/records.jsonl").read_text().splitlines()]
outcomes = []
issues = []
for row in mechanism:
    final = row["native_final"]
    task = row["task"]
    condition = row["condition"]
    receipt = row.get("action", {}).get("data", {}).get("receipt")
    events = final["events"]
    relevant = [e for e in events if (e["correct"] or e["wrong"]) and e["type"] in ["input", "change"]]
    actual = bool(relevant)
    expected_goal = condition == "correct"
    if final["goal"] != expected_goal:
        issues.append([row["id"], "oracle outcome differs from locked case"])
    if receipt and ((receipt["outcome"] == "executed") != actual):
        issues.append([row["id"], "receipt/input mismatch"])
    if condition == "disabled-after-first-observe" and (not row["schedule_applied"] or actual or receipt["code"] != "TARGET_CHANGED"):
        issues.append([row["id"], "disable schedule or refusal mismatch"])
    # A single select node belongs to both CSS selectors. Option value, not those booleans,
    # identifies correct and wrong selections in this task.
    correct_input = any(e["value"] == "2" for e in relevant) if task == "dropdown-two" else any(e["correct"] for e in relevant)
    outcomes.append({"id": row["id"], "actual_input": actual, "correct_input": correct_input,
                     "intentional_wrong_input": actual and not correct_input,
                     "native_goal": final["goal"], "receipt_outcome": receipt["outcome"] if receipt else None,
                     "code": receipt["code"] if receipt else None,
                     "not_an_agent_trial": True})
for row in relations:
    if row["after_goal"] != (row["condition"] == "correct"):
        issues.append([row["task_id"], row["condition"], "oracle mismatch"])
    if row["receipt_agrees"] is False:
        issues.append([row["task_id"], row["condition"], "receipt/input mismatch"])

gate = json.loads((ROOT / "request-gate-precheck/result.json").read_text())
host = json.loads((ROOT / "host-failure-precheck.json").read_text())
result = {"kind": "post-hoc verification; no pooled success-rate estimate", "blocks": blocks,
          "total_planned_cells_including_failed_preparations": sum(b["planned"] for b in blocks),
          "total_raw_cells": sum(b["recorded"] for b in blocks),
          "scored_zero_model_cells": sum(b["completed_scored_rows"] for b in blocks),
          "preparation_infra_error_raw_cells": sum(b["infra_errors"] for b in blocks),
          "real_model_requests": sum(b["real_model_requests"] for b in blocks),
          "autonomous_agent_trials": 0,
          "mechanism": outcomes,
          "relational_candidates": [{"task": r["task_id"], "both_offered": r["both_offered"],
                                     "semantic_group_required": r["group_semantically_required"],
                                     "association_exposed": r["group_association_exposed"],
                                     "explicit_relations_redundant": r["explicit_relations_redundant"]}
                                    for r in relations if r["condition"] == "neutral"],
          "local_request_gate_passed": gate["passed"],
          "isolated_host_one_mock_request": host["one_mock_post"],
          "host_request_no_known_oracle_or_unrelated_skill_markers": host["no_known_oracle_or_unrelated_skill_markers"],
          "model_launch_ready": False,
          "issues": issues}
with (ROOT / "analysis.json").open("x") as file:
    json.dump(result, file, ensure_ascii=False, indent=2); file.write("\n")
print(json.dumps({k: result[k] for k in ["total_planned_cells_including_failed_preparations", "total_raw_cells", "scored_zero_model_cells", "preparation_infra_error_raw_cells", "real_model_requests", "issues"]}))
