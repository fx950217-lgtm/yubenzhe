import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
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
 const poll=(extra={},d=device)=>modules.aiChannel.poll(d.token,{connectorId:d.connectorId,capacity:3,status:{decisionProtocolVersion:1,code:'ready',workspaceLabel:'本机测试',providers,scannedAt:time},...extra});poll();poll({},foreignDevice);
 const route='group-device-ai/groups/'+conversationId+'/roster',get=(user=a)=>call(user,'GET',route),save=(members,{user=a,version=get().version,requestId=randomUUID()}={})=>call(user,'POST',route,{members,version,requestId});
 const row=(provider='codex',alias='选品顾问')=>({deviceId:device.deviceId,provider,alias});
 const create=(extra={},user=a)=>call(user,'POST','group-device-ai',{conversationId,deviceId:device.deviceId,providers:['codex'],goal:'PRIVATE-ROSTER-GOAL',requestId:randomUUID(),approveSharing:true,...extra}).session;
 const next=s=>call(a,'POST','group-device-ai/'+s.id+'/next',{requestId:randomUUID(),round:s.round,approveExecution:true}).session;
 const detail=(s,user=a)=>call(user,'GET','group-device-ai/'+s.id).session;
 const complete=(task,text)=>poll({taskId:task.id,leaseId:task.leaseId,events:[{seq:1,kind:'message',itemId:'reply',text},{seq:2,kind:'completed'}]});
 call(a,'POST','group-device-ai/groups/'+conversationId,{allowDeviceAI:true});
 return {database,modules,call,a,b,outsider,device,foreignDevice,conversationId,group,get,save,row,create,next,detail,poll,complete,advance:ms=>time+=ms};
}

const pauseEvent=()=>{const value={question:'需要你决定导出格式',options:[{id:'option-1',label:'导出表格',instruction:'导出为表格文件'},{id:'option-2',label:'导出文本',instruction:'导出为文本文件'}]};return {seq:1,kind:'decision',...value,decisionDigest:createHash('sha256').update(JSON.stringify(value)).digest('hex')};};
const pause=f=>{f.save([f.row()]);const s=f.next(f.create()),task=f.poll().task;f.poll({taskId:task.id,leaseId:task.leaseId,events:[pauseEvent()]});return {s:f.detail(s),task};};
const choose=(f,task,user=f.a)=>{const d=f.call(f.a,'GET','ai-channel/tasks/'+task.id).task.decision;return f.call(user,'POST','ai-channel/tasks/'+task.id+'/decision',{requestId:randomUUID(),decisionId:d.id,version:d.version,optionId:'option-1',approveExecution:true});};

test('group discussion waits safely without viewer heartbeat; only its owner sees actionable decision then same round publishes child result',async t=>{
 const f=await fixture(t),{s,task}=pause(f);assert.equal(s.status,'awaiting-decision');assert.equal(s.decisions[0].taskId,task.id);assert.equal(s.decisions[0].canDecide,true);const member=f.detail(s,f.b).decisions[0];assert.equal(member.canDecide,false);assert.equal(Object.hasOwn(member,'taskId'),false);assert.equal(member.decision.question,'需要你决定导出格式');
 f.advance(20000);f.poll();await f.modules.tick();assert.equal(f.detail(s).status,'awaiting-decision');assert.throws(()=>choose(f,task,f.b),error('AI_TASK_NOT_FOUND'));
 const selected=choose(f,task);assert.equal(selected.task.status,'queued');assert.equal(f.detail(s).status,'running');const child=f.poll().task;assert.equal(child.parentTaskId,task.id);f.complete(child,'最终已导出成果');const result=f.detail(s);assert.equal(result.round,1);assert.equal(result.status,'ready');assert.equal(result.replies.length,1);assert.equal(result.replies[0].text,'最终已导出成果');assert.equal(f.database.raw.prepare("SELECT count(*) n FROM messages WHERE provider<>''").get().n,1);
});
test('group stop, permission loss and roster revocation reject a waiting decision before any child is created',async t=>{
 for(const change of ['stop','disable','transfer','remove-roster','leave']){const f=await fixture(t),{s,task}=pause(f);
  if(change==='stop')f.call(f.a,'POST','group-device-ai/'+s.id+'/stop',{});
  if(change==='disable')f.call(f.a,'POST','group-device-ai/groups/'+f.conversationId,{allowDeviceAI:false});
  if(change==='transfer')await f.call(f.a,'POST','conversations/'+f.conversationId+'/owner',{userId:f.b.profile.userId});
  if(change==='remove-roster')f.save([]);
  if(change==='leave')f.database.raw.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND account_id=?').run(f.conversationId,f.modules.social.authenticate(f.a.token).id);
  assert.throws(()=>choose(f,task));assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,1);assert.equal(f.poll().task,null);
 }
});
test('group decision timeout stops the discussion and leaves expired decision suspended rather than auto executing',async t=>{
 const f=await fixture(t),{s,task}=pause(f);f.advance(1800000);f.poll();await f.modules.tick();assert.equal(f.detail(s).status,'stopped');assert.equal(f.call(f.a,'GET','ai-channel/tasks/'+task.id).task.decision.status,'suspended');assert.throws(()=>choose(f,task));assert.equal(f.database.raw.prepare('SELECT count(*) n FROM ai_channel_tasks').get().n,1);
 for(const user of [f.a,f.b]){const decision=f.detail(s,user).decisions[0].decision;assert.equal(decision.question,undefined);assert.equal(decision.options,undefined);assert.equal(decision.available,false);}
});
test('leaving and rejoining still prevents reading a decision raised by a prejoin group task',async t=>{
 const f=await fixture(t);f.save([f.row()]);const s=f.next(f.create()),task=f.poll().task;await f.call(f.a,'POST','conversations/'+f.conversationId+'/remove-member',{userId:f.b.profile.userId});await f.call(f.a,'POST','conversations/'+f.conversationId+'/invite',{memberIds:[f.b.profile.userId]});f.poll({taskId:task.id,leaseId:task.leaseId,events:[pauseEvent()]});assert.throws(()=>f.detail(s,f.b),error('GROUP_AI_NOT_FOUND'));assert.equal(f.detail(s).decisions.length,1);
});
