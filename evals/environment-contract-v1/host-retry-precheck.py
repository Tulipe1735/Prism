"""Real Codex host, local HTTP failure fixture. Zero real-model requests; not autonomy."""
import datetime
import hashlib
import http.server
import json
import pathlib
import subprocess
import threading
ROOT=pathlib.Path(__file__).resolve().parents[2]
OUT=ROOT/'work/environment-contract-2026-10-05/host-preflight'
CODEX='/mnt/c/Users/23660/.codex/bin/wsl/095c52da468c9593/codex'
records=[]
class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body=self.rfile.read(int(self.headers.get('content-length','0')))
        records.append({'method':'POST','path':self.path,'body_bytes':len(body),'body_sha256':hashlib.sha256(body).hexdigest()})
        self.send_response(500);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(b'{"error":{"message":"local preflight failure; no model"}}')
    def do_GET(self):
        records.append({'method':'GET','path':self.path})
        self.send_response(404);self.end_headers()
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
base=f'http://127.0.0.1:{server.server_port}/v1'
config={'model_provider':'prism_local_mock','model_providers.prism_local_mock.name':'Prism local failure fixture','model_providers.prism_local_mock.base_url':base,'model_providers.prism_local_mock.requires_openai_auth':False,'model_providers.prism_local_mock.request_max_retries':0,'model_providers.prism_local_mock.stream_max_retries':0,'model_providers.prism_local_mock.supports_websockets':False,'model_providers.prism_local_mock.wire_api':'responses'}
argv=[CODEX,'exec','--skip-git-repo-check','--sandbox','read-only','--model','preflight-mock-model']
for k,v in config.items(): argv+=['--config',k+'='+json.dumps(v)]
argv+=['No tools. This is a local HTTP failure fixture.']
try:
    r=subprocess.run(argv,cwd=OUT/'codex/project',capture_output=True,text=True,timeout=25)
    status={'exit':r.returncode,'stderr_tail':r.stderr[-2200:],'stdout_bytes':len(r.stdout)}
except subprocess.TimeoutExpired:
    status={'error':'TIMEOUT; no retry by research script'}
finally: server.shutdown();server.server_close();thread.join()
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'real host with mock HTTP failure; no model decision','real_model_requests':0,'mock_requests':records,'config':config,'command':argv,'status':status,'http_retry_zero_verified':sum(x['method']=='POST' for x in records)==1,'limits':['No streaming interruption tested.','No autonomous browser task or successful model call.','Real-provider cap and network accounting still need review before any budget request.']}
with (OUT/'http-retry-precheck.json').open('x') as f: json.dump(result,f,ensure_ascii=False,indent=2);f.write('\n')
print(json.dumps({k:result[k] for k in ['real_model_requests','mock_requests','status','http_retry_zero_verified']},ensure_ascii=False))
