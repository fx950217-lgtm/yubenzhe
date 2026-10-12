import test from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute,basename} from 'node:path';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {passwordRecord} from '../server/auth.mjs';
import {createCodexRunner} from '../device-bridge/codex-runner.mjs';
import {createAIChannel} from '../device-bridge/ai-channel.mjs';
import {createTaskPool} from '../device-bridge/task-pool.mjs';
import {spawn} from 'node:child_process';

async function fixture(t,{internalPreview=false}={}){
 const database=openSocialDatabase(':memory:'),modules=createProductModules({database,origin:'http://localhost:18800',simulation:true});
 const user=await modules.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip:'127.0.0.1'});
 const pair=modules.handle({method:'POST',path:'devices/pair',token:user.token,input:{name:'HTTP 测试电脑'}});
 const hostname=internalPreview?'review.example.test':'127.0.0.1:18800',origin=(internalPreview?'https://':'http://')+hostname;
 const server=createAcceptanceServer({role:'frontend',origin,internalPreview,authConfig:await passwordRecord('preview','Synthetic-channel-password-728361'),socialService:{devices:modules.devices,aiChannel:modules.aiChannel,handle:r=>modules.handle(r)},staticRoot:fileURLToPath(new URL('../public/frontend',import.meta.url))});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
 const request=(path,input,headers={})=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,method:input===undefined?'GET':'POST',headers:{Host:hostname,...(input===undefined?{}:{'Content-Type':'application/json'}),...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const body=Buffer.concat(chunks).toString();resolve({status:res.statusCode,body:JSON.parse(body)});});});req.on('error',reject);req.end(input===undefined?undefined:JSON.stringify(input));});
 const enrolled=await request('/api/device-bridge/enroll',{pairToken:pair.pairToken});assert.equal(enrolled.status,200);
 return {database,modules,user,device:enrolled.body,request,origin};
}

test('canonical and cookie-compatible AI channel routes use product identity; connector credentials cannot access owner/admin endpoints',async t=>{
 const f=await fixture(t),agentHeaders={Authorization:'Bearer '+f.device.token},ownerHeaders={Origin:f.origin,Authorization:'Bearer '+f.user.token},connectorId=randomUUID();
 const poll={connectorId,status:{code:'ready',provider:'Codex',workspaceLabel:'工作目录'}};
 assert.equal((await f.request('/api/device-bridge/ai/poll',poll,agentHeaders)).status,200);
 const created=await f.request('/api/ai-channel/send',{deviceId:f.device.deviceId,prompt:'test prompt',requestId:randomUUID()},ownerHeaders);assert.equal(created.status,200);
 const cookieRead=await f.request('/api/social/ai-channel/tasks/'+created.body.task.id,undefined,{Cookie:'ybz_social='+f.user.token});assert.equal(cookieRead.status,200);
 assert.equal((await f.request('/api/ai-channel/devices/'+f.device.deviceId,undefined,{Authorization:'Bearer '+f.user.token})).status,200);
 for(const path of ['/api/ai-channel/devices/'+f.device.deviceId,'/api/social/ai-channel/tasks/'+created.body.task.id,'/api/admin/product/accounts'])assert.equal((await f.request(path,undefined,agentHeaders)).status,401);
 assert.equal((await f.request('/api/device-bridge/ai/poll',poll,{...agentHeaders,Origin:f.origin})).status,403);
 assert.equal((await f.request('/api/device-bridge/ai/poll',poll,{Authorization:'Bearer '+f.user.token})).status,401);
 assert.equal((await f.request('/api/ai-channel/send',{deviceId:f.device.deviceId,prompt:'cross site',requestId:randomUUID()},{...ownerHeaders,Origin:'https://evil.invalid'})).status,403);
});

test('internal preview gate covers both owner route aliases while scoped device AI routes remain usable',async t=>{
 const f=await fixture(t,{internalPreview:true}),agentHeaders={Authorization:'Bearer '+f.device.token},ownerHeaders={Origin:f.origin,Authorization:'Bearer '+f.user.token};
 const poll={connectorId:randomUUID(),status:{code:'ready',provider:'Codex',workspaceLabel:'工作目录'}};
 assert.equal((await f.request('/api/device-bridge/ai/poll',poll,agentHeaders)).status,200);
 for(const path of ['/api/ai-channel/devices/'+f.device.deviceId,'/api/social/ai-channel/devices/'+f.device.deviceId]){
  const result=await f.request(path,undefined,ownerHeaders);assert.equal(result.status,401);assert.equal(result.body.code,'INTERNAL_PREVIEW_REQUIRED');
 }
 assert.equal((await f.request('/api/device-bridge/ai/poll',poll,{...agentHeaders,Origin:'https://evil.invalid'})).status,403);
});

test('ciphertext file routes inherit owner, device and active-task lease boundaries',async t=>{
 const f=await fixture(t),agentHeaders={Authorization:'Bearer '+f.device.token},ownerHeaders={Origin:f.origin,Authorization:'Bearer '+f.user.token};
 const input={taskId:randomUUID(),leaseId:randomUUID(),requestId:randomUUID(),envelope:{}};
 assert.equal((await f.request('/api/device-bridge/ai/files/init',input)).status,401);
 assert.equal((await f.request('/api/device-bridge/ai/files/init',input,{...agentHeaders,Origin:f.origin})).status,403);
 assert.equal((await f.request('/api/device-bridge/ai/files/init',input,agentHeaders)).status,403);
 assert.equal((await f.request('/api/ai-channel/files/init',{deviceId:f.device.deviceId,requestId:randomUUID(),envelope:{}},agentHeaders)).status,403);
 assert.equal((await f.request('/api/social/ai-channel/files/init',{deviceId:f.device.deviceId,requestId:randomUUID(),envelope:{}},ownerHeaders)).status,400);
 f.modules.devices.handle({method:'POST',path:'devices/'+f.device.deviceId+'/revoke',input:{},token:f.user.token});
 assert.equal((await f.request('/api/device-bridge/ai/files/init',input,agentHeaders)).status,401);
 assert.equal((await f.request('/api/social/ai-channel/files/init',{deviceId:f.device.deviceId,requestId:randomUUID(),envelope:{}},ownerHeaders)).status,403);
});

test('actual runner JSONL parser events cross the real HTTP protocol with success, diagnostic failure and truthful terminal acknowledgements',async t=>{
 const f=await fixture(t),parent=resolve(tmpdir()),base=await mkdtemp(join(parent,'ybz-ai-http-parser-')),workspace=join(base,'work');await mkdir(workspace);
 t.after(async()=>{const actual=resolve(base),rel=relative(parent,actual);assert.ok(basename(actual).startsWith('ybz-ai-http-parser-')&&rel&&!rel.startsWith('..')&&!isAbsolute(rel));await rm(actual,{recursive:true,force:true});});
 let child;const runner=await createCodexRunner({executable:process.execPath,workspace,spawnImpl:()=>{child=new EventEmitter();child.pid=741;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();return child;}});
 const agentHeaders={Authorization:'Bearer '+f.device.token},ownerHeaders={Origin:f.origin,Authorization:'Bearer '+f.user.token},poll={connectorId:randomUUID(),status:{code:'ready',provider:'Codex',workspaceLabel:'协议联测工作目录'}};
 assert.equal((await f.request('/api/device-bridge/ai/poll',poll,agentHeaders)).status,200);
 // Only the process transport is synthetic. Parsing, terminal-event construction,
 // server routing, authentication, validation and durable task transitions are real.
 for(const diagnostic of [false,true]){
  const created=await f.request('/api/ai-channel/send',{deviceId:f.device.deviceId,prompt:'请回复收到',requestId:randomUUID()},ownerHeaders);assert.equal(created.status,200);
  const dispatched=await f.request('/api/device-bridge/ai/poll',poll,agentHeaders);assert.equal(dispatched.status,200);const task=dispatched.body.task;assert.equal(task.id,created.body.task.id);
  const events=[],job=runner.run({taskId:task.id,prompt:task.prompt,onEvent:event=>events.push({seq:events.length+1,...event})});
  const records=[{type:'thread.started',thread_id:'observed-shape'},{type:'turn.started'},...(diagnostic?[{type:'item.completed',item:{id:'error_0',type:'error',message:'Code Mode is unavailable because host executable was not found.'}}]:[]),{type:'item.completed',item:{id:'item_1',type:'agent_message',text:'收到'}},{type:'turn.completed',usage:{input_tokens:100}}];
  child.stdout.write(records.map(record=>JSON.stringify(record)).join('\n')+'\n');child.emit('close',0);await job.done;
  assert.equal(events[0].code,'AI_RUNNING');assert.equal(events.at(-1).code,diagnostic?'AI_TOOL_UNAVAILABLE':'AI_COMPLETED');
  const body={...poll,taskId:task.id,leaseId:task.leaseId,events},reply=await f.request('/api/device-bridge/ai/poll',body,agentHeaders);assert.equal(reply.status,200,JSON.stringify(reply.body));assert.equal(reply.body.ack,events.length);assert.equal(reply.body.cancelTaskId,task.id);
  const replay=await f.request('/api/device-bridge/ai/poll',body,agentHeaders);assert.equal(replay.status,200);assert.equal(replay.body.ack,events.length);
  const detail=await f.request('/api/social/ai-channel/tasks/'+task.id,undefined,ownerHeaders);assert.equal(detail.body.task.status,diagnostic?'failed':'succeeded');assert.deepEqual(detail.body.events,events);
  const late=await f.request('/api/device-bridge/ai/poll',{...body,events:[{seq:events.length+1,kind:'message',itemId:'late',text:'未接收内容'}]},agentHeaders);assert.equal(late.status,200);assert.equal(late.body.cancelTaskId,task.id);assert.equal(late.body.ack,events.length);
 }
});

test('HTTP event codes are allowlisted by kind rather than accepting arbitrary or misplaced status codes',async t=>{
 const f=await fixture(t),agentHeaders={Authorization:'Bearer '+f.device.token},ownerHeaders={Origin:f.origin,Authorization:'Bearer '+f.user.token},poll={connectorId:randomUUID(),status:{code:'ready',provider:'Codex',workspaceLabel:'协议校验'}};
 await f.request('/api/device-bridge/ai/poll',poll,agentHeaders);await f.request('/api/ai-channel/send',{deviceId:f.device.deviceId,prompt:'test',requestId:randomUUID()},ownerHeaders);const task=(await f.request('/api/device-bridge/ai/poll',poll,agentHeaders)).body.task;
 for(const [kind,code]of [['message','AI_RUNNING'],['progress','AI_COMPLETED'],['failed','AI_RUNNING'],['failed','AI_COMPLETED'],['completed','AI_RUNNING'],['completed','AI_EXECUTION_FAILED'],['progress','ARBITRARY_CODE']]){
  const response=await f.request('/api/device-bridge/ai/poll',{...poll,taskId:task.id,leaseId:task.leaseId,events:[{seq:1,kind,code,itemId:'item',text:'test'}]},agentHeaders);assert.equal(response.status,400);assert.equal(response.body.code,'INVALID_AI_EVENT');
 }
 const detail=await f.request('/api/ai-channel/tasks/'+task.id,undefined,ownerHeaders);assert.equal(detail.body.latestSeq,0);assert.equal(detail.body.task.status,'running');
 await f.request('/api/ai-channel/tasks/'+task.id+'/cancel',{requestId:randomUUID()},ownerHeaders);
 const terminal=await f.request('/api/device-bridge/ai/poll',{...poll,taskId:task.id,leaseId:task.leaseId,events:[{seq:1,kind:'completed',code:'AI_COMPLETED',text:'late'}]},agentHeaders);assert.equal(terminal.status,200);assert.equal(terminal.body.cancelTaskId,task.id);assert.equal(terminal.body.ack,0);
});

test('modern registry and selected Ollama task traverse real HTTP while content and file rights remain isolated',async t=>{
 const f=await fixture(t),agentHeaders={Authorization:'Bearer '+f.device.token},ownerHeaders={Origin:f.origin,Authorization:'Bearer '+f.user.token};
 const providers=[{id:'codex',name:'Codex',installed:true,loggedIn:false,version:'1.2.3',reason:'private@example.test',executionSupported:false,executionMode:'disabled'},{id:'ollama',name:'Ollama',installed:true,loggedIn:null,version:'1.2.3',reason:'',executionSupported:true,executionMode:'chat-only'}];
 const poll={connectorId:randomUUID(),status:{code:'ready',workspaceLabel:'多模型工作目录',providers,scannedAt:Date.now()}};
 assert.equal((await f.request('/api/device-bridge/ai/poll',poll,agentHeaders)).status,200);
 const state=await f.request('/api/ai-channel/devices/'+f.device.deviceId,undefined,ownerHeaders);assert.equal(state.body.device.providers.length,2);assert.equal(state.body.device.aiStatus,'ready');assert.equal(JSON.stringify(state.body).includes('private@example.test'),false);
 const input={deviceId:f.device.deviceId,prompt:'HTTP-OLLAMA-PRIVATE',provider:'ollama',requestId:randomUUID()};
 const rejected=await f.request('/api/ai-channel/send',{...input,attachments:[randomUUID()]},ownerHeaders);assert.equal(rejected.status,409);assert.equal(rejected.body.code,'AI_PROVIDER_FILES_UNSUPPORTED');
 const created=await f.request('/api/ai-channel/send',input,ownerHeaders);assert.equal(created.status,200);assert.equal(created.body.task.provider,'ollama');const dispatched=await f.request('/api/device-bridge/ai/poll',poll,agentHeaders),task=dispatched.body.task;assert.equal(task.provider,'ollama');assert.equal(task.executionMode,'chat-only');
 const files=await f.request('/api/device-bridge/ai/files/init',{taskId:task.id,leaseId:task.leaseId,requestId:randomUUID(),envelope:{}},agentHeaders);assert.equal(files.status,409);assert.equal(files.body.code,'AI_PROVIDER_FILES_UNSUPPORTED');
 const reply=await f.request('/api/device-bridge/ai/poll',{...poll,taskId:task.id,leaseId:task.leaseId,events:[{seq:1,kind:'message',itemId:'ollama-reply',text:'HTTP-OLLAMA-OUTPUT-PRIVATE'},{seq:2,kind:'completed',code:'AI_COMPLETED'}]},agentHeaders);assert.equal(reply.status,200);assert.equal(reply.body.ack,2);
 const detail=await f.request('/api/ai-channel/tasks/'+task.id,undefined,ownerHeaders);assert.equal(detail.body.task.status,'succeeded');assert.match(detail.body.task.sourceLabel,/Ollama$/);
 const other=await f.modules.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip:'127.0.0.2'}),otherHeaders={Origin:f.origin,Authorization:'Bearer '+other.token};
 for(const path of ['/api/ai-channel/devices/'+f.device.deviceId,'/api/ai-channel/tasks/'+task.id])assert.equal((await f.request(path,undefined,otherHeaders)).status,404);
 for(const name of ['ai_channel_tasks','ai_channel_devices','ai_channel_event_hashes']){const rows=JSON.stringify(f.database.raw.prepare('SELECT * FROM '+name).all());assert.equal(rows.includes('HTTP-OLLAMA-PRIVATE'),false);assert.equal(rows.includes('HTTP-OLLAMA-OUTPUT-PRIVATE'),false);}
});

test('real local child and HTTP perform prepare → pause → owner click → same-workspace export exactly once',async t=>{
 // The executable fixture is NOT Codex or an LLM. Real local process shutdown,
 // isolated directories, HTTP authorization and durable decision records are tested.
 const f=await fixture(t),base=await mkdtemp(join(tmpdir(),'ybz-decision-http-')),workspace=join(base,'work'),runtimeDir=join(base,'private'),statePath=join(base,'pair.json'),script=join(base,'synthetic-worker.cjs');await mkdir(workspace);
 await writeFile(statePath,JSON.stringify({origin:'https://relay.example',deviceId:f.device.deviceId,token:f.device.token}));
 await writeFile(script,`const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync('executions.txt','one segment\\n');fs.mkdirSync('outbox',{recursive:true});if(!fs.existsSync('sample.txt')){fs.writeFileSync('sample.txt','verified sample');console.log(JSON.stringify({type:'item.completed',item:{id:'decision',type:'agent_message',text:JSON.stringify({ybzDecision:{question:'SYNTHETIC-PRIVATE-QUESTION',options:[{label:'修改',instruction:'SYNTHETIC-PRIVATE-REVISE'},{label:'导出',instruction:'SYNTHETIC-PRIVATE-EXPORT'}]}})}}));setInterval(()=>{},1000);}else{fs.copyFileSync('sample.txt','outbox/result.txt');console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:'SYNTHETIC-PRIVATE-DONE'}}));console.log(JSON.stringify({type:'turn.completed'}));}});`);
 const pool=createTaskPool({workspace,resourceReady:()=>true,factory:cwd=>createCodexRunner({workspace:cwd,executable:process.execPath,spawnImpl:(_exe,_args,options)=>spawn(process.execPath,[script],options),killTree:async child=>{if(child.exitCode===null)child.kill();}})});
 const runner={configuration:{workspace,isolatedTasks:true,maxConcurrent:3},loginStatus:async()=>({code:'ready'}),run:pool.run,close:pool.close,canDispatch:pool.canDispatch};
 const channel=await createAIChannel({statePath,runtimeDir,runner,fetchImpl:async(url,options)=>{assert.equal(new URL(url).origin,'https://relay.example');const r=await f.request(new URL(url).pathname,JSON.parse(options.body),options.headers);return new Response(JSON.stringify(r.body),{status:r.status});}});
 t.after(async()=>{await channel.close();const actual=resolve(base),rel=relative(resolve(tmpdir()),actual);assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel)&&basename(actual).startsWith('ybz-decision-http-'));await rm(actual,{recursive:true,force:true});});
 const ownerHeaders={Origin:f.origin,Authorization:'Bearer '+f.user.token};await channel.pollOnce();
 const created=await f.request('/api/ai-channel/send',{deviceId:f.device.deviceId,prompt:'SYNTHETIC-PRIVATE-INITIAL',requestId:randomUUID()},ownerHeaders);assert.equal(created.status,200,JSON.stringify(created.body));
 const taskId=created.body.task.id,root=join(workspace,'.ybz-ai-channel',taskId);let detail;
 for(let n=0;n<100;n++){await channel.pollOnce();detail=await f.request('/api/ai-channel/tasks/'+taskId,undefined,ownerHeaders);if(detail.body.task.status==='awaiting-decision')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(detail.body.task.status,'awaiting-decision');assert.equal(pool.size,0);assert.equal(await readFile(join(root,'executions.txt'),'utf8'),'one segment\n');
 await channel.pollOnce();assert.equal(await readFile(join(root,'executions.txt'),'utf8'),'one segment\n');
 const decision=detail.body.task.decision,input={requestId:randomUUID(),decisionId:decision.id,version:decision.version,optionId:'option-2',approveExecution:true};
 const stranger=await f.modules.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip:'127.0.0.2'});assert.equal((await f.request('/api/ai-channel/tasks/'+taskId+'/decision',input,{Origin:f.origin,Authorization:'Bearer '+stranger.token})).status,404);
 const responses=await Promise.all([f.request('/api/ai-channel/tasks/'+taskId+'/decision',input,ownerHeaders),f.request('/api/ai-channel/tasks/'+taskId+'/decision',input,ownerHeaders)]);assert.ok(responses.every(r=>r.status===200),JSON.stringify(responses));
 const childRow=f.database.raw.prepare('SELECT id FROM ai_channel_tasks WHERE parent_task_id=?').all(taskId);assert.equal(childRow.length,1);
 let finished;for(let n=0;n<100;n++){await channel.pollOnce();finished=await f.request('/api/ai-channel/tasks/'+childRow[0].id,undefined,ownerHeaders);if(finished.body.task.status==='succeeded')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(finished.body.task.status,'succeeded',JSON.stringify(finished.body));assert.equal(await readFile(join(root,'outbox/result.txt'),'utf8'),'verified sample');assert.equal(await readFile(join(root,'executions.txt'),'utf8'),'one segment\none segment\n');
 assert.equal(f.database.raw.prepare('SELECT COUNT(*) n FROM ai_task_decisions WHERE state=? AND selected_option_id=?').get('continued','option-2').n,1);
 for(const table of ['ai_task_decisions','ai_channel_tasks','ai_channel_devices','ai_channel_event_hashes'])assert.doesNotMatch(JSON.stringify(f.database.raw.prepare('SELECT * FROM '+table).all()),/SYNTHETIC-PRIVATE/);
});
