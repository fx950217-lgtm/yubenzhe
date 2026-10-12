import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const built=await build({entryPoints:[fileURLToPath(new URL('../src/workbench.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountWorkbench}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const drain=()=>new Promise(resolve=>setImmediate(resolve));
const base={id:'839ed19e-815d-4bc8-8b85-38938b1399cd',title:'整理文件',status:'awaiting-confirmation',version:1,step:0,billingUnit:'POINT',budgetPoints:'100',estimatedPoints:'30',reservedPoints:'100',spentPoints:'0',releasedPoints:'0',remainingPoints:'100',pointsPriceVersion:'locked-points-v1',workspaceId:'test-workspace',createdAt:1700000000000,quoteExpiresAt:1900000000000,budgetMicro:'100000',costMicro:'0',estimatedMicro:'30000',settledMicro:'0',releasedMicro:'0',userChargeMicro:'0',priceVersion:'locked-trial-v1',outputs:[],approvals:[],events:[],plan:{steps:[],artifacts:[],estimatedPointsRange:{min:'21',max:'39'},estimatedRange:{minMicro:'21000',maxMicro:'39000',currency:'USD'},estimatedSeconds:5}};
async function harness(t,task){
 const timers={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 globalThis.setInterval=()=>1;globalThis.clearInterval=()=>{};
 const listeners=new Map(),calls=[];
 const root={innerHTML:'',contains:()=>true,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const client={getProfile:()=>({userId:'cost-reader'}),authenticatedRequest:async(path,options)=>{
  calls.push({path,options});
  if(path==='workbench/capabilities')return {enabled:true,priceVersion:'new-current-rate',marginBasisPoints:9000};
  if(path==='workbench/tasks')return {tasks:[task]};
  if(path==='workbench/files')return {files:[]};
  if(path==='workbench/tasks/'+task.id)return {task};
  throw Error('Unexpected request '+path);
 }};
 const cleanup=mountWorkbench(root,{client});
 t.after(()=>{cleanup();Object.assign(globalThis,timers);});
 const click=async(action,extra={})=>{const target={dataset:{action,...extra}};await listeners.get('click')({target:{closest:()=>target}});};
 await drain();await click('open',{id:task.id});
 return {root,calls,click,async clickThroughApp(action,extra={}){
  let stopped=false,walletRefreshes=0;
  const target={dataset:{action,...extra}};
  const pending=listeners.get('click')({target:{closest:()=>target},stopPropagation(){stopped=true;}});
  // Browser propagation continues synchronously while an async handler awaits.
  // The app root has its own refresh action for the unrelated chain wallet.
  if(!stopped&&target.dataset.action==='refresh')walletRefreshes++;
  await pending;return {stopped,walletRefreshes};
 }};
}


test('task refresh stops propagation before awaiting so the app wallet refresh never runs',async t=>{
 const h=await harness(t,{...base,status:'running'}),before=h.calls.length;const event=await h.clickThroughApp('refresh');assert.equal(event.stopped,true);assert.equal(event.walletRefreshes,0);assert.deepEqual(h.calls.slice(before).map(call=>call.path),['workbench/capabilities','workbench/tasks/'+base.id]);assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);assert.match(h.root.innerHTML,/刷新进度/);
});
test('confirmation presents execution scope and estimated duration without authorizing automatically',async t=>{
 const h=await harness(t,{...base,pointsPriceVersion:'locked-<b>v1</b>'});assert.match(h.root.innerHTML,/确认执行范围/);assert.match(h.root.innerHTML,/预计用时：约 5 秒/);assert.match(h.root.innerHTML,/确认计划，开始执行/);assert.doesNotMatch(h.root.innerHTML,/POINT|积分|预算|费率|locked-|new-current-rate/);assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
});
test('unavailable duration stays unavailable rather than inventing a time promise',async t=>{
 const h=await harness(t,{...base,plan:{steps:[],estimatedSeconds:0}});assert.match(h.root.innerHTML,/预计用时：未提供/);assert.doesNotMatch(h.root.innerHTML,/约 0 秒|POINT|预算/);
});
test('running progress ignores obsolete metering fields and preserves control actions',async t=>{
 const h=await harness(t,{...base,status:'running',costMicro:'7001',spentPoints:'7'});assert.match(h.root.innerHTML,/正在做什么/);assert.match(h.root.innerHTML,/暂停任务/);assert.doesNotMatch(h.root.innerHTML,/data-task-cost|POINT|积分|账单|预算|0.007001/);
});
test('results show only actual execution steps without converting planned steps to activity',async t=>{
 const h=await harness(t,{...base,status:'cancelled',events:[{event:'planned',payload:{steps:[{},{},{}]}},{event:'step-completed',createdAt:1700000000100,payload:{step:1}},{event:'step-completed',createdAt:1700000000200,payload:{step:2}}]});await h.click('task-tab',{tab:'outputs'});assert.match(h.root.innerHTML,/处理步骤 1/);assert.match(h.root.innerHTML,/处理步骤 2/);assert.doesNotMatch(h.root.innerHTML,/处理步骤 3|POINT|积分|账单|预算|单步费用/);
});
test('malformed step metadata is not rendered as markup or an invented timestamp',async t=>{
 const h=await harness(t,{...base,status:'failed',events:[{event:'step-completed',createdAt:'<script>bad</script>',payload:{step:'<img src=x>'}}]});await h.click('task-tab',{tab:'outputs'});assert.match(h.root.innerHTML,/处理步骤（序号未提供）/);assert.match(h.root.innerHTML,/时间未提供/);assert.doesNotMatch(h.root.innerHTML,/<script>|<img src=x>|Invalid Date/);
});
test('an empty execution log never becomes fabricated step rows',async t=>{
 const h=await harness(t,{...base,status:'succeeded',step:3,events:[]});await h.click('task-tab',{tab:'outputs'});assert.match(h.root.innerHTML,/暂无已记录的处理步骤/);assert.doesNotMatch(h.root.innerHTML,/处理步骤 1|处理步骤 2|处理步骤 3/);
});
test('legacy fee payloads remain inert while their real step numbers stay readable',async t=>{
 const h=await harness(t,{...base,status:'failed',events:[{event:'step-completed',createdAt:1700000000100,payload:{step:1,points:'10'}},{event:'step-completed',createdAt:1700000000200,payload:{step:2,points:'<script>20</script>'}}]});await h.click('task-tab',{tab:'outputs'});assert.match(h.root.innerHTML,/处理步骤 1/);assert.match(h.root.innerHTML,/处理步骤 2/);assert.doesNotMatch(h.root.innerHTML,/<script>|POINT|积分|退回|预算/);
});
