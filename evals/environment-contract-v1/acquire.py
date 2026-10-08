"""Fetch independently authored source bytes. No browser/model requests or retries."""
from pathlib import Path
import hashlib, json, urllib.request, urllib.parse, re, datetime
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'work/environment-contract-2026-10-05/sources'
OUT.mkdir(exist_ok=False)
roots={
 'apg':('https://raw.githubusercontent.com/w3c/aria-practices/main/',['content/patterns/checkbox/examples/checkbox-mixed.html','content/patterns/tabs/examples/tabs-manual.html']),
 'mdn':('https://raw.githubusercontent.com/mdn/learning-area/main/',['html/forms/html-form-structure/payment-form.html','html/forms/postcard-example/index.html']),
 'internet':('https://raw.githubusercontent.com/saucelabs/the-internet/master/',['views/checkboxes.erb','views/dropdown.erb']),
}
log=[]; downloaded=set()
def get(family,base,path):
 if (family,path) in downloaded: return
 downloaded.add((family,path)); url=urllib.parse.urljoin(base,path)
 try:
  with urllib.request.urlopen(url,timeout=25) as r: data=r.read(); status=r.status
  dest=OUT/family/path; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(data)
  log.append(dict(family=family,path=path,url=url,status=status,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data)))
  if path.endswith('.html'):
   text=data.decode()
   for dep in re.findall(r'(?:src|href)=["\']([^"\']+\.(?:js|css))["\']',text):
    if not dep.startswith(('http:', 'https:', '//')):
     target=urllib.parse.urljoin(path,dep); get(family,base,target)
 except Exception as e: log.append(dict(family=family,path=path,url=url,error=str(e)))
for family,(base,paths) in roots.items():
 for path in paths: get(family,base,path)
with (OUT/'acquisition.json').open('x') as f: json.dump(dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),source_policy='upstream branch bytes frozen by SHA256; not claiming commit pin',attempts=log),f,indent=2)
print(json.dumps(log,indent=2))
