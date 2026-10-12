import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openAiDatabase} from '../server/ai-database.mjs';
import {createAiService} from '../server/ai-service.mjs';

function setup(t,overrides={}) {
 const database=openAiDatabase(':memory:'),calls=[];
 const provider={configured:true,fingerprint:'group-fixture',readiness:async()=>true,run:async input=>{calls.push(input);return {output:'明确标注的测试模型方案'};},...overrides};
 const service=createAiService({database,provider});t.after(async()=>{await service.close();database.close();});
 const args={ownerId:randomUUID(),scopeId:randomUUID(),prompt:'整理活动准备清单，并交付可验收文件',requestId:randomUUID(),assertAuthorized:()=>{}};
 return {database,service,calls,args};
}
test('group proposal is isolated from private chat and other group history; replay does not call model twice',async t=>{
 const f=setup(t),owner={role:'frontend',user:{userId:'social:'+f.args.ownerId}};
 await f.service.handle({...owner,method:'POST',path:'chat/messages',input:{prompt:'private chat secret',requestId:randomUUID()}});
 const first=await f.service.groupProposals.start(f.args);await new Promise(r=>setImmediate(r));
 assert.equal((await f.service.groupProposals.read({...f.args,id:first.id})).status,'succeeded');
 assert.equal((await f.service.groupProposals.start(f.args)).id,first.id);
 const groupCall=f.calls.find(x=>x.prompt===f.args.prompt);assert.deepEqual(groupCall.history,[]);assert.doesNotMatch(JSON.stringify(groupCall),/private chat secret/);
 assert.equal(f.calls.length,2);
 await assert.rejects(f.service.groupProposals.start({...f.args,prompt:'changed task'}),e=>e.code==='IDEMPOTENCY_CONFLICT');
 await assert.rejects(f.service.groupProposals.read({...f.args,ownerId:randomUUID(),id:first.id}),e=>e.status===404);
 // The ordinary personal-AI routes must never bypass current group membership.
 const groupWorkspace='group-'+f.args.scopeId;
 assert.ok(!(await f.service.handle({...owner,method:'GET',path:'workspaces'})).value.items.some(w=>w.id===groupWorkspace));
 for(const path of ['workspaces/'+groupWorkspace,'tasks/'+first.id])await assert.rejects(f.service.handle({...owner,method:'GET',path}),e=>e.status===404);
 await assert.rejects(f.service.handle({...owner,method:'POST',path:'workspaces/'+groupWorkspace+'/tasks',input:{prompt:'bypass group',version:1,requestId:randomUUID()}}),e=>e.status===404);
});
test('missing real model blocks proposal with no simulated output',async t=>{
 const f=setup(t,{configured:false});assert.equal(f.service.groupProposals.capabilities().configured,false);
 await assert.rejects(f.service.groupProposals.start(f.args),e=>e.code==='AI_NOT_CONFIGURED');
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_tasks').get().n,0);assert.equal(f.calls.length,0);
});
test('group authorization is checked again after asynchronous model readiness',async t=>{
 let valid=true;const f=setup(t,{readiness:async()=>{valid=false;return true;}});
 await assert.rejects(f.service.groupProposals.start({...f.args,assertAuthorized:()=>{if(!valid)throw Error('membership revoked');}}),/membership revoked/);
 assert.equal(f.calls.length,0);
});
test('group proposals consume the same owner and global quotas as other model use',async t=>{
 const f=setup(t);for(let n=0;n<20;n++){await f.service.groupProposals.start({...f.args,scopeId:randomUUID(),requestId:randomUUID()});await new Promise(r=>setImmediate(r));}
 await assert.rejects(f.service.groupProposals.start({...f.args,scopeId:randomUUID(),requestId:randomUUID()}),e=>e.code==='DAILY_QUOTA_EXCEEDED');
 assert.equal(f.calls.length,20);
});
