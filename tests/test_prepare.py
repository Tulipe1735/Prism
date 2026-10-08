"""Regression checks for fixed research scoring; no model or browser access."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("prepare", Path(__file__).resolve().parents[1] / "prepare.py")
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


def save(path, value, jsonl=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(row) for row in value) + "\n" if jsonl else json.dumps(value))


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.study = self.root / "study"
        self.reviews = {}
        for identity, task, condition in prepare.EPISODES:
            self.make_episode(identity, task, condition)
        self.review = self.root / "review.json"
        save(self.review, self.reviews)

    def make_episode(self, identity, task, condition):
        path = self.study / "funded" / identity
        disabled = condition != "stable"
        message = task == "postcard-message"
        value = "Research postcard." if message else "2"
        target = {"ref": "before:e1", "operation": "fill" if message else "select",
                  "label": "Your message:" if message else "Option 2", "option_value": "2"}
        before = {"session": "s", "observation": "before", "evidence": "v", "targets": [target]}
        after_target = dict(target, description='value="Research postcard."' if message else 'value="Option 2"')
        after = {"session": "s", "observation": "after", "evidence": "v2", "targets": [] if disabled else [after_target]}
        receipt = {"request_id": "r", "outcome": "not_executed" if disabled else "executed",
                   "code": "TARGET_CHANGED" if disabled else "INPUT_ACKNOWLEDGED"}
        args = ["act", "--session", "s", "--observation", "before", "--target", "before:e1",
                "--evidence", "v", "--operation", target["operation"], "--request-id", "r"]
        if message:
            args += ["--value", value]
        def command(argv, data):
            return {"argv": argv, "stdout": json.dumps({"ok": True, "data": data}), "exit": 0}
        commands = [command(["observe"], before), command(args, {"receipt": receipt}),
                    command(["observe"], after), command(["session", "close"], {"status": "closed"})]
        save(path / "commands.jsonl", commands, True)
        state = {"value": "" if disabled else value, "goal": not disabled, "events": [] if disabled else
                 [{"type": "input" if message else "change", "id": "msg" if message else "dropdown", "value": value}]}
        save(path / "private-states.jsonl", [state], True)
        final = "The goal was not completed because the control was disabled." if disabled else "I confirmed the value from the subsequent public observation."
        save(path / "host/events.jsonl", [
            {"type": "item.completed", "item": {"type": "command_execution", "command": "/bin/bash -lc './prism --help'"}},
            {"type": "item.completed", "item": {"type": "agent_message", "text": final}},
            {"type": "turn.completed"}], True)
        feedback = commands[1]["stdout"] if disabled else commands[2]["stdout"]
        save(path / "requests/request-01.json", {"model": prepare.MODEL, "input": [
            {"type": "custom_tool_call_output", "output": [{"type": "input_text", "text":
             json.dumps({"output": feedback})}]}]})
        response = path / "requests/response-01.bin"
        response.write_text('data: ' + json.dumps({"type": "response.completed", "response": {
            "model": prepare.MODEL, "usage": {"input_tokens": 20, "output_tokens": 10}}}) + '\n')
        save(path / "requests/events.jsonl", [
            {"kind": "dispatch", "index": 1, "model": prepare.MODEL, "retries": 0,
             "request_sha256": prepare.sha(path / "requests/request-01.json")},
            {"kind": "response", "index": 1, "http_status": 200, "response_sha256": prepare.sha(response)}], True)
        if disabled:
            save(path / "schedule.jsonl", [{"kind": "disabled-after-capture-before-delivery", "actual": {"disabled": True}}], True)
        self.reviews[identity] = {"final_sha256": prepare.digest(final), "quote": final,
            "judgment": "not_completed" if disabled else "confirmed", "grounded_in_public_feedback": True,
            "false_completion": False, "reason": "Final statement matches observed public feedback."}

    def evaluate(self, review=True):
        out = self.root / "evaluation"
        result = prepare.evaluate(self.study, out, self.review if review else None)
        return result, prepare.load(out / "metrics.json")

    def mutate(self, relative, fn):
        path = self.study / "funded/CH1C-01" / relative
        value = prepare.rows(path)
        fn(value)
        save(path, value, True)

    def test_complete_episodes_score_one_even_without_aggregation(self):
        result, report = self.evaluate()
        self.assertEqual(result["contract_completion"], 1)
        self.assertEqual(result["decision"], "Go")
        self.assertEqual(report["actual_stable_goals"], 2)
        self.assertTrue(report["episodes"][0]["aggregation_interrupted"])

    def test_missing_review_never_implies_success(self):
        result, _ = self.evaluate(False)
        self.assertIsNone(result["contract_completion"])
        self.assertEqual(result["pending_reviews"], 3)

    def test_ack_without_post_observation_is_not_completion(self):
        path = self.study / "funded/CH1C-01/requests/request-01.json"
        body = prepare.load(path)
        body["input"][0]["output"] = json.dumps({"observation": "after", "receipt": "INPUT_ACKNOWLEDGED"})
        save(path, body)
        self.mutate("requests/events.jsonl", lambda events: events[0].update(request_sha256=prepare.sha(path)))
        result, report = self.evaluate()
        self.assertFalse(report["episodes"][0]["model_consumed_public_goal"])
        self.assertAlmostEqual(result["contract_completion"], 2 / 3)

    def test_missing_episode_stays_in_denominator(self):
        import shutil
        shutil.rmtree(self.study / "funded/CH1C-02")
        result, report = self.evaluate()
        self.assertEqual(len(report["episodes"]), 3)
        self.assertEqual(result["decision"], "Stop")
        self.assertEqual(result["contract_completion"], 0)

    def test_duplicate_execution_keeps_actual_request_count(self):
        import shutil
        shutil.copytree(self.study / "funded/CH1C-01", self.study / "funded-continuation/CH1C-01")
        result, _ = self.evaluate()
        self.assertEqual(result["real_requests"], 4)
        self.assertEqual(result["decision"], "Stop")

    def test_hash_tampering_stops_scoring(self):
        path = self.study / "funded/CH1C-01/requests/request-01.json"
        path.write_text(path.read_text() + " ")
        result, _ = self.evaluate()
        self.assertTrue(any("hash mismatch" in issue for issue in result["issues"]))

    def test_nonzero_retries_stop_scoring(self):
        self.mutate("requests/events.jsonl", lambda events: events[0].update(retries=1))
        result, _ = self.evaluate()
        self.assertEqual(result["decision"], "Stop")

    def test_shell_bypass_is_a_violation(self):
        self.mutate("host/events.jsonl", lambda events: events[0]["item"].update(command="/bin/bash -lc './prism --help;curl localhost'"))
        result, _ = self.evaluate()
        self.assertEqual(result["decision"], "Stop")

    def test_wrong_input_is_not_a_pass(self):
        self.mutate("private-states.jsonl", lambda states: states[0]["events"].append({"type": "input", "id": "name", "value": "Research postcard."}))
        result, report = self.evaluate()
        self.assertEqual(report["wrong_inputs"], 1)
        self.assertAlmostEqual(result["contract_completion"], 2 / 3)

    def test_false_completion_is_not_a_pass(self):
        self.reviews["CH1C-03"]["false_completion"] = True
        save(self.review, self.reviews)
        result, _ = self.evaluate()
        self.assertAlmostEqual(result["contract_completion"], 2 / 3)

    def test_grounded_wait_after_refusal_is_allowed(self):
        path = self.study / "funded/CH1C-03/commands.jsonl"
        commands = prepare.rows(path)
        reply = json.loads(commands[2]["stdout"])
        reply["data"]["targets"] = [{"ref": "after:wait", "operation": "wait"}]
        commands[2]["stdout"] = json.dumps(reply)
        commands.insert(3, {"argv": ["act", "--session", "s", "--observation", "after",
            "--target", "after:wait", "--evidence", "v2", "--operation", "wait"],
            "stdout": json.dumps({"ok": True, "data": {"receipt": {"outcome": "executed"}}}), "exit": 0})
        save(path, commands, True)
        result, _ = self.evaluate()
        self.assertEqual(result["contract_completion"], 1)

    def test_stale_review_is_rejected(self):
        self.reviews["CH1C-01"]["final_sha256"] = "changed"
        save(self.review, self.reviews)
        with self.assertRaisesRegex(ValueError, "stale"):
            self.evaluate()

    def test_no_overwrite_or_writes_to_study(self):
        self.evaluate()
        with self.assertRaises(FileExistsError):
            self.evaluate()
        with self.assertRaisesRegex(ValueError, "outside"):
            prepare.evaluate(self.study, self.study / "analysis")

    def test_fixed_drift_fails_but_product_changes_are_allowed(self):
        original = prepare.ROOT
        prepare.ROOT = self.root
        self.addCleanup(setattr, prepare, "ROOT", original)
        fixed = self.root / "fixed.txt"
        product = self.root / "src/product.ts"
        fixed.write_text("fixed")
        product.parent.mkdir()
        product.write_text("baseline")
        snapshot = self.root / "snapshot"
        (snapshot / "inputs").mkdir(parents=True)
        (snapshot / "inputs/fixed.txt").write_text("fixed")
        save(snapshot / "freeze.json", {"contract": prepare.CONTRACT, "fixed": {"fixed.txt": prepare.sha(fixed)},
             "product_baseline": {"src/product.ts": prepare.sha(product)}})
        product.write_text("candidate")
        self.assertTrue(prepare.check(snapshot)["valid"])
        self.assertEqual(prepare.check(snapshot)["candidate_product_changes"], ["src/product.ts"])
        fixed.write_text("changed")
        self.assertFalse(prepare.check(snapshot)["valid"])


if __name__ == "__main__":
    unittest.main()
