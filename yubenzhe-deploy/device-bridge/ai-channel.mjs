import {readFile,writeFile,mkdir,realpath,stat,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCodexRunner,safeCodexMessage,redactAIChannelText} from './codex-runner.mjs';
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
 let state;
 async function persist(){const temp=filename+'.tmp';await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,filename);}
 try{
  try{const info=await stat(filename);if(info.size>300000)throw Error();state=JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code!=='ENOENT')throw fail('AI_STATE_INVALID','连接器状态损坏，不能清空状态后重试旧任务。');state={schemaVersion:1,connectorId:randomUUID(),started:[]};}
  if(state.schemaVersion!==1||!uuid(state.connectorId)||!Array.isArray(state.started)||state.started.length>maxStarted||state.started.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/.test(x))||new Set(state.started).size!==state.started.length)throw fail('AI_STATE_INVALID','连接器去重状态无效。');
  await persist();
 }catch(error){await lock.close();await unlink(lockPath).catch(()=>{});throw error;}
 return {connectorId:state.connectorId,runtimeDir:base,has:taskId=>state.started.includes(hash(taskId)),get full(){return state.started.length>=maxStarted;},async markStarted(taskId){if(!id(taskId))throw fail('AI_TASK_INVALID','任务标识无效。');if(this.has(taskId))return false;if(this.full)throw fail('AI_JOURNAL_FULL','任务去重记录已满，请先归档并人工确认历史任务不会重发。');state.started.push(hash(taskId));await persist();return true;},async close(){await lock.close();await unlink(lockPath).catch(()=>{});}};
}

export async function createAIChannel({statePath,runtimeDir,runner,fetchImpl=globalThis.fetch,workspaceLabel,clock=()=>performance.now(),log=()=>{},fileHooks=null,fileHooksFactory=null,heartbeatMs=15000,maxStarted=2048}={}){
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
 let active=null,stopped=false,polling=false,statusCode='error',lastLoginCheck=-Infinity;
 async function call(route,input,{signal}={}){
  const response=await fetchImpl(origin.origin+'/api/device-bridge/'+route,{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',...(config.token?{Authorization:'Bearer '+config.token}:{})},body:JSON.stringify(input)});
  if(!response.ok){await response.body?.cancel();throw Object.assign(fail('AI_RELAY_UNAVAILABLE','连接器请求未完成。'),{status:response.status});}return boundedJSON(response,route.startsWith('ai/files/')?300000:262144);
 }
 if(fileHooksFactory)try{fileHooks=await fileHooksFactory({workspace:cwd,runtimeDir:journal.runtimeDir,call:(route,input,options)=>call('ai/'+route,input,options)});}catch(error){await journal.close();throw error;}
 function emit(task,event){
  if(active!==task||task.terminal)return;
  const terminal=['completed','failed'].includes(event.kind);
  if(task.events.length>=100&&!terminal){task.job?.cancel('AI_OUTPUT_LIMIT');return;}
  const clean={seq:++task.seq,kind:event.kind,...(event.itemId?{itemId:String(event.itemId).slice(0,100)}:{}),...(event.text?{text:redactAIChannelText(event.text).slice(0,2000)}:{}),...(event.code?{code:String(event.code).slice(0,80)}:{})};
  task.events.push(clean);if(terminal){task.terminal=true;if(event.code==='AI_LOGIN_REQUIRED')statusCode='login-required';if(event.code==='AI_QUOTA')statusCode='quota';if(event.code==='AI_TOOL_UNAVAILABLE')statusCode='error';}
  log({taskId:task.id,kind:clean.kind,chars:clean.text?.length||0});
 }
 function stopTask(code){if(!active||active.terminal)return;active.controller.abort();if(active.job&&!active.jobFinished)active.job.cancel(code);else emit(active,{kind:'failed',code,text:safeCodexMessage(code)});}
 async function retireServerTerminal(task){
  // cancelTaskId is authoritative server termination, not an acknowledgement
  // of queued events. Drop them only after the actual process has exited.
  task.controller.abort();task.terminal=true;
  if(task.job){task.job.cancel('AI_CANCELLED');await task.job.done;}
  task.events=[];
  if(active===task)active=null;
 }
 function enforceLease(){if(active&&!active.terminal){if(clock()>=active.hardUntil)stopTask('AI_TIMEOUT');else if(clock()>=active.leaseUntil)stopTask('AI_LEASE_EXPIRED');}}
 const watchdog=setInterval(enforceLease,100);watchdog.unref?.();
 async function enroll(){if(config.token)return;const value=await call('enroll',{pairToken:config.pairToken});if(!/^[A-Za-z0-9_-]{43}$/.test(value.token||'')||!id(value.deviceId))throw fail('AI_STATE_INVALID','设备配对响应无效。');config.token=value.token;config.deviceId=value.deviceId;delete config.pairToken;await writeFile(stateFile,JSON.stringify(config),{mode:0o600});}
 async function acceptTask(task,reply,sentAt,receivedAt){
  if(active)throw fail('AI_RELAY_RESPONSE','服务端尝试同时分配多个任务。');
  if(!task||!id(task.id)||!id(task.leaseId)||typeof task.prompt!=='string'||!task.prompt.trim()||task.prompt.length>8000||!Number.isFinite(task.expiresAt))throw fail('AI_TASK_INVALID','任务内容或范围无效。');
  const hardUntil=localDeadline({expiresAt:task.expiresAt,serverTime:reply.serverNow,receivedAt,roundTrip:receivedAt-sentAt});
  const leaseUntil=Math.min(receivedAt+heartbeatMs,localDeadline({expiresAt:reply.expiresAt,serverTime:reply.serverNow,receivedAt,roundTrip:receivedAt-sentAt}));
  active={id:task.id,leaseId:task.leaseId,events:[],seq:0,acked:0,terminal:false,hardUntil,leaseUntil,job:null,jobFinished:false,controller:new AbortController()};const current=active;
  if(hardUntil<=receivedAt||leaseUntil<=receivedAt){emit(current,{kind:'failed',code:'AI_LEASE_EXPIRED',text:safeCodexMessage('AI_LEASE_EXPIRED')});return;}
  if(journal.has(task.id)){emit(current,{kind:'failed',code:'AI_EXECUTION_INTERRUPTED',text:'此任务已有启动记录，不会在重启后自动重复执行。'});return;}
  if(statusCode!=='ready'){emit(current,{kind:'failed',code:statusCode==='login-required'?'AI_LOGIN_REQUIRED':statusCode==='quota'?'AI_QUOTA':'AI_EXECUTION_FAILED',text:statusCode==='login-required'?safeCodexMessage('AI_LOGIN_REQUIRED'):safeCodexMessage('AI_EXECUTION_FAILED')});return;}
  try{
   await journal.markStarted(task.id);
   // Optional file transport remains separate; it must keep state outside cwd,
   // use task-local inbox/outbox and return only a local prompt suffix.
   // Do not hold the outbound polling loop while local files are prepared.
   void startTask();
  }catch(error){emit(current,{kind:'failed',code:error.code==='AI_JOURNAL_FULL'?'AI_JOURNAL_FULL':'AI_EXECUTION_FAILED',text:error.code==='AI_JOURNAL_FULL'?'去重记录已满，连接器已停止接受新任务。':safeCodexMessage('AI_EXECUTION_FAILED')});}
  async function startTask(){try{
   const prepared=fileHooks?.prepareTask?await fileHooks.prepareTask(task,{signal:current.controller.signal}):null;
   if(active!==current||current.terminal||stopped)return;
   enforceLease();if(current.terminal)return;
   const promptSuffix=prepared?.promptSuffix||'';
   if(typeof promptSuffix!=='string'||promptSuffix.length>2000)throw fail('AI_TASK_INVALID','本机文件指引超过独立上限。');
   current.job=runner.run({taskId:task.id,prompt:task.prompt,promptSuffix,timeoutMs:Math.max(1,current.hardUntil-clock()),onEvent:event=>{
    if(['completed','failed'].includes(event.kind))current.jobFinished=true;
    if(event.kind==='completed'&&fileHooks?.collectTask){void Promise.resolve().then(()=>fileHooks.collectTask(task,{signal:current.controller.signal})).then(()=>{enforceLease();if(!current.controller.signal.aborted)emit(current,event);},()=>emit(current,{kind:'failed',code:'AI_FILE_TRANSFER_FAILED',text:'任务执行结束，但成果文件传回未完成，请保留电脑上的原文件。'}));}else emit(current,event);
   }});
  }catch{emit(current,{kind:'failed',code:'AI_EXECUTION_FAILED',text:safeCodexMessage('AI_EXECUTION_FAILED')});}}
 }
 async function pollOnce(){
  if(stopped||polling)return;polling=true;
  try{
   await enroll();enforceLease();
   if(!active&&clock()-lastLoginCheck>=60000){const login=await runner.loginStatus();statusCode=['ready','login-required','quota','error'].includes(login.code)?login.code:'error';lastLoginCheck=clock();}
   if(journal.full)statusCode='error';
   const current=active,input={connectorId:journal.connectorId,...(current?{taskId:current.id,leaseId:current.leaseId}:{}),events:current?current.events.slice(0,20):[],status:{code:statusCode,workspaceLabel:label,provider:'Codex',...(fileHooks?.publicKey?{filePublicKey:fileHooks.publicKey}:{})}};
   const sentAt=clock(),reply=await call('ai/poll',input),receivedAt=clock();
   if(!Number.isFinite(reply.serverNow)||!Number.isFinite(reply.expiresAt)||!Number.isSafeInteger(reply.ack)||reply.ack<0)throw fail('AI_RELAY_RESPONSE','授权租约响应无效。');
   if(stopped)return;
   if(current&&active===current){
    if(reply.cancelTaskId===current.id){await retireServerTerminal(current);return;}
    const lastSent=input.events.at(-1)?.seq??current.acked;
    if(reply.ack<current.acked||reply.ack>lastSent)throw fail('AI_RELAY_RESPONSE','任务事件确认序号无效。');
    current.acked=reply.ack;current.events=current.events.filter(e=>e.seq>reply.ack);
    if(!current.terminal)current.leaseUntil=Math.min(current.hardUntil,receivedAt+heartbeatMs,localDeadline({expiresAt:reply.expiresAt,serverTime:reply.serverNow,receivedAt,roundTrip:receivedAt-sentAt}));
    if(current.terminal&&!current.events.length)active=null;
   }
   if(reply.task)await acceptTask(reply.task,reply,sentAt,receivedAt);
   enforceLease();
  }catch(error){
   if(error.status===401||error.status===403){stopped=true;stopTask('AI_REVOKED');}
   else if(error.status===409||['AI_TASK_INVALID','AI_RELAY_RESPONSE'].includes(error.code)){stopTask('AI_LEASE_EXPIRED');}
   enforceLease();log({code:error.status===401?'AI_REVOKED':'AI_CONNECTION_INTERRUPTED'});
  }finally{polling=false;}
 }
 return {pollOnce,call,get stopped(){return stopped;},get activeTaskId(){return active?.id||null;},get status(){return statusCode;},connectorId:journal.connectorId,async run({signal}={}){const abort=()=>{stopped=true;stopTask('AI_CANCELLED');};signal?.addEventListener('abort',abort,{once:true});try{while(!stopped&&!signal?.aborted){await pollOnce();if(!stopped)await snooze(active?700:2500);}}finally{signal?.removeEventListener('abort',abort);}},async close(){stopped=true;stopTask('AI_CANCELLED');clearInterval(watchdog);await runner.close();await journal.close();}};
}

export function parseAIChannelArguments(args){
 const values={};const allowed=new Set(['codex','workspace','state','runtime-dir','label']);
 for(let i=0;i<args.length;i+=2){const key=args[i]?.replace(/^--/,'');if(!args[i]?.startsWith('--')||!allowed.has(key)||values[key]!==undefined||typeof args[i+1]!=='string'||args[i+1].startsWith('--'))throw fail('AI_ARGUMENTS','参数仅允许 --codex --workspace --state --runtime-dir --label。');values[key]=args[i+1];}
 if(['codex','workspace','state','runtime-dir'].some(k=>!values[k]))throw fail('AI_ARGUMENTS','需要 --codex、--workspace、--state 和 --runtime-dir。');
 return {executable:values.codex,workspace:values.workspace,statePath:values.state,runtimeDir:values['runtime-dir'],workspaceLabel:values.label};
}

async function main(){
 const options=parseAIChannelArguments(process.argv.slice(2));const runner=await createCodexRunner(options);
 const channel=await createAIChannel({...options,runner,fileHooksFactory:createAIChannelFiles,log:entry=>console.log(JSON.stringify(entry))});
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{await channel.run({signal:controller.signal});}finally{await channel.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({code:error.code||'AI_CONNECTOR_FAILED',message:'连接器没有继续执行，请检查本机固定路径、配对状态和登录。'}));process.exitCode=1;});
