"""Post-hoc analysis of the separately frozen, zero-model readiness block."""
import hashlib
import json
import pathlib
import re
import tarfile

ROOT = pathlib.Path("work/codex-prism-readiness-2026-10-05")
QUAL = ROOT / "qualification"
rows = [json.loads(line) for line in (QUAL / "records.jsonl").read_text().splitlines()]
freeze = json.loads((QUAL / "freeze.json").read_text())
sha = lambda value: hashlib.sha256(value).hexdigest()


def candidates(view, role=None):
    result = []
    for target in view["targets"]:
        if role is not None and target.get("role") != role:
            continue
        target = dict(target)
        target.pop("ref", None)
        target["description"] = re.sub(r"^\[[^]]+\] ", "", target["description"])
        result.append(target)
    return result


analyses = []
for row in rows:
    before, after = row["public_before"], row["public_after"]
    tid = row["task_id"]
    item = {
        "task_id": tid,
        "oracle_before": row["before_goal"],
        "oracle_after": row["after_goal"],
        "input_and_receipt_agree": row["receipt_consistent"],
        "receipt_query_matches": row["receipt_query_matches"],
        "raw_normalized_reply_changed": row["public_reply_changed"],
        "public_state_keys": sorted({k for t in after["targets"] for k in t if k in {"checked", "selected", "expanded"}}),
    }
    if tid == "condiment-lettuce":
        item.update({
            "checkbox_candidates_equal_ignoring_refs": candidates(before, "checkbox") == candidates(after, "checkbox"),
            "observability": "checked state not exposed in this observed pair",
            "incidental_difference": "Open In CodePen appears after initial observation; candidate IDs shift",
            "h1_v2_role": "retained diagnostic; not a direct completion-verification task",
        })
    elif tid == "composer-tab":
        item.update({
            "observability": "indirect panel evidence; selected flag not exposed",
            "after_links": [t["label"] for t in after["targets"] if t.get("role") == "link"],
            "h1_v2_role": "retained diagnostic; original aria-selected goal lacks direct public state",
        })
    elif tid == "postcard-message":
        item.update({
            "observability": "value visible in target description",
            "public_goal_marker": [t["description"] for t in after["targets"] if t.get("operation") == "fill" and t["label"] == "Your message:"],
            "h1_v2_role": "stable task plus separately scheduled disabled condition",
        })
    elif tid == "dropdown-two":
        item.update({
            "observability": "current selected label visible in remaining select action",
            "public_goal_marker": [t["description"] for t in after["targets"] if t["operation"] == "select"],
            "h1_v2_role": "stable task",
        })
    else:
        item.update({
            "observability": "indirect menu option visibility; expanded flag not exposed",
            "after_options": [t["label"] for t in after["targets"] if t.get("role") == "option"],
            "h1_v2_role": "retained optional candidate, excluded from minimal pilot",
        })
    analyses.append(item)

current_mismatches = []
archive_mismatches = []
archive = QUAL / "source.tar.gz"
with tarfile.open(archive, "r:gz") as bundle:
    for path, expected in freeze["files"].items():
        p = pathlib.Path(path)
        if not p.exists() or sha(p.read_bytes()) != expected:
            current_mismatches.append(path)
        # tar removes a leading slash when archiving absolute source paths.
        member = bundle.extractfile(path.lstrip("/"))
        if member is None or sha(member.read()) != expected:
            archive_mismatches.append(path)

output = {
    "kind": "post-hoc analysis; does not revise frozen raw data or prior model protocol",
    "episodes": len(rows),
    "real_model_requests": sum(row["model_requests"] for row in rows),
    "autonomous_agent_episodes": 0,
    "actual_goals_attained": sum(row["goal_attained"] for row in rows),
    "receipt_event_mismatches": sum(not row["receipt_consistent"] for row in rows),
    "resource_errors": json.loads((QUAL / "resource-errors.json").read_text()),
    "typecheck": "passed; node v22.23.2, tsc --noEmit, exit 0",
    "archive_hash_matches": sha(archive.read_bytes()) == freeze["archive_sha256"],
    "archive_file_mismatches": archive_mismatches,
    "current_frozen_file_mismatches": current_mismatches,
    "limitation": "One correct preset action per page; differences alone are not proof of completion observability. No comparison with wrong/no-input states in this block; prior oracle calibration remains separate.",
    "tasks": analyses,
}
with (ROOT / "completion-analysis.json").open("x") as file:
    json.dump(output, file, ensure_ascii=False, indent=2)
    file.write("\n")
print(json.dumps({k: output[k] for k in ["episodes", "real_model_requests", "actual_goals_attained", "receipt_event_mismatches", "archive_hash_matches", "archive_file_mismatches", "current_frozen_file_mismatches"]}))
