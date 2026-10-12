import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
const error=code=>e=>e.code===code;
async function fixture(t){
 let time=Date.UTC(2026,9,12);const database=openSocialDatabase(':memory:'),modules=createProductModules({database,origin:'http://localhost:18999',simulation:true,now:()=>time});t.after(()=>database.close());
 const call=(u,method,path,input={},query={})=>modules.handle({token:u?.token||'',method,path,input,query,ip:randomUUID()}),register=()=>call(null,'POST','register',{password:'483192',requestId:randomUUID()});const a=await register(),b=await register(),outsider=await register();
 let request=await call(a,'POST','friends/request',{userId:b.profile.userId});await call(b,'POST','friends/respond',{requestId:request.requestId,accept:true});
 const group=async user=>(await call(user,'POST','groups',{name:'AI 名单测试',memberIds:[(user===a?b:a).profile.userId],requestId:randomUUID()})).conversationId;
 const conversationId=await group(a),providers=['codex','ollama'].map(id=>({id,name:id,installed:true,loggedIn:id==='codex'?true:null,version:'1.2.3',reason:'',executionSupported:true,executionMode:id==='codex'?'tools':'chat-only'}));
 const pair=user=>{const invitation=call(user,'POST','devices/pair',{name:'本人电脑'}),device=modules.devices.enroll({pairToken:invitation.pairToken});return {...device,connectorId:randomUUID()};};
 const device=pair(a),foreignDevice=pair(b);
 const poll=(extra={},d=device)=>modules.aiChannel.poll(d.token,{connectorId:d.connectorId,capacity:3,status:{code:'ready',workspaceLabel:'本机测试',providers,scannedAt:time},...extra});poll();poll({},foreignDevice);
 const route='group-device-ai/groups/'+conversationId+'/roster',get=(user=a)=>call(user,'GET',route),save=(members,{user=a,version=get().version,requestId=randomUUID()}={})=>call(user,'POST',route,{members,version,requestId});
 const row=(provider='codex',alias='选品顾问')=>({deviceId:device.deviceId,provider,alias});
 const create=(extra={},user=a)=>call(user,'POST','group-device-ai',{conversationId,deviceId:device.deviceId,providers:['codex'],goal:'PRIVATE-ROSTER-GOAL',requestId:randomUUID(),approveSharing:true,...extra}).session;
 const next=s=>call(a,'POST','group-device-ai/'+s.id+'/next',{requestId:randomUUID(),round:s.round,approveExecution:true}).session;
 const detail=(s,user=a)=>call(user,'GET','group-device-ai/'+s.id).session;
 const complete=(task,text)=>poll({taskId:task.id,leaseId:task.leaseId,events:[{seq:1,kind:'message',itemId:'reply',text},{seq:2,kind:'completed'}]});
 call(a,'POST','group-device-ai/groups/'+conversationId,{allowDeviceAI:true});
 return {database,modules,call,a,b,outsider,device,foreignDevice,conversationId,group,get,save,row,create,next,detail,poll,complete,advance:ms=>time+=ms};
}

test('AI roster starts empty and never creates accounts, friendships or real group members',async t=>{
 const f=await fixture(t),db=f.database.raw,counts=()=>Object.fromEntries(['accounts','user_ids','friendships','conversation_members'].map(table=>[table,db.prepare('SELECT count(*) n FROM '+table).get().n])),before=counts();
 assert.deepEqual(f.get().members,[]);const result=f.save([f.row(),f.row('ollama','文案助手')]);assert.equal(result.version,1);assert.equal(result.members.length,2);assert.deepEqual(counts(),before);assert.ok(result.members.every(row=>row.kind==='ai'&&row.ownerId===f.a.profile.userId));
});

test('roster and social state expose private chat routes only to device owner',async t=>{
 const f=await fixture(t);f.save([f.row()]);const owner=f.get().members[0],other=f.get(f.b).members[0];assert.equal(owner.deviceId,f.device.deviceId);assert.equal(owner.canChat,true);assert.equal(other.alias,'选品顾问');assert.equal(other.canChat,false);assert.equal(Object.hasOwn(other,'deviceId'),false);
 for(const user of [f.a,f.b]){const state=await f.call(user,'GET','state'),conversation=state.conversations.find(c=>c.id===f.conversationId);assert.equal(conversation.aiMemberCount,1);assert.equal(conversation.aiRosterVersion,1);assert.equal(conversation.aiMembers[0].canChat,user===f.a);assert.equal(Object.hasOwn(conversation.aiMembers[0],'deviceId'),user===f.a);}
 assert.throws(()=>f.get(f.outsider),error('GROUP_AI_NOT_FOUND'));assert.throws(()=>f.call(f.b,'GET','ai-channel/devices/'+f.device.deviceId),error('DEVICE_NOT_FOUND'));
});

test('only group owner can save own devices; neither another member nor another owner device can bypass',async t=>{
 const f=await fixture(t);assert.throws(()=>f.save([{...f.row(),deviceId:f.foreignDevice.deviceId}],{user:f.b,version:0}),error('GROUP_OWNER_REQUIRED'));assert.throws(()=>f.save([{...f.row(),deviceId:f.foreignDevice.deviceId}]),error('DEVICE_NOT_FOUND'));
 const otherGroup=await f.group(f.b);assert.throws(()=>f.call(f.a,'POST','group-device-ai/groups/'+otherGroup+'/roster',{requestId:randomUUID(),version:0,members:[f.row()]}),error('GROUP_OWNER_REQUIRED'));assert.equal(f.get().version,0);
});

test('old P7 create fields cannot bypass roster or group ownership and rosterIds are actually dispatched',async t=>{
 const f=await fixture(t);assert.throws(()=>f.create(),error('GROUP_AI_ROSTER_CHANGED'));f.save([f.row()]);assert.throws(()=>f.create({deviceId:f.foreignDevice.deviceId},f.b),error('GROUP_OWNER_REQUIRED'));assert.throws(()=>f.create({providers:['ollama']}),error('GROUP_AI_ROSTER_CHANGED'));
 const member=f.get().members[0],s=f.create({deviceId:undefined,providers:undefined,rosterIds:[member.id]});assert.equal(f.next(s).status,'running');const task=f.poll().task;assert.equal(task.provider,'codex');assert.equal(f.database.raw.prepare('SELECT roster_id FROM device_ai_rounds').get().roster_id,member.id);
});

test('replace roster is request-idempotent and conflicting multi-device versions permit one save',async t=>{
 const f=await fixture(t),requestId=randomUUID(),members=[f.row()];const first=f.save(members,{requestId,version:0});assert.deepEqual(f.save(members,{requestId,version:0}),first);
 assert.throws(()=>f.save([f.row('codex','已改内容')],{requestId,version:0}),error('IDEMPOTENCY_CONFLICT'));assert.throws(()=>f.save([f.row('ollama')],{version:0}),error('GROUP_AI_ROSTER_CHANGED'));assert.equal(f.get().members.length,1);assert.equal(f.get().version,1);
});

test('alias updates keep roster identity and historic reply aliases while new rounds use the approved new alias',async t=>{
 const f=await fixture(t);f.save([f.row()]);const member=f.get().members[0],s=f.next(f.create());f.save([{id:member.id,...f.row('codex','新的顾问')}]);f.complete(f.poll().task,'PRIVATE-FIRST-ANSWER');let view=f.detail(s);assert.equal(view.replies[0].alias,'选品顾问');view=f.next(view);f.complete(f.poll().task,'PRIVATE-SECOND-ANSWER');assert.equal(f.detail(view).replies[1].alias,'新的顾问');assert.equal(f.get().members[0].id,member.id);
 for(const user of [f.a,f.b]){const result=await f.call(user,'GET','conversations/'+f.conversationId+'/messages'),messages=result.messages.filter(row=>row.deviceAI);assert.equal(messages[0].deviceAI.alias,'选品顾问');assert.equal(messages[1].deviceAI.alias,'新的顾问');assert.equal(messages[0].deviceAI.canChat,user===f.a);assert.equal(Object.hasOwn(messages[0].deviceAI,'deviceId'),user===f.a);}
 const message=f.database.raw.prepare('SELECT message_id FROM device_ai_rounds ORDER BY round').get().message_id;assert.equal(f.modules.groupDeviceAI.describeMessage(message).canChat,false);assert.equal(Object.hasOwn(f.modules.groupDeviceAI.describeMessage(message),'deviceId'),false);
});

test('removal stops current discussion without deleting metadata or resuming after roster re-add',async t=>{
 const f=await fixture(t);f.save([f.row()]);const member=f.get().members[0],s=f.next(f.create()),task=f.poll().task;f.save([]);assert.equal(f.detail(s).status,'stopped');assert.equal(f.database.raw.prepare('SELECT status FROM ai_channel_tasks WHERE id=?').get(task.id).status,'cancelled');assert.notEqual(f.database.raw.prepare('SELECT removed_at FROM conversation_ai_roster WHERE id=?').get(member.id).removed_at,null);
 f.save([f.row()]);assert.equal(f.get().members[0].id,member.id);assert.throws(()=>f.next(s),error('GROUP_AI_ROUND_CHANGED'));
});

test('group ownership transfer stops old authorized session and does not inherit private device rights',async t=>{
 const f=await fixture(t);f.save([f.row()]);const s=f.next(f.create());await f.call(f.a,'POST','conversations/'+f.conversationId+'/owner',{userId:f.b.profile.userId});await f.modules.tick();assert.equal(f.detail(s).status,'stopped');assert.deepEqual(f.get(f.b).members,[]);assert.throws(()=>f.save([f.row()]),error('GROUP_OWNER_REQUIRED'));
 f.save([{...f.row(),deviceId:f.foreignDevice.deviceId}],{user:f.b,version:f.get(f.b).version});assert.equal(f.get(f.b).members[0].ownerId,f.b.profile.userId);assert.equal(f.get().members[0].canChat,false);
});

test('revocation and deletion remove chat authority and preserve every foreign key and historic reply',async t=>{
 const f=await fixture(t);f.save([f.row()]);const s=f.next(f.create());f.complete(f.poll().task,'private-old-reply');f.detail(s);f.call(f.a,'POST','devices/'+f.device.deviceId+'/revoke',{});assert.equal(f.get().members[0].canChat,false);assert.equal(Object.hasOwn(f.get().members[0],'deviceId'),false);
 const owner=f.modules.social.authenticate(f.a.token).id;f.modules.devices.cleanup(owner);assert.deepEqual(f.database.raw.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(f.database.raw.prepare('SELECT device_id FROM conversation_ai_roster').get().device_id,null);
 // Existing task cleanup cascades round rows, but message attribution is immutable.
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM device_ai_rounds').get().n,0);
 const messages=(await f.call(f.a,'GET','conversations/'+f.conversationId+'/messages')).messages,reply=messages.find(row=>row.deviceAI);assert.equal(reply.deviceAI.alias,'选品顾问');assert.equal(reply.deviceAI.canChat,false);assert.equal(Object.hasOwn(reply.deviceAI,'deviceId'),false);assert.equal(reply.text,'private-old-reply');
 assert.equal(f.detail(s).replies[0].alias,'选品顾问');
});

test('transfer away and back between maintenance ticks permanently withdraws earlier AI authorization',async t=>{
 const f=await fixture(t);f.save([f.row()]);const s=f.create();await f.call(f.a,'POST','conversations/'+f.conversationId+'/owner',{userId:f.b.profile.userId});await f.call(f.b,'POST','conversations/'+f.conversationId+'/owner',{userId:f.a.profile.userId});
 // Do not read GET or tick before re-adding: correctness cannot rely on cleanup timing.
 f.save([f.row()],{version:3});assert.equal(f.detail(s).status,'stopped');assert.equal(f.get().version,4);assert.throws(()=>f.next(s),error('GROUP_AI_ROSTER_CHANGED'));assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,0);
});

test('ordinary message clients cannot spoof AI source, alias or private-device attribution',async t=>{
 const f=await fixture(t);f.save([f.row()]);
 for(const extra of [{provider:'codex'},{device_id:f.device.deviceId},{ai_alias:'假顾问'},{ai_session_id:randomUUID()},{deviceAI:{alias:'假顾问',provider:'codex',serverVerified:true,deviceId:f.device.deviceId}}])await assert.rejects(f.call(f.a,'POST','conversations/'+f.conversationId+'/messages',{clientId:randomUUID(),text:'ordinary message',...extra}),error('INVALID_FIELDS'));
 assert.equal(f.database.raw.prepare("SELECT count(*) n FROM messages WHERE provider<>''").get().n,0);
});

test('invalid binding, unknown fields/provider, duplicate or bad aliases never partially replace the roster',async t=>{
 const f=await fixture(t);f.save([f.row()]);const member=f.get().members[0],before=f.get();
 for(const rows of [[f.row(),f.row()],[f.row('unknown')],[{...f.row(),alias:''}],[{...f.row(),alias:'x'.repeat(41)}],[{...f.row(),alias:'bad\nname'}],[{...f.row(),accountId:f.b.profile.userId}],[{id:member.id,...f.row('ollama')}],[{id:randomUUID(),...f.row()}]])assert.throws(()=>f.save(rows));
 assert.throws(()=>f.save([f.row(),f.row(),f.row(),f.row()]),error('GROUP_AI_ROSTER_INPUT'));
 assert.deepEqual(f.get(),before);
});

test('uninstalled AI cannot be made executable by roster metadata and detected adapter gaps stay disabled',async t=>{
 const f=await fixture(t);assert.throws(()=>f.save([f.row('claude')]),error('GROUP_AI_PROVIDER_UNAVAILABLE'));
 f.poll({status:{code:'ready',workspaceLabel:'本机测试',scannedAt:Date.UTC(2026,9,12),providers:[{id:'claude',name:'Claude',installed:true,loggedIn:null,version:'1.2.3',reason:'',executionSupported:false,executionMode:'disabled'}]}});
 f.save([f.row('claude','已装但未接通')]);assert.throws(()=>f.create({providers:['claude']}),error('GROUP_AI_PROVIDER_UNAVAILABLE'));assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,0);
});

test('injected failure in replacement is atomic and retry with same request succeeds once',async t=>{
 const f=await fixture(t),requestId=randomUUID(),members=[f.row(),f.row('ollama','文案助手')];f.database.raw.exec("CREATE TRIGGER fail_roster BEFORE INSERT ON conversation_ai_roster WHEN NEW.provider='ollama' BEGIN SELECT RAISE(ABORT,'roster fixture'); END;");assert.throws(()=>f.save(members,{requestId,version:0}),/roster fixture/);assert.equal(f.get().version,0);assert.equal(f.get().members.length,0);assert.equal(f.database.raw.prepare('SELECT count(*) n FROM conversation_ai_roster_commands').get().n,0);
 f.database.raw.exec('DROP TRIGGER fail_roster');const value=f.save(members,{requestId,version:0});assert.equal(value.version,1);assert.equal(value.members.length,2);assert.deepEqual(f.save(members,{requestId,version:0}),value);
});

test('group roster labels are metadata but prompts and answers remain absent from all durable AI records',async t=>{
 const f=await fixture(t);f.save([f.row()]);const s=f.next(f.create());f.complete(f.poll().task,'PRIVATE-ROSTER-ANSWER');f.detail(s);
 for(const table of ['messages','conversation_ai_roster','conversation_ai_roster_commands','device_ai_sessions','device_ai_rounds','device_ai_commands','ai_channel_tasks','ai_channel_event_hashes'])assert.doesNotMatch(JSON.stringify(f.database.raw.prepare('SELECT * FROM '+table).all()),/PRIVATE-ROSTER-GOAL|PRIVATE-ROSTER-ANSWER/);
 assert.equal(f.database.raw.prepare('SELECT alias_snapshot FROM device_ai_rounds').get().alias_snapshot,'选品顾问');
});
