"""Post-hoc audit of the frozen native Codex H1 run; no model or browser calls."""
import hashlib,json,pathlib,shlex
ROOT=pathlib.Path(__file__).resolve().parents[2]
STUDY=ROOT/'work/codex-prism-completion-2026-10-05'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def lines(p):return [json.loads(s) for s in p.read_text().splitlines() if s.strip()]
def load(p):return json.loads(p.read_text())
issues=[];episodes=[]
for block,identity in [('funded','CH1C-01'),('funded-continuation-v2','CH1C-02'),('funded-continuation-v2','CH1C-03')]:
 p=STUDY/block/identity;r=load(STUDY/'recovered/CH1C-01/result.json') if identity=='CH1C-01' else load(p/'result.json');events=lines(p/'requests/events.jsonl');host=lines(p/'host/events.jsonl')
 dispatch=[e for e in events if e['kind']=='dispatch'];responses=[e for e in events if e['kind']=='response'];requests=sorted((p/'requests').glob('request-*.json'))
 if len(dispatch)!=len(requests) or len(requests)>10:issues.append(identity+': accounting mismatch')
 usage=[];response_models=[];bodies=[]
 for req in requests:
  index=int(req.stem.split('-')[1]);d=load(req);bodies.append(d)
  if d.get('model')!='gpt-6.1-sol':issues.append(identity+': unexpected requested model')
  if sha(req)!=next(e['request_sha256'] for e in dispatch if e['index']==index):issues.append(identity+': request hash mismatch')
  resp=p/'requests'/f'response-{index:02}.bin'
  if sha(resp)!=next(e['response_sha256'] for e in responses if e['index']==index):issues.append(identity+': response hash mismatch')
  for line in resp.read_text().splitlines():
   if not line.startswith('data: '):continue
   try:ev=json.loads(line[6:])
   except ValueError:continue
   if ev.get('type')=='response.completed':
    response=ev['response'];response_models.append(response.get('model'));usage.append(response.get('usage'))
 commands=[];observations=[];actions=[]
 for c in r['commands']:
  args=c['argv'];reply=None
  try:reply=json.loads(c['stdout'])
  except ValueError:pass
  commands.append({'argv':args,'exit':c['exit'],'reply':reply})
  if args and args[0]=='observe' and reply and reply.get('ok'):observations.append(reply['data'])
  if args and args[0]=='act':
   opt={args[i]:args[i+1] for i in range(len(args)-1) if args[i].startswith('--')}
   witness=[o for o in observations if o['observation']==opt.get('--observation')]
   target=next((t for o in witness for t in o['targets'] if t['ref']==opt.get('--target')),None)
   grounded=bool(target) and ((r['task']=='postcard-message' and target['operation']=='fill' and target['label']=='Your message:' and opt.get('--value')=='Research postcard.') or (r['task']=='dropdown-two' and target['operation']=='select' and target.get('option_value')=='2'))
   goal_directed=opt.get('--operation') in ['fill','select']
   system_ref_valid=opt.get('--operation')=='wait' and bool(witness) and opt.get('--target')==witness[-1]['observation']+':wait'
   if system_ref_valid:grounded=True
   receipt=(reply or {}).get('data',{}).get('receipt');provenance=bool(witness) and opt.get('--evidence')==witness[-1]['evidence']
   actions.append({'argv':args,'target_from_observation':target,'correct_choice':grounded if goal_directed else None,'goal_directed':goal_directed,'system_ref_valid':system_ref_valid,'selected_evidence_from_same_view':provenance,'receipt':receipt})
   if not grounded or not provenance:issues.append(identity+': grounding/provenance failed')
 host_commands=[e['item'] for e in host if e.get('type')=='item.completed' and e.get('item',{}).get('type')=='command_execution']
 violations=[]
 for c in host_commands:
  shell=shlex.split(c['command'])[-1]
  if shell!='cat .agents/skills/prism/SKILL.md' and not shell.startswith('./prism '):violations.append(shell)
 final_file=p/'host/final.txt';final=final_file.read_text() if final_file.exists() else r.get('observed_final_answer')
 native=r.get('native_final') or {};native_events=native.get('events',[])
 executed=any(a['goal_directed'] and a['receipt'] and a['receipt']['outcome']=='executed' for a in actions)
 correct_input=(native.get('value')=='Research postcard.' and any(e['type']=='input' and e.get('id')=='msg' and e.get('value')=='Research postcard.' for e in native_events)) if r['task']=='postcard-message' else (native.get('value')=='2' and any(e['type']=='change' and e.get('id')=='dropdown' and e.get('value')=='2' for e in native_events))
 post=observations[-1] if len(observations)>=2 else None
 visible=None
 if post:
  visible=any('Research postcard.' in t.get('description','') for t in post['targets']) if r['task']=='postcard-message' else any('Option 2' in t.get('description','') for t in post['targets'])
 # Verify whether the returned observation was actually present in a dispatched request.
 post_marker=post['observation'] if post else None
 model_consumed_post=bool(post_marker) and any(post_marker in json.dumps(d) for d in bodies)
 refusal=any(a['receipt'] and a['receipt']['outcome']=='not_executed' for a in actions)
 refusal_seen=False
 for a in actions:
  rec=a['receipt']
  if rec and rec['outcome']=='not_executed':refusal_seen=any(rec['request_id'] in json.dumps(d) and rec['code'] in json.dumps(d) for d in bodies)
 warnings=[e.get('item',{}).get('message') for e in host if e.get('item',{}).get('type')=='error']
 episodes.append({'id':identity,'source_task':r['task'],'condition':r['condition'],'real_requests':len(requests),'http_statuses':[x['http_status'] for x in responses],'returned_models':response_models,'usage_by_request':usage,'budget_blocks':sum(e['kind']=='budget_blocked' for e in events),'commands':commands,'host_commands':host_commands,'actions':actions,'native_events':native_events,'goal':native.get('goal'),'correct_native_input':correct_input,'executed':executed,'auxiliary_waits_executed':sum(a['system_ref_valid'] and a['receipt'] and a['receipt']['outcome']=='executed' for a in actions),'refused':refusal,'refusal_feedback_in_model_input':refusal_seen,'post_action_observation_returned':post is not None,'post_action_public_goal_value':visible,'model_consumed_post_action_observation':model_consumed_post,'explicit_diagnosis':False if not final else None,'final_answer':final,'host_exit':r.get('host_exit'),'episode_finished':any(e.get('type')=='turn.completed' for e in host) and bool(final),'agent_session_close':any(c['argv'][:2]==['session','close'] for c in commands),'schedule_applied':r['schedule_applied'],'trace_protocol_violations':violations,'config_warnings':warnings,'infrastructure_errors':[e for e in events if e['kind']=='forward_error' or e['kind']=='response' and e['http_status']!=200]})
 if violations:issues.append(identity+': protocol violations')
 if identity=='CH1C-03' and (native_events or native.get('goal') or not r['schedule_applied']):issues.append(identity+': disabled schedule/input mismatch')
total=sum(e['real_requests'] for e in episodes)
if total>30:issues.append('total budget exceeded')
freeze_audit=[]
for block in ['deployment','browser-reconnect-precheck','funded','funded-continuation-v2']:
 f=load(STUDY/block/'freeze.json');missing=[];recover=[];drift=[]
 for path,digest in f['files'].items():
  q=pathlib.Path(path);q=q if q.is_absolute() else ROOT/q
  if q.exists() and sha(q)==digest:continue
  archived=STUDY/block/'method-source'/q.name
  if archived.exists() and sha(archived)==digest:recover.append(path)
  elif not q.exists():missing.append(path)
  else:drift.append(path)
 freeze_audit.append({'block':block,'frozen_files':len(f['files']),'recovered_from_archive':recover,'missing':missing,'drift':drift})
 if missing or drift:issues.append(block+': unrecovered freeze')
zero=[load(STUDY/'deployment'/x/'result.json') for x in [p.name for p in (STUDY/'deployment').iterdir() if p.is_dir()]]
report={'analysis_kind':'post-hoc current CH1C only; raw recovery after interruption and browser reconnect before remaining episodes; no old result audit','real_model_requests':total,'host_count':1,'model_count':1,'independent_semantic_goals':2,'conditions':3,'complete_episodes':sum(e['episode_finished'] for e in episodes),'correct_stable_inputs':sum(e['correct_native_input'] for e in episodes if e['condition']=='stable'),'budget_censored_episodes':sum(bool(e['budget_blocks']) for e in episodes),'explicit_refusal_diagnosis_supported':'manual review required','false_completion_claim_observed':'manual review required','false_completion_rate_estimable':False,'zero_model_blocks':{'planned':14,'raw_records':14,'scored':14,'raw_infra_errors':0,'fatal_uncompleted_conditions':2},'zero_model_results':[{'id':z['id'],'status':z['status'],'goal':z['native_final']['goal'],'receipt_code':z.get('action',{}).get('data',{}).get('receipt',{}).get('code')} for z in zero],'episodes':episodes,'freeze_audit':freeze_audit,'issues':issues}
with (STUDY/'analysis-v2.json').open('x') as f:json.dump(report,f,indent=2,ensure_ascii=False);f.write('\n')
print(json.dumps({k:report[k] for k in ['real_model_requests','complete_episodes','correct_stable_inputs','budget_censored_episodes','issues']},ensure_ascii=False))
