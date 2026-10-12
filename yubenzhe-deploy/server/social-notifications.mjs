import { createHash, randomUUID } from 'node:crypto';
import { fail, fields } from './social-validation.mjs';
import {createCriticalNotificationWorker} from './critical-notifications.mjs';
import {createCriticalSourceAdapter} from './critical-notification-sources.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const suffixes=['push.services.mozilla.com','notify.windows.com','push.apple.com'];
export function validateSubscription(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_SUBSCRIPTION','通知订阅无效。');
 const {endpoint,keys}=value;let url;try{url=new URL(endpoint)}catch{fail(400,'INVALID_SUBSCRIPTION','通知地址无效。')}
 const allowed=url.hostname==='fcm.googleapis.com'||suffixes.some(s=>url.hostname===s||url.hostname.endsWith('.'+s));
 if(typeof endpoint!=='string'||endpoint.length>2048||url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!allowed)fail(400,'INVALID_SUBSCRIPTION','不支持这个浏览器的通知服务。');
 if(!keys||typeof keys.p256dh!=='string'||typeof keys.auth!=='string'||!/^[A-Za-z0-9_-]{87}=?$/.test(keys.p256dh)||!/^[A-Za-z0-9_-]{22}={0,2}$/.test(keys.auth)||Buffer.from(keys.p256dh,'base64url').length!==65||Buffer.from(keys.p256dh,'base64url')[0]!==4||Buffer.from(keys.auth,'base64url').length!==16)fail(400,'INVALID_SUBSCRIPTION','通知密钥格式无效。');
 return {endpoint:url.href,keys:{p256dh:keys.p256dh,auth:keys.auth}};
}
export function createSocialNotifications({database,socialService,config=null,sendNotification,now=()=>Date.now(),decisionAvailable=()=>false,maintain=()=>{}}){
 const db=database.raw,one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
 const worker=createCriticalNotificationWorker({database,sources:createCriticalSourceAdapter({database,decisionAvailable}),config,sendNotification,now,maintain});
 const available=worker.available;
 async function handle({method,path,input={},token}){
  const account=socialService.authenticate(token);
  if(method==='GET'&&path==='notifications/status')return {available,scope:'critical-tasks',reason:available?null:'push-not-configured',publicKey:available?config.publicKey:null,subscriptions:all('SELECT id,created_at,updated_at,session_hash FROM push_subscriptions WHERE account_id=?',account.id).map(s=>({id:s.id,createdAt:s.created_at,updatedAt:s.updated_at,currentSession:s.session_hash===hash(token)}))};
  if(method==='POST'&&path==='notifications/subscribe'){
   fields(input,['subscription']);if(!available)fail(503,'PUSH_UNAVAILABLE','任务关键通知尚未配置。');
   const subscription=validateSubscription(input.subscription),count=one('SELECT count(*) n FROM push_subscriptions WHERE account_id=? AND endpoint<>?',account.id,subscription.endpoint).n;
   if(count>=10)fail(409,'PUSH_LIMIT','通知设备已达上限，请先关闭旧设备通知。');
   // The endpoint belongs to the browser profile; explicitly rebind on account switch.
   db.exec('BEGIN IMMEDIATE');try{
    const prior=one('SELECT id,account_id,session_hash FROM push_subscriptions WHERE endpoint=?',subscription.endpoint),sessionHash=hash(token);
    if(prior?.account_id===account.id&&prior.session_hash===sessionHash){run('UPDATE push_subscriptions SET subscription_json=?,updated_at=? WHERE id=?',JSON.stringify(subscription),now(),prior.id);db.exec('COMMIT');return {ok:true,id:prior.id};}
    run('DELETE FROM push_subscriptions WHERE endpoint=?',subscription.endpoint);const id=randomUUID();run('INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)',id,account.id,sessionHash,subscription.endpoint,JSON.stringify(subscription),now(),now());db.exec('COMMIT');return {ok:true,id};
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(method==='POST'&&path==='notifications/unsubscribe'){fields(input,['endpoint']);if(typeof input.endpoint!=='string'||input.endpoint.length>2048)fail(400,'INVALID_SUBSCRIPTION','通知地址无效。');run('DELETE FROM push_subscriptions WHERE account_id=? AND endpoint=?',account.id,input.endpoint);return {ok:true};}
  fail(404,'NOT_FOUND','通知设置入口不存在。');
 }
 return {handle,tick:worker.tick,close:worker.close,available};
}
