import {createHash,randomUUID} from 'node:crypto';
import {fail,fields,text} from './social-validation.mjs';

export const AI_FILE_LIMIT=20*1024*1024;
export const AI_FILE_CHUNK=196608;
const TTL=86400000;
const sha=b=>createHash('sha256').update(b).digest('hex');
const digest=/^[a-f0-9]{64}$/;
export function safeAIFileName(value){
 const name=String(value||'file').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/^\.+|[. ]+$/g,'').slice(0,100)||'file';
 return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)?'file_'+name:name;
}
function decode(value,max){
 if(typeof value!=='string'||value.length>Math.ceil(max/3)*4||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))fail(400,'FILE_ENCODING','文件编码无效。');
 const b=Buffer.from(value,'base64');if(b.length>max||b.toString('base64')!==value)fail(400,'FILE_ENCODING','文件编码无效。');return b;
}
function envelope(input){
 fields(input,['version','algorithm','name','size','iv','wrappedKey','keyId','cipherSha256']);
 if(input.version!==1||input.algorithm!=='RSA-OAEP-256+A256GCM'||!Number.isSafeInteger(input.size)||input.size<1||input.size>AI_FILE_LIMIT||!digest.test(input.keyId)||!digest.test(input.cipherSha256))fail(400,'FILE_ENVELOPE_INVALID','加密文件信息无效，单文件最多20MB。');
 if(decode(input.iv,12).length!==12||decode(input.wrappedKey,256).length!==256)fail(400,'FILE_ENVELOPE_INVALID','加密文件信息无效。');
 return {...input,name:safeAIFileName(text(input.name,240,'文件名',1))};
}
// Ciphertext only. No private/decryption keys, plaintext file parsing, or disk writes.
// Intentionally ephemeral: expiry, account cleanup and restart all discard buffers.
export function createAIChannelFiles({authorizeOwner,authorizeAgent,now=Date.now}){
 const files=new Map(),requests=new Map();
 function remove(id){const f=files.get(id);if(f)requests.delete(f.requestKey);files.delete(id);}
 function maintain(){for(const [id,f]of files)if(f.expiresAt<=now())remove(id);}
 function view(f){return {id:f.id,name:f.envelope.name,size:f.envelope.size,direction:f.direction,status:f.status,taskId:f.taskId,chunkSize:AI_FILE_CHUNK,chunkCount:f.chunkCount,envelope:{...f.envelope},expiresAt:f.expiresAt};}
 function owned(id,auth){const f=files.get(id);if(!f||f.ownerId!==auth.ownerId||f.deviceId!==auth.deviceId)fail(404,'FILE_EXPIRED','文件不存在或加密中转已过期，请重新发送。');return f;}
 function handle(auth,path,input={},agent=false,method='POST'){
  maintain();const parts=path.split('/').filter(Boolean);
  if(path==='init'&&method==='POST'){
   fields(input,['deviceId','requestId','envelope','taskId','leaseId']);text(input.requestId,80,'请求编号',8);
   const meta=envelope(input.envelope),bytes=meta.size+16,direction=agent?'outbox':'inbox',taskId=agent?auth.taskId:null;
   const requestKey=auth.ownerId+':'+input.requestId,signature=sha(JSON.stringify([auth.deviceId,direction,taskId,meta]));
   const prior=requests.get(requestKey);if(prior){if(prior.signature!==signature)fail(409,'IDEMPOTENCY_CONFLICT','该文件请求编号已被使用。');return {file:view(owned(prior.id,auth))};}
   let global=0,owner=0;for(const f of files.values()){global+=f.bytes;if(f.ownerId===auth.ownerId)owner+=f.bytes;}
   if(global+bytes>100*1024*1024||owner+bytes>40*1024*1024||files.size>=32)fail(429,'FILE_RELAY_FULL','加密中转空间已满，请稍后重试。');
   const id=randomUUID(),f={id,ownerId:auth.ownerId,deviceId:auth.deviceId,taskId,direction,envelope:meta,bytes,chunkCount:Math.ceil(bytes/AI_FILE_CHUNK),chunks:new Map(),status:'uploading',expiresAt:now()+TTL,requestKey};
   files.set(id,f);requests.set(requestKey,{id,signature});return {file:view(f)};
  }
  const f=owned(parts[0],auth);
  if(agent&&f.taskId!==auth.taskId)fail(403,'FILE_TASK_DENIED','文件不属于当前授权任务。');
  const reading=method==='GET'||parts[3]==='read';
  if(parts[1]==='chunks'&&/^\d{1,3}$/.test(parts[2]||'')){
   const index=Number(parts[2]);if(index>=f.chunkCount)fail(400,'FILE_CHUNK_INVALID','文件分片编号无效。');
   if(reading){if(f.status!=='ready'||!f.chunks.has(index))fail(409,'FILE_NOT_READY','文件尚未完成上传。');return {data:f.chunks.get(index).toString('base64')};}
   if(method!=='POST'||(agent?f.direction!=='outbox':f.direction!=='inbox')||f.taskId&&!agent)fail(403,'FILE_WRITE_DENIED','不能更改已交付的文件。');
   fields(input,['data','taskId','leaseId']);const data=decode(input.data,AI_FILE_CHUNK),expected=Math.min(AI_FILE_CHUNK,f.bytes-index*AI_FILE_CHUNK);
   if(data.length!==expected)fail(400,'FILE_CHUNK_INVALID','文件分片长度不一致。');
   const previous=f.chunks.get(index);if(previous){if(!previous.equals(data))fail(409,'FILE_CHUNK_CONFLICT','同一分片不能改写。');return {accepted:true,index};}
   if(f.status!=='uploading')fail(409,'FILE_ALREADY_FINISHED','文件已经完成。');f.chunks.set(index,data);return {accepted:true,index};
  }
  if(parts[1]==='finish'&&method==='POST'){
   fields(input,['taskId','leaseId']);if(agent?f.direction!=='outbox':f.direction!=='inbox')fail(403,'FILE_WRITE_DENIED','不能更改这个文件。');
   if(f.chunks.size!==f.chunkCount)fail(409,'FILE_INCOMPLETE','文件分片尚未传完。');
   const h=createHash('sha256');for(let i=0;i<f.chunkCount;i++)h.update(f.chunks.get(i));
   if(h.digest('hex')!==f.envelope.cipherSha256){remove(f.id);fail(400,'FILE_DIGEST_MISMATCH','加密文件校验失败，请重新发送。');}
   f.status='ready';return {file:view(f)};
  }
  if(parts.length===1&&method==='GET')return {file:view(f)};
  fail(404,'NOT_FOUND','文件中转接口不存在。');
 }
 return {
  maintain,
  cleanupOwner(ownerId){for(const[id,f]of files)if(f.ownerId===ownerId)remove(id);},
  handleOwner(request,path){maintain();const {input={},query={},token,method}=request;let deviceId=input.deviceId||query.deviceId;const f=files.get(path.split('/')[0]);if(f)deviceId=f.deviceId;const auth=authorizeOwner(token,deviceId);return handle(auth,path,input,false,method);},
  handleAgent(token,path,input){const auth=authorizeAgent(token,input);return handle(auth,path,input,true,'POST');},
  validateAttachments(ownerId,deviceId,ids){maintain();if(!Array.isArray(ids)||ids.length>3||new Set(ids).size!==ids.length)fail(400,'FILE_ATTACHMENTS_INVALID','一次最多发送3个不同的文件。');return ids.map(id=>{const f=owned(id,{ownerId,deviceId});if(f.status!=='ready'||f.direction!=='inbox'||f.taskId)fail(409,'FILE_NOT_READY','文件未就绪或已交付给其他任务。');return view(f);});},
  bindTask({ownerId,deviceId,taskId,fileIds}){const list=this.validateAttachments(ownerId,deviceId,fileIds);for(const f of list)files.get(f.id).taskId=taskId;return list.map(f=>view(files.get(f.id)));},
  listForTask({ownerId,deviceId,taskId}){maintain();const list=[...files.values()].filter(f=>f.ownerId===ownerId&&f.deviceId===deviceId&&f.taskId===taskId&&f.status==='ready').map(view);return {attachments:list.filter(f=>f.direction==='inbox'),outputFiles:list.filter(f=>f.direction==='outbox')};},
 };
}
