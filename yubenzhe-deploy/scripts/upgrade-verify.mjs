import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openSocialDatabase} from '../server/social-database.mjs';
import {openAiDatabase} from '../server/ai-database.mjs';
import {openDatabase} from '../server/sqlite-adapter.mjs';
import {RETIRED_SERVICE_TABLES} from '../server/retire-points-history.mjs';

const quote=value=>'"'+value.replaceAll('"','""')+'"';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const rowHash=(columns,rows)=>sha256(JSON.stringify(rows.map(row=>JSON.stringify(columns.map(column=>row[column]))).sort()));
const kinds=['social','ai','admin'];

export function snapshotUpgradeDatabase(filename){
 const db=new DatabaseSync(filename,{readOnly:true});
 try{
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
   .filter(row=>!['social_migrations','ai_migrations','deployment_migrations'].includes(row.name))
   .map(({name})=>{
    const columns=db.prepare('PRAGMA table_info('+quote(name)+')').all().map(column=>column.name);
    const rows=db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(name)).all();
    return {name,columns,count:rows.length,digest:rowHash(columns,rows)};
   });
 }finally{db.close();}
}

function verifiedRetirementArchive(filename,tables){
 const folder=join(dirname(resolve(filename)),'retired-service-history');
 let entries;
 try{
  if(!lstatSync(folder).isDirectory()||lstatSync(folder).isSymbolicLink())throw Error();
  entries=readdirSync(folder,{withFileTypes:true});
 }catch{throw Error('Retired service history requires a complete verified JSON and SHA-256 archive.');}
 const names=tables.map(table=>table.name).sort();
 for(const entry of entries){
  if(!entry.isFile()||entry.isSymbolicLink()||!/^history-[a-f0-9-]+\.json$/.test(entry.name))continue;
  const path=join(folder,entry.name);
  try{
   const checksumStat=lstatSync(path+'.sha256');
   if(!checksumStat.isFile()||checksumStat.isSymbolicLink())continue;
   const bytes=readFileSync(path),checksum=readFileSync(path+'.sha256','utf8').trim();
   if(!/^[a-f0-9]{64}$/.test(checksum)||sha256(bytes)!==checksum)continue;
   const value=JSON.parse(bytes);
   if(value?.format!=='ybz-retired-service-history'||value.version!==1||!value.tables||Array.isArray(value.tables))continue;
   if(JSON.stringify(Object.keys(value.tables).sort())!==JSON.stringify(names))continue;
   const complete=tables.every(table=>{
    const rows=value.tables[table.name];
    return Array.isArray(rows)&&rows.length===table.count&&rows.every(row=>
     row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===table.columns.length&&
     table.columns.every(column=>Object.hasOwn(row,column)))&&rowHash(table.columns,rows)===table.digest;
   });
   if(complete)return {filename:entry.name,sha256:checksum};
  }catch{ /* An unrelated, incomplete or tampered archive cannot authorize retirement. */ }
 }
 throw Error('Retired service history archive missing, damaged or different from the pre-upgrade records.');
}

export function verifyUpgradedDatabase({filename,raw,before,kind}){
 if(!kinds.includes(kind))throw Error('Unknown database kind.');
 const present=new Set(raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
 const missing=before.filter(table=>!present.has(table.name));
 for(const table of missing){
  if(kind!=='social'||!RETIRED_SERVICE_TABLES.includes(table.name))throw Error('Existing table removed: '+table.name);
 }
 // One matching archive must contain the entire pre-upgrade retired-table suite;
 // combining partial archives, trusting a checksum alone, or allowing other tables is unsafe.
 const retired=before.filter(table=>RETIRED_SERVICE_TABLES.includes(table.name));
 const archive=missing.length&&retired.some(table=>table.count>0)?verifiedRetirementArchive(filename,retired):null;
 const checks=before.map(table=>{
  if(!present.has(table.name))return {table:table.name,retired:true,archived:archive?table.count:0,...(archive?{archive:archive.filename,sha256:archive.sha256}:{empty:true})};
  const rows=raw.prepare('SELECT '+table.columns.map(quote).join(',')+' FROM '+quote(table.name)).all();
  if(rows.length!==table.count||rowHash(table.columns,rows)!==table.digest)throw Error('Existing records changed in '+table.name);
  return {table:table.name,preserved:rows.length};
 });
 const integrity=raw.prepare('PRAGMA integrity_check').all();
 if(integrity.length!==1||integrity[0].integrity_check!=='ok'||raw.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database integrity failed');
 return {kind,integrity:'ok',existingRecordsPreserved:true,survivingRecordsUnchanged:true,existingRecordsUnchanged:missing.length===0,tables:checks};
}

// Only run against an isolated restored suite after both live writers are stopped
// and a complete backup exists. This verification does not roll back migrations.
export function verifyUpgrade(files){
 if(!Array.isArray(files)||files.length!==3)throw Error('Usage: upgrade-verify.mjs social.sqlite ai.sqlite admin.sqlite (stop all writers and back up first)');
 const before=files.map(snapshotUpgradeDatabase),openers=[openSocialDatabase,openAiDatabase,openDatabase],databases=[];
 for(let index=0;index<files.length;index++){
  const database=openers[index](files[index]);
  try{databases.push(verifyUpgradedDatabase({filename:files[index],raw:database.raw,before:before[index],kind:kinds[index]}));}
  finally{database.close();}
 }
 return {verifiedAt:new Date().toISOString(),databases};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 console.log(JSON.stringify(verifyUpgrade(process.argv.slice(2))));
}
