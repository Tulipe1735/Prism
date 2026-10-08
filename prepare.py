#!/usr/bin/env python3
"""Fixed H1 inputs and offline evaluation. No browser, host, or model calls."""

import argparse
import hashlib
import json
import shlex
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = "prism-h1-completion-v1"
MODEL = "gpt-6.1-sol"
PER_EPISODE_LIMIT = 10
TOTAL_LIMIT = 30
EPISODES = (
    ("CH1C-01", "postcard-message", "stable"),
    ("CH1C-02", "dropdown-two", "stable"),
    ("CH1C-03", "postcard-message", "disabled-after-first-observe"),
)
CONTRACT = {
    "version": VERSION,
    "metric": "contract_completion",
    "direction": "higher",
    "denominator": 3,
    "independent_semantic_goals": 2,
    "host_count": 1,
    "model": MODEL,
    "per_episode_request_limit": PER_EPISODE_LIMIT,
    "total_request_limit": TOTAL_LIMIT,
    "retries": 0,
    "stable": ["grounded_action", "correct_native_input", "native_goal",
               "public_goal_value", "model_consumed_public_feedback",
               "explicit_grounded_confirmation", "session_closed", "turn_completed"],
    "disabled": ["schedule_applied", "refused", "no_native_input", "native_goal_false",
                 "model_consumed_refusal", "explicit_noncompletion_diagnosis",
                 "session_closed", "turn_completed"],
    "guards": ["request_and_response_hashes", "request_budget", "no_retries",
               "fixed_model", "no_protocol_violation", "no_infrastructure_error",
               "no_false_completion"],
    "secondary": ["actual_stable_goals", "correct_stable_inputs", "wrong_inputs",
                  "refusals", "legal_action_refusals", "abstentions", "unknown_outcomes",
                  "false_completion", "budget_censored", "incomplete", "protocol_violations",
                  "real_requests", "provider_usage", "pending_reviews"],
    "semantic_review": "Required; missing review yields null score, never inferred success.",
    "scope": "Controlled H1 feasibility, not M1, general success rate, or novelty.",
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write(path, value):
    with path.open("x") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


def files(path):
    return sorted(p for p in path.rglob("*") if p.is_file()
                  and "__pycache__" not in p.parts) if path.is_dir() else [path]


def freeze(out):
    """Copy fixed instruments and source replay; record the mutable product baseline."""
    inputs = [ROOT / name for name in ("prepare.py", "program.md", "package.json",
              "pnpm-lock.yaml", "skills/prism/SKILL.md",
              "evals/codex-completion-v1", "evals/environment-contract-v1",
              "evals/cli-contract-v1", "work/environment-contract-2026-10-05/tasks.json",
              "work/environment-contract-2026-10-05/sources")]
    paths = [p for entry in inputs for p in files(entry)]
    if any(not p.is_file() or p.is_symlink() for p in paths):
        raise ValueError("Fixed input missing or symlinked; freeze refused")
    out.mkdir(parents=True, exist_ok=False)
    fixed = {}
    for path in paths:
        relative = path.relative_to(ROOT)
        destination = out / "inputs" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, destination)
        fixed[str(relative)] = sha(destination)
        if sha(path) != fixed[str(relative)]:
            raise ValueError("Input changed while freezing; preserve this failed snapshot")
    product = {str(p.relative_to(ROOT)): sha(p) for p in files(ROOT / "src")}
    manifest = {"contract": CONTRACT, "created_at": datetime.now(timezone.utc).isoformat(),
                "kind": "input snapshot; does not authorize or execute an experiment",
                "fixed": fixed, "product_baseline": product}
    write(out / "freeze.json", manifest)
    return {"freeze": str(out), "fixed_files": len(fixed), "product_files": len(product)}


def check(out):
    manifest = load(out / "freeze.json")
    if manifest["contract"] != CONTRACT:
        raise ValueError("Evaluation contract differs from the frozen version")
    current_drift, archive_drift = [], []
    for relative, expected in manifest["fixed"].items():
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Invalid frozen path")
        for base, changes in ((ROOT, current_drift), (out / "inputs", archive_drift)):
            candidate = base / path
            if not candidate.is_file() or sha(candidate) != expected:
                changes.append(relative)
    product = {str(p.relative_to(ROOT)): sha(p) for p in files(ROOT / "src")}
    baseline = manifest["product_baseline"]
    return {"fixed_input_drift": current_drift, "snapshot_drift": archive_drift,
            "candidate_product_changes": sorted(p for p in product.keys() | baseline.keys()
                                                if product.get(p) != baseline.get(p)),
            "valid": not current_drift and not archive_drift}


def texts(value):
    """Read tool output strings, including JSON-encoded terminal output envelopes."""
    if isinstance(value, str):
        yield value
        try:
            nested = json.loads(value)
        except ValueError:
            return
        if isinstance(nested, (dict, list)):
            yield from texts(nested)
    elif isinstance(value, list):
        for item in value:
            yield from texts(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from texts(item)


def tool_feedback(body):
    for item in body.get("input", []):
        if isinstance(item, dict) and item.get("type", "").endswith("tool_call_output"):
            yield "\n".join(texts(item.get("output")))


def episode(study, identity, task, condition, reviews, input_hashes):
    issues = []

    def read(path, jsonl=False):
        if not path.is_file():
            issues.append("missing " + str(path.relative_to(study)))
            return [] if jsonl else {}
        input_hashes[str(path.relative_to(study))] = sha(path)
        return rows(path) if jsonl else load(path)

    # Continuation is part of one run. Two executions of the same ID are invalid.
    blocks = sorted(block / identity for block in study.glob("funded*")
                    if block.is_dir() and (block / identity).is_dir())
    if len(blocks) != 1:
        actual_requests = sum(e.get("kind") == "dispatch" for p in blocks
                              if (p / "requests/events.jsonl").is_file()
                              for e in rows(p / "requests/events.jsonl"))
        return {"id": identity, "task": task, "condition": condition, "passed": False,
                "pending_review": False, "real_requests": actual_requests,
                "issues": ["missing or duplicate episode execution"]}
    path = blocks[0]
    events = read(path / "requests/events.jsonl", True)
    host = read(path / "host/events.jsonl", True)
    commands = read(path / "commands.jsonl", True)
    states = read(path / "private-states.jsonl", True)
    dispatch = [e for e in events if e.get("kind") == "dispatch"]
    responses = [e for e in events if e.get("kind") == "response"]
    requests = sorted((path / "requests").glob("request-*.json"))
    indices = [e["index"] for e in dispatch]
    if indices != list(range(1, len(dispatch) + 1)) or len(requests) != len(dispatch):
        issues.append("request accounting mismatch")
    if not dispatch or len(dispatch) > PER_EPISODE_LIMIT:
        issues.append("empty run or per-episode budget exceeded")
    if len({e["index"] for e in responses}) != len(responses):
        issues.append("duplicate response index")
    feedback, usage, returned_models = [], [], []
    for event in dispatch:
        index = event["index"]
        request = path / "requests" / f"request-{index:02}.json"
        body = read(request)
        if not request.exists() or sha(request) != event.get("request_sha256"):
            issues.append("request hash mismatch")
        if body.get("model") != MODEL or event.get("model") != MODEL:
            issues.append("requested model changed")
        if event.get("retries") != 0:
            issues.append("nonzero or unrecorded retries")
        feedback.extend(tool_feedback(body))
        response = path / "requests" / f"response-{index:02}.bin"
        recorded = [r for r in responses if r["index"] == index]
        if len(recorded) != 1 or not response.is_file():
            issues.append("missing response or response record")
            continue
        input_hashes[str(response.relative_to(study))] = sha(response)
        if sha(response) != recorded[0].get("response_sha256"):
            issues.append("response hash mismatch")
        if recorded[0].get("http_status") != 200:
            issues.append("upstream HTTP failure")
        completed = []
        for line in response.read_text().splitlines():
            if line.startswith("data: "):
                try:
                    event_body = json.loads(line[6:])
                except ValueError:
                    continue
                if event_body.get("type") == "response.completed":
                    completed.append(event_body["response"])
        if len(completed) != 1:
            issues.append("response completion missing or duplicated")
        for response_body in completed:
            returned_models.append(response_body.get("model"))
            usage.append(response_body.get("usage"))
    if any(model != MODEL for model in returned_models):
        issues.append("returned model changed")
    if any(e.get("kind") == "forward_error" for e in events):
        issues.append("upstream forwarding error")

    observations, actions, post = [], [], []
    closed = False
    for command in commands:
        args = command["argv"]
        try:
            reply = json.loads(command["stdout"])
        except ValueError:
            reply = {}
        data = reply.get("data", {})
        if args[:1] == ["observe"] and reply.get("ok"):
            observations.append(data)
            if actions:
                post.append(data)
        if args[:1] == ["act"]:
            options = {args[i]: args[i + 1] for i in range(len(args) - 1)
                       if args[i].startswith("--")}
            view = next((o for o in reversed(observations)
                         if o.get("observation") == options.get("--observation")), {})
            target = next((t for t in view.get("targets", [])
                           if t.get("ref") == options.get("--target")), {})
            auxiliary = target.get("operation") in {"wait", "scroll"}
            correct = (target.get("operation") == options.get("--operation") and
                       (auxiliary or (task == "postcard-message" and target.get("operation") == "fill"
                         and target.get("label") == "Your message:"
                         and options.get("--value") == "Research postcard.") or
                        (task == "dropdown-two" and target.get("operation") == "select"
                         and target.get("option_value") == "2")))
            grounded = bool(view) and bool(target) and correct and \
                options.get("--evidence") == view.get("evidence") and \
                options.get("--session") == view.get("session")
            actions.append({"grounded": grounded, "auxiliary": auxiliary,
                            "receipt": data.get("receipt", {})})
            post = []  # Completion feedback must follow the last attempted action.
        if args[:2] == ["session", "close"] and reply.get("ok") and command["exit"] == 0:
            closed = data.get("status") == "closed"
    violations = []
    for event in host:
        item = event.get("item", {})
        if event.get("type") != "item.completed" or item.get("type") != "command_execution":
            continue
        outer = shlex.split(item["command"])
        shell_option = next((i for i, value in enumerate(outer)
                             if value in {"-c", "-lc"}), None)
        shell = outer[shell_option + 1] if shell_option is not None else item["command"]
        lexer = shlex.shlex(shell, posix=True, punctuation_chars=";&|<>")
        lexer.whitespace_split = True
        args = list(lexer)
        forbidden = any(token and set(token) <= set(";&|<>") for token in args) or \
            "\n" in shell or "$(" in shell or "`" in shell
        allowed = args == ["cat", ".agents/skills/prism/SKILL.md"] or \
            (bool(args) and args[0] == "./prism" and not forbidden)
        if not allowed:
            violations.append(shell)
    if violations:
        issues.append("host command protocol violation")

    native = states[-1] if states else {}
    native_events = native.get("events", [])
    expected_id, expected_value, expected_event = ("msg", "Research postcard.", "input") \
        if task == "postcard-message" else ("dropdown", "2", "change")
    correct_input = native.get("value") == expected_value and any(
        e.get("type") == expected_event and e.get("id") == expected_id
        and e.get("value") == expected_value for e in native_events)
    wrong_inputs = sum(e.get("type") in {"input", "change"} and
                       (e.get("id") != expected_id or e.get("value") != expected_value)
                       for e in native_events)
    public = []
    for view in post:
        for target in view.get("targets", []):
            description = target.get("description", "")
            visible = (task == "postcard-message" and target.get("operation") == "fill"
                       and target.get("label") == "Your message:"
                       and 'value="Research postcard."' in description) or \
                (task == "dropdown-two" and target.get("operation") == "select"
                 and 'value="Option 2"' in description)
            if visible:
                public.append((view["observation"], description))
    consumed_goal = any(marker in text and description in text
                        for marker, description in public for text in feedback)
    refused = any(not a["auxiliary"] and a["receipt"].get("outcome") == "not_executed"
                  for a in actions)
    consumed_refusal = any(
        receipt.get("outcome") == "not_executed" and receipt.get("request_id")
        and receipt.get("code") and receipt["request_id"] in text and receipt["code"] in text
        for action in actions for receipt in [action["receipt"]] for text in feedback)
    schedule_path = path / "schedule.jsonl"
    schedule = read(schedule_path, True) if condition != "stable" else []
    scheduled = any(s.get("kind") == "disabled-after-capture-before-delivery"
                    and s.get("actual", {}).get("disabled") is True for s in schedule)
    final = ""
    for event in host:
        if event.get("type") == "item.completed" and event.get("item", {}).get("type") == "agent_message":
            final = event["item"].get("text", "")
    turn_completed = any(e.get("type") == "turn.completed" for e in host)
    review = reviews.get(identity)
    reviewed = review is not None and all(
        key in review for key in ("final_sha256", "quote", "judgment",
                                 "grounded_in_public_feedback", "false_completion", "reason"))
    if reviewed:
        reviewed = (review["final_sha256"] == digest(final) and bool(review["quote"])
                    and review["quote"] in final and bool(review["reason"])
                    and review["judgment"] in {"confirmed", "not_completed", "incorrect"}
                    and type(review["grounded_in_public_feedback"]) is bool
                    and type(review["false_completion"]) is bool)
        if not reviewed:
            raise ValueError(f"{identity}: invalid or stale semantic review")
    expected_judgment = "confirmed" if condition == "stable" else "not_completed"
    diagnosis = reviewed and review["judgment"] == expected_judgment and \
        review["grounded_in_public_feedback"] and not review["false_completion"]
    common = bool(actions) and all(a["grounded"] for a in actions) and \
        closed and turn_completed and not issues and not wrong_inputs
    if condition == "stable":
        measurable = common and correct_input and native.get("goal") is True and \
            bool(public) and consumed_goal and any(
                not a["auxiliary"] and a["receipt"].get("outcome") == "executed" for a in actions)
    else:
        measurable = common and scheduled and refused and not native_events and \
            native.get("goal") is False and consumed_refusal
    return {"id": identity, "task": task, "condition": condition,
            "passed": bool(measurable and diagnosis),
            "pending_review": bool(final and turn_completed and not reviewed),
            "measurable_gates_passed": bool(measurable), "real_requests": len(dispatch),
            "correct_native_input": correct_input, "native_goal": native.get("goal"),
            "wrong_inputs": wrong_inputs, "refused": refused, "schedule_applied": scheduled,
            "legal_action_refusals": sum(condition == "stable" and a["grounded"] and not a["auxiliary"] and
                                         a["receipt"].get("outcome") == "not_executed"
                                         for a in actions),
            "abstained": not actions and turn_completed,
            "unknown_outcomes": sum(a["receipt"].get("outcome") == "unknown" for a in actions),
            "public_goal_value": bool(public), "model_consumed_public_goal": consumed_goal,
            "model_consumed_refusal": bool(consumed_refusal), "session_closed": closed,
            "turn_completed": turn_completed, "final_answer": final,
            "final_sha256": digest(final), "semantic_review": review,
            "budget_censored": any(e.get("kind") == "budget_blocked" for e in events),
            "aggregation_interrupted": not (path / "result.json").exists(),
            "protocol_violations": violations, "provider_usage": usage,
            "returned_models": returned_models, "issues": sorted(set(issues))}


def evaluate(study, out, review_path=None, frozen=None):
    if out.resolve().is_relative_to(study.resolve()):
        raise ValueError("Evaluation output must be outside the original study")
    reviews = load(review_path) if review_path else {}
    if set(reviews) - {e[0] for e in EPISODES}:
        raise ValueError("Review contains unknown episode IDs")
    hashes = {}
    episodes = [episode(study, *spec, reviews, hashes) for spec in EPISODES]
    notes = {}
    for name in ("interruption-recovery.json", "browser-reconnect.json"):
        path = study / name
        if path.is_file():
            notes[name] = load(path)
            hashes[name] = sha(path)
    count = sum(e["real_requests"] for e in episodes)
    integrity = check(frozen) if frozen else None
    issues = [f"{e['id']}: {issue}" for e in episodes for issue in e["issues"]]
    if count > TOTAL_LIMIT:
        issues.append("total request budget exceeded")
    if integrity and not integrity["valid"]:
        issues.append("fixed evaluation inputs changed")
    pending = sum(e["pending_review"] for e in episodes)
    passed = sum(e["passed"] for e in episodes) if not issues else 0
    report = {"contract": CONTRACT, "kind": "offline post-hoc scoring; no experiment launch",
              "study": str(study), "freeze": str(frozen) if frozen else None,
              "contract_completion": None if pending else passed / len(EPISODES),
              "passed_lower_bound": passed, "pending_reviews": pending,
              "decision": "Stop" if issues else "Pending" if pending else
                          "Go" if passed == len(EPISODES) else "Mixed",
              "real_requests": count,
              "actual_stable_goals": sum(e.get("native_goal") is True for e in episodes
                                         if e["condition"] == "stable"),
              "correct_stable_inputs": sum(e.get("correct_native_input", False) for e in episodes
                                           if e["condition"] == "stable"),
              "wrong_inputs": sum(e.get("wrong_inputs", 0) for e in episodes),
              "refusals": sum(e.get("refused", False) for e in episodes),
              "legal_action_refusals": sum(e.get("legal_action_refusals", 0) for e in episodes),
              "abstentions": sum(e.get("abstained", False) for e in episodes),
              "unknown_outcomes": sum(e.get("unknown_outcomes", 0) for e in episodes),
              "false_completion": None if pending else sum(bool(e.get("semantic_review", {}).get(
                  "false_completion")) for e in episodes if e.get("semantic_review")),
              "incomplete": sum(not e.get("turn_completed", False) for e in episodes),
              "budget_censored": sum(e.get("budget_censored", False) for e in episodes),
              "input_sha256": hashes, "review_sha256": sha(review_path) if review_path else None,
              "evaluator_sha256": sha(Path(__file__)), "integrity": integrity,
              "comparison_scope": "Case series; inspect block freezes and amendments for runtime changes.",
              "execution_notes": notes,
              "episodes": episodes, "issues": issues}
    out.mkdir(parents=True, exist_ok=False)
    write(out / "metrics.json", report)
    template = {e["id"]: {"final_sha256": e.get("final_sha256"), "quote": "",
                         "judgment": None, "grounded_in_public_feedback": None,
                         "false_completion": None, "reason": ""} for e in episodes}
    write(out / "review-template.json", template)
    return {k: report[k] for k in ("contract_completion", "passed_lower_bound",
            "pending_reviews", "decision", "real_requests", "issues")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command")
    snapshot = sub.add_parser("freeze", help="Freeze fixed inputs without running experiments")
    snapshot.add_argument("--out", type=Path, required=True)
    verify = sub.add_parser("check", help="Check frozen inputs; allow product candidates")
    verify.add_argument("--freeze", type=Path, required=True)
    score = sub.add_parser("eval", help="Score saved H1 raw records in a new directory")
    score.add_argument("--study", type=Path, required=True)
    score.add_argument("--out", type=Path, required=True)
    score.add_argument("--review", type=Path)
    score.add_argument("--freeze", type=Path)
    args = parser.parse_args()
    if args.command is None:
        result = CONTRACT
    elif args.command == "freeze":
        result = freeze(args.out.resolve())
    elif args.command == "check":
        result = check(args.freeze.resolve())
    else:
        result = evaluate(args.study.resolve(), args.out.resolve(), args.review, args.freeze)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.command == "check" and not result["valid"] or args.command == "eval" and result["issues"]:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"prepare: {error}", file=sys.stderr)
        sys.exit(1)
