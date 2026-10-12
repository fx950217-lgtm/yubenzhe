import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const built=await build({entryPoints:[fileURLToPath(new URL('../src/group-device-ai.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountGroupDeviceAI}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const cid='11111111-1111-4111-8111-111111111111',did='22222222-2222-4222-8222-222222222222',sid='33333333-3333-4333-8333-333333333333',otherSid='44444444-4444-4444-8444-444444444444';
const session=(overrides={})=>({id:sid,owner:true,round:0,maxRounds:10,status:'ready',replies:[],...overrides});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(t,{sessions=[],request,storage:providedStorage}={}){
 let profile={userId:'owner'},current=sessions;
 const handlers=new Map(),events=new Map(),timers=new Map(),calls=[];
 const originals={window:globalThis.window,document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 const remove=(key,fn)=>{if(events.get(key)===fn)events.delete(key);};
 globalThis.window={addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:remove};
 globalThis.document={hidden:false,addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:remove};
 globalThis.setInterval=fn=>{const id=Symbol();timers.set(id,fn);return id;};
 globalThis.clearInterval=id=>timers.delete(id);
 const root={innerHTML:'',querySelector:()=>null,addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:(key,fn)=>{if(handlers.get(key)===fn)handlers.delete(key);}};
 const defaults=async(path,options)=>{
  if(path==='devices')return {devices:[{id:did,name:'电脑',online:true,providers:[{id:'ollama',installed:true,loggedIn:null,executionSupported:true,executionMode:'chat-only'},{id:'claude',installed:false}]}]};
  if(path.endsWith('/roster'))return {version:1,canManage:true,members:[{id:'roster-ollama',kind:'ai',alias:'方案顾问',deviceId:did,provider:'ollama',canChat:true}]};
  if(path.includes('/groups/'))return {canManage:true,allowDeviceAI:true};
  if(path.includes('?'))return {sessions:current};
  const id=path.split('/')[1];
  if(path.endsWith('/next')){current=current.map(row=>row.id===id?{...row,status:'running',round:row.round+1}:row);return {session:current.find(row=>row.id===id)};}
  if(path.endsWith('/stop')){current=current.map(row=>row.id===id?{...row,status:'stopped'}:row);return {session:current.find(row=>row.id===id)};}
  if(path==='group-device-ai'){const created=session();current=[created,...current.filter(row=>row.id!==sid)];return {session:created};}
  return {session:current.find(row=>row.id===id)};
 };
 const storageValues=new Map(),storage=providedStorage||{getItem:key=>storageValues.get(key)||null,setItem:(key,value)=>storageValues.set(key,value),removeItem:key=>storageValues.delete(key)};
 const cleanup=mountGroupDeviceAI(root,{storage,client:{getProfile:()=>profile,authenticatedRequest:async(path,options)=>{calls.push({path,...options,account:profile.userId});return request?request(path,options,defaults):defaults(path,options);}},conversationId:cid,pollMs:5000});
 t.after(()=>{cleanup();Object.assign(globalThis,originals);});
 return {
  root,calls,cleanup,events,timers,handlers,
  choose:(taskId,optionId='option-2')=>handlers.get('click')?.({target:{closest:()=>({dataset:{decisionAction:'choose',decisionTask:taskId,decisionOption:optionId}})}}),
  account:(userId='other')=>{profile={userId};},
  input:(name,value,checked)=>handlers.get('input')?.({target:{name,value,checked}}),
  submit:()=>handlers.get('submit')?.({preventDefault(){},target:{matches:()=>true}}),
  click:(action,id)=>handlers.get('click')?.({target:{closest:()=>({dataset:{gai:action,id}})}}),
  emit:(type,hidden)=>{if(hidden!==undefined)globalThis.document.hidden=hidden;events.get(type)?.();},
  async poll(){for(const fn of timers.values())fn();await tick();},
 };
}
function prepare(h){h.input('device',did);h.input('provider','roster-ollama',true);h.input('goal','fixture discussion');h.input('share','',true);}
const count=(h,suffix)=>h.calls.filter(call=>call.path.endsWith(suffix));

test('installed providers outside the roster cannot start a discussion, including forged legacy selections',async t=>{
 const h=harness(t,{request:(path,options,defaults)=>path.endsWith('/roster')?{version:0,canManage:true,members:[]}:defaults(path,options)});await tick();prepare(h);h.input('provider','ollama',true);await h.submit();assert.equal(count(h,'group-device-ai').length,0);assert.match(h.root.innerHTML,/仅可使用本群 AI 名单/);
});
test('roster entries from another owner never become executable through an available local provider',async t=>{
 const h=harness(t,{request:(path,options,defaults)=>path.endsWith('/roster')?{version:1,canManage:false,members:[{id:'roster-ollama',kind:'ai',alias:'别人的顾问',provider:'ollama',canChat:false}]}:defaults(path,options)});await tick();prepare(h);await h.submit();assert.equal(count(h,'group-device-ai').length,0);
});

test('explicit sharing creates a discussion, and only a manual round approval starts work',async t=>{
 const h=harness(t);await tick();prepare(h);h.input('share','',false);await h.submit();assert.equal(count(h,'group-device-ai').length,0);
 h.input('share','',true);await h.submit();await tick();assert.equal(count(h,'group-device-ai').length,1);assert.match(h.root.innerHTML,/第 0 \/ 10 轮/);
 assert.deepEqual(count(h,'group-device-ai')[0].input.rosterIds,['roster-ollama']);assert.equal('deviceId' in count(h,'group-device-ai')[0].input,false);assert.equal('providers' in count(h,'group-device-ai')[0].input,false);
 await h.poll();await h.poll();assert.equal(count(h,'/next').length,0);
 await h.click('next',sid);await tick();assert.equal(count(h,'/next').length,1);assert.equal(count(h,'/next')[0].input.approveExecution,true);assert.match(h.root.innerHTML,/执行中/);
 await h.poll();assert.equal(count(h,'/next').length,1);
});

test('stop-all acts only on owned live sessions and renders model HTML as escaped text',async t=>{
 const h=harness(t,{sessions:[session({status:'running',replies:[{provider:'ollama',text:'<img onerror=bad>'}]}),session({id:otherSid,owner:false,status:'running'})]});await tick();
 assert.match(h.root.innerHTML,/&lt;img onerror=bad&gt;/);assert.doesNotMatch(h.root.innerHTML,/<img/);
 await h.click('stop-all');await tick();assert.deepEqual(count(h,'/stop').map(call=>call.path),['group-device-ai/'+sid+'/stop']);
});

test('pagehide stops owned sessions and suspends polling even before document.hidden changes',async t=>{
 const h=harness(t,{sessions:[session({status:'running'}),session({id:otherSid,owner:false,status:'running'})]});await tick();
 const heartbeats=count(h,'/heartbeat').length;h.emit('pagehide');await tick();await h.poll();await h.click('next',sid);
 assert.deepEqual(count(h,'/stop').map(call=>call.path),['group-device-ai/'+sid+'/stop']);assert.equal(count(h,'/heartbeat').length,heartbeats);assert.equal(count(h,'/next').length,0);
});

test('visibilitychange stops owned sessions; becoming visible does not approve another round',async t=>{
 const h=harness(t,{sessions:[session({status:'running'}),session({id:otherSid,owner:false,status:'running'})]});await tick();
 h.emit('visibilitychange',true);const heartbeats=count(h,'/heartbeat').length;await h.poll();assert.equal(count(h,'/heartbeat').length,heartbeats);assert.equal(count(h,'/stop').length,1);
 h.emit('visibilitychange',false);await tick();assert.match(h.root.innerHTML,/已停止/);assert.equal(count(h,'/next').length,0);
});

test('unmount stops only owned sessions and removes every listener and polling timer',async t=>{
 const h=harness(t,{sessions:[session({status:'running'}),session({id:otherSid,owner:false,status:'running'})]});await tick();h.cleanup();await tick();
 assert.deepEqual(count(h,'/stop').map(call=>call.path),['group-device-ai/'+sid+'/stop']);assert.equal(h.events.size,0);assert.equal(h.timers.size,0);assert.equal(h.handlers.size,0);
 const total=h.calls.length;h.cleanup();await h.poll();assert.equal(h.calls.length,total);
});

for(const leave of ['unmount','pagehide','visibilitychange'])test('late creation after '+leave+' is stopped without starting any round',async t=>{
 const wait=deferred(),h=harness(t,{request:async(path,options,defaults)=>{if(path==='group-device-ai'){await wait.promise;return defaults(path,options);}return defaults(path,options);}});await tick();prepare(h);
 const pending=h.submit();assert.equal(count(h,'group-device-ai').length,1);
 if(leave==='unmount')h.cleanup();else h.emit(leave,leave==='visibilitychange'?true:undefined);
 const before=h.root.innerHTML;wait.resolve();await pending;await tick();
 assert.deepEqual(count(h,'/stop').map(call=>call.path),['group-device-ai/'+sid+'/stop']);assert.equal(count(h,'/next').length,0);assert.equal(h.root.innerHTML,before);
});

test('a creation that returns after hiding and returning is still revoked by its old lifecycle',async t=>{
 const wait=deferred(),h=harness(t,{request:async(path,options,defaults)=>{if(path==='group-device-ai')await wait.promise;return defaults(path,options);}});await tick();prepare(h);const pending=h.submit();
 h.emit('visibilitychange',true);h.emit('visibilitychange',false);wait.resolve();await pending;await tick();
 assert.equal(count(h,'/stop').length,1);assert.equal(count(h,'/next').length,0);assert.match(h.root.innerHTML,/已停止/);
});

test('account changes discard late creation and never send an old stop using the new account',async t=>{
 const wait=deferred(),h=harness(t,{request:async(path,options,defaults)=>{if(path==='group-device-ai')await wait.promise;return defaults(path,options);}});await tick();prepare(h);const pending=h.submit();
 h.account();const before=h.root.innerHTML;wait.resolve();await pending;await tick();h.emit('pagehide');await h.poll();h.cleanup();
 assert.equal(h.root.innerHTML,before);assert.equal(count(h,'/stop').length,0);assert.equal(h.calls.some(call=>call.account==='other'),false);
});

test('old-account loading cannot render old replies or renew its heartbeat after an account switch',async t=>{
 const wait=deferred(),h=harness(t,{request:(path,options,defaults)=>path.includes('?')?wait.promise:defaults(path,options)});
 h.account();const before=h.root.innerHTML;wait.resolve({sessions:[session({status:'running',replies:[{provider:'ollama',text:'PRIVATE-OLD-ACCOUNT'}]})]});await tick();
 assert.equal(h.root.innerHTML,before);assert.equal(count(h,'/heartbeat').length,0);assert.equal(h.calls.some(call=>call.account==='other'),false);
});

test('late loading across a hide transition does not revive heartbeat from a stale page lifecycle',async t=>{
 const wait=deferred(),h=harness(t,{request:(path,options,defaults)=>path.includes('?')?wait.promise:defaults(path,options)});
 h.emit('visibilitychange',true);h.emit('visibilitychange',false);wait.resolve({sessions:[session({status:'running'})]});await tick();
 assert.equal(count(h,'/heartbeat').length,0);assert.equal(count(h,'/next').length,0);
});

test('action errors survive successful refresh; lost round acknowledgement is never automatically retried',async t=>{
 let tries=0;const h=harness(t,{sessions:[session()],request:async(path,options,defaults)=>{if(path.endsWith('/next')&&++tries===1)throw Error('未确认的执行结果');return defaults(path,options);}});await tick();
 await h.click('next',sid);await tick();assert.match(h.root.innerHTML,/role="alert">未确认的执行结果/);
 await h.poll();await h.poll();assert.equal(tries,1);assert.match(h.root.innerHTML,/未确认的执行结果/);
 await h.click('next',sid);await tick();const requests=count(h,'/next');assert.equal(requests.length,2);assert.equal(requests[0].input.requestId,requests[1].input.requestId);assert.doesNotMatch(h.root.innerHTML,/未确认的执行结果/);
});

test('lost create acknowledgement retains the manual retry ID without automatic creation or execution',async t=>{
 let tries=0;const h=harness(t,{request:async(path,options,defaults)=>{if(path==='group-device-ai'&&++tries===1)throw Error('创建结果未知');return defaults(path,options);}});await tick();prepare(h);
 await h.submit();await tick();await h.poll();assert.match(h.root.innerHTML,/创建结果未知/);assert.equal(tries,1);assert.equal(count(h,'/next').length,0);
 await h.submit();await tick();const requests=count(h,'group-device-ai');assert.equal(requests.length,2);assert.equal(requests[0].input.requestId,requests[1].input.requestId);assert.equal(count(h,'/next').length,0);
});

test('leaving during a pending round approval stops it again if the execution result arrives late',async t=>{
 const wait=deferred(),h=harness(t,{sessions:[session()],request:async(path,options,defaults)=>{if(path.endsWith('/next'))await wait.promise;return defaults(path,options);}});await tick();
 const pending=h.click('next',sid);h.emit('pagehide');const before=h.root.innerHTML;wait.resolve();await pending;await tick();
 assert.equal(count(h,'/next').length,1);assert.equal(count(h,'/stop').length,2);assert.equal(h.root.innerHTML,before);await h.poll();assert.equal(count(h,'/next').length,1);
});

test('lost stop acknowledgement cannot revive heartbeat or approval when the page quickly returns',async t=>{
 const h=harness(t,{sessions:[session({status:'running'})],request:async(path,options,defaults)=>{if(path.endsWith('/stop'))throw Error('stop offline');return defaults(path,options);}});await tick();
 const heartbeats=count(h,'/heartbeat').length;h.emit('visibilitychange',true);await tick();h.emit('visibilitychange',false);await tick();await h.poll();await h.click('next',sid);
 assert.match(h.root.innerHTML,/停止确认中/);assert.match(h.root.innerHTML,/尚未收到确认/);assert.equal(count(h,'/heartbeat').length,heartbeats);assert.equal(count(h,'/next').length,0);assert.equal(count(h,'/stop').length,1);
});

test('failed stop-all retains its action error and stops renewing a ready session',async t=>{
 const h=harness(t,{sessions:[session()],request:async(path,options,defaults)=>{if(path.endsWith('/stop'))throw Error('停止结果未确认');return defaults(path,options);}});await tick();
 const heartbeats=count(h,'/heartbeat').length;await h.click('stop-all');await tick();await h.poll();await h.click('next',sid);
 assert.match(h.root.innerHTML,/role="alert">停止结果未确认/);assert.match(h.root.innerHTML,/停止确认中/);assert.equal(count(h,'/heartbeat').length,heartbeats);assert.equal(count(h,'/next').length,0);assert.equal(count(h,'/stop').length,1);
});
const decisionTaskId='55555555-5555-4555-8555-555555555555',decisionId='66666666-6666-4666-8666-666666666666';
const waitingSession=extra=>session({deviceId:did,status:'awaiting-decision',decisions:[{taskId:decisionTaskId,provider:'ollama',alias:'方案顾问',canDecide:true,decision:{id:decisionId,version:1,status:'pending',digest:'fixture',expiresAt:Date.now()+1800000,available:true,continuationSupported:true,question:'要继续整理吗？',options:[{id:'option-1',label:'再修改'},{id:'option-2',label:'整理导出'}]}}],...extra});
test('leaving an untouched waiting decision preserves its thirty-minute multi-device choice without a heartbeat',async t=>{
 const h=harness(t,{sessions:[waitingSession()]});await tick();assert.match(h.root.innerHTML,/需要你拍板/);assert.equal(count(h,'/heartbeat').length,0);h.emit('pagehide');await tick();assert.equal(count(h,'/stop').length,0);assert.equal(count(h,'/decision').length,0);
});
test('an explicit stop includes waiting decisions while another member cannot choose them',async t=>{
 const other=waitingSession({id:otherSid,owner:false,decisions:[{provider:'ollama',alias:'顾问',canDecide:false,decision:waitingSession().decisions[0].decision}]});const h=harness(t,{sessions:[waitingSession(),other]});await tick();await h.choose('forged-task');assert.equal(count(h,'/decision').length,0);await h.click('stop-all');assert.deepEqual(count(h,'/stop').map(row=>row.path),['group-device-ai/'+sid+'/stop']);
});
test('leaving while a decision POST is unresolved stops the parent session and does not approve a new round',async t=>{
 const reply=deferred();let started;const began=new Promise(resolve=>started=resolve);
 const h=harness(t,{sessions:[waitingSession()],request:async(path,options,defaults)=>{if(path.endsWith('/decision')){started();return reply.promise;}return defaults(path,options);}});await tick();const pending=h.choose(decisionTaskId);await began;h.emit('pagehide');await tick();assert.equal(count(h,'/stop').length,1);
 reply.resolve({task:{id:'77777777-7777-4777-8777-777777777777',deviceId:did},decision:{...waitingSession().decisions[0].decision,status:'continued',continuationTaskId:'77777777-7777-4777-8777-777777777777'}});await pending;await tick();assert.equal(count(h,'/next').length,0);assert.ok(count(h,'/stop').length>=1);
});
for(const leave of ['unmount','pagehide','visibilitychange'])test('a restored unknown decision stops its group on '+leave+' without resubmitting authorization',async t=>{
 const d=waitingSession().decisions[0].decision,digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([d.digest,'option-2']))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const values=new Map([['ybz.ai-decision.request.v1.owner.'+decisionTaskId+'.'+decisionId,JSON.stringify({requestId:crypto.randomUUID(),digest})]]),storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const h=harness(t,{sessions:[waitingSession()],storage});for(let attempt=0;attempt<100&&!h.root.innerHTML.includes('上次选择结果尚未确认');attempt++)await tick();assert.match(h.root.innerHTML,/上次选择结果尚未确认/);assert.equal(count(h,'/decision').length,0);
 if(leave==='unmount')h.cleanup();else h.emit(leave,leave==='visibilitychange'?true:undefined);await tick();assert.deepEqual(count(h,'/stop').map(row=>row.path),['group-device-ai/'+sid+'/stop']);assert.equal(count(h,'/decision').length,0);assert.equal(count(h,'/next').length,0);
});
test('hiding while a choice digest is being prepared stops the group and never posts new authorization',async t=>{
 const h=harness(t,{sessions:[waitingSession()]});await tick();const pending=h.choose(decisionTaskId);h.emit('visibilitychange',true);await pending;await tick();assert.equal(count(h,'/decision').length,0);assert.ok(count(h,'/stop').length>=1);assert.equal(count(h,'/next').length,0);
});
