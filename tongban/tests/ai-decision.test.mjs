import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/ai-decision.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});const {createDecisionController,decisionCard,actionableDecision}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const taskId='11111111-1111-4111-8111-111111111111',decisionId='22222222-2222-4222-8222-222222222222',child='33333333-3333-4333-8333-333333333333',deviceId='44444444-4444-4444-8444-444444444444';
const card=extra=>({id:decisionId,version:1,status:'pending',digest:'server-digest',expiresAt:Date.now()+1800000,available:true,continuationSupported:true,question:'PRIVATE_QUESTION <script>',options:[{id:'option-1',label:'PRIVATE_REVISE'},{id:'option-2',label:'PRIVATE_EXPORT'}],...extra});
const memory=()=>{const values=new Map();return {values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
function fixture({storage=memory(),request}={}){let owner='owner',active=true;const calls=[];const client={getProfile:()=>({userId:owner}),authenticatedRequest:async(path,options)=>{calls.push({path,...options});if(request)return request(path,options);return {task:{id:child,deviceId,status:'queued'},decision:card({status:'continued',continuationTaskId:child})};}};const ui=createDecisionController({client,owner,storage,isCurrent:()=>active});return {ui,calls,storage,client,owner:value=>owner=value,leave:()=>active=false,choose:(decision=card(),optionId='option-2',canDecide=true)=>ui.choose({taskId,decision,optionId,canDecide,deviceId})};}
test('decision rendering escapes private text and has one primary choice with explicit execution consent',()=>{
 const html=decisionCard({taskId,decision:card(),source:'<电脑>'});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<电脑>/);assert.equal((html.match(/class="ai-decision-primary"/g)||[]).length,1);assert.match(html,/选择即授权 AI 在原任务目录继续下一段工作/);assert.match(html,/继续执行/);
});
test('only explicit valid selection posts; reading a card never executes and stores no dialogue text',async()=>{
 const f=fixture(),d=card();await f.ui.observe(taskId,d);assert.equal(f.calls.length,0);await f.choose(d);assert.equal(f.calls.length,1);assert.deepEqual(Object.keys(f.calls[0].input).sort(),['approveExecution','decisionId','optionId','requestId','version']);assert.equal(f.calls[0].input.approveExecution,true);assert.equal(f.storage.values.size,0);
});
test('unknown result survives remount as requestId and digest only; another choice is blocked and same choice retries once',async()=>{
 const storage=memory(),f=fixture({storage,request:async()=>{throw Error('network outcome unknown');}}),d=card();await f.choose(d);
 const saved=JSON.parse([...storage.values.values()][0]);assert.deepEqual(Object.keys(saved).sort(),['digest','requestId']);assert.doesNotMatch(JSON.stringify([...storage.values]),/PRIVATE_|option-2/);
 const g=fixture({storage});await g.ui.observe(taskId,d);assert.equal(g.calls.length,0);assert.equal(g.ui.state(taskId,d).optionId,'option-2');await g.choose(d,'option-1');assert.equal(g.calls.length,0);await g.choose(d,'option-2');assert.equal(g.calls.length,1);assert.equal(g.calls[0].input.requestId,saved.requestId);
});
test('expired, suspended, unavailable and old-protocol cards never authorize work',async()=>{
 for(const patch of [{expiresAt:Date.now()-1},{status:'suspended'},{available:false},{continuationSupported:false},{continuationSupported:undefined}]){const f=fixture(),d=card(patch);assert.equal(actionableDecision(d),false);await f.choose(d);assert.equal(f.calls.length,0);}
 for(const patch of [{expiresAt:Date.now()-1},{status:'suspended'},{status:'continued'}])assert.doesNotMatch(decisionCard({taskId,decision:card(patch)}),/data-decision-action="choose"/);
 assert.match(decisionCard({taskId,decision:card({continuationSupported:false})}),/更新连接器并保持在线/);
});
test('group readers have no execution path and readonly cards do not fabricate a task identifier',async()=>{
 const f=fixture();await f.choose(card(),'option-2',false);assert.equal(f.calls.length,0);const html=decisionCard({decision:card(),canDecide:false});assert.match(html,/只有设备主人可以选择/);assert.doesNotMatch(html,new RegExp(taskId));assert.match(html,/disabled/);
});
test('failed local storage blocks authorization before any POST',async()=>{
 const f=fixture({storage:{getItem(){throw Error('denied');}}}),d=card();await f.choose(d);assert.equal(f.calls.length,0);assert.match(f.ui.state(taskId,d).error,/无法保存决策请求编号/);
});
test('double-click during pending submission cannot issue a second POST',async()=>{
 let finish,started;const began=new Promise(resolve=>started=resolve),f=fixture({request:async()=>{started();return new Promise(resolve=>finish=resolve);}}),d=card();const first=f.choose(d);await began;await f.choose(d);assert.equal(f.calls.length,1);finish({task:{id:child,deviceId},decision:card({status:'continued',continuationTaskId:child})});await first;
});
test('changing account or leaving during digest preparation cannot authorize through another session',async()=>{
 for(const exit of ['owner','leave']){const f=fixture(),pending=f.choose();if(exit==='owner')f.owner('other');else f.leave();await pending;assert.equal(f.calls.length,0);}
});
test('malformed or cross-device continuation response keeps unknown metadata instead of reporting success',async()=>{
 const f=fixture({request:async()=>({task:{id:child,deviceId:taskId},decision:card({status:'continued',continuationTaskId:child})})}),d=card();assert.equal(await f.choose(d),null);assert.equal(f.storage.values.size,1);assert.match(f.ui.state(taskId,d).error,/尚未确认/);
});
test('a subsequent authoritative read clears the uncertain command without another POST',async()=>{
 const f=fixture({request:async()=>{throw Error('lost');}}),d=card();await f.choose(d);await f.ui.observe(taskId,{...d,version:2,status:'continued',continuationTaskId:child});assert.equal(f.calls.length,1);assert.equal(f.storage.values.size,0);assert.deepEqual(f.ui.state(taskId,d),{});
});
test('same-page unknown retries reject a replaced request ID and retain the original when storage is removed',async()=>{
 const f=fixture({request:async()=>{throw Error('lost');}}),d=card();await f.choose(d);const [[key,value]]=f.storage.values,saved=JSON.parse(value);
 f.storage.setItem(key,JSON.stringify({...saved,requestId:crypto.randomUUID()}));await f.choose(d);assert.equal(f.calls.length,1);assert.equal(f.ui.state(taskId,d).requestId,saved.requestId);assert.match(f.ui.state(taskId,d).error,/其他页面更改/);
 f.storage.removeItem(key);await f.choose(d);assert.equal(f.calls.length,2);assert.equal(f.calls[1].input.requestId,saved.requestId);
});
test('restoring and retrying historical metadata never copies extra dialogue fields into state or storage',async()=>{
 const storage=memory(),first=fixture({storage,request:async()=>{throw Error('lost');}}),d=card();await first.choose(d);const [[key,value]]=storage.values;storage.setItem(key,JSON.stringify({...JSON.parse(value),question:'OLD_PRIVATE_QUESTION',options:['OLD_PRIVATE_CHOICE']}));
 const second=fixture({storage,request:async()=>{throw Error('still lost');}});await second.ui.observe(taskId,d);assert.equal('question' in second.ui.state(taskId,d),false);assert.equal('options' in second.ui.state(taskId,d),false);await second.choose(d);assert.deepEqual(Object.keys(JSON.parse(storage.getItem(key))).sort(),['digest','requestId']);assert.doesNotMatch(storage.getItem(key),/OLD_PRIVATE/);
});
