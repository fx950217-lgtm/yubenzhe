import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const built=await build({entryPoints:[fileURLToPath(new URL('../src/workbench.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountWorkbench}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const drain=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve(value){resolve(value)}};}
const taskId='839ed19e-815d-4bc8-8b85-38938b1399cd';
function plan(goal='为周末读书会制作准备清单'){
 return {status:'ready',planner:'local-rules',plannerVersion:'local-rules-2026-10-10-v1',locale:'zh-CN',goal,operation:'checklist',summary:'把你的目标整理为待办清单。',steps:[{id:'read',title:'核对目标与要点',description:'只读取本次目标。'},{id:'draft',title:'按目标形成可编辑结构',description:'应用本地规则。'},{id:'save',title:'保存草稿与说明文件',description:'生成真实文件，保留30天。'}],artifacts:[{name:'读书会-待办清单.md',mime:'text/markdown; charset=utf-8',description:'可编辑模板'},{name:'处理说明.txt',mime:'text/plain; charset=utf-8',description:'处理说明'}],missingInformation:[],limitations:['本地规则模板，未调用语言模型。'],estimatedMicro:'30000',estimatedRange:{minMicro:'30000',maxMicro:'30000',currency:'USD'},estimatedSeconds:5,priceVersion:'local-file-trial-2026-10-10',userChargeMicro:'0',payer:'platform-trial',externalActions:[]};
}
function task(overrides={}){
 return {id:taskId,title:'读书会准备清单',goal:plan().goal,locale:'zh-CN',planVersion:1,plan:plan(),remainingSteps:3,instructions:[],operation:'checklist',status:'awaiting-confirmation',step:0,version:1,workspaceId:'4a0d38cd-54ca-497e-b53a-805b206ed27d',workspace:{state:'ready',controller:'ai',controllerTaskId:null,version:1},quoteExpiresAt:Date.now()+60000,estimatedMicro:'30000',budgetMicro:'100000',costMicro:'0',reservedMicro:'0',settledMicro:'0',releasedMicro:'0',billingState:'quoted',priceVersion:plan().priceVersion,payer:'platform-trial',userChargeMicro:'0',simulation:true,outputs:[],events:[],approvals:[],invoice:null,createdAt:Date.now(),updatedAt:Date.now(),...overrides};
}

// Only the browser boundary is stubbed: event handlers and rendering are the
// bundled production module. Requests are controllable to reproduce races.
function harness(t,{request,initialTasks=[]}={}){
 let profile={userId:'reader_one'},timer,disposed=false;
 const original={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval,FormData:globalThis.FormData};
 globalThis.setInterval=callback=>{timer=callback;return 4321;};globalThis.clearInterval=()=>{timer=null;};
 globalThis.FormData=class FormData {constructor(form){this.values=form.values;}get(name){return this.values[name]??null;}};
 const listeners=new Map(),calls=[],buttons=[{disabled:false}];
 const root={innerHTML:'',contains:()=>true,querySelectorAll:()=>buttons,querySelector:()=>null,addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name)};
 const fallback=async path=>path==='workbench/capabilities'?{enabled:true}:path==='workbench/tasks'?{tasks:initialTasks}:path==='workbench/files'?{files:[]}:path==='workbench/tasks/'+taskId?{task:task({status:'running',version:3,billingState:'reserved',reservedMicro:'100000'})}:undefined;
 const client={getProfile:()=>profile,authenticatedRequest:async(path,options)=>{calls.push({path,options});const result=request?await request(path,options,fallback):await fallback(path);if(result===undefined)throw Error('Unexpected request: '+path);return result;}};
 const cleanup=mountWorkbench(root,{client});
 const dispose=()=>{if(!disposed){disposed=true;cleanup();}};
 t.after(()=>{dispose();Object.assign(globalThis,original);});
 return {
  root,calls,dispose,listeners,account(value){profile=value;},poll(){timer?.();},
  async click(action,extra={}){const target={dataset:{action,...extra}};await listeners.get('click')?.({target:{closest:()=>target}});},
  async submit(kind,values={}){let prevented=false;const form={values,matches:selector=>selector.split(',').map(s=>s.trim()).includes('[data-'+kind+']')};await listeners.get('submit')?.({target:form,preventDefault(){prevented=true;}});assert.equal(prevented,true);},
  focus(tag){listeners.get('focusin')?.({target:{matches:selector=>selector.split(',').includes(tag)}});},
  blur(){listeners.get('focusout')?.({target:{}});}
 };
}
const posts=h=>h.calls.filter(c=>c.options?.method==='POST');

test('generating a goal plan only shows its confirmation; only a separate submit authorizes the version and budget',async t=>{
 const h=harness(t,{request:async(path,options,fallback)=>path==='workbench/plan'?{plan:plan(options.input.goal),task:task()}:path.endsWith('/confirm')?{task:task({status:'queued',version:2,budgetMicro:'30000',reservedMicro:'30000',billingState:'reserved'})}:fallback(path)});await drain();
 await h.submit('plan',{goal:'为周末读书会制作准备清单'});assert.equal(posts(h).length,1);assert.equal(posts(h)[0].path,'workbench/plan');assert.deepEqual(posts(h)[0].options.input.fileIds,[]);assert.match(h.root.innerHTML,/先确认执行计划/);assert.match(h.root.innerHTML,/确认计划，开始执行/);assert.match(h.root.innerHTML,/待办清单\.md/);
 h.poll();h.poll();await drain();assert.equal(posts(h).some(c=>c.path.endsWith('/confirm')),false);
 await h.submit('confirm',{budget:'0.03'});const confirmations=posts(h).filter(c=>c.path.endsWith('/confirm'));assert.equal(confirmations.length,1);assert.equal(confirmations[0].options.input.planVersion,1);assert.equal(confirmations[0].options.input.version,1);assert.equal(confirmations[0].options.input.priceVersion,plan().priceVersion);assert.equal(confirmations[0].options.input.budgetMicro,'30000');assert.equal(confirmations[0].options.input.acceptTrial,true);assert.match(h.root.innerHTML,/排队中/);
});

for(const [status,heading] of [['needs_information','再补充一点信息'],['needs_configuration','这项能力还未接通'],['unsupported','这项任务暂时不能执行']]){
 test(status+' keeps the typed goal and explains the missing capability without confirming any task',async t=>{
  const goal='先整理会议目标，再给出行动建议',h=harness(t,{request:async(path,options,fallback)=>path==='workbench/plan'?{plan:{...plan(goal),status,summary:'当前目标还不能执行。',missingInformation:['请先补充必要资料。'],steps:[],artifacts:[],estimatedMicro:'0'},task:null}:fallback(path)});await drain();await h.submit('plan',{goal});
  assert.match(h.root.innerHTML,new RegExp(heading));assert.match(h.root.innerHTML,/请先补充必要资料/);assert.ok(h.root.innerHTML.includes('>'+goal+'</textarea>'));assert.doesNotMatch(h.root.innerHTML,/data-confirm|确认计划，开始执行/);h.poll();await drain();assert.deepEqual(posts(h).map(c=>c.path),['workbench/plan']);
 });
}

test('a poll started before pause cannot replace the newer paused task or restore its old version',async t=>{
 const late=deferred();let reads=0;const h=harness(t,{initialTasks:[task({status:'running',version:3})],request:async(path,options,fallback)=>{
  if(path==='workbench/tasks/'+taskId&&++reads===2)return late.promise;
  if(path.endsWith('/pause'))return {task:task({status:'paused',version:4,title:'已暂停的当前任务',billingState:'reserved',reservedMicro:'100000'})};
  if(path.endsWith('/resume'))return {task:task({status:'queued',version:5})};return fallback(path);
 }});await drain();await h.click('open',{id:taskId});h.poll();await drain();assert.equal(reads,2);await h.click('pause');assert.match(h.root.innerHTML,/已暂停的当前任务/);
 late.resolve({task:task({status:'running',version:3,title:'迟到轮询不能重新显示'})});await drain();assert.match(h.root.innerHTML,/已暂停的当前任务/);assert.doesNotMatch(h.root.innerHTML,/迟到轮询不能重新显示/);await h.click('resume');assert.equal(posts(h).find(c=>c.path.endsWith('/resume')).options.input.version,4);
});

test('out-of-order polls keep newer task progress and use its version for the next action',async t=>{
 const late=deferred();let reads=0;const h=harness(t,{request:async(path,options,fallback)=>{
  if(path==='workbench/tasks/'+taskId){reads++;if(reads===2)return late.promise;if(reads===3)return {task:task({status:'running',version:5,step:2,title:'最新处理进度'})};}
  if(path.endsWith('/pause'))return {task:task({status:'paused',version:6})};return fallback(path);
 }});await drain();await h.click('open',{id:taskId});h.poll();await drain();h.poll();await drain();assert.match(h.root.innerHTML,/最新处理进度/);late.resolve({task:task({status:'running',version:4,step:1,title:'旧处理进度'})});await drain();assert.match(h.root.innerHTML,/最新处理进度/);assert.doesNotMatch(h.root.innerHTML,/旧处理进度/);await h.click('pause');assert.equal(posts(h).find(c=>c.path.endsWith('/pause')).options.input.version,5);
});

for(const leave of ['account-change','unmount']){
 test('a delayed plan after '+leave+' cannot render private details or authorize execution',async t=>{
  const planned=deferred(),h=harness(t,{request:async(path,options,fallback)=>path==='workbench/plan'?planned.promise:fallback(path)});await drain();const pending=h.submit('plan',{goal:'起草只属于甲账号的清单'});await drain();assert.equal(posts(h).length,1);
  if(leave==='account-change')h.account({userId:'reader_two'});else h.dispose();h.root.innerHTML='REPLACEMENT_ACCOUNT_OR_PAGE';
  planned.resolve({plan:plan(),task:task({title:'PRIVATE_PLAN_MUST_NOT_RENDER'})});await pending;h.poll();await drain();assert.equal(h.root.innerHTML,'REPLACEMENT_ACCOUNT_OR_PAGE');assert.deepEqual(posts(h).map(c=>c.path),['workbench/plan']);if(leave==='unmount')assert.equal(h.listeners.size,0);
 });
}

test('keyboard focus on a button does not stop progress polling, while editing a field pauses it only until blur',async t=>{
 let reads=0;const h=harness(t,{request:async(path,options,fallback)=>{if(path==='workbench/tasks/'+taskId)reads++;return fallback(path);}});await drain();await h.click('open',{id:taskId});assert.equal(reads,1);
 h.focus('button');h.poll();await drain();assert.equal(reads,2);
 h.focus('textarea');h.poll();await drain();assert.equal(reads,2);
 h.blur();h.poll();await drain();assert.equal(reads,3);
});

test('a persisted plan starts the next draft without its previous goal or attached file',async t=>{
 const h=harness(t,{request:async(path,options,fallback)=>path==='workbench/plan'?{plan:plan(options.input.goal),task:task()}:fallback(path)});await drain();
 await h.listeners.get('change')({target:{hasAttribute:key=>key==='data-choose-file',value:'file-old',checked:true}});await h.submit('plan',{goal:'为本周任务制作检查清单'});assert.deepEqual(posts(h)[0].options.input.fileIds,['file-old']);
 await h.click('screen',{screen:'home'});assert.doesNotMatch(h.root.innerHTML,/data-action="remove-file"/);assert.match(h.root.innerHTML,/<textarea[^>]*name="goal"[^>]*><\/textarea>/);await h.submit('plan',{goal:'为下周制作清单'});assert.deepEqual(posts(h)[1].options.input.fileIds,[]);
});
test('the revised goal is escaped and visible before its new confirmation',async t=>{
 const revised='原目标\n补充要求：包括页面检查与<script>用户输入</script>',h=harness(t,{request:async(path,options,fallback)=>path==='workbench/plan'?{plan:plan(revised),task:task({goal:revised})}:fallback(path)});await drain();await h.submit('plan',{goal:revised});assert.match(h.root.innerHTML,/本次目标与补充要求/);assert.match(h.root.innerHTML,/&lt;script&gt;用户输入&lt;\/script&gt;/);assert.doesNotMatch(h.root.innerHTML,/<script>/);assert.match(h.root.innerHTML,/确认计划，开始执行/);
});
