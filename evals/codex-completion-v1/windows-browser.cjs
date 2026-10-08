// Own experimental Chrome only; never opens or closes the user's normal profile.
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),cp=require('child_process'),net=require('net');
const port=19334;
async function query(){return new Promise((done,reject)=>{const r=http.get(`http://127.0.0.1:${port}/json/version`,res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>done(JSON.parse(b)));});r.on('error',reject);r.setTimeout(800,()=>r.destroy(new Error('timeout')));});}
(async()=>{
 if(process.argv[2]==='start'){
  try{await query();throw Error('Task port already occupied; no existing browser modified');}catch(e){if(e.message.startsWith('Task port'))throw e;}
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'prism-h1c-'));
  const child=cp.spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','about:blank'],{detached:true,stdio:'ignore'});child.unref();
  let version;for(let i=0;i<30;i++){try{version=await query();break;}catch{await new Promise(r=>setTimeout(r,250));}}
  if(!version)throw Error('New browser did not start; no retry');
  console.log(JSON.stringify({pid:child.pid,profile,windows_port:port,version}));
 }else if(process.argv[2]==='relay'){
  const s=net.connect(port,'127.0.0.1');s.on('error',()=>process.exit(1));process.stdin.pipe(s);s.pipe(process.stdout);s.on('close',()=>process.exit());
 }else if(process.argv[2]==='stop'){
  const record=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
  // Terminate only the PID from this run's browser launch, including its owned children.
  cp.execFileSync('taskkill.exe',['/PID',String(record.pid),'/T','/F'],{stdio:'ignore'});
  console.log(JSON.stringify({stopped_owned_pid:record.pid,profile_retained:record.profile}));
 }else throw Error('Unknown operation');
})().catch(e=>{console.error(e.message);process.exit(1)});
