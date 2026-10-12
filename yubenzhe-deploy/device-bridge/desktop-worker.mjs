// Electron utility process entry. The isolated setup renderer never receives this
// configuration or a path/command IPC. No listener is opened by either worker.
import {createAIChannel} from './ai-channel.mjs';
import {createCodexRunner} from './codex-runner.mjs';
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
  const runner=config.executable?await createCodexRunner({executable:config.executable,workspace:config.workspace}):{configuration:{workspace:config.workspace},loginStatus:async()=>({code:'login-required'}),run(){throw Error('Codex is not installed');},async close(){}};
  const {ai,files,autoStart}=config.capabilities||{};
  channel=await createAIChannel({...config,capabilities:{...(ai?{ai}:{}),...(files?{files}:{}),...(autoStart?{autoStart}:{})},runner,fileHooksFactory:createAIChannelFiles});tell({kind:'ready'});
  try{await channel.run({signal:controller.signal});}finally{await channel.close();}process.exit(0);
 }catch{tell({kind:'error'});process.exitCode=1;process.exit(1);}
});
