"""Independent post-hoc audit. Read old artifacts; write only a fresh audit directory."""
import collections
import hashlib
import json
import pathlib
import tarfile
import datetime

ROOT = pathlib.Path(__file__).resolve().parents[2]
OLD = ROOT / 'work/cli-contract-v1-2026-10-05'
OUT = ROOT / 'work/environment-contract-2026-10-05'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p): return json.loads(p.read_text())
def rows(p): return [json.loads(s) for s in p.read_text().splitlines() if s.strip()]
def save(name, value):
    with (OUT / name).open('x') as f: json.dump(value, f, ensure_ascii=False, indent=2); f.write('\n')

def artifacts():
    selected = list((ROOT/'src').rglob('*'))
    for block in ['final', 'model-final', 'selected-evidence']:
        selected += [p for p in (OLD/block).iterdir() if p.is_file()]
    selected += [OLD / name for name in ['verification.json','bundle-manifest.json','paper-bundle.tar.gz','paper-bundle.sha256']]
    selected += list((ROOT/'evals/cli-contract-v1').glob('*'))
    return {str(p.relative_to(ROOT)): sha(p) for p in selected if p.is_file()}

if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    inventory = artifacts()
    save('baseline-artifacts.json', inventory)
    issues = []
    archives = []
    for block in ['final','model-final','selected-evidence']:
        freeze = load(OLD/block/'freeze.json')
        archive = OLD/block/'source.tar.gz'
        with tarfile.open(archive) as tf:
            mismatches = [name for name,h in freeze['files'].items() if hashlib.sha256(tf.extractfile(name).read()).hexdigest()!=h]
        current = [name for name,h in freeze['files'].items() if sha(ROOT/name)!=h]
        hist = [name for name,h in freeze['historical'].items() if sha(ROOT/name)!=h]
        archives.append(dict(block=block,files=len(freeze['files']),archive_hash_ok=sha(archive)==freeze['archive']['sha256'],archive_mismatches=mismatches,current_mismatches=current,historical_mismatches=hist))
    mr = rows(OLD/'model-final/model-records.jsonl')
    semantic = []
    for r in mr:
        payload = json.loads(r['request_body']['messages'][1]['content'])
        o=payload['observation']
        o.update(session='issued-session',observation='issued-observation',evidence='issued-evidence')
        o['page']['url']='opaque-owned-page'
        for i,t in enumerate(o['targets']): t.update(ref=f'candidate-{i+1}',belongs_to='treatment-binding')
        semantic.append(json.dumps(payload,ensure_ascii=False,separators=(',',':')))
        response=json.loads(r['response_body'])
        content=response['choices'][0]['message']['content']
        decision=json.loads(content)
        if decision.get('target')!=r['choice']: issues.append([r['id'],'raw decision mismatch'])
        if response['model']!=r['returned_model'] or response['usage']!=r['usage']: issues.append([r['id'],'provider mismatch'])
        if r['abstained']!=(decision['target'] is None): issues.append([r['id'],'abstention mismatch'])
    model_table=[]
    for model,goal,arm in sorted({(r['model'],r['goal'],r['arm']) for r in mr}):
        cells=[r for r in mr if (r['model'],r['goal'],r['arm'])==(model,goal,arm)]
        model_table.append(dict(model=model,goal=goal,arm=arm,n=len(cells),correct=sum(r['first_choice_correct'] for r in cells),abstentions=sum(r['abstained'] for r in cells),valid=sum(r['valid_output'] for r in cells),actual_inputs=sum(r['actual_clicks'] for r in cells),wrong_inputs=sum(r['wrong_clicks'] for r in cells),statuses=dict(collections.Counter(r['status'] for r in cells))))
    er=rows(OLD/'final/records.jsonl')
    mechanism=[]
    for kind,cohort,goal,change,gate in sorted({(r['kind'],r['cohort'],r['goal'],r['change'],r['gate']) for r in er if r['kind']!='coverage'}):
        cells=[r for r in er if (r['kind'],r.get('cohort'),r.get('goal'),r.get('change'),r.get('gate'))==(kind,cohort,goal,change,gate)]
        for r in cells:
            p=r['page']; group=p['groups'][p['entities'].index(p['target'])]
            actual=r['after']['clicks']; correct=sum(c['entity']==p['target'] if goal=='entity' else c['group']==group for c in actual)
            if len(actual)!=r['clicks'] or correct!=r['correct_clicks'] or len(actual)-correct!=r['wrong_clicks']: issues.append([r['id'],'event scoring mismatch'])
            if (r['receipt']['outcome']=='executed')!=(len(actual)>0): issues.append([r['id'],'receipt/event mismatch'])
        mechanism.append(dict(kind=kind,cohort=cohort,goal=goal,change=change,gate=gate,n=len(cells),inputs=sum(r['clicks'] for r in cells),wrong=sum(r['wrong_clicks'] for r in cells),refused=sum(r['rejected'] for r in cells),eligible_correct=sum(r['input_eligible'] and r['choice_currently_correct'] for r in cells),false_refusal=sum(r['false_rejection'] for r in cells),attainment=sum(r['oracle_attained'] for r in cells)))
    sr=rows(OLD/'selected-evidence/scope-records.jsonl')
    scope=[]
    for goal,policy in sorted({(r['goal'],r['policy']) for r in sr}):
        cells=[r for r in sr if (r['goal'],r['policy'])==(goal,policy)]
        scope.append(dict(goal=goal,policy=policy,n=len(cells),wrong=sum(r['wrong_clicks'] for r in cells),false_refusal=sum(r['false_rejection'] for r in cells),refused=sum(r['rejected'] for r in cells),attainment=sum(r['oracle_attained'] for r in cells)))
    coverage=[]
    for family,scope_name,boundary in sorted({(r['page']['family'],r['scope'],r['page']['boundary']) for r in er if r['kind']=='coverage'}):
        fields=[f for r in er if r['kind']=='coverage' and (r['page']['family'],r['scope'],r['page']['boundary'])==(family,scope_name,boundary) for f in r['fields']]
        coverage.append(dict(family=family,scope=scope_name,boundary=boundary,fields=len(fields),entity=sum(f['exposes_entity'] for f in fields),group=sum(f['exposes_group'] for f in fields)))
    save('old-raw-audit.json',dict(kind='independent post-hoc recomputation',at=datetime.datetime.now(datetime.timezone.utc).isoformat(),archives=archives,model_records=len(mr),requests=sum(r['http_requests'] for r in mr),retries=sum(r['http_retries'] for r in mr),semantic_classes=len(set(semantic)),unique_ids=len({r['id'] for r in mr}),dispatch_records=len(rows(OLD/'model-final/dispatch.jsonl')),usage={k:sum(r['usage'][k] for r in mr) for k in ['prompt_tokens','completion_tokens','total_tokens']},model_table=model_table,mechanism=mechanism,scope=scope,coverage=coverage,issues=issues,baseline_unchanged=inventory==artifacts()))
    print(json.dumps(dict(requests=sum(r['http_requests'] for r in mr),retries=sum(r['http_retries'] for r in mr),semantic_classes=len(set(semantic)),issues=issues,archive_status=archives),ensure_ascii=False))
