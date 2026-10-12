import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {fail,fields,text} from './social-validation.mjs';
import {deviceSource,validateDeviceCapabilities} from './device-capabilities.mjs';

export const DEVICE_CLAIM_LIMITS=Object.freeze({lifetimeMs:600000,deliveryMs:600000,attemptsPerMinute:5,pending:1000,rateBuckets:2048});
const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const identifier=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const credential=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
function newCode(){const bytes=randomBytes(8),chars=[...bytes].map(n=>alphabet[n%alphabet.length]).join('');return 'YBZ-'+chars.slice(0,4)+'-'+chars.slice(4);}
function normalizedCode(value){if(typeof value!=='string'||value.length>32)return null;const code=value.toUpperCase().replace(/[\s-]/g,'');return /^YBZ[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code)?'YBZ-'+code.slice(3,7)+'-'+code.slice(7):null;}
export function createDeviceClaims({database,now=Date.now,view,authenticateDevice}){
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 function maintain(){run('DELETE FROM device_pair_claims WHERE (device_id IS NULL AND pair_expires<=?) OR (device_id IS NOT NULL AND delivery_expires<=?)',now(),now());run('DELETE FROM device_pair_rates WHERE started_at<=?',now()-60000);}
 function attempts(ip,owner){
  maintain();const keys=['ip:'+String(ip||'unknown').slice(0,128),...(owner?['owner:'+owner]:[])].map(hash);
  let limited=false,cooldown=false;
  transaction(()=>{for(const key of keys){let row=one('SELECT * FROM device_pair_rates WHERE bucket_hash=?',key);if(!row){if(one('SELECT count(*) n FROM device_pair_rates').n>=DEVICE_CLAIM_LIMITS.rateBuckets){limited=true;continue;}run('INSERT INTO device_pair_rates(bucket_hash,started_at,attempts) VALUES(?,?,1)',key,now());row={attempts:0,blocked_until:0};}else run('UPDATE device_pair_rates SET attempts=attempts+1 WHERE bucket_hash=?',key);if(row.attempts>=5)limited=true;if(row.blocked_until>now())cooldown=true;}});
  if(limited)fail(429,'PAIR_RATE_LIMIT','机器码尝试过于频繁，请一分钟后重试。');
  if(cooldown)fail(429,'PAIR_RETRY_LATER','请稍等片刻再核对机器码。');
  return keys;
 }
 function failed(keys){for(const key of keys){const row=one('SELECT failures FROM device_pair_rates WHERE bucket_hash=?',key);if(row)run('UPDATE device_pair_rates SET failures=failures+1,blocked_until=? WHERE bucket_hash=?',now()+Math.min(4000,250*2**Math.min(row.failures,4)),key);}}
 function invalid(){fail(401,'PAIR_EXPIRED','机器码无效、已过期或已使用，请在电脑上重新生成。');}
 function privateClaim(input,ip){
  const row=identifier(input.claimId)&&credential(input.pollSecret)?one('SELECT * FROM device_pair_claims WHERE id=? AND poll_hash=?',input.claimId,hash(input.pollSecret)):null;
  if(!row||(row.device_id?row.delivery_expires:row.pair_expires)<=now()){const buckets=attempts(ip);failed(buckets);invalid();}
  return row;
 }
 function publicPair(row,code,privateSecret){return {claimId:row.id,code,...(privateSecret?{pollSecret:privateSecret}:{}),expiresAt:row.pair_expires,pollIntervalMs:2000};}
 function create(input,ip){
  const buckets=attempts(ip);try{fields(input,['action','name','source','capabilities']);const name=text(input.name,60,'设备名称',1),source=deviceSource(input.source||'local'),capabilities=validateDeviceCapabilities(input.capabilities||{});
   return transaction(()=>{if(one('SELECT count(*) n FROM device_pair_claims').n>=DEVICE_CLAIM_LIMITS.pending)fail(429,'PAIR_CAPACITY','等待配对的设备过多，请稍后重试。');const id=randomUUID(),code=newCode(),pollSecret=secret(),expires=now()+DEVICE_CLAIM_LIMITS.lifetimeMs;run('INSERT INTO device_pair_claims(id,pair_hash,poll_hash,name,source,capabilities,created_at,pair_expires) VALUES(?,?,?,?,?,?,?,?)',id,hash(code),hash(pollSecret),name,source,JSON.stringify(capabilities),now(),expires);return publicPair({id,pair_expires:expires},code,pollSecret);});
  }catch(error){failed(buckets);throw error;}
 }
 function machine(input,ip){
  fields(input,['action','name','source','capabilities','claimId','pollSecret']);if(input.action==='create')return create(input,ip);
  if(!['rotate','poll'].includes(input.action))fail(400,'INVALID_PAIR_ACTION','机器码操作无效。');
  fields(input,['action','claimId','pollSecret']);maintain();const row=privateClaim(input,ip);
  if(input.action==='rotate'){
   const buckets=attempts(ip);try{return transaction(()=>{const current=one('SELECT * FROM device_pair_claims WHERE id=? AND poll_hash=?',input.claimId,hash(input.pollSecret));if(!current||(current.device_id?current.delivery_expires:current.pair_expires)<=now())invalid();if(current.device_id)fail(409,'DEVICE_ALREADY_CLAIMED','设备已绑定，请完成连接或在手机撤销。');const code=newCode(),expires=now()+DEVICE_CLAIM_LIMITS.lifetimeMs;run('UPDATE device_pair_claims SET pair_hash=?,pair_expires=? WHERE id=?',hash(code),expires,row.id);return publicPair({...row,pair_expires:expires},code);});}catch(error){failed(buckets);throw error;}
  }
  if(!row.device_id)return {status:'pending',expiresAt:row.pair_expires,pollIntervalMs:2000};
  return transaction(()=>{
   const device=one('SELECT * FROM personal_devices WHERE id=? AND revoked_at IS NULL',row.device_id);
   if(!device||!one('SELECT 1 FROM accounts WHERE id=? AND deleted_at=0',device.owner_id)||one("SELECT 1 FROM account_restrictions WHERE account_id=? AND state<>'active'",device.owner_id))invalid();
   // The independent high-entropy polling secret stays only on the PC. Deterministic delivery
   // is safe to retry after a lost HTTP response without storing any recoverable secret here.
   const token=createHmac('sha256',input.pollSecret).update('ybz-device-token-v1:'+device.id).digest('base64url');
   if(device.token_hash&&device.token_hash!==hash(token))invalid();
   run('UPDATE personal_devices SET token_hash=? WHERE id=?',hash(token),device.id);
   authenticateDevice(token);return {status:'paired',deviceId:device.id,name:device.name,token};
  });
 }
 function claim(account,input,ip){
  const buckets=attempts(ip,account.id);try{fields(input,['code','name']);const code=normalizedCode(input.code),name=input.name===undefined?null:text(input.name,60,'设备名称',1);
   return transaction(()=>{const row=code?one('SELECT * FROM device_pair_claims WHERE pair_hash=? AND pair_expires>? AND device_id IS NULL',hash(code),now()):null;if(!row)invalid();
    run('UPDATE personal_devices SET revoked_at=?,pair_hash=NULL WHERE owner_id=? AND token_hash IS NULL AND pair_expires<=? AND revoked_at IS NULL',now(),account.id,now());
    if(one('SELECT count(*) n FROM personal_devices WHERE owner_id=? AND revoked_at IS NULL',account.id).n>=5)fail(429,'DEVICE_LIMIT','最多连接 5 台设备，请先撤销不再使用的设备。');
    const id=randomUUID();run('INSERT INTO personal_devices(id,owner_id,name,pair_expires,created_at,source,capabilities,capabilities_at) VALUES(?,?,?,?,?,?,?,?)',id,account.id,name||row.name,now()+DEVICE_CLAIM_LIMITS.deliveryMs,now(),row.source,row.capabilities,now());
    run('UPDATE device_pair_claims SET pair_hash=NULL,device_id=?,claimed_at=?,delivery_expires=? WHERE id=?',id,now(),now()+DEVICE_CLAIM_LIMITS.deliveryMs,row.id);
    return {device:view(one('SELECT * FROM personal_devices WHERE id=?',id))};
   });
  }catch(error){failed(buckets);throw error;}
 }
 return {machine,claim,maintain};
}
