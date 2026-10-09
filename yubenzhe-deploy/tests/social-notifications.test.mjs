import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createECDH } from 'node:crypto';
import { openSocialDatabase } from '../server/social-database.mjs';
import { createSocialService } from '../server/social-service.mjs';
import { createSocialNotifications,validateSubscription } from '../server/social-notifications.mjs';
const makeSub=(suffix='a')=>{const ec=createECDH('prime256v1');ec.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/'+suffix,keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}};
async function fixture(t,sender=async()=>{}){
 const database=openSocialDatabase(':memory:');t.after(()=>database.close());let clock=1000000;
 const service=createSocialService({database,now:()=>clock});
 const call=(token,path,input,query={})=>service.handle({method:input===undefined?'GET':'POST',path,input,query,token,ip:'test-'+token.slice(0,6)});
 const a=await call('','register',{password:'245836',requestId:randomUUID()}),b=await call('','register',{password:'593628',requestId:randomUUID()});
 const req=await call(a.token,'friends/request',{userId:b.profile.userId});const accepted=await call(b.token,'friends/respond',{requestId:req.requestId,accept:true});
 const config={subject:'https://example.com',publicKey:'test-public',privateKey:'test-private'},notifications=createSocialNotifications({database,socialService:service,config,sendNotification:sender,now:()=>clock});
 const route=(token,path,input)=>notifications.handle({method:input===undefined?'GET':'POST',path:'notifications/'+path,input,token});
 const send=()=>{clock++;return call(a.token,'conversations/'+accepted.conversationId+'/messages',{type:'text',text:'Private content never in push',clientId:randomUUID()})};
 return {database,service,call,a,b,notifications,route,send,chat:accepted.conversationId,advance:n=>clock+=n};
}
test('push endpoints reject arbitrary hosts, credentials and invalid keys',()=>{
 const good=makeSub();assert.equal(validateSubscription(good).endpoint,good.endpoint);
 for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://user:password@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x'])assert.throws(()=>validateSubscription({...good,endpoint}));
 assert.throws(()=>validateSubscription({...good,keys:{...good.keys,auth:'invalid'}}));
});
test('push persists delivery, retries transient failures and never sends message text',async t=>{
 const sent=[];let failures=1;const f=await fixture(t,async(...args)=>{if(failures-- >0)throw Object.assign(Error('offline'),{statusCode:503});sent.push(args)});
 await f.route(f.b.token,'subscribe',{subscription:makeSub()});await f.send();await f.notifications.tick();
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM push_jobs').get().n,1);assert.equal(sent.length,0);
 f.advance(60001);await f.notifications.tick();await f.notifications.tick();assert.equal(sent.length,1);
 assert.deepEqual(JSON.parse(sent[0][1]),{title:'愚笨者',body:'你有新的消息',tag:'ybz-messages',url:'/#messages'});
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM push_jobs').get().n,0);
});
test('logout and revoked sessions prevent queued delivery',async t=>{
 const sent=[];const f=await fixture(t,async(...args)=>sent.push(args));await f.route(f.b.token,'subscribe',{subscription:makeSub()});await f.send();await f.call(f.b.token,'logout',{});await f.notifications.tick();assert.equal(sent.length,0);assert.equal(f.database.raw.prepare('SELECT count(*) n FROM push_subscriptions').get().n,0);
});
test('muted conversations, read messages and block relations suppress push',async t=>{
 const sent=[];const f=await fixture(t,async(...args)=>sent.push(args));await f.route(f.b.token,'subscribe',{subscription:makeSub()});
 await f.call(f.b.token,'conversations/'+f.chat+'/settings',{muted:true});await f.send();await f.notifications.tick();assert.equal(sent.length,0);
 await f.call(f.b.token,'conversations/'+f.chat+'/settings',{muted:false});await f.send();await f.call(f.b.token,'conversations/'+f.chat+'/read',{});await f.notifications.tick();assert.equal(sent.length,0);
 await f.send();const a=f.service.authenticate(f.a.token),b=f.service.authenticate(f.b.token);f.database.raw.prepare('INSERT INTO social_blocks VALUES(?,?,?)').run(b.id,a.id,1000000);await f.notifications.tick();assert.equal(sent.length,0);
});
test('endpoint moves between accounts without exposing keys; permanent endpoint expiry clears it',async t=>{
 const f=await fixture(t,async()=>{throw Object.assign(Error('gone'),{statusCode:410})}),sub=makeSub();
 await f.route(f.a.token,'subscribe',{subscription:sub});await f.route(f.b.token,'subscribe',{subscription:sub});
 assert.equal((await f.route(f.a.token,'status')).subscriptions.length,0);const status=await f.route(f.b.token,'status');assert.equal(status.subscriptions.length,1);assert.ok(!JSON.stringify(status).includes(sub.keys.auth));assert.ok(!JSON.stringify(status).includes(sub.endpoint));
 await f.send();await f.notifications.tick();assert.equal(f.database.raw.prepare('SELECT count(*) n FROM push_subscriptions').get().n,0);
});
test('push disabled without explicit server credentials',async t=>{
 const f=await fixture(t),service=createSocialNotifications({database:f.database,socialService:f.service});assert.equal((await service.handle({method:'GET',path:'notifications/status',token:f.a.token})).available,false);
 await assert.rejects(()=>service.handle({method:'POST',path:'notifications/subscribe',token:f.a.token,input:{subscription:makeSub()}}),e=>e.code==='PUSH_UNAVAILABLE');
});
