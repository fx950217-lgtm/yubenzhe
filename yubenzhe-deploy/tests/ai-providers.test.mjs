import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createSocialService} from '../server/social-service.mjs';
import {createPersonalDevices} from '../server/personal-devices.mjs';
import {createAIChannel} from '../server/ai-channel.mjs';
import {AI_PROVIDER_CATALOG,AI_PROVIDER_SCAN_MAX_MS,checkedProviderId,validateAIProviders,readAIProviders} from '../server/ai-providers.mjs';

const error=code=>value=>value.code===code;
const provider=(id,overrides={})=>({id,name:AI_PROVIDER_CATALOG[id].name,installed:true,loggedIn:id==='ollama'?null:true,version:'1.2.3',reason:'',executionSupported:['codex','ollama'].includes(id),executionMode:AI_PROVIDER_CATALOG[id].mode,...overrides});
async function fixture(t){
 let time=Date.UTC(2026,9,12),channel;
 const database=openSocialDatabase(':memory:'),social=createSocialService({database,now:()=>time});
 const register=()=>social.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip:randomUUID()});
 const owner=await register(),other=await register(),devices=createPersonalDevices({database,socialService:social,now:()=>time});
 const pair=devices.handle({method:'POST',path:'devices/pair',token:owner.token,input:{name:'多 AI 电脑'}}),device=devices.enroll({pairToken:pair.pairToken});
 channel=createAIChannel({database,socialService:social,devices,now:()=>time});t.after(()=>database.close());
 const connectorId=randomUUID();
 const status=(providers=[provider('codex'),provider('ollama')],extra={})=>({code:'ready',workspaceLabel:'YBZ 工作区',providers,scannedAt:time,...extra});
 const poll=(input={})=>channel.poll(device.token,{connectorId,status:status(),...input});
 const call=(method,path,input={},user=owner)=>channel.handle({method,path:'ai-channel/'+path,input,token:user.token});
 const send=(selected='codex',extra={})=>call('POST','send',{deviceId:device.deviceId,prompt:'SYNTHETIC-PROMPT-PRIVATE',requestId:randomUUID(),provider:selected,...extra}).task;
 const get=id=>call('GET','tasks/'+id);
 const state=()=>call('GET','devices/'+device.deviceId).device;
 poll();return {database,social,devices,channel,owner,other,device,connectorId,status,poll,call,send,get,state,now:()=>time,advance(ms){time+=ms;}};
}

test('registry projects fixed safe public names and reasons without CLI output, executable or credentials',async t=>{
 const f=await fixture(t),input=[provider('codex',{name:'private@example.test',reason:'synthetic-token-do-not-store'}),provider('claude',{reason:'C:/private/path'}),provider('workb',{installed:false,loggedIn:null}),provider('ollama')];
 f.poll({status:f.status(input)});const actual=f.state();assert.deepEqual(actual.providers.map(row=>row.id),['codex','claude','workb','ollama']);assert.equal(actual.scannedAt,f.now());assert.equal(actual.providers[0].name,'Codex');assert.equal(actual.providers[1].executionSupported,false);assert.equal(actual.providers[2].installed,false);
 const stored=f.database.raw.prepare('SELECT * FROM ai_channel_devices').get();assert.equal(stored.provider,'Codex');for(const secret of ['private@example.test','synthetic-token-do-not-store','C:/private/path'])assert.equal(stored.providers.includes(secret),false);
 assert.throws(()=>f.poll({status:f.status([{...provider('codex'),executable:'C:/private/codex.exe'}])}),error('INVALID_FIELDS'));
});

test('provider IDs, arrays, versions, control characters and impossible capability combinations fail closed',()=>{
 for(const value of ['Codex','codex\n',' codex','future-ai','__proto__','constructor','ollama;echo',null])assert.throws(()=>checkedProviderId(value),error('AI_PROVIDER_INVALID'));
 for(const input of [null,Array(9).fill(provider('codex')),[provider('codex'),provider('codex')],[provider('codex',{version:'1.2.3\n'})],[provider('codex',{reason:'unsafe\ntext'})],[provider('codex',{name:'unsafe\x00name'})],[provider('codex',{installed:false})],[provider('codex',{loggedIn:false})],[provider('claude',{executionSupported:true,executionMode:'tools'})],[provider('workb',{executionSupported:true,executionMode:'tools'})],[provider('ollama',{loggedIn:true})],[provider('ollama',{executionMode:'tools'})],[provider('codex',{executionSupported:false})]])assert.throws(()=>validateAIProviders(input));
});

test('explicit provider choice reaches dispatch and provenance; task content is never persisted',async t=>{
 const f=await fixture(t),task=f.send('ollama'),dispatch=f.poll().task;assert.equal(dispatch.id,task.id);assert.equal(dispatch.provider,'ollama');assert.equal(dispatch.executionMode,'chat-only');assert.match(task.sourceLabel,/Ollama$/);
 f.poll({taskId:dispatch.id,leaseId:dispatch.leaseId,events:[{seq:1,kind:'message',itemId:'reply',text:'SYNTHETIC-OUTPUT-PRIVATE'},{seq:2,kind:'completed',code:'AI_COMPLETED'}]});assert.equal(f.get(task.id).task.status,'succeeded');
 for(const table of ['ai_channel_devices','ai_channel_tasks','ai_channel_event_hashes']){const content=JSON.stringify(f.database.raw.prepare('SELECT * FROM '+table).all());assert.equal(content.includes('SYNTHETIC-PROMPT-PRIVATE'),false);assert.equal(content.includes('SYNTHETIC-OUTPUT-PRIVATE'),false);}
 assert.equal(f.database.raw.prepare('SELECT provider FROM ai_channel_tasks').get().provider,'ollama');
});

test('unavailable Codex never blocks ready Ollama and neither detection-only provider can execute',async t=>{
 const f=await fixture(t);f.poll({status:f.status([provider('codex',{loggedIn:false,executionSupported:false,executionMode:'disabled'}),provider('ollama'),provider('claude'),provider('workb')],{code:'login-required'})});
 assert.equal(f.state().aiStatus,'ready');assert.throws(()=>f.send('codex'),error('AI_LOGIN_REQUIRED'));for(const id of ['claude','workb'])assert.throws(()=>f.send(id),error('AI_PROVIDER_UNSUPPORTED'));
 const task=f.send('ollama');assert.equal(f.poll().task.id,task.id);
});

test('missing, disabled and malformed modern registry never fall back to Codex',async t=>{
 const f=await fixture(t);f.poll({status:f.status([provider('ollama')])});assert.throws(()=>f.send('codex'),error('AI_PROVIDER_UNAVAILABLE'));
 f.poll({status:f.status([])});assert.equal(f.state().aiStatus,'error');assert.throws(()=>f.send(),error('AI_PROVIDER_UNAVAILABLE'));
 const db=f.database.raw;db.prepare('UPDATE ai_channel_devices SET providers=?').run('{bad JSON');assert.deepEqual(f.state().providers,[]);assert.throws(()=>f.send(),error('AI_PROVIDER_UNAVAILABLE'));
 for(const json of ['null','{}','[{"id":"future"}]'])assert.deepEqual(readAIProviders({providers:json,scanned_at:f.now(),status_code:'ready'},f.now()).providers,[]);
});

test('freshness has real scan time, future bounds, replay rejection and explicit refresh recovery',async t=>{
 const f=await fixture(t),scannedAt=f.now();f.advance(AI_PROVIDER_SCAN_MAX_MS);f.poll({status:f.status(undefined,{scannedAt})});assert.equal(f.state().providersStale,true);assert.equal(f.state().scannedAt,scannedAt);assert.throws(()=>f.send(),error('AI_PROVIDER_STALE'));
 assert.throws(()=>f.poll({status:f.status(undefined,{scannedAt:f.now()+60001})}),error('INVALID_AI_SCAN_TIME'));
 assert.throws(()=>f.poll({status:f.status(undefined,{scannedAt:0})}),error('INVALID_AI_SCAN_TIME'));
 f.poll();assert.equal(f.state().providersStale,false);assert.throws(()=>f.poll({status:f.status(undefined,{scannedAt:scannedAt-1})}),error('AI_PROVIDER_SCAN_REPLAY'));
 assert.equal(f.send().status,'queued');
});

test('chat-only provider rejects attachments before any file hook and denies agent file authorization',async t=>{
 const f=await fixture(t);let hooks=0;f.channel.setFilesService({validateAttachments(){hooks++;throw Error('must not reach');},bindTask(){hooks++;},listForTask(){return [];}});
 assert.throws(()=>f.send('ollama',{attachments:[randomUUID()]}),error('AI_PROVIDER_FILES_UNSUPPORTED'));assert.equal(hooks,0);const task=f.send('ollama');assert.equal(hooks,0);const dispatch=f.poll().task;
 assert.throws(()=>f.channel.authorizeAgent(f.device.token,{taskId:task.id,leaseId:dispatch.leaseId}),error('AI_PROVIDER_FILES_UNSUPPORTED'));
});

test('task capability loss cancels selected provider without running another provider as fallback',async t=>{
 const f=await fixture(t),codex=f.send('codex'),ollama=f.send('ollama');
 const response=f.poll({status:f.status([provider('codex',{executionSupported:false,executionMode:'disabled'}),provider('ollama')])});assert.equal(response.task.id,ollama.id);assert.equal(response.task.provider,'ollama');assert.equal(f.get(codex.id).task.status,'failed');assert.equal(f.get(codex.id).task.errorCode,'AI_NOT_READY');
 const stopped=f.poll({status:f.status([provider('codex')]),taskId:response.task.id,leaseId:response.task.leaseId,events:[{seq:1,kind:'completed'}]});assert.equal(stopped.ack,0);assert.equal(f.get(ollama.id).task.errorCode,'AI_PROVIDER_UNAVAILABLE');
});

test('failed event in capability-loss heartbeat is acknowledged with original diagnostic and cannot revive',async t=>{
 const f=await fixture(t),task=f.send('ollama'),dispatch=f.poll().task,status=f.status([provider('codex'),provider('ollama',{executionSupported:false,executionMode:'disabled'})]);
 const body={status,taskId:task.id,leaseId:dispatch.leaseId,events:[{seq:1,kind:'failed',code:'AI_OLLAMA_UNAVAILABLE'}]};assert.equal(f.poll(body).ack,1);assert.equal(f.get(task.id).task.errorCode,'AI_OLLAMA_UNAVAILABLE');assert.equal(f.poll(body).ack,1);
 assert.equal(f.poll({...body,events:[{seq:2,kind:'completed'}]}).ack,1);assert.equal(f.get(task.id).task.status,'failed');
});

test('per-provider dispatch still permits only one active task per device in P4',async t=>{
 const f=await fixture(t),a=f.send('codex'),b=f.send('ollama'),first=f.poll().task;assert.equal(first.id,a.id);assert.equal(f.poll().task,null);assert.equal(f.get(b.id).task.status,'queued');
 f.poll({taskId:a.id,leaseId:first.leaseId,events:[{seq:1,kind:'completed'}]});assert.equal(f.poll().task.id,b.id);
});

test('provider is part of durable idempotency; omitted provider retry preserves original choice',async t=>{
 const f=await fixture(t),requestId=randomUUID(),task=f.send('ollama',{requestId});assert.throws(()=>f.send('codex',{requestId}),error('IDEMPOTENCY_CONFLICT'));
 f.poll({status:f.status([provider('codex')])});assert.equal(f.send(undefined,{provider:undefined,requestId}).id,task.id);
 f.channel.restart();assert.equal(f.send(undefined,{provider:undefined,requestId}).id,task.id);assert.equal(f.send('ollama',{requestId}).status,'failed');
});

test('legacy Codex report and old request hash are compatible without enabling another tool',async t=>{
 const f=await fixture(t);f.poll({status:{code:'ready',provider:'Codex',workspaceLabel:'旧工作区'}});assert.equal(f.state().providers[0].id,'codex');assert.equal(f.state().scannedAt,0);assert.throws(()=>f.send('ollama'),error('AI_PROVIDER_UNAVAILABLE'));
 const requestId=randomUUID(),task=f.send(undefined,{provider:undefined,requestId});const oldHash=createHash('sha256').update(JSON.stringify({deviceId:f.device.deviceId,prompt:'SYNTHETIC-PROMPT-PRIVATE',attachments:[],replyPublicKey:null})).digest('hex');f.database.raw.prepare('UPDATE ai_channel_tasks SET request_hash=? WHERE id=?').run(oldHash,task.id);
 assert.equal(f.send(undefined,{provider:undefined,requestId}).id,task.id);assert.throws(()=>f.send('ollama',{requestId}),error('IDEMPOTENCY_CONFLICT'));
 assert.throws(()=>f.poll({status:{code:'ready',provider:'ollama',workspaceLabel:'伪装旧工作区'}}),error('INVALID_AI_STATUS'));
});

test('registry and task remain owner-only and do not create social AI accounts or friendships',async t=>{
 const f=await fixture(t),beforeAccounts=f.database.raw.prepare('SELECT count(*) n FROM accounts').get().n,beforeFriends=f.database.raw.prepare('SELECT count(*) n FROM friendships').get().n,task=f.send('ollama');
 assert.throws(()=>f.call('GET','devices/'+f.device.deviceId,{},f.other),error('DEVICE_NOT_FOUND'));assert.throws(()=>f.call('GET','tasks/'+task.id,{},f.other),error('AI_TASK_NOT_FOUND'));assert.throws(()=>f.call('POST','send',{deviceId:f.device.deviceId,prompt:'no',provider:'ollama',requestId:randomUUID()},f.other),error('DEVICE_NOT_FOUND'));
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM accounts').get().n,beforeAccounts);assert.equal(f.database.raw.prepare('SELECT count(*) n FROM friendships').get().n,beforeFriends);
});

test('invalid lease rolls back providers, scan timestamp and task metadata atomically',async t=>{
 const f=await fixture(t),before=f.state();f.send();f.poll();f.advance(1000);
 assert.throws(()=>f.poll({taskId:randomUUID(),leaseId:randomUUID(),status:f.status([provider('ollama')])}),error('AI_LEASE_DENIED'));const after=f.state();assert.deepEqual(after.providers,before.providers);assert.equal(after.scannedAt,before.scannedAt);
});

test('an admitted live lease may complete beyond scan TTL without admitting new work or falsifying scan time',async t=>{
 const f=await fixture(t),status=f.status(),task=f.send('codex'),queued=f.send('ollama'),dispatch=f.poll().task;
 for(let n=0;n<31;n++){f.advance(10000);f.poll({status,taskId:task.id,leaseId:dispatch.leaseId});}
 assert.equal(f.get(task.id).task.status,'running');assert.equal(f.state().providersStale,true);assert.equal(f.state().scannedAt,status.scannedAt);assert.throws(()=>f.send(),error('AI_PROVIDER_STALE'));
 assert.equal(f.poll({status,taskId:task.id,leaseId:dispatch.leaseId,events:[{seq:1,kind:'completed'}]}).ack,1);assert.equal(f.get(task.id).task.status,'succeeded');
 assert.equal(f.poll({status}).task,null);assert.equal(f.get(queued.id).task.errorCode,'AI_PROVIDER_STALE');
});

test('scan TTL grace cannot extend a live task beyond the original ten-minute hard deadline',async t=>{
 const f=await fixture(t),status=f.status(),task=f.send('codex'),dispatch=f.poll().task;
 for(let n=0;n<60;n++){f.advance(10000);f.poll({status,taskId:task.id,leaseId:dispatch.leaseId});}
 assert.equal(f.get(task.id).task.status,'failed');assert.equal(f.get(task.id).task.errorCode,'AI_TIMEOUT');assert.equal(f.poll({status,taskId:task.id,leaseId:dispatch.leaseId,events:[{seq:1,kind:'completed'}]}).ack,0);
});

test('an explicit capability loss still stops a task during scan TTL grace',async t=>{
 const f=await fixture(t),status=f.status(),task=f.send('codex'),dispatch=f.poll().task;
 for(let n=0;n<31;n++){f.advance(10000);f.poll({status,taskId:task.id,leaseId:dispatch.leaseId});}
 status.providers[0]={...status.providers[0],loggedIn:false,executionSupported:false,executionMode:'disabled'};
 const stopped=f.poll({status,taskId:task.id,leaseId:dispatch.leaseId,events:[{seq:1,kind:'completed'}]});assert.equal(stopped.ack,0);assert.equal(f.get(task.id).task.errorCode,'AI_LOGIN_REQUIRED');
});
