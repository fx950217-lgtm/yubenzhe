import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createSocialService} from '../server/social-service.mjs';
import {openAiDatabase} from '../server/ai-database.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createSocialAI} from '../server/social-ai.mjs';
const PIN='492718',expected=(status,code)=>error=>error.status===status&&(!code||error.code===code);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(providerOverrides={}){
 let time=1700000000000;const socialDb=openSocialDatabase(':memory:'),aiDb=openAiDatabase(':memory:');const social=createSocialService({database:socialDb,now:()=>time});const provider={configured:true,fingerprint:'social-ai-test',configurationMessage:'test',readiness:async()=>true,run:async()=>({output:'隔离测试模型响应'}),...providerOverrides};const ai=createAiService({database:aiDb,provider,now:()=>time,maintenanceMs:100000});let adapter=createSocialAI({socialService:social,aiService:ai,maintenanceMs:100000});
 const call=(actor,method,path,input={},query={})=>adapter.handle({token:actor?.token||'',method,path:'ai/'+path,input,query});
 const register=()=>social.handle({method:'POST',path:'register',input:{password:PIN,requestId:randomUUID()},ip:randomUUID()});
 const admin=(method,path,input={})=>ai.handle({role:'admin',user:{userId:'isolated-admin'},method,path,input});
 const create=async actor=> (await call(actor,'POST','workspaces',{name:'产品账号的工作区',purpose:'research',requirements:'只处理本次隔离测试的合成内容与资料。',requestId:randomUUID()})).workspace;
 const activate=async actor=>{let w=await create(actor);w=(await admin('POST','workspaces/'+w.id+'/actions',{action:'approve',reason:'隔离测试批准申请',version:w.version,requestId:randomUUID()})).value.workspace;w=(await admin('POST','workspaces/'+w.id+'/actions',{action:'activate',reason:'隔离测试开通模型',version:w.version,requestId:randomUUID()})).value.workspace;return w;};
 return {socialDb,aiDb,social,ai,provider,call,register,admin,create,activate,get adapter(){return adapter;},tick(ms){time+=ms;},async replaceAdapter(next){await adapter.close();adapter=next;},async close(){await adapter.close();await ai.close();socialDb.close();aiDb.close();}};
}

test('product AI identity is internal and stable, separate from other accounts and legacy acceptance identity',async t=>{
 const f=await fixture();t.after(()=>f.close());const a=await f.register(),b=await f.register();const w=await f.create(a);const internal=f.social.authenticate(a.token).id;assert.equal(w.ownerId,'social:'+internal);assert.equal(w.status,'pending_review');assert.equal((await f.call(a,'GET','capabilities')).identityType,'product_account');assert.deepEqual((await f.call(b,'GET','workspaces')).items,[]);await assert.rejects(f.call(b,'GET','workspaces/'+w.id),expected(404));await assert.rejects(f.call(null,'GET','workspaces'),expected(401,'ACCOUNT_REQUIRED'));
 const legacy=(await f.ai.handle({role:'frontend',user:{userId:internal},method:'GET',path:'workspaces'})).value;assert.deepEqual(legacy.items,[]);await assert.rejects(f.call(a,'POST','workspaces',{ownerId:'social:'+f.social.authenticate(b.token).id,name:'拒绝伪造身份',purpose:'research',requirements:'这些文字只是隔离测试输入。',requestId:randomUUID()}),expected(400,'INVALID_FIELDS'));
 const p=a.profile;await f.social.handle({method:'POST',path:'profile',token:a.token,input:{nickname:p.nickname,bio:p.bio,avatar:p.avatar,avatarImage:p.avatarImage,userId:'73928615',currentPassword:PIN,revision:p.revision}});assert.equal((await f.call(a,'GET','workspaces')).items[0].id,w.id);
});

test('approval, readiness and quotas still apply and consumers cannot invoke administrator routes',async t=>{
 const f=await fixture({configured:false,configurationMessage:'模型未配置'});t.after(()=>f.close());const a=await f.register(),w=await f.create(a);await assert.rejects(f.call(a,'POST','workspaces/'+w.id+'/tasks',{prompt:'不能提前运行',version:w.version,requestId:randomUUID()}),expected(409,'WORKSPACE_NOT_ACTIVE'));await assert.rejects(f.call(a,'POST','readiness',{requestId:randomUUID()}),expected(404));await assert.rejects(f.call(a,'POST','workspaces/'+w.id+'/actions',{action:'approve',version:w.version,requestId:randomUUID()}),expected(403,'ACTION_DENIED'));
 const approved=(await f.admin('POST','workspaces/'+w.id+'/actions',{action:'approve',reason:'批准但模型仍未配置',version:w.version,requestId:randomUUID()})).value.workspace;await assert.rejects(f.admin('POST','workspaces/'+w.id+'/actions',{action:'activate',reason:'不得伪造模型就绪',version:approved.version,requestId:randomUUID()}),expected(503,'AI_NOT_CONFIGURED'));
 await f.create(a);await f.create(a);await assert.rejects(f.create(a),expected(429,'WORKSPACE_LIMIT'));assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_tasks').get().n,0);
});

test('revocation during asynchronous readiness prevents creating a task',async t=>{
 const gate=deferred();let wait=false;const f=await fixture({readiness:async()=>{if(wait)await gate.promise;return true;}});t.after(()=>f.close());const a=await f.register(),w=await f.activate(a);f.tick(11*60000);wait=true;const pending=f.call(a,'POST','workspaces/'+w.id+'/tasks',{prompt:'会话撤销后不得提交',version:w.version,requestId:randomUUID()});await f.social.handle({method:'POST',path:'logout',token:a.token});gate.resolve();await assert.rejects(pending,expected(401,'ACCOUNT_REQUIRED'));assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_tasks').get().n,0);
});

test('account deletion cleanup cancels work, erases payload/cache and rejects late provider results',async t=>{
 const gate=deferred();let receivedSignal;const f=await fixture({run:async({signal})=>{receivedSignal=signal;return gate.promise;}});t.after(()=>f.close());const a=await f.register(),b=await f.register(),other=await f.create(b),w=await f.activate(a);const task=(await f.call(a,'POST','workspaces/'+w.id+'/tasks',{prompt:'注销前需要删除的合成内容',version:w.version,requestId:randomUUID()})).task;
 await f.social.handle({method:'POST',path:'security/delete-account',token:a.token,input:{currentPassword:PIN,confirmation:'注销账号'}});await f.adapter.maintain();assert.equal(receivedSignal.aborted,true);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_tasks WHERE id=?').get(task.id).n,0);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_workspaces WHERE id=?').get(w.id).n,0);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_requests WHERE instr(response_json,?)>0').get(w.id).n,0);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_audit WHERE workspace_id=?').get(w.id).n,0);assert.equal((await f.call(b,'GET','workspaces')).items[0].id,other.id);
 gate.resolve({output:'迟到结果不得复活'});await new Promise(r=>setImmediate(r));assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_tasks').get().n,0);await assert.rejects(f.call(a,'GET','workspaces'),expected(401,'ACCOUNT_REQUIRED'));await f.adapter.maintain();
});

test('cleanup failures retry from durable tombstones, including a fresh adapter, without touching legacy owners',async t=>{
 const f=await fixture();t.after(()=>f.close());const a=await f.register(),w=await f.create(a);await f.social.handle({method:'POST',path:'security/delete-account',token:a.token,input:{currentPassword:PIN,confirmation:'注销账号'}});let failures=0,blocked=true;const wrapper={handle:input=>f.ai.handle(input),purgeOwner:owner=>{if(blocked)throw Error('isolated failure');return f.ai.purgeOwner(owner);}};await f.replaceAdapter(createSocialAI({socialService:f.social,aiService:wrapper,onCleanupError:()=>failures++,maintenanceMs:100000}));await new Promise(r=>setImmediate(r));assert.ok(failures>0);assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_workspaces WHERE id=?').get(w.id).n,1);blocked=false;await f.adapter.maintain();assert.equal(f.aiDb.raw.prepare('SELECT count(*) n FROM ai_workspaces WHERE id=?').get(w.id).n,0);assert.throws(()=>f.ai.purgeOwner('legacy-acceptance'),expected(400,'INVALID_OWNER'));
});
