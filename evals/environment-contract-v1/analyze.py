"""Independent post-hoc analysis of the frozen zero-model qualification records."""
import collections
import datetime
import hashlib
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'work/environment-contract-2026-10-05'
def load(p): return json.loads(p.read_text())
def rows(p): return [json.loads(x) for x in p.read_text().splitlines() if x.strip()]
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,v):
    with p.open('x') as f: json.dump(v,f,ensure_ascii=False,indent=2); f.write('\n')
rs=rows(OUT/'qualification/records.jsonl')
tasks=load(OUT/'tasks.json')
issues=[]
for r in rs:
    t=next(t for t in tasks if t['id']==r['task_id'])
    relevant=[e for e in r.get('events',[]) if (e.get('correct') or e.get('wrong')) and e['type'] in (['input','change'] if t['operation'] in ['fill','select'] else ['click'])]
    correct=any(e.get('correct') and (t['operation']!='select' or e.get('value')==t['option']) for e in relevant)
    wrong=any(r['condition']=='wrong' and (e.get('wrong') or t['operation']=='select') and not correct for e in relevant)
    if r['actual_input']!=bool(relevant) or r['correct_target_input']!=correct or r['wrong_target_input']!=wrong or r['goal_attained']!=bool(r['after_goal'] and correct): issues.append([r['task_id'],r['condition'],'oracle recomputation'])
    receipt=r.get('queried_receipt')
    if receipt and (receipt!=r['reply']['data']['receipt'] or (receipt['outcome']=='executed')!=bool(relevant)): issues.append([r['task_id'],r['condition'],'receipt comparison'])
    if 'replay_reply' in r and (r['replay_reply']['data']['receipt']!=receipt or r['before_replay']!=r['after_replay']): issues.append([r['task_id'],'replay'])

# Preserve the treatment in a second signature. The earlier 18-class audit erased it.
old=rows(ROOT/'work/cli-contract-v1-2026-10-05/model-final/model-records.jsonl')
full=set(); base=set()
for r in old:
    p=json.loads(r['request_body']['messages'][1]['content']); o=p['observation']
    o.update(session='issued-session',observation='issued-observation',evidence='issued-evidence');o['page']['url']='opaque-owned-page'
    for i,t in enumerate(o['targets']): t['ref']=f'candidate-{i+1}'
    full.add(json.dumps(p,sort_keys=True,separators=(',',':')))
    for t in o['targets']: t['belongs_to']='treatment-binding'
    base.add(json.dumps(p,sort_keys=True,separators=(',',':')))

structure={
 'condiment-lettuce':('named-checkbox; group qualifier redundant',False),
 'composer-tab':('uniquely named tab',False),
 'postcard-message':('uniquely labeled message textbox',False),
 'checkbox-first':('ordinal unlabeled checkbox',False),
 'dropdown-two':('native select option identity',False),
 'speed-menu':('named menu using nearby local text',False),
 'gecko-filter':('repeated Search textbox; group identity necessary',True),
 'signin-password':('password input excluded by current extractor',False),
}
sigs=[]
for t in tasks:
    r=next(r for r in rs if r['task_id']==t['id'] and r['condition']=='neutral')
    semantic={'goal':t['goal'],'operation':t['operation'],'value':t['value'],'option':t['option'],'initial_goal':r['before_goal'],'target_label':r.get('target',{}).get('label') if r.get('target') else None,'target_role':r.get('target',{}).get('role') if r.get('target') else None,'required_relation':t['relation_text'] if structure[t['id']][1] else None,'structure':structure[t['id']][0]}
    sigs.append({'task_id':t['id'],'family':t['family'],'source_path':t['path'],'source_sha256':sha(OUT/'sources'/t['path']),'reused_source':t['reused_source'],'semantic':semantic,'signature':hashlib.sha256(json.dumps(semantic,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),'offered':r['offered'],'relation_exposure':r['relation_exposure'],'relation_necessary':structure[t['id']][1],'model_relation_qualified':bool(r['offered'] and structure[t['id']][1] and r['relation_exposure'].get('relations'))})
save(OUT/'semantic-signatures.json',{'kind':'post-hoc semantic construct audit before any future model call','tasks':sigs,'unique_goal_signatures':len({s['signature'] for s in sigs}),'independent_page_sources':len({t['path'] for t in tasks}),'families':len({t['family'] for t in tasks}),'relation_qualified':sum(s['model_relation_qualified'] for s in sigs),'interpretation':'Eight distinct goals on eight pages are not eight independent relational mechanisms or a random website population.'})

by_condition=[]
for c in dict.fromkeys(r['condition'] for r in rs):
    cell=[r for r in rs if r['condition']==c]
    by_condition.append({'condition':c,'n':len(cell),'offered':sum(r['offered'] for r in cell),'actual_inputs':sum(r['actual_input'] for r in cell),'wrong_inputs':sum(r['wrong_target_input'] for r in cell),'goal_by_primary_oracle':sum(r['goal_attained'] for r in cell),'unsupported':sum(r['status']=='unsupported' for r in cell),'receipt_codes':dict(collections.Counter(r['queried_receipt']['code'] for r in cell if 'queried_receipt' in r))})
resources=load(OUT/'qualification/resource-errors.json')
base_inventory=load(OUT/'baseline-artifacts.json')
freeze_drift={}
for block in ['qualification','visibility-probe','oracle-probe']:
    freeze=load(OUT/block/'freeze.json')
    freeze_drift[block]=[p for p,h in freeze['files'].items() if sha(ROOT/p)!=h]
q=rows(OUT/'oracle-probe/records.jsonl')
save(OUT/'qualification-audit.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'model_requests':0,'primary_records':len(rs),'by_condition':by_condition,'receipt_queries':sum('queried_receipt' in r for r in rs),'exact_replays':sum('replay_reply' in r for r in rs),'issues':issues,'old_treatment_erased_base_conditions':len(base),'old_treatment_preserved_inputs':len(full),'old_archive_and_source_changed':[p for p,h in base_inventory.items() if sha(ROOT/p)!=h],'freeze_drift':freeze_drift,'resource_errors':len(resources),'distinct_resource_paths':len({r['url'] for r in resources}),'oracle_probe':[{'task':r['task_id'],'case':r['condition'],'actual_input':r['actual_input'],'full_goal':r['goal_attained'],'receipt':r.get('queried_receipt',{}).get('outcome')} for r in q],'important_limits':['Correct/wrong targets chosen by privileged instrument, not agent.','Seven input-level goals; DataTables full filter goal failed strengthened oracle.','Relation substring exposure is not disambiguating target-binding sufficiency.','speed-menu relation-after had no matching initialized label; mutation did not occur.','No autonomous host or decision, abstention, recovery, unknown-ack/crash tested this block.']})
print(json.dumps({'records':len(rs),'issues':issues,'base_conditions':len(base),'full_inputs':len(full),'source_drift':freeze_drift,'old_changed':[p for p,h in base_inventory.items() if sha(ROOT/p)!=h],'model_relation_qualified':sum(s['model_relation_qualified'] for s in sigs)},ensure_ascii=False))
