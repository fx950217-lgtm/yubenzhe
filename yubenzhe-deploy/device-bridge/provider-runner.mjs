import {createTaskPool} from './task-pool.mjs';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {probeAIRegistry,AI_PROVIDER_RULES} from './ai-registry.mjs';
import {createCodexRunner} from './codex-runner.mjs';
import {createOllamaRunner} from './ollama-runner.mjs';
const fail=(code,message)=>Object.assign(new Error(message),{code});

// Installation and login are distinct from a reviewed execution adapter. The
// dispatcher never sends Claude/WorkB/Ollama prompts to Codex as a fallback.
export async function createProviderRunner({workspace,executables={},executable,ollamaModel=null,registryProbe=probeAIRegistry,codexFactory=createCodexRunner,ollamaFactory=createOllamaRunner,fetchImpl,maxConcurrent=3,resourceReady}={}){
 if(typeof workspace!=='string'||!path.isAbsolute(workspace))throw fail('AI_STARTUP_PATH','需要本机固定工作目录。');
 const cwd=await realpath(workspace);if(!(await stat(cwd)).isDirectory()||path.parse(cwd).root===cwd)throw fail('AI_STARTUP_PATH','工作目录无效。');
 let snapshot={providers:[],scannedAt:0},closed=false;
 const runners=new Map(),runnerPaths=new Map(),locations={...executables,...(executable?{codex:executable}:{})};
 async function loginStatus(){
  if(closed)return {code:'error',...snapshot};
  const scan=await registryProbe({ollamaModel,executableOverrides:locations,fetchImpl});
  const providers=scan.providers.map(value=>({...value}));
  for(const provider of providers){
   if(!AI_PROVIDER_RULES.some(rule=>rule.id===provider.id))continue;
   if(provider.executionSupported!==true)continue;
   try{
    if(provider.id==='codex'&&provider.installed===true&&provider.loggedIn===true&&provider.executionMode==='tools'){
     const file=scan.executables?.codex||locations.codex;if(!file)throw Error();
     // Refresh availability during long tasks without replacing their runner.
     // An executable change is adopted only when this device is idle.
     if(runners.has('codex')&&runnerPaths.get('codex')!==file){if(pool.size)throw Error();await runners.get('codex').close();runners.delete('codex');}
     if(!runners.has('codex')){runners.set('codex',await codexFactory({executable:file,workspace:cwd,loginTimeoutMs:5000}));runnerPaths.set('codex',file);}
    }else if(provider.id==='ollama'&&provider.installed===true&&provider.loggedIn===null&&provider.executionMode==='chat-only'){
     if(!runners.has('ollama'))runners.set('ollama',await ollamaFactory({workspace:cwd,model:ollamaModel,fetchImpl}));
    }else throw Error();
   }catch{provider.executionSupported=false;provider.executionMode='disabled';provider.reason='安全执行环境未通过检查，请在这台电脑核验。';}
  }
  snapshot={providers,scannedAt:scan.scannedAt};
  return {code:providers.some(value=>value.executionSupported)?'ready':providers.some(value=>value.installed&&value.loggedIn===false)?'login-required':'error',...snapshot};
 }
 const pool=createTaskPool({workspace:cwd,maxConcurrent,resourceReady,factory:async taskWorkspace=>({run:input=>{const selected=snapshot.providers.find(p=>p.id===input.provider);if(!selected?.executionSupported)throw fail('AI_PROVIDER_UNAVAILABLE','所选 AI 已不可用。');let childRunner,childJob;const controller=new AbortController();const done=(async()=>{try{childRunner=await (input.provider==='codex'?codexFactory({executable:runnerPaths.get('codex'),workspace:taskWorkspace,loginTimeoutMs:5000}):ollamaFactory({workspace:taskWorkspace,model:ollamaModel,fetchImpl}));if(controller.signal.aborted)throw fail('AI_CANCELLED','已停止');childJob=childRunner.run({...input,signal:controller.signal});return await childJob.done;}finally{await childRunner?.close();}})();return {done,cancel:code=>{controller.abort();childJob?.cancel(code);}};},close:async()=>{}})});
 function run({provider='codex',...input}={}){
  if(closed)throw fail('AI_REVOKED','电脑连接器已停止。');
  const status=snapshot.providers.find(value=>value.id===provider),runner=runners.get(provider);
  if(!status?.executionSupported||!runner||!['codex','ollama'].includes(provider))throw fail('AI_PROVIDER_UNAVAILABLE','此 AI 当前没有可用的安全执行适配。');
  if(status.executionMode==='chat-only'&&input.promptSuffix)throw fail('AI_PROVIDER_FILES_UNSUPPORTED','这个模型仅支持文字对话。');
  return pool.run({...input,provider});
 }
 return {configuration:{workspace:cwd,maxConcurrent,isolatedTasks:true},loginStatus,run,get providers(){return snapshot.providers;},get busy(){return pool.busy;},canDispatch:pool.canDispatch,async close(){closed=true;await pool.close();await Promise.all([...runners.values()].map(runner=>runner.close()));}};
}
