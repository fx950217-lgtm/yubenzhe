import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/group-workflows.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountGroupWorkflows,canSignGroupPayment,groupPaymentAmount,assertGroupPaymentRegistered,groupWorkflowError,groupWorkflowTime}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const from='0x1111111111111111111111111111111111111111',to='0x2222222222222222222222222222222222222222',hash='0x'+'3'.repeat(64);
const payment=()=>({id:'intent-1',chainId:97,from,to,valueWei:'1000000000000000',data:'0x',state:'awaiting-signature'});
const baseWorkflow=extra=>({id:'workflow-1',conversationId:'group-1',ownerId:'owner',isOwner:true,status:'proposal-ready',version:3,goal:'整理会议文字',proposal:{status:'ready',output:'核对目标，然后去重',digest:'proposal-digest'},execution:{plan:{summary:'固定规则执行',steps:[{title:'去重'}]}},artifacts:[],artifactDigest:'artifacts-digest',events:[],...extra});
function harness(t,{initialWorkflow,request,wallet:walletExtra={},storage:existingStorage,...options}={}){
 let profile={userId:'owner'},serverWorkflow=initialWorkflow;const handlers=new Map(),calls=[],records=[],saved=[];const map=new Map();const storage=existingStorage||{getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
 const root={innerHTML:'',contains:()=>true,addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:name=>handlers.delete(name)};
 const fallback=async(path,options)=>{if(options?.method==='POST')return {workflow:serverWorkflow};if(path==='group-workflows/capabilities')return {ai:{configured:true},payment:{configured:true}};if(path==='workbench/files')return {files:[{id:'file-1',name:'会议.txt',size:15}]};if(path.startsWith('group-workflows?')||path==='group-workflows')return {workflows:serverWorkflow?[serverWorkflow]:[]};if(path==='group-workflows/workflow-1')return {workflow:serverWorkflow};throw Error('Unexpected path '+path);};
 const client={getProfile:()=>profile,getState:async()=>({conversations:[{id:'group-1',name:'测试群',type:'group'}]}),getMessages:async()=>({messages:[{id:'1',type:'text',text:'只选择这条'},{id:'2',type:'text',text:'另一条不发送'}]}),authenticatedRequest:async(path,options)=>{calls.push({path,options});return request?request(path,options,fallback):fallback(path,options);}};
 const wallet={getWalletState:()=>({exists:true,unlocked:true,address:from}),getRecords:()=>records,prepareTransfer:async()=>({id:'preview-1',intentId:'intent-1',gasFee:'0.00001'}),confirmTransfer:async(id,password,{beforeBroadcast})=>{records.push({intentId:'intent-1',hash});await beforeBroadcast({hash,intentId:'intent-1'});return {hash};},...walletExtra};
 const oldFormData=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
 const cleanup=mountGroupWorkflows(root,{client,wallet,storage,conversationId:'group-1',initialWorkflowId:initialWorkflow?'workflow-1':null,saveFile:async file=>{saved.push(file);return {saved:true};},pollMs:60000,...options});
 t.after(()=>{cleanup();globalThis.FormData=oldFormData;});
 return {root,calls,records,saved,cleanup,storage,setWorkflow:w=>{serverWorkflow=w;},account:p=>{profile=p;},input:(name,value,checked=false)=>handlers.get('input')({target:{name,value,checked}}),click:async(action,id)=>handlers.get('click')({target:{closest:()=>({dataset:{gw:action,id}})}}),submit:async(kind,values={})=>{const form={dataset:{gwForm:kind},values,closest(){return this;},reset(){}};return handlers.get('submit')({target:form,preventDefault(){}});}};
}
test('creation submits only explicitly selected group context and never silently starts execution',async t=>{
 const h=harness(t,{request:async(path,options,fallback)=>options?.method==='POST'?{workflow:baseWorkflow({status:'planning'})}:fallback(path,options)});await tick();await tick();
 h.input('goal','整理会议');await h.submit('create');assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);
 h.input('sourceMessageId','1',true);h.input('fileId','file-1',true);h.input('consent','',true);await h.submit('create');
 const writes=h.calls.filter(c=>c.options?.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].path,'group-workflows');assert.deepEqual(writes[0].options.input.sourceMessageIds,['1']);assert.deepEqual(writes[0].options.input.fileIds,['file-1']);assert.equal(writes[0].options.input.conversationId,'group-1');assert.match(writes[0].options.input.requestId,/^[a-f0-9-]{36}$/);assert.equal(writes.some(c=>c.path.endsWith('/approve')),false);
});
test('a lost creation response reuses its durable request ID on retry and across remount',async t=>{
 let attempts=0;const ids=[];const request=async(path,options,fallback)=>{if(options?.method==='POST'){ids.push(options.input.requestId);if(++attempts<3)throw Error('NETWORK_ERROR');return {workflow:baseWorkflow({status:'planning'})};}return fallback(path,options);};
 const h=harness(t,{request});await tick();await tick();h.input('goal','same goal');h.input('consent','',true);await h.submit('create');await h.submit('create');h.cleanup();
 const again=harness(t,{request,storage:h.storage});await tick();await tick();again.input('goal','same goal');again.input('consent','',true);await again.submit('create');assert.equal(new Set(ids).size,1);
});
test('approval binds the exact reviewed proposal/version and keeps signing separate',async t=>{
 const h=harness(t,{initialWorkflow:baseWorkflow(),request:async(path,options,fallback)=>options?.method==='POST'?{workflow:baseWorkflow({status:'executing',version:4})}:fallback(path,options)});await tick();await tick();await h.submit('approve',{budget:'80'});
 const write=h.calls.find(c=>c.options?.method==='POST');assert.equal(write.path,'group-workflows/workflow-1/approve');assert.equal(write.options.input.version,3);assert.equal(write.options.input.proposalDigest,'proposal-digest');assert.equal(write.options.input.budgetPoints,'80');assert.equal(write.options.input.acceptPoints,true);assert.equal(h.records.length,0);
});
test('group readers get escaped proposal/artifacts without approval or payment controls',async t=>{
 const h=harness(t,{initialWorkflow:baseWorkflow({isOwner:false,goal:'<img src=x onerror=evil>',proposal:{output:'<script>secret()</script>',digest:'x'},artifacts:[{id:'out',name:'<img>',size:12,sha256:'hash'}]})});await tick();await tick();assert.match(h.root.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(h.root.innerHTML,/<script>|data-gw-form="approve"|data-gw-form="payment"|data-gw="accept"/);await h.submit('approve',{budget:'1'});assert.equal(h.calls.some(c=>c.options?.method==='POST'),false);
});
test('acceptance binds artifact digest and never opens an implicit payment',async t=>{
 const h=harness(t,{initialWorkflow:baseWorkflow({status:'awaiting-acceptance',artifacts:[{id:'out',name:'成果.txt',size:12,sha256:'a'}]}),request:async(path,options,fallback)=>options?.method==='POST'?{workflow:baseWorkflow({status:'accepted'})}:fallback(path,options)});await tick();await tick();await h.click('accept');const writes=h.calls.filter(c=>c.options?.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].options.input.artifactDigest,'artifacts-digest');assert.match(h.root.innerHTML,/data-gw-form="payment"/);assert.equal(h.records.length,0);
});
test('unknown or already signed payment renders verify only and cannot sign again',async t=>{
 for(const status of ['payment-unknown','payment-pending','payment-mismatch','payment-failed']){
 const h=harness(t,{initialWorkflow:baseWorkflow({status,payment:{...payment(),txHash:hash,state:'unknown'}})});await tick();await tick();assert.match(h.root.innerHTML,/data-gw="verify"/);assert.doesNotMatch(h.root.innerHTML,/data-gw-form="sign"|data-gw="prepare"/);await h.submit('sign',{password:'local-only'});assert.equal(h.records.length,0);h.cleanup();}
 const local=harness(t,{initialWorkflow:baseWorkflow({status:'awaiting-signature',payment:payment()}),wallet:{getRecords:()=>[{intentId:'intent-1',hash}]}});await tick();await tick();assert.match(local.root.innerHTML,/data-gw="verify"/);assert.doesNotMatch(local.root.innerHTML,/data-gw="prepare"/);
});
test('signing binds the hash before broadcast and never sends wallet password to the API',async t=>{
 const order=[];const w=baseWorkflow({status:'awaiting-signature',payment:payment()});const h=harness(t,{initialWorkflow:w,request:async(path,options,fallback)=>{if(options?.method==='POST'){order.push(path.split('/').at(-1));return {workflow:{...w,status:path.endsWith('/verify')?'paid':'payment-pending',payment:{...payment(),txHash:hash,state:'pending'}}};}return fallback(path,options);},wallet:{confirmTransfer:async(id,password,{beforeBroadcast})=>{assert.equal(password,'secret-local-password');order.push('signed-locally');await beforeBroadcast({hash});order.push('broadcast');return {hash};}}});await tick();await tick();await h.click('prepare');assert.match(h.root.innerHTML,/预估手续费 0.00001/);await h.submit('sign',{password:'secret-local-password'});assert.deepEqual(order,['signed-locally','signed','broadcast','verify']);assert.equal(JSON.stringify(h.calls).includes('secret-local-password'),false);assert.match(h.root.innerHTML,/回执已核验并回群/);
});
test('failed hash registration blocks a second signature and offers recovery verification',async t=>{
 const w=baseWorkflow({status:'awaiting-signature',payment:payment()});let signed=0;const records=[];const h=harness(t,{initialWorkflow:w,request:async(path,options,fallback)=>{if(options?.method==='POST')throw Error('登记响应丢失');return fallback(path,options);},wallet:{getRecords:()=>records,confirmTransfer:async(id,password,{beforeBroadcast})=>{signed++;records.push({intentId:'intent-1',hash});await beforeBroadcast({hash});throw Error('must not broadcast');}}});await tick();await tick();await h.click('prepare');await h.submit('sign',{password:'test-password'});assert.equal(signed,1);assert.match(h.root.innerHTML,/data-gw="verify"/);assert.doesNotMatch(h.root.innerHTML,/data-gw-form="sign"|data-gw="prepare"/);await h.submit('sign',{password:'test-password'});assert.equal(signed,1);
});
test('each completed verification permits a fresh chain read, while an interrupted retry keeps its ID',async t=>{
 const ids=[];let attempts=0;const w=baseWorkflow({status:'payment-unknown',payment:{...payment(),txHash:hash,state:'unknown'}});const h=harness(t,{initialWorkflow:w,request:async(path,options,fallback)=>{if(path.endsWith('/verify')){ids.push(options.input.requestId);if(++attempts===1)throw Error('network interrupted');return {workflow:{...w,status:attempts>2?'paid':'payment-pending'}};}return fallback(path,options);}});await tick();await tick();await h.click('verify');await h.click('verify');await h.click('verify');assert.equal(ids[0],ids[1]);assert.notEqual(ids[1],ids[2]);assert.match(h.root.innerHTML,/重新核验回执/);await h.click('verify');assert.notEqual(ids[2],ids[3]);
});
test('membership revocation removes previously displayed task data',async t=>{
 let revoked=false;const h=harness(t,{initialWorkflow:baseWorkflow(),request:async(path,options,fallback)=>{if(revoked)throw Object.assign(Error('不再是群成员'),{status:403});return fallback(path,options);}});await tick();await tick();revoked=true;await h.click('refresh');assert.match(h.root.innerHTML,/不再是群成员/);
 assert.doesNotMatch(h.root.innerHTML,/核对目标，然后去重|data-gw-form="approve"/);
 assert.equal(h.calls.some(c=>c.options?.method==='POST'),false);
});
test('late account responses cannot render previous group contents',async t=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=harness(t,{initialWorkflow:baseWorkflow(),request:async()=>pending});const before=h.root.innerHTML;h.account({userId:'another'});resolve({workflow:baseWorkflow({goal:'private old account content'})});await tick();assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/private old account content/);
});
test('testnet amounts retain exact integer precision and reject misleading formats',()=>{
 assert.equal(groupPaymentAmount('0.000000000000000001'),'1');for(const invalid of ['0','-1','1e2','NaN','0.0000000000000000001'])assert.throws(()=>groupPaymentAmount(invalid));assert.equal(canSignGroupPayment(baseWorkflow({status:'awaiting-signature',payment:payment()})),true);assert.equal(canSignGroupPayment(baseWorkflow({status:'awaiting-signature',payment:{...payment(),txHash:hash}})),false);
});
test('cancellation requires a separate explicit confirmation and signed tasks cannot cancel',async t=>{
 const h=harness(t,{initialWorkflow:baseWorkflow(),request:async(path,options,fallback)=>options?.method==='POST'?{workflow:baseWorkflow({status:'cancelled'})}:fallback(path,options)});await tick();await tick();await h.click('cancel-confirm');assert.equal(h.calls.some(c=>c.options?.method==='POST'),false);await h.click('cancel-request');assert.match(h.root.innerHTML,/确认停止这个尚未付款的任务/);await h.click('cancel-confirm');assert.equal(h.calls.find(c=>c.options?.method==='POST').path,'group-workflows/workflow-1/cancel');assert.match(h.root.innerHTML,/任务已取消/);
 const signed=harness(t,{initialWorkflow:baseWorkflow({status:'payment-unknown',payment:{...payment(),txHash:hash}})});await tick();await tick();assert.doesNotMatch(signed.root.innerHTML,/data-gw="cancel-request"/);await signed.click('cancel-request');await signed.click('cancel-confirm');assert.equal(signed.calls.some(c=>c.options?.method==='POST'),false);
});
test('missing or future payment states fail closed even if a stale workflow says awaiting signature',()=>{
 for(const state of [undefined,null,'new-provider-state','unknown','confirmed'])assert.equal(canSignGroupPayment(baseWorkflow({status:'awaiting-signature',payment:{...payment(),state}})),false);
});
test('broadcast acknowledgement must bind every immutable payment field and the signed hash',()=>{
 const intent=payment(),value={workflow:{id:'workflow-1',payment:{...intent,txHash:hash}}};assert.doesNotThrow(()=>assertGroupPaymentRegistered(value,'workflow-1',intent,hash));
 for(const [key,replacement] of Object.entries({id:'another-intent',chainId:56,from:to,to:from,valueWei:'1',data:'0xab',txHash:'0x'+'4'.repeat(64)}))assert.throws(()=>assertGroupPaymentRegistered({workflow:{id:'workflow-1',payment:{...value.workflow.payment,[key]:replacement}}},'workflow-1',intent,hash),/停止广播/);
 assert.throws(()=>assertGroupPaymentRegistered({workflow:{...value.workflow,id:'another-task'}},'workflow-1',intent,hash),/停止广播/);
});
test('blocked configuration and event history explain actual progress in plain language',async t=>{
 const h=harness(t,{initialWorkflow:baseWorkflow({status:'blocked',proposal:{error:'AI_NOT_CONFIGURED'},events:[{id:'event',type:'created',createdAt:1791767061655},{id:'blocked',type:'blocked',createdAt:1791767061656}]})});await tick();await tick();assert.match(h.root.innerHTML,/模型尚未配置，未生成 AI 方案/);assert.match(h.root.innerHTML,/已发起群任务/);assert.doesNotMatch(h.root.innerHTML,/AI_NOT_CONFIGURED|1791767061655|>created ·/);assert.equal(groupWorkflowTime('invalid'),'时间待核实');assert.doesNotMatch(groupWorkflowError('NEW_INTERNAL_ERROR'),/NEW_INTERNAL_ERROR/);
});
