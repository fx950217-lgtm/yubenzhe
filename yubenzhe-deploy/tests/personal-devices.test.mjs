
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
async function setup(t){
 const db=openSocialDatabase(':memory:');t.after(()=>db.close());let now=Date.now();
 const m=createProductModules({database:db,origin:'http://127.0.0.1:12345',simulation:true,now:()=>now});
 const call=(token,method,path,input={},query={})=>Promise.resolve().then(()=>m.handle({token,method,path,input,query,ip:'127.0.0.1'}));
 const a=await call(null,'POST','register',{password:'429173',requestId:randomUUID()}),b=await call(null,'POST','register',{password:'637291',requestId:randomUUID()});
 const pair=await call(a.token,'POST','devices/pair',{name:'Synthetic PC'}),agent=m.devices.enroll({pairToken:pair.pairToken});
 const start=()=>call(a.token,'POST','devices/'+pair.deviceId+'/start');
 return {db,m,a,b,pair,agent,call,start,advance:ms=>now+=ms};
}
const is=(status,code)=>e=>e.status===status&&(!code||e.code===code);
test('pair token is one-use; owner metadata never exposes device credentials',async t=>{
 const f=await setup(t);assert.throws(()=>f.m.devices.enroll({pairToken:f.pair.pairToken}),is(401));
 const list=await f.call(f.a.token,'GET','devices');assert.equal(list.devices[0].paired,true);assert.equal(JSON.stringify(list).includes(f.agent.token),false);assert.equal(JSON.stringify(list).includes(f.pair.pairToken),false);
 assert.equal((await f.call(f.b.token,'GET','devices')).devices.length,0);
 for(const action of ['start','stop','revoke'])await assert.rejects(f.call(f.b.token,'POST','devices/'+f.pair.deviceId+'/'+action),is(404));
 assert.throws(()=>f.m.devices.poll('x'.repeat(43),{}),is(401));
});
test('commands require active lease, are bounded, and are delivered at most once',async t=>{
 const f=await setup(t),d=(await f.start()).device;
 const input={requestId:randomUUID(),sessionId:d.sessionId,kind:'click',x:0.2,y:0.4};
 const c=await f.call(f.a.token,'POST','devices/'+d.id+'/input',input);
 assert.deepEqual(await f.call(f.a.token,'POST','devices/'+d.id+'/input',input),c);
 await assert.rejects(f.call(f.a.token,'POST','devices/'+d.id+'/input',{...input,x:0.3}),is(409));
 for(const bad of [{...input,requestId:randomUUID(),kind:'shell',text:'arbitrary'},{...input,requestId:randomUUID(),x:2},{...input,requestId:randomUUID(),kind:'key',key:'PowerOff'}])await assert.rejects(f.call(f.a.token,'POST','devices/'+d.id+'/input',bad),is(400));
 const polled=f.m.devices.poll(f.agent.token,{});assert.equal(polled.commands.length,1);assert.equal(polled.commands[0].id,c.commandId);
 assert.equal(f.m.devices.poll(f.agent.token,{}).commands.length,0);
 f.m.devices.poll(f.agent.token,{sessionId:d.sessionId,ack:[{id:c.commandId,status:'done'}]});
 assert.equal((await f.call(f.a.token,'GET','devices/'+d.id+'/state')).commands[0].status,'done');
});
test('stop, lease expiry, revocation and process restart invalidate controls',async t=>{
 const f=await setup(t);let d=(await f.start()).device;
 await f.call(f.a.token,'POST','devices/'+d.id+'/stop');
 await assert.rejects(f.call(f.a.token,'GET','devices/'+d.id+'/frame',{}, {sessionId:d.sessionId}),is(409));
 assert.equal(f.m.devices.poll(f.agent.token,{}).sessionId,null);
 d=(await f.start()).device;f.advance(600001);assert.equal(f.m.devices.poll(f.agent.token,{}).sessionId,null);
 d=(await f.start()).device;f.m.devices.resetSessions();assert.equal(f.m.devices.poll(f.agent.token,{}).sessionId,null);
 await f.start();await f.call(f.a.token,'POST','devices/'+d.id+'/revoke');
 assert.throws(()=>f.m.devices.poll(f.agent.token,{}),is(401));assert.equal((await f.call(f.a.token,'GET','devices')).devices[0].revoked,true);
});
test('local stop works and stale session acknowledgements cannot finish new commands',async t=>{
 const f=await setup(t),old=(await f.start()).device,current=(await f.start()).device;
 const cmd=await f.call(f.a.token,'POST','devices/'+current.id+'/input',{requestId:randomUUID(),sessionId:current.sessionId,kind:'text',text:'Synthetic input'});
 f.m.devices.poll(f.agent.token,{});f.m.devices.poll(f.agent.token,{sessionId:old.sessionId,ack:[{id:cmd.commandId,status:'done'}]});
 assert.equal((await f.call(f.a.token,'GET','devices/'+current.id+'/state')).commands[0].status,'sent');
 assert.equal(f.m.devices.poll(f.agent.token,{localStop:true}).sessionId,null);
});
test('expired pairing and offline start fail; account cleanup removes keys and commands',async t=>{
 const f=await setup(t),p=await f.call(f.a.token,'POST','devices/pair',{name:'Expired pair'});f.advance(600001);
 assert.throws(()=>f.m.devices.enroll({pairToken:p.pairToken}),is(401));
 await assert.rejects(f.start(),is(409,'DEVICE_OFFLINE'));
 f.m.devices.cleanup(f.m.social.authenticate(f.a.token).id);
 assert.throws(()=>f.m.devices.poll(f.agent.token,{}),is(401));
 assert.equal((await f.call(f.a.token,'GET','devices')).devices.length,0);
});

test('viewer heartbeats cannot extend ten-minute maximum and disconnection expires within fifteen seconds',async t=>{
 const f=await setup(t),d=(await f.start()).device;
 assert.equal(f.m.devices.poll(f.agent.token,{}).sessionId,d.sessionId);
 f.advance(10000);await f.call(f.a.token,'POST','devices/'+d.id+'/heartbeat',{sessionId:d.sessionId});
 f.advance(10000);assert.equal(f.m.devices.poll(f.agent.token,{}).sessionId,d.sessionId);
 f.advance(5001);assert.equal(f.m.devices.poll(f.agent.token,{}).sessionId,null);
 await assert.rejects(f.call(f.a.token,'POST','devices/'+d.id+'/heartbeat',{sessionId:d.sessionId}),is(409));
});
test('typed text is never persisted in command records',async t=>{
 const f=await setup(t),d=(await f.start()).device;
 const c=await f.call(f.a.token,'POST','devices/'+d.id+'/input',{requestId:randomUUID(),sessionId:d.sessionId,kind:'text',text:'private typed sample'});
 const row=f.db.raw.prepare('SELECT payload FROM personal_device_commands WHERE id=?').get(c.commandId);
 assert.match(row.payload,/^[a-f0-9]{64}$/);assert.equal(row.payload.includes('private typed sample'),false);
});
