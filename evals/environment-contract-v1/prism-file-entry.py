"""Experiment-only argv/stdio relay; chooses no Prism command or reference."""
import json,pathlib,sys,time,uuid
root=pathlib.Path(__file__).resolve().parent/'command-mailbox'
key=uuid.uuid4().hex
payload={'argv':sys.argv[1:],'stdin':sys.stdin.read() if '--stdin' in sys.argv[1:] else ''}
with (root/(key+'.request')).open('x') as f:json.dump(payload,f)
deadline=time.monotonic()+40
reply=root/(key+'.reply')
while not reply.exists():
 if time.monotonic()>deadline:raise SystemExit('Prism command adapter timeout; no retry')
 time.sleep(.02)
r=json.loads(reply.read_text());sys.stdout.write(r['stdout']);sys.stderr.write(r['stderr']);raise SystemExit(r['exit'])
