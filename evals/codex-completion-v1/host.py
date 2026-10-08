"""Codex standalone command bridge, local failure precheck, or explicitly funded exec."""
import argparse
import hashlib
import http.server
import json
import os
import pathlib
import selectors
import subprocess
import sys
import threading
import time

CODEX = "/mnt/c/Users/23660/.codex/bin/wsl/095c52da468c9593/codex"
ROOT = pathlib.Path(__file__).resolve().parents[2]


def config(base, model="gpt-6.1-sol", project=None):
    settings = {
        "model_provider": "prism_native",
        "model_providers.prism_native.name": "Prism counted native Codex ChatGPT Responses",
        "model_providers.prism_native.base_url": base,
        "model_providers.prism_native.wire_api": "responses",
        "model_providers.prism_native.requires_openai_auth": True,
        "model_providers.prism_native.request_max_retries": 0,
        "model_providers.prism_native.stream_max_retries": 0,
        "model_providers.prism_native.supports_websockets": False,
        "model": model,
        "web_search": "disabled",
        "features.plugins": False, "features.apps": False,
        "features.browser_use": False, "features.computer_use": False,
        "features.multi_agent": False, "features.memories": False,
        "features.image_generation": False, "features.hooks": False,
        "features.unbounded_connection_retries": False,
        "model_auto_compact_token_limit": 1000000,
        "sandbox_workspace_write.network_access": True,
        "features.network_proxy": True,
        "features.responses_websockets": False,
        "features.responses_websockets_v2": False,
        "shell_environment_policy.inherit": "core",
        "shell_environment_policy.experimental_use_profile": False,
    }
    argv = []
    for key, value in settings.items():
        argv.extend(["--config", key + "=" + json.dumps(value)])
    disabled = []
    for directory in [pathlib.Path("/home/tulipe/.agents/skills"), pathlib.Path("/home/tulipe/.codex/skills"),
                      pathlib.Path("/mnt/c/Users/23660/.codex/skills")]:
        if directory.exists():
            disabled.extend(str(p) for p in directory.rglob("SKILL.md"))
    disabled = sorted(set(disabled + [str(pathlib.Path(p).resolve()) for p in disabled]))
    overrides = ",".join("{path=" + json.dumps(p) + ",enabled=false}" for p in sorted(set(disabled)))
    argv.extend(["--config", "skills.config=[" + overrides + "]"])
    return argv, settings


def bridge(project):
    overrides, _ = config("http://127.0.0.1:1/v1", "preflight-no-model", project)
    proc = subprocess.Popen([CODEX, *overrides, "app-server"], cwd=project,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ, "stdout")
    selector.register(proc.stderr, selectors.EVENT_READ, "stderr")
    buffers = {"stdout": b"", "stderr": b""}
    messages = {}

    def rpc(index, method, params):
        item = {"method": method, "params": params}
        if index is not None:
            item["id"] = index
        proc.stdin.write((json.dumps(item) + "\n").encode()); proc.stdin.flush()
        if index is None:
            return None
        deadline = time.monotonic() + 45
        while index not in messages and time.monotonic() < deadline:
            for key, _ in selector.select(0.2):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                buffers[key.data] += chunk
                if key.data == "stdout":
                    while b"\n" in buffers["stdout"]:
                        line, buffers["stdout"] = buffers["stdout"].split(b"\n", 1)
                        try:
                            message = json.loads(line)
                            if "id" in message:
                                messages[message["id"]] = message
                        except ValueError:
                            pass
        return messages.pop(index, {"error": {"message": "standalone timeout; no retry"}})
    try:
        rpc(1, "initialize", {"clientInfo": {"name": "prism-zero-bridge", "version": "2"},
                              "capabilities": {"experimentalApi": True}})
        rpc(None, "initialized", {})
        index = 2
        for line in sys.stdin:
            request = json.loads(line)
            response = rpc(index, request["method"], request["params"])
            print(json.dumps(response), flush=True)
            index += 1
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill(); proc.wait()
        selector.close()


def failure_precheck(project, output):
    records = []
    class Failure(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(404); self.end_headers()

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("content-length", "0")))
            payload = json.loads(body)
            text = json.dumps(payload)
            records.append({"path": self.path, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(),
                            "model": payload.get("model"), "authorization_present": bool(self.headers.get("Authorization")),
                            "research_oracle_markers": [x for x in ["__qualification", "CH1-01", "document.querySelector('#msg')"] if x in text],
                            "unrelated_skill_markers": [x for x in ["zotero:Zotero", "figma-design-to-code", "stripe:connect"] if x in text]})
            self.send_response(500); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(b'{"error":{"message":"local fixture; no real model"}}')
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Failure)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    overrides, settings = config(f"http://127.0.0.1:{server.server_port}/v1", "preflight-no-model", project)
    argv = [CODEX, "exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--json",
            "--sandbox", "workspace-write", *overrides, "This is a local failure fixture. Do not execute tools."]
    try:
        result = subprocess.run(argv, cwd=project, capture_output=True, text=True, timeout=35)
        status = {"exit": result.returncode, "stdout": result.stdout, "stderr_bytes": len(result.stderr)}
    except subprocess.TimeoutExpired:
        status = {"error": "TIMEOUT; no retry"}
    finally:
        server.shutdown(); server.server_close()
    report = {"real_model_requests": 0, "mock_posts": records, "settings": settings,
              "command": argv, "status": status, "one_mock_post": len(records) == 1,
              "no_known_oracle_or_unrelated_skill_markers": all(not r["research_oracle_markers"] and not r["unrelated_skill_markers"] for r in records)}
    with output.open("x") as file:
        json.dump(report, file, indent=2); file.write("\n")
    print(json.dumps({k: report[k] for k in ["real_model_requests", "mock_posts", "one_mock_post", "no_known_oracle_or_unrelated_skill_markers"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["bridge", "failure-precheck", "funded"])
    parser.add_argument("--project", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--base-url")
    parser.add_argument("--prompt", type=pathlib.Path)
    parser.add_argument("--authorized-total", type=int)
    args = parser.parse_args()
    if args.mode == "bridge":
        bridge(args.project)
    elif args.mode == "failure-precheck":
        failure_precheck(args.project, args.output)
    else:
        if args.authorized_total != 30 or not args.base_url or not args.prompt or not args.output:
            raise SystemExit("Explicit funded configuration missing; no model request")
        overrides, settings = config(args.base_url, project=args.project)
        argv = [CODEX, "exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--json",
                "--sandbox", "workspace-write", *overrides, "--output-last-message", str(args.output / "final.txt"), "-"]
        args.output.mkdir()
        (args.output / "host-command.json").write_text(json.dumps({"argv": argv, "settings": settings}, indent=2))
        with (args.output / "events.jsonl").open("x") as stdout, (args.output / "stderr.txt").open("x") as stderr:
            try:
                result = subprocess.run(argv, input=args.prompt.read_bytes(), cwd=args.project,
                                        stdout=stdout, stderr=stderr, timeout=240)
                code = result.returncode
            except subprocess.TimeoutExpired:
                code = "TIMEOUT; no retry"
        (args.output / "exit.json").write_text(json.dumps({"exit": code}) + "\n")
