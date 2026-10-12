import {decisionProposal} from './decision-protocol.mjs';
import {readFile,writeFile,mkdir,realpath,stat,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeCodexMessage,redactAIChannelText} from './codex-runner.mjs';
import {createProviderRunner} from './provider-runner.mjs';
export {redactAIChannelText} from './codex-runner.mjs';
import {localDeadline} from './protocol.mjs';
import {createAIChannelFiles} from './ai-channel-files.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{code});
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const snooze=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function boundedJSON(response,max=262144){
 if(!response.body)throw fail('AI_RELAY_RESPONSE','中转服务响应无效。');const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw fail('AI_RELAY_RESPONSE','中转服务响应过大。');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

// The journal stores public identifiers only. No prompt, AI output, tool output,
// account login data or signed payload is written here. Tombstones never expire
// automatically: a full journal stops new work rather than replaying old tasks.
export async function openAIChannelJournal({runtimeDir,workspace,maxStarted=2048}={}){
 if(typeof runtimeDir!=='string'||!path.isAbsolute(runtimeDir))throw fail('AI_STATE_PATH','运行状态目录必须是工作区之外的绝对路径。');
 const cwd=await realpath(workspace);await mkdir(runtimeDir,{recursive:true,mode:0o700});const base=await realpath(runtimeDir);
 if(inside(cwd,base)||path.parse(base).root===base)throw fail('AI_STATE_PATH','运行状态目录必须位于工作区之外，不能使用根目录。');
 const filename=path.join(base,'ai-channel-state.json'),lockPath=path.join(base,'ai-channel.lock');
 let lock;try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}catch{throw fail('AI_CONNECTOR_RUNNING','此状态目录已有连接器或残留锁。先确认旧进程已停止，再人工处理锁文件。');}
 let state,writing=Promise.resolve();
 async function persist(){const snapshot=JSON.stringify(state);const job=writing.then(async()=>{const temp=filename+'.'+randomUUID()+'.tmp';const h=await open(temp,'wx',0o600);try{await h.writeFile(snapshot);await h.sync();}finally{await h.close();}await rename(temp,filename);});writing=job.catch(()=>{});return job;}
 try{
  try{const info=await stat(filename);if(info.size>2000000)throw Error();state=JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code!=='ENOENT')throw fail('AI_STATE_INVALID','连接器状态损坏，不能清空状态后重试旧任务。');state={schemaVersion:1,connectorId:randomUUID(),started:[]};}
  if(state.schemaVersion!==1||!uuid(state.connectorId)||!Array.isArray(state.started)||state.started.length>maxStarted||state.started.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))||new Set(state.started).size!==state.started.length)throw fail('AI_STATE_INVALID','连接器去重状态无效。');
  state.decisions??=[];
  if(!Array.isArray(state.decisions)||state.decisions.length>maxStarted||state.decisions.some(x=>!uuid(x.taskId)||!uuid(x.root)||!['codex','ollama'].includes(x.provider)||![x.digest,x.scope,x.workspaceHash].every(v=>/^[a-f0-9]{64}$/.test(v))||x.child!==null&&!uuid(x.child))||new Set(state.decisions.map(x=>x.taskId)).size!==state.decisions.length)throw fail('AI_STATE_INVALID','决策续作记录无效。');
  await persist();
 }catch(error){await lock.close();await unlink(lockPath).catch(()=>{});throw error;}
 return {connectorId:state.connectorId,runtimeDir:base,
 async markPaused({taskId,root,provider,digest,scope}){
  if(!uuid(taskId)||!uuid(root)||!['codex','ollama'].includes(provider)||![digest,scope].every(x=>/^[a-f0-9]{64}$/.test(x))||!this.has(taskId)||state.decisions.some(x=>x.taskId===taskId)||state.decisions.length>=maxStarted)throw fail('AI_DECISION_INVALID','不能记录本次暂停。');
  state.decisions.push({taskId,root,provider,digest,scope,workspaceHash:hash(cwd),child:null});await persist();
 },
 async reserveContinuation(task,scope){
  const previous=state.decisions.find(x=>x.taskId===task.parentTaskId);
  if(!uuid(task.id)||!previous||previous.child||previous.root!==task.workspaceTaskId||previous.provider!==(task.provider||'codex')||previous.digest!==task.decisionDigest||previous.scope!==scope||previous.workspaceHash!==hash(cwd)||this.has(task.id))throw fail('AI_CONTINUATION_INVALID','续作来源未通过本机核对，没有执行。');
  if(this.full)throw fail('AI_JOURNAL_FULL','任务去重记录已满。');previous.child=task.id;state.started.push(hash(task.id));await persist();
 },has:taskId=>state.started.includes(hash(taskId)),get full(){return state.started.length>=maxStarted;},async markStarted(taskId){if(!id(taskId))throw fail('AI_TASK_INVALID','任务标识无效。');if(this.has(taskId))return false;if(this.full)throw fail('AI_JOURNAL_FULL','任务去重记录已满，请先归档并人工确认历史任务不会重发。');state.started.push(hash(taskId));await persist();return true;},async close(){await writing;await lock.close();await unlink(lockPath).catch(()=>{});}};
}

export async function createAIChannel({statePath,runtimeDir,runner,fetchImpl=globalThis.fetch,workspaceLabel,clock=()=>performance.now(),log=()=>{},fileHooks=null,fileHooksFactory=null,heartbeatMs=15000,maxStarted=2048,capabilities=null,source=null}={}){
 if(!runner?.configuration?.workspace||typeof statePath!=='string'||!path.isAbsolute(statePath))throw fail('AI_STARTUP_PATH','必须提供本机固定工作目录与绝对配对文件路径。');
 const stateFile=await realpath(statePath),cwd=await realpath(runner.configuration.workspace);
 if(inside(cwd,stateFile))throw fail('AI_STATE_PATH','设备凭据文件必须位于 AI 工作区之外。');
 const info=await stat(stateFile);if(!info.isFile()||info.size>16384)throw fail('AI_STATE_INVALID','配对文件无效。');
 const config=JSON.parse(await readFile(stateFile,'utf8'));let origin;
 try{origin=new URL(config.origin);if(origin.protocol!=='https:'||origin.origin!==config.origin||origin.username||origin.password)throw Error();}catch{throw fail('AI_HTTPS_REQUIRED','连接器只允许已配对的可信 HTTPS 服务，不提供 HTTP 例外。');}
 if(!/^[A-Za-z0-9_-]{43}$/.test(config.token||'')&&!/^[A-Za-z0-9_-]{43}$/.test(config.pairToken||''))throw fail('AI_STATE_INVALID','需要现有设备凭据或尚未过期的配对文件。');
 if(!Number.isFinite(heartbeatMs)||heartbeatMs<=0||heartbeatMs>15000)throw fail('AI_LEASE_INVALID','授权心跳不能超过十五秒。');
 const journal=await openAIChannelJournal({runtimeDir,workspace:cwd,maxStarted});
 const label=String(workspaceLabel||path.basename(cwd)).slice(0,80);
 const active=new Map(),maxConcurrent=runner.configuration.maxConcurrent||1;let stopped=false,polling=false,statusCode='error',lastLoginCheck=-Infinity,scanPending=null;
 if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>3)throw fail('AI_CAPACITY','并发上限无效。');
 let providers=[],scannedAt=0;
 const overallStatus=()=>providers.some(provider=>provider.executionSupported)?'ready':providers.some(provider=>provider.installed&&provider.loggedIn===false)?'login-required':'error';
 function recordStatus(login){
  if(Array.isArray(login.providers)){
   providers=login.providers.map(({id,name,installed,loggedIn,version,reason,executionSupported,executionMode})=>({id,name,installed,loggedIn,version,reason,executionSupported,executionMode}));scannedAt=login.scannedAt;
   statusCode=overallStatus();
  }else{
   // A pre-registry runner is explicitly Codex-only. Missing provider metadata
   // never makes an unrelated AI available or routes its prompt to Codex.
   const ready=login.code==='ready';
   providers=[{id:'codex',name:'Codex',installed:true,loggedIn:ready?true:login.code==='login-required'?false:null,version:null,reason:ready?'旧版 Codex 连接器已登录；仅支持 Codex。':'旧版 Codex 连接器尚未就绪。',executionSupported:ready,executionMode:ready?'tools':'disabled'}];
   scannedAt=Date.now();statusCode=['ready','login-required','quota','error'].includes(login.code)?login.code:'error';
  }
 }
 async function call(route,input,{signal}={}){
  const response=await fetchImpl(origin.origin+'/api/device-bridge/'+route,{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',...(config.token?{Authorization:'Bearer '+config.token}:{})},body:JSON.stringify(input)});
  if(!response.ok){let relayCode;try{const value=await boundedJSON(response,8192);if(typeof value.code==='string'&&/^[A-Z_]{1,80}$/.test(value.code))relayCode=value.code;}catch{}throw Object.assign(fail('AI_RELAY_UNAVAILABLE','连接器请求未完成。'),{status:response.status,relayCode});}return boundedJSON(response,route.startsWith('ai/files/')?300000:262144);
 }
 if(fileHooksFactory)try{fileHooks=await fileHooksFactory({workspace:cwd,isolatedTasks:runner.configuration.isolatedTasks===true,runtimeDir:journal.runtimeDir,call:(route,input,options)=>call('ai/'+route,input,options)});}catch(error){await journal.close();throw error;}
 function emit(task,event){
  if(active.get(task.id)!==task||task.terminal)return;
  const terminal=['completed','failed','decision'].includes(event.kind);
  if(task.events.length>=100&&!terminal){task.job?.cancel('AI_OUTPUT_LIMIT');return;}
  const clean={seq:++task.seq,kind:event.kind,...(event.itemId?{itemId:String(event.itemId).slice(0,100)}:{}),...(event.text?{text:redactAIChannelText(event.text).slice(0,2000)}:{}),...(event.code?{code:String(event.code).slice(0,80)}:{})};
  if(event.kind==='decision')Object.assign(clean,{question:event.question,options:event.options,decisionDigest:event.decisionDigest});
  task.events.push(clean);if(terminal){
   task.terminal=true;
   if(['AI_LOGIN_REQUIRED','AI_QUOTA','AI_TOOL_UNAVAILABLE','AI_EXECUTION_FAILED','AI_OLLAMA_UNAVAILABLE','AI_OLLAMA_MODEL_REQUIRED','AI_OLLAMA_MODEL_UNVERIFIED'].includes(event.code)){
    providers=providers.map(provider=>provider.id!==task.provider?provider:{...provider,executionSupported:false,executionMode:'disabled',...(event.code==='AI_LOGIN_REQUIRED'?{loggedIn:false}:{}),reason:event.code==='AI_LOGIN_REQUIRED'?'需要登录，请在这台电脑由本人完成。':event.code==='AI_QUOTA'?'该 AI 当前额度不足，请在电脑检查。':'该 AI 的安全执行环境尚未就绪，请在电脑检查。'});
    statusCode=overallStatus();
   }
  }
  log({taskId:task.id,kind:clean.kind,chars:clean.text?.length||0});
 }
 function stopTask(code,current){if(!current){for(const t of active.values())stopTask(code,t);return;}if(current.terminal)return;if(current.job&&!current.jobFinished)current.job.cancel(code);else emit(current,{kind:'failed',code,text:safeCodexMessage(code)});current.controller.abort();}
 function retireServerTerminal(task,code='AI_CANCELLED'){
  // cancelTaskId is authoritative server termination, not an acknowledgement
  // of queued events. Drop them only after the actual process has exited.
  if(task.retiring)return task.retiring;
  task.terminal=true;
  if(task.job&&!task.jobFinished)task.job.cancel(code);
  task.controller.abort();
  task.retiring=(async()=>{if(task.job)await task.job.done;task.events=[];if(active.get(task.id)===task)active.delete(task.id);})().catch(()=>{log({code:'AI_EXECUTION_INTERRUPTED'});});
  return task.retiring;
 }
 function enforceLease(){for(const task of active.values())if(!task.terminal){if(clock()>=task.hardUntil)stopTask('AI_TIMEOUT',task);else if(clock()>=task.leaseUntil)stopTask('AI_LEASE_EXPIRED',task);}}
 const watchdog=setInterval(enforceLease,100);watchdog.unref?.();
 async function enroll(){if(config.token)return;const value=await call('enroll',{pairToken:config.pairToken});if(!/^[A-Za-z0-9_-]{43}$/.test(value.token||'')||!id(value.deviceId))throw fail('AI_STATE_INVALID','设备配对响应无效。');config.token=value.token;config.deviceId=value.deviceId;delete config.pairToken;await writeFile(stateFile,JSON.stringify(config),{mode:0o600});}
 async function acceptTask(task,reply,sentAt,receivedAt){
  if(active.size>=maxConcurrent||active.has(task?.id))throw fail('AI_RELAY_RESPONSE','服务端派发超出本机容量或重复任务。');
  if(!task||!id(task.id)||!id(task.leaseId)||typeof task.prompt!=='string'||!task.prompt.trim()||task.prompt.length>8000||!Number.isFinite(task.expiresAt)||task.provider!==undefined&&!['codex','claude','workb','ollama'].includes(task.provider))throw fail('AI_TASK_INVALID','任务内容或范围无效。');
  const providerId=task.provider??'codex',provider=providers.find(item=>item.id===providerId);
  const continuation=task.parentTaskId!==undefined,workspaceTaskId=continuation?task.workspaceTaskId:task.id;
  const hardUntil=localDeadline({expiresAt:task.expiresAt,serverTime:reply.serverNow,receivedAt,roundTrip:receivedAt-sentAt});
  const leaseUntil=Math.min(receivedAt+heartbeatMs,localDeadline({expiresAt:reply.expiresAt,serverTime:reply.serverNow,receivedAt,roundTrip:receivedAt-sentAt}));
  const current={id:task.id,workspaceTaskId,provider:providerId,executionMode:provider?.executionMode,leaseId:task.leaseId,events:[],seq:0,acked:0,terminal:false,hardUntil,leaseUntil,job:null,jobFinished:false,controller:new AbortController()};active.set(task.id,current);
  if(hardUntil<=receivedAt||leaseUntil<=receivedAt){emit(current,{kind:'failed',code:'AI_LEASE_EXPIRED',text:safeCodexMessage('AI_LEASE_EXPIRED')});return;}
  if(journal.has(task.id)){emit(current,{kind:'failed',code:'AI_EXECUTION_INTERRUPTED',text:'此任务已有启动记录，不会在重启后自动重复执行。'});return;}
  if(provider?.executionSupported!==true||!['codex','ollama'].includes(providerId)){emit(current,{kind:'failed',code:provider?.loggedIn===false?'AI_LOGIN_REQUIRED':'AI_PROVIDER_UNAVAILABLE',text:provider?.loggedIn===false?'所选 AI 需要由本人在这台电脑完成登录。':'所选 AI 没有可用的安全执行适配，本次没有执行。'});return;}
  if(provider.executionMode==='chat-only'&&task.attachments!==undefined&&(!Array.isArray(task.attachments)||task.attachments.length)){emit(current,{kind:'failed',code:'AI_PROVIDER_FILES_UNSUPPORTED',text:'所选本地模型仅支持文字对话，不能读取附件或执行文件。'});return;}
  try{
   if(continuation){
    if(!uuid(task.parentTaskId)||!uuid(task.workspaceTaskId)||!runner.configuration.isolatedTasks||[...active.values()].some(t=>t!==current&&t.workspaceTaskId===workspaceTaskId&&!t.terminal))throw fail('AI_CONTINUATION_INVALID','续作工作区未通过核对。');
    await journal.reserveContinuation(task,hash(origin.origin+'\n'+config.token));
   }else{if(task.workspaceTaskId!==undefined||task.decisionDigest!==undefined||task.parentDecisionId!==undefined)throw fail('AI_CONTINUATION_INVALID','不能单独指定工作区或批准来源。');await journal.markStarted(task.id);}
   // Optional file transport remains separate; it must keep state outside cwd,
   // use task-local inbox/outbox and return only a local prompt suffix.
   // Do not hold the outbound polling loop while local files are prepared.
   void startTask();
  }catch(error){emit(current,{kind:'failed',code:['AI_JOURNAL_FULL','AI_CONTINUATION_INVALID'].includes(error.code)?error.code:'AI_EXECUTION_FAILED',text:error.code==='AI_JOURNAL_FULL'?'去重记录已满，连接器已停止接受新任务。':safeCodexMessage('AI_EXECUTION_FAILED')});}
  async function startTask(){try{
   const prepared=current.executionMode==='tools'&&fileHooks?.prepareTask?await fileHooks.prepareTask(task,{signal:current.controller.signal}):null;
   if(active.get(current.id)!==current||current.terminal||stopped)return;
   enforceLease();if(current.terminal)return;
   const promptSuffix=prepared?.promptSuffix||'';
   if(typeof promptSuffix!=='string'||promptSuffix.length>2000)throw fail('AI_TASK_INVALID','本机文件指引超过独立上限。');
   current.job=runner.run({provider:providerId,taskId:task.id,...(continuation?{workspaceTaskId}:{}),prompt:task.prompt,promptSuffix,signal:current.controller.signal,timeoutMs:Math.max(1,current.hardUntil-clock()),onEvent:event=>{
    if(['completed','failed','decision'].includes(event.kind))current.jobFinished=true;
    if(event.kind==='decision'){
     void Promise.resolve().then(async()=>{
      const proposal=decisionProposal(event,{redact:redactAIChannelText});if(proposal.decisionDigest!==event.decisionDigest)throw fail('AI_DECISION_INVALID','暂停内容摘要不一致。');
      if(current.executionMode==='tools'&&fileHooks?.collectTask)await fileHooks.collectTask(task,{signal:current.controller.signal});
      enforceLease();if(current.controller.signal.aborted||current.terminal||stopped)return;
      await journal.markPaused({taskId:task.id,root:workspaceTaskId,provider:providerId,digest:proposal.decisionDigest,scope:hash(origin.origin+'\n'+config.token)});
      enforceLease();if(!current.controller.signal.aborted&&!current.terminal&&!stopped)emit(current,{kind:'decision',...proposal});
     }).catch(error=>{if(!current.terminal)emit(current,{kind:'failed',code:error.code==='AI_DECISION_INVALID'?'AI_DECISION_INVALID':'AI_FILE_TRANSFER_FAILED',text:'决策或样张未能安全传回，本次没有继续执行。'});});
    }else if(event.kind==='completed'&&current.executionMode==='tools'&&fileHooks?.collectTask){void Promise.resolve().then(()=>fileHooks.collectTask(task,{signal:current.controller.signal})).then(()=>{enforceLease();if(!current.controller.signal.aborted)emit(current,event);},()=>emit(current,{kind:'failed',code:'AI_FILE_TRANSFER_FAILED',text:'任务执行结束，但成果文件传回未完成，请保留电脑上的原文件。'}));}else emit(current,event);
   }});
  }catch{emit(current,{kind:'failed',code:'AI_EXECUTION_FAILED',text:safeCodexMessage('AI_EXECUTION_FAILED')});}}
 }
 function refreshStatus(){
  if(scanPending)return scanPending;
  lastLoginCheck=clock();
  scanPending=(async()=>{
    // The relay accepts a registry scan for five minutes. Long executions must
    // renew facts, not manufacture a new timestamp from cached login state.
    try{recordStatus(await runner.loginStatus());}catch{
     providers=providers.map(provider=>({...provider,executionSupported:false,executionMode:'disabled',reason:'本机检测未完成，请在电脑刷新后再试。'}));
     scannedAt=Date.now();statusCode='error';
    }
    if(!stopped)for(const current of active.values())if(!current.terminal&&!providers.some(provider=>provider.id===current.provider&&provider.executionSupported))stopTask('AI_PROVIDER_UNAVAILABLE',current);
   })().finally(()=>{scanPending=null;});return scanPending;
 }
 function pollFailure(error,current){
  if(error.status===401||error.status===403&&!(current&&error.relayCode==='AI_LEASE_DENIED')){stopped=true;stopTask('AI_REVOKED');}
  else if(current&&(error.status===409||error.status===403&&error.relayCode==='AI_LEASE_DENIED'||['AI_TASK_INVALID','AI_RELAY_RESPONSE'].includes(error.code))){
   // A bad receipt or revoked task lease belongs to this task only. Preserve
   // its occupied slot until the child exits, while siblings keep heartbeating.
   void retireServerTerminal(current,'AI_LEASE_EXPIRED');
  }
  enforceLease();log({code:error.status===401?'AI_REVOKED':'AI_CONNECTION_INTERRUPTED'});
 }
 async function pollTask(current){
  if(stopped||current?.retiring)return;
  try{
   const input={...(maxConcurrent>1?{capacity:runner.canDispatch?.()===false?0:maxConcurrent}:{}),connectorId:journal.connectorId,...(current?{taskId:current.id,leaseId:current.leaseId}:{}),events:current?current.events.slice(0,20):[],status:{code:statusCode,workspaceLabel:label,providers,scannedAt,decisionProtocolVersion:runner.configuration.isolatedTasks===true?1:0,...(fileHooks?.publicKey?{filePublicKey:fileHooks.publicKey}:{}),...(capabilities?{capabilities}:{}),...(source?{source}:{})}};
   const sentAt=clock(),reply=await call('ai/poll',input),receivedAt=clock();
   if(!Number.isFinite(reply.serverNow)||!Number.isFinite(reply.expiresAt)||!Number.isSafeInteger(reply.ack)||reply.ack<0)throw fail('AI_RELAY_RESPONSE','授权租约响应无效。');
   if(stopped)return;
   if(current&&active.get(current.id)===current){
    if(reply.cancelTaskId===current.id){void retireServerTerminal(current);return;}
    const lastSent=input.events.at(-1)?.seq??current.acked;
    if(reply.ack<current.acked||reply.ack>lastSent)throw fail('AI_RELAY_RESPONSE','任务事件确认序号无效。');
    current.acked=reply.ack;current.events=current.events.filter(e=>e.seq>reply.ack);
    if(!current.terminal)current.leaseUntil=Math.min(current.hardUntil,receivedAt+heartbeatMs,localDeadline({expiresAt:reply.expiresAt,serverTime:reply.serverNow,receivedAt,roundTrip:receivedAt-sentAt}));
    if(current.terminal&&!current.events.length)active.delete(current.id);
   }
   if(reply.task){if(current)throw fail('AI_RELAY_RESPONSE','任务心跳不能派发另一个任务。');await acceptTask(reply.task,reply,sentAt,receivedAt);}
  }catch(error){pollFailure(error,current);}
 }
 async function pollOnce(){
  if(stopped||polling)return;polling=true;
  try{
   await enroll();enforceLease();
   if(clock()-lastLoginCheck>=60000){const scan=refreshStatus();if(!active.size)await scan;}
   if(journal.full)statusCode='error';
   // Network calls and process shutdowns for one task must not consume the
   // fifteen-second authorization window of any other running task.
   const currents=[...active.values(),...(active.size<maxConcurrent?[null]:[])];
   await Promise.all(currents.map(current=>pollTask(current)));
   enforceLease();
  }catch(error){pollFailure(error,null);}finally{polling=false;}
 }
 return {pollOnce,call,get stopped(){return stopped;},get activeTaskIds(){return [...active.keys()];},get activeTaskId(){return active.keys().next().value||null;},get status(){return statusCode;},connectorId:journal.connectorId,async run({signal}={}){const abort=()=>{stopped=true;stopTask('AI_CANCELLED');};signal?.addEventListener('abort',abort,{once:true});try{while(!stopped&&!signal?.aborted){await pollOnce();if(!stopped)await snooze(active.size?700:2500);}}finally{signal?.removeEventListener('abort',abort);}},async close(){stopped=true;stopTask('AI_CANCELLED');clearInterval(watchdog);await runner.close();await journal.close();}};
}

export function parseAIChannelArguments(args){
 const values={};const allowed=new Set(['codex','workspace','state','runtime-dir','label','ollama-model','max-concurrent']);
 for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');if(!args[i]?.startsWith('--')||!allowed.has(key)||values[key]!==undefined||typeof args[i+1]!=='string'||args[i+1].startsWith('--'))throw fail('AI_ARGUMENTS','参数仅允许本机 Codex、模型、工作区和连接状态设置。');values[key]=args[i+1];}
 if(['workspace','state','runtime-dir'].some(k=>!values[k]))throw fail('AI_ARGUMENTS','需要 --workspace、--state 和 --runtime-dir。');
 if(values['max-concurrent']!==undefined&&!/^[1-3]$/.test(values['max-concurrent']))throw fail('AI_ARGUMENTS','并发上限必须为 1–3。');
 return {maxConcurrent:Number(values['max-concurrent']||3),executable:values.codex,ollamaModel:values['ollama-model']||null,workspace:values.workspace,statePath:values.state,runtimeDir:values['runtime-dir'],workspaceLabel:values.label};
}

async function main(){
 const options=parseAIChannelArguments(process.argv.slice(2));const runner=await createProviderRunner(options);
 const channel=await createAIChannel({...options,runner,fileHooksFactory:createAIChannelFiles,log:entry=>console.log(JSON.stringify(entry))});
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await channel.run({signal:controller.signal});}finally{await channel.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({code:error.code||'AI_CONNECTOR_FAILED',message:'连接器没有继续执行，请检查本机固定路径、配对状态和登录。'}));process.exitCode=1;});
