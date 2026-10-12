import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createGroupWorkflows} from '../server/group-workflows.mjs';

const from='0x1111111111111111111111111111111111111111',to='0x2222222222222222222222222222222222222222';
const txHash='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
const error=code=>e=>e.code===code;
async function fixture(t,{configured=true,proposalStatus='succeeded',rpcConfigured=true}={}){
 let time=Date.UTC(2026,9,12),receipt={state:'pending',confirmations:1,hash:txHash},starts=0;
 const prompts=[],database=openSocialDatabase(':memory:'),modelTasks=new Map();
 const proposalService={capabilities:()=>({configured}),async start(args){args.assertAuthorized();starts++;prompts.push(args.prompt);const id='fixture-'+args.scopeId;modelTasks.set(id,{status:proposalStatus,output:'先整理已选资料，生成可下载文件，再由发起者检查内容。'});return {id};},async read(args){args.assertAuthorized();return modelTasks.get(args.id);}};
 const verifier={configured:rpcConfigured,async verify(intent,hash){assert.equal(hash,txHash);assert.equal(intent.chainId,97);assert.ok(intent.data.startsWith('0x'));return receipt;}};
 const modules=createProductModules({database,origin:'http://localhost:18999',simulation:true,now:()=>time,proposalService,paymentVerifier:verifier});
 t.after(()=>database.close());
 const call=(user,method,path,input={},query={})=>modules.handle({token:user?.token||'',method,path,input,query,ip:randomUUID()});
 const register=()=>call(null,'POST','register',{password:'492718',requestId:randomUUID()});
 const a=await register(),b=await register();
 const friend=async(left,right)=>{const r=await call(left,'POST','friends/request',{userId:right.profile.userId});await call(right,'POST','friends/respond',{requestId:r.requestId,accept:true});};
 await friend(a,b);
 const {conversationId}=await call(a,'POST','groups',{name:'真实双账号群',memberIds:[b.profile.userId],requestId:randomUUID()});
 const get=(id,user=a)=>call(user,'GET','group-workflows/'+id).then(r=>r.workflow);
 const post=(id,action,input,user=a)=>call(user,'POST','group-workflows/'+id+'/'+action,{requestId:randomUUID(),...input}).then(r=>r.workflow);
 const create=(extra={},user=a)=>call(user,'POST','group-workflows',{requestId:randomUUID(),conversationId,goal:'列工作清单，包括页面检查、用户反馈和成果验收',...extra}).then(r=>r.workflow);
 const approval=(w,extra={})=>({version:w.version,proposalDigest:w.proposal.digest,acceptPoints:true,budgetPoints:'100',...extra});
 const approve=(w,extra={})=>post(w.id,'approve',approval(w,extra));
 const run=async(w)=>{w=await approve(w);for(let n=0;n<4;n++){time+=1000;await modules.tick();}return get(w.id);};
 const accept=w=>post(w.id,'accept',{version:w.version,artifactDigest:w.artifactDigest});
 const pay=w=>post(w.id,'payment',{version:w.version,from,to,valueWei:'1000000000000'});
 const paymentReady=async()=>pay(await accept(await run(await create())));
 return {database,modules,proposalService,verifier,modelTasks,prompts,a,b,conversationId,call,register,friend,get,post,create,approval,approve,run,accept,pay,paymentReady,starts:()=>starts,setReceipt(value){receipt=value;},advance(ms){time+=ms;}};
}

test('two independent product accounts create a real group and complete proposal, approval, file execution and acceptance',async t=>{
 const f=await fixture(t);assert.equal(f.database.raw.prepare('SELECT count(*) n FROM conversation_members WHERE conversation_id=?').get(f.conversationId).n,2);
 let w=await f.create();assert.equal(w.status,'proposal-ready');assert.match(w.proposal.digest,/^[a-f0-9]{64}$/);assert.equal(w.execution.plan.planner,'local-rules');
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM workbench_tasks').get().n,0);
 w=await f.run(w);assert.equal(w.status,'awaiting-acceptance');assert.equal(w.artifacts.length,2);
 const data=await f.call(f.b,'GET','group-workflows/'+w.id+'/files/'+w.artifacts.find(x=>x.name.endsWith('.md')).id);
 assert.match(data.binary.toString(),/- \[ \] 页面检查/);assert.match(data.binary.toString(),/- \[ \] 用户反馈/);
 w=await f.accept(w);assert.equal(w.status,'accepted');assert.equal(w.payment,null);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM workbench_usage').get().n,3);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM workbench_invoices').get().n,1);
 assert.equal(f.database.raw.prepare('SELECT spent_points FROM workbench_tasks WHERE id=?').get(w.execution.taskId).spent_points,'30');
});

test('create retries share one workflow, one model call and one initial group event; changed request conflicts',async t=>{
 const f=await fixture(t),requestId=randomUUID();const [a,b]=await Promise.all([f.create({requestId}),f.create({requestId})]);assert.equal(a.id,b.id);assert.equal(f.starts(),1);
 assert.equal(f.database.raw.prepare("SELECT count(*) n FROM group_workflow_events WHERE event_type='created'").get().n,1);
 await assert.rejects(f.create({requestId,goal:'列清单，包括不同目标'}),error('IDEMPOTENCY_CONFLICT'));
});

test('only explicitly selected visible group message excerpts reach the proposal model',async t=>{
 const f=await fixture(t);const selected=(await f.call(f.b,'POST','conversations/'+f.conversationId+'/messages',{type:'text',text:'SELECTED-MESSAGE',clientId:randomUUID()})).message;
 await f.call(f.b,'POST','conversations/'+f.conversationId+'/messages',{type:'text',text:'UNSELECTED-PRIVATE-MESSAGE',clientId:randomUUID()});
 const w=await f.create({sourceMessageIds:[selected.id]});assert.match(f.prompts[0],/SELECTED-MESSAGE/);assert.doesNotMatch(f.prompts[0],/UNSELECTED-PRIVATE-MESSAGE/);assert.deepEqual(w.sourceMessageIds,[selected.id]);
 const dm=(await f.call(f.a,'GET','state')).conversations.find(c=>c.type==='direct');const hidden=(await f.call(f.a,'POST','conversations/'+dm.id+'/messages',{type:'text',text:'DIRECT-PRIVATE',clientId:randomUUID()})).message;
 await assert.rejects(f.create({sourceMessageIds:[hidden.id]}),error('SOURCE_MESSAGE_NOT_FOUND'));
});

test('missing model or unsupported external execution stays explicitly blocked with no fake task or charge',async t=>{
 const f=await fixture(t,{configured:false});let w=await f.create();assert.equal(w.status,'blocked');assert.equal(w.error,'AI_NOT_CONFIGURED');assert.equal(w.proposal.output,'');assert.equal(f.starts(),0);
 await assert.rejects(f.approve(w),error('PROPOSAL_CHANGED'));
 w=await f.create({goal:'运行电脑脚本并购买商品'});assert.equal(w.status,'blocked');assert.equal(w.error,'EXECUTOR_SCOPE_UNSUPPORTED');assert.equal(f.starts(),0);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM workbench_tasks').get().n,0);
});

test('blocked creation has a per-owner rate limit too and stable retry does not consume the limit',async t=>{
 const f=await fixture(t,{configured:false}),id=randomUUID();const w=await f.create({requestId:id});
 for(let i=1;i<20;i++)await f.create();await assert.rejects(f.create(),error('WORKFLOW_RATE_LIMIT'));
 assert.equal((await f.create({requestId:id})).id,w.id);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM group_workflows').get().n,20);
});

test('membership, author, version, digest and points consent are independent approval boundaries',async t=>{
 const f=await fixture(t),w=await f.create(),stranger=await f.register();
 await assert.rejects(f.get(w.id,stranger),error('GROUP_NOT_FOUND'));
 await assert.rejects(f.post(w.id,'approve',f.approval(w),f.b),error('WORKFLOW_OWNER_REQUIRED'));
 await assert.rejects(f.approve(w,{version:w.version-1}),error('WORKFLOW_CHANGED'));
 await assert.rejects(f.approve(w,{proposalDigest:'0'.repeat(64)}),error('PROPOSAL_CHANGED'));
 await assert.rejects(f.approve(w,{acceptPoints:false}),error('POINTS_APPROVAL_REQUIRED'));
 await assert.rejects(f.post(w.id,'payment',{version:w.version,from,to,valueWei:'1'}),error('PAYMENT_STATE'));
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM workbench_tasks').get().n,0);
});

test('concurrent approval and simulated post-confirm restart never create a second task or reserve twice',async t=>{
 const f=await fixture(t),w=await f.create(),requestId=randomUUID(),input=f.approval(w,{requestId});
 const [a,b]=await Promise.all([f.post(w.id,'approve',input),f.post(w.id,'approve',input)]);assert.equal(a.execution.taskId,b.execution.taskId);
 f.database.raw.prepare("UPDATE group_workflows SET status='approving' WHERE id=?").run(w.id);f.database.raw.prepare('UPDATE group_workflow_commands SET response_json=NULL WHERE request_id=?').run(requestId);
 const resumed=await f.post(w.id,'approve',input);assert.equal(resumed.execution.taskId,a.execution.taskId);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM workbench_tasks').get().n,1);
 assert.equal(f.database.raw.prepare("SELECT count(*) n FROM workbench_commands WHERE signature<>''").get().n,2);
});

test('removed and rejoined members cannot recover old task snapshots or shared artifacts',async t=>{
 const f=await fixture(t),w=await f.run(await f.create());assert.equal((await f.get(w.id,f.b)).id,w.id);
 await f.call(f.a,'POST','conversations/'+f.conversationId+'/remove-member',{userId:f.b.profile.userId});
 await assert.rejects(f.get(w.id,f.b),error('GROUP_NOT_FOUND'));
 await f.call(f.a,'POST','conversations/'+f.conversationId+'/invite',{memberIds:[f.b.profile.userId]});
 await assert.rejects(f.get(w.id,f.b),error('WORKFLOW_NOT_FOUND'));
 await assert.rejects(f.call(f.b,'GET','group-workflows/'+w.id+'/files/'+w.artifacts[0].id),error('WORKFLOW_NOT_FOUND'));
 assert.equal((await f.call(f.b,'GET','group-workflows',{}, {conversationId:f.conversationId})).workflows.length,0);
});

test('existing file worker is reused for actual deduplication, while input files stay private',async t=>{
 const f=await fixture(t),file=(await f.call(f.a,'POST','workbench/files',{requestId:randomUUID(),name:'orders.txt',base64:Buffer.from('one\none\ntwo').toString('base64')})).file;
 const w=await f.run(await f.create({goal:'将附件按行去重',fileIds:[file.id]}));assert.equal(w.status,'awaiting-acceptance');
 const artifact=w.artifacts.find(x=>x.name!=='处理说明.txt'),data=await f.call(f.b,'GET','group-workflows/'+w.id+'/files/'+artifact.id);assert.equal(data.binary.toString(),'one\ntwo');
 await assert.rejects(f.call(f.b,'GET','group-workflows/'+w.id+'/files/'+file.id),error('FILE_NOT_FOUND'));
 await assert.rejects(f.call(f.b,'GET','workbench/files/'+artifact.id),error('FILE_NOT_FOUND'));
});

test('mutating the linked task through older workbench APIs invalidates the group approval',async t=>{
 const f=await fixture(t);let w=await f.approve(await f.create());const task=(await f.call(f.a,'GET','workbench/tasks/'+w.execution.taskId)).task;
 const paused=(await f.call(f.a,'POST','workbench/tasks/'+task.id+'/pause',{requestId:randomUUID(),version:task.version})).task;
 await f.call(f.a,'POST','workbench/tasks/'+task.id+'/instructions',{requestId:randomUUID(),version:paused.version,instruction:'增加不在原批准内的附件整理'});
 w=await f.get(w.id);assert.equal(w.status,'failed');assert.equal(w.error,'EXECUTION_SCOPE_CHANGED');
 await assert.rejects(f.accept(w),error('ARTIFACT_CHANGED'));
});

test('artifact bytes are verified at acceptance and accepted content remains immutable before payment',async t=>{
 const f=await fixture(t);let w=await f.run(await f.create());await assert.rejects(f.post(w.id,'accept',{version:w.version,artifactDigest:'0'.repeat(64)}),error('ARTIFACT_CHANGED'));
 f.database.raw.prepare('UPDATE workbench_files SET content=? WHERE id=?').run(Buffer.from('tampered'),w.artifacts[0].id);
 await assert.rejects(f.accept(w),error('ARTIFACT_UNAVAILABLE'));
 await assert.rejects(f.call(f.b,'GET','group-workflows/'+w.id+'/files/'+w.artifacts[0].id),error('FILE_NOT_FOUND'));
});

test('testnet payment is separate from acceptance and immutable after a single registered transaction hash',async t=>{
 const f=await fixture(t);let w=await f.paymentReady();assert.equal(w.status,'awaiting-signature');assert.equal(w.payment.chainId,97);assert.equal(w.payment.txHash,null);
 assert.ok(Buffer.from(w.payment.data.slice(2),'hex').toString().includes(w.payment.id));assert.ok(Buffer.from(w.payment.data.slice(2),'hex').toString().includes(w.artifactDigest));
 const intentId=w.payment.id;w=await f.post(w.id,'signed',{intentId,txHash});assert.equal(w.status,'payment-pending');
 await assert.rejects(f.post(w.id,'signed',{intentId,txHash:'0x'+'ef'.repeat(32)}),error('PAYMENT_LOCKED'));
 await assert.rejects(f.pay(w),error('PAYMENT_STATE'));
 await assert.rejects(f.post(w.id,'cancel',{version:w.version}),error('PAYMENT_LOCKED'));
 assert.equal((await f.post(w.id,'signed',{intentId,txHash})).payment.txHash,txHash);
});

test('one verification request observes pending, confirmation and reorg; confirmed events are emitted once',async t=>{
 const f=await fixture(t);let w=await f.paymentReady();w=await f.post(w.id,'signed',{intentId:w.payment.id,txHash});
 const input={requestId:randomUUID(),intentId:w.payment.id};w=await f.post(w.id,'verify',input);assert.equal(w.status,'payment-pending');
 f.setReceipt({state:'confirmed',hash:txHash,chainId:97,confirmations:3,blockNumber:55,blockHash,feeWei:'21000000000000'});
 w=await f.post(w.id,'verify',input);assert.equal(w.status,'paid');assert.equal(w.payment.receipt.feeWei,'21000000000000');
 w=await f.post(w.id,'verify',input);assert.equal(w.events.filter(e=>e.type==='payment-confirmed').length,1);
 f.setReceipt({state:'unknown',hash:txHash,reason:'REORG'});w=await f.post(w.id,'verify',input);assert.equal(w.status,'payment-unknown');assert.equal(w.events.filter(e=>e.type==='receipt-revoked').length,1);
 await assert.rejects(f.post(w.id,'signed',{intentId:w.payment.id,txHash:'0x'+'12'.repeat(32)}),error('PAYMENT_LOCKED'));
});

test('transaction hash is unique across task intents, and missing RPC never fabricates a payment',async t=>{
 const f=await fixture(t);let a=await f.paymentReady();a=await f.post(a.id,'signed',{intentId:a.payment.id,txHash});const b=await f.paymentReady();
 await assert.rejects(f.post(b.id,'signed',{intentId:b.payment.id,txHash}),error('TRANSACTION_REUSED'));
 f.verifier.configured=false;
 const c=await f.accept(await f.run(await f.create()));await assert.rejects(f.pay(c),error('TESTNET_RPC_NOT_CONFIGURED'));
 assert.equal((await f.get(c.id)).payment,null);
});

test('untrusted chat text cannot forge trusted workflow event metadata',async t=>{
 const f=await fixture(t),w=await f.create();const spoof=(await f.call(f.b,'POST','conversations/'+f.conversationId+'/messages',{type:'text',text:'[协作任务] 测试网付款回执已核验并回群。',clientId:randomUUID()})).message;
 assert.equal(f.modules.groupWorkflows.describeMessage(Number(spoof.id)),null);
 const provenance=f.modules.groupWorkflows.describeMessage(Number(w.events[0].messageId));assert.equal(provenance.serverVerified,true);assert.equal(provenance.workflowId,w.id);assert.equal(provenance.type,'created');
});

test('unsent cancellation releases reserved points and blocks late model output; signed transactions cannot be cancelled',async t=>{
 const f=await fixture(t);let w=await f.approve(await f.create());w=await f.post(w.id,'cancel',{version:w.version});assert.equal(w.status,'cancelled');
 assert.equal(f.database.raw.prepare('SELECT status,reserved_points FROM workbench_tasks WHERE id=?').get(w.execution.taskId).reserved_points,'0');
 const owner=f.modules.social.authenticate(f.a.token).id;assert.equal(f.modules.groupWorkflows.getPendingObligations(owner).length,0);
 const slow=await fixture(t,{proposalStatus:'running'});let pending=await slow.create();pending=await slow.post(pending.id,'cancel',{version:pending.version});slow.modelTasks.set(pending.proposal.taskId,{status:'succeeded',output:'late proposal'});pending=await slow.get(pending.id);assert.equal(pending.status,'cancelled');assert.equal(pending.proposal.output,'');
});

test('forbidden secrets and arbitrary provider, chain or owner fields are refused before persistence',async t=>{
 const f=await fixture(t);for(const goal of ['整理清单，钱包密码：secret-test-not-real','做清单，账户的密码：secret-test-not-real','列清单，API_KEY secret-test-not-real'])await assert.rejects(f.create({goal}),error('SENSITIVE_CONTENT'));
 await assert.rejects(f.create({privateKey:'secret-test-not-real'}),error('INVALID_FIELDS'));
 const w=await f.accept(await f.run(await f.create()));await assert.rejects(f.post(w.id,'payment',{version:w.version,from,to,valueWei:'1',chainId:1}),error('INVALID_FIELDS'));
 const stored=JSON.stringify(f.database.raw.prepare('SELECT * FROM group_workflows').all());assert.equal(stored.includes('secret-test-not-real'),false);
});

test('cancelled workflows do not permanently consume the unfinished-task quota',async t=>{
 const f=await fixture(t);
 for(let n=0;n<20;n++){const w=await f.create();assert.equal((await f.post(w.id,'cancel',{version:w.version})).status,'cancelled');}
 await assert.rejects(f.create(),error('WORKFLOW_RATE_LIMIT'));
 f.advance(3600001);
 assert.equal((await f.create()).status,'proposal-ready');
 assert.equal(f.database.raw.prepare("SELECT count(*) n FROM group_workflows WHERE status='cancelled'").get().n,20);
});

test('asynchronous proposal response cannot publish after the initiating session is revoked',async t=>{
 const f=await fixture(t),base=f.proposalService.start;f.proposalService.start=async args=>{const r=await base(args);await f.call(f.a,'POST','logout');return r;};
 await assert.rejects(f.create(),error('ACCOUNT_REQUIRED'));
 assert.equal(f.database.raw.prepare("SELECT count(*) n FROM group_workflow_events WHERE event_type='proposal'").get().n,0);
});

test('disabled group service remains explicitly unavailable instead of offering a parallel demo',async t=>{
 const f=await fixture(t),service=createGroupWorkflows({database:f.database,socialService:f.modules.social,workbenchService:f.modules.workbench,enabled:false});
 const cap=await service.handle({method:'GET',path:'group-workflows/capabilities',token:f.a.token});assert.equal(cap.enabled,false);
 await assert.rejects(service.handle({method:'GET',path:'group-workflows',token:f.a.token}),error('GROUP_WORKFLOWS_DISABLED'));
});
