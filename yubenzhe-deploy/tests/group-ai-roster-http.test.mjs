import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {passwordRecord} from '../server/auth.mjs';

test('real HTTP roster CAS, private routing and owner-attributed AI publication work with two product accounts',async t=>{
 const origin='http://127.0.0.1:18800',database=openSocialDatabase(':memory:'),modules=createProductModules({database,origin,simulation:true});
 const register=()=>modules.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip:randomUUID()}),a=await register(),b=await register();
 const server=createAcceptanceServer({role:'frontend',origin,authConfig:await passwordRecord('preview','Roster-test-only-728361'),socialService:{devices:modules.devices,aiChannel:modules.aiChannel,handle:r=>modules.handle(r)},staticRoot:fileURLToPath(new URL('../public/frontend',import.meta.url))});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
 const request=(user,path,input,extra={})=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/api/social/'+path,method:input===undefined?'GET':'POST',headers:{Host:'127.0.0.1:18800',Authorization:'Bearer '+(user?.token||''),...(input===undefined?{}:{Origin:origin,'Content-Type':'application/json'}),...extra}},res=>{let data='';res.on('data',chunk=>data+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});req.on('error',reject);req.end(input===undefined?undefined:JSON.stringify(input));});
 const friend=await request(a,'friends/request',{userId:b.profile.userId});assert.equal(friend.status,200);assert.equal((await request(b,'friends/respond',{requestId:friend.body.requestId,accept:true})).status,200);
 const group=await request(a,'groups',{name:'HTTP 名单群',memberIds:[b.profile.userId],requestId:randomUUID()});assert.equal(group.status,200);const cid=group.body.conversationId,route='group-device-ai/groups/'+cid;
 const pair=await request(a,'devices/pair',{name:'本人电脑'}),device=modules.devices.enroll({pairToken:pair.body.pairToken}),connectorId=randomUUID();
 const poll=extra=>modules.aiChannel.poll(device.token,{connectorId,capacity:3,status:{code:'ready',workspaceLabel:'名单本地协议测试',scannedAt:Date.now(),providers:[{id:'codex',name:'Codex',installed:true,loggedIn:true,version:'1.2.3',reason:'',executionSupported:true,executionMode:'tools'}]},...extra});poll();
 assert.equal((await request(a,route,{allowDeviceAI:true})).status,200);const payload={requestId:randomUUID(),version:0,members:[{deviceId:device.deviceId,provider:'codex',alias:'产品顾问'}]};
 assert.equal((await request(null,route+'/roster')).status,401);assert.equal((await request(b,route+'/roster',payload)).status,403);assert.equal((await request(a,route+'/roster',payload,{Origin:'https://foreign.invalid'})).status,403);
 const competing=await Promise.all([request(a,route+'/roster',payload),request(a,route+'/roster',{...payload,requestId:randomUUID()})]);assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
 const ownerRoster=await request(a,route+'/roster'),memberRoster=await request(b,route+'/roster');assert.equal(ownerRoster.body.members[0].deviceId,device.deviceId);assert.equal(memberRoster.body.members[0].canChat,false);assert.equal(Object.hasOwn(memberRoster.body.members[0],'deviceId'),false);
 const create={conversationId:cid,rosterIds:[ownerRoster.body.members[0].id],goal:'HTTP-PRIVATE-GROUP-GOAL',requestId:randomUUID(),approveSharing:true};assert.equal((await request(b,'group-device-ai',create)).status,403);
 const started=await request(a,'group-device-ai',create);assert.equal(started.status,200);const sid=started.body.session.id;
 assert.equal((await request(a,'group-device-ai/'+sid+'/next',{requestId:randomUUID(),round:0,approveExecution:true})).status,200);const task=poll().task;poll({taskId:task.id,leaseId:task.leaseId,events:[{seq:1,kind:'message',itemId:'reply',text:'HTTP-PRIVATE-ROSTER-ANSWER'},{seq:2,kind:'completed'}]});await modules.tick();
 for(const user of [a,b]){const messages=await request(user,'conversations/'+cid+'/messages'),reply=messages.body.messages.find(m=>m.deviceAI);assert.equal(reply.deviceAI.alias,'产品顾问');assert.equal(reply.senderId,a.profile.userId);assert.equal(reply.deviceAI.canChat,user===a);assert.equal(Object.hasOwn(reply.deviceAI,'deviceId'),user===a);assert.equal(reply.text,'HTTP-PRIVATE-ROSTER-ANSWER');}
 assert.equal((await request(b,'ai-channel/devices/'+device.deviceId)).status,404);
 for(const table of ['messages','conversation_ai_roster','conversation_ai_roster_commands','device_ai_sessions','device_ai_rounds','ai_channel_tasks','ai_channel_event_hashes'])assert.doesNotMatch(JSON.stringify(database.raw.prepare('SELECT * FROM '+table).all()),/HTTP-PRIVATE-GROUP-GOAL|HTTP-PRIVATE-ROSTER-ANSWER/);
});
