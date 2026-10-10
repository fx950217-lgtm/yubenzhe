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
 const h=await harness(t,{...base,status:'running'}),before=h.calls.length;
 const event=await h.clickThroughApp('refresh');
 assert.equal(event.stopped,true);
 assert.equal(event.walletRefreshes,0);
 assert.deepEqual(h.calls.slice(before).map(call=>call.path),['workbench/capabilities','workbench/tasks/'+base.id]);
 assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
 assert.match(h.root.innerHTML,/data-task-cost/);
});

test('confirmation displays returned range, duration and locked price version without authorizing execution',async t=>{
 const h=await harness(t,{...base,pointsPriceVersion:'locked-<b>v1</b>'});
 assert.match(h.root.innerHTML,/预计积分区间/);
 assert.match(h.root.innerHTML,/21 POINT–39 POINT/);
 assert.match(h.root.innerHTML,/预计用时：约 5 秒/);
 assert.match(h.root.innerHTML,/费率版本：locked-&lt;b&gt;v1&lt;\/b&gt;/);
 assert.doesNotMatch(h.root.innerHTML,/new-current-rate|<b>v1<\/b>/);
 assert.equal(h.calls.some(call=>call.options?.method==='POST'),false);
});

test('unavailable quote fields stay unavailable instead of inventing a range, duration or zero charge',async t=>{
 const h=await harness(t,{...base,pointsPriceVersion:undefined,plan:{steps:[],estimatedPointsRange:{min:'50',max:'10'},estimatedSeconds:0}});
 assert.match(h.root.innerHTML,/区间未提供（参考估算 30 POINT）/);
 assert.match(h.root.innerHTML,/预计用时：未提供/);
 assert.match(h.root.innerHTML,/费率版本：未提供/);

 assert.doesNotMatch(h.root.innerHTML,/约 0 秒|\$0\.05–\$0\.01/);
});

test('running progress preserves sub-cent recorded cost and does not use current provider pricing to invent remaining budget',async t=>{
 const h=await harness(t,{...base,status:'running',costMicro:'7001',spentPoints:'7',reservedPoints:'93',remainingPoints:'93'});
 const panel=h.root.innerHTML.match(/<section[^>]*data-task-cost>[\s\S]*?<\/section>/)?.[0];
 assert.ok(panel);
 assert.match(panel,/已使用积分<\/span><strong>7 POINT/);
 assert.match(panel,/最高积分预算<\/span><strong>100 POINT/);
 assert.match(panel,/剩余预算<\/span><strong>93 POINT/);
 assert.match(panel,/当前预留<\/span><strong>93 POINT/);
 assert.doesNotMatch(panel,/0\.092999|0\.03|0\.07/);
});

test('bill uses actual recorded totals and step events without inventing a per-step fee or counting planned steps',async t=>{
 const h=await harness(t,{...base,billingUnit:'LEGACY_TRIAL',status:'cancelled',costMicro:'14000',settledMicro:'20000',releasedMicro:'80000',events:[
  {event:'planned',createdAt:1700000000000,payload:{steps:[{}, {}, {}]}},
  {event:'step-completed',createdAt:1700000000100,payload:{step:1,eventKey:'plan-1-local-step-0'}},
  {event:'step-completed',createdAt:1700000000200,payload:{step:2,eventKey:'plan-1-local-step-1'}},
  {event:'cancelled',createdAt:1700000000300,payload:{settledMicro:'20000'}}
 ]});
 await h.click('task-tab',{tab:'outputs'});
 assert.match(h.root.innerHTML,/已记录模拟成本<\/span><strong>\$0\.014/);
 assert.match(h.root.innerHTML,/已结算<\/span><strong>\$0\.02/);
 assert.match(h.root.innerHTML,/未使用已释放<\/span><strong>\$0\.08/);
 const panel=h.root.innerHTML.match(/<section[^>]*data-task-usage>[\s\S]*?<\/section>/)?.[0];
 assert.ok(panel);
 assert.equal((panel.match(/单步费用：未提供/g)||[]).length,2);
 assert.match(panel,/处理步骤 1/);assert.match(panel,/处理步骤 2/);
 assert.doesNotMatch(panel,/处理步骤 3|\$0\.007|\$0\.01/);
});

test('missing or malformed recorded costs and usage do not become zero or expose untrusted step fields',async t=>{
 const h=await harness(t,{...base,billingUnit:'LEGACY_TRIAL',status:'failed',costMicro:undefined,settledMicro:'invalid',releasedMicro:undefined,userChargeMicro:null,events:[{event:'step-completed',createdAt:'<script>bad</script>',payload:{step:'<img src=x>'}}]});
 await h.click('task-tab',{tab:'outputs'});
 assert.match(h.root.innerHTML,/已记录模拟成本<\/span><strong>未提供/);
 assert.match(h.root.innerHTML,/已结算<\/span><strong>未提供/);
 assert.match(h.root.innerHTML,/未使用已释放<\/span><strong>未提供/);
 assert.match(h.root.innerHTML,/处理步骤（序号未提供）/);
 assert.match(h.root.innerHTML,/时间未提供/);
 assert.doesNotMatch(h.root.innerHTML,/<script>|<img src=x>|\$0\.00/);
 assert.doesNotMatch(h.root.innerHTML.match(/<section[^>]*data-task-usage>[\s\S]*?<\/section>/)[0],/Invalid Date/);
});

test('an empty execution log is not converted into three simulated usage rows',async t=>{
 const h=await harness(t,{...base,status:'succeeded',step:3,events:[]});
 await h.click('task-tab',{tab:'outputs'});
 assert.match(h.root.innerHTML,/暂无已记录的处理步骤/);
 assert.doesNotMatch(h.root.innerHTML,/单步费用：未提供/);
});

test('POINT step usage displays only returned integer charges while keeping final refunds separate',async t=>{const h=await harness(t,{...base,status:'failed',spentPoints:'0',reservedPoints:'0',releasedPoints:'100',remainingPoints:'100',events:[{event:'step-completed',createdAt:1700000000100,payload:{step:1,points:'10'}},{event:'step-completed',createdAt:1700000000200,payload:{step:2,points:'<script>20</script>'}}]});await h.click('task-tab',{tab:'outputs'});assert.match(h.root.innerHTML,/单步积分：10 POINT/);assert.match(h.root.innerHTML,/单步积分：未提供/);assert.match(h.root.innerHTML,/已使用<\/span><strong>0 POINT/);assert.match(h.root.innerHTML,/未使用已退回<\/span><strong>100 POINT/);assert.match(h.root.innerHTML,/步骤用量不等于最终扣减/);assert.doesNotMatch(h.root.innerHTML,/<script>|\$0/);});
