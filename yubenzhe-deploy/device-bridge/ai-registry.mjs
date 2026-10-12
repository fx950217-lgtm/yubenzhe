import {lstat,realpath,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureCommand} from './probe-process.mjs';
import {inspectOllama} from './ollama-runner.mjs';

export const AI_PROVIDER_RULES=Object.freeze([
 {id:'codex',name:'Codex',description:'电脑上的编码智能体',executionMode:'tools',versionArgs:['--version'],authArgs:['login','status'],paths:[['home','.codex','.sandbox-bin','codex.exe'],['home','AppData','Roaming','npm','node_modules','@openai','codex','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe']]},
 {id:'claude',name:'Claude',description:'电脑上的对话智能体',executionMode:'disabled',versionArgs:['--version'],authArgs:['auth','status'],paths:[['home','.local','bin','claude.exe'],['home','AppData','Local','AnthropicClaude','claude.exe','desktop']]},
 {id:'workb',name:'WorkB',description:'电脑上的工作助手',executionMode:'disabled',paths:[['home','AppData','Local','Programs','WorkBuddy','WorkBuddy.exe','desktop'],['home','AppData','Local','Tencent','WorkBuddy','WorkBuddy.exe','desktop'],['programs','Tencent','WorkBuddy','WorkBuddy.exe','desktop']]},
 {id:'ollama',name:'Ollama',description:'电脑上的本地模型',executionMode:'chat-only',versionArgs:['--version'],paths:[['home','AppData','Local','Programs','Ollama','ollama.exe'],['programs','Ollama','ollama.exe']]},
].map(rule=>Object.freeze({...rule,versionArgs:rule.versionArgs?Object.freeze(rule.versionArgs):null,authArgs:rule.authArgs?Object.freeze(rule.authArgs):null,paths:Object.freeze(rule.paths.map(item=>Object.freeze(item)))})));
const missing=rule=>({id:rule.id,name:rule.name,installed:false,loggedIn:null,version:null,reason:'本机未检测到可核验的应用，请在电脑安装后刷新。',executionSupported:false,executionMode:'disabled'});
const fail=()=>Object.assign(new Error('Probe unavailable'),{code:'AI_PROBE_UNAVAILABLE'});
const versionOf=output=>{const match=String(output||'').match(/(?:^|\s|v)(\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][a-zA-Z0-9.-]{1,20})?)(?:\s|$)/);return match?.[1]||null;};
function candidates(rule,{home,env,executableOverrides}){
 const known=rule.paths.map(parts=>{const desktop=parts.at(-1)==='desktop',segments=parts.slice(1,desktop?-1:undefined),base=parts[0]==='home'?home:env.ProgramFiles||'C:\\Program Files';return {file:path.join(base,...segments),desktop};});
 const explicit=executableOverrides?.[rule.id];
 // A path returned by the first desktop scan may be sent back by its private
 // worker configuration. Preserve GUI provenance; never launch it as a CLI.
 if(explicit!==undefined)return [{file:explicit,desktop:typeof explicit==='string'&&known.some(candidate=>candidate.desktop&&path.resolve(candidate.file).toLowerCase()===path.resolve(explicit).toLowerCase())}];
 return known;
}
async function locate(rule,options,signal){
 for(const candidate of candidates(rule,options)){
  if(signal?.aborted)throw fail();
  if(typeof candidate.file!=='string'||candidate.file.trim()!==candidate.file||/[\x00-\x1f\x7f]/.test(candidate.file)||!path.isAbsolute(candidate.file)||!/^.+\.exe$/i.test(candidate.file)||/^\\\\/.test(candidate.file))continue;
  try{
   const info=await options.fsImpl.lstat(candidate.file);if(signal?.aborted)throw fail();if(!info.isFile()||info.isSymbolicLink())continue;
   const file=await options.fsImpl.realpath(candidate.file);if(signal?.aborted)throw fail();
   if(!/\.exe$/i.test(file)||/^\\\\/.test(file)||!(await options.fsImpl.stat(file)).isFile())continue;
   if(signal?.aborted)throw fail();return {...candidate,file};
  }catch{if(signal?.aborted)throw fail();}
 }
 return null;
}
export async function findProviderExecutable(id,{home=os.homedir(),env=process.env,platform=process.platform,fsImpl={lstat,realpath,stat},signal,executableOverrides={}}={}){
 const rule=AI_PROVIDER_RULES.find(item=>item.id===id);if(!rule||platform!=='win32')return null;
 return (await locate(rule,{home,env,fsImpl,executableOverrides},signal))?.file||null;
}

/** Only metadata crosses the relay. Executable paths are separately returned to
 * the trusted desktop main/worker, never inside a provider or diagnostic. */
export async function probeAIRegistry({home=os.homedir(),env=process.env,platform=process.platform,fsImpl={lstat,realpath,stat},run=captureCommand,fetchImpl,ollamaModel=null,providerTimeoutMs=5000,executableOverrides={},now=Date.now}={}){
 if(!Number.isFinite(providerTimeoutMs)||providerTimeoutMs<1||providerTimeoutMs>5000)throw fail();
 const results=await Promise.all(AI_PROVIDER_RULES.map(async rule=>{
  const fallback=missing(rule);if(platform!=='win32')return {provider:{...fallback,reason:'当前自动探测只支持 Windows；尚未核验此系统的安装。'}};
  const controller=new AbortController();let timer;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({provider:{...fallback,reason:'本机检测超时，未确认安装或登录状态。'}});},providerTimeoutMs);});
  const deadline=performance.now()+providerTimeoutMs;
  const check=()=>{if(controller.signal.aborted||performance.now()>=deadline)throw fail();};
  const command=async(file,args)=>{check();const value=await run(file,args,{timeout:Math.max(1,deadline-performance.now()),signal:controller.signal,env:{...env,OLLAMA_HOST:'127.0.0.1:11434',OLLAMA_NO_CLOUD:'1'}});check();return value;};
  const work=(async()=>{
   const found=await locate(rule,{home,env,fsImpl,executableOverrides},controller.signal);check();if(!found)return {provider:fallback};
   if(found.desktop||rule.id==='workb')return {provider:{...fallback,installed:true,reason:'只检测到应用文件；登录状态与安全执行适配尚未核验。'},executable:found.file};
   const version=await command(found.file,rule.versionArgs);const parsed=versionOf(version.output);
   if(version.code!==0||version.error||!parsed)return {provider:{...fallback,reason:'版本检测未成功，未确认本机安装。'}};
   const provider={...fallback,installed:true,version:parsed};
   if(rule.authArgs){
    const auth=await command(found.file,rule.authArgs);
    provider.loggedIn=!auth.error&&auth.code===0?true:!auth.error&&auth.code===1?false:null;
    // Some CLI revisions include an explicit JSON loggedIn flag. It can only
    // narrow the exit-code conclusion; never copy account/email/token fields.
    if(rule.id==='claude'&&provider.loggedIn===true)try{if(JSON.parse(auth.output).loggedIn===false)provider.loggedIn=false;}catch{}
    provider.reason=provider.loggedIn===null?'无法核验登录状态，请在这台电脑检查。':provider.loggedIn===false?'需要登录，请在这台电脑由本人完成。':rule.executionMode==='disabled'?'已检测到登录；安全执行适配尚未完成。':'已登录；实际工具执行仍需通过任务核验。';
    provider.executionSupported=provider.loggedIn===true&&rule.executionMode==='tools';
   }else if(rule.id==='ollama'){
    try{check();await inspectOllama({model:ollamaModel,fetchImpl,signal:controller.signal});check();provider.executionSupported=true;provider.reason='本机模型已核验，仅支持文字对话，不读取文件或执行命令。';}
    catch(error){check();provider.reason=error.code==='AI_OLLAMA_MODEL_REQUIRED'?'请在电脑设置中选择已安装的本地模型。':'本机模型未通过核验；不会自动下载模型或连接云服务。';}
   }
   provider.executionMode=provider.executionSupported?rule.executionMode:'disabled';
   return {provider,executable:found.file};
  })().catch(()=>({provider:{...fallback,reason:'本机检测未完成，未确认安装或登录状态。'}}));
  try{return await Promise.race([work,timeout]);}finally{clearTimeout(timer);controller.abort();}
 }));
 return {providers:results.map(item=>item.provider),scannedAt:now(),executables:Object.fromEntries(results.flatMap((item,index)=>item.executable?[[AI_PROVIDER_RULES[index].id,item.executable]]:[]))};
}
