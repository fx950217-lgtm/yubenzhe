import {mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const RETIRED_SERVICE_TABLES=Object.freeze(['points_entries','points_transactions','points_reservations','points_accounts']);
const hash=value=>createHash('sha256').update(value).digest('hex');
// Runs under the migration write lock. It preserves history offline, never creates a replacement ledger.
// Administrators must still stop both writers and make a full SQLite backup before a production upgrade.
export function archiveRetiredServiceHistory(raw,filename){
 const present=new Set(raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
 const tables=Object.fromEntries(RETIRED_SERVICE_TABLES.filter(name=>present.has(name)).map(name=>[name,raw.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
 const rows=Object.values(tables).reduce((total,list)=>total+list.length,0);if(!rows)return null;
 if(filename===':memory:')throw Error('Populated retired service history requires a verified on-disk archive.');
 const payload=JSON.stringify({format:'ybz-retired-service-history',version:1,createdAt:new Date().toISOString(),scope:'Offline historical records only; no conversion or active service entitlement.',tables});
 const checksum=hash(payload),folder=join(dirname(resolve(filename)),'retired-service-history'),path=join(folder,'history-'+randomUUID()+'.json');
 mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(path,payload,{flag:'wx',mode:0o600});chmodSync(path,0o600);
 if(hash(readFileSync(path))!==checksum)throw Error('Service history archive verification failed; migration aborted.');
 writeFileSync(path+'.sha256',checksum+'\n',{flag:'wx',mode:0o600});
 if(readFileSync(path+'.sha256','utf8').trim()!==checksum)throw Error('Service archive checksum verification failed; migration aborted.');
 return {path,sha256:checksum,rows};
}
