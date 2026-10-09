import { createHash, randomUUID } from 'node:crypto';
import { fail, fields } from './social-validation.mjs';
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
export function createSocialNotifications({database,socialService,config=null,sendNotification,now=()=>Date.now()}){
 const db=database.raw,one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
 let running=false,stopped=false;
 const available=!!(config?.publicKey&&config?.privateKey&&config?.subject&&sendNotification);
 function clean(){run('DELETE FROM push_jobs WHERE created_at<? OR status=?',now()-86400000,'sent');run('DELETE FROM push_subscriptions WHERE NOT EXISTS(SELECT 1 FROM social_sessions s WHERE s.token_hash=push_subscriptions.session_hash AND s.account_id=push_subscriptions.account_id AND s.expires_at>?)',now());}
 async function handle({method,path,input={},token}){
  const account=socialService.authenticate(token);
  if(method==='GET'&&path==='notifications/status')return {available,publicKey:available?config.publicKey:null,subscriptions:all('SELECT id,created_at,updated_at,session_hash FROM push_subscriptions WHERE account_id=?',account.id).map(s=>({id:s.id,createdAt:s.created_at,updatedAt:s.updated_at,currentSession:s.session_hash===hash(token)}))};
  if(method==='POST'&&path==='notifications/subscribe'){
   fields(input,['subscription']);if(!available)fail(503,'PUSH_UNAVAILABLE','消息通知尚未配置。');
   const subscription=validateSubscription(input.subscription),count=one('SELECT count(*) n FROM push_subscriptions WHERE account_id=? AND endpoint<>?',account.id,subscription.endpoint).n;
   if(count>=10)fail(409,'PUSH_LIMIT','通知设备已达上限，请先关闭旧设备通知。');
   // The endpoint belongs to the browser profile; explicitly rebind on account switch.
   db.exec('BEGIN IMMEDIATE');try{run('DELETE FROM push_subscriptions WHERE endpoint=?',subscription.endpoint);const id=randomUUID();run('INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)',id,account.id,hash(token),subscription.endpoint,JSON.stringify(subscription),now(),now());db.exec('COMMIT');return {ok:true,id};}catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(method==='POST'&&path==='notifications/unsubscribe'){fields(input,['endpoint']);if(typeof input.endpoint!=='string'||input.endpoint.length>2048)fail(400,'INVALID_SUBSCRIPTION','通知地址无效。');run('DELETE FROM push_subscriptions WHERE account_id=? AND endpoint=?',account.id,input.endpoint);return {ok:true};}
  fail(404,'NOT_FOUND','通知设置入口不存在。');
 }
 function eligible(job){return one("SELECT 1 FROM push_subscriptions p JOIN social_sessions s ON s.token_hash=p.session_hash AND s.account_id=p.account_id JOIN conversation_members cm ON cm.account_id=p.account_id AND cm.conversation_id=? JOIN messages m ON m.id=? WHERE p.id=? AND s.expires_at>? AND cm.muted=0 AND cm.last_read_id<m.id AND cm.history_start_id<m.id AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=p.account_id AND b.blocked_id=m.sender) OR (b.blocker_id=m.sender AND b.blocked_id=p.account_id)) AND NOT EXISTS(SELECT 1 FROM message_moderation x WHERE x.message_id=m.id) AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.account_id IN(p.account_id,m.sender) AND r.state='suspended')",job.conversation_id,job.message_id,job.subscription_id,now());}
 function enqueue(){
  db.exec('BEGIN IMMEDIATE');try{
   const cursor=one('SELECT message_id FROM push_cursor WHERE id=1').message_id,rows=all('SELECT id,conversation_id,sender FROM messages WHERE id>? ORDER BY id LIMIT 200',cursor);
   for(const m of rows){for(const p of all('SELECT p.id,p.account_id FROM push_subscriptions p JOIN conversation_members cm ON cm.account_id=p.account_id WHERE cm.conversation_id=? AND p.account_id<>? AND cm.muted=0 AND cm.history_start_id<? AND cm.last_read_id<? AND p.created_at<=(SELECT created_at FROM messages WHERE id=?)',m.conversation_id,m.sender,m.id,m.id,m.id)){
    const job={subscription_id:p.id,conversation_id:m.conversation_id,message_id:m.id};if(eligible(job))run('INSERT OR IGNORE INTO push_jobs(subscription_id,account_id,message_id,conversation_id,next_at,created_at) VALUES(?,?,?,?,?,?)',p.id,p.account_id,m.id,m.conversation_id,now(),now());
   }}
   if(rows.length)run('UPDATE push_cursor SET message_id=? WHERE id=1',rows.at(-1).id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 async function tick(){
  if(running||stopped||!available)return;running=true;
  try{clean();enqueue();const pending=all("SELECT j.*,p.subscription_json FROM push_jobs j JOIN push_subscriptions p ON p.id=j.subscription_id WHERE j.status IN('pending','sending') AND j.next_at<=? ORDER BY j.id LIMIT 10",now());
   for(const job of pending){if(stopped)break;if(!eligible(job)){run('DELETE FROM push_jobs WHERE id=?',job.id);continue;}
    run("UPDATE push_jobs SET status='sending',attempts=attempts+1,next_at=? WHERE id=?",now()+60000,job.id);
    try{await sendNotification(JSON.parse(job.subscription_json),JSON.stringify({title:'愚笨者',body:'你有新的消息',tag:'ybz-messages',url:'/#messages'}),{TTL:300,urgency:'normal',timeout:10000,vapidDetails:config});run("UPDATE push_jobs SET status='sent' WHERE id=?",job.id);}
    catch(error){if([404,410].includes(error.statusCode)){run('DELETE FROM push_subscriptions WHERE id=?',job.subscription_id);}else if(job.attempts>=4||([400,401,403,413].includes(error.statusCode))){run('DELETE FROM push_jobs WHERE id=?',job.id);}else run("UPDATE push_jobs SET status='pending',next_at=? WHERE id=?",now()+Math.min(3600000,60000*2**job.attempts),job.id);}
   }
  }finally{running=false;}
 }
 return {handle,tick,async close(){stopped=true;while(running)await new Promise(resolve=>setTimeout(resolve,25))},available};
}
