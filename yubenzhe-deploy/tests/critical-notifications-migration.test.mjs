import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,dirname,basename} from 'node:path';
import {openSocialDatabase} from '../server/social-database.mjs';
const migrations=new URL('../migrations/',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
test('028 preserves 003–027 history and unread state while retiring only old chat delivery jobs; reopening is idempotent',t=>{
 const parent=realpathSync(tmpdir()),folder=mkdtempSync(join(parent,'ybz-critical-migration-')),file=join(folder,'fixture.sqlite');let raw,database;
 t.after(()=>{database?.close();raw?.close();const actual=realpathSync(folder);assert.equal(dirname(actual).toLowerCase(),parent.toLowerCase());assert.ok(basename(actual).startsWith('ybz-critical-migration-'));rmSync(actual,{recursive:true,force:true});});
 raw=new DatabaseSync(file);raw.exec('PRAGMA foreign_keys=ON;CREATE TABLE social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);');
 const old=readdirSync(migrations).filter(name=>/^0(?:0[3-9]|1[0-9]|2[0-7])-[a-z-]+\.sql$/.test(name)).sort();assert.equal(old.length,25);
 for(const [i,name]of old.entries()){const sql=readFileSync(new URL(name,migrations),'utf8');raw.exec(sql);raw.prepare('INSERT INTO social_migrations VALUES(?,?,?)').run(i+1,sha(sql),1000+i);}
 const a=randomUUID(),group=randomUUID(),subscription=randomUUID();raw.prepare('INSERT INTO accounts(id,user_id,nickname,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(a,'987654321','保留账号','synthetic','synthetic',1000);
 raw.prepare("INSERT INTO conversations(id,type,name,owner_id,created_at,updated_at) VALUES(?,'group','保留群',?,1000,1000)").run(group,a);raw.prepare('INSERT INTO conversation_members(conversation_id,account_id,joined_at,last_read_id,history_start_id,muted) VALUES(?,?,1000,0,0,1)').run(group,a);
 const message=Number(raw.prepare("INSERT INTO messages(conversation_id,sender,client_id,type,text,created_at) VALUES(?,?,'fixture','text','保留真实旧消息样例',1000)").run(group,a).lastInsertRowid);
 raw.prepare('INSERT INTO push_subscriptions(id,account_id,session_hash,endpoint,subscription_json,created_at,updated_at) VALUES(?,?,?,?,?,1000,1000)').run(subscription,a,'synthetic-hash','https://fcm.googleapis.com/fcm/send/fixture','{}');
 raw.prepare('INSERT INTO push_jobs(subscription_id,account_id,message_id,conversation_id,next_at,created_at) VALUES(?,?,?,?,1000,1000)').run(subscription,a,message,group);raw.prepare('UPDATE push_cursor SET message_id=17 WHERE id=1').run();
 const before=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'push_jobs' ORDER BY name").all().map(({name})=>({name,rows:raw.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()}));raw.close();raw=null;
 for(let pass=0;pass<2;pass++){
  database=openSocialDatabase(file);for(const table of before){const rows=database.raw.prepare('SELECT * FROM '+table.name+' ORDER BY rowid').all();assert.deepEqual(table.name==='social_migrations'?rows.slice(0,25):rows,table.rows,table.name+' values preserved');}
  assert.equal(database.raw.prepare('SELECT count(*) n FROM social_migrations').get().n,26);assert.equal(database.raw.prepare('SELECT checksum FROM social_migrations WHERE version=26').get().checksum,sha(readFileSync(new URL('028-critical-notifications.sql',migrations))));assert.equal(database.raw.prepare('SELECT count(*) n FROM push_jobs').get().n,0);
  for(const table of ['critical_notification_events','critical_notification_deliveries','critical_notification_state'])assert.equal(database.raw.prepare('SELECT count(*) n FROM '+table).get().n,0);
  assert.deepEqual(database.raw.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(database.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');database.close();database=null;
 }
});
test('028 schema only persists fixed notification metadata and enforces event and subscription deduplication',t=>{
 const database=openSocialDatabase(':memory:');t.after(()=>database.close());const db=database.raw,owner=randomUUID(),subscription=randomUUID(),event=randomUUID();
 db.prepare('INSERT INTO accounts(id,user_id,nickname,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(owner,'987654321','fixture','synthetic','synthetic',1000);
 db.prepare('INSERT INTO push_subscriptions(id,account_id,session_hash,endpoint,subscription_json,created_at,updated_at) VALUES(?,?,?,?,?,1000,1000)').run(subscription,owner,'synthetic-hash','https://fcm.googleapis.com/fcm/send/fixture','{}');
 const insert=db.prepare('INSERT INTO critical_notification_events VALUES(?,?,?,?,?,?,?)');insert.run(event,owner,'ai-task','source','task-completed',1000,2000);
 assert.throws(()=>insert.run(randomUUID(),owner,'ai-task','source','task-completed',1000,2000),/UNIQUE/);assert.throws(()=>insert.run(randomUUID(),owner,'chat-message','source','ordinary-message',1000,2000),/CHECK/);
 const delivery=db.prepare('INSERT INTO critical_notification_deliveries(event_id,subscription_id,next_at) VALUES(?,?,?)');delivery.run(event,subscription,1000);assert.throws(()=>delivery.run(event,subscription,1000),/UNIQUE/);
 const cols=db.prepare('PRAGMA table_info(critical_notification_events)').all().map(row=>row.name);assert.deepEqual(cols,['id','owner_id','source_kind','source_id','kind','occurred_at','expires_at']);db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(subscription);assert.equal(db.prepare('SELECT count(*) n FROM critical_notification_deliveries').get().n,0);
});
