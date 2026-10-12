import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readdirSync,writeFileSync,renameSync,existsSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {snapshotUpgradeDatabase,verifyUpgradedDatabase,verifyUpgrade} from '../scripts/upgrade-verify.mjs';
import {openSocialDatabase} from '../server/social-database.mjs';
import {openAiDatabase} from '../server/ai-database.mjs';
import {openDatabase} from '../server/sqlite-adapter.mjs';
import {RETIRED_SERVICE_TABLES} from '../server/retire-points-history.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const migrations=new URL('../migrations/',import.meta.url);
const oldFiles=readdirSync(migrations).filter(name=>/^\d{3}-[a-z-]+\.sql$/.test(name)&&Number(name.slice(0,3))>=3&&Number(name.slice(0,3))<=22).sort();
const account='11111111-1111-4111-a111-111111111111';
function fixture(t,{populated=true,lastMigration=22}={}){
 const parent=realpathSync(tmpdir()),directory=mkdtempSync(join(parent,'ybz-upgrade-verify-'));
 const files=['social.sqlite','ai.sqlite','admin.sqlite'].map(name=>join(directory,name));
 t.after(()=>{
  const actual=realpathSync(directory);
  assert.equal(dirname(actual).toLowerCase(),parent.toLowerCase());
  assert.ok(basename(actual).startsWith('ybz-upgrade-verify-'));
  assert.equal(resolve(actual).toLowerCase(),resolve(directory).toLowerCase());
  rmSync(actual,{recursive:true,force:true});
 });
 const raw=new DatabaseSync(files[0]);
 try{
   const appliedFiles=oldFiles.filter(name=>Number(name.slice(0,3))<=lastMigration);
   assert.equal(appliedFiles.length,lastMigration-2,'Fixture includes the complete historical migration prefix.');
  raw.exec('PRAGMA foreign_keys=ON;CREATE TABLE social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)');
   for(const [index,name]of appliedFiles.entries()){
   const sql=readFileSync(new URL(name,migrations),'utf8');raw.exec(sql);
   raw.prepare('INSERT INTO social_migrations VALUES(?,?,?)').run(index+1,sha256(sql),1000+index);
  }
  raw.prepare('INSERT INTO accounts(id,user_id,nickname,bio,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(account,'73918260','合成升级用户','保留资料','test-salt','00'.repeat(32),1700000000000);
  raw.prepare('INSERT INTO user_ids(user_id,account_id) VALUES(?,?)').run('73918260',account);
  // Unknown tables and BLOBs must receive the same record-preservation checks.
  raw.exec("CREATE TABLE release_probe(id TEXT PRIMARY KEY,body BLOB);INSERT INTO release_probe VALUES('before',x'000102ff');CREATE TABLE private_migrations(id TEXT);INSERT INTO private_migrations VALUES('keep')");
  if(populated){
   raw.prepare('INSERT INTO points_accounts(owner_id,available,reserved,created_at,updated_at) VALUES(?,?,?,?,?)').run(account,'70','30',1700000000000,1700000000000);
   raw.prepare("INSERT INTO points_transactions VALUES(?,?,?,?,?,?,'settled',?,?,?)").run('transaction',account,'request','signature','welcome','100',null,'{}',1700000000000);
   raw.prepare('INSERT INTO points_entries VALUES(?,?,?,?)').run('entry','transaction',account+':available','100');
   raw.prepare("INSERT INTO points_reservations VALUES(?,?,?,'0','0','reserved',?)").run('task',account,'30',1700000000000);
  }
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{raw.close();}
 for(const [index,opener]of [openAiDatabase,openDatabase].entries()){
  const db=opener(files[index+1]);
  try{db.raw.exec("CREATE TABLE release_probe(id TEXT PRIMARY KEY,body BLOB);INSERT INTO release_probe VALUES('before',x'000102ff')");}finally{db.close();}
 }
 return {directory,files};
}
function upgradedSocial(f){
 const before=snapshotUpgradeDatabase(f.files[0]);
 const db=openSocialDatabase(f.files[0]);
 return {before,db,verify:()=>verifyUpgradedDatabase({filename:f.files[0],raw:db.raw,before,kind:'social'})};
}
function archive(f){const folder=join(f.directory,'retired-service-history');const names=readdirSync(folder).filter(name=>name.endsWith('.json'));assert.equal(names.length,1);return join(folder,names[0]);}
function rewriteArchive(path,edit){const value=JSON.parse(readFileSync(path,'utf8'));edit(value);const bytes=JSON.stringify(value);writeFileSync(path,bytes);writeFileSync(path+'.sha256',sha256(bytes)+'\n');}

test('isolated old three-database suite upgrades and every retired record is verified in one complete archive',t=>{
 const f=fixture(t),old=snapshotUpgradeDatabase(f.files[0]);
 const result=verifyUpgrade(f.files);
 assert.deepEqual(result.databases.map(db=>db.kind),['social','ai','admin']);
 for(const db of result.databases){assert.equal(db.integrity,'ok');assert.equal(db.existingRecordsPreserved,true);assert.equal(db.survivingRecordsUnchanged,true);assert.equal(db.existingRecordsUnchanged,db.kind!=='social');assert.deepEqual(db.tables.find(table=>table.table==='release_probe'),{table:'release_probe',preserved:1});}
 const retired=result.databases[0].tables.filter(table=>table.retired);
 assert.deepEqual(retired.map(table=>table.table).sort(),[...RETIRED_SERVICE_TABLES].sort());
 for(const table of retired){assert.equal(table.archived,1);assert.match(table.archive,/^history-/);assert.match(table.sha256,/^[a-f0-9]{64}$/);assert.equal(table.empty,undefined);}
 assert.equal(new Set(retired.map(table=>table.archive)).size,1);
 const raw=new DatabaseSync(f.files[0],{readOnly:true});
 try{
  assert.equal(raw.prepare('SELECT count(*) n FROM social_migrations').get().n,26);
  for(const [index,name]of oldFiles.entries())assert.deepEqual({...raw.prepare('SELECT checksum,applied_at FROM social_migrations WHERE version=?').get(index+1)},{checksum:sha256(readFileSync(new URL(name,migrations),'utf8')),applied_at:1000+index});
  assert.equal(raw.prepare('SELECT nickname FROM accounts').get().nickname,'合成升级用户');
 }finally{raw.close();}
 assert.equal(old.filter(table=>RETIRED_SERVICE_TABLES.includes(table.name)).length,4);
 const savedArchive=readFileSync(archive(f));
 assert.ok(verifyUpgrade(f.files).databases.every(db=>db.existingRecordsUnchanged));
 assert.deepEqual(readFileSync(archive(f)),savedArchive,'reverification creates no second archive');
});

test('empty allowlisted tables retire with an explicit empty result and require no fabricated archive',t=>{
 const f=fixture(t,{populated:false});const result=verifyUpgrade(f.files);
 const retired=result.databases[0].tables.filter(table=>table.retired);
 assert.equal(retired.length,4);
 assert.equal(result.databases[0].existingRecordsPreserved,true);
 assert.equal(result.databases[0].survivingRecordsUnchanged,true);
 assert.equal(result.databases[0].existingRecordsUnchanged,false);
 for(const table of retired)assert.deepEqual(table,{table:table.table,retired:true,archived:0,empty:true});
 assert.equal(existsSync(join(f.directory,'retired-service-history')),false);
});

test('the current dev.10 server migration prefix upgrades without losing identities or retired history',t=>{
  const f=fixture(t,{lastMigration:19});
  const prior=new DatabaseSync(f.files[0],{readOnly:true});
  try{assert.equal(prior.prepare('SELECT count(*) n FROM social_migrations').get().n,17);}finally{prior.close();}
  const result=verifyUpgrade(f.files);
  assert.ok(result.databases.every(db=>db.existingRecordsPreserved&&db.survivingRecordsUnchanged));
  assert.equal(result.databases[0].tables.filter(table=>table.retired).length,4);
  const current=new DatabaseSync(f.files[0],{readOnly:true});
  try{
    assert.equal(current.prepare('SELECT count(*) n FROM social_migrations').get().n,26);
    assert.equal(current.prepare('SELECT nickname FROM accounts WHERE id=?').get(account).nickname,'合成升级用户');
  }finally{current.close();}
});

for(const [name,damage]of [
 ['missing JSON',path=>renameSync(path,path+'.unavailable')],
 ['missing checksum',path=>renameSync(path+'.sha256',path+'.sha256.unavailable')],
 ['altered JSON bytes',path=>writeFileSync(path,readFileSync(path,'utf8')+'\n')],
 ['altered checksum',path=>writeFileSync(path+'.sha256','0'.repeat(64))],
 ['record changed with recomputed checksum',path=>rewriteArchive(path,value=>{value.tables.points_accounts[0].available='999';})],
 ['table omitted with recomputed checksum',path=>rewriteArchive(path,value=>{delete value.tables.points_entries;})],
 ['column omitted with recomputed checksum',path=>rewriteArchive(path,value=>{delete value.tables.points_accounts[0].closed_at;})],
 ['unrelated extra table',path=>rewriteArchive(path,value=>{value.tables.secret_records=[];})],
 ['invalid archive format',path=>rewriteArchive(path,value=>{value.format='other';})],
])test('retirement verification refuses '+name,t=>{
 const f=fixture(t),check=upgradedSocial(f);
 try{damage(archive(f));assert.throws(check.verify,/archive/i);}finally{check.db.close();}
});

test('allowlisted data without any archive is not treated like empty-table retirement',t=>{
 const f=fixture(t),before=snapshotUpgradeDatabase(f.files[0]),raw=new DatabaseSync(f.files[0]);
 try{
  raw.exec('DROP TABLE points_entries;DROP TABLE points_transactions;DROP TABLE points_reservations;DROP TABLE points_accounts');
  assert.throws(()=>verifyUpgradedDatabase({filename:f.files[0],raw,before,kind:'social'}),/archive/i);
 }finally{raw.close();}
});

for(const name of ['release_probe','private_migrations'])test('verification protects unknown table '+name+' even with valid retired history',t=>{
 const f=fixture(t),check=upgradedSocial(f);
 try{check.db.raw.exec('DROP TABLE '+name);assert.throws(check.verify,new RegExp('Existing table removed: '+name));}finally{check.db.close();}
});

for(const sql of ["UPDATE release_probe SET body=x'000102fe'","DELETE FROM release_probe","INSERT INTO release_probe VALUES('extra',x'ff')"])
 test('verification rejects changed retained records: '+sql,t=>{
  const f=fixture(t),check=upgradedSocial(f);
  try{check.db.raw.exec(sql);assert.throws(check.verify,/Existing records changed in release_probe/);}finally{check.db.close();}
 });

test('the retired social table allowlist never permits a same-named AI table to disappear',t=>{
 const f=fixture(t),raw=new DatabaseSync(f.files[1]);
 try{raw.exec('CREATE TABLE points_accounts(id TEXT)');}finally{raw.close();}
 const before=snapshotUpgradeDatabase(f.files[1]),after=new DatabaseSync(f.files[1]);
 try{after.exec('DROP TABLE points_accounts');assert.throws(()=>verifyUpgradedDatabase({filename:f.files[1],raw:after,before,kind:'ai'}),/Existing table removed: points_accounts/);}finally{after.close();}
});
