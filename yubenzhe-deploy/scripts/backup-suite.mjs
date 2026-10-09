import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readFile, writeFile, chmod, stat, realpath, readdir, rm, copyFile } from 'node:fs/promises';
import { resolve, join, dirname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const names={social:'social/social.sqlite',ai:'ai/workspaces.sqlite',admin:'admin/acceptance.sqlite'};
function inspect(file){const db=new DatabaseSync(file,{readOnly:true});try{const integrity=db.prepare('PRAGMA integrity_check').all();if(integrity.length!==1||integrity[0].integrity_check!=='ok')throw Error('Database integrity check failed.');if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database foreign key check failed.');const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);return Object.fromEntries(tables.map(name=>[name,db.prepare('SELECT count(*) n FROM "'+name.replace(/"/g,'""')+'"').get().n]));}finally{db.close();}}
export async function backupSuite({sources,destination,retentionDays=14,now=new Date()}){
 if(!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>365)throw Error('Retention must be 1–365 days.');
 sources=await realpath(resolve(sources));await mkdir(resolve(destination),{recursive:true,mode:0o700});destination=await realpath(resolve(destination));
 if(destination===sources||destination.startsWith(sources+'/')||destination.startsWith(sources+'\\'))throw Error('Backup destination must be separate from sources.');
 const folder=join(destination,'snapshot-'+now.toISOString().replace(/[-:.]/g,'')+'-'+randomUUID().slice(0,8));await mkdir(folder,{mode:0o700});
 const manifest={schema:1,createdAt:now.toISOString(),retentionDays,databases:{}};
 for(const [key,name]of Object.entries(names)){const source=join(sources,name),target=join(folder,key+'.sqlite');const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,target)}finally{db.close()}await chmod(target,0o600);const bytes=await readFile(target);manifest.databases[key]={filename:key+'.sqlite',size:bytes.length,sha256:sha(bytes),tables:inspect(target)};}
 await writeFile(join(folder,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
 // Only prune our own complete snapshots directly inside the verified backup directory.
 for(const entry of await readdir(destination,{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink()||!/^snapshot-[0-9TZ]+-[a-f0-9]{8}$/.test(entry.name))continue;const candidate=await realpath(join(destination,entry.name));if(dirname(candidate)!==destination||candidate===folder)continue;let old;try{old=JSON.parse(await readFile(join(candidate,'manifest.json'),'utf8'))}catch{continue}if(old.schema===1&&Number.isFinite(Date.parse(old.createdAt))&&Date.parse(old.createdAt)<now.getTime()-retentionDays*86400000)await rm(candidate,{recursive:true});}
 return {folder,manifest};
}
export async function restoreDrill({snapshot,destination}){
 snapshot=await realpath(resolve(snapshot));destination=resolve(destination);
 try{await stat(destination);throw Error('Restore drill requires a new destination.');}catch(error){if(error.code!=='ENOENT')throw error;}
 const manifest=JSON.parse(await readFile(join(snapshot,'manifest.json'),'utf8'));
 if(manifest.schema!==1||Object.keys(manifest.databases||{}).sort().join(',')!=='admin,ai,social')throw Error('Invalid backup manifest.');
 await mkdir(destination,{mode:0o700,recursive:false});destination=await realpath(destination);
 const results={};
 for(const key of Object.keys(names)){const record=manifest.databases[key];if(record.filename!==key+'.sqlite')throw Error('Invalid backup filename.');const source=join(snapshot,record.filename),bytes=await readFile(source);if(bytes.length!==record.size||sha(bytes)!==record.sha256)throw Error('Backup checksum mismatch.');const target=join(destination,key+'.sqlite');await copyFile(source,target);await chmod(target,0o600);const tables=inspect(target);if(JSON.stringify(tables)!==JSON.stringify(record.tables))throw Error('Restore table counts differ.');results[key]={integrity:'ok',tables};}
 await writeFile(join(destination,'restore-verification.json'),JSON.stringify({verifiedAt:new Date().toISOString(),sourceSnapshot:basename(snapshot),results},null,2),{mode:0o600,flag:'wx'});
 return {ok:true,results};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 process.umask(0o077);const [mode,source,destination,retention]=process.argv.slice(2);if(!['backup','restore-drill'].includes(mode)||!source||!destination)throw Error('Usage: backup-suite.mjs backup <sources> <backups> [retention-days] | restore-drill <snapshot> <new-directory>');
 const result=mode==='backup'?await backupSuite({sources:source,destination,retentionDays:Number(retention||14)}):await restoreDrill({snapshot:source,destination});console.log(JSON.stringify(mode==='backup'?{ok:true,snapshot:basename(result.folder),databases:Object.keys(result.manifest.databases)}:result));
}
