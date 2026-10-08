import {appendFile,cp,mkdir,mkdtemp,readFile,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {resolve,join,extname,sep} from "node:path";
import {createHash} from "node:crypto";
import {connectBrowser,parseBrowserUrl} from "../../src/browser/connect.ts";
import {invokeCli,inspectOwnedTab} from "../cli-contract-v1/runtime.ts";

const ROOT=resolve("work/codex-prism-supplement-2026-10-05");
const OUT=join(ROOT,"independent-relation-check-v3");await mkdir(OUT);
const CANDIDATE=join(ROOT,"relational-candidates");
const OLD=resolve("work/environment-contract-2026-10-05/sources");
const hash=(x:Uint8Array|string)=>createHash("sha256").update(x).digest("hex");
const save=(p:string,x:any)=>writeFile(p,JSON.stringify(x,null,2)+"\n",{flag:"wx"});
const tasks=[
 {id:"h71-postal-address",family:"w3c-wai",source_kind:"verbatim standards example snippet; not deployed site",path:"/h71-addresses.html",source_file:join(CANDIDATE,"h71-addresses.html"),
  goal:"Set Address in Your Postal Address to: 42 Maple Road.",correct:"#paddress",wrong:"#raddress",operation:"fill",label:"Address:",value:"42 Maple Road.",
  group:"Your Postal Address",other_group:"Your Residential Address",oracle:"document.querySelector('#paddress').value === '42 Maple Road.' && document.querySelector('#raddress').value === ''",
  semantic_signature:{operation:"fill",control:"Address",required_disambiguator:"postal vs residential address group",completion:"only postal value equals requested string",source_unit:"H71 Example 3"}},
 {id:"jquery-vertical-book",family:"jquery-ui",source_kind:"reused independent upstream demo; not newly independent source family",path:"/jquery-ui/demos/controlgroup/default.html",source_file:join(OLD,"jquery-ui/demos/controlgroup/default.html"),
  goal:"Click Book Now! in the vertical Rental Car group.",correct:"#book",wrong:".controlgroup button",operation:"click",label:"Book Now!",group:"vertical Rental Car",other_group:"horizontal Rental Car",
  oracle:"window.__relationEvents.some(e=>e.type==='click' && e.correct) && !window.__relationEvents.some(e=>e.type==='click' && e.wrong)",
  semantic_signature:{operation:"click",control:"Book Now!",required_disambiguator:"vertical vs horizontal control group",completion:"click event belongs to vertical button; no business booking claim",source_unit:"jQuery UI controlgroup/default"}}
];
const cases=["neutral","wrong","correct"];
await save(join(OUT,"plan.json"),{kind:"prospective qualification; outcomes not yet inspected",tasks,cases,planned:6,model_requests:0,
 qualification_dimensions:["correct/wrong offered","public group association distinguishes duplicate labels","explicit relations redundant with local context?","correct/wrong/no-input native oracle","receipt versus input"],
 limitation:"Two source units, not four tasks or three families. A required semantic group can already be represented in local context; do not confuse this with necessity of the relations array."});
const files:any={};
for(const p of ["evals/environment-contract-v1/independent-relation-check.ts","src/browser/snapshot.js","src/browser/representation.ts","src/browser/evidence.ts","src/cli/sessions.ts","evals/cli-contract-v1/runtime.ts",join(OUT,"plan.json"),...tasks.map(t=>t.source_file)])files[p]=hash(await readFile(p));
await save(join(OUT,"freeze.json"),{at:new Date().toISOString(),kind:"pre-execution local method freeze",files});
const errors:any[]=[];
const server=createServer((req,res)=>void(async()=>{try{const pathname=new URL(req.url!,"http://fixture").pathname;
  const p=pathname==="/h71-addresses.html"?tasks[0]!.source_file:resolve(OLD,"."+pathname);
  if(pathname!=="/h71-addresses.html"&&!p.startsWith(OLD+sep))throw Error("outside source");
  const body=await readFile(p);
  res.writeHead(200,{"content-type":({".html":"text/html",".css":"text/css",".js":"text/javascript"} as any)[extname(p)]??"application/octet-stream","content-security-policy":"default-src 'self' data:;script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';form-action 'none'"});res.end(body);
 }catch{errors.push({path:req.url,status:404});res.writeHead(404);res.end();}})());
await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${(server.address() as any).port}`;
const browser="http://127.0.0.1:9333";
const connection=await connectBrowser(parseBrowserUrl(browser));
const snapshot=await readFile("src/browser/snapshot.js","utf8");
const results:any[]=[];
try{for(const task of tasks)for(const condition of cases){
 const row:any={task_id:task.id,condition,controller:"privileged researcher qualification; no agent",model_requests:0,commands:[]};
 const state=await mkdtemp("/tmp/prism-rel-");
 const url=origin+task.path;const inspect=(x:string)=>inspectOwnedTab(connection,url,x);
 const cli=async(args:string[])=>{const reply=await invokeCli(state,args);row.commands.push({args,reply});return reply;};
 const data=(r:any)=>{if(!r.ok)throw Error(JSON.stringify(r));return r.data;};
 let session:string|undefined;
 try{
  session=data(await cli(["session","open","--url",url,"--browser-url",browser])).session;
  if(task.family==="jquery-ui"){
   const deadline=Date.now()+5000;
   while(Date.now()<deadline && !(await inspect("Boolean(document.querySelector('#book').classList.contains('ui-button'))")))await new Promise(done=>setTimeout(done,100));
  }
  await inspect(`document.querySelector(${JSON.stringify(task.correct)}).scrollIntoView({block:'center'})`);
  await inspect(`(()=>{window.__relationEvents=[];for(const type of ['click','input','change'])document.addEventListener(type,e=>window.__relationEvents.push({type,correct:document.querySelector(${JSON.stringify(task.correct)}).contains(e.target),wrong:document.querySelector(${JSON.stringify(task.wrong)}).contains(e.target),value:e.target.value}),true);})()`);
  const view=data(await cli(["observe","--session",session!,"--scope","relations"]));row.observation=view;
  const lookup=async(selector:string)=>{
   const mapped=await inspect(`(()=>{const s=(${snapshot});const e=document.querySelector(${JSON.stringify(selector)});const a=s.actions.find(a=>window.__jevFast.nodes.get(a.node)===e&&a.kind===${JSON.stringify(task.operation)});if(!a)return null;const peers=s.actions.filter(x=>x.kind===a.kind&&x.role===a.role&&x.label===a.label&&x.value===a.value);return {label:a.label,role:a.role,index:peers.indexOf(a),count:peers.length};})()`);
   if(!mapped)return null;
   const peers=view.targets.filter((t:any)=>t.operation===task.operation&&t.role===mapped.role&&t.label===mapped.label);
   if(peers.length!==mapped.count)throw Error("PRIVATE_MAPPING_DRIFT");return peers[mapped.index];
  };
  row.correct=await lookup(task.correct);row.wrong=await lookup(task.wrong);
  row.both_offered=Boolean(row.correct&&row.wrong);
  row.same_label=row.both_offered&&row.correct.label===row.wrong.label;
  row.local_contains_goal_group=Boolean(row.correct?.context.local?.includes(task.group));
  row.wrong_local_contains_goal_group=Boolean(row.wrong?.context.local?.includes(task.group));
  row.relations_contain_goal_group=Boolean(row.correct?.relations?.some((r:any)=>r.text===task.group));
  row.wrong_relations_contain_goal_group=Boolean(row.wrong?.relations?.some((r:any)=>r.text===task.group));
  row.group_semantically_required=row.same_label;
  row.group_association_exposed=(row.local_contains_goal_group&&!row.wrong_local_contains_goal_group)||(row.relations_contain_goal_group&&!row.wrong_relations_contain_goal_group);
  row.explicit_relations_redundant=row.local_contains_goal_group&&!row.wrong_local_contains_goal_group;
  row.before_goal=await inspect(task.oracle);
  if(condition!=="neutral"){
   const chosen=condition==="correct"?row.correct:row.wrong;
   if(!chosen)throw Error("TARGET_NOT_OFFERED");
   const args=["act","--session",session!,"--observation",view.observation,"--target",chosen.ref,"--evidence",view.evidence,"--operation",task.operation,"--request-id","qualification-action"];
   if(task.operation==="fill")args.push("--value",task.value!);
   row.action=await cli(args);
   row.receipt=data(await cli(["receipt","--session",session!,"--request-id","qualification-action"]));
  }
  row.after_goal=await inspect(task.oracle);row.events=await inspect("window.__relationEvents");
  row.actual_input=row.events.some((e:any)=>(e.correct||e.wrong)&&(task.operation==="fill"?e.type==="input"||e.type==="change":e.type==="click"));
  row.receipt_agrees=row.receipt?((row.receipt.receipt.outcome==="executed")===row.actual_input):null;
  row.status="recorded";
 }catch(e:any){row.status="infra_error";row.error=e.message;}
 finally{if(session)await cli(["session","close","--session",session]);await cli(["daemon","stop"]).catch(()=>{});await cp(state,join(OUT,`${task.id}-${condition}-state`),{recursive:true});}
 results.push(row);await appendFile(join(OUT,"records.jsonl"),JSON.stringify(row)+"\n");
 console.log(JSON.stringify({task:row.task_id,condition,status:row.status,goal:row.after_goal,association:row.group_association_exposed,relations_redundant:row.explicit_relations_redundant,error:row.error}));
}}finally{await connection.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
await save(join(OUT,"resource-errors.json"),errors);
await save(join(OUT,"summary.json"),{planned:6,records:results.length,model_requests:0,tasks:tasks.map(t=>({id:t.id,rows:results.filter(r=>r.task_id===t.id).map(r=>({condition:r.condition,status:r.status,goal:r.after_goal,both_offered:r.both_offered,group_required:r.group_semantically_required,group_exposed:r.group_association_exposed,explicit_relations_redundant:r.explicit_relations_redundant}))})),source_drift:(await Promise.all(Object.entries(files).map(async([p,h])=>hash(await readFile(p))===h?null:p))).filter(Boolean)});
