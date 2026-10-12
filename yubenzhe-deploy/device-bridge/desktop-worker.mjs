// Electron utility process entry. The isolated setup renderer never receives this
// configuration or a path/command IPC. No listener is opened by either worker.
import {createAIChannel} from './ai-channel.mjs';
import {createProviderRunner} from './provider-runner.mjs';
import {createAIChannelFiles} from './ai-channel-files.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
let started=false,channel=null,controller=new AbortController();
const tell=value=>process.parentPort?.postMessage(value);
process.parentPort?.on('message',async({data})=>{
 if(data?.kind==='stop'){controller.abort();return;}
 if(started)return;started=true;
 try{
  if(data?.kind==='screen'){
   process.argv=[process.execPath,fileURLToPath(new URL('./agent.mjs',import.meta.url)),data.statePath];
   await import('./agent.mjs');process.exit(0);return;
  }
  if(data?.kind!=='start')throw Error('Invalid worker operation');
  const config=data.config;
  const runner=await createProviderRunner({executables:config.executables||{},executable:config.executable,workspace:config.workspace,ollamaModel:config.ollamaModel||null});
  const {ai,files,autoStart}=config.capabilities||{};
   channel=await createAIChannel({...config,calibrateScanClock:true,capabilities:{...(ai?{ai}:{}),...(files?{files}:{}),...(autoStart?{autoStart}:{})},runner,fileHooksFactory:createAIChannelFiles,log:entry=>{if(['AI_CONNECTED','AI_CONNECTION_INTERRUPTED','AI_REVOKED'].includes(entry.code))tell({kind:'connection',code:entry.code,reason:entry.reason,status:entry.status});}});tell({kind:'ready'});
  try{await channel.run({signal:controller.signal});}finally{await channel.close();}process.exit(0);
 }catch{tell({kind:'error'});process.exitCode=1;process.exit(1);}
});
