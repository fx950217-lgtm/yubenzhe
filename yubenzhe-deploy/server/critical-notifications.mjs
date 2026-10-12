// The trusted source adapter must read authoritative metadata, never client events.
import {randomUUID} from 'node:crypto';
import {criticalPushPayload} from './critical-notification-policy.mjs';
const kinds=new Set(['task-completed','decision-required','task-failed']);
const sourcesAllowed=new Set(['ai-task','workbench-task','group-session','decision']);
const TTL=86400000,CLAIM=60000;
export function createCriticalNotificationWorker({database,sources,config=null,sendNotification,now=()=>Date.now(),maintain=()=>{}}){
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 if(typeof sources?.collect!=='function'||typeof sources?.current!=='function')throw new Error('Authoritative notification sources are required');
 run('INSERT OR IGNORE INTO critical_notification_state(id,started_at) VALUES(1,?)',now());
 const available=Boolean(config?.subject&&config?.publicKey&&config?.privateKey&&typeof sendNotification==='function');
 let running=false,stopped=false;
 const accountOK=id=>Boolean(one("SELECT 1 FROM accounts a WHERE a.id=? AND a.deleted_at=0 AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.account_id=a.id AND r.state<>'active')",id));
 function validSource(event){
   if(!accountOK(event.owner_id))return false;
   const current=sources.current({sourceKind:event.source_kind,sourceId:event.source_id,kind:event.kind});
   return current?.eligible===true&&current.ownerId===event.owner_id;
 }
 function eligible(job){
   if(job.expires_at<=now()||!validSource(job))return false;
   return Boolean(one('SELECT 1 FROM push_subscriptions p JOIN social_sessions s ON s.token_hash=p.session_hash AND s.account_id=p.account_id WHERE p.id=? AND p.account_id=? AND s.expires_at>? AND p.created_at<=?',job.subscription_id,job.owner_id,now(),job.occurred_at));
 }
 function observe(){
   const since=Math.max(one('SELECT started_at FROM critical_notification_state WHERE id=1').started_at,now()-TTL+1);
   // Adapter excludes already-observed source keys before its LIMIT, avoiding starvation.
   const candidates=sources.collect({since,until:now(),limit:200});
   if(!Array.isArray(candidates)||candidates.length>200)throw new Error('Unbounded critical notification source');
   for(const candidate of candidates){
     const {sourceKind,sourceId,ownerId,kind,occurredAt,expiresAt=occurredAt+TTL}=candidate;
     if(!sourcesAllowed.has(sourceKind)||!kinds.has(kind)||(sourceKind==='decision')!==(kind==='decision-required')||typeof sourceId!=='string'||sourceId.length>80||typeof ownerId!=='string'||ownerId.length>80||!Number.isSafeInteger(occurredAt)||!Number.isSafeInteger(expiresAt)||occurredAt<since||occurredAt>now()||expiresAt<=now()||expiresAt>occurredAt+TTL)continue;
     const current=sources.current({sourceKind,sourceId,kind});
     // A real terminal fact can be retained while its recipient is muted/revoked.
     // This consumes its dedupe key without delivering or repeatedly blocking newer facts.
     if(current?.ownerId!==ownerId||current.occurred!==true||!one('SELECT 1 FROM accounts WHERE id=? AND deleted_at=0',ownerId))continue;
     run('INSERT OR IGNORE INTO critical_notification_events(id,owner_id,source_kind,source_id,kind,occurred_at,expires_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),ownerId,sourceKind,sourceId,kind,occurredAt,expiresAt);
   }
   run("INSERT OR IGNORE INTO critical_notification_deliveries(event_id,subscription_id,next_at) SELECT e.id,p.id,? FROM critical_notification_events e JOIN push_subscriptions p ON p.account_id=e.owner_id JOIN social_sessions s ON s.account_id=p.account_id AND s.token_hash=p.session_hash WHERE e.expires_at>? AND s.expires_at>? AND p.created_at<=e.occurred_at",now(),now(),now());
 }
 function clean(){
   run('DELETE FROM critical_notification_events WHERE expires_at<=? OR owner_id IN(SELECT id FROM accounts WHERE deleted_at<>0)',now());
   run('DELETE FROM push_subscriptions WHERE NOT EXISTS(SELECT 1 FROM social_sessions s WHERE s.token_hash=push_subscriptions.session_hash AND s.account_id=push_subscriptions.account_id AND s.expires_at>?)',now());
   // Old queue is retired; never inspect ordinary message bodies or unread state.
   run('DELETE FROM push_jobs');
 }
 async function tick(){
   if(stopped||running)return;running=true;
   try{
     maintain();clean();observe();if(!available)return;
     const jobs=all("SELECT d.*,e.owner_id,e.source_kind,e.source_id,e.kind,e.occurred_at,e.expires_at FROM critical_notification_deliveries d JOIN critical_notification_events e ON e.id=d.event_id WHERE d.status IN('pending','sending') AND d.next_at<=? ORDER BY d.id LIMIT 10",now());
     for(const job of jobs){
       if(stopped)break;maintain();
       const claim=randomUUID();
       if(!run("UPDATE critical_notification_deliveries SET status='sending',claim_token=?,attempts=attempts+1,next_at=? WHERE id=? AND status IN('pending','sending') AND next_at<=?",claim,now()+CLAIM,job.id,now()).changes)continue;
       if(!eligible(job)){run("UPDATE critical_notification_deliveries SET status='suppressed',claim_token=NULL WHERE id=? AND claim_token=?",job.id,claim);continue;}
       const subscription=one('SELECT subscription_json FROM push_subscriptions WHERE id=?',job.subscription_id);
       if(!subscription)continue;
       try{
         await sendNotification(JSON.parse(subscription.subscription_json),JSON.stringify(criticalPushPayload({id:job.event_id,kind:job.kind})),{TTL:Math.max(1,Math.min(300,Math.floor((job.expires_at-now())/1000))),urgency:'normal',timeout:10000,vapidDetails:config});
         run("UPDATE critical_notification_deliveries SET status='sent',claim_token=NULL WHERE id=? AND claim_token=?",job.id,claim);
       }catch(error){
         if([404,410].includes(error.statusCode))run('DELETE FROM push_subscriptions WHERE id=?',job.subscription_id);
         else if(job.attempts+1>=5||[400,401,403,413].includes(error.statusCode))run("UPDATE critical_notification_deliveries SET status='failed',claim_token=NULL WHERE id=? AND claim_token=?",job.id,claim);
         else run("UPDATE critical_notification_deliveries SET status='pending',claim_token=NULL,next_at=? WHERE id=? AND claim_token=?",now()+Math.min(3600000,60000*2**job.attempts),job.id,claim);
       }
     }
   }finally{running=false;}
 }
 return {available,tick,async close(){stopped=true;while(running)await new Promise(resolve=>setTimeout(resolve,25));}};
}
