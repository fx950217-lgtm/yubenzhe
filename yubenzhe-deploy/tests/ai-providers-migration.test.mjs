import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,readdirSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {openSocialDatabase} from '../server/social-database.mjs';

const migrationsURL=new URL('../migrations/',import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
test('024 upgrades the actual 023 schema additively, preserving user rows, old task hashes, leases and migration checksums',t=>{
 const parent=realpathSync(tmpdir()),directory=mkdtempSync(join(parent,'ybz-provider-migration-')),filename=join(directory,'synthetic.sqlite');let raw=new DatabaseSync(filename),database;
 t.after(()=>{database?.close();raw?.close();const actual=realpathSync(directory);assert.equal(dirname(actual).toLowerCase(),parent.toLowerCase());assert.ok(basename(actual).startsWith('ybz-provider-migration-'));assert.equal(resolve(directory).toLowerCase(),resolve(actual).toLowerCase());rmSync(actual,{recursive:true,force:true});});
 raw.exec('PRAGMA foreign_keys=ON;CREATE TABLE social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)');
 const files=readdirSync(migrationsURL).filter(name=>/^\d{3}-[a-z-]+\.sql$/.test(name)&&Number(name.slice(0,3))>=3&&Number(name.slice(0,3))<=23).sort();assert.equal(files.length,21);
 for(const [index,file]of files.entries()){const sql=readFileSync(new URL(file,migrationsURL),'utf8');raw.exec(sql);raw.prepare('INSERT INTO social_migrations VALUES(?,?,?)').run(index+1,sha(sql),1700000000000+index);}
 const owner=randomUUID(),device=randomUUID(),task=randomUUID(),connector=randomUUID(),lease=randomUUID(),time=1791792000000;
 raw.prepare('INSERT INTO accounts(id,user_id,nickname,bio,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(owner,'73192648','升级前用户','原样保留','synthetic-only',sha('synthetic-hash'),time);
 raw.prepare('INSERT INTO user_ids(user_id,account_id) VALUES(?,?)').run('73192648',owner);
 raw.prepare('INSERT INTO personal_devices(id,owner_id,name,token_hash,pair_expires,created_at,last_seen,source,capabilities,capabilities_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(device,owner,'升级前电脑',sha('synthetic-token'),time,time,time,'cloud','{}',time);
 raw.prepare('INSERT INTO ai_channel_devices VALUES(?,?,?,?,?,?)').run(device,connector,'ready','旧工作区','Codex',time);
 raw.prepare("INSERT INTO ai_channel_tasks(id,device_id,owner_id,request_id,request_hash,prompt_length,status,connector_id,lease_id,lease_until,hard_until,last_seq,event_count,output_chars,created_at,started_at) VALUES(?,?,?,?,?,?,'running',?,?,?,?,?,?,?,?,?)").run(task,device,owner,randomUUID(),sha('legacy-idempotency'),12,connector,lease,time+15000,time+600000,1,1,25,time,time);
 raw.prepare('INSERT INTO ai_channel_event_hashes VALUES(?,?,?)').run(task,1,sha('synthetic-output-digest'));
 const tables=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name),snapshot={};
 for(const name of tables){const columns=raw.prepare('PRAGMA table_info('+name+')').all();snapshot[name]={columns,rows:raw.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()};}
 const deviceSchema=raw.prepare("SELECT sql FROM sqlite_master WHERE name='ai_channel_devices'").get().sql;assert.match(deviceSchema,/CHECK\(provider='Codex'\)/);raw.close();raw=null;
 for(let pass=0;pass<2;pass++){
  database=openSocialDatabase(filename);
  for(const [name,before]of Object.entries(snapshot)){
   const columns=database.raw.prepare('PRAGMA table_info('+name+')').all();assert.deepEqual(columns.slice(0,before.columns.length),before.columns,name+' retains old columns');
   const projection=before.columns.map(column=>'"'+column.name+'"').join(','),where=name==='social_migrations'?' WHERE version<=21':'';
   assert.deepEqual(database.raw.prepare('SELECT '+projection+' FROM '+name+where+' ORDER BY rowid').all(),before.rows,name+' preserves every historical field and row');
  }
  assert.deepEqual({...database.raw.prepare('SELECT providers,scanned_at FROM ai_channel_devices').get()},{providers:'[]',scanned_at:0});assert.equal(database.raw.prepare('SELECT provider FROM ai_channel_tasks').get().provider,'codex');
  assert.match(database.raw.prepare("SELECT sql FROM sqlite_master WHERE name='ai_channel_devices'").get().sql,/CHECK\(provider='Codex'\)/);
  assert.equal(database.raw.prepare('SELECT checksum FROM social_migrations WHERE version=22').get().checksum,sha(readFileSync(new URL('024-ai-providers.sql',migrationsURL),'utf8')));
  assert.equal(database.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(database.raw.prepare('PRAGMA foreign_key_check').all(),[]);database.close();database=null;
 }
});
