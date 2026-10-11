import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {openAiDatabase} from '../server/ai-database.mjs';
import {openDatabase} from '../server/sqlite-adapter.mjs';
const files=process.argv.slice(2);
if(files.length!==3)throw Error('Usage: upgrade-verify.mjs social.sqlite ai.sqlite admin.sqlite (stop all writers and back up first)');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const hash=rows=>createHash('sha256').update(JSON.stringify(rows.map(row=>JSON.stringify(row)).sort())).digest('hex');
function snapshot(filename){const db=new DatabaseSync(filename,{readOnly:true});try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().filter(row=>!row.name.endsWith('_migrations')).map(({name})=>{const columns=db.prepare('PRAGMA table_info('+quote(name)+')').all().map(x=>x.name);const rows=db.prepare('SELECT '+columns.map(quote).join(',')+' FROM '+quote(name)).all();return {name,columns,count:rows.length,digest:hash(rows)};});}finally{db.close();}}
const before=files.map(snapshot);const openers=[openSocialDatabase,openAiDatabase,openDatabase];const result=[];
for(let i=0;i<files.length;i++){const db=openers[i](files[i]);try{const checks=before[i].map(table=>{const rows=db.raw.prepare('SELECT '+table.columns.map(quote).join(',')+' FROM '+quote(table.name)).all();if(rows.length!==table.count||hash(rows)!==table.digest)throw Error('Existing records changed in '+table.name);return {table:table.name,preserved:rows.length};});if(db.raw.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.raw.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database integrity failed');result.push({kind:['social','ai','admin'][i],integrity:'ok',existingRecordsUnchanged:true,tables:checks});}finally{db.close();}}
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),databases:result}));
