import {mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const RETIRED_TABLES=Object.freeze(["asset_gift_messages","asset_outbox","asset_claims","asset_gift_eligibility","asset_gifts","asset_deposits","asset_withdrawals","asset_lines","asset_journals","asset_balances","asset_requests","wallet_challenges","wallet_deletions","wallet_binding_history","wallet_bindings","asset_risk","asset_incidents","asset_registry","platform_accounts"]);
const hash=value=>createHash('sha256').update(value).digest('hex');
// This is an offline archive, not a replacement asset account or payment ledger.
// Execute inside the migration's BEGIN IMMEDIATE so archived rows cannot change.
export function archiveRetiredSimulation(raw,filename){
 const present=new Set(raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 if(!present.has('platform_accounts'))return null;
 const registry=raw.prepare('SELECT id,network,contract_address FROM asset_registry').all();
 if(registry.some(r=>!/^SIM-[A-Z0-9-]+$/.test(r.id)||r.network!=='SIM-BSC-97'||!r.contract_address.startsWith('sim://')))throw Error('V0.2 retirement refuses non-SIM assets; requires a separately reviewed data migration.');
 const tables=Object.fromEntries(RETIRED_TABLES.filter(t=>present.has(t)).map(t=>[t,raw.prepare('SELECT * FROM '+t).all()]));
 if(!Object.values(tables).some(rows=>rows.length))return null;
 if(filename===':memory:')throw Error('Cannot retire populated SIM history without an on-disk archive.');
 const payload=JSON.stringify({format:'yubenzhe-v01-retired-simulation',version:1,createdAt:new Date().toISOString(),scope:'Offline history only; no automatic conversion to POINT or chain assets',tables});
 const digest=hash(payload),folder=join(dirname(resolve(filename)),'retired-v01'),path=join(folder,'simulation-'+randomUUID()+'.json');
 mkdirSync(folder,{recursive:true,mode:0o700});writeFileSync(path,payload,{flag:'wx',mode:0o600});chmodSync(path,0o600);
 if(hash(readFileSync(path))!==digest)throw Error('Retired SIM archive verification failed; migration aborted.');
 writeFileSync(path+'.sha256',digest+'\n',{flag:'wx',mode:0o600});
 return {path,sha256:digest,rows:Object.values(tables).reduce((n,r)=>n+r.length,0)};
}
