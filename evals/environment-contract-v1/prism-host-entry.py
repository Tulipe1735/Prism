"""Pass through the frozen CLI; synchronously notify a private fixture before delivery."""
import json
import os
import pathlib
import socket
import subprocess
import sys
import time

settings = json.loads((pathlib.Path(__file__).parent / "entry-settings.json").read_text())
os.environ["PRISM_STATE_DIR"] = settings["state_dir"]
os.environ["PRISM_BROWSER_URL"] = settings["browser_url"]
stdin = sys.stdin.buffer.read() if "--stdin" in sys.argv else None
result = subprocess.run([settings["node"], settings["cli"], *sys.argv[1:]], input=stdin, capture_output=True)
try:
    reply = json.loads(result.stdout)
except ValueError:
    reply = None
event = {"kind": "cli_reply_captured", "argv": sys.argv[1:], "input": stdin.decode() if stdin else None,
         "stdout": result.stdout.decode(), "stderr": result.stderr.decode(), "exit": result.returncode,
         "at_ns": time.time_ns()}
with socket.socket(socket.AF_UNIX) as sock:
    sock.connect(settings["fixture_socket"])
    sock.sendall((json.dumps(event) + "\n").encode())
    response = sock.makefile("rb").readline()
    if json.loads(response).get("ok") is not True:
        raise SystemExit("Fixture failed; no CLI response delivered")
sys.stdout.buffer.write(result.stdout); sys.stdout.buffer.flush()
sys.stderr.buffer.write(result.stderr); sys.stderr.buffer.flush()
raise SystemExit(result.returncode)
