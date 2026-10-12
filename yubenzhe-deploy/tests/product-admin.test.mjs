import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {passwordRecord} from '../server/auth.mjs';
import {openDatabase} from '../server/sqlite-adapter.mjs';
import {setupAdmin} from '../upstream/admin/core.mjs';
const origin='http://127.0.0.1:18819',actor='product-owner-test';
function fixture(t){const database=openSocialDatabase(':memory:'),modules=createProductModules({database,origin,simulation:true});t.after(()=>database.close());return {database,modules,admin:(path,input,query={})=>modules.operations.handle({method:input?'POST':'GET',path,input,query,actor})};}
async function register(modules){const result=await modules.handle({method:'POST',path:'register',input:{password:'248635',requestId:randomUUID()}});return {...result,id:modules.social.authenticate(result.token).id};}
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXkAAAAASUVORK5CYII=';

test('real account views omit credentials, remove avatars with version checks and restore after suspension',async t=>{
 const {database,modules,admin}=fixture(t),account=await register(modules);
 database.raw.prepare('UPDATE accounts SET avatar_image=?,avatar_key=? WHERE id=?').run(image,randomUUID(),account.id);
 const detail=admin('accounts/'+account.id);assert.equal(detail.item.hasAvatar,true);assert.equal(detail.item.userId,account.profile.userId);
 const serialized=JSON.stringify(detail);for(const secret of ['password_hash','recovery_hash','encryptedJson','token_hash','email','avatar_image'])assert.equal(serialized.includes(secret),false,secret);
 assert.equal(admin('accounts/'+account.id+'/avatar').mime,'image/png');
 const removal={requestId:randomUUID(),revision:detail.item.revision,action:'remove-avatar',reason:'头像内容经人工核实需移除'};
 const removed=admin('accounts/'+account.id+'/actions',removal);assert.equal(removed.item.hasAvatar,false);assert.equal(admin('accounts/'+account.id+'/actions',removal).item.revision,removed.item.revision);
 assert.throws(()=>admin('accounts/'+account.id+'/actions',{...removal,reason:'更改同一个请求的处理内容'}),{code:'REQUEST_CONFLICT'});
 assert.throws(()=>admin('accounts/'+account.id+'/actions',{...removal,requestId:randomUUID(),action:'suspend'}),{code:'REVISION_CHANGED'});
 assert.throws(()=>admin('accounts/'+account.id+'/avatar'),{code:'AVATAR_NOT_FOUND'});
 const suspended=admin('accounts/'+account.id+'/actions',{requestId:randomUUID(),revision:removed.item.revision,action:'suspend',reason:'测试暂停与会话撤销'});
 assert.equal(suspended.item.status,'suspended');assert.throws(()=>modules.social.authenticate(account.token),{code:'ACCOUNT_REQUIRED'});
 const restored=admin('accounts/'+account.id+'/actions',{requestId:randomUUID(),revision:suspended.item.revision,action:'restore',reason:'复核通过恢复账号'});assert.equal(restored.item.status,'active');
 assert.throws(()=>modules.social.authenticate(account.token),{code:'ACCOUNT_REQUIRED'});
 assert.equal(admin('audit').items.length,3);assert.ok(admin('audit').items.every(row=>row.actor===actor&&!row.action.startsWith('request:')));
 assert.equal(database.raw.prepare('SELECT count(*) n FROM social_moderation_audit').get().n,3);
 assert.throws(()=>admin('accounts/'+account.id+'/actions',{requestId:randomUUID(),revision:restored.item.revision,action:'restore',reason:'不能反复恢复正常账号'}),{code:'STATE_UNCHANGED'});
});

test('operator lists paginate all real records without swallowing state filters',async t=>{
 const {database,modules,admin}=fixture(t);const a=await register(modules);const source=database.raw.prepare('SELECT * FROM accounts WHERE id=?').get(a.id);
 const keys=Object.keys(source),insert=database.raw.prepare('INSERT INTO accounts('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')');
 for(let i=0;i<55;i++)insert.run(...keys.map(key=>key==='id'?randomUUID():key==='user_id'?'audit_user_'+i:source[key]));
 const first=admin('accounts');assert.equal(first.items.length,50);assert.ok(first.nextBefore);const second=admin('accounts',undefined,{before:first.nextBefore});assert.equal(second.items.length,6);assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,56);
 assert.throws(()=>admin('points'),{code:'PRODUCT_ADMIN_NOT_FOUND'});
 assert.throws(()=>admin('accounts',undefined,{before:'-1'}),{code:'INVALID_CURSOR'});assert.throws(()=>admin('accounts',undefined,{privateKey:'invalid'}),{code:'INVALID_FIELDS'});
 assert.equal(admin('accounts',undefined,{q:a.profile.userId}).items.length,1);
});


test('account restriction cancels queued, running and paused file work without further execution',async t=>{
 for(const mode of ['queued','running','paused','quoted']){
  const {database,modules,admin}=fixture(t),a=await register(modules);
  const call=(path,input)=>modules.handle({method:input?'POST':'GET',path,token:a.token,input:input?{requestId:randomUUID(),...input}:undefined});
  let task=(await call('workbench/plan',{goal:'准备一份产品发布工作清单',fileIds:[]})).task;
  if(mode!=='quoted')task=(await call('workbench/tasks/'+task.id+'/confirm',{version:task.version,planVersion:task.planVersion,acceptExecution:true})).task;
  if(mode==='running'||mode==='paused'){await modules.tick();await modules.tick();assert.equal(database.raw.prepare('SELECT step FROM workbench_tasks WHERE id=?').get(task.id).step,1);}
  if(mode==='paused')database.raw.prepare("UPDATE workbench_tasks SET status='paused' WHERE id=?").run(task.id);
  const item=admin('accounts/'+a.id).item;admin('accounts/'+a.id+'/actions',{requestId:randomUUID(),revision:item.revision,action:'mute',reason:'治理限制后停止自动执行'});
  await modules.tick();await modules.tick();const stored=database.raw.prepare('SELECT status,step,error_code FROM workbench_tasks WHERE id=?').get(task.id);
  assert.equal(stored.status,'cancelled',mode);assert.equal(stored.error_code,'ACCOUNT_RESTRICTED');assert.equal(stored.step,mode==='running'||mode==='paused'?1:0);
  assert.equal(database.raw.prepare('SELECT count(*) n FROM workbench_usage').get().n,0);
 }
});

test('provider and token reviews enforce the pending state and keep approval separate from deployment',async t=>{
 const {modules,admin}=fixture(t),a=await register(modules),community=modules.community;
 const provider=community.handle({method:'POST',path:'community/providers',token:a.token,input:{requestId:randomUUID(),kind:'business',name:'本地测试服务商',category:'design',description:'提供本地设计文件整理测试服务',pricing:'双方另行沟通',languages:['中文'],regions:['测试地区']}}).provider;
 const review={requestId:randomUUID(),id:provider.id,revision:provider.revision,decision:'approve',reason:'已核对服务商的测试材料',subject:'测试运营主体',scope:'仅核对设计服务介绍',validUntil:Date.now()+86400000};
 community.adminHandle({method:'POST',path:'provider',input:review,actor});assert.equal(admin('providers/'+provider.id).item.status,'approved');assert.equal(admin('providers/'+provider.id).item.certification.scope,review.scope);
 assert.throws(()=>community.adminHandle({method:'POST',path:'provider',input:{...review,requestId:randomUUID(),revision:provider.revision+1},actor}),{code:'REVIEW_STATE_CHANGED'});
 community.adminHandle({method:'POST',path:'provider',input:{requestId:randomUUID(),id:provider.id,revision:provider.revision+1,decision:'revoke',reason:'认证范围已变化需重提交'},actor});assert.equal(admin('providers/'+provider.id).item.status,'revoked');
 const application=community.handle({method:'POST',path:'community/tokens',token:a.token,input:{requestId:randomUUID(),name:'测试道具',symbol:'TST',description:'仅用于本地功能核对',supply:'1000',decimals:6,recipient:'0x'+'1'.repeat(40)}}).application;
 community.adminHandle({method:'POST',path:'token',input:{requestId:randomUUID(),id:application.id,revision:application.revision,decision:'approve',reason:'参数审核通过等待测试配置'},actor});
 const checked=admin('tokens/'+application.id);assert.equal(checked.item.status,'awaiting_configuration');assert.equal(checked.item.deployed,false);assert.equal(checked.item.registered,false);
 assert.throws(()=>community.adminHandle({method:'POST',path:'token',input:{requestId:randomUUID(),id:application.id,revision:application.revision+1,decision:'reject',reason:'不能覆盖已经处理的申请'},actor}),{code:'REVIEW_STATE_CHANGED'});
});

test('workbench operations expose only metadata and community reports can be inspected before moderation',async t=>{
 const {database,modules,admin}=fixture(t),a=await register(modules),b=await register(modules),taskId=randomUUID(),workspaceId=randomUUID(),time=Date.now();
 database.raw.prepare('INSERT INTO workbench_workspaces(id,owner_id,state,created_at,updated_at) VALUES(?,?,?,?,?)').run(workspaceId,a.id,'ready',time,time);
 database.raw.prepare("INSERT INTO workbench_tasks(id,owner_id,workspace_id,title,operation,input_ids,status,quote_expires_at,estimated_micro,budget_micro,price_version,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,'0','0','test',?,?)").run(taskId,a.id,workspaceId,'元数据测试','dedupe','["PRIVATE-INPUT-ID"]',time+300000,time,time);
 database.raw.prepare('INSERT INTO workbench_events VALUES(?,?,?,?,?)').run(randomUUID(),taskId,'created','{"input":"PRIVATE-TASK-CONTENT"}',time);
 const task=admin('tasks/'+taskId);assert.equal(task.item.status,'draft');assert.equal(JSON.stringify(task).includes('PRIVATE-'),false);assert.equal(task.readOnly,true);
 const bounty=modules.community.handle({method:'POST',path:'community/bounties',token:a.token,input:{requestId:randomUUID(),title:'审核赏金任务',description:'核对真实赏金论坛举报处理流程',category:'design',tags:[],assetId:'SIM-USD',rewardAmount:'10',deadline:time+86400000,deliverables:'测试成果文件',acceptance:'核对整理结果'}}).bounty;
 const report=modules.community.handle({method:'POST',path:'community/reports',token:b.token,input:{requestId:randomUUID(),targetType:'bounty',targetId:bounty.id,reason:'这是一条用于测试的举报说明'}});
 const reportId=report.report?.id||report.id;const detail=admin('reports/'+reportId);assert.equal(detail.content.id,bounty.id);assert.equal(detail.content.escrow,false);assert.equal(detail.content.paymentVerification,'unavailable');
});

test('real product HTTP requires independent owner, same origin and forbids actor injection',async t=>{
 const {modules}=fixture(t),root=await mkdtemp(join(tmpdir(),'ybz-product-admin-'));await writeFile(join(root,'index.html'),'<h1>fixture</h1>');const database=openDatabase(join(root,'admin.sqlite')),auth=await passwordRecord('owner','Synthetic-Only-Admin-826351!');await setupAdmin(database,{userId:auth.userId,displayName:auth.displayName});
 const server=createAcceptanceServer({role:'admin',origin,authConfig:auth,database,socialService:{operations:modules.operations,community:modules.community},staticRoot:root});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));database.close();});
 const request=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path,method,headers:{Host:new URL(origin).host,...headers}},r=>{const chunks=[];r.on('data',x=>chunks.push(x));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});
 const a=await register(modules);assert.equal((await request('/api/admin/product/accounts',{headers:{Authorization:'Bearer '+a.token}})).status,401);
 const login=await request('/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'owner',password:'Synthetic-Only-Admin-826351!'}).toString()});const Cookie=login.headers['set-cookie'][0].split(';')[0];
 const result=await request('/api/admin/product/accounts/'+a.id,{headers:{Cookie}});assert.equal(result.status,200);const item=JSON.parse(result.body).item;
 const input={requestId:randomUUID(),revision:item.revision,action:'mute',reason:'核对真实账号权限和审计'},path='/api/admin/product/accounts/'+a.id+'/actions';
 const send=(value,Origin=origin)=>request(path,{method:'POST',headers:{Cookie,Origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await send(input,'https://evil.test')).status,403);assert.equal((await send({...input,actor:'forged'})).status,400);assert.equal((await send(input)).status,200);
 const audit=JSON.parse((await request('/api/admin/product/audit',{headers:{Cookie}})).body).items;assert.equal(audit[0].actor,auth.userId);
 const source=await readFile(new URL('../ui/product-ops.js',import.meta.url),'utf8');assert.equal(source.includes('innerHTML'),false);assert.ok(source.includes('pending={path,input'));
});
