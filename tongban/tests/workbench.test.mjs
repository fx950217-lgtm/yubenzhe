import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/workbench.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountWorkbench}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)}}
function task(overrides={}){return {id:'bdf1a967-e167-43a5-a214-6cd654e8756e',title:'PRIVATE_TASK',operation:'analyze',status:'running',step:0,version:1,workspaceId:'local-workspace',workspace:{state:'running',controller:'ai'},quoteExpiresAt:Date.now()+60000,estimatedMicro:'30000',budgetMicro:'100000',costMicro:'0',settledMicro:'0',outputs:[],approvals:[],events:[],createdAt:1700000000000,...overrides}}
function harness(t,{request,...initialOptions}={}){
 let profile={userId:'owner_a'},timer;
 const timers={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 globalThis.setInterval=callback=>{timer=callback;return 731};globalThis.clearInterval=()=>{};
 const calls=[],listeners=new Map(),buttons=[{disabled:false}];
 const root={innerHTML:'',contains:()=>true,querySelectorAll:()=>buttons,addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name)};
 const fallback=async path=>path==='workbench/capabilities'?{enabled:true}:path==='workbench/tasks'?{tasks:[task()]}:path==='workbench/files'?{files:[]}:{task:task()};
 const client={getProfile:()=>profile,authenticatedRequest:async(path,options)=>{calls.push({path,options});return request?request(path,options,fallback):fallback(path,options)}};
 const cleanup=mountWorkbench(root,{client,...initialOptions});
 t.after(()=>{cleanup();globalThis.setInterval=timers.setInterval;globalThis.clearInterval=timers.clearInterval});
 return {root,calls,cleanup,listeners,buttons,account(value){profile=value},poll(){timer?.()},async click(action,id,values={}){const button={dataset:{action,id,...values}};await listeners.get('click')({target:{closest:()=>button}})},upload(file){return listeners.get('change')({target:{closest:()=>({files:[file]})}})}};
}

test('switching account while a file is read never uploads those bytes to the new account',async t=>{
 const h=harness(t),read=deferred();await tick();const pending=h.upload({name:'private.txt',size:7,arrayBuffer:()=>read.promise});h.account({userId:'owner_b'});read.resolve(new TextEncoder().encode('PRIVATE').buffer);await pending;
 assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(h.calls.some(c=>c.options?.input?.base64),false);
});

test('leaving the workbench while a file is read prevents upload and late DOM replacement',async t=>{
 const h=harness(t),read=deferred();await tick();const pending=h.upload({name:'private.txt',size:7,arrayBuffer:()=>read.promise});h.cleanup();h.root.innerHTML='OTHER_PAGE';read.resolve(new TextEncoder().encode('PRIVATE').buffer);await pending;
 assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(h.root.innerHTML,'OTHER_PAGE');assert.equal(h.listeners.size,0);
});

test('back from task details discards a delayed polling response instead of reopening the task',async t=>{
 const late=deferred();let details=0;const h=harness(t,{request:async(path,options,fallback)=>path==='workbench/tasks/'+task().id&&++details===2?late.promise:fallback(path,options)});await tick();await h.click('open',task().id);assert.match(h.root.innerHTML,/成果文件/);h.poll();await tick();assert.equal(details,2);await h.click('back');assert.match(h.root.innerHTML,/我的任务/);late.resolve({task:task({title:'STALE_DETAIL_MUST_NOT_RETURN'})});await tick();assert.match(h.root.innerHTML,/我的任务/);assert.doesNotMatch(h.root.innerHTML,/STALE_DETAIL_MUST_NOT_RETURN|成果文件/);
});

test('an upload response after unmount does not query files or mutate a replacement page',async t=>{
 const uploaded=deferred(),h=harness(t,{request:async(path,options,fallback)=>path==='workbench/files'&&options?.method==='POST'?uploaded.promise:fallback(path,options)});await tick();const pending=h.upload({name:'file.txt',size:4,arrayBuffer:async()=>new TextEncoder().encode('DATA').buffer});await tick();assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,1);const readCount=h.calls.filter(c=>c.path==='workbench/files'&&!c.options).length;h.cleanup();h.root.innerHTML='NEW_PAGE';uploaded.resolve({file:{id:'saved',name:'file.txt'}});await pending;assert.equal(h.calls.filter(c=>c.path==='workbench/files'&&!c.options).length,readCount);assert.equal(h.root.innerHTML,'NEW_PAGE');
});

test('pending task open blocks local navigation until its guarded response resolves',async t=>{
 const opened=deferred(),h=harness(t,{request:async(path,options,fallback)=>path==='workbench/tasks/'+task().id?opened.promise:fallback(path,options)});await tick();const opening=h.click('open',task().id);await h.click('back');assert.equal(h.buttons.every(b=>b.disabled),true);opened.resolve({task:task()});await opening;assert.match(h.root.innerHTML,/成果文件/);await h.click('back');assert.match(h.root.innerHTML,/我的任务/);
});

test('a recent-task destination reads the selected task and opens its detail without a write',async t=>{
 const h=harness(t,{initialScreen:'tasks',initialTaskId:task().id});await tick();
 assert.match(h.root.innerHTML,/PRIVATE_TASK/);assert.match(h.root.innerHTML,/成果文件/);
 assert.deepEqual(h.calls.map(call=>call.path),['workbench/capabilities','workbench/tasks/'+task().id]);
 assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
 await h.click('back');assert.match(h.root.innerHTML,/我的任务/);assert.doesNotMatch(h.root.innerHTML,/成果文件/);
 assert.equal(h.calls.filter(call=>call.path==='workbench/tasks/'+task().id).length,1);
});

test('initial task list and new-task home select their intended destinations',async t=>{
 const h=harness(t,{initialScreen:'tasks'});await tick();
 assert.match(h.root.innerHTML,/<h2>我的任务<\/h2>/);assert.match(h.root.innerHTML,/PRIVATE_TASK/);
 assert.doesNotMatch(h.root.innerHTML,/data-plan/);assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
 await h.click('new');assert.match(h.root.innerHTML,/data-plan/);assert.match(h.root.innerHTML,/用文件小工具完成什么/);
});

test('initial home preserves the proposed goal without creating a task',async t=>{
 const h=harness(t,{initialScreen:'home',initialGoal:'想清楚目标，再确认计划'});await tick();
 assert.match(h.root.innerHTML,/data-plan/);assert.match(h.root.innerHTML,/想清楚目标，再确认计划/);
 assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
});

for(const boundary of ['account','cleanup','navigation']){
 test('an initial task response cannot cross the '+boundary+' boundary',async t=>{
  const late=deferred();
  const h=harness(t,{initialScreen:'tasks',initialTaskId:task().id,request:async(path,options,fallback)=>path==='workbench/tasks/'+task().id?late.promise:fallback(path,options)});
  await tick();assert.equal(h.calls.some(call=>call.path==='workbench/tasks/'+task().id),true);
  if(boundary==='account')h.account({userId:'owner_b'});
  if(boundary==='cleanup'){h.cleanup();h.root.innerHTML='REPLACEMENT_PAGE';}
  if(boundary==='navigation')await h.click('new');
  const before=h.root.innerHTML;
  late.resolve({task:task({title:'LATE_PRIVATE_INITIAL_TASK'})});await tick();
  assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/LATE_PRIVATE_INITIAL_TASK/);
  assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
 });
}

test('account switch before capabilities resolve prevents the initial private task request',async t=>{
 const capabilities=deferred();
 const h=harness(t,{initialScreen:'tasks',initialTaskId:task().id,request:async(path,options,fallback)=>path==='workbench/capabilities'?capabilities.promise:fallback(path,options)});
 h.account({userId:'owner_b'});const before=h.root.innerHTML;capabilities.resolve({enabled:true});await tick();
 assert.deepEqual(h.calls.map(call=>call.path),['workbench/capabilities']);assert.equal(h.root.innerHTML,before);
});

test('an invalid initial task route is ignored and cannot escape the task API path',async t=>{
 const h=harness(t,{initialScreen:'tasks',initialTaskId:'../files/private'});await tick();
 assert.match(h.root.innerHTML,/<h2>我的任务<\/h2>/);
 assert.deepEqual(h.calls.map(call=>call.path),['workbench/capabilities','workbench/tasks','workbench/files']);
});

const primaryButtons=html=>[...html.matchAll(/<button\b[^>]*class="primary"[^>]*>[\s\S]*?<\/button>/g)].map(match=>match[0]);
const budgetApproval=(id,overrides={})=>({id,status:'pending',action:'budget-increase',expiresAt:Date.now()+60000,parameters:{oldBudgetPoints:'100',newBudgetPoints:'200'},...overrides});
const pointsTask=overrides=>task({billingUnit:'POINT',pointsPriceVersion:'points-v1',budgetPoints:'100',spentPoints:'10',reservedPoints:'20',remainingPoints:'90',releasedPoints:'0',...overrides});

for(const status of ['awaiting-confirmation','queued','running','paused','awaiting-user','budget-paused','succeeded','failed','cancelled']){
 test('task '+status+' shows at most one primary action across tabs, approvals and file preview',async t=>{
  const currentTask=pointsTask({status,approvals:[budgetApproval('first-budget'),budgetApproval('second-budget')]});
  const h=harness(t,{initialScreen:'tasks',initialTaskId:currentTask.id,request:async(path,options,fallback)=>path==='workbench/tasks/'+currentTask.id?{task:currentTask}:path==='workbench/files/preview-file/details'?{file:{id:'preview-file',name:'任务成果.txt'},preview:{text:'真实预览文本',truncated:false}}:fallback(path,options)});
  await tick();
  for(const tab of ['overview','outputs','workspace']){
   await h.click('task-tab',undefined,{tab});
   assert.ok(primaryButtons(h.root.innerHTML).length<=1,status+' '+tab+' has competing primary actions');
   if(tab==='overview'&&['paused','awaiting-user','budget-paused'].includes(status)){
    assert.match(primaryButtons(h.root.innerHTML)[0],/data-action="approve"/);
    assert.match(primaryButtons(h.root.innerHTML)[0],/data-id="first-budget"/);
    assert.match(h.root.innerHTML,/<button[^>]*data-action="resume"[^>]*class=""/);
    assert.match(h.root.innerHTML,/<button[^>]*data-id="second-budget"[^>]*class=""/);
    assert.match(h.root.innerHTML,/<details class="wb-library" open><summary>调整最高积分预算/);
   }
   await h.click('preview','preview-file');
   const previewPrimary=primaryButtons(h.root.innerHTML);assert.equal(previewPrimary.length,1);
   assert.match(previewPrimary[0],/data-action="download"/);assert.match(previewPrimary[0],/下载完整文件/);
   assert.match(h.root.innerHTML,/真实预览文本/);
   await h.click('close-preview');assert.ok(primaryButtons(h.root.innerHTML).length<=1);
  }
  assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
 });
}

test('expired approvals do not replace continue as the primary task action',async t=>{
 const currentTask=pointsTask({status:'paused',approvals:[budgetApproval('expired',{expiresAt:Date.now()-1000}),budgetApproval('already-confirmed',{status:'approved'})]});
 const h=harness(t,{initialTaskId:currentTask.id,request:async(path,options,fallback)=>path==='workbench/tasks/'+currentTask.id?{task:currentTask}:fallback(path,options)});
 await tick();assert.equal(primaryButtons(h.root.innerHTML).length,1);assert.match(primaryButtons(h.root.innerHTML)[0],/data-action="resume"/);
 assert.doesNotMatch(h.root.innerHTML,/data-action="approve"/);
});

test('secondary budget confirmation keeps the same explicit authorization payload',async t=>{
 const currentTask=pointsTask({status:'paused',approvals:[budgetApproval('first'),budgetApproval('second')]});
 const h=harness(t,{initialTaskId:currentTask.id,request:async(path,options,fallback)=>path.startsWith('workbench/tasks/'+currentTask.id)?{task:currentTask}:fallback(path,options)});
 await tick();assert.match(h.root.innerHTML,/<button[^>]*data-id="second"[^>]*class=""/);
 await h.click('approve','second');
 const writes=h.calls.filter(call=>call.options?.method==='POST');assert.equal(writes.length,1);
 assert.equal(writes[0].path,'workbench/tasks/'+currentTask.id+'/approve');
 assert.equal(writes[0].options.input.approvalId,'second');assert.equal(writes[0].options.input.approvalAction,'budget-increase');
 assert.equal(writes[0].options.input.version,currentTask.version);assert.equal(writes[0].options.input.budgetPoints,'200');assert.equal(writes[0].options.input.acceptPoints,true);
 assert.equal(typeof writes[0].options.input.requestId,'string');
});

test('file preview temporarily takes primary action priority over the new-task composer',async t=>{
 const h=harness(t,{request:async(path,options,fallback)=>path==='workbench/files/preview-file/details'?{file:{id:'preview-file',name:'资料.txt'},preview:{text:'内容',truncated:false}}:fallback(path,options)});
 await tick();assert.equal(primaryButtons(h.root.innerHTML).length,1);assert.match(primaryButtons(h.root.innerHTML)[0],/生成计划/);
 await h.click('preview','preview-file');assert.equal(primaryButtons(h.root.innerHTML).length,1);assert.match(primaryButtons(h.root.innerHTML)[0],/下载完整文件/);
 assert.match(h.root.innerHTML,/data-plan/);await h.click('close-preview');assert.equal(primaryButtons(h.root.innerHTML).length,1);assert.match(primaryButtons(h.root.innerHTML)[0],/生成计划/);
});
