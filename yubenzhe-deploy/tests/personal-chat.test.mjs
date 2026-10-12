
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openAiDatabase} from '../server/ai-database.mjs';
import {createAiService} from '../server/ai-service.mjs';
import {createOllamaProvider} from '../server/ai-provider.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function setup(t,{run}={}){
 const database=openAiDatabase(':memory:'),calls=[];
 const provider={configured:true,fingerprint:'chat-fixture',configurationMessage:'ready',readiness:async()=>true,run:run||(async input=>{calls.push(input);return {output:'test response '+calls.length}})};
 const service=createAiService({database,provider,maintenanceMs:20});
 t.after(async()=>{await service.close();database.close();});
 const a='social:'+randomUUID(),b='social:'+randomUUID();
 const request=(owner,method,path,input={})=>service.handle({role:'frontend',user:{userId:owner},method,path,input,assertAuthorized:()=>{}}).then(r=>r.value);
 const send=(prompt,requestId=randomUUID())=>request(a,'POST','chat/messages',{prompt,requestId});
 const terminal=async id=>{for(let i=0;i<100;i++){const r=await request(a,'GET','tasks/'+id);if(r.task.status!=='running')return r.task;await sleep(5);}throw Error('timeout');};
 return {database,service,calls,a,b,request,send,terminal};
}
test('personal chat starts immediately, persists messages, and gives later turns bounded history',async t=>{
 const f=setup(t);assert.equal((await f.request(f.a,'GET','chat')).workspace,null);
 const first=(await f.send('My project is YBZ.')).task;assert.equal((await f.terminal(first.id)).status,'succeeded');
 const second=(await f.send('What is the project name?')).task;await f.terminal(second.id);
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1].history,[{role:'user',content:'My project is YBZ.'},{role:'assistant',content:'test response 1'}]);
 const view=await f.request(f.a,'GET','chat');assert.equal(view.tasks.length,2);assert.equal(view.quota.used,2);
 assert.equal((await f.request(f.b,'GET','chat')).tasks.length,0);
 await assert.rejects(f.request(f.b,'GET','tasks/'+first.id),e=>e.status===404);
});
test('chat retries are idempotent and mismatched retries are rejected',async t=>{
 const f=setup(t),id=randomUUID(),a=(await f.send('one',id)).task;await f.terminal(a.id);
 assert.equal((await f.send('one',id)).task.id,a.id);assert.equal(f.calls.length,1);
 await assert.rejects(f.send('two',id),e=>e.code==='IDEMPOTENCY_CONFLICT');
});
test('chat quota cannot be bypassed by opening another personal conversation',async t=>{
 const f=setup(t);for(let n=0;n<10;n++)await f.terminal((await f.send('question '+n)).task.id);
 await assert.rejects(f.send('eleventh'),e=>e.code==='DAILY_QUOTA_EXCEEDED');
 assert.equal(f.database.raw.prepare("SELECT COUNT(*) n FROM ai_workspaces WHERE id LIKE 'chat-%'").get().n,1);
});
test('cancellation discards late provider response and owner purge removes personal chat',async t=>{
 let resolve;const f=setup(t,{run:()=>new Promise(r=>resolve=r)});
 const task=(await f.send('waiting')).task;await f.request(f.a,'POST','tasks/'+task.id+'/cancel',{version:task.version,requestId:randomUUID()});
 resolve({output:'late result'});await sleep(10);assert.equal((await f.terminal(task.id)).status,'cancelled');
 f.service.purgeOwner(f.a);assert.equal((await f.request(f.a,'GET','chat')).workspace,null);
});
test('Ollama receives separate user history in the real provider transport contract',async()=>{
 let payload;const provider=createOllamaProvider({configuration:{configured:true,model:'qwen3:0.6b'},fetchImpl:async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({done:true,done_reason:'stop',message:{role:'assistant',content:'actual fixture'}}));}});
 const history=[{role:'user',content:'first'},{role:'assistant',content:'reply'}];const r=await provider.run({purpose:'content',requirements:'help',prompt:'second',history});
 assert.equal(r.output,'actual fixture');assert.deepEqual(payload.messages.slice(1,3),history);
});
