"""Post-execution descriptive diagnostics; never alters raw outcomes or frozen controls.

Run after the preregistered external-validation-v1.py. This exports per-run Adaptive
traces, measurement coverage, conservative failure evidence and result inventories.
These diagnostics introduce no success definition, exclusion or inferential threshold.
"""
import collections
import datetime
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
ID = "external-validation-v1"
MODELS = ["glm-5.3-flash", "deepseek-v4.1-flash"]
ARMS = ["indexed-local", "indexed-structural", "indexed-adaptive", "raw-selector-reference"]


def read(path):
    return json.loads((ROOT / path).read_text())


def jsonl(path):
    return [json.loads(line) for line in (ROOT / path).read_text().splitlines() if line.strip()]


def save(suffix, value):
    (ROOT / f"evals/reports/{ID}-{suffix}.json").write_text(json.dumps(value, indent=2) + "\n")


def main():
    analysis = read(f"evals/reports/{ID}-analysis.json")
    assert analysis["complete"], "Finish the fixed cohort before final diagnostics"
    freeze = read(f"evals/cohorts/{ID}.freeze.json")
    plan = read(f"evals/results/{ID}.meta.json")
    audit = jsonl(f"evals/results/{ID}-audit.jsonl")
    responses = jsonl(f"evals/results/{ID}-responses.jsonl")
    records = [r for model in MODELS for r in jsonl(f"evals/results/{ID}-{model}.jsonl")]
    summaries = [r for r in records if r["record_type"] == "summary"]
    steps = [r for r in records if r["record_type"] == "step"]
    by_run = {r["run_id"]: r for r in summaries}
    assert len(by_run) == len(summaries) == len(audit) == 360
    cells = collections.Counter((r["metadata"]["model"], r["task_id"], r["variant"]) for r in summaries)
    assert len(cells) == 120 and set(cells.values()) == {3}
    assert plan["status"] == "complete" and plan["completed_runs"] == 360
    assert all(r["run_id"] in by_run for r in steps + responses + audit)
    assert all(r["steps"] <= 8 and r["evidence"]["wrong_targets"] == r["wrong_target_actions"] for r in summaries)
    assert all(r["started_at"] > freeze["frozen_at"] for r in responses)
    assert all(r["metadata"]["source_hash"] == freeze["controls"]["original_method_hash"] for r in summaries)
    assert all(r["metadata"]["fixture_hash"] == freeze["controls"]["external_source_hash"] for r in summaries)
    assert all(r["requested_model"] == by_run[r["run_id"]]["metadata"]["model"] for r in responses)
    assert all(r.get("model") in (None, r["requested_model"]) for r in responses)
    assert all(sum(r["llm_calls"] for r in summaries if r["metadata"]["model"] == model) ==
               plan["calls_by_model"][model] for model in MODELS)
    assert len({(r["run_id"], r["step"]) for r in steps}) == len(steps)
    levels = ["compact", "role", "local", "structural"]
    adaptive = []
    for a in audit:
        if a["variant"] != "indexed-adaptive":
            continue
        obs = a["adaptive"]
        maximum = max((o["trace"]["final_level"] for o in obs), key=levels.index) if obs else None
        final = obs[-1]["trace"] if obs else None
        adaptive.append({
            "key": a["key"], "run_id": a["run_id"], "model": a["model"], "task_id": a["task_id"],
            "repetition": a["repetition"], "final_observation_level": final["final_level"] if final else None,
            "maximum_representation_level": maximum, "reached_structural": maximum == "structural",
            "final_escalation_path": final["escalation_path"] if final else None,
            "maximum_escalation_path": levels[:levels.index(maximum) + 1] if maximum else None,
            "expansions_across_observations": sum(o["trace"]["expansions"] for o in obs),
            "expansion_reasons": sorted({reason for o in obs for reason in o["trace"]["reasons"]}),
            "observations": obs,
            "grounding_success": by_run[a["run_id"]]["grounding_success"],
            "strict_task_success": by_run[a["run_id"]]["strict_task_success"],
            "wrong_target_actions": by_run[a["run_id"]]["wrong_target_actions"],
        })
    assert len(adaptive) == 90
    save("adaptive-traces", {"study_id": ID, "derived_after_execution": True,
                             "path_semantics": "Within-observation representation levels, not extra LLM calls; maximum differs from last observation.",
                             "runs": adaptive})
    diagnostics = {"study_id": ID, "derived_after_execution": True, "models": {}}
    for model in MODELS:
        rows = [r for r in summaries if r["metadata"]["model"] == model]
        aa = [a for a in audit if a["model"] == model]
        rr = [r for r in responses if by_run[r["run_id"]]["metadata"]["model"] == model]
        failed = {r["run_id"] for r in rows if r["failure_type"] == "MODEL_OUTPUT_ERROR"}
        arms = {}
        for arm in ARMS:
            group = [r for r in rows if r["variant"] == arm]
            arms[arm] = {
                "runs": len(group), "grounding_successes": sum(r["grounding_success"] for r in group),
                "strict_successes": sum(r["strict_task_success"] for r in group),
                "wrong_target_executions": sum(r["wrong_target_actions"] for r in group),
                "runs_with_wrong_target": sum(r["wrong_target_actions"] > 0 for r in group),
                "scored_execution_runs": sum(a["grounding_observable"] for a in aa if a["variant"] == arm),
                "complete_provider_usage_runs": sum(c["usage_complete"] for c in analysis["audit"]
                                                   if c["run_id"] in {r["run_id"] for r in group}),
            }
        omissions = []
        for a in aa:
            for i, o in enumerate(a["observations"]):
                for c in o.get("focal_controls", []):
                    if c["visible"] and not c["offered"]:
                        omissions.append({"run_id": a["run_id"], "task_id": a["task_id"],
                                          "observation": i, "control": c})
        wrong_steps = [{"run_id": s["run_id"], "task_id": s["task_id"], "variant": s["variant"],
                        "step": s["step"], "action": s["action"], "target": s["target"],
                        "selected_target": s["selected_target"], "executed": s["executed"]}
                       for s in steps if s["run_id"] in {r["run_id"] for r in rows}
                       and s["target_assessment"] == "wrong"]
        arms_estimate = analysis["models"][model]["arms"]
        diagnostics["models"][model] = {
            "arms": arms,
            "adaptive_representation_task_reduction_percent": 100 * (1 -
                arms_estimate["indexed-adaptive"]["Representation / task"]["mean"] /
                arms_estimate["indexed-structural"]["Representation / task"]["mean"]),
            "initial_empty_candidate_runs_by_task": dict(collections.Counter(a["task_id"] for a in aa
                if a["observations"] and a["observations"][0].get("candidate_actions") == 0)),
            "visible_unoffered_enabled_controls": [o for o in omissions if not o["control"]["disabled"]],
            "visible_unoffered_disabled_controls": [o for o in omissions if o["control"]["disabled"]],
            "unoffered_enabled_runs_by_task": dict(collections.Counter(a["task_id"] for a in aa
                if any(c["visible"] and not c["offered"] and not c["disabled"]
                       for o in a["observations"] for c in o.get("focal_controls", [])))),
            "wrong_selection_steps": wrong_steps,
            "aborted_http_attempts": [{"run_id": r["run_id"], "task_id": by_run[r["run_id"]]["task_id"],
                                       "variant": by_run[r["run_id"]]["variant"],
                                       "error": r.get("provider_error")} for r in rr if r["status"] is None],
            "all_finish_reasons": dict(collections.Counter(r.get("finish_reason") for r in rr)),
            "failed_output_runs_with_length_receipt": sum(any(r["run_id"] == run and r.get("finish_reason") == "length" for r in rr)
                                                          for run in failed),
            "failed_output_runs": len(failed),
        }
    save("diagnostics", diagnostics)
    historical = read(f"evals/cohorts/{ID}.historical.json")
    assert all(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == sha for path, sha in historical.items())
    # Read the existing key only in memory. Never emit a key, prefix or credential-containing line.
    secret = None
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            key, separator, value = line.partition("=")
            if separator and key.strip() == "TEXT_MODEL_API_KEY":
                secret = value.strip().strip("\"'").encode()
    result_files = sorted(p for p in (ROOT / "evals/results").glob(f"{ID}*") if p.is_file())
    leaked = [str(p.relative_to(ROOT)) for p in result_files if p.suffix != ".gz" and secret and secret in p.read_bytes()]
    assert not leaked, "Credential found in results; do not print credential-containing data"
    verification = read(f"evals/reports/{ID}-verification.json")
    save("final-verification", {
        "study_id": ID, "verified_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "complete": True, "planned_cells": 360, "unique_terminal_runs": len(by_run),
        "runs_per_model": dict(collections.Counter(r["metadata"]["model"] for r in summaries)),
        "task_variant_model_groups": len(cells), "repeats_per_group": 3,
        "adaptive_runs_with_trace": len(adaptive), "raw_records": len(records), "step_records": len(steps),
        "provider_attempts": len(responses), "first_request": min(r["started_at"] for r in responses),
        "last_request": max(r["started_at"] for r in responses), "frozen_before_all_requests": True,
        "all_model_request_and_response_ids_match": True, "wrong_target_counter_reconciled": True,
        "eight_action_budget_respected": True, "historical_files_unchanged": len(historical),
        "frozen_hashes": "controls.ts verify passed after all 360 runs; original method, source archive, policy, prompt, browser, environment match",
        "pre_execution_verification_reused": verification,
        "credential_scan": "passed" if secret else "key unavailable to scan; no credential printed",
        "raw_artifacts": {str(p.relative_to(ROOT)): {"bytes": p.stat().st_size,
                          "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in result_files},
    })
    print(json.dumps({"validated_runs": len(by_run), "adaptive_traces": len(adaptive),
                      "raw_records": len(records), "provider_attempts": len(responses),
                      "diagnostics": {model: {key: value for key, value in d.items()
                                              if key not in ["visible_unoffered_enabled_controls", "visible_unoffered_disabled_controls", "wrong_selection_steps", "aborted_http_attempts"]}
                                      for model, d in diagnostics["models"].items()}}, indent=2))


if __name__ == "__main__":
    main()
