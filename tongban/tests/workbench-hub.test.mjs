import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/workbench-hub.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountWorkbenchHub}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function harness({bridge=()=>null,api={},...options}={}){let profile={userId:'owner'},cleaned=0;const listeners=new Map(),calls=[],features=[],screens=[],cloud=[],deviceMounts=[],deviceChats=[],child={};const root={innerHTML:'',contains:()=>true,querySelector:()=>child,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};const cleanup=mountWorkbenchHub(root,{client:{getProfile:()=>profile,authenticatedRequest:path=>{if(path==='workbench/tasks')return new Promise(()=>{});if(path==='devices')return Promise.resolve({devices:[]});throw Error('Unexpected API request');},...api},bridge,...options,onOpenFeature:route=>features.push(route),onScreenChange:view=>screens.push(view),mountChat:(target,options)=>{cloud.push({target,options});return ()=>cleaned++;},onDeviceChat:(...args)=>deviceChats.push(args),mountDevices:(target,options)=>{deviceMounts.push(options);return ()=>cleaned++;},mountTasks:(target,options)=>{calls.push({target,options});return ()=>cleaned++;}});return {root,calls,features,screens,cloud,deviceMounts,deviceChats,cleanup,cleaned:()=>cleaned,account:value=>{profile=value;},click(action,values={}){const target={dataset:{hub:action,...values}};return listeners.get('click')({target:{closest:()=>target}});},input(name,value){return listeners.get('input')({target:{name,value,closest:()=>({})}});},submit(form){return listeners.get('submit')({target:form,preventDefault(){}});}};}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};}
test('copying a supported workflow opens only a goal draft; unavailable or forged templates never start a task',async()=>{const h=harness();await h.click('use',{id:'research'});await h.click('use',{id:'__proto__'});assert.equal(h.calls.length,0);await h.click('use',{id:'orders'});assert.equal(h.calls.length,1);assert.match(h.calls[0].options.initialGoal,/订单表/);assert.equal(h.calls[0].options.embedded,true);assert.equal('fileIds' in h.calls[0].options,false);h.cleanup();});
test('switching away cleans the task component without requesting cancellation or changing a server task',async()=>{const h=harness();await h.click('tasks');await h.click('mode',{mode:'chat'});await h.click('chat-local');assert.equal(h.cleaned(),1);assert.match(h.root.innerHTML,/本机模型/);h.cleanup();assert.equal(h.cleaned(),1);});
test('a late local model discovery cannot overwrite another mode or leak model names after account switch',async()=>{for(const exit of ['mode','account','cleanup']){const value=deferred();const h=harness({bridge:()=>({status:()=>value.promise})});await h.click('mode',{mode:'chat'});await h.click('chat-local');const p=h.click('check');if(exit==='mode')await h.click('mode',{mode:'work'});if(exit==='account')h.account({userId:'another'});if(exit==='cleanup')h.cleanup();const before=h.root.innerHTML;value.resolve({available:true,models:[{name:'private-model-name'}]});await p;assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/private-model-name/);h.cleanup();}});
test('leaving local chat cancels the same request and discards its eventual reply',async t=>{const result=deferred(),cancelled=[];const h=harness({bridge:()=>({status:async()=>({available:true,models:[{name:'local-model'}]}),generate:()=>result.promise,cancel:id=>cancelled.push(id)})});const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};t.after(()=>{globalThis.FormData=original;h.cleanup();});await h.click('mode',{mode:'chat'});await h.click('chat-local');await h.click('check');const running=h.submit({matches:()=>true,values:{prompt:'test prompt',model:'local-model'}});await h.click('mode',{mode:'work'});assert.equal(cancelled.length,1);const before=h.root.innerHTML;result.resolve({local:true,text:'late private reply'});await running;assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/late private reply/);});
test('local AI output is rendered as text, never executable markup',async t=>{const h=harness({bridge:()=>({status:async()=>({available:true,models:[{name:'local-model'}]}),generate:async()=>({local:true,text:'<img src=x onerror=alert(1)>'})})});const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};t.after(()=>{globalThis.FormData=original;h.cleanup();});await h.click('mode',{mode:'chat'});await h.click('chat-local');await h.click('check');await h.submit({matches:()=>true,values:{prompt:'test',model:'local-model'}});assert.match(h.root.innerHTML,/&lt;img/);assert.doesNotMatch(h.root.innerHTML,/<img src=x/);});

test('a running reply keeps its request model even if a stale selection event arrives',async t=>{
 const reply=deferred(),requests=[];
 const h=harness({bridge:()=>({status:async()=>({available:true,models:[{name:'model-a'},{name:'model-b'}]}),generate:input=>{requests.push(input);return reply.promise;}})});
 const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
 t.after(()=>{globalThis.FormData=original;h.cleanup();});
 await h.click('mode',{mode:'chat'});await h.click('chat-local');await h.click('check');
 const running=h.submit({matches:()=>true,values:{prompt:'first question',model:'model-a'}});
 assert.equal(requests.length,1);assert.equal(requests[0].model,'model-a');
 assert.match(h.root.innerHTML,/<select\b[^>]*name="model"[^>]*\bdisabled/);
 // A queued/programmatic event cannot change the attribution of an in-flight reply.
 h.input('model','model-b');
 await h.submit({matches:()=>true,values:{prompt:'second question',model:'model-b'}});
 assert.equal(requests.length,1);
 reply.resolve({local:true,text:'answer from model-a'});await running;
 assert.match(h.root.innerHTML,/<strong>AI · model-a<\/strong><p>answer from model-a<\/p>/);
 assert.doesNotMatch(h.root.innerHTML,/<strong>AI · model-b<\/strong>/);
 assert.doesNotMatch(h.root.innerHTML,/<select\b[^>]*name="model"[^>]*\bdisabled/);
});

test('selecting or discovering another model never relabels the completed reply',async t=>{
 let checks=0;const requests=[];
 const h=harness({bridge:()=>({status:async()=>({available:true,models:++checks===1?[{name:'model-a'},{name:'model-b'}]:[{name:'model-b'},{name:'model-a'}]}),generate:async input=>{requests.push(input);return {local:true,text:'reply via '+input.model};}})});
 const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
 t.after(()=>{globalThis.FormData=original;h.cleanup();});
 await h.click('mode',{mode:'chat'});await h.click('chat-local');await h.click('check');
 await h.submit({matches:()=>true,values:{prompt:'first',model:'model-a'}});
 h.input('model','model-b');await h.click('check');
 assert.match(h.root.innerHTML,/<option value="model-b" selected/);
 assert.match(h.root.innerHTML,/<strong>AI · model-a<\/strong><p>reply via model-a<\/p>/);
 await h.submit({matches:()=>true,values:{prompt:'second',model:'model-b'}});
 assert.deepEqual(requests.map(request=>request.model),['model-a','model-b']);
 assert.match(h.root.innerHTML,/<strong>AI · model-b<\/strong><p>reply via model-b<\/p>/);
 assert.doesNotMatch(h.root.innerHTML,/reply via model-a/);
});

test('brand home preserves task and community entries with template details one level inside',async()=>{
 const h=harness();
 assert.match(h.root.innerHTML,/class="wh-entry"/);
 assert.doesNotMatch(h.root.innerHTML,/订单表去重|会议文字整理|从一个能交付的工作开始|查看工作流/);
 assert.equal(h.cleanup.back(),false);
 for(const route of ['bounty','provider','rank','token'])await h.click('feature',{route});
 await h.click('feature',{route:'admin'});assert.deepEqual(h.features,['bounty','provider','rank','token']);
 await h.click('workflows');assert.match(h.root.innerHTML,/订单表去重/);assert.match(h.root.innerHTML,/待接入模型/);
 await h.click('detail',{id:'research'});assert.match(h.root.innerHTML,/模型与编排器尚未接通/);assert.doesNotMatch(h.root.innerHTML,/data-hub="use"/);
 assert.equal(h.cleanup.back(),true);assert.match(h.root.innerHTML,/会议文字整理/);
 assert.equal(h.cleanup.back(),true);assert.doesNotMatch(h.root.innerHTML,/订单表去重/);assert.equal(h.cleanup.back(),false);h.cleanup();
});

test('template task return preserves its detail while direct tasks return to entry rows',async()=>{
 const h=harness();await h.click('workflows');await h.click('detail',{id:'orders'});await h.click('use',{id:'orders'});
 assert.equal(h.cleanup.back(),true);assert.equal(h.cleaned(),1);assert.match(h.root.innerHTML,/订单表去重/);assert.match(h.root.innerHTML,/你提供/);
 assert.equal(h.cleanup.back(),true);assert.match(h.root.innerHTML,/会议文字整理/);h.cleanup.back();
 await h.click('tasks');h.cleanup.back();assert.equal(h.cleaned(),2);assert.doesNotMatch(h.root.innerHTML,/订单表去重/);assert.match(h.root.innerHTML,/我的电脑/);h.cleanup();
});

test('chat entrance defers model status and form until a detail is opened; back discards late checks',async()=>{
 const checked=deferred();let count=0;const h=harness({initialMode:'chat',bridge:()=>({status:()=>{count++;return checked.promise;}})});
 assert.match(h.root.innerHTML,/免费云端模型/);assert.doesNotMatch(h.root.innerHTML,/检查本机模型|data-hub-chat|尚未接入/);assert.equal(count,0);
 await h.click('chat-cloud');assert.equal(h.cloud.length,1);assert.equal(h.cleanup.back(),true);
 await h.click('chat-local');const pending=h.click('check');assert.equal(count,1);assert.equal(h.cleanup.back(),true);const home=h.root.innerHTML;
 checked.resolve({available:true,models:[{name:'late-private-model'}]});await pending;assert.equal(h.root.innerHTML,home);h.cleanup();
});

test('restoring a valid location preserves mode and detail, while invalid values fall back safely',()=>{
 const detail=harness({initialMode:'work',initialScreen:'detail',initialSelected:'meeting'});assert.match(detail.root.innerHTML,/会议文字整理/);assert.match(detail.root.innerHTML,/你提供/);assert.deepEqual(detail.screens.at(-1),{mode:'work',screen:'detail',selected:'meeting'});detail.cleanup();
 const chat=harness({initialMode:'chat',initialScreen:'chat-cloud'});assert.equal(chat.cloud.length,1);assert.equal(chat.screens.at(-1).mode,'chat');chat.cleanup();
 const invalid=harness({initialMode:'other',initialScreen:'<invalid>',initialSelected:'<script>'});assert.match(invalid.root.innerHTML,/我的电脑/);assert.deepEqual(invalid.screens.at(-1),{mode:'work',screen:'home',selected:null});invalid.cleanup();
 const missing=harness({initialScreen:'detail',initialSelected:'unavailable'});assert.equal(missing.screens.at(-1).screen,'workflows');missing.cleanup();
 const tasks=harness({initialScreen:'tasks'});assert.equal(tasks.calls.length,1);assert.equal(tasks.calls[0].options.initialGoal,'');tasks.cleanup();
});

test('brand home centers group decisions and execution with devices as cooperating carriers',async()=>{
 let opened=0;const h=harness({onCollaborate:()=>opened++});
 assert.match(h.root.innerHTML,/群协作/);
 assert.match(h.root.innerHTML,/工具与模型/);
 assert.match(h.root.innerHTML,/我的电脑/);
 assert.match(h.root.innerHTML,/data-hub="cooperation"/);assert.match(h.root.innerHTML,/data-hub="tasks"/);assert.match(h.root.innerHTML,/data-hub="workflows"/);
 assert.match(h.root.innerHTML,/<details class="wh-about">/);
 assert.match(h.root.innerHTML,/人负责思维、决策、方向、创意和授权/);
 assert.doesNotMatch(h.root.innerHTML,/我们不提供 AI 本身|把你的电脑变成 AI 工作站/);
 await h.click('cooperation');assert.equal(opened,1);assert.equal(h.calls.length,0);
 assert.doesNotMatch(h.root.innerHTML,/即将上线/);
 h.cleanup();
});

test('the AI page lists four provider tiers with official https links and never collects keys',async()=>{
 const h=harness();await h.click('workflows');
 assert.match(h.root.innerHTML,/不知道选哪个|先装免费的 Ollama/);
 assert.match(h.root.innerHTML,/Ollama \+ Qwen3/);assert.match(h.root.innerHTML,/DeepSeek/);
 assert.match(h.root.innerHTML,/Codex CLI/);assert.match(h.root.innerHTML,/ChatGPT Plus/);
 assert.match(h.root.innerHTML,/https:\/\/ollama\.com\/download/);
 assert.match(h.root.innerHTML,/https:\/\/platform\.deepseek\.com/);
 assert.match(h.root.innerHTML,/https:\/\/chatgpt\.com/);
 assert.match(h.root.innerHTML,/rel="noopener noreferrer nofollow"/);
 assert.match(h.root.innerHTML,/登录必须由你本人完成/);
 assert.match(h.root.innerHTML,/仅提供官方入口/);
 assert.doesNotMatch(h.root.innerHTML,/API Key.*<input|name="key"|name="password"/);
 assert.doesNotMatch(h.root.innerHTML,/\$\d|\d+ ?美元|美元\/月/);
 assert.match(h.root.innerHTML,/订单表去重/);
 h.cleanup();
});

test('the chat entry moves into secondary content, not the hero',async()=>{
 const h=harness();
 assert.match(h.root.innerHTML,/data-hub="chat-entry"/);
 const hero=h.root.innerHTML.slice(0,h.root.innerHTML.indexOf('</header>'));
 assert.doesNotMatch(hero,/data-hub="chat-entry"/);
 await h.click('chat-entry');
 assert.equal(h.screens.at(-1).mode,'chat');
 h.cleanup();
});

const settleSummary=()=>new Promise(resolve=>setImmediate(resolve));
test('brand home renders exact copy, one primary action and only real account/task summary data',async()=>{
 const requests=[];
 const h=harness({api:{authenticatedRequest:async(path,options)=>{requests.push(path);assert.equal(options,undefined);if(path==='devices')return {devices:[]};return {tasks:[{id:'task-old',title:'较早任务',status:'running',createdAt:'2026-01-01T01:00:00Z'},{id:'task-new',title:'<img src=x onerror=alert(1)>',status:'succeeded',createdAt:'2026-01-02T01:00:00Z'}]};}}});
 assert.match(h.root.innerHTML,/技能交给 AI，判断留给自己。/);
 assert.match(h.root.innerHTML,/思维、决策、方向、创意和授权/);
 assert.match(h.root.innerHTML,/需要你决策/);assert.match(h.root.innerHTML,/最近完成/);
 assert.doesNotMatch(h.root.innerHTML,/积分|POINT|data-hub="points"/);
 assert.equal((h.root.innerHTML.match(/class="wh-primary\b/g)||[]).length,1);
 assert.match(h.root.innerHTML,/正在读取任务/);assert.doesNotMatch(h.root.innerHTML,/2,480/);
 await settleSummary();
 assert.deepEqual(requests,['workbench/tasks','devices']);
 assert.match(h.root.innerHTML,/&lt;img src=x/);assert.doesNotMatch(h.root.innerHTML,/<img src=x/);
 assert.match(h.root.innerHTML,/data-summary="running"[\s\S]*data-id="task-old"[\s\S]*data-summary="completed"[\s\S]*data-id="task-new"/);
 await h.click('recent-task',{id:'forged'});assert.equal(h.calls.length,0);
 await h.click('recent-task',{id:'task-new'});assert.equal(h.calls[0].options.initialTaskId,'task-new');assert.equal(h.calls[0].options.initialScreen,'tasks');
 h.cleanup();
});

test('new task and all tasks select different task destinations without silently creating a task',async()=>{
 const h=harness();await h.click('new-task');assert.equal(h.calls[0].options.initialScreen,'home');assert.equal(h.calls[0].options.initialGoal,'');
 h.cleanup.back();await h.click('tasks');assert.equal(h.calls[1].options.initialScreen,'tasks');assert.equal(h.calls[1].options.initialTaskId,null);h.cleanup();
});

test('summary preserves empty results and malformed tasks stay unavailable until a successful retry',async()=>{
 const h=harness({api:{authenticatedRequest:async path=>path==='devices'?{devices:[]}:{tasks:[]}}});await settleSummary();assert.match(h.root.innerHTML,/暂无正在执行的任务/);assert.doesNotMatch(h.root.innerHTML,/暂不可用|积分/);h.cleanup();
 let shouldFail=true;const retry=harness({api:{authenticatedRequest:async path=>path==='devices'?{devices:[]}:shouldFail?{tasks:[{title:'invalid row'}]}:{tasks:[{id:'task',title:'有效任务',status:'paused',createdAt:'invalid'}]}}});await settleSummary();assert.match(retry.root.innerHTML,/文件工具任务暂不可用/);shouldFail=false;await retry.click('refresh-summary');assert.match(retry.root.innerHTML,/有效任务/);assert.match(retry.root.innerHTML,/已暂停/);assert.doesNotMatch(retry.root.innerHTML,/积分|POINT/);retry.cleanup();
});
test('late summary responses cannot overwrite child pages, leak across accounts or render after cleanup',async()=>{
 for(const exit of ['screen','account','cleanup']){
  const tasks=deferred();
  const h=harness({api:{authenticatedRequest:()=>tasks.promise}});
  await settleSummary();
  if(exit==='screen')await h.click('creator');
  if(exit==='account')h.account({userId:'another-owner'});
  if(exit==='cleanup')h.cleanup();
  const before=h.root.innerHTML;
  tasks.resolve({tasks:[{id:'secret-task',title:'previous-account-private-task',status:'succeeded'}]});
  await settleSummary();assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/previous-account-private-task/);h.cleanup();
 }
});

test('signed-out home reads no private summary and displays its actual state',async()=>{
 let reads=0;
 const h=harness({client:{getProfile:()=>null,authenticatedRequest:()=>{reads++;}}});
 await settleSummary();assert.equal(reads,0);assert.match(h.root.innerHTML,/登录后查看你的任务/);h.cleanup();
});

test('completed ordering accepts actual timestamps and limits only the completed section to three',async()=>{
 const tasks=[{id:'oldest',title:'too old',status:'succeeded',createdAt:1700000000000},{id:'changed',title:'updated task',status:'succeeded',createdAt:1700000000001,updatedAt:1800000000000},{id:'middle',title:'middle task',status:'succeeded',createdAt:1750000000000},{id:'new',title:'new task',status:'succeeded',createdAt:1790000000000},{id:'active',title:'running is separate',status:'running',createdAt:1600000000000}];
 const h=harness({api:{authenticatedRequest:async path=>path==='devices'?{devices:[]}:{tasks}}});
 await settleSummary();
 assert.doesNotMatch(h.root.innerHTML,/data-id="oldest"/);assert.match(h.root.innerHTML,/data-id="active"/);
 assert.ok(h.root.innerHTML.indexOf('data-id="changed"')<h.root.innerHTML.indexOf('data-id="new"'));
 assert.ok(h.root.innerHTML.indexOf('data-id="new"')<h.root.innerHTML.indexOf('data-id="middle"'));
 h.cleanup();
});

const readyDevice=(id='computer',name='我的电脑')=>({id,name,online:true,aiOnline:true,providers:[{id:'codex',installed:true,loggedIn:true,executionSupported:true,executionMode:'tools'},{id:'ollama',installed:true,loggedIn:null,executionSupported:true,executionMode:'chat-only'}]});
function overviewApi({devices=[readyDevice()],tasks=[],computer=[],failure=null}={}){return {authenticatedRequest:async(path,options)=>{
 assert.equal(options,undefined,'dashboard must never write');
 if(path==='devices')return {devices};
 if(path==='workbench/tasks')return {tasks};
 const device=devices.find(item=>path==='ai-channel/devices/'+encodeURIComponent(item.id));
 if(!device)throw Error('Unexpected path');
 if(failure)throw Error(failure);
 return {device,tasks:computer.filter(task=>task.deviceId===device.id)};
}};}
test('real device activity and rule progress stay distinct; no synthetic AI percentage or accepted delivery',async()=>{
 const h=harness({api:overviewApi({tasks:[{id:'rule',title:'文件去重',status:'running',step:1,remainingSteps:2},{id:'decision',title:'待批准清单',status:'awaiting-confirmation'},{id:'done',title:'已处理文件',status:'succeeded',outputs:[{id:'a'},{id:'b'}]}],computer:[{id:'ai-run',deviceId:'computer',provider:'codex',status:'running',prompt:'真实任务',step:72,remainingSteps:28},{id:'ai-done',deviceId:'computer',provider:'codex',status:'completed',prompt:'电脑回复',finishedAt:1800000000000}]})});
 await settleSummary();
 assert.match(h.root.innerHTML,/正在执行 1 项任务/);assert.match(h.root.innerHTML,/aria-valuemax="3" aria-valuenow="1"/);assert.match(h.root.innerHTML,/>33%/);assert.doesNotMatch(h.root.innerHTML,/72%/);
 assert.match(h.root.innerHTML,/data-summary="decisions"[\s\S]*待批准清单/);
 assert.match(h.root.innerHTML,/2 份成果/);assert.match(h.root.innerHTML,/回复已结束，待核对/);
 await h.click('recent-task',{id:'ai-run',origin:'device'});assert.deepEqual(h.deviceChats,[['computer','codex',{taskId:'ai-run'}]]);
 await h.click('recent-task',{id:'decision',origin:'rules'});assert.equal(h.calls[0].options.initialTaskId,'decision');
 h.cleanup();
});
test('machine-code addition opens existing devices claim UI; normal management does not force it',async()=>{
 const h=harness();await h.click('add-device');assert.equal(h.deviceMounts[0].initialClaim,true);
 h.cleanup.back();await h.click('devices');assert.equal(h.deviceMounts[1].initialClaim,false);h.cleanup();
});
test('dispatch requires explicit owned executable provider and carries only a draft, without a send request',async t=>{
 const h=harness({api:overviewApi()});await settleSummary();
 const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
 t.after(()=>{globalThis.FormData=original;h.cleanup();});
 assert.match(h.root.innerHTML,/<option value="">先选择自己的电脑/);assert.doesNotMatch(h.root.innerHTML,/value="computer" selected/);
 const submit=values=>h.submit({matches:selector=>selector==='[data-hub-assign]',values});
 for(const values of [{draft:'目标'}, {draft:'目标',deviceId:'someone-else',provider:'codex'}, {draft:'目标',deviceId:'computer',provider:'claude'}, {draft:'',deviceId:'computer',provider:'codex'}])await submit(values);
 assert.equal(h.deviceChats.length,0);
 await h.click('pick-device',{id:'computer'});assert.match(h.root.innerHTML,/value="computer" selected/);assert.doesNotMatch(h.root.innerHTML,/value="codex" selected/);
 await submit({draft:'  处理这些文件  ',deviceId:'computer',provider:'codex'});
 assert.deepEqual(h.deviceChats,[['computer','codex',{draft:'处理这些文件'}]]);
 h.account({userId:'other'});await submit({draft:'不得发送',deviceId:'computer',provider:'codex'});assert.equal(h.deviceChats.length,1);
});
test('offline, revoked and stale AI never becomes executable merely because it was installed',async t=>{
 const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};t.after(()=>{globalThis.FormData=original;});
 for(const patch of [{online:false,aiOnline:false},{revoked:true},{providersStale:true},{providers:[{id:'codex',installed:true,loggedIn:false,executionSupported:true,executionMode:'tools'}]}]){
  const h=harness({api:overviewApi({devices:[{...readyDevice(),...patch}]})});await settleSummary();
  await h.submit({matches:selector=>selector==='[data-hub-assign]',values:{draft:'任务',deviceId:'computer',provider:'codex'}});
  assert.equal(h.deviceChats.length,0);h.cleanup();
 }
});
test('partial failures remain explicit and cannot erase good task results or claim a computer is idle',async()=>{
 const h=harness({api:overviewApi({tasks:[{id:'good',title:'真实完成',status:'succeeded'}],failure:'offline'})});await settleSummary();
 assert.match(h.root.innerHTML,/真实完成/);assert.match(h.root.innerHTML,/任务状态暂不可用/);assert.doesNotMatch(h.root.innerHTML,/在线 · 空闲/);h.cleanup();
 const mismatch=harness({api:{authenticatedRequest:async path=>path==='devices'?{devices:[readyDevice()]}:path==='workbench/tasks'?{tasks:[]}:{device:{id:'another-device'},tasks:[{id:'bad',deviceId:'another-device',status:'running',prompt:'other-device-secret'}]}}});
 await settleSummary();assert.doesNotMatch(mismatch.root.innerHTML,/other-device-secret/);assert.match(mismatch.root.innerHTML,/任务状态暂不可用/);mismatch.cleanup();
});
test('late computer task reads do not render after switching accounts or leaving the workbench',async()=>{
 for(const exit of ['account','cleanup','screen']){
  const detail=deferred();const h=harness({api:{authenticatedRequest:async path=>path==='devices'?{devices:[readyDevice()]}:path==='workbench/tasks'?{tasks:[]}:detail.promise}});
  await settleSummary();
  if(exit==='account')h.account({userId:'other'});
  if(exit==='cleanup')h.cleanup();
  if(exit==='screen')await h.click('workflows');
  const before=h.root.innerHTML;
  detail.resolve({device:readyDevice(),tasks:[{id:'private',deviceId:'computer',status:'running',prompt:'private-computer-task'}]});
  await settleSummary();assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/private-computer-task/);h.cleanup();
 }
});
