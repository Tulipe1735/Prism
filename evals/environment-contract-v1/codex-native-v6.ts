import { appendFile, chmod, cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { createServer as socketServer } from "node:net";
import { join, resolve, extname, sep } from "node:path";
import { parseArgs } from "node:util";
import { connectBrowser, parseBrowserUrl } from "../../src/browser/connect.ts";
import { inspectOwnedTab } from "../cli-contract-v1/runtime.ts";

const {values} = parseArgs({options:{mode:{type:"string",default:"precheck"},"authorized-total":{type:"string"},out:{type:"string"},"build-dir":{type:"string",default:"build-v2"},smoke:{type:"boolean",default:false},"direct-zero":{type:"boolean",default:false}}});
const funded=values.mode==="funded";
const direct=values["direct-zero"]!;
if(funded && direct)throw new Error("Direct researcher control is forbidden in funded host experiment");
if(!["precheck","funded"].includes(values.mode!) || (funded && values["authorized-total"]!=="18"))
  throw new Error("Funded mode requires explicit authorized total 18; no model request dispatched");
const STUDY=resolve("work/codex-prism-native-2026-10-05");
if(funded){
  let ready:any;try{ready=JSON.parse(await readFile(join(STUDY,"ready-for-model.json"),"utf8"));}catch{}
  if(ready?.host_socket_precheck!=="passed" || ready?.network_accounting_precheck!=="passed" || ready?.budget_authorized!==true)
    throw new Error("Real Codex deployment/budget gate has not passed; no model requests dispatched");
}
if(funded){
  const first=join(STUDY,"funded/CH1-01/requests");
  const prior=(await readdir(first)).filter(p=>/^request-\d+\.json$/.test(p));
  const events=(await readFile(join(first,"events.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s));
  if(prior.length!==6 || events.filter(e=>e.kind==="response"&&e.http_status===200).length!==6 || !events.some(e=>e.kind==="budget_blocked"))throw Error("Continuation accounting precondition failed");
  for(const path of [join(STUDY,"funded/CH1-02"),join(STUDY,"funded/CH1-03"),join(STUDY,"funded-continuation")]){try{await readdir(path);throw Error("Previously started condition; retry forbidden");}catch(e:any){if(e.code!=="ENOENT")throw e;}}
}
const OUT=join(STUDY,values.out??(funded?"funded-continuation":"deployment-precheck-v2"));
await mkdir(OUT); // Never overwrite a prior experiment or failed block.
const SOURCE=resolve("work/environment-contract-2026-10-05/sources");
const BUILD=resolve("work/codex-prism-supplement-2026-10-05/build-v2");
const NODE=process.execPath;
const CODEX="/mnt/c/Users/23660/.codex/bin/wsl/095c52da468c9593/codex";
const BROWSER="http://127.0.0.1:9333";
const hash=(x:Uint8Array|string)=>createHash("sha256").update(x).digest("hex");
const save=async(p:string,x:any)=>writeFile(p,JSON.stringify(x,null,2)+"\n",{flag:"wx"});
const all=JSON.parse(await readFile("work/environment-contract-2026-10-05/tasks.json","utf8"));
const message=all.find((t:any)=>t.id==="postcard-message");
const dropdown=all.find((t:any)=>t.id==="dropdown-two");
const episodesUnfiltered=funded?[
  {id:"CH1-01",task:message,condition:"stable"},
  {id:"CH1-02",task:dropdown,condition:"stable"},
  {id:"CH1-03",task:message,condition:"disabled-after-first-observe"},
]:[
  ...[message,dropdown].flatMap(task=>["correct","wrong","neutral"].map(condition=>({id:`${task.id}-${condition}`,task,condition}))),
  {id:"postcard-message-disabled",task:message,condition:"disabled-after-first-observe"},
];
if(funded && values.smoke)throw Error("Cannot reduce funded protocol silently");
const candidates=funded?episodesUnfiltered.filter(e=>e.id!=="CH1-01"):episodesUnfiltered;
const episodes=values.smoke?candidates.slice(0,1):candidates;
await save(join(OUT,"plan.json"),{kind:"prospective local freeze",controller:funded?"real Codex host":direct?"researcher directly invokes Prism; not a Codex integration experiment":"researcher through Codex standalone command/exec",episodes,
  semantic_goals:2,conditions:funded?3:7,real_model_limit:funded?18:0,per_episode_limit:funded?6:0,retries:0,model:funded?"gpt-6.1-sol":null,
  source_replay:"Pinned prior MDN/The Internet bytes; incomplete assets retained and resource failures logged"});
const files:Record<string,string>={};
async function inventory(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())await inventory(p);else if(entry.isFile())files[p]=hash(await readFile(p));}}
await inventory("src"); await inventory(BUILD);
for(const p of ["evals/environment-contract-v1/codex-native-v6.ts","evals/environment-contract-v1/codex-native-host-v2.py","evals/environment-contract-v1/prism-host-entry.py","evals/environment-contract-v1/prism-file-entry.py","evals/environment-contract-v1/prism-file-executor.py","evals/environment-contract-v1/native-request-gate-v2.py","evals/environment-contract-v1/codex-h1-v2-protocol.md","evals/environment-contract-v1/codex-native-protocol.md","evals/environment-contract-v1/codex-native-execution-freeze.md","evals/environment-contract-v1/codex-native-continuation.md",join(STUDY,"funded/CH1-01/result.json"),join(STUDY,"funded/CH1-01/requests/events.jsonl"),join(STUDY,"authorization.json"),"package.json","pnpm-lock.yaml","skills/prism/SKILL.md","evals/cli-contract-v1/runtime.ts",CODEX,
  "work/environment-contract-2026-10-05/tasks.json","work/codex-prism-readiness-2026-10-05/qualification/freeze.json",join(OUT,"plan.json"),join(SOURCE,message.path),join(SOURCE,dropdown.path)])files[p]=hash(await readFile(p));
await save(join(OUT,"freeze.json"),{kind:"pre-execution source and method freeze",at:new Date().toISOString(),node:process.version,
  codex_version:execFileSync(CODEX,["--version"],{encoding:"utf8"}).trim(),browser:await (await fetch(BROWSER+"/json/version")).json(),files});
const resourceErrors:any[]=[];
const server=httpServer((req,res)=>void(async()=>{try{const p=resolve(SOURCE,"."+new URL(req.url!,"http://fixture").pathname);if(!p.startsWith(SOURCE+sep))throw Error("outside source");const b=await readFile(p);res.writeHead(200,{"content-type":({".html":"text/html",".erb":"text/html",".css":"text/css",".js":"text/javascript"} as any)[extname(p)]??"application/octet-stream","content-security-policy":"default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action 'none'"});res.end(b);}catch{resourceErrors.push({url:req.url,status:404});res.writeHead(404);res.end();}})());
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const connection=await connectBrowser(parseBrowserUrl(BROWSER));
const results:any[]=[];
const run=(file:string,args:string[],options:any={})=>new Promise<any>((done,reject)=>execFile(file,args,{timeout:45000,maxBuffer:3000000,...options},(e,stdout,stderr)=>{if(e)reject(new Error(`${e.message}\n${stderr}`));else done({stdout,stderr});}));
try {
 for(const episode of episodes){
  const task=episode.task;
  const out=join(OUT,episode.id); await mkdir(out);
  const project=await mkdtemp("/tmp/prism-host-");
  const state=join(project,"state"); await mkdir(state,{mode:0o700});
  await cp(BUILD,join(project,"dist"),{recursive:true});
  await mkdir(join(project,".agents/skills/prism"),{recursive:true});
  await cp("skills/prism/SKILL.md",join(project,".agents/skills/prism/SKILL.md"));
  await cp("evals/environment-contract-v1/prism-host-entry.py",join(project,"prism-entry.py"));
  await cp("evals/environment-contract-v1/prism-file-entry.py",join(project,"prism-file-entry.py"));
  await mkdir(join(project,"command-mailbox"));
  const url=origin+"/"+task.path;
  const rpcPath=`/tmp/prism-fixture-${randomUUID().slice(0,8)}.sock`;
  await save(join(project,"entry-settings.json"),{node:NODE,cli:join(project,"dist/cli.js"),fixture_socket:rpcPath,state_dir:state,browser_url:BROWSER});
  await writeFile(join(project,"prism"),"#!/bin/sh\nexec /usr/bin/python3 "+JSON.stringify(join(project,"prism-file-entry.py"))+" \"$@\"\n",{mode:0o700});
  const row:any={id:episode.id,task:task.id,condition:episode.condition,project,real_model_requests:0,controller:funded?"Codex agent":direct?"researcher directly invokes Prism; not Codex":"researcher through Codex standalone; no model",commands:[],schedule:[],private_states:[]};
  const inspect=(expr:string)=>inspectOwnedTab(connection,url,expr);
  let initialized=false,mutated=false;
  const fixture=socketServer(sock=>{
    let buffer="";
    sock.on("data",chunk=>{buffer+=chunk.toString();if(!buffer.includes("\n"))return;const event=JSON.parse(buffer.split("\n")[0]!);void(async()=>{
      try{
       let reply:any;try{reply=JSON.parse(event.stdout);}catch{}
       row.commands.push(event);await appendFile(join(out,"commands.jsonl"),JSON.stringify(event)+"\n");
       const opened=reply?.ok && typeof reply.data?.session==="string" && reply.data?.observation===undefined && event.argv.includes("open");
       if(opened && !initialized){
        await inspect(`(()=>{window.__supplementEvents=[];for(const type of ['click','input','change'])document.addEventListener(type,e=>window.__supplementEvents.push({type,id:e.target.id,value:e.target.value,correct:document.querySelector(${JSON.stringify(task.correct)}).contains(e.target),wrong:document.querySelector(${JSON.stringify(task.wrong)}).contains(e.target)}),true);})()`);
        initialized=true;
       }
       if(episode.condition==="disabled-after-first-observe" && !mutated && reply?.ok && Array.isArray(reply.data?.targets)){
        const before=process.hrtime.bigint().toString();
        const changed=await inspect(`(()=>{const e=document.querySelector(${JSON.stringify(task.correct)});e.disabled=true;e.setAttribute('aria-disabled','true');return {disabled:e.disabled,value:e.value};})()`);
        const record={kind:"disabled-after-capture-before-delivery",cli_capture_at_ns:event.at_ns,mutation_start_monotonic_ns:before,mutation_end_monotonic_ns:process.hrtime.bigint().toString(),reply_sha256:hash(event.stdout),observation:reply.data.observation,actual:changed};
        row.schedule.push(record);await appendFile(join(out,"schedule.jsonl"),JSON.stringify(record)+"\n");mutated=true;
       }
       if(initialized && !event.argv.includes("close") && !event.argv.includes("stop")){
        const snapshot=await inspect(`({goal:(${task.oracle}),events:window.__supplementEvents,value:document.querySelector(${JSON.stringify(task.correct)}).value,disabled:document.querySelector(${JSON.stringify(task.correct)}).disabled})`);
        row.private_states.push(snapshot); await appendFile(join(out,"private-states.jsonl"),JSON.stringify(snapshot)+"\n");
       }
       sock.end(JSON.stringify({ok:true})+"\n");
      }catch(e:any){row.fixture_error=e.message;sock.end(JSON.stringify({ok:false})+"\n");}
    })();});
  });
  await new Promise<void>(done=>fixture.listen(rpcPath,done));await chmod(rpcPath,0o600);
  const daemon=spawn(NODE,[join(project,"dist/daemon.js"),state],{cwd:project,stdio:["ignore","pipe","pipe"]});
  let daemonLog="";daemon.stderr.on("data",c=>daemonLog+=c);daemon.stdout.on("data",c=>daemonLog+=c);
  const executor=spawn("python3",["evals/environment-contract-v1/prism-file-executor.py","--project",project],{cwd:resolve("."),stdio:["ignore","ignore","pipe"]});
  let executorLog="";executor.stderr.on("data",c=>executorLog+=c);
  row.deployment_adapter="file argv/stdio relay to fixed Prism CLI; no researcher decisions";
  let bridge:any,proxy:any;
  try{
   await run(NODE,[join(project,"dist/cli.js"),"--help"]);
   // Confirm the prestarted broker, without creating a page or modifying a task.
   const deadline=Date.now()+5000;let alive=false;
   while(Date.now()<deadline){try{await readFile(join(state,"broker.sock"));}catch(e:any){if(e.code==="ENXIO" || e.code==="EISDIR"){alive=true;break;}if(e.code!=="ENOENT")throw e;}await new Promise(done=>setTimeout(done,50));}
   if(!alive && daemon.exitCode!==null)throw Error("BROKER_START_FAILED: "+daemonLog);
   if(funded){
    const prompt=`Use the Prism skill and the ./prism command to work with the browser. Task page: ${url}\nGoal: ${task.goal}\nThe entry uses the provided browser endpoint and a private state directory. Use only Prism for browser work. Do not inspect implementation files, research files, DOM/CDP, screenshots or other browser tools. Decide actions and completion yourself, based on public Prism replies. Close your session when finished. Report what happened and whether the goal is confirmed; explain any inability or refusal.\n`;
    await writeFile(join(out,"prompt.txt"),prompt,{flag:"wx"});
    proxy=spawn("python3",["evals/environment-contract-v1/native-request-gate-v2.py","--output",join(out,"requests"),"--authorized-limit","6"],{cwd:resolve("."),stdio:["ignore","pipe","pipe"]});
    const base=await new Promise<any>((done,reject)=>{let b="";proxy.stdout.on("data",(c:any)=>{b+=c;if(b.includes("\n"))done(JSON.parse(b.split("\n")[0]!));});proxy.once("exit",()=>reject(Error("GATE_START_FAILED")));});
    await run("python3",["evals/environment-contract-v1/codex-native-host-v2.py","funded","--project",project,"--output",join(out,"host"),"--base-url",base.base_url,"--prompt",join(out,"prompt.txt"),"--authorized-total","18"],{timeout:250000});
    row.real_model_requests=(await readdir(join(out,"requests"))).filter(p=>/^request-\d+\.json$/.test(p)).length;
    row.host_exit=JSON.parse(await readFile(join(out,"host/exit.json"),"utf8"));
   }else{
    if(!direct)bridge=spawn("python3",["evals/environment-contract-v1/codex-native-host-v2.py","bridge","--project",project],{stdio:["pipe","pipe","pipe"]});
    let pending:any;let buffer="";let bridgeErr="";
    bridge?.stderr.on("data",(c:any)=>bridgeErr+=c);
    bridge?.stdout.on("data",(c:any)=>{buffer+=c;while(buffer.includes("\n")){const i=buffer.indexOf("\n");const line=buffer.slice(0,i);buffer=buffer.slice(i+1);pending?.done(JSON.parse(line));pending=null;}});
    const rpc=(method:string,params:any)=>new Promise<any>((done,reject)=>{const timer=setTimeout(()=>reject(Error("HOST_RPC_TIMEOUT; no retry")),50000);pending={done:(value:any)=>{clearTimeout(timer);done(value);},reject};bridge.stdin.write(JSON.stringify({method,params})+"\n");});
    const policy={type:"workspaceWrite",writableRoots:[project],networkAccess:true};
    const command=async(args:string[])=>{
      if(direct)return new Promise<any>(done=>execFile("/usr/bin/python3",[join(project,"prism-entry.py"),...args],{cwd:project,timeout:40000,maxBuffer:1000000},(e,stdout,stderr)=>done({exitCode:e?.code??0,stdout,stderr})));
      const reply=await rpc("command/exec",{command:[join(project,"prism"),...args],cwd:project,timeoutMs:40000,outputBytesCap:1000000,sandboxPolicy:policy});
      await appendFile(join(out,"codex-standalone.jsonl"),JSON.stringify({args,reply})+"\n");
      if(reply.error)throw Error(JSON.stringify(reply.error));
      return reply.result;
    };
    row.help=await command(["--help"]);
    const skill=direct?{not_exercised:"Direct zero-model mechanism check; no Codex host"}:await rpc("skills/list",{cwds:[project],forceReload:true});
    row.skills=skill;await save(join(out,"skills.json"),skill);
    const network=direct?{not_exercised:"Direct zero-model mechanism check; no Codex host"}:await rpc("command/exec",{command:["/usr/bin/python3","-c","import socket; s=socket.socket(); s.settimeout(1); s.connect(('127.0.0.1',9333))"],cwd:project,timeoutMs:5000,sandboxPolicy:policy});
    row.network_probe=network;
    const unwrap=(r:any)=>{const parsed=JSON.parse(r.stdout);if(!parsed.ok)throw Error(r.stdout);return parsed.data;};
    const opened=unwrap(await command(["session","open","--url",url]));
    const view=unwrap(await command(["observe","--session",opened.session,"--scope","local"]));
    row.offered=view.targets.some((t:any)=>task.operation==="fill"?t.operation==="fill"&&t.label==="Your message:":t.operation==="select"&&t.option_value==="2");
    if(episode.condition!=="neutral"){
      const chosen=view.targets.find((t:any)=>task.operation==="fill"?t.operation==="fill"&&t.label===(episode.condition==="wrong"?"from:":"Your message:"):t.operation==="select"&&t.option_value===(episode.condition==="wrong"?"1":"2"));
      if(!chosen)throw Error("PRELOCKED_TARGET_NOT_OFFERED");
      row.chosen=chosen;
      const args=["act","--session",opened.session,"--observation",view.observation,"--target",chosen.ref,"--evidence",view.evidence,"--operation",task.operation,"--request-id","zero-precheck-action"];
      if(task.operation==="fill")args.push("--value",task.value);
      row.action=JSON.parse((await command(args)).stdout);
      row.receipt=unwrap(await command(["receipt","--session",opened.session,"--request-id","zero-precheck-action"]));
    }
    row.after=unwrap(await command(["observe","--session",opened.session,"--scope","local"]));
    await command(["session","close","--session",opened.session]);
    bridge?.stdin.end();
    row.bridge_stderr_bytes=bridgeErr.length;
   }
   row.native_final=row.private_states.at(-1)??null;
   row.schedule_applied=mutated;
   row.status=row.fixture_error?"fixture_error":"recorded";
  }catch(e:any){row.status="infra_error";row.error=e.message;}
  finally{
   bridge?.kill("SIGTERM");proxy?.kill("SIGINT");executor.kill("SIGTERM");
   await save(join(out,"executor-log.json"),{log:executorLog});
   await cp(join(project,"command-mailbox"),join(out,"command-mailbox"),{recursive:true});
   try{await run(NODE,[join(project,"dist/cli.js"),"daemon","stop","--state-dir",state]);}catch{}
   daemon.kill("SIGTERM");
   await new Promise<void>(done=>fixture.close(()=>done()));
   await cp(state,join(out,"cli-state"),{recursive:true});
   await save(join(out,"daemon-log.json"),{log:daemonLog});
   await save(join(out,"entry-settings.json"),JSON.parse(await readFile(join(project,"entry-settings.json"),"utf8")));
  }
  await save(join(out,"result.json"),row);results.push(row);
  await appendFile(join(OUT,"records.jsonl"),JSON.stringify(row)+"\n");
  console.log(JSON.stringify({id:row.id,status:row.status,goal:row.native_final?.goal,requests:row.real_model_requests,schedule:row.schedule_applied,error:row.error}));
  if(funded){
    const events=(await readFile(join(out,"requests/events.jsonl"),"utf8")).trim().split("\n").map(s=>JSON.parse(s));
    const upstreamFailure=events.some(e=>e.kind==="forward_error" || e.kind==="response"&&e.http_status!==200);
    if(row.status!=="recorded" || upstreamFailure || row.host_exit?.exit!==0 && !events.some(e=>e.kind==="budget_blocked")){console.log("STOP: upstream/instrumentation failure retained; no retry");break;}
  }
 }
}finally{await connection.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
await save(join(OUT,"resource-errors.json"),resourceErrors);
await save(join(OUT,"summary.json"),{planned:episodes.length,recorded:results.length,real_model_requests:results.reduce((n,r)=>n+r.real_model_requests,0),statuses:results.map(r=>({id:r.id,status:r.status,goal:r.native_final?.goal,error:r.error})),source_drift:(await Promise.all(Object.entries(files).map(async([p,h])=>hash(await readFile(p))===h?null:p))).filter(Boolean)});
