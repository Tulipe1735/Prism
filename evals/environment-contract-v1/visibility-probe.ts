// Post-hoc diagnostic protocol: three CSS cases; preserve the original 72 records.
// Per case: inspect hidden attribute and effective visibility, then force display:none,
// try the old issued ref once, and observe again. No model or retry.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
import { connectBrowser, parseBrowserUrl } from '../../src/browser/connect.ts';
import { inspectOwnedTab, invokeCli, methodFiles, hash } from '../cli-contract-v1/runtime.ts';
import { execFileSync } from 'node:child_process';
const root=resolve('work/environment-contract-2026-10-05');
const out=join(root,'visibility-probe'); await mkdir(out);
const tasks=JSON.parse(await readFile(join(root,'tasks.json'),'utf8')).filter((t:any)=>['composer-tab','postcard-message','speed-menu'].includes(t.id));
const files=await methodFiles(['evals/environment-contract-v1/visibility-probe.ts',join(root,'tasks.json')]);
execFileSync('tar',['-czf',join(out,'source.tar.gz'),'--',...Object.keys(files)]);
await writeFile(join(out,'freeze.json'),JSON.stringify({kind:'post-hoc diagnosis; protocol in source frozen before execution',files,archive_sha256:hash(await readFile(join(out,'source.tar.gz')))},null,2),{flag:'wx'});
const server=createServer((req,res)=>{void(async()=>{try {const p=resolve(root,'sources','.'+new URL(req.url!,'http://local').pathname); if(!p.startsWith(join(root,'sources')+'/'))throw Error('path');const b=await readFile(p);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'} as any)[extname(p)]??'application/octet-stream');res.end(b);}catch{res.statusCode=404;res.end();}})();});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+(server.address() as any).port;
const conn=await connectBrowser(parseBrowserUrl('http://127.0.0.1:9333'));
const directory=join('/tmp','prism-visibility-'+Date.now());
const rows:any[]=[];
const data=(r:any)=>{if(!r.ok)throw Error(JSON.stringify(r));return r.data;};
try {for(const task of tasks){
 const row:any={task:task.id,model_requests:0}; let session:string|undefined;
 const url=origin+'/'+task.path;
 const inspect=(expr:string)=>inspectOwnedTab(conn,url,expr);
 const cli=(args:string[],input?:any)=>invokeCli(directory,args,input);
 try {
 session=data(await cli(['session','open','--url',url,'--browser-url','http://127.0.0.1:9333'])).session;
 await new Promise(done=>setTimeout(done,500));
 const metadata=`(()=>{const e=document.querySelector(${JSON.stringify(task.correct)});const r=document.querySelector(${JSON.stringify(task.relation_selector)});return {hidden:e.hidden,display:getComputedStyle(e).display,visible:e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}),rect:e.getBoundingClientRect().toJSON(),relation_node:r?.outerHTML,relation_text:r?.textContent};})()`;
 row.before=await inspect(metadata);
 await inspect(`document.querySelector(${JSON.stringify(task.correct)}).hidden=true`);
 row.hidden_attribute=await inspect(metadata);
 const view=data(await cli(['observe','--session',session!,'--scope','local']));
 row.hidden_observation=view;
 const signature=await inspect(`(()=>{const e=document.querySelector(${JSON.stringify(task.correct)}); const s=(${await readFile('src/browser/snapshot.js','utf8')});const a=s.actions.find(a=>window.__jevFast.nodes.get(a.node)===e);return a?{label:a.label,role:a.role,kind:a.kind}:null;})()`);
 const target=signature&&view.targets.find((t:any)=>t.label===signature.label&&t.role===signature.role&&t.operation===signature.kind);
 row.hidden_offered=Boolean(target);
 if(target){
 const evidence=data(await cli(['context','--session',session,'--observation',view.observation,'--target',target.ref,'--scope','relations']));
 await inspect(`(()=>{window.__probeInputs=[];for(const type of ['click','input','change'])document.addEventListener(type,e=>window.__probeInputs.push(type),true);document.querySelector(${JSON.stringify(task.correct)}).style.setProperty('display','none','important');})()`);
 row.forced_hidden=await inspect(metadata);
 row.act=await cli(['act','--stdin'],{command:'act',session,observation:view.observation,target:target.ref,evidence:evidence.evidence,operation:task.operation,request_id:'force-hidden',...(task.operation==='fill'?{value:task.value}:{})});
 row.events=await inspect('window.__probeInputs');
 row.after_observation=data(await cli(['observe','--session',session!,'--scope','local']));
 row.forced_target_label_still_offered=row.after_observation.targets.some((t:any)=>t.label===signature.label&&t.role===signature.role&&t.operation===signature.kind);
 }
 row.status='recorded';
 }catch(e:any){row.status='infra_error';row.error=e.message;}finally{if(session)await cli(['session','close','--session',session]);}
 rows.push(row);console.log(JSON.stringify({task:row.task,hidden:row.hidden_attribute,offered:row.hidden_offered,forced:row.forced_hidden?.visible,receipt:row.act?.data?.receipt,events:row.events}));
}}finally{await invokeCli(directory,['daemon','stop']).catch(()=>{});await conn.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
await writeFile(join(out,'results.json'),JSON.stringify({model_requests:0,rows},null,2),{flag:'wx'});
