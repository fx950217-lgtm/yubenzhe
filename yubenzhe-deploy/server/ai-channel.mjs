import {createHash,randomUUID} from 'node:crypto';
import {fail,fields,text} from './social-validation.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const final=new Set(['succeeded','failed','cancelled']);
export const AI_CHANNEL_LIMITS=Object.freeze({promptChars:8000,queue:5,hardMs:600000,leaseMs:15000,onlineMs:20000,events:50,eventChars:16000,retainedChars:64000,totalOutputChars:256000,eventCount:2000,retainedTasks:250,globalChars:2000000,retentionMs:86400000});
const allowedStatus=new Set(['ready','login-required','quota','error']);
const errorCodes=new Set(['AI_CANCELLED','AI_TIMEOUT','AI_LOGIN_REQUIRED','AI_QUOTA','AI_EXECUTION_INTERRUPTED','AI_EXECUTION_FAILED','AI_OUTPUT_LIMIT','AI_PROCESS_FAILED','AI_UNAVAILABLE','AI_PROTOCOL_ERROR','AI_LEASE_EXPIRED','AI_REVOKED','AI_TOOL_UNAVAILABLE','AI_INCOMPLETE','AI_JOURNAL_FULL','AI_FILE_TRANSFER_FAILED']);

export function createAIChannel({database,socialService,devices,now=Date.now,filesService=null}={}){
 const db=database.raw,memory=new Map(),publicKeys=new Map();
 const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const transaction=fn=>{const saved=new Map([...memory].map(([id,entry])=>[id,{...entry,events:[...entry.events]}])),savedKeys=new Map(publicKeys);db.exec('BEGIN IMMEDIATE');try{const value=fn();trimMemory();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');memory.clear();for(const [id,entry]of saved)memory.set(id,entry);publicKeys.clear();for(const [id,key]of savedKeys)publicKeys.set(id,key);throw error;}};
 const row=id=>one('SELECT * FROM ai_channel_tasks WHERE id=?',id);
 const bytes=entry=>entry.prompt.length+entry.events.reduce((n,e)=>n+(e.text?.length||0),0);
 function terminal(task,status,code=null){if(final.has(task.status))return;run('UPDATE ai_channel_tasks SET status=?,error_code=?,finished_at=?,lease_until=NULL WHERE id=?',status,code,now(),task.id);const entry=memory.get(task.id);if(entry)entry.finishedAt=now();}
 function revokeDevice(deviceId){for(const task of all("SELECT * FROM ai_channel_tasks WHERE device_id=? AND status IN('queued','running')",deviceId))terminal(task,'cancelled','AI_DEVICE_REVOKED');for(const [id,entry]of memory)if(entry.deviceId===deviceId)memory.delete(id);publicKeys.delete(deviceId);filesService?.revokeDevice?.(deviceId);}
 function maintain(){
  for(const task of all("SELECT t.*,d.revoked_at,a.deleted_at,r.state AS restriction FROM ai_channel_tasks t JOIN personal_devices d ON d.id=t.device_id JOIN accounts a ON a.id=t.owner_id LEFT JOIN account_restrictions r ON r.account_id=a.id WHERE t.status IN('queued','running')")){
   if(task.revoked_at||task.deleted_at||task.restriction&&task.restriction!=='active')terminal(task,'cancelled','AI_DEVICE_REVOKED');
   else if(task.status==='running'&&(task.lease_until<=now()||task.hard_until<=now()))terminal(task,'failed',task.hard_until<=now()?'AI_TIMEOUT':'AI_EXECUTION_INTERRUPTED');
   else if(!memory.has(task.id))terminal(task,'failed','AI_EXECUTION_INTERRUPTED');
   else if(task.status==='queued'&&task.created_at+AI_CHANNEL_LIMITS.retentionMs<=now())terminal(task,'failed','AI_QUEUE_EXPIRED');
  }
  for(const [id,entry]of memory)if(entry.createdAt+AI_CHANNEL_LIMITS.retentionMs<=now())memory.delete(id);
  trimMemory();
  filesService?.maintain?.();
 }
 function trimMemory(){let total=[...memory.values()].reduce((n,e)=>n+bytes(e),0);for(const [id,entry]of memory){if(total<=AI_CHANNEL_LIMITS.globalChars)break;const task=row(id);if(!task||final.has(task.status)){total-=bytes(entry);memory.delete(id);}else while(total>AI_CHANNEL_LIMITS.globalChars&&entry.events.length){total-=entry.events.shift().text?.length||0;}}}
 function restart(){
  // Existing request hashes remain durable. A lost process never re-dispatches a task.
  for(const task of all("SELECT * FROM ai_channel_tasks WHERE status IN('queued','running')"))terminal(task,'failed','AI_EXECUTION_INTERRUPTED');
  run("UPDATE ai_channel_devices SET last_seen=0,status_code='error'");memory.clear();publicKeys.clear();
 }
 function reserveMemory(prompt){
  let total=[...memory.values()].reduce((n,e)=>n+bytes(e),0);
  for(const [id,entry]of memory){if(memory.size<AI_CHANNEL_LIMITS.retainedTasks&&total+prompt.length<=AI_CHANNEL_LIMITS.globalChars)break;const task=row(id);if(!task||final.has(task.status)){total-=bytes(entry);memory.delete(id);}}
  if(memory.size>=AI_CHANNEL_LIMITS.retainedTasks||total+prompt.length>AI_CHANNEL_LIMITS.globalChars)fail(429,'AI_CHANNEL_BUSY','临时任务缓冲区已满，请稍后重试。');
 }
 function statusView(device){
  const current=one('SELECT * FROM ai_channel_devices WHERE device_id=?',device.id),online=Boolean(!device.revoked_at&&device.token_hash&&current?.last_seen&&current.last_seen>now()-AI_CHANNEL_LIMITS.onlineMs);
  return {id:device.id,name:device.name,online,aiStatus:online?current.status_code:'offline',workspaceLabel:current?.workspace_label||'',provider:'Codex',filePublicKey:online?publicKeys.get(device.id)||null:null};
 }
 function taskView(task){
  const entry=memory.get(task.id),device=one('SELECT name FROM personal_devices WHERE id=?',task.device_id);
  return {id:task.id,deviceId:task.device_id,status:task.status,...(entry?{prompt:entry.prompt}:{}),outputAvailable:Boolean(entry),errorCode:task.error_code,createdAt:task.created_at,startedAt:task.started_at,finishedAt:task.finished_at,expiresAt:task.hard_until,latestSeq:task.last_seq,sourceLabel:(device?.name||'设备')+' · Codex',...(filesService?{files:filesService.listForTask({ownerId:task.owner_id,deviceId:task.device_id,taskId:task.id})}:{})};
 }
 function own(request,id,{write=false}={}){const account=socialService.assertAIAccess(request.token,{write}),task=row(id);if(!task||task.owner_id!==account.id)fail(404,'AI_TASK_NOT_FOUND','AI 任务不存在。');devices.ownedDevice(account,task.device_id);return {account,task};}
 function send(request){
  const input=request.input||{};fields(input,['deviceId','prompt','requestId','attachments','replyPublicKey']);
  const account=socialService.assertAIAccess(request.token,{write:true});
  if(!uuid(input.deviceId)||!uuid(input.requestId))fail(400,'INVALID_REQUEST_ID','设备或操作编号无效。');
  const prompt=text(input.prompt,AI_CHANNEL_LIMITS.promptChars,'任务内容',1),attachments=input.attachments??[];
  if(!Array.isArray(attachments)||attachments.length>3||attachments.some(id=>!uuid(id))||new Set(attachments).size!==attachments.length)fail(400,'AI_ATTACHMENTS_INVALID','最多选择三个不同附件。');
  if(input.replyPublicKey!==undefined&&(typeof input.replyPublicKey!=='string'||!/^[A-Za-z0-9+/]{40,1024}={0,2}$/.test(input.replyPublicKey)))fail(400,'AI_FILE_PUBLIC_KEY','文件接收公钥格式无效。');
  const signature=hash({deviceId:input.deviceId,prompt,attachments,replyPublicKey:input.replyPublicKey||null});
  const device=devices.ownedDevice(account,input.deviceId);
  const previous=one('SELECT * FROM ai_channel_tasks WHERE owner_id=? AND request_id=?',account.id,input.requestId);
  if(previous){if(previous.request_hash!==signature)fail(409,'IDEMPOTENCY_CONFLICT','同一操作标识不能更改任务内容。');return {task:taskView(previous)};}
  const state=statusView(device);if(!state.online)fail(409,'AI_DEVICE_OFFLINE','电脑离线，请启动 AI 连接器。');
  if(state.aiStatus!=='ready')fail(409,state.aiStatus==='login-required'?'AI_LOGIN_REQUIRED':state.aiStatus==='quota'?'AI_QUOTA':'AI_NOT_READY',state.aiStatus==='login-required'?'请在电脑上登录 Codex 后重试。':state.aiStatus==='quota'?'电脑上的 Codex 额度不足，请稍后重试。':'电脑上的 AI 暂未就绪。');
  if(one("SELECT count(*) n FROM ai_channel_tasks WHERE device_id=? AND status='queued'",device.id).n>=AI_CHANNEL_LIMITS.queue)fail(429,'AI_QUEUE_FULL','任务队列已满，请先等待现有任务完成。');
  if(one('SELECT count(*) n FROM ai_channel_tasks WHERE owner_id=? AND created_at>?',account.id,now()-3600000).n>=100)fail(429,'AI_RATE_LIMIT','近期任务过多，请稍后再试。');
  if(attachments.length&&!filesService)fail(503,'AI_FILES_UNAVAILABLE','加密文件中转尚未配置。');
  const attachmentMetadata=filesService?filesService.validateAttachments(account.id,device.id,attachments):[];
  reserveMemory(prompt);const id=randomUUID();
  run("INSERT INTO ai_channel_tasks(id,device_id,owner_id,request_id,request_hash,prompt_length,status,created_at) VALUES(?,?,?,?,?,?,'queued',?)",id,device.id,account.id,input.requestId,signature,prompt.length,now());
  memory.set(id,{deviceId:device.id,prompt,events:[],attachments:attachmentMetadata,replyPublicKey:input.replyPublicKey||null,createdAt:now(),finishedAt:null});
  filesService?.bindTask?.({ownerId:account.id,deviceId:device.id,taskId:id,fileIds:attachments});
  return {task:taskView(row(id))};
 }
 function cancel(request,id){
  const input=request.input||{};fields(input,['requestId']);if(!uuid(input.requestId))fail(400,'INVALID_REQUEST_ID','操作编号无效。');
  const {account,task}=own(request,id,{write:true}),old=one('SELECT * FROM ai_channel_cancel_requests WHERE owner_id=? AND request_id=?',account.id,input.requestId);
  if(old&&old.task_id!==id)fail(409,'IDEMPOTENCY_CONFLICT','取消操作编号已用于其他任务。');
  if(!old)run('INSERT INTO ai_channel_cancel_requests VALUES(?,?,?)',account.id,input.requestId,id);
  terminal(task,'cancelled','AI_CANCELLED');return {task:taskView(row(id))};
 }
 function handle(request){
  const path=request.path||'';if(path!=='ai-channel'&&!path.startsWith('ai-channel/'))return undefined;
  socialService.assertAIAccess(request.token);maintain();const route=path.slice('ai-channel'.length).replace(/^\//,'');
  if(route==='files'||route.startsWith('files/')){if(!filesService)fail(503,'AI_FILES_UNAVAILABLE','加密文件中转尚未配置。');return filesService.handleOwner(request,route.slice('files'.length).replace(/^\//,''));}
  if(request.method==='POST'&&route==='send')return transaction(()=>send(request));
  const deviceRoute=/^devices\/([a-f0-9-]{36})$/.exec(route);
  if(request.method==='GET'&&deviceRoute){const account=socialService.assertAIAccess(request.token),device=devices.ownedDevice(account,deviceRoute[1]);return {device:statusView(device),tasks:all('SELECT * FROM ai_channel_tasks WHERE owner_id=? AND device_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',account.id,device.id).map(taskView)};}
  const taskRoute=/^tasks\/([a-f0-9-]{36})(?:\/(cancel))?$/.exec(route);
  if(taskRoute&&request.method==='POST'&&taskRoute[2]==='cancel')return transaction(()=>cancel(request,taskRoute[1]));
  if(taskRoute&&request.method==='GET'&&!taskRoute[2]){const {task}=own(request,taskRoute[1]),after=request.query?.after===undefined?0:Number(request.query.after);if(!Number.isSafeInteger(after)||after<0)fail(400,'INVALID_CURSOR','消息同步位置无效。');const entry=memory.get(task.id),events=entry?.events.filter(e=>e.seq>after)||[];return {task:taskView(task),events,latestSeq:task.last_seq,truncated:task.last_seq>after&&(!entry||!entry.events.length||entry.events[0].seq>after+1)};}
  fail(404,'AI_CHANNEL_ROUTE','AI 通道入口不存在。');
 }
 function checkedStatus(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_AI_STATUS','AI 状态无效。');fields(input,['code','workspaceLabel','provider','filePublicKey']);
  if(!allowedStatus.has(input.code)||input.provider!=='Codex')fail(400,'INVALID_AI_STATUS','AI 状态或来源无效。');
  const label=text(input.workspaceLabel,60,'工作区标签',1);if(/[\\/:]|(?:\.\.)/.test(label))fail(400,'INVALID_AI_STATUS','工作区只可报告名称，不能报告本机路径。');
  if(input.filePublicKey!==undefined&&(typeof input.filePublicKey!=='string'||!/^[A-Za-z0-9+/]{40,1024}={0,2}$/.test(input.filePublicKey)))fail(400,'AI_FILE_PUBLIC_KEY','文件公钥格式无效。');
  return {code:input.code,workspaceLabel:label,provider:'Codex',filePublicKey:input.filePublicKey};
 }
 function normalizeEvent(event){
  if(!event||typeof event!=='object'||Array.isArray(event))fail(400,'INVALID_AI_EVENT','事件格式无效。');fields(event,['seq','kind','itemId','text','code']);
  if(!Number.isSafeInteger(event.seq)||event.seq<1||!['message','progress','completed','failed'].includes(event.kind))fail(400,'INVALID_AI_EVENT','事件编号或类型无效。');
  if(event.itemId!==undefined&&(typeof event.itemId!=='string'||!/^[A-Za-z0-9_.:-]{1,120}$/.test(event.itemId)))fail(400,'INVALID_AI_EVENT','输出编号无效。');
  if(event.text!==undefined&&(typeof event.text!=='string'||event.text.length>AI_CHANNEL_LIMITS.eventChars||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(event.text)))fail(400,'INVALID_AI_EVENT','输出文本无效或过长。');
  if(event.kind==='message'&&(!event.itemId||!event.text))fail(400,'INVALID_AI_EVENT','模型消息缺少文本或编号。');
  if(event.code!==undefined){
   const valid=event.kind==='progress'?(event.code==='AI_RUNNING'||errorCodes.has(event.code)):event.kind==='completed'?event.code==='AI_COMPLETED':event.kind==='failed'?errorCodes.has(event.code):false;
   if(!valid)fail(400,'INVALID_AI_EVENT','事件状态编号与类型不匹配。');
  }
  return {seq:event.seq,kind:event.kind,...(event.itemId!==undefined?{itemId:event.itemId}:{}),...(event.text!==undefined?{text:event.text}:{}),...(event.code!==undefined?{code:event.code}:{})};
 }
 function acceptEvents(task,events){
  let current=row(task.id);const entry=memory.get(task.id);if(!entry)return;
  for(const event of events){
   const digest=hash(event),old=one('SELECT digest FROM ai_channel_event_hashes WHERE task_id=? AND seq=?',task.id,event.seq);
   if(old){if(old.digest!==digest)fail(409,'AI_EVENT_CONFLICT','重复事件编号与内容不同。');continue;}
   if(event.seq!==current.last_seq+1)fail(409,'AI_EVENT_SEQUENCE','事件存在缺口，请从未确认的编号重试。');
   if(final.has(current.status))break;
   const outputChars=current.output_chars+(event.text?.length||0);
   if(outputChars>AI_CHANNEL_LIMITS.totalOutputChars||current.event_count>=AI_CHANNEL_LIMITS.eventCount){terminal(current,'failed','AI_OUTPUT_LIMIT');break;}
   run('INSERT INTO ai_channel_event_hashes VALUES(?,?,?)',task.id,event.seq,digest);
   run('UPDATE ai_channel_tasks SET last_seq=?,event_count=event_count+1,output_chars=? WHERE id=?',event.seq,outputChars,task.id);
   entry.events.push(event);
   while(entry.events.length>AI_CHANNEL_LIMITS.events||entry.events.reduce((n,e)=>n+(e.text?.length||0),0)>AI_CHANNEL_LIMITS.retainedChars)entry.events.shift();
   if(event.kind==='completed')terminal(current,'succeeded');else if(event.kind==='failed')terminal(current,'failed',event.code||'AI_EXECUTION_FAILED');
   current=row(task.id);
  }
 }
 function poll(token,input={}){
  fields(input,['connectorId','taskId','leaseId','events','status']);if(!uuid(input.connectorId))fail(400,'INVALID_CONNECTOR_ID','连接器编号无效。');
  const state=checkedStatus(input.status);if(input.taskId!==undefined&&!uuid(input.taskId)||input.leaseId!==undefined&&!uuid(input.leaseId))fail(400,'INVALID_AI_LEASE','执行租约无效。');
  if(Boolean(input.taskId)!==Boolean(input.leaseId))fail(400,'INVALID_AI_LEASE','任务与执行租约须同时提供。');
  if(!Array.isArray(input.events??[])||(input.events||[]).length>50||!input.taskId&&(input.events||[]).length)fail(400,'INVALID_AI_EVENT','事件批次无效。');
  const events=(input.events||[]).map(normalizeEvent),device=devices.authenticateAgent(token);maintain();
  return transaction(()=>{
   devices.authenticateAgent(token);
   const active=one("SELECT * FROM ai_channel_tasks WHERE device_id=? AND status='running'",device.id);
   if(active&&active.connector_id!==input.connectorId)fail(409,'AI_CONNECTOR_BUSY','另一连接器正在执行任务。');
   run("INSERT INTO ai_channel_devices VALUES(?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET connector_id=excluded.connector_id,status_code=excluded.status_code,workspace_label=excluded.workspace_label,provider=excluded.provider,last_seen=excluded.last_seen",device.id,input.connectorId,state.code,state.workspaceLabel,'Codex',now());
   run('UPDATE personal_devices SET last_seen=? WHERE id=?',now(),device.id);
   if(state.filePublicKey)publicKeys.set(device.id,state.filePublicKey);
   let task=input.taskId?row(input.taskId):null;
   if(input.taskId){
    if(!task||task.device_id!==device.id||task.connector_id!==input.connectorId||task.lease_id!==input.leaseId)fail(403,'AI_LEASE_DENIED','执行租约与设备不匹配。');
    if(!final.has(task.status)&&state.code!=='ready')terminal(task,'failed',state.code==='login-required'?'AI_LOGIN_REQUIRED':state.code==='quota'?'AI_QUOTA':'AI_UNAVAILABLE');
    task=row(task.id);
    if(!final.has(task.status))acceptEvents(task,events);
    else for(const event of events){const old=one('SELECT digest FROM ai_channel_event_hashes WHERE task_id=? AND seq=?',task.id,event.seq);if(old&&old.digest!==hash(event))fail(409,'AI_EVENT_CONFLICT','重复事件编号与内容不同。');}
    task=row(task.id);
    if(final.has(task.status))return {serverNow:now(),expiresAt:now(),task:null,cancelTaskId:task.id,ack:task.last_seq};
    const until=Math.min(task.hard_until,now()+AI_CHANNEL_LIMITS.leaseMs);run('UPDATE ai_channel_tasks SET lease_until=? WHERE id=?',until,task.id);
    return {serverNow:now(),expiresAt:until,task:null,ack:task.last_seq};
   }
   if(active)return {serverNow:now(),expiresAt:now(),task:null,ack:0};
   if(state.code!=='ready')return {serverNow:now(),expiresAt:now(),task:null,ack:0};
   task=one("SELECT * FROM ai_channel_tasks WHERE device_id=? AND status='queued' ORDER BY created_at,rowid LIMIT 1",device.id);
   if(!task)return {serverNow:now(),expiresAt:now(),task:null,ack:0};
   const entry=memory.get(task.id);if(!entry){terminal(task,'failed','AI_EXECUTION_INTERRUPTED');return {serverNow:now(),expiresAt:now(),task:null,ack:0};}
   const leaseId=randomUUID(),hardUntil=now()+AI_CHANNEL_LIMITS.hardMs,until=now()+AI_CHANNEL_LIMITS.leaseMs;
   run("UPDATE ai_channel_tasks SET status='running',connector_id=?,lease_id=?,lease_until=?,hard_until=?,started_at=? WHERE id=?",input.connectorId,leaseId,until,hardUntil,now(),task.id);
   return {serverNow:now(),expiresAt:until,task:{id:task.id,prompt:entry.prompt,leaseId,expiresAt:hardUntil,attachments:entry.attachments||[],replyPublicKey:entry.replyPublicKey||null},ack:0};
  });
 }
 function authorizeOwner(token,deviceId){const account=socialService.assertAIAccess(token,{write:true}),device=devices.ownedDevice(account,deviceId);if(device.revoked_at||!device.token_hash)fail(403,'AI_DEVICE_REVOKED','设备已撤销或尚未配对。');return {ownerId:account.id,deviceId:device.id};}
 function authorizeAgent(token,{taskId,leaseId}={}){const device=devices.authenticateAgent(token);maintain();const task=row(taskId);if(!task||task.device_id!==device.id||task.status!=='running'||task.lease_id!==leaseId||task.lease_until<=now()||task.hard_until<=now())fail(403,'AI_LEASE_DENIED','AI 执行租约已失效。');return {ownerId:task.owner_id,deviceId:device.id,taskId:task.id};}
 function handleAgentFiles(token,path,input){if(!filesService)fail(503,'AI_FILES_UNAVAILABLE','加密文件中转尚未配置。');devices.authenticateAgent(token);return filesService.handleAgent(token,path,input);}
 return {handle,poll,maintain,restart,revokeDevice,authorizeOwner,authorizeAgent,handleAgentFiles,setFilesService(value){filesService=value;},limits:AI_CHANNEL_LIMITS};
}
