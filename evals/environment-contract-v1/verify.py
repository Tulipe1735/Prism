"""Final integrity verification; archives remain the authority for executed code."""
import ast
import datetime
import hashlib
import json
import pathlib
import re
import tarfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'work/environment-contract-2026-10-05'
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def load(p): return json.loads(p.read_text())
def save(p,v):
    with p.open('x') as f: json.dump(v,f,ensure_ascii=False,indent=2);f.write('\n')
old=load(OUT/'baseline-artifacts.json')
old_changed=[p for p,h in old.items() if sha(ROOT/p)!=h]
blocks=[]
for name in ['development-01','development-02','qualification','visibility-probe','oracle-probe']:
    freeze=load(OUT/name/'freeze.json')
    archive=OUT/name/'source.tar.gz'
    with tarfile.open(archive) as tf:
        bad=[p for p,h in freeze['files'].items() if hashlib.sha256(tf.extractfile(p.lstrip('/')).read()).hexdigest()!=h]
    current=[p for p,h in freeze['files'].items() if sha(ROOT/p)!=h]
    blocks.append({'block':name,'archive_hash_ok':sha(archive)==freeze['archive_sha256'],'archive_file_mismatches':bad,'current_file_drift':current})
python_files=list((ROOT/'evals/environment-contract-v1').glob('*.py'))
for p in python_files: ast.parse(p.read_text(),filename=str(p))
report=ROOT/'docs/research/environment-contract-research-progress-2026-10-05.md'
missing=[]
for target in re.findall(r'\]\(([^)]+)\)',report.read_text()):
    if '://' not in target and not (report.parent/target).exists():missing.append(target)
audit=load(OUT/'qualification-audit.json')
http=load(OUT/'host-preflight/http-retry-precheck.json')
sse=load(OUT/'host-preflight/stream-retry-precheck.json')
verification={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'post-run verification, not prospective execution freeze','real_model_requests_this_round':0,'old_artifact_and_product_source_mismatches':old_changed,'execution_archives':blocks,'static_assertion_amendment':load(OUT/'post-run-type-amendment.json'),'qualification_independent_scoring_issues':audit['issues'],'python_parsed':len(python_files),'missing_local_report_links':missing,'typescript':{'command':'Node22.23.2 node_modules/typescript/bin/tsc --noEmit','exit':0,'note':'Passed after the archived TypeScript-only non-null assertion amendment.'},'existing_protocol_tests':{'command':'Node22.23.2 node_modules/vitest/vitest.mjs run tests/evals/cli-contract.test.ts tests/evals/cli-binding.test.ts','files':2,'passed':7,'exit':0},'mock_prechecks':{'http_model_posts':sum(r['method']=='POST' for r in http['mock_requests']),'sse_model_posts':sum(r['method']=='POST' for r in sse['mock_requests']),'http_zero_retry_verified':http['http_retry_zero_verified'],'stream_zero_retry_verified':sse['stream_retry_zero_verified'],'real_models':0},'limits':['Current source drift of visibility-probe.ts is explicit; archive file hashes are authoritative.','No external preregistration, autonomous host or future model run completed.','Sources locally replayed with retained missing assets; source authorship differs from researcher-defined task/oracle.']}
assert not old_changed and not missing and not audit['issues']
assert all(b['archive_hash_ok'] and not b['archive_file_mismatches'] for b in blocks)
save(OUT/'verification.json',verification)
files=list((ROOT/'src').rglob('*'))+list((ROOT/'evals/environment-contract-v1').rglob('*'))+list(OUT.rglob('*'))+[report,ROOT/'work/cli-contract-v1-2026-10-05/paper-bundle.tar.gz']
inventory={str(p.relative_to(ROOT)):sha(p) for p in files if p.is_file() and '__pycache__' not in p.parts}
save(OUT/'final-freeze.json',{'kind':'post-run final inventory; not a prospective model-run freeze','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':inventory,'original_executed_versions':'Use the per-block source.tar.gz and freeze.json; current source assertions are separately documented.'})
with tarfile.open(OUT/'evidence-bundle.tar.gz','w:gz') as tf:
    for p in inventory: tf.add(ROOT/p,arcname=p,recursive=False)
    tf.add(OUT/'final-freeze.json',arcname=str((OUT/'final-freeze.json').relative_to(ROOT)),recursive=False)
save(OUT/'bundle-manifest.json',{'archive':'evidence-bundle.tar.gz','sha256':sha(OUT/'evidence-bundle.tar.gz'),'bytes':(OUT/'evidence-bundle.tar.gz').stat().st_size,'inventory_sha256':sha(OUT/'final-freeze.json'),'old_bundle_sha256':sha(ROOT/'work/cli-contract-v1-2026-10-05/paper-bundle.tar.gz'),'real_model_requests':0})
print(json.dumps({'old_changed':old_changed,'archive_mismatches':sum(len(b['archive_file_mismatches']) for b in blocks),'current_drift':{b['block']:b['current_file_drift'] for b in blocks if b['current_file_drift']},'python_parsed':len(python_files),'local_links_missing':missing,'bundle_bytes':(OUT/'evidence-bundle.tar.gz').stat().st_size},ensure_ascii=False))
