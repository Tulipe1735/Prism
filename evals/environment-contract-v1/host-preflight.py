"""Host-native skill discovery and standalone CLI help. Never create a model turn."""
import datetime
import hashlib
import json
import pathlib
import selectors
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'work/environment-contract-2026-10-05/host-preflight'
NODE = '/home/tulipe/.nvm/versions/node/v22.23.2/bin/node'
CODEX = '/mnt/c/Users/23660/.codex/bin/wsl/095c52da468c9593/codex'
OPEN = '/mnt/c/Users/23660/AppData/Roaming/npm/opencode'

def simple(argv, cwd=ROOT):
    try:
        r = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=25)
        return {'exit': r.returncode, 'stdout': r.stdout, 'stderr': r.stderr}
    except subprocess.TimeoutExpired:
        return {'error': 'TIMEOUT; no retry'}

report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'model_requests': 0,
          'autonomous_integration': False, 'allowed_methods': ['initialize', 'initialized', 'skills/list', 'command/exec'],
          'skill_sha256': hashlib.sha256((ROOT/'skills/prism/SKILL.md').read_bytes()).hexdigest()}
report['versions'] = {name: simple([path, '--version']) for name, path in [('codex', CODEX), ('opencode', OPEN), ('claude', '/mnt/c/Users/23660/AppData/Roaming/npm/claude')]}
project = OUT/'codex/project'
p = subprocess.Popen([CODEX, 'app-server'], cwd=project, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
sel = selectors.DefaultSelector()
sel.register(p.stdout, selectors.EVENT_READ, 'stdout')
sel.register(p.stderr, selectors.EVENT_READ, 'stderr')
buffers = {'stdout': b'', 'stderr': b''}
responses = {}
notifications = []
requests = []

def send(i, method, params=None):
    request = {'method': method}
    if i is not None: request['id'] = i
    if params is not None: request['params'] = params
    requests.append(request)
    p.stdin.write((json.dumps(request)+'\n').encode()); p.stdin.flush()

def receive(i):
    deadline = time.monotonic()+25
    while i not in responses and time.monotonic()<deadline:
        for key, _ in sel.select(max(0, min(1, deadline-time.monotonic()))):
            chunk = __import__('os').read(key.fileobj.fileno(), 65536)
            if not chunk:
                sel.unregister(key.fileobj)
                continue
            kind = key.data
            buffers[kind] += chunk
            if kind == 'stdout':
                while b'\n' in buffers[kind]:
                    line, buffers[kind] = buffers[kind].split(b'\n', 1)
                    try: msg = json.loads(line)
                    except ValueError: continue
                    if 'id' in msg: responses[msg['id']] = msg
                    else: notifications.append(msg.get('method'))
    return responses.get(i, {'error': {'message': 'TIMEOUT; no retry'}})

try:
    send(1, 'initialize', {'clientInfo': {'name': 'prism-research-preflight', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
    report['codex_initialize'] = receive(1)
    send(None, 'initialized')
    send(2, 'skills/list', {'cwds': [str(project)], 'forceReload': True})
    skills = receive(2)
    def prism_only(v):
        if isinstance(v, dict):
            if v.get('name') == 'prism': return [v]
            return sum((prism_only(x) for x in v.values()), [])
        if isinstance(v, list): return sum((prism_only(x) for x in v), [])
        return []
    report['codex_skill_discovery'] = {'prism': prism_only(skills), 'error': skills.get('error'), 'other_skills_omitted': True}
    send(3, 'command/exec', {'command': [NODE, '--experimental-strip-types', '--disable-warning=ExperimentalWarning', str(ROOT/'src/interfaces/cli.ts'), '--help'], 'cwd': str(ROOT), 'timeoutMs': 15000, 'outputBytesCap': 24000, 'sandboxPolicy': {'type': 'readOnly', 'networkAccess': False}})
    report['codex_standalone_cli'] = receive(3)
finally:
    p.terminate()
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: p.kill(); p.wait()
    sel.close()
    report['codex_notification_methods'] = notifications
    # Do not persist inherited configuration, tokens, unrelated skills, or raw stderr.
    report['codex_stderr_bytes'] = len(buffers['stderr'])
    report['codex_requested_methods'] = requests

open_result = simple([OPEN, 'debug', 'skill', '--pure'], OUT/'opencode/project')
try:
    report['opencode_skill_discovery'] = {'exit': open_result['exit'], 'prism': prism_only(json.loads(open_result['stdout'])), 'other_skills_omitted': True, 'stderr_bytes': len(open_result['stderr'])}
except (ValueError, KeyError):
    report['opencode_skill_discovery'] = {'exit': open_result.get('exit'), 'error': open_result.get('error', 'non-JSON diagnostic'), 'stdout_prefix': open_result.get('stdout', '')[:800], 'stderr_prefix': open_result.get('stderr', '')[:800]}
with (OUT/'results.json').open('x') as f:
    json.dump(report, f, ensure_ascii=False, indent=2); f.write('\n')
print(json.dumps({k: v for k,v in report.items() if k in ['versions','codex_skill_discovery','opencode_skill_discovery','codex_standalone_cli']}, ensure_ascii=False))
