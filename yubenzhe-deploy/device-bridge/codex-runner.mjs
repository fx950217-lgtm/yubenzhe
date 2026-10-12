import {spawn} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import {lstatSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

export const CODEX_MAX_TASK_MS=600000;
export const CODEX_DISABLED_FEATURES=Object.freeze(['plugins','apps','hooks','browser_use','computer_use','remote_plugin','skill_mcp_dependency_install']);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const messages={AI_EXECUTION_FAILED:'电脑上的 AI 未能完成任务，请在电脑检查运行环境。',AI_LOGIN_REQUIRED:'请在这台电脑上由本人登录 Codex 后重试新任务。',AI_QUOTA:'这台电脑的 Codex 额度暂时不足。',AI_TOOL_UNAVAILABLE:'电脑的工具执行环境尚未就绪，本次不能证明已执行文件或命令。',AI_TIMEOUT:'任务超过十分钟，电脑已停止执行。',AI_CANCELLED:'任务已取消，电脑已停止执行。',AI_LEASE_EXPIRED:'与服务端的授权心跳已中断，电脑已停止执行。',AI_REVOKED:'设备授权已撤销，电脑已停止执行。',AI_OUTPUT_LIMIT:'任务输出超过当前通道上限，电脑已停止执行。',AI_INCOMPLETE:'没有收到完整的 AI 结束事件，任务结果待核对。'};
export const safeCodexMessage=code=>messages[code]||messages.AI_EXECUTION_FAILED;
export function redactAIChannelText(value){
 return String(value).replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,'[已隐藏私钥]')
  .replace(/\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/g,'[已隐藏凭据]')
  .replace(/\b0x[0-9a-fA-F]{64}\b/g,'[已隐藏密钥或敏感摘要]')
  .replace(/(?:助记词|私钥|钱包密码|登录密码|seed\s*phrase|mnemonic|private[_ -]?key|api[_ -]?key|password|bearer)\s*[:：=]?[^\r\n]*/gi,'[已隐藏敏感内容]');
}
export function classifyCodexDiagnostic(value){
 const text=String(value||'');
 if(/code.mode.host|code.mode is unavailable|host executable was not found|writing is blocked by read-only sandbox/i.test(text))return 'AI_TOOL_UNAVAILABLE';
 if(/quota|rate.limit|usage.limit|insufficient.credit|limit.reached/i.test(text))return 'AI_QUOTA';
 if(/not.logged.in|login.required|authentication.required|unauthorized|401|please.log.in/i.test(text))return 'AI_LOGIN_REQUIRED';
 return 'AI_EXECUTION_FAILED';
}

// --ignore-user-config intentionally keeps authentication and execpolicy rules.
// Refuse other local config layers instead of guessing which MCP/plugin options
// they might load. No configuration content or credentials are read here.
export function assertCodexConfigBoundary(workspace,{codexHome=process.env.CODEX_HOME||path.join(homedir(),'.codex'),systemDir=process.platform==='win32'?path.join(process.env.ProgramData||'C:\\ProgramData','OpenAI','Codex'):'/etc/codex'}={}){
 const exists=file=>{try{lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw fail('AI_CONFIGURATION_UNVERIFIED','无法核对本机配置边界，连接器没有启动任务。');}};
 const canonical=file=>{let value;try{value=path.join(realpathSync.native(path.dirname(file)),path.basename(file));}catch{value=path.resolve(file);}return process.platform==='win32'?value.toLowerCase():value;};
 const globalConfig=canonical(path.join(codexHome,'config.toml'));
 for(let dir=workspace;;dir=path.dirname(dir)){
  const config=path.join(dir,'.codex','config.toml');
  if(exists(config)&&canonical(config)!==globalConfig)throw fail('AI_CONFIGURATION_UNVERIFIED','固定目录或祖先存在项目配置；请为连接器选择经过核对的独立工作目录。');
  if(path.dirname(dir)===dir)break;
 }
 if([path.join(codexHome,'managed_config.toml'),...['config.toml','requirements.toml','managed_config.toml'].map(name=>path.join(systemDir,name))].some(exists))throw fail('AI_CONFIGURATION_UNVERIFIED','检测到系统或托管配置；尚未核验其外部工具权限，连接器拒绝运行。');
}

export function codexExecutionArguments(workspace,{platform=process.platform}={}){
 // Ignoring user config must not also discard Windows' native isolation mode.
 // The verified local installation uses elevated; never fall back to unelevated
 // or disabled isolation when setup is unavailable. Execpolicy rules still load.
 return ['-a','on-request','exec','--json','--ignore-user-config','--ephemeral','--sandbox','workspace-write',...(platform==='win32'?['-c','windows.sandbox="elevated"']:[]),...CODEX_DISABLED_FEATURES.flatMap(feature=>['--disable',feature]),'--skip-git-repo-check','--cd',workspace,'-'];
}

export async function validateCodexPaths({executable,workspace}){
 if(typeof executable!=='string'||!path.isAbsolute(executable)||typeof workspace!=='string'||!path.isAbsolute(workspace))throw fail('AI_STARTUP_PATH','Codex 和工作目录必须由启动参数指定为绝对路径。');
 const exe=await realpath(executable),cwd=await realpath(workspace);
 if(!(await stat(exe)).isFile()||!(await stat(cwd)).isDirectory()||path.parse(cwd).root===cwd)throw fail('AI_STARTUP_PATH','工作目录必须是明确的非根目录，Codex 必须是可执行文件。');
 if(process.platform==='win32'&&!/\.exe$/i.test(exe))throw fail('AI_STARTUP_PATH','Windows 连接器仅接受明确的 .exe，不执行批处理或 shell。');
 return Object.freeze({executable:exe,workspace:cwd});
}

// These events are based on the actual 2026-10-12 CLI probe: thread.started,
// turn.started, item.completed {item:{type:'agent_message',text}}, turn.completed.
// All other item payloads (commands, tool output, reasoning, stderr) stay local.
export function createCodexJsonlParser({onEvent=()=>{},onLimit=()=>{},maxLineBytes=262144,maxOutputChars=48000}={}){
 let buffer='',outputChars=0,limited=false,completed=false,diagnostic=null,seen=new Set();
 const emit=event=>{if(!limited)onEvent(event);};
 function limit(){if(limited)return;limited=true;buffer='';onLimit();}
 function line(raw){
  if(limited||!raw.trim())return;
  if(Buffer.byteLength(raw)>maxLineBytes)return limit();
  let value;try{value=JSON.parse(raw);}catch{return;}
  if(value?.type==='thread.started'||value?.type==='turn.started'){emit({kind:'progress',code:'AI_RUNNING',text:'电脑上的 Codex 正在处理。'});return;}
  if(value?.type==='turn.completed'){completed=true;return;}
  if(value?.type==='turn.failed'||value?.type==='error'){diagnostic=classifyCodexDiagnostic(value.error?.message||value.message);emit({kind:'progress',code:diagnostic,text:safeCodexMessage(diagnostic)});return;}
  if(value?.type!=='item.completed'||!value.item||typeof value.item!=='object')return;
  const item=value.item;
  if(item.type==='error'){
   diagnostic=classifyCodexDiagnostic(item.message);emit({kind:'progress',code:diagnostic,text:safeCodexMessage(diagnostic)});return;
  }
  if(item.type!=='agent_message'||typeof item.text!=='string'||typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)||seen.has(item.id))return;
  if(seen.size>=100)return limit();seen.add(item.id);
  if(outputChars+item.text.length>maxOutputChars)return limit();outputChars+=item.text.length;
  // Filter the complete agent text before chunking so a chunk boundary cannot
  // separate a credential label/token from the value being hidden.
  const text=redactAIChannelText(item.text);
  for(let offset=0;offset<text.length;offset+=2000)emit({kind:'message',itemId:item.id+(text.length>2000?'-'+offset:''),text:text.slice(offset,offset+2000)});
 }
 return {push(chunk){if(limited)return;buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,at).replace(/\r$/,'');buffer=buffer.slice(at+1);line(raw);}if(Buffer.byteLength(buffer)>maxLineBytes)limit();},end(){if(buffer)line(buffer);buffer='';},get completed(){return completed;},get diagnostic(){return diagnostic;},get limited(){return limited;}};
}

export async function killCodexProcessTree(child,{spawnImpl=spawn,platform=process.platform}={}){
 if(!child?.pid)return;
 if(platform==='win32'){
  await new Promise(resolve=>{
   const killer=spawnImpl(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
   let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);resolve();};
   const fallback=()=>{try{child.kill('SIGKILL');}catch{}finish();};
   const timer=setTimeout(()=>{try{killer.kill();}catch{}fallback();},5000);timer.unref?.();killer.once('error',fallback);killer.once('close',code=>code===0?finish():fallback());
  });
 }else{
  try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}
 }
}

export async function createCodexRunner({executable,workspace,spawnImpl=spawn,killTree=killCodexProcessTree,maxTaskMs=CODEX_MAX_TASK_MS,loginTimeoutMs=15000}={}){
 const config=await validateCodexPaths({executable,workspace});
 assertCodexConfigBoundary(config.workspace);
 if(!Number.isInteger(maxTaskMs)||maxTaskMs<1||maxTaskMs>CODEX_MAX_TASK_MS)throw fail('AI_STARTUP_TIMEOUT','任务时限不能超过十分钟。');
 let active=null;
 const spawnOptions=()=>({cwd:config.workspace,shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
 async function loginStatus(){
  if(active)return {code:'ready'};
  let child;try{child=spawnImpl(config.executable,['login','status'],spawnOptions());}catch{return {code:'error'};}
  return new Promise(resolve=>{
   let settled=false,diagnostic='';const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);resolve({code});};
   const timer=setTimeout(()=>{void killTree(child);finish('error');},loginTimeoutMs);timer.unref?.();
   child.stdout?.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(0,2048);});child.stderr?.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(0,2048);});child.stdin?.end();
   child.once('error',()=>finish('error'));child.once('close',code=>finish(code===0?'ready':classifyCodexDiagnostic(diagnostic)==='AI_QUOTA'?'quota':'login-required'));
  });
 }
 function run({taskId,prompt,promptSuffix='',onEvent=()=>{},timeoutMs=maxTaskMs,signal}={}){
  if(active)throw fail('AI_BUSY','当前电脑已有一个 AI 任务。');
  if(typeof taskId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId)||typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)throw fail('AI_TASK_INVALID','任务标识或文本长度无效。');
  if(typeof promptSuffix!=='string'||promptSuffix.length>2000)throw fail('AI_TASK_INVALID','本机文件指引超过独立上限。');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>maxTaskMs)throw fail('AI_TASK_INVALID','任务期限无效。');
  if(signal?.aborted)throw fail('AI_CANCELLED',safeCodexMessage('AI_CANCELLED'));
  assertCodexConfigBoundary(config.workspace);
  const args=codexExecutionArguments(config.workspace);
  let child;try{child=spawnImpl(config.executable,args,spawnOptions());}catch{throw fail('AI_EXECUTION_FAILED',safeCodexMessage('AI_EXECUTION_FAILED'));}
  let cancelCode=null,stderrCode=null,terminal=false,resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  const stop=code=>{if(terminal||cancelCode)return;cancelCode=messages[code]?code:'AI_CANCELLED';void killTree(child);};
  const parser=createCodexJsonlParser({onEvent:event=>{if(!terminal&&!cancelCode)onEvent(event);},onLimit:()=>stop('AI_OUTPUT_LIMIT')});
  const timer=setTimeout(()=>stop('AI_TIMEOUT'),Math.min(timeoutMs,maxTaskMs));timer.unref?.();
  const abort=()=>stop('AI_CANCELLED');signal?.addEventListener('abort',abort,{once:true});
  function finish(exitCode){
   if(terminal)return;parser.end();terminal=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   const code=cancelCode||parser.diagnostic||stderrCode||(exitCode!==0?'AI_EXECUTION_FAILED':!parser.completed?'AI_INCOMPLETE':null);
   const event=code?{kind:'failed',code,text:safeCodexMessage(code)}:{kind:'completed',code:'AI_COMPLETED',text:'Codex 已结束本次任务，请检查结果。'};
   active=null;onEvent(event);resolveDone(event);
  }
  child.stdout?.setEncoding?.('utf8');child.stdout?.on('data',chunk=>parser.push(String(chunk)));
  child.stderr?.on('data',chunk=>{const code=classifyCodexDiagnostic(String(chunk).slice(0,4096));if(code!=='AI_EXECUTION_FAILED')stderrCode=code;});
  child.once('error',()=>finish(null));child.once('close',finish);child.stdin?.on('error',()=>stop('AI_EXECUTION_FAILED'));
  const job={taskId,done,cancel:stop};active=job;child.stdin.end(prompt+(promptSuffix?'\n'+promptSuffix:'')+'\n');
  return job;
 }
 return {configuration:config,loginStatus,run,get busy(){return Boolean(active);},cancel:code=>active?.cancel(code),async close(){if(active){active.cancel('AI_CANCELLED');await active.done;}}};
}
