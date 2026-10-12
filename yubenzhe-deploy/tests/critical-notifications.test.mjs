// All senders below are in-process fixtures. These tests do not send Web Push.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createCriticalNotificationWorker} from '../server/critical-notifications.mjs';
import {createCriticalSourceAdapter} from '../server/critical-notification-sources.mjs';
import {criticalPushDisplay} from '../server/critical-notification-policy.mjs';
function fixture(t){
 const raw=new DatabaseSync(':memory:');raw.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE accounts(id TEXT PRIMARY KEY,deleted_at INTEGER DEFAULT 0);
 CREATE TABLE account_restrictions(account_id TEXT PRIMARY KEY,state TEXT);
 CREATE TABLE social_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT,expires_at INTEGER);
 CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY,account_id TEXT,session_hash TEXT,subscription_json TEXT,created_at INTEGER);
 CREATE TABLE push_jobs(id INTEGER PRIMARY KEY);CREATE TABLE messages(id INTEGER PRIMARY KEY);CREATE TABLE push_cursor(id INTEGER PRIMARY KEY,message_id INTEGER);INSERT INTO push_cursor VALUES(1,0);
 CREATE TABLE personal_devices(id TEXT PRIMARY KEY,owner_id TEXT,revoked_at INTEGER,token_hash TEXT);
 CREATE TABLE ai_channel_tasks(id TEXT PRIMARY KEY,owner_id TEXT,device_id TEXT,status TEXT,finished_at INTEGER,workspace_task_id TEXT);
 CREATE TABLE ai_task_decisions(id TEXT PRIMARY KEY,task_id TEXT,owner_id TEXT,device_id TEXT,state TEXT,created_at INTEGER,expires_at INTEGER);
 CREATE TABLE workbench_tasks(id TEXT PRIMARY KEY,owner_id TEXT,status TEXT,updated_at INTEGER);
 CREATE TABLE device_ai_sessions(id TEXT PRIMARY KEY,owner_id TEXT,device_id TEXT,conversation_id TEXT,status TEXT,anchor_id INTEGER,roster_ids TEXT DEFAULT '[]',owner_revision INTEGER DEFAULT 0);
 CREATE TABLE device_ai_rounds(session_id TEXT,round INTEGER,task_id TEXT);
 CREATE TABLE conversations(id TEXT PRIMARY KEY,owner_id TEXT,allow_device_ai INTEGER,ai_owner_revision INTEGER DEFAULT 0);
 CREATE TABLE conversation_ai_roster(id TEXT PRIMARY KEY,conversation_id TEXT,owner_id TEXT,device_id TEXT,removed_at INTEGER);
 CREATE TABLE conversation_members(conversation_id TEXT,account_id TEXT,history_start_id INTEGER);`);
 raw.exec(readFileSync(new URL('../migrations/028-critical-notifications.sql',import.meta.url),'utf8'));
 const database={raw},owner=randomUUID(),other=randomUUID(),device=randomUUID(),live=new Set(),sent=[],workers=[];let clock=100000;
 const run=(sql,...p)=>raw.prepare(sql).run(...p),get=(sql,...p)=>raw.prepare(sql).get(...p);
 for(const id of [owner,other]){run('INSERT INTO accounts(id) VALUES(?)',id);run('INSERT INTO social_sessions VALUES(?,?,?)',id+'-session',id,clock+999999999);}
 run('INSERT INTO personal_devices VALUES(?,?,NULL,?)',device,owner,'fixture-device-token');
 const subscribe=(account=owner)=>{const id=randomUUID();run('INSERT INTO push_subscriptions VALUES(?,?,?,?,?)',id,account,account+'-session',JSON.stringify({endpoint:'https://example.invalid/'+id}),clock);return id;};
 const worker=({sender=async(...args)=>sent.push(args),configured=true}={})=>{const sources=createCriticalSourceAdapter({database,decisionAvailable:id=>live.has(id)&&get("SELECT 1 FROM ai_task_decisions WHERE id=? AND state='pending' AND expires_at>?",id,clock)!==undefined});const value=createCriticalNotificationWorker({database,sources,now:()=>clock,config:configured?{subject:'mailto:fixture@example.invalid',publicKey:'synthetic',privateKey:'synthetic'}:null,sendNotification:sender});workers.push(value);return value;};
 const ai=(status='succeeded',account=owner)=>{const id=randomUUID();run('INSERT INTO ai_channel_tasks(id,owner_id,device_id,status,finished_at) VALUES(?,?,?,?,?)',id,account,device,status,++clock);return id;};
 const decision=task=>{const id=randomUUID();run('INSERT INTO ai_task_decisions VALUES(?,?,?,?,?,?,?)',id,task,owner,device,'pending',clock,clock+1800000);live.add(id);return id;};
 t.after(async()=>{for(const w of workers)await w.close();raw.close();});
 return {raw,run,get,owner,other,device,subscribe,worker,ai,decision,live,sent,now:()=>clock,advance:n=>clock+=n};
}
test('emits each real complete/failure only to the owner once across ticks and restarts',async t=>{
 const f=fixture(t);f.subscribe();f.subscribe(f.other);const w=f.worker();f.ai();f.ai('failed');f.ai('running');f.ai('cancelled');
 await w.tick();await w.tick();await w.close();await f.worker().tick();assert.equal(f.sent.length,2);
 assert.deepEqual(new Set(f.sent.map(x=>JSON.parse(x[1]).kind)),new Set(['task-completed','task-failed']));
 assert.equal(f.get('SELECT count(*) n FROM critical_notification_events').n,2);assert.equal(f.get("SELECT count(*) n FROM critical_notification_deliveries WHERE status='sent'").n,2);
});
test('decision supersedes physical succeeded and is not followed by an old segment completion',async t=>{
 const f=fixture(t);f.subscribe();const w=f.worker(),task=f.ai(),id=f.decision(task);await w.tick();assert.equal(f.sent.length,1);assert.equal(JSON.parse(f.sent[0][1]).kind,'decision-required');
 f.run("UPDATE ai_task_decisions SET state='continued' WHERE id=?",id);await w.tick();assert.equal(f.sent.length,1);f.ai();await w.tick();assert.equal(f.sent.length,2);assert.equal(JSON.parse(f.sent[1][1]).kind,'task-completed');
});
test('resolved, expired or missing-RAM decisions cannot retry a stale prompt notification',async t=>{
 for(const change of ['continued','expired','lost']){const f=fixture(t);f.subscribe();let calls=0;const w=f.worker({sender:async()=>{calls++;throw Object.assign(new Error('fixture'),{statusCode:503});}}),id=f.decision(f.ai());await w.tick();assert.equal(calls,1);
 if(change==='continued')f.run("UPDATE ai_task_decisions SET state='continued' WHERE id=?",id);else if(change==='expired')f.advance(1800001);else f.live.delete(id);f.advance(60001);await w.tick();assert.equal(calls,1,change);}
});
test('two browser subscriptions each receive once, and new subscriptions do not replay old events',async t=>{
 const f=fixture(t);f.subscribe();f.subscribe();const w=f.worker();f.ai();await w.tick();assert.equal(f.sent.length,2);f.advance(1);f.subscribe();await w.tick();assert.equal(f.sent.length,2);
});
test('ordinary messages and old queued chat jobs never push',async t=>{
 const f=fixture(t);f.subscribe();f.run('INSERT INTO messages VALUES(1)');f.run('INSERT INTO push_jobs VALUES(1)');await f.worker().tick();assert.equal(f.sent.length,0);assert.equal(f.get('SELECT count(*) n FROM push_jobs').n,0);assert.equal(f.get('SELECT count(*) n FROM messages').n,1);
});
test('missing external config never invokes even a fixture sender',async t=>{
 const f=fixture(t);f.subscribe();const w=f.worker({configured:false});f.ai();await w.tick();assert.equal(w.available,false);assert.equal(f.sent.length,0);
});
test('durable claim prevents simultaneous workers sending the same event',async t=>{
 const f=fixture(t);f.subscribe();let finish,calls=0;const first=f.worker({sender:()=>{calls++;return new Promise(done=>{finish=done;});}}),second=f.worker();f.ai();const pending=first.tick();await new Promise(resolve=>setImmediate(resolve));await second.tick();assert.equal(calls,1);assert.equal(f.sent.length,0);finish();await pending;await second.tick();assert.equal(f.sent.length,0);
});
test('unknown provider ACK can retry with the same visible notification tag',async t=>{
 const f=fixture(t);f.subscribe();const w=f.worker();f.ai();await w.tick();const first=JSON.parse(f.sent[0][1]);
 f.run("UPDATE critical_notification_deliveries SET status='sending',claim_token='lost-fixture-ack',next_at=?",f.now()+60000);await w.close();f.advance(60001);await f.worker().tick();assert.equal(f.sent.length,2);const second=JSON.parse(f.sent[1][1]);assert.deepEqual(first,second);assert.equal(criticalPushDisplay(second).options.renotify,false);
});
test('503 retry is bounded and a 410 removes only the expired browser subscription',async t=>{
 const f=fixture(t);f.subscribe();let calls=0;const w=f.worker({sender:async()=>{calls++;throw Object.assign(new Error('fixture'),{statusCode:503});}});f.ai();for(let n=0;n<7;n++){await w.tick();f.advance(3600001);}assert.equal(calls,5);assert.equal(f.get("SELECT count(*) n FROM critical_notification_deliveries WHERE status='failed'").n,1);
 const g=fixture(t);g.subscribe();g.subscribe(g.other);const gone=g.worker({sender:async()=>{throw Object.assign(new Error('fixture'),{statusCode:410});}});g.ai();await gone.tick();assert.equal(g.get('SELECT count(*) n FROM push_subscriptions WHERE account_id=?',g.owner).n,0);assert.equal(g.get('SELECT count(*) n FROM push_subscriptions WHERE account_id=?',g.other).n,1);
});
test('logout, restriction and device revocation suppress the owner queue before sending',async t=>{
 for(const mode of ['logout','restriction','revocation','deleted']){const f=fixture(t);f.subscribe();const w=f.worker();f.ai();if(mode==='logout')f.run('DELETE FROM social_sessions WHERE account_id=?',f.owner);if(mode==='restriction')f.run('INSERT INTO account_restrictions VALUES(?,?)',f.owner,'suspended');if(mode==='revocation')f.run('UPDATE personal_devices SET revoked_at=? WHERE id=?',f.now(),f.device);if(mode==='deleted')f.run('UPDATE accounts SET deleted_at=1 WHERE id=?',f.owner);await w.tick();assert.equal(f.sent.length,0,mode);}
});
test('multi-AI group rounds are collapsed into one owner-only final session notification',async t=>{
 const f=fixture(t);f.subscribe();f.subscribe(f.other);const w=f.worker(),group=randomUUID(),session=randomUUID();f.run('INSERT INTO conversations(id,owner_id,allow_device_ai) VALUES(?,?,1)',group,f.owner);f.run('INSERT INTO conversation_members VALUES(?,?,0)',group,f.owner);f.run('INSERT INTO conversation_members VALUES(?,?,0)',group,f.other);f.run('INSERT INTO device_ai_sessions(id,owner_id,device_id,conversation_id,status,anchor_id) VALUES(?,?,?,?,?,1)',session,f.owner,f.device,group,'ready');const roster=randomUUID();f.run('INSERT INTO conversation_ai_roster VALUES(?,?,?,?,NULL)',roster,group,f.owner,f.device);f.run('UPDATE device_ai_sessions SET roster_ids=? WHERE id=?',JSON.stringify([roster]),session);
 for(let round=1;round<=3;round++)for(let ai=0;ai<3;ai++)f.run('INSERT INTO device_ai_rounds VALUES(?,?,?)',session,round,f.ai());await w.tick();assert.equal(f.sent.length,0);f.run("UPDATE device_ai_sessions SET status='finished' WHERE id=?",session);await w.tick();await w.tick();assert.equal(f.sent.length,1);assert.equal(f.get('SELECT source_kind FROM critical_notification_events').source_kind,'group-session');
});
test('manual group stop is not a fabricated failure and group membership removal suppresses completion',async t=>{
 const f=fixture(t);f.subscribe();const w=f.worker(),group=randomUUID(),session=randomUUID();f.run('INSERT INTO conversations(id,owner_id,allow_device_ai) VALUES(?,?,1)',group,f.owner);f.run('INSERT INTO conversation_members VALUES(?,?,0)',group,f.owner);f.run('INSERT INTO device_ai_sessions(id,owner_id,device_id,conversation_id,status,anchor_id) VALUES(?,?,?,?,?,1)',session,f.owner,f.device,group,'stopped');const roster=randomUUID();f.run('INSERT INTO conversation_ai_roster VALUES(?,?,?,?,NULL)',roster,group,f.owner,f.device);f.run('UPDATE device_ai_sessions SET roster_ids=? WHERE id=?',JSON.stringify([roster]),session);f.run('INSERT INTO device_ai_rounds VALUES(?,?,?)',session,1,f.ai());await w.tick();assert.equal(f.sent.length,0);f.run("UPDATE device_ai_sessions SET status='finished' WHERE id=?",session);f.run('DELETE FROM conversation_members WHERE account_id=?',f.owner);await w.tick();assert.equal(f.sent.length,0);
});
