import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {openSocialDatabase} from '../server/social-database.mjs';
import {archiveRetiredServiceHistory,RETIRED_SERVICE_TABLES} from '../server/retire-points-history.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const migrationsURL=new URL('../migrations/',import.meta.url);
const oldFiles=readdirSync(migrationsURL).filter(name=>/^0(?:0[3-9]|1[0-9])-[a-z-]+\.sql$/.test(name)).sort();
const A='11111111-1111-4111-a111-111111111111',B='22222222-2222-4222-a222-222222222222',C='33333333-3333-4333-a333-333333333333';
const G='44444444-4444-4444-a444-444444444444',W='55555555-5555-4555-a555-555555555555',T='66666666-6666-4666-a666-666666666666';
const F='77777777-7777-4777-a777-777777777777',O='88888888-8888-4888-a888-888888888888';

function installOldSchema(raw){
 assert.equal(oldFiles.length,17,'Fixture must represent every migration 003 through 019, excluding the new feature.');
 raw.exec('PRAGMA foreign_keys=ON; CREATE TABLE social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);');
 for(const [index,name] of oldFiles.entries()){
  const sql=readFileSync(new URL(name,migrationsURL),'utf8');
  // These fixtures have no accounts or retired SIM assets before migration015.
  // No runtime archive or user database is opened by this isolated schema builder.
  raw.exec(sql);raw.prepare('INSERT INTO social_migrations VALUES(?,?,?)').run(index+1,sha256(sql),1000+index);
 }
 assert.equal(raw.prepare("SELECT count(*) n FROM sqlite_master WHERE name='group_workflows'").get().n,0);
}

function seedExistingData(raw){
 const time=1700000000000;
 for(const [index,id] of [A,B,C].entries()){
  raw.prepare('INSERT INTO accounts(id,user_id,nickname,bio,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(id,String(73918260+index),'迁移前合成用户 '+index,'必须原样保留的资料','synthetic-test-salt','00'.repeat(32),time);
  raw.prepare('INSERT INTO user_ids(user_id,account_id) VALUES(?,?)').run(String(73918260+index),id);
 }
 raw.prepare('INSERT INTO friendships VALUES(?,?,?)').run(A,B,time);
 raw.prepare('INSERT INTO friendships VALUES(?,?,?)').run(A,C,time);
 raw.prepare("INSERT INTO conversations(id,type,name,note,owner_id,created_at,updated_at) VALUES(?,'group',?,?,?,?,?)").run(G,'旧群不能丢失','迁移只增表，不重写用户内容。',A,time,time);
 for(const id of [A,B,C])raw.prepare('INSERT INTO conversation_members(conversation_id,account_id,joined_at) VALUES(?,?,?)').run(G,id,time);
 raw.prepare("INSERT INTO messages(conversation_id,sender,client_id,type,text,created_at) VALUES(?,?,?,'text',?,?)").run(G,A,'old-message-from-a','迁移前的群消息 A',time);
 raw.prepare("INSERT INTO messages(conversation_id,sender,client_id,type,text,created_at) VALUES(?,?,?,'text',?,?)").run(G,B,'old-message-from-b','迁移前的群消息 B',time+1);
 raw.prepare("INSERT INTO workbench_workspaces(id,owner_id,state,controller,created_at,updated_at) VALUES(?,?,'suspended','ai',?,?)").run(W,A,time,time);
 raw.prepare("INSERT INTO workbench_tasks(id,owner_id,workspace_id,title,operation,input_ids,status,quote_expires_at,estimated_micro,budget_micro,cost_micro,billing_state,price_version,goal,plan_version,plan_json,billing_unit,estimated_points,budget_points,spent_points,released_points,points_price_version,created_at,updated_at) VALUES(?,?,?,?,?,?,'succeeded',?,?,?,?,'settled',?,?,1,?,'POINT','30','100','30','70','local-points-v1',?,?)").run(T,A,W,'迁移前的去重任务','deduplicate',JSON.stringify([F]),time+60000,'30000','0','21000','old-price-v1','将附件按行去重',JSON.stringify({operation:'deduplicate',planner:'local-rules'}),time,time);
 for(const [id,kind,name,content] of [[F,'input','旧输入.txt',Buffer.from('one\none\ntwo')],[O,'output','旧成果.txt',Buffer.from('one\ntwo')]]){
  raw.prepare('INSERT INTO workbench_files VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,A,kind==='output'?T:null,name,'text/plain; charset=utf-8',content,sha256(content),content.length,kind,time,time+86400000);
 }
 raw.prepare("INSERT INTO workbench_invoices VALUES(?,?,?,?,?,?,'local-points','settled',?)").run('migration-old-invoice',T,A,'21000','0','0',time);
 raw.prepare('INSERT INTO points_accounts(owner_id,available,reserved,created_at,updated_at) VALUES(?,?,?,?,?)').run(A,'970','0',time,time);
 raw.prepare("INSERT INTO points_transactions VALUES(?,?,?,?,?,?,'settled',?,?,?)").run('old-points-grant',A,'old-grant-request','old-grant-signature','welcome','1000',null,'{}',time);
 raw.prepare("INSERT INTO points_transactions VALUES(?,?,?,?,?,?,'settled',?,?,?)").run('old-points-spend',A,'old-spend-request','old-spend-signature','service','-30',T,'{}',time+1);
 raw.prepare('INSERT INTO points_entries VALUES(?,?,?,?)').run('old-entry-1','old-points-grant',A+':available','1000');
 raw.prepare('INSERT INTO points_entries VALUES(?,?,?,?)').run('old-entry-2','old-points-grant','system:issued','-1000');
 raw.prepare('INSERT INTO points_entries VALUES(?,?,?,?)').run('old-entry-3','old-points-spend',A+':available','-30');
 raw.prepare('INSERT INTO points_entries VALUES(?,?,?,?)').run('old-entry-4','old-points-spend','system:consumed','30');
 raw.prepare("INSERT INTO points_reservations VALUES(?,?,?,'30','70','settled',?)").run(T,A,'100',time);
 for(const [index,state] of ['paired','pending','revoked'].entries()){
  raw.prepare('INSERT INTO personal_devices(id,owner_id,name,pair_hash,pair_expires,token_hash,created_at,last_seen,revoked_at,session_id,session_until,agent_status,viewer_until) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('old-device-'+index,A,'旧设备 '+state,state==='pending'?sha256('synthetic-pair-hash'):null,time+600000,state==='paired'?sha256('synthetic-token-hash'):null,time,time,state==='revoked'?time:null,state==='paired'?'old-control-session':null,state==='paired'?time+600000:null,state==='paired'?'ready':'',state==='paired'?time+15000:null);
 }
 raw.prepare('INSERT INTO personal_device_commands VALUES(?,?,?,?,?,?,?,?)').run('old-control-command','old-device-0','old-control-session','old-control-request',sha256('synthetic-control-payload'),'done',time,time+15000);
 assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
}

function tableSnapshot(raw,names){
 return Object.fromEntries(names.map(name=>{
  assert.match(name,/^[a-z][a-z0-9_]*$/);
  const schema=raw.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name).sql;
  const rows=raw.prepare('SELECT * FROM "'+name+'"').all().map(row=>JSON.stringify(Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Uint8Array?{bytes:Buffer.from(value).toString('hex')}:value])))).sort();
  return [name,{schema,rows,checksum:sha256(JSON.stringify({schema,rows}))}];
 }));
}

test('migrations020 through027 preserve nonretired history, archive retired tables and add device metadata',t=>{
 const parent=realpathSync(tmpdir()),directory=mkdtempSync(join(parent,'ybz-group-migration-')),filename=join(directory,'synthetic-social.sqlite');
 let raw=null,database=null;
 t.after(()=>{
  try{database?.close();}finally{raw?.close();}
  // Resolve and verify the exact test directory before recursive cleanup on Windows.
  const actual=realpathSync(directory);
  assert.equal(dirname(actual).toLowerCase(),parent.toLowerCase());
  assert.ok(basename(actual).startsWith('ybz-group-migration-'));
  assert.equal(resolve(actual).toLowerCase(),resolve(directory).toLowerCase());
  rmSync(actual,{recursive:true,force:true});
 });
 raw=new DatabaseSync(filename);installOldSchema(raw);seedExistingData(raw);
 const names=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'social_migrations' ORDER BY name").all().map(row=>row.name);
 const unchangedNames=names.filter(name=>!['personal_devices','messages','conversations'].includes(name)&&!RETIRED_SERVICE_TABLES.includes(name));
 const altered=['messages','conversations'].map(name=>{const columns=raw.prepare('PRAGMA table_info('+name+')').all(),projection=columns.map(c=>'"'+c.name+'"').join(',');return {name,columns,projection,rows:raw.prepare('SELECT '+projection+' FROM '+name+' ORDER BY id').all()};});
 const retiredBefore=Object.fromEntries(RETIRED_SERVICE_TABLES.map(name=>[name,raw.prepare('SELECT * FROM '+name+' ORDER BY rowid').all().map(row=>({...row}))]));
 const before=tableSnapshot(raw,unchangedNames),oldMigrations=raw.prepare('SELECT * FROM social_migrations ORDER BY version').all();
 const oldColumns=raw.prepare('PRAGMA table_info(personal_devices)').all();
 const deviceProjection=oldColumns.map(c=>'"'+c.name+'"').join(',');
 const oldDevices=raw.prepare('SELECT '+deviceProjection+' FROM personal_devices ORDER BY id').all();
 assert.equal(oldMigrations.length,17);raw.close();raw=null;
 for(let pass=0;pass<2;pass++){
  database=openSocialDatabase(filename);
  assert.deepEqual(tableSnapshot(database.raw,unchangedNames),before,'Unchanged business tables retain every row, BLOB byte and definition.');
  for(const old of altered){assert.deepEqual(database.raw.prepare('SELECT '+old.projection+' FROM '+old.name+' ORDER BY id').all(),old.rows,'Every existing social message and group field is preserved');const info=database.raw.prepare('PRAGMA table_info('+old.name+')').all();assert.deepEqual(info.slice(0,old.columns.length),old.columns);assert.deepEqual(info.slice(old.columns.length).map(c=>c.name),old.name==='messages'?['provider','device_id','ai_alias','ai_session_id']:['allow_device_ai','ai_roster_version','ai_owner_revision']);}
  assert.ok(database.raw.prepare('SELECT provider,device_id FROM messages').all().every(row=>row.provider===''&&row.device_id===null));assert.ok(database.raw.prepare('SELECT allow_device_ai FROM conversations').all().every(row=>row.allow_device_ai===0));
  assert.equal(database.raw.prepare("SELECT 1 FROM sqlite_master WHERE name='ai_channel_one_running'").get(),undefined);assert.equal(database.raw.prepare("SELECT sql FROM sqlite_master WHERE name='ai_channel_running'").get().sql.includes('UNIQUE'),false);
  assert.deepEqual(database.raw.prepare('SELECT '+deviceProjection+' FROM personal_devices ORDER BY id').all(),oldDevices,'All legacy device values and credentials remain byte-for-byte intact.');
  const columns=database.raw.prepare('PRAGMA table_info(personal_devices)').all();
  assert.deepEqual(columns.slice(0,oldColumns.length),oldColumns,'Existing device columns retain their definitions.');
  assert.deepEqual(columns.slice(oldColumns.length).map(c=>c.name),['source','capabilities','capabilities_at']);
  for(const d of database.raw.prepare('SELECT source,capabilities,capabilities_at FROM personal_devices').all())assert.deepEqual({...d},{source:'local',capabilities:'{}',capabilities_at:null});
  assert.deepEqual(database.raw.prepare('SELECT * FROM social_migrations WHERE version<=17 ORDER BY version').all(),oldMigrations);
  assert.equal(database.raw.prepare('SELECT count(*) n FROM social_migrations').get().n,25);
  assert.equal(database.raw.prepare('SELECT checksum FROM social_migrations WHERE version=20').get().checksum,sha256(readFileSync(new URL('022-device-claims-capabilities.sql',migrationsURL),'utf8')));
  for(const table of ['device_pair_claims','device_pair_rates'])assert.equal(database.raw.prepare('SELECT count(*) n FROM '+table).get().n,0);
  const current=database.raw.prepare('SELECT checksum FROM social_migrations WHERE version=18').get();
  assert.equal(current.checksum,sha256(readFileSync(new URL('020-group-workflows.sql',migrationsURL),'utf8')));
  for(const name of ['group_workflows','group_workflow_events','group_workflow_commands','group_workflow_payments'])assert.equal(database.raw.prepare('SELECT count(*) n FROM '+name).get().n,0);
  assert.deepEqual(database.raw.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(database.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  for(const name of RETIRED_SERVICE_TABLES)assert.equal(database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name),undefined);
  const archives=readdirSync(join(directory,'retired-service-history')).filter(name=>name.endsWith('.json'));assert.equal(archives.length,1,'Reopening does not archive or mutate a second time.');
  const archivePath=join(directory,'retired-service-history',archives[0]),bytes=readFileSync(archivePath);
  assert.equal(sha256(bytes),readFileSync(archivePath+'.sha256','utf8').trim());
  assert.deepEqual(JSON.parse(bytes).tables,retiredBefore,'Every retired historical value is preserved in the verified offline archive.');
  assert.equal(database.raw.prepare('SELECT checksum FROM social_migrations WHERE version=21').get().checksum,sha256(readFileSync(new URL('023-drop-points.sql',migrationsURL),'utf8')));
  assert.equal(Buffer.from(database.raw.prepare('SELECT content FROM workbench_files WHERE id=?').get(O).content).toString(),'one\ntwo');
  database.close();database=null;
 }
});

test('retirement fails atomically when offline archive cannot be written',t=>{
 const parent=realpathSync(tmpdir()),directory=mkdtempSync(join(parent,'ybz-retirement-failure-')),filename=join(directory,'synthetic.sqlite');
 let raw=new DatabaseSync(filename);installOldSchema(raw);seedExistingData(raw);
 const before=Object.fromEntries(RETIRED_SERVICE_TABLES.map(name=>[name,raw.prepare('SELECT * FROM '+name).all()]));raw.close();raw=null;
 writeFileSync(join(directory,'retired-service-history'),'intentional archive directory blocker',{flag:'wx'});
 t.after(()=>{raw?.close();const actual=realpathSync(directory);assert.equal(dirname(actual).toLowerCase(),parent.toLowerCase());assert.ok(basename(actual).startsWith('ybz-retirement-failure-'));rmSync(actual,{recursive:true,force:true});});
 assert.throws(()=>openSocialDatabase(filename));
 raw=new DatabaseSync(filename);
 assert.equal(raw.prepare('SELECT count(*) n FROM social_migrations').get().n,17);
 assert.equal(raw.prepare("SELECT name FROM sqlite_master WHERE name='group_workflows'").get(),undefined);
 for(const name of RETIRED_SERVICE_TABLES)assert.deepEqual(raw.prepare('SELECT * FROM '+name).all(),before[name]);
 assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('populated memory history is refused without an offline archive',()=>{
 const raw=new DatabaseSync(':memory:');try{installOldSchema(raw);seedExistingData(raw);assert.throws(()=>archiveRetiredServiceHistory(raw,':memory:'),/on-disk archive/);assert.equal(raw.prepare('SELECT count(*) n FROM points_accounts').get().n,1);}finally{raw.close();}
});
test('fresh databases never create an archive and historical checksums are unchanged',()=>{
 const db=openSocialDatabase(':memory:');try{for(const name of RETIRED_SERVICE_TABLES)assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name=?").get(name),undefined);
 for(const name of ['014-points.sql','015-retire-platform-assets.sql','021-ai-channel.sql']){const index=[...oldFiles,'020-group-workflows.sql','021-ai-channel.sql','022-device-claims-capabilities.sql','023-drop-points.sql'].indexOf(name)+1;assert.equal(db.raw.prepare('SELECT checksum FROM social_migrations WHERE version=?').get(index).checksum,sha256(readFileSync(new URL(name,migrationsURL))));}
 assert.match(readFileSync(new URL('021-ai-channel.sql',migrationsURL),'utf8'),/lease_id/);
 }finally{db.close();}
});
