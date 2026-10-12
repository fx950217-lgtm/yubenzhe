import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createSocialService} from '../server/social-service.mjs';
import {createPersonalDevices} from '../server/personal-devices.mjs';
import {createAIChannel} from '../server/ai-channel.mjs';
const error=code=>e=>e.code===code,digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const proposal=()=>({question:'PRIVATE-DECISION-QUESTION',options:[{id:'option-1',label:'PRIVATE-LABEL-ONE',instruction:'PRIVATE-INSTRUCTION-ONE'},{id:'option-2',label:'PRIVATE-LABEL-TWO',instruction:'PRIVATE-INSTRUCTION-TWO'}]});
const event=(value=proposal(),seq=1)=>({seq,kind:'decision',...value,decisionDigest:digest(value)});
async function fixture(t){
 let time=Date.UTC(2026,9,12),channel;const database=openSocialDatabase(':memory:'),social=createSocialService({database,now:()=>time}),register=()=>social.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip:randomUUID()}),owner=await register(),other=await register();
 const devices=createPersonalDevices({database,socialService:social,now:()=>time,onDeviceRevoked:id=>channel?.revokeDevice(id)}),pair=devices.handle({method:'POST',path:'devices/pair',token:owner.token,input:{name:'决策测试电脑'}}),device=devices.enroll({pairToken:pair.pairToken}),connectorId=randomUUID();
 channel=createAIChannel({database,socialService:social,devices,now:()=>time});t.after(()=>database.close());
 const poll=(input={})=>channel.poll(device.token,{connectorId,status:{decisionProtocolVersion:1,code:'ready',workspaceLabel:'决策测试目录',provider:'Codex'},...input}),call=(method,path,input={},user=owner)=>channel.handle({method,path:'ai-channel/'+path,input,token:user.token}),send=(input={})=>call('POST','send',{deviceId:device.deviceId,requestId:randomUUID(),prompt:'PRIVATE-PARENT-PROMPT',...input}).task,get=id=>call('GET','tasks/'+id).task;
 const decide=(task,extra={},user=owner)=>{const d=get(task.id).decision;return call('POST','tasks/'+task.id+'/decision',{requestId:randomUUID(),decisionId:d.id,version:d.version,optionId:'option-1',approveExecution:true,...extra},user);};
 const pause=(extra={})=>{const task=send(extra),dispatched=poll().task;poll({taskId:task.id,leaseId:dispatched.leaseId,events:[event()]});return get(task.id);};poll();return {database,social,devices,channel,owner,other,device,poll,call,send,get,decide,pause,now:()=>time,advance:ms=>time+=ms};
}
test('structured decision ends only the segment and nothing resumes until its human owner explicitly approves',async t=>{
 const f=await fixture(t),task=f.pause();assert.equal(task.status,'awaiting-decision');assert.equal(task.decision.available,true);assert.equal(task.decision.options.length,2);assert.equal(f.poll().task,null);assert.equal(f.channel.decisionAvailable(task.decision.id),true);
 assert.equal(f.database.raw.prepare('SELECT status FROM ai_channel_tasks WHERE id=?').get(task.id).status,'succeeded');
 const result=f.decide(task),child=result.task;assert.equal(child.status,'queued');assert.equal(result.decision.status,'continued');assert.equal(child.parentTaskId,task.id);assert.equal(child.workspaceTaskId,task.id);assert.match(child.prompt,/PRIVATE-PARENT-PROMPT/);assert.match(child.prompt,/PRIVATE-INSTRUCTION-ONE/);assert.doesNotMatch(child.prompt,/PRIVATE-INSTRUCTION-TWO/);
 const dispatched=f.poll().task;assert.equal(dispatched.id,child.id);assert.equal(dispatched.parentTaskId,task.id);assert.equal(dispatched.workspaceTaskId,task.id);assert.equal(dispatched.decisionDigest,task.decision.digest);assert.deepEqual(dispatched.attachments,[]);
 f.poll({taskId:child.id,leaseId:dispatched.leaseId,events:[{seq:1,kind:'message',itemId:'out',text:'child output'},{seq:2,kind:'completed'}]});assert.equal(f.get(child.id).status,'succeeded');
});
test('decision proposals never persist questions, labels, instructions, prompts or reply keys in SQL',async t=>{
 const f=await fixture(t),task=f.pause({replyPublicKey:'B'.repeat(64)});f.decide(task);
 for(const {name}of f.database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all())assert.doesNotMatch(JSON.stringify(f.database.raw.prepare('SELECT * FROM '+name).all()),/PRIVATE-|BBBBBBBBBBBBBBBB/);
 const d=f.database.raw.prepare('SELECT * FROM ai_task_decisions').get();assert.equal(d.selected_option_id,'option-1');assert.equal(d.selected_by,f.social.authenticate(f.owner.token).id);assert.equal(d.state,'continued');
 const dispatched=f.poll().task;assert.equal(dispatched.replyPublicKey,'B'.repeat(64));
});
test('multi-device clicks and lost responses produce one continuation; same command can only reread its exact result',async t=>{
 const f=await fixture(t),task=f.pause(),requestId=randomUUID(),first=f.decide(task,{requestId}),d=task.decision;
 const payload={requestId,decisionId:d.id,version:d.version,optionId:'option-1',approveExecution:true};assert.equal(f.call('POST','tasks/'+task.id+'/decision',payload).task.id,first.task.id);
 assert.throws(()=>f.decide(task),error('AI_DECISION_HANDLED'));assert.throws(()=>f.call('POST','tasks/'+task.id+'/decision',{...payload,optionId:'option-2'}),error('AI_DECISION_HANDLED'));
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,2);
});
test('a decision rejects another account, missing approval, stale version, unknown options and client-controlled task ancestry',async t=>{
 const f=await fixture(t),task=f.pause();assert.throws(()=>f.decide(task,{},f.other),error('AI_TASK_NOT_FOUND'));
 for(const extra of [{approveExecution:false},{version:2},{optionId:'option-4'},{parentTaskId:randomUUID()},{workspaceTaskId:task.id},{cwd:'C:/outside'},{decisionId:randomUUID()}])assert.throws(()=>f.decide(task,extra));
 for(const field of ['parentTaskId','workspaceTaskId','parentDecisionId','decisionDigest'])assert.throws(()=>f.send({[field]:randomUUID()}),error('INVALID_FIELDS'));
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,1);assert.equal(f.get(task.id).decision.status,'pending');
});
test('30-minute timeout suspends a decision without auto-execution, even with fresh device heartbeats',async t=>{
 const f=await fixture(t),task=f.pause();f.advance(1800000);f.poll();assert.equal(f.get(task.id).status,'suspended');assert.equal(f.channel.decisionAvailable(task.decision.id),false);assert.throws(()=>f.decide(task),error('AI_DECISION_UNAVAILABLE'));assert.equal(f.poll().task,null);
});
test('restart loses proposal text and suspends pending choice permanently without reconstructing or resending',async t=>{
 const f=await fixture(t),task=f.pause(),replacement=createAIChannel({database:f.database,socialService:f.social,devices:f.devices,now:f.now});replacement.restart();
 const result=replacement.handle({method:'GET',path:'ai-channel/tasks/'+task.id,token:f.owner.token});assert.equal(result.task.status,'suspended');assert.equal(result.task.decision.available,false);assert.equal(result.task.decision.question,undefined);assert.deepEqual(result.events,[]);
 assert.throws(()=>replacement.handle({method:'POST',path:'ai-channel/tasks/'+task.id+'/decision',token:f.owner.token,input:{requestId:randomUUID(),decisionId:task.decision.id,version:task.decision.version,optionId:'option-1',approveExecution:true}}),error('AI_DECISION_UNAVAILABLE'));
});
test('provider unavailable or offline leaves human choice pending and never silently changes the provider',async t=>{
 const f=await fixture(t),task=f.pause();f.poll({status:{decisionProtocolVersion:1,code:'login-required',workspaceLabel:'本机测试',provider:'Codex'}});assert.throws(()=>f.decide(task),error('AI_LOGIN_REQUIRED'));assert.equal(f.get(task.id).decision.status,'pending');f.advance(20001);assert.throws(()=>f.decide(task),error('AI_DEVICE_OFFLINE'));assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,1);
});
test('device revocation and owner cancellation withdraw waiting choices and late events cannot restore them',async t=>{
 const f=await fixture(t),task=f.pause();f.call('POST','tasks/'+task.id+'/cancel',{requestId:randomUUID()});assert.equal(f.get(task.id).decision.status,'cancelled');assert.throws(()=>f.decide(task),error('AI_DECISION_UNAVAILABLE'));
 const other=f.pause();f.devices.handle({method:'POST',path:'devices/'+f.device.deviceId+'/revoke',input:{},token:f.owner.token});assert.equal(f.get(other.id).decision.status,'cancelled');assert.equal(f.channel.decisionAvailable(other.decision.id),false);
});
test('decision event retries are content-bound and late completed or second decisions cannot turn waiting into automatic continuation',async t=>{
 const f=await fixture(t),task=f.send(),dispatched=f.poll().task,input={taskId:task.id,leaseId:dispatched.leaseId,events:[event()]};assert.equal(f.poll(input).ack,1);assert.equal(f.poll(input).ack,1);
 const changed=proposal();changed.question='changed';assert.throws(()=>f.poll({...input,events:[event(changed)]}),error('AI_EVENT_CONFLICT'));
 assert.equal(f.poll({...input,events:[{seq:2,kind:'completed'}]}).ack,1);assert.equal(f.poll({...input,events:[event(proposal(),2)]}).ack,1);assert.equal(f.get(task.id).status,'awaiting-decision');assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_task_decisions').get().n,1);
});
test('malformed or forged structured proposals are rejected before event sequence or durable state changes',async t=>{
 const f=await fixture(t),task=f.send(),dispatched=f.poll().task;
 for(const invalid of [{...event(),decisionDigest:'0'.repeat(64)},{...event(),code:'AI_DECISION_REQUIRED'},{...event(),text:'mixed'},{...event(),question:' question '},event({...proposal(),options:[{...proposal().options[0],id:'execute secret command'},proposal().options[1]]}),event({...proposal(),options:[proposal().options[0]]}),event({...proposal(),extra:'unknown'})])assert.throws(()=>f.poll({taskId:task.id,leaseId:dispatched.leaseId,events:[invalid]}));
 assert.equal(f.get(task.id).latestSeq,0);assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_task_decisions').get().n,0);
});
test('decision persistence and human continuation are each atomic under injected SQL failures',async t=>{
 const f=await fixture(t),task=f.send(),dispatched=f.poll().task,input={taskId:task.id,leaseId:dispatched.leaseId,events:[event()]};
 f.database.raw.exec("CREATE TRIGGER fail_decision BEFORE INSERT ON ai_task_decisions BEGIN SELECT RAISE(ABORT,'decision fixture');END;");assert.throws(()=>f.poll(input),/decision fixture/);assert.equal(f.get(task.id).latestSeq,0);assert.equal(f.get(task.id).decision,undefined);f.database.raw.exec('DROP TRIGGER fail_decision');f.poll(input);
 const paused=f.get(task.id),requestId=randomUUID();f.database.raw.exec("CREATE TRIGGER fail_selection BEFORE UPDATE OF state ON ai_task_decisions WHEN NEW.state='continued' BEGIN SELECT RAISE(ABORT,'selection fixture');END;");assert.throws(()=>f.decide(paused,{requestId}),/selection fixture/);assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,1);assert.equal(f.get(task.id).decision.status,'pending');f.database.raw.exec('DROP TRIGGER fail_selection');assert.equal(f.decide(paused,{requestId}).task.status,'queued');
});
test('continuation overflow refuses execution without truncating original authorization or consuming a decision',async t=>{
 const f=await fixture(t),task=f.pause({prompt:'x'.repeat(7900)});assert.throws(()=>f.decide(task),error('AI_DECISION_PROMPT_LIMIT'));assert.equal(f.get(task.id).decision.status,'pending');assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,1);
});
test('multi-stage decisions keep one trusted root and internal cancellation reaches the active descendant',async t=>{
 const f=await fixture(t),first=f.pause(),second=f.decide(first).task,dispatched=f.poll().task;f.poll({taskId:second.id,leaseId:dispatched.leaseId,events:[event()]});const third=f.decide(f.get(second.id)).task;
 assert.equal(third.workspaceTaskId,first.id);assert.equal(third.parentTaskId,second.id);assert.equal(f.channel.readInternalTask(first.id).task.id,third.id);f.channel.cancelInternalTask(first.id,f.social.authenticate(f.owner.token).id);assert.equal(f.get(third.id).status,'cancelled');assert.equal(f.poll().task,null);
});

test('old connectors cannot submit decisions or approve continuations and protocol downgrade never dispatches a queued child',async t=>{
 const f=await fixture(t),oldStatus={code:'ready',workspaceLabel:'旧版连接器',provider:'Codex'},task=f.send(),dispatched=f.poll().task;
 assert.throws(()=>f.poll({status:oldStatus,taskId:task.id,leaseId:dispatched.leaseId,events:[event()]}),error('AI_DECISION_UNSUPPORTED'));assert.equal(f.get(task.id).latestSeq,0);
 f.poll({taskId:task.id,leaseId:dispatched.leaseId,events:[event()]});f.poll({status:oldStatus});assert.equal(f.get(task.id).decision.continuationSupported,false);assert.throws(()=>f.decide(f.get(task.id)),error('AI_DECISION_UNSUPPORTED'));
 f.poll();const child=f.decide(f.get(task.id)).task;assert.equal(f.poll({status:oldStatus}).task,null);assert.equal(f.get(child.id).status,'failed');assert.equal(f.get(child.id).errorCode,'AI_DECISION_UNSUPPORTED');
});

test('running continuation loses its lease if the connector downgrades the decision protocol mid-execution',async t=>{
 const f=await fixture(t),first=f.pause(),child=f.decide(first).task,dispatched=f.poll().task;
 const result=f.poll({status:{code:'ready',workspaceLabel:'旧版连接器',provider:'Codex'},taskId:child.id,leaseId:dispatched.leaseId,events:[{seq:1,kind:'completed'}]});assert.equal(result.ack,0);assert.equal(result.cancelTaskId,child.id);assert.equal(f.get(child.id).errorCode,'AI_DECISION_UNSUPPORTED');
});

test('global output-memory pressure suspends an evicted proposal instead of reconstructing or executing it',async t=>{
 const f=await fixture(t),waiting=f.pause();
 for(let n=0;n<35;n++){const task=f.send({prompt:'bounded-memory-input '+('x'.repeat(7700))}),dispatched=f.poll().task;f.poll({taskId:task.id,leaseId:dispatched.leaseId,events:[...[1,2,3,4].map(seq=>({seq,kind:'message',itemId:'large-'+seq,text:'x'.repeat(16000)})),{seq:5,kind:'completed'}]});}
 const task=f.get(waiting.id);assert.equal(task.status,'suspended');assert.equal(task.decision.available,false);assert.equal(task.decision.question,undefined);assert.throws(()=>f.decide(task),error('AI_DECISION_UNAVAILABLE'));assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks WHERE parent_task_id IS NOT NULL').get().n,0);
});
