"""One Responses provider, one episode, ten counted requests, zero forwarding retries."""
import argparse
import datetime
import hashlib
import http.client
import http.server
import json
import os
import base64
import pathlib
import re
import threading
import urllib.parse
import urllib.request


class Gate:
    def __init__(self, upstream, model, limit, output, key=""):
        self.upstream = urllib.parse.urlsplit(upstream)
        self.model, self.limit, self.output, self.key = model, limit, pathlib.Path(output), key
        self.lock = threading.Lock()
        self.count = 0
        self.output.mkdir()

    def connection(self):
        # Match this host's existing HTTPS proxy. Credentials stay in memory.
        proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
        if self.upstream.scheme == "https" and proxy:
            p = urllib.parse.urlsplit(proxy)
            if p.scheme != "http":
                raise ValueError("Only existing HTTP CONNECT proxy supported")
            connection = http.client.HTTPSConnection(p.hostname, p.port, timeout=90)
            tunnel_headers = {}
            if p.username:
                token = base64.b64encode((urllib.parse.unquote(p.username)+":"+urllib.parse.unquote(p.password or "")).encode()).decode()
                tunnel_headers["Proxy-Authorization"] = "Basic " + token
            connection.set_tunnel(self.upstream.hostname, self.upstream.port or 443, headers=tunnel_headers)
            return connection
        cls = http.client.HTTPSConnection if self.upstream.scheme == "https" else http.client.HTTPConnection
        return cls(self.upstream.hostname, self.upstream.port, timeout=90)

    def event(self, value):
        with self.lock:
            with (self.output / "events.jsonl").open("a") as file:
                file.write(json.dumps(value) + "\n")

    def handler(self):
        gate = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reject(self, code, message):
                body = json.dumps({"error": {"message": message}}).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                gate.event({"kind": "non_inference_get", "path": self.path, "forwarded": False})
                self.reject(404, "Only the frozen Responses route is available")

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                try:
                    parsed = json.loads(body)
                except ValueError:
                    self.reject(400, "Invalid JSON; not forwarded")
                    return
                if self.path not in ["/v1/responses", "/v1/responses/compact"] or parsed.get("model") != gate.model:
                    gate.event({"kind": "route_or_model_blocked", "path": self.path, "forwarded": False})
                    self.reject(403, "Outside the frozen route/model; not forwarded")
                    return
                with gate.lock:
                    if gate.count >= gate.limit:
                        index = None
                    else:
                        gate.count += 1
                        index = gate.count
                if index is None:
                    gate.event({"kind": "budget_blocked", "forwarded": False})
                    self.reject(429, "Episode request budget exhausted; not forwarded")
                    return
                (gate.output / f"request-{index:02}.json").write_bytes(body)
                event = {"kind": "dispatch", "index": index, "path": self.path,
                         "model": parsed["model"], "at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                         "request_sha256": hashlib.sha256(body).hexdigest(), "retries": 0}
                gate.event(event)
                connection = None
                response_body = bytearray()
                try:
                    connection = gate.connection()
                    path = gate.upstream.path.rstrip("/") + self.path.removeprefix("/v1")
                    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
                    # Preserve native Codex authentication in memory only. Never record headers.
                    for name in ["Authorization", "ChatGPT-Account-Id", "OpenAI-Beta", "originator", "session_id", "User-Agent", "x-codex-turn-state"]:
                        if self.headers.get(name):
                            headers[name] = self.headers[name]
                    if gate.key:
                        headers["Authorization"] = "Bearer " + gate.key
                    connection.request("POST", path, body=body, headers=headers)
                    response = connection.getresponse()
                    self.send_response(response.status)
                    self.send_header("Content-Type", response.getheader("Content-Type", "application/json"))
                    self.end_headers()
                    while chunk := response.read1(65536):
                        response_body.extend(chunk)
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    gate.event({"kind": "response", "index": index, "http_status": response.status,
                                "response_sha256": hashlib.sha256(response_body).hexdigest()})
                except Exception as error:
                    # No retry and no raw exception (it can include upstream or credential data).
                    gate.event({"kind": "forward_error", "index": index, "error_type": type(error).__name__})
                finally:
                    (gate.output / f"response-{index:02}.bin").write_bytes(response_body)
                    if connection:
                        connection.close()
        return Handler


def precheck(out):
    out.mkdir()
    received = []

    class Upstream(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            received.append(body)
            data = b'data: {"type":"response.completed","response":{"model":"frozen-mock","usage":{"input_tokens":1,"output_tokens":1}}}\n\n'
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write(data)

    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    gate = Gate(f"http://127.0.0.1:{upstream.server_port}/v1", "frozen-mock", 10, out / "gate")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), gate.handler())
    threading.Thread(target=server.serve_forever, daemon=True).start()
    statuses = []
    for index in range(11):
        req = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/v1/responses",
                                     data=json.dumps({"model": "frozen-mock", "input": str(index), "stream": True}).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                statuses.append(response.status)
                response.read()
        except urllib.error.HTTPError as error:
            statuses.append(error.code)
    # Unapproved model and route must never dispatch.
    for path, model in [("/v1/responses", "different-model"), ("/v1/chat/completions", "frozen-mock")]:
        req = urllib.request.Request(f"http://127.0.0.1:{server.server_port}{path}",
                                     data=json.dumps({"model": model}).encode())
        try:
            urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as error:
            statuses.append(error.code)
    server.shutdown(); server.server_close()
    upstream.shutdown(); upstream.server_close()
    result = {"kind": "local fixture only", "real_model_requests": 0, "forwarded_mock_requests": len(received),
              "statuses": statuses, "passed": statuses == [200]*10 + [429,403,403] and len(received) == 10,
              "limitations": ["Provider compatibility not exercised", "Host network isolation tested separately"]}
    (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--precheck", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--authorized-limit", type=int)
    parser.add_argument("--model", default="gpt-6.1-sol")
    args = parser.parse_args()
    if args.precheck:
        precheck(args.precheck)
    else:
        if args.authorized_limit != 10 or args.output is None:
            raise SystemExit("Requires explicitly authorized per-episode limit 10 and fresh output")
        gate = Gate("https://chatgpt.com/backend-api/codex", args.model, 10, args.output)
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), gate.handler())
        print(json.dumps({"base_url": f"http://127.0.0.1:{server.server_port}/v1", "limit": 10, "model": args.model}), flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
