"""Frozen task-level analysis. No model calls, no outcome-driven task substitution."""
import collections
import hashlib
import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parents[2]
ID = "external-validation-v1"
MODELS = ["glm-5.3-flash", "deepseek-v4.1-flash"]
ARMS = ["indexed-local", "indexed-structural", "indexed-adaptive", "raw-selector-reference"]


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def mean(values):
    values = [v for v in values if v is not None]
    return statistics.mean(values) if values else None


def interval(values):
    values = [v for v in values if v is not None]
    if not values:
        return None
    seed = 1735

    def draw():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        return values[int((seed / 4294967296) * len(values))]

    samples = sorted(mean([draw() for _ in values]) for _ in range(2000))
    return [samples[49], samples[1949]]


def task_means(rows, metric):
    groups = collections.defaultdict(list)
    for row in rows:
        groups[row["task_id"]].append(metric(row))
    return {key: mean(values) for key, values in sorted(groups.items())}


def wilson(successes, n):
    if not n:
        return None
    z = 1.959963984540054
    p = successes / n
    d = 1 + z * z / n
    center = (p + z * z / (2 * n)) / d
    half = z * ((p * (1 - p) + z * z / (4 * n)) / n) ** 0.5 / d
    return [max(0, center - half), min(1, center + half)]


def estimate(rows, metric, binary=False):
    values = task_means(rows, metric)
    observed = [v for v in values.values() if v is not None]
    per_task_ci = {task: wilson(sum(metric(r) for r in rows if r["task_id"] == task),
                              sum(r["task_id"] == task for r in rows)) for task in values} if binary else None
    return {"mean": mean(observed), "ci95": interval(observed), "tasks": len(observed), "per_task": values,
            "per_task_wilson_ci95": per_task_ci}


def matched(rows, arm_a, arm_b, metric, selected_tasks=None):
    lookup = {(r["task_id"], r["repetition"], r["variant"]): r for r in rows}
    by_task = collections.defaultdict(list)
    for (task, repeat, arm), a in lookup.items():
        if arm != arm_a or (selected_tasks is not None and task not in selected_tasks):
            continue
        b = lookup.get((task, repeat, arm_b))
        if not b:
            continue
        va, vb = metric(a), metric(b)
        if va is not None and vb is not None:
            by_task[task].append(va - vb)
    values = {task: mean(v) for task, v in sorted(by_task.items())}
    return {"a": arm_a, "b": arm_b, "difference": mean(values.values()),
            "ci95": interval(list(values.values())), "matched_tasks": len(values),
            "matched_repeats": sum(len(v) for v in by_task.values()), "per_task": values}


def fmt(value, percent=False):
    return "n/a" if value is None else f"{value * 100:.1f}%" if percent else f"{value:,.2f}"


def format_effect(effect, percent=False):
    ci = effect["ci95"]
    return f"{fmt(effect['difference'], percent)} [{fmt(ci[0], percent)}, {fmt(ci[1], percent)}]" if ci else "n/a"


def main():
    freeze = json.loads((ROOT / f"evals/cohorts/{ID}.freeze.json").read_text())
    sidecar = json.loads((ROOT / f"evals/results/{ID}.meta.json").read_text())
    metadata = json.loads((ROOT / "evals/external/task-metadata.json").read_text())
    tasks = json.loads((ROOT / f"evals/tasks/{ID}.json").read_text())
    audit = read_jsonl(ROOT / f"evals/results/{ID}-audit.jsonl")
    responses = read_jsonl(ROOT / f"evals/results/{ID}-responses.jsonl") if (ROOT / f"evals/results/{ID}-responses.jsonl").exists() else []
    audits = {a["run_id"]: a for a in audit}
    if len(audits) != len(audit):
        raise ValueError("Duplicate external run audits")
    receipt = collections.defaultdict(list)
    for response in responses:
        receipt[response["run_id"]].append(response)
    all_rows, all_steps = [], []
    for model in MODELS:
        records = read_jsonl(ROOT / f"evals/results/{ID}-{model}.jsonl")
        all_rows.extend(r for r in records if r["record_type"] == "summary")
        all_steps.extend(r for r in records if r["record_type"] == "step")
    steps_by_run = collections.defaultdict(list)
    for step in all_steps:
        steps_by_run[step["run_id"]].append(step)
    checks = []
    cells = set()
    planned = set(freeze["controls"]["planned_cells"])
    for row in all_rows:
        key = f"{row['metadata']['model']}/{row['task_id']}/{row['variant']}/{row['repetition']}"
        if key in cells or key not in planned or row["run_id"] not in audits:
            raise ValueError(f"Invalid or incomplete cell audit: {key}")
        cells.add(key)
        rs = receipt[row["run_id"]]
        if len(rs) != row["llm_calls"]:
            raise ValueError(f"Response/call reconciliation failed: {key}")
        if any(r.get("model") not in (None, row["metadata"]["model"]) for r in rs):
            raise ValueError(f"Returned model mismatch: {key}")
        if row["metadata"]["system_prompt_hash"] != freeze["controls"]["system_prompt_hash"]:
            raise ValueError(f"Prompt drift: {key}")
        for step in steps_by_run[row["run_id"]]:
            hashes = [r["prompt_hash"] for r in rs]
            if step["llm_calls"] and step["prompt_hash"] not in hashes:
                raise ValueError(f"Request prompt reconciliation failed: {key}")
        usage_complete = all(isinstance(r.get("usage"), dict) and
                             all(isinstance(r["usage"].get(k), int) for k in
                                 ("prompt_tokens", "completion_tokens", "total_tokens")) for r in rs)
        row["provider_input_tokens"] = sum(r["usage"]["prompt_tokens"] for r in rs) if usage_complete else None
        row["provider_output_tokens"] = sum(r["usage"]["completion_tokens"] for r in rs) if usage_complete else None
        row["provider_total_tokens"] = sum(r["usage"]["total_tokens"] for r in rs) if usage_complete else None
        a = audits[row["run_id"]]
        obs = a["observations"]
        row["external_failure_domain"] = a["failure"]["domain"]
        row["grounding_observable"] = a["grounding_observable"]
        row["representation_per_observation"] = (row["representation_estimated_tokens_total"] / row["representation_observations"]
                                                   if row["representation_observations"] else None)
        row["correct_target_rate"] = row["correct_target_selections"] / row["scored_target_attempts"] if row["scored_target_attempts"] else None
        row["wrong_target_rate"] = row["wrong_target_actions"] / row["grounding_observed_actions"] if row["grounding_observed_actions"] else None
        row["invalid_action_rate"] = row["invalid_actions"] / row["attempts"] if row["attempts"] else None
        row["semantic_ambiguity_failure"] = None
        # Candidate collisions are secondary evidence, not a ground-truth ambiguity class.
        wrong_steps = [s for s in steps_by_run[row["run_id"]] if s["target_assessment"] == "wrong"]
        row["possible_semantic_ambiguity_failure"] = bool(wrong_steps and any(o.get("local_text_collisions") for o in obs))
        row["adaptive_structural_reach"] = bool(any(t["trace"]["final_level"] == "structural" for t in a["adaptive"])) if a["adaptive"] else None
        row["unoffered_visible_focal_controls"] = sum(1 for o in obs for c in o.get("focal_controls", []) if c["visible"] and not c["offered"])
        checks.append({"key": key, "run_id": row["run_id"], "response_calls": len(rs), "usage_complete": usage_complete})
    if len(audits) != len(all_rows):
        raise ValueError("Orphan external audits")
    historical = json.loads((ROOT / f"evals/cohorts/{ID}.historical.json").read_text())
    changed = [path for path, sha in historical.items() if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != sha]
    if changed:
        raise ValueError(f"Historical drift: {changed}")
    metrics = {
        "Grounding Success": lambda r: int(r["grounding_success"]),
        "Strict Task Success": lambda r: int(r["strict_task_success"]),
        "Correct Target Rate": lambda r: r["correct_target_rate"],
        "Wrong Target Rate": lambda r: r["wrong_target_rate"],
        "Invalid Action Rate": lambda r: r["invalid_action_rate"],
        "Representation / observation": lambda r: r["representation_per_observation"],
        "Representation / task": lambda r: r["representation_estimated_tokens_total"],
        "Input tokens": lambda r: r["provider_input_tokens"],
        "Output tokens": lambda r: r["provider_output_tokens"],
        "Total inference tokens": lambda r: r["provider_total_tokens"],
        "LLM calls": lambda r: r["llm_calls"],
        "Retries": lambda r: r["retries"],
        "Latency ms": lambda r: r["latency_ms"],
        "Executed steps": lambda r: r["steps"],
        "Stale events": lambda r: r["stale_events"],
        "Invalid selectors": lambda r: r["invalid_selectors"],
    }
    analysis = {"study_id": ID, "complete": cells == planned and sidecar["status"] == "complete",
                "completed": len(all_rows), "expected": 360, "models": {}, "audit": checks}
    lines = ["# External Validation Study", "", "## Experimental Setup", "",
             f"Frozen 15 tasks × 3 repeats × 4 unchanged variants × 2 models; **{len(all_rows)}/360 terminal runs**. "
             f"Freeze: {freeze['frozen_at']}. Models are analyzed separately; no pooled population.", "",
             "Node 22.23.2; Chrome for Testing 153.0.8010.12; viewport 1120×780; eight executed actions; "
             "240-second task deadline; existing HTTP/stale retries, model settings and prompts unchanged. "
             "A passive external target/DOM audit replaces private synthetic fixture annotations only. "
             "Frozen legal targets and independent state checks allow valid fill orders; wrong executions remain monotonic.", "",
             "All effects below average repeats within tasks and bootstrap tasks (2,000 seeded draws, 95% CI). "
             "Representation tokens are utf8-bytes-div-4 estimates. Inference tokens are provider receipts including retried attempts. "
             "Grounding Success follows the first scored execution definition; no-scored-execution coverage is shown separately.", "",
             "## Environment Characteristics", "",
             "Thirteen tasks replay original published component/example files byte for byte; two use live external dynamic URLs. "
             "This validates transfer to externally authored DOMs/components, not open-web or production-app generalization. "
             "DataTables 1.9.4 is deliberately reported as an old-release limitation; Bootstrap compiled examples and jQuery UI "
             "1.14.1 retain their actual layouts, scripts, validation and modal behavior. "
             "Source commits, archives, hashes, task URLs and evaluator definitions are frozen.", "",
             "| Task | Page type | DOM elements / depth, median | Candidates, median | Repeats with local collisions | Runtime structure changes |",
             "|---|---|---|---|---|---|"]
    for task in tasks:
        aa = [a for a in audit if a["task_id"] == task["id"]]
        oo = [o for a in aa for o in a["observations"] if "dom_elements" in o]
        median = lambda key: statistics.median(o[key] for o in oo) if oo else None
        lines.append(f"| {task['id']} | {metadata[task['id']]['page_type']} | {fmt(median('dom_elements'))} / {fmt(median('dom_depth'))} | {fmt(median('candidate_actions'))} | {sum(any(o.get('local_text_collisions') for o in a['observations']) for a in aa)}/{len(aa)} | {sum(a['dynamic_structure_changes'] for a in aa)} |")
    lines += ["", "Candidate, collision, dialog, hidden-element, source-family, goal-length and trajectory records are retained in the external audit JSONL. "
              "No known minimum sufficient scope is assigned. DOM structure variation is observational and includes the task's intended changes; "
              "it is not automatically a PAGE_STRUCTURE_CHANGE failure.", ""]
    scopes, contexts, totals = [], [], []
    for model in MODELS:
        rows = [r for r in all_rows if r["metadata"]["model"] == model]
        naturally_colliding = sorted({a["task_id"] for a in audit if a["model"] == model and
                                     any(o.get("local_text_collisions") for o in a["observations"])})
        model_analysis = {"completed": len(rows), "arms": {}, "contrasts": {}, "observed_collision_tasks": naturally_colliding}
        for arm in ARMS:
            group = [r for r in rows if r["variant"] == arm]
            model_analysis["arms"][arm] = {metric: estimate(group, fn, metric in ["Grounding Success", "Strict Task Success"]) for metric, fn in metrics.items()}
        for label, a, b, selected in [("structural-minus-local", ARMS[1], ARMS[0], None),
                                     ("structural-minus-local-collisions", ARMS[1], ARMS[0], naturally_colliding),
                                     ("adaptive-minus-structural", ARMS[2], ARMS[1], None)]:
            model_analysis["contrasts"][label] = {metric: matched(rows, a, b, fn, selected) for metric, fn in metrics.items()}
        contrasts = model_analysis["contrasts"]
        scopes.append(contrasts["structural-minus-local"]["Grounding Success"])
        contexts.append(contrasts["adaptive-minus-structural"]["Representation / task"])
        totals.append(contrasts["adaptive-minus-structural"]["Total inference tokens"])
        eligible = [r for r in rows if r["grounding_observable"]]
        families = collections.defaultdict(list)
        for task, diff in contrasts["structural-minus-local"]["Grounding Success"]["per_task"].items():
            families[metadata[task]["source_family"]].append(diff)
        model_analysis["source_family_sensitivity"] = {"differences": {f: mean(v) for f, v in families.items()},
                                                      "ci95": interval([mean(v) for v in families.values()])}
        model_analysis["grounding_observable_runs"] = len(eligible)
        model_analysis["failure_domains"] = dict(collections.Counter(r["external_failure_domain"] for r in rows if not r["success"]))
        model_analysis["failures"] = dict(collections.Counter(a["failure"]["category"] for a in audit if a["model"] == model and a["failure"]["category"]))
        model_analysis["adaptive_run_traces"] = [a for a in audit if a["model"] == model and a["variant"] == "indexed-adaptive"]
        analysis["models"][model] = model_analysis
    lines += ["## RQ1 — Representation Scope and Grounding", "",
              "| Model | Contrast | Grounding difference, 95% CI | Strict success difference, 95% CI | Matched tasks |",
              "|---|---|---|---|---|"]
    for model, a in analysis["models"].items():
        for name in ("structural-minus-local", "structural-minus-local-collisions"):
            c = a["contrasts"][name]
            lines.append(f"| {model} | {name} | {format_effect(c['Grounding Success'], True)} | {format_effect(c['Strict Task Success'], True)} | {c['Grounding Success']['matched_tasks']} |")
    lines += ["", "The collision subgroup uses observed descriptor collisions, potentially including distractors, not task-required structural ground truth. "
              "Per-task outcomes and focal-control coverage must be checked alongside aggregate effects. "
              "A no-attempt run lowers the planned Grounding Success endpoint but does not establish a wrong semantic target.", ""]
    for model, a in analysis["models"].items():
        lines += [f"### {model}", "", "| Task | Local grounding / strict | Structural grounding / strict | Adaptive grounding / strict | Selector grounding / strict |", "|---|---|---|---|---|"]
        for task in tasks:
            cells_text = []
            for arm in ARMS:
                group = [r for r in all_rows if r["metadata"]["model"] == model and r["variant"] == arm and r["task_id"] == task["id"]]
                cells_text.append(f"{sum(r['grounding_success'] for r in group)}/{len(group)} / {sum(r['strict_task_success'] for r in group)}/{len(group)}")
            lines.append(f"| {task['id']} | " + " | ".join(cells_text) + " |")
        lines += [""]
    lines += ["## RQ2 — Adaptive Context Expansion", "",
              "| Model | Metric | Adaptive minus Structural, 95% CI | Matched tasks |", "|---|---|---|---|"]
    for model, a in analysis["models"].items():
        for metric in metrics:
            c = a["contrasts"]["adaptive-minus-structural"][metric]
            lines.append(f"| {model} | {metric} | {format_effect(c, 'Rate' in metric or 'Success' in metric)} | {c['matched_tasks']} |")
    lines += ["", "| Model | Adaptive runs with observation | Reached Structural | Max level distribution | Mean expansions per observation |", "|---|---|---|---|---|"]
    for model, a in analysis["models"].items():
        aa = a["adaptive_run_traces"]
        observed = [r for r in aa if r["adaptive"]]
        levels = [max((t["trace"]["final_level"] for t in r["adaptive"]), key=["compact", "role", "local", "structural"].index) for r in observed]
        expansions = [t["trace"]["expansions"] for r in observed for t in r["adaptive"]]
        lines.append(f"| {model} | {len(observed)}/{len(aa)} | {levels.count('structural')}/{len(observed)} | {dict(collections.Counter(levels))} | {fmt(mean(expansions))} |")
    lines += ["", "Expansion paths and reasons are retained for every adaptive observation, including candidate-level collisions and unresolved groups. "
              "Avoiding Structural is not itself proof that sufficient context was exposed. Savings here describe representation estimates; "
              "a lower exposure estimate does not guarantee lower full inference usage. No statistical noninferiority claim is made.", "",
              "## RQ3 — Real-World Failure Analysis", ""]
    for model, a in analysis["models"].items():
        rows = [r for r in all_rows if r["metadata"]["model"] == model]
        lines += [f"### {model}", "", f"Failure domains: {a['failure_domains']}. External/prior labels: {a['failures']}.", "",
                  f"Grounding scored-execution coverage: {a['grounding_observable_runs']}/{len(rows)} runs. "
                  f"Visible task-relevant controls omitted from offered actions appeared in {sum(r['unoffered_visible_focal_controls'] > 0 for r in rows)} runs. "
                  f"Runs with at least one stale event: {sum(r['stale_events'] > 0 for r in rows)}. "
                  f"Runs with invalid selectors: {sum(r['invalid_selectors'] > 0 for r in rows)}. "
                  f"Wrong-target executions: {sum(r['wrong_target_actions'] or 0 for r in rows)}.", ""]
        sample = [a for a in audit if a["model"] == model and a["failure"]["category"]][:8]
        for item in sample:
            r = next(r for r in rows if r["run_id"] == item["run_id"])
            lines.append(f"- `{item['run_id']}`: {r['task_id']} / {r['variant']} — {item['failure']['domain']}/{item['failure']['category']}; {r['reason']}")
        lines += [""]
    lines += ["Semantic Ambiguity Failure Rate is **unknown as a primary causal rate**: these tasks have no known minimum context ground truth. "
              "The analysis artifact retains a secondary flag for wrong selections co-occurring with observed local collisions; "
              "co-occurrence does not prove that ambiguity caused the failure. Dynamic mismatch, hidden elements, page structure changes "
              "and modal interference are not automatically labeled from task type. Unseen/unsupported categories remain unestablished, not zero-risk.", "",
              "## Cross-Model Comparison", "",
              "| Model | Local grounding / strict | Structural grounding / strict | Adaptive grounding / strict | Selector grounding / strict |", "|---|---|---|---|---|"]
    for model, a in analysis["models"].items():
        lines.append(f"| {model} | " + " | ".join(f"{fmt(a['arms'][arm]['Grounding Success']['mean'], True)} / {fmt(a['arms'][arm]['Strict Task Success']['mean'], True)}" for arm in ARMS) + " |")
    lines += ["", "Each row is a separate model population. Source-family sensitivity intervals and all per-task contrasts are in the analysis JSON. "
              "Differences in output/termination behavior are separated from target selection and external environment failure.", "",
              "## Threats to Validity", "",
              "- Convenience sample of 15 tasks across four source families; shared page/library templates induce correlation beyond tasks. "
              "Task-bootstrap intervals cannot establish population-level open-web validity.",
              "- Most tasks are locally replayed published demos; there are no authenticated production workflows, transactional orders or broad app coverage. "
              "The old DataTables release and short/eight-action trajectories limit modern-DOM and long-horizon claims.",
              "- Network instability in live pages can prevent any meaningful grounding exposure. Live sources may drift; failures remain in the planned cohort. "
              "No failed tasks or completed runs are silently replaced.",
              "- The fixed action extractor can omit human-operable controls. Independent human-control preflight validates task/evaluator state "
              "without repairing the extractor or adding capabilities.",
              "- Frozen target-audit selector coverage excludes neutral controls and scores elements rather than text/option arguments. "
              "Task state independently catches wrong arguments. Intermediate successes never erase wrong executions.",
              "- Requested temperature/top_p and deterministic schedules do not guarantee provider determinism. Reasoning/output behavior and "
              "sample timing affect inference cost; model cohorts are separate and interleaved.",
              "- Passive audit/property/response recording adds timing/resource overhead. Browser behavior, prompts, retry logic and policy are unchanged.",
              "- Representation token estimates are not exact tokenizer counts; only complete provider receipts support full usage estimates. "
              "Three repeats and zero-event samples cannot establish noninferiority or zero wrong-target population risk. "
              "All-zero task-bootstrap intervals can be degenerate; per-task grounding/strict Wilson intervals are included in the analysis JSON.", "",
              "## Claim Ledger", ""]
    def scope_status(effect):
        if effect["difference"] is None:
            return "Unknown"
        if effect["ci95"][0] > 0:
            return "Supported"
        if effect["difference"] > 0:
            return "Partially supported"
        if effect["ci95"][1] < 0:
            return "Not supported"
        return "Unknown"
    scope = [scope_status(e) for e in scopes]
    context = ["Supported" if e["ci95"] and e["ci95"][1] < 0 else "Unknown" for e in contexts]
    total = ["Supported" if e["ci95"] and e["ci95"][1] < 0 and e["matched_tasks"] == 15 else "Unknown" for e in totals]
    analysis["claim_ledger"] = {"structural_grounding_benefit": dict(zip(MODELS, scope)),
                               "adaptive_representation_savings": dict(zip(MODELS, context)),
                               "adaptive_total_inference_advantage": dict(zip(MODELS, total)),
                               "noninferiority": "Unknown", "open_web_generalization": "Unknown", "production_readiness": "Unknown"}
    lines += ["| Claim | GLM | DeepSeek | Limit |", "|---|---|---|---|",
              f"| Structural improves grounding over Local | {scope[0]} | {scope[1]} | These tasks and observed collisions only; see per-task effects |",
              f"| Adaptive reduces representation exposure vs Structural | {context[0]} | {context[1]} | Estimated representation cost, not full inference cost |",
              f"| Adaptive reduces total inference usage vs Structural | {total[0]} | {total[1]} | Complete receipts and matched CI required |",
              "| Adaptive has statistically noninferior reliability | Unknown | Unknown | No preregistered noninferiority margin |",
              "| Local is sufficient whenever labels are locally distinguishable | Unknown | Unknown | External minimum sufficient scope is not known |",
              "| Open-web generalization / universal superiority / production readiness | Unknown | Unknown | Outside this sample and study design |", "",
              "The descriptive reliability/context tradeoff must be assessed from grounding, wrong targets and exposure together. "
              "Future work should broaden independent application families, stabilize external deployments without changing this frozen method, "
              "evaluate authenticated and longer workflows in a separate study, and preregister reliability margins. "
              "Any extractor/policy/browser improvement belongs to a new version, not these results.", "",
              f"Integrity: {len(cells)} unique planned cells; {len(historical)} historical files checked with no drift; "
              f"{len(responses)} response attempts reconciled to raw run calls and request prompt hashes. "
              "Frozen hash verification is performed by the study controls command. Full analysis and result inventories accompany this report.", ""]
    if not analysis["complete"]:
        lines.insert(2, "**Incomplete cohort: all claim upgrades are provisional/unknown until missing cells are resolved.**")
        analysis["claim_ledger"] = {key: "Unknown — incomplete cohort" for key in analysis["claim_ledger"]}
    (ROOT / f"evals/reports/{ID}-analysis.json").write_text(json.dumps(analysis, indent=2) + "\n")
    (ROOT / f"evals/reports/{ID}.md").write_text("\n".join(lines))
    artifacts = [p for p in (ROOT / "evals/results").glob(f"{ID}*") if p.is_file()]
    inventory = {str(p.relative_to(ROOT)): {"sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size} for p in sorted(artifacts)}
    integrity = {"complete": analysis["complete"], "unique_cells": len(cells), "historical": {"checked": len(historical), "changed": changed},
                 "http_attempts": len(responses), "artifacts": inventory, "usage_complete_runs": sum(c["usage_complete"] for c in checks)}
    (ROOT / f"evals/reports/{ID}-integrity.json").write_text(json.dumps(integrity, indent=2) + "\n")
    print(json.dumps({"complete": analysis["complete"], "runs": len(all_rows), "claims": analysis["claim_ledger"]}, indent=2))


if __name__ == "__main__":
    main()
