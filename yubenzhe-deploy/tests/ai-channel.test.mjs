import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createSocialService} from '../server/social-service.mjs';
import {createPersonalDevices} from '../server/personal-devices.mjs';
import {createAIChannel,AI_CHANNEL_LIMITS} from '../server/ai-channel.mjs';

const error=code=>value=>value.code===code;
async function fixture(t){
 let time=Date.UTC(2026,9,12),channel;
 const database=openSocialDatabase(':memory:'),social=createSocialService({database,now:()=>time});
 const register=()=>social.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip:randomUUID()});
 const owner=await register(),other=await register();
 const devices=createPersonalDevices({database,socialService:social,now:()=>time,onDeviceRevoked:id=>channel?.revokeDevice(id)});
 const paired=devices.handle({method:'POST',path:'devices/pair',token:owner.token,input:{name:'测试电脑'}}),device=devices.enroll({pairToken:paired.pairToken});
 channel=createAIChannel({database,socialService:social,devices,now:()=>time});
 t.after(()=>database.close());
 const connectorId=randomUUID(),status={code:'ready',workspaceLabel:'YBZ 工作区',provider:'Codex'};
 const poll=(input={},token=device.token)=>channel.poll(token,{connectorId,status,...input});
 const call=(method,path,input={},user=owner,query={})=>channel.handle({method,path:'ai-channel/'+path,input,token:user.token,query});
 const send=(prompt='只回答：测试通道',extra={})=>call('POST','send',{deviceId:device.deviceId,prompt,requestId:randomUUID(),...extra}).task;
 const get=(id,after=0,user=owner)=>call('GET','tasks/'+id,{},user,{after});
 const cancel=(id,requestId=randomUUID())=>call('POST','tasks/'+id+'/cancel',{requestId}).task;
 const lease=task=>({taskId:task.id,leaseId:task.leaseId});
 poll();
 return {database,social,devices,channel,owner,other,device,connectorId,status,poll,call,send,get,cancel,lease,advance(ms){time+=ms;},now:()=>time};
}

test('owner sends real queued task, connector consumes one lease, events stream and content never reaches SQLite',async t=>{
 const f=await fixture(t),task=f.send('UNIQUE-PROMPT-CONTENT');assert.equal(task.status,'queued');
 const first=f.poll();assert.equal(first.task.id,task.id);assert.equal(first.task.prompt,'UNIQUE-PROMPT-CONTENT');assert.equal(first.expiresAt-first.serverNow,15000);assert.equal(first.task.expiresAt-first.serverNow,600000);
 let reply=f.poll({...f.lease(first.task),events:[{seq:1,kind:'message',itemId:'reply-1',text:'UNIQUE-MODEL-CONTENT'}]});assert.equal(reply.ack,1);assert.equal(reply.task,null);
 reply=f.poll({...f.lease(first.task),events:[{seq:2,kind:'completed'}]});assert.equal(reply.ack,2);assert.equal(reply.cancelTaskId,task.id);
 const result=f.get(task.id);assert.equal(result.task.status,'succeeded');assert.equal(result.events[0].text,'UNIQUE-MODEL-CONTENT');
 const tables=f.database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_channel_%'").all();
 for(const {name}of tables){const stored=JSON.stringify(f.database.raw.prepare('SELECT * FROM '+name).all());assert.equal(stored.includes('UNIQUE-PROMPT-CONTENT'),false);assert.equal(stored.includes('UNIQUE-MODEL-CONTENT'),false);assert.equal(stored.includes(f.device.token),false);}
});

test('same request is durable-idempotent before dispatch and after unknown result; changed prompt cannot reuse key',async t=>{
 const f=await fixture(t),requestId=randomUUID(),task=f.send('原始内容',{requestId});assert.equal(f.send('原始内容',{requestId}).id,task.id);
 assert.throws(()=>f.send('不同内容',{requestId}),error('IDEMPOTENCY_CONFLICT'));
 f.poll();f.advance(15001);f.channel.maintain();assert.equal(f.get(task.id).task.errorCode,'AI_EXECUTION_INTERRUPTED');
 assert.equal(f.send('原始内容',{requestId}).status,'failed');assert.equal(f.poll().task,null);
});

test('lost first dispatch response never re-dispatches prompt, and concurrent connector cannot steal running task',async t=>{
 const f=await fixture(t),task=f.send(),first=f.poll();assert.equal(first.task.id,task.id);
 assert.equal(f.poll().task,null);assert.throws(()=>f.poll({connectorId:randomUUID()}),error('AI_CONNECTOR_BUSY'));
 f.advance(15001);const next=f.poll();assert.equal(next.task,null);assert.equal(f.get(task.id).task.status,'failed');
});

test('five queued tasks and one executing task are maximum, with no bypass via a second product account',async t=>{
 const f=await fixture(t);f.send();f.poll();for(let n=0;n<5;n++)f.send();assert.throws(()=>f.send(),error('AI_QUEUE_FULL'));
 assert.throws(()=>f.call('POST','send',{deviceId:f.device.deviceId,prompt:'not mine',requestId:randomUUID()},f.other),error('DEVICE_NOT_FOUND'));
 const listed=f.call('GET','devices/'+f.device.deviceId);assert.equal(listed.tasks.length,6);
});

test('repeated events are acknowledged once, altered duplicates and sequence holes are rejected atomically',async t=>{
 const f=await fixture(t),task=f.send(),dispatch=f.poll().task,event={seq:1,kind:'message',itemId:'first',text:'first reply'};
 assert.throws(()=>f.poll({...f.lease(dispatch),events:[event,{seq:3,kind:'progress',text:'gap'}]}),error('AI_EVENT_SEQUENCE'));
 assert.equal(f.get(task.id).latestSeq,0);assert.deepEqual(f.get(task.id).events,[]);
 assert.equal(f.poll({...f.lease(dispatch),events:[event]}).ack,1);assert.equal(f.poll({...f.lease(dispatch),events:[event]}).ack,1);
 assert.throws(()=>f.poll({...f.lease(dispatch),events:[{...event,text:'changed'}]}),error('AI_EVENT_CONFLICT'));
 assert.equal(f.get(task.id).events.length,1);
});

test('invalid lease cannot replace the advertised device file key or heartbeat metadata',async t=>{
 const f=await fixture(t),originalKey='A'.repeat(64),replacementKey='B'.repeat(64);
 f.poll({status:{...f.status,filePublicKey:originalKey}});f.send();f.poll();
 assert.throws(()=>f.poll({taskId:randomUUID(),leaseId:randomUUID(),status:{...f.status,workspaceLabel:'另一个标签',filePublicKey:replacementKey}}),error('AI_LEASE_DENIED'));
 const state=f.call('GET','devices/'+f.device.deviceId).device;assert.equal(state.filePublicKey,originalKey);assert.equal(state.workspaceLabel,f.status.workspaceLabel);
});

test('event and output buffers are bounded and report truncated synchronization correctly',async t=>{
 const f=await fixture(t),task=f.send(),dispatch=f.poll().task;
 for(let seq=1;seq<=70;seq++)f.poll({...f.lease(dispatch),events:[{seq,kind:'message',itemId:'item-'+seq,text:'x'.repeat(1000)}]});
 const result=f.get(task.id);assert.equal(result.events.length,50);assert.equal(result.events[0].seq,21);assert.equal(result.latestSeq,70);assert.equal(result.truncated,true);
 assert.equal(f.get(task.id,69).events.length,1);assert.equal(f.get(task.id,69).truncated,false);
 for(let seq=71;seq<=90;seq++){const reply=f.poll({...f.lease(dispatch),events:[{seq,kind:'message',itemId:'large-'+seq,text:'x'.repeat(16000)}]});if(reply.cancelTaskId)break;}
 assert.equal(f.get(task.id).task.errorCode,'AI_OUTPUT_LIMIT');assert.ok(f.get(task.id).events.reduce((n,e)=>n+(e.text?.length||0),0)<=64000);
});

test('cancel is idempotent, returns stop instruction, and late model completion cannot revive the task',async t=>{
 const f=await fixture(t),task=f.send(),dispatch=f.poll().task,cancelId=randomUUID();assert.equal(f.cancel(task.id,cancelId).status,'cancelled');assert.equal(f.cancel(task.id,cancelId).status,'cancelled');
 const reply=f.poll({...f.lease(dispatch),events:[{seq:1,kind:'completed'}]});assert.equal(reply.cancelTaskId,task.id);assert.equal(reply.ack,0);assert.equal(f.get(task.id).task.status,'cancelled');
});

test('hard execution limit cannot be prolonged by heartbeat, and late event cannot convert timeout to success',async t=>{
 const f=await fixture(t),task=f.send(),dispatch=f.poll().task;
 for(let n=0;n<60;n++){f.advance(10000);f.poll({...f.lease(dispatch)});}
 const value=f.get(task.id).task;assert.equal(value.status,'failed');assert.equal(value.errorCode,'AI_TIMEOUT');
 f.poll({...f.lease(dispatch),events:[{seq:1,kind:'completed'}]});assert.equal(f.get(task.id).task.errorCode,'AI_TIMEOUT');
});

test('device revoke immediately stops pending tasks and all subsequent agent or file authorization',async t=>{
 const f=await fixture(t),task=f.send(),dispatch=f.poll().task;
 assert.equal(f.channel.authorizeAgent(f.device.token,f.lease(dispatch)).taskId,task.id);
 f.devices.handle({method:'POST',path:'devices/'+f.device.deviceId+'/revoke',token:f.owner.token,input:{}});
 assert.equal(f.get(task.id).task.status,'cancelled');assert.equal(f.get(task.id).task.outputAvailable,false);
 assert.throws(()=>f.poll({...f.lease(dispatch)}),error('DEVICE_AUTH_REQUIRED'));
 assert.throws(()=>f.channel.authorizeAgent(f.device.token,f.lease(dispatch)),error('DEVICE_AUTH_REQUIRED'));
});

test('disabled or deleted product owners cannot use device credentials despite a retained token hash',async t=>{
 for(const kind of ['restricted','deleted']){
  const f=await fixture(t),owner=f.social.authenticate(f.owner.token);f.send();f.poll();
  if(kind==='deleted')f.database.raw.prepare('UPDATE accounts SET deleted_at=? WHERE id=?').run(f.now(),owner.id);
  else f.database.raw.prepare("INSERT INTO account_restrictions(account_id,state,reason,updated_at) VALUES(?,'suspended','test',?)").run(owner.id,f.now());
  assert.throws(()=>f.poll(),error('DEVICE_AUTH_REQUIRED'));f.channel.maintain();assert.equal(f.database.raw.prepare('SELECT status FROM ai_channel_tasks').get().status,'cancelled');
 }
});

test('offline, login-required and quota status are distinct and requests never supply cwd, shell, provider or account keys',async t=>{
 const f=await fixture(t);f.poll({status:{...f.status,code:'login-required'}});assert.throws(()=>f.send(),error('AI_LOGIN_REQUIRED'));
 f.poll({status:{...f.status,code:'quota'}});assert.throws(()=>f.send(),error('AI_QUOTA'));
 f.poll();f.advance(20001);assert.throws(()=>f.send(),error('AI_DEVICE_OFFLINE'));f.poll();
 for(const field of ['cwd','shell','provider','apiKey','ownerId'])assert.throws(()=>f.send('请求',{[field]:'forbidden'}),error('INVALID_FIELDS'));
 assert.throws(()=>f.send('x'.repeat(8001)),error('INVALID_TEXT'));
 assert.throws(()=>f.poll({status:{...f.status,workspaceLabel:'C:/private'}}),error('INVALID_AI_STATUS'));
});

test('restart removes plaintext, fails queued/running jobs, retains request hashes and never replays them',async t=>{
 const f=await fixture(t),id=randomUUID(),running=f.send('restart-private',{requestId:id});f.poll();const queued=f.send('queued-private');
 const replacement=createAIChannel({database:f.database,socialService:f.social,devices:f.devices,now:f.now});replacement.restart();
 const detail=replacement.handle({method:'GET',path:'ai-channel/tasks/'+running.id,token:f.owner.token});assert.equal(detail.task.status,'failed');assert.equal(detail.task.outputAvailable,false);assert.equal(detail.task.prompt,undefined);assert.deepEqual(detail.events,[]);
 const duplicate=replacement.handle({method:'POST',path:'ai-channel/send',token:f.owner.token,input:{deviceId:f.device.deviceId,prompt:'restart-private',requestId:id}});assert.equal(duplicate.task.id,running.id);assert.equal(duplicate.task.status,'failed');
 assert.equal(f.database.raw.prepare('SELECT status FROM ai_channel_tasks WHERE id=?').get(queued.id).status,'failed');
});

test('old completed task output expires from RAM and cannot expose data across accounts',async t=>{
 const f=await fixture(t),task=f.send(),dispatch=f.poll().task;f.poll({...f.lease(dispatch),events:[{seq:1,kind:'message',itemId:'reply',text:'expires'},{seq:2,kind:'completed'}]});
 assert.throws(()=>f.get(task.id,0,f.other),error('AI_TASK_NOT_FOUND'));
 f.advance(AI_CHANNEL_LIMITS.retentionMs+1);assert.equal(f.get(task.id).task.outputAvailable,false);assert.deepEqual(f.get(task.id).events,[]);
});
