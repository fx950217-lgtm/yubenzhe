import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {openSocialDatabase} from '../server/social-database.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const migrations=new URL('../migrations/',import.meta.url);
const oldFiles=readdirSync(migrations).filter(name=>/^0(?:0[3-9]|1[0-9]|2[0-6])-[a-z-]+\.sql$/.test(name)).sort();
function oldDatabase(path){
 const raw=new DatabaseSync(path);raw.exec('PRAGMA foreign_keys=ON;CREATE TABLE social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);');
 assert.equal(oldFiles.length,24);
 for(const [i,name]of oldFiles.entries()){const sql=readFileSync(new URL(name,migrations),'utf8');raw.exec(sql);raw.prepare('INSERT INTO social_migrations VALUES(?,?,?)').run(i+1,sha(sql),1000+i);}
 const a=randomUUID(),b=randomUUID(),group=randomUUID(),device=randomUUID(),task=randomUUID(),session=randomUUID();
 for(const [id,uid]of [[a,'85372641'],[b,'85372642']])raw.prepare('INSERT INTO accounts(id,user_id,nickname,bio,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(id,uid,'迁移合成账号','保留原资料','old-salt','old-hash',1000);
 raw.prepare('INSERT INTO friendships VALUES(?,?,?)').run(...[a,b].sort(),1000);
 raw.prepare("INSERT INTO conversations(id,type,name,owner_id,created_at,updated_at,allow_device_ai) VALUES(?,'group','迁移前的群',?,1000,1000,1)").run(group,a);
 for(const id of [a,b])raw.prepare('INSERT INTO conversation_members(conversation_id,account_id,joined_at) VALUES(?,?,1000)').run(group,id);
 const anchor=Number(raw.prepare("INSERT INTO messages(conversation_id,sender,client_id,type,text,created_at) VALUES(?,?,'old-anchor','text','旧群消息原样保留',1000)").run(group,a).lastInsertRowid);
 raw.prepare("INSERT INTO personal_devices(id,owner_id,name,pair_expires,token_hash,created_at) VALUES(?,?,'旧电脑',0,'old-token-hash',1000)").run(device,a);
 raw.prepare("INSERT INTO ai_channel_tasks(id,device_id,owner_id,request_id,request_hash,prompt_length,status,created_at,finished_at,provider) VALUES(?,?,?,?,?,30,'succeeded',1000,1001,'codex')").run(task,device,a,randomUUID(),'old-digest');
 raw.prepare("INSERT INTO device_ai_sessions(id,conversation_id,owner_id,device_id,providers,status,round,max_rounds,created_at,expires_at,viewer_until,anchor_id,request_id,request_hash) VALUES(?,?,?,?,'[\"codex\"]','finished',1,1,1000,2000,1500,?,?,?)").run(session,group,a,device,anchor,randomUUID(),'old-request-digest');
 const reply=Number(raw.prepare("INSERT INTO messages(conversation_id,sender,client_id,type,text,created_at,provider,device_id) VALUES(?,?,'old-ai-reply','text','',1001,'codex',?)").run(group,a,device).lastInsertRowid);
 raw.prepare("INSERT INTO device_ai_rounds(session_id,round,provider,task_id,message_id) VALUES(?,1,'codex',?,?)").run(session,task,reply);
 raw.prepare('INSERT INTO device_ai_commands VALUES(?,?,?,?)').run(a,randomUUID(),session,'old-command-digest');
 const file=randomUUID();raw.prepare('INSERT INTO workbench_files(id,owner_id,name,mime,content,sha256,size,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?,\'input\',1000,2000)').run(file,a,'旧文件.bin','application/octet-stream',Buffer.from([0,255,42,0]),sha(Buffer.from([0,255,42,0])),4);
 return {raw,a,b,group,device,task,session,reply};
}
test('migration027 preserves every026 table field, source alias, execution lease and checksum on both upgrade and reopen',t=>{
 const parent=realpathSync(tmpdir()),dir=mkdtempSync(join(parent,'ybz-decision-migration-')),path=join(dir,'fixture.sqlite');let raw,database;
 t.after(()=>{database?.close();raw?.close();const actual=realpathSync(dir);assert.equal(dirname(actual).toLowerCase(),parent.toLowerCase());assert.ok(basename(actual).startsWith('ybz-decision-migration-'));rmSync(actual,{recursive:true,force:true});});
 const seed=oldDatabase(path);raw=seed.raw;raw.prepare('UPDATE messages SET ai_alias=?,ai_session_id=? WHERE id=?').run('旧群AI备注',seed.session,seed.reply);raw.prepare('UPDATE ai_channel_tasks SET lease_id=?,lease_until=?,connector_id=? WHERE id=?').run('old-lease',123456,'old-connector',seed.task);
 const before=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>{const columns=raw.prepare('PRAGMA table_info('+name+')').all(),projection=columns.map(c=>'"'+c.name+'"').join(',');return {name,columns,projection,rows:raw.prepare('SELECT '+projection+' FROM '+name+' ORDER BY rowid').all()};});raw.close();raw=null;
 for(let pass=0;pass<2;pass++){database=openSocialDatabase(path);for(const table of before){const rows=database.raw.prepare('SELECT '+table.projection+' FROM '+table.name+' ORDER BY rowid').all();assert.deepEqual(table.name==='social_migrations'?rows.slice(0,24):rows,table.rows,table.name+' historical values unchanged');assert.deepEqual(database.raw.prepare('PRAGMA table_info('+table.name+')').all().slice(0,table.columns.length),table.columns);}
  assert.equal(database.raw.prepare('SELECT count(*) n FROM social_migrations').get().n,26);assert.equal(database.raw.prepare('SELECT checksum FROM social_migrations WHERE version=25').get().checksum,sha(readFileSync(new URL('027-ai-decisions.sql',migrations),'utf8')));assert.equal(database.raw.prepare('SELECT count(*) n FROM ai_task_decisions').get().n,0);
  const task=database.raw.prepare('SELECT parent_task_id,workspace_task_id,parent_decision_id FROM ai_channel_tasks WHERE id=?').get(seed.task);assert.deepEqual({...task},{parent_task_id:null,workspace_task_id:null,parent_decision_id:null});assert.deepEqual(database.raw.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(database.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');database.close();database=null;
 }
});
