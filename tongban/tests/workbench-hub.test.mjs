import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/workbench-hub.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountWorkbenchHub}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function harness({bridge=()=>null,api={},...options}={}){let profile={userId:'owner'},cleaned=0;const listeners=new Map(),calls=[],features=[],screens=[],cloud=[],child={};const root={innerHTML:'',contains:()=>true,querySelector:()=>child,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};const cleanup=mountWorkbenchHub(root,{client:{getProfile:()=>profile,getPointsAccount:()=>new Promise(()=>{}),authenticatedRequest:path=>{if(path==='workbench/tasks')return new Promise(()=>{});throw Error('Unexpected API request');},...api},bridge,...options,onOpenFeature:route=>features.push(route),onScreenChange:view=>screens.push(view),mountChat:(target,options)=>{cloud.push({target,options});return ()=>cleaned++;},mountDevices:()=>()=>cleaned++,mountTasks:(target,options)=>{calls.push({target,options});return ()=>cleaned++;}});return {root,calls,features,screens,cloud,cleanup,cleaned:()=>cleaned,account:value=>{profile=value;},click(action,values={}){const target={dataset:{hub:action,...values}};return listeners.get('click')({target:{closest:()=>target}});},input(name,value){return listeners.get('input')({target:{name,value,closest:()=>({})}});},submit(form){return listeners.get('submit')({target:form,preventDefault(){}});}};}
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
 await h.click('tasks');h.cleanup.back();assert.equal(h.cleaned(),2);assert.doesNotMatch(h.root.innerHTML,/订单表去重/);assert.match(h.root.innerHTML,/选择你的情况/);h.cleanup();
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
 const invalid=harness({initialMode:'other',initialScreen:'<invalid>',initialSelected:'<script>'});assert.match(invalid.root.innerHTML,/选择你的情况/);assert.deepEqual(invalid.screens.at(-1),{mode:'work',screen:'home',selected:null});invalid.cleanup();
 const missing=harness({initialScreen:'detail',initialSelected:'unavailable'});assert.equal(missing.screens.at(-1).screen,'workflows');missing.cleanup();
 const tasks=harness({initialScreen:'tasks'});assert.equal(tasks.calls.length,1);assert.equal(tasks.calls[0].options.initialGoal,'');tasks.cleanup();
});

test('brand home centers group decisions and execution with devices as cooperating carriers',async()=>{
 let opened=0;const h=harness({onCollaborate:()=>opened++});
 assert.match(h.root.innerHTML,/群里的共同任务/);
 assert.match(h.root.innerHTML,/执行工具与模型/);
 assert.match(h.root.innerHTML,/手机、电脑与云机协作/);
 assert.equal((h.root.innerHTML.match(/class="wh-route"/g)||[]).length,3);
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
 assert.match(h.root.innerHTML,/我们不代收/);
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
 const h=harness({api:{getPointsAccount:async()=>{requests.push('points/account');return {account:{unit:'POINT',nonTransferable:true,available:'9876',reserved:'20'}};},authenticatedRequest:async(path,options)=>{requests.push(path);assert.equal(options,undefined);return {tasks:[{id:'task-old',title:'较早任务',status:'running',createdAt:'2026-01-01T01:00:00Z'},{id:'task-new',title:'<img src=x onerror=alert(1)>',status:'succeeded',createdAt:'2026-01-02T01:00:00Z'}]};}}});
 assert.match(h.root.innerHTML,/技能交给 AI，判断留给自己。/);
 assert.match(h.root.innerHTML,/思维<span>·<\/span>决策<span>·<\/span>创造性/);
 assert.match(h.root.innerHTML,/YBZ/);assert.match(h.root.innerHTML,/>愚<\/button>/);
 assert.match(h.root.innerHTML,/积分不可转让、不可提现，仅可用于消耗站内服务。/);
 assert.equal((h.root.innerHTML.match(/class="wh-primary\b/g)||[]).length,1);
 assert.match(h.root.innerHTML,/正在读取积分/);assert.doesNotMatch(h.root.innerHTML,/2,480/);
 await settleSummary();
 assert.deepEqual(requests,['points/account','workbench/tasks']);
 assert.match(h.root.innerHTML,/>9,876 分<\/strong>/);assert.match(h.root.innerHTML,/>20 分<\/strong>/);
 assert.match(h.root.innerHTML,/&lt;img src=x/);assert.doesNotMatch(h.root.innerHTML,/<img src=x/);
 assert.ok(h.root.innerHTML.indexOf('data-id="task-new"')<h.root.innerHTML.indexOf('data-id="task-old"'));
 await h.click('recent-task',{id:'forged'});assert.equal(h.calls.length,0);
 await h.click('recent-task',{id:'task-new'});assert.equal(h.calls[0].options.initialTaskId,'task-new');assert.equal(h.calls[0].options.initialScreen,'tasks');
 h.cleanup();
});

test('new task and all tasks select different task destinations without silently creating a task',async()=>{
 const h=harness();await h.click('new-task');assert.equal(h.calls[0].options.initialScreen,'home');assert.equal(h.calls[0].options.initialGoal,'');
 h.cleanup.back();await h.click('tasks');assert.equal(h.calls[1].options.initialScreen,'tasks');assert.equal(h.calls[1].options.initialTaskId,null);h.cleanup();
});

test('summary preserves zero and empty results, and malformed or failing sources remain separate unavailable states',async()=>{
 const h=harness({api:{getPointsAccount:async()=>({unit:'POINT',nonTransferable:true,available:'0',reserved:'0'}),authenticatedRequest:async()=>({tasks:[]})}});
 await settleSummary();assert.match(h.root.innerHTML,/>0 分<\/strong>/);assert.match(h.root.innerHTML,/还没有任务动态/);assert.doesNotMatch(h.root.innerHTML,/暂不可用/);h.cleanup();
 const invalid=harness({api:{getPointsAccount:async()=>({unit:'USD',nonTransferable:true,available:'100',reserved:'0'}),authenticatedRequest:async()=>({tasks:[{id:'task',title:'有效任务',status:'paused',createdAt:'invalid'}]})}});
 await settleSummary();assert.match(invalid.root.innerHTML,/积分暂不可用/);assert.match(invalid.root.innerHTML,/有效任务/);assert.match(invalid.root.innerHTML,/时间待同步/);assert.doesNotMatch(invalid.root.innerHTML,/>100 分<\/strong>/);invalid.cleanup();
 let shouldFail=true;
 const retry=harness({api:{getPointsAccount:async()=>{if(shouldFail)throw Error('private service error');return {unit:'POINT',nonTransferable:true,available:'7',reserved:'0'};},authenticatedRequest:async()=>shouldFail?{tasks:[{title:'invalid row'}]}:{tasks:[]}}});
 await settleSummary();assert.match(retry.root.innerHTML,/积分暂不可用/);assert.match(retry.root.innerHTML,/近期动态暂不可用/);assert.doesNotMatch(retry.root.innerHTML,/private service error/);
 shouldFail=false;await retry.click('refresh-summary');assert.match(retry.root.innerHTML,/>7 分<\/strong>/);assert.match(retry.root.innerHTML,/还没有任务动态/);retry.cleanup();
});

test('late summary responses cannot overwrite child pages, leak across accounts or render after cleanup',async()=>{
 for(const exit of ['screen','account','cleanup']){
  const account=deferred(),tasks=deferred();
  const h=harness({api:{getPointsAccount:()=>account.promise,authenticatedRequest:()=>tasks.promise}});
  await settleSummary();
  if(exit==='screen')await h.click('creator');
  if(exit==='account')h.account({userId:'another-owner'});
  if(exit==='cleanup')h.cleanup();
  const before=h.root.innerHTML;
  account.resolve({unit:'POINT',nonTransferable:true,available:'5678',reserved:'0'});
  tasks.resolve({tasks:[{id:'secret-task',title:'previous-account-private-task',status:'succeeded'}]});
  await settleSummary();assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/previous-account-private-task/);h.cleanup();
 }
});

test('signed-out home reads no private summary and displays its actual state',async()=>{
 let reads=0;
 const h=harness({client:{getProfile:()=>null,getPointsAccount:()=>{reads++;},authenticatedRequest:()=>{reads++;}}});
 await settleSummary();assert.equal(reads,0);assert.match(h.root.innerHTML,/登录后查看你的积分/);assert.match(h.root.innerHTML,/登录后查看你的任务/);h.cleanup();
});

test('recent task ordering accepts actual server millisecond timestamps and only shows the latest three',async()=>{
 const h=harness({api:{getPointsAccount:async()=>({unit:'POINT',nonTransferable:true,available:'1',reserved:'0'}),authenticatedRequest:async()=>({tasks:[{id:'oldest',title:'too old',status:'succeeded',createdAt:1700000000000},{id:'changed',title:'updated task',status:'running',createdAt:1700000000001,updatedAt:1800000000000},{id:'middle',title:'middle task',status:'queued',createdAt:1750000000000},{id:'new',title:'new task',status:'paused',createdAt:1790000000000}]})}});
 await settleSummary();
 assert.doesNotMatch(h.root.innerHTML,/data-id="oldest"/);
 assert.ok(h.root.innerHTML.indexOf('data-id="changed"')<h.root.innerHTML.indexOf('data-id="new"'));
 assert.ok(h.root.innerHTML.indexOf('data-id="new"')<h.root.innerHTML.indexOf('data-id="middle"'));
 h.cleanup();
});
