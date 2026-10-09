import test from 'node:test';
import assert from 'node:assert/strict';
import {mountNotificationSettings,supportsWebPush} from '../src/notification-settings.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)}};
const tick=()=>new Promise(r=>setImmediate(r));
function setup(t,overrides={}){
 const calls=[],nodes=Object.fromEntries(['status','enable','disable'].map(key=>[key,{textContent:'',disabled:false,hidden:false,dataset:{}}]));let owner='837194',subscription=null,unsubscribed=0;
 const sub={endpoint:'https://fcm.googleapis.com/synthetic',toJSON:()=>({endpoint:'synthetic'}),unsubscribe:async()=>{unsubscribed++;return true}};
 const manager={getSubscription:async()=>subscription,subscribe:async()=>sub,...overrides.manager};const registration={pushManager:manager};
 const values={isSecureContext:true,PushManager:function(){},Notification:{permission:'default',requestPermission:async()=>'granted',...overrides.Notification},navigator:{serviceWorker:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration),...overrides.serviceWorker}}};
 for(const [key,value] of Object.entries(values)){const previous=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);}
 const root={innerHTML:'',querySelector:selector=>nodes[selector.match(/-(status|enable|disable)\]/)[1]]};
 const client={getProfile:()=>owner?{userId:owner}:null,authenticatedRequest:async(path,options)=>{calls.push({path,...options});return path==='notifications/status'?{available:true,publicKey:'BA',subscriptions:[]}:{};},...overrides.client};
 const cleanup=mountNotificationSettings(root,{client});t.after(cleanup);
 return {nodes,calls,cleanup,owner:v=>owner=v,subscription:v=>subscription=v,sub,unsubscribed:()=>unsubscribed};
}
test('capability checks require secure context, service workers, push and notification APIs',()=>{assert.equal(supportsWebPush({}),false);assert.equal(supportsWebPush({isSecureContext:true,navigator:{serviceWorker:{}},PushManager:{},Notification:{}}),true);});
test('closing during permission prompt prevents any later service registration or account subscription',async t=>{const pending=deferred(),h=setup(t,{Notification:{requestPermission:()=>pending.promise}});await tick();const result=h.nodes.enable.onclick();h.cleanup();pending.resolve('granted');await result;assert.deepEqual(h.calls.map(c=>c.path),['notifications/status']);});
test('switching accounts during permission prompt does not bind old action to new account',async t=>{const pending=deferred(),h=setup(t,{Notification:{requestPermission:()=>pending.promise}});await tick();const result=h.nodes.enable.onclick();h.owner('927463');pending.resolve('granted');await result;assert.deepEqual(h.calls.map(c=>c.path),['notifications/status']);});
test('subscription finishing after close is not registered or cancelled by a stale component',async t=>{const pending=deferred(),h=setup(t,{manager:{subscribe:()=>pending.promise}});await tick();const result=h.nodes.enable.onclick();await tick();h.cleanup();pending.resolve(h.sub);await result;assert.equal(h.calls.some(c=>c.path==='notifications/subscribe'),false);assert.equal(h.unsubscribed(),0);});
test('closing during disable lookup prevents a server mutation and browser unsubscribe',async t=>{let slow=false;const pending=deferred(),h=setup(t,{manager:{getSubscription:()=>slow?pending.promise:Promise.resolve(null)}});await tick();slow=true;const result=h.nodes.disable.onclick();await tick();h.cleanup();pending.resolve(h.sub);await result;assert.equal(h.calls.some(c=>c.path==='notifications/unsubscribe'),false);assert.equal(h.unsubscribed(),0);});
test('denied permission does not send subscription and restores controls',async t=>{const h=setup(t,{Notification:{requestPermission:async()=>'denied'}});await tick();await h.nodes.enable.onclick();assert.match(h.nodes.status.textContent,/未获得通知权限/);assert.equal(h.nodes.enable.disabled,false);assert.equal(h.calls.length,1);});
