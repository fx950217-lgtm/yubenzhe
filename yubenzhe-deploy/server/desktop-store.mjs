import {createHash,randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {fail} from './social-validation.mjs';

export function decodeDesktopCredentialKey(value){
 if(Buffer.isBuffer(value)&&value.length===32)return Buffer.from(value);
 if(typeof value==='string'){
  if(/^[a-f0-9]{64}$/i.test(value))return Buffer.from(value,'hex');
  if(/^[A-Za-z0-9+/]{43}=$/.test(value)){const key=Buffer.from(value,'base64');if(key.length===32&&key.toString('base64')===value)return key;}
 }
 fail(503,'DESKTOP_CRED_KEY_REQUIRED','云电脑凭据加密密钥未配置或格式无效。');
}
const transitions=Object.freeze({creating:['available','error','terminating'],available:['stopped','error','terminating'],stopped:['available','error','terminating'],error:['creating','available','terminating'],terminating:['terminated'],terminated:[]});
const numberOrNull=value=>value==null?null:Number.isSafeInteger(value)&&value>=0?value:fail(400,'DESKTOP_INVALID_COST','云电脑计量数据无效。');
const short=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail(400,'DESKTOP_INVALID_CREDENTIAL',label+'无效。');return value;};

export function createDesktopStore({database,credentialKey,now=Date.now}={}){
 if(!database?.raw)throw Error('Desktop store requires the social database.');
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
 function find(id){return one('SELECT * FROM cloud_desktops WHERE id=?',id);}
 function requireDesktop(id){const row=find(id);if(!row)fail(404,'DESKTOP_NOT_FOUND','云电脑不存在。');return row;}
 function owned(id,userId){const row=requireDesktop(id);if(row.user_id!==userId)fail(403,'DESKTOP_FORBIDDEN','无权访问这台云电脑。');return row;}
 function active(row){if(['terminating','terminated'].includes(row.state))fail(410,'DESKTOP_GONE','这台云电脑已注销或正在注销，凭据已撤销。');}
 function audit(row,event){run('INSERT INTO desktop_audit_events VALUES(?,?,?,?,?)',randomUUID(),row.id,row.user_id,event,now());}
 function view(row){return {id:row.id,state:row.state,plan:row.plan,region:row.region,protocol:row.protocol,provider:row.provider,createdAt:row.created_at,availableAt:row.available_at,terminatedAt:row.terminated_at,autoStopMinutes:row.auto_stop_minutes,version:row.version,cost:row.cost_cents,price:row.price_cents,currency:'USD',moneyUnit:'cents',billingEnabled:false};}
 function enqueue({userId,provider,plan,region,requestId}){
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))fail(400,'REQUEST_ID_REQUIRED','请保留同一开通请求标识重试。');
  if(!['basic','standard','power','graphics'].includes(plan))fail(400,'DESKTOP_INVALID_PLAN','请选择有效的云电脑规格。');
  const payloadHash=createHash('sha256').update(JSON.stringify({userId,provider,plan,region,protocol:'DCV'})).digest('hex');
  return transaction(()=>{
   const old=one('SELECT * FROM desktop_provision_jobs WHERE request_id=?',requestId);
   if(old){if(old.payload_hash!==payloadHash)fail(409,'IDEMPOTENCY_CONFLICT','同一开通标识不能更换账号、规格或区域。');return {jobId:old.id,desktopId:old.desktop_id};}
   const account=one('SELECT id,deleted_at FROM accounts WHERE id=?',userId);if(!account||account.deleted_at)fail(401,'ACCOUNT_REQUIRED','账号不可用。');
   if(one("SELECT count(*) n FROM cloud_desktops WHERE user_id=? AND state<>'terminated'",userId).n>=5)fail(409,'DESKTOP_LIMIT','请先处理已有云电脑。');
   const id=randomUUID(),jobId=randomUUID(),time=now();
   run("INSERT INTO cloud_desktops(id,user_id,provider,plan,region,state,created_at,updated_at) VALUES(?,?,?,?,?,'creating',?,?)",id,userId,provider,plan,region,time,time);
   run("INSERT INTO desktop_provision_jobs(id,desktop_id,request_id,payload_hash,status,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)",jobId,id,requestId,payloadHash,time,time);audit(requireDesktop(id),'provision-requested');return {jobId,desktopId:id};
  });
 }
 function updateState(id,state,{providerDesktopId,costCents,priceCents,expectedVersion}={}){
  const row=requireDesktop(id);
  if(expectedVersion!==undefined&&row.version!==expectedVersion)fail(409,'DESKTOP_CHANGED','云电脑状态已变化，请刷新。');
  if(state===row.state)return row;
  if(!transitions[row.state]?.includes(state))fail(409,'DESKTOP_INVALID_STATE','不允许此云电脑状态转换。');
  const upstream=providerDesktopId===undefined?row.provider_desktop_id:short(providerDesktopId,200,'服务商设备标识');
  if(state==='available'&&!upstream)fail(409,'DESKTOP_NOT_READY','服务商尚未确认云电脑已可用。');
  const changed=run('UPDATE cloud_desktops SET state=?,provider_desktop_id=?,cost_cents=?,price_cents=?,version=version+1,updated_at=?,available_at=?,terminated_at=? WHERE id=? AND version=?',state,upstream,costCents===undefined?row.cost_cents:numberOrNull(costCents),priceCents===undefined?row.price_cents:numberOrNull(priceCents),now(),state==='available'?(row.available_at??now()):row.available_at,state==='terminated'?now():row.terminated_at,id,row.version);
  if(changed.changes!==1)fail(409,'DESKTOP_CHANGED','云电脑状态已变化，请刷新。');
  if(['terminating','terminated'].includes(state))run('DELETE FROM cloud_desktop_credentials WHERE desktop_id=?',id);
  audit(row,'state:'+state);return requireDesktop(id);
 }
 function saveCredentials(id,{registrationCode=null,username,password,realm=null}){
  const row=requireDesktop(id);active(row);if(!['available','stopped'].includes(row.state))fail(409,'DESKTOP_NOT_READY','云电脑尚未交付。');
  const key=decodeDesktopCredentialKey(credentialKey);short(username,256,'用户名');short(password,1024,'密码');if(registrationCode!==null)short(registrationCode,256,'注册码');if(realm!==null)short(realm,256,'目录');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('YBZ:desktop:v1:'+row.user_id+':'+row.id));
  const ciphertext=Buffer.concat([cipher.update(password,'utf8'),cipher.final()]),tag=cipher.getAuthTag();key.fill(0);
  run('INSERT INTO cloud_desktop_credentials VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(desktop_id) DO UPDATE SET registration_code=excluded.registration_code,username=excluded.username,password_ciphertext=excluded.password_ciphertext,password_iv=excluded.password_iv,password_tag=excluded.password_tag,realm=excluded.realm,updated_at=excluded.updated_at',id,registrationCode,username,ciphertext,iv,tag,realm,now(),now());run('UPDATE cloud_desktops SET version=version+1,updated_at=? WHERE id=?',now(),id);audit(row,'credentials-updated');
 }
 function credentials(id,userId){
  const row=owned(id,userId);active(row);const record=one('SELECT * FROM cloud_desktop_credentials WHERE desktop_id=?',id);if(!record)fail(409,'DESKTOP_CREDENTIALS_UNAVAILABLE','云电脑凭据尚未交付或需要重新核实。');
  const key=decodeDesktopCredentialKey(credentialKey);try{const decipher=createDecipheriv('aes-256-gcm',key,record.password_iv);decipher.setAAD(Buffer.from('YBZ:desktop:v1:'+row.user_id+':'+row.id));decipher.setAuthTag(record.password_tag);const password=Buffer.concat([decipher.update(record.password_ciphertext),decipher.final()]).toString('utf8');return {registrationCode:record.registration_code,username:record.username,password,realm:record.realm};}
  catch{fail(503,'DESKTOP_CREDENTIALS_UNAVAILABLE','云电脑凭据无法解密，请联系支持。');}finally{key.fill(0);}
 }
 function claimJob(){return transaction(()=>{const job=one("SELECT j.* FROM desktop_provision_jobs j JOIN cloud_desktops d ON d.id=j.desktop_id WHERE j.status='queued' AND d.state='creating' ORDER BY j.created_at,j.id LIMIT 1");if(!job)return null;run("UPDATE desktop_provision_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'",now(),job.id);return {...job,status:'running'};});}
 function finishJob(id,status,code=null){if(!['succeeded','failed','unknown'].includes(status))throw Error('Invalid desktop job status');run("UPDATE desktop_provision_jobs SET status=?,last_error=?,updated_at=? WHERE id=? AND status='running'",status,code,now(),id);}
 function pending(userId){return all("SELECT id,state FROM cloud_desktops WHERE user_id=? AND state<>'terminated'",userId);}
 return {find,owned,active,view,enqueue,updateState,saveCredentials,credentials,decryptPassword:(id,userId)=>credentials(id,userId).password,claimJob,finishJob,pending,audit,transaction,
  list:userId=>all('SELECT * FROM cloud_desktops WHERE user_id=? ORDER BY created_at DESC,id',userId).map(view),
  job:id=>one('SELECT * FROM desktop_provision_jobs WHERE id=?',id),
  clearCredentials:id=>run('DELETE FROM cloud_desktop_credentials WHERE desktop_id=?',id),
  quarantineInterruptedJobs(){return run("UPDATE desktop_provision_jobs SET status='unknown',last_error='DESKTOP_PROVISION_UNKNOWN',updated_at=? WHERE status='running'",now()).changes;},
  cleanup(userId){if(pending(userId).length)fail(409,'DESKTOPS_PENDING','请先注销已有云电脑并核实完成。');run('DELETE FROM cloud_desktop_credentials WHERE desktop_id IN (SELECT id FROM cloud_desktops WHERE user_id=?)',userId);}
 };
}
