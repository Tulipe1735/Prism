"""Fixed Prism executor outside Codex sandbox; no model, goal, oracle or command repair."""
import argparse,json,pathlib,subprocess,time
p=argparse.ArgumentParser();p.add_argument('--project',type=pathlib.Path,required=True);a=p.parse_args()
root=a.project/'command-mailbox';seen=set()
while True:
 for request in sorted(root.glob('*.request')):
  if request.name in seen:continue
  try: payload=json.loads(request.read_text())
  except ValueError:continue # atomic publication is verified by valid JSON, not a command retry
  seen.add(request.name)
  args=payload['argv']
  if not isinstance(args,list) or not all(isinstance(s,str) for s in args):raise SystemExit('Invalid argv')
  try:
   r=subprocess.run(['/usr/bin/python3',str(a.project/'prism-entry.py'),*args],cwd=a.project,input=payload['stdin'],capture_output=True,text=True,timeout=38)
   reply={'stdout':r.stdout,'stderr':r.stderr,'exit':r.returncode}
  except subprocess.TimeoutExpired:
   reply={'stdout':'','stderr':'Prism executor timeout; no retry\n','exit':124}
  temporary=request.with_suffix('.pending')
  temporary.write_text(json.dumps(reply));temporary.rename(request.with_suffix('.reply'))
 time.sleep(.02)
