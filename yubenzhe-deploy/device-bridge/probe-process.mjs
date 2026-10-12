import {spawn} from 'node:child_process';
import path from 'node:path';

// Probe callers supply only fixed executable/argument rules. No shell, batch
// wrapper, credential file, PATH search or raw diagnostic leaves the computer.
export function captureCommand(executable,args,{timeout=5000,spawnImpl=spawn,signal,env=process.env}={}){
 return new Promise(resolve=>{
  let child,output='',settled=false,timer;
  const stop=()=>{try{child?.kill();}catch{}};
  const finish=(code,error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve({code,output,error});};
  const abort=()=>{finish(null,'timeout');stop();};
  if(typeof executable!=='string'||executable.trim()!==executable||/[\x00-\x1f\x7f]/.test(executable)||!path.isAbsolute(executable)||!/\.exe$/i.test(executable)||!Array.isArray(args)||args.some(x=>typeof x!=='string')||!Number.isFinite(timeout)||timeout<=0){finish(null,'unavailable');return;}
  if(signal?.aborted){finish(null,'timeout');return;}
  timer=setTimeout(abort,timeout);timer.unref?.();signal?.addEventListener('abort',abort,{once:true});
  try{child=spawnImpl(executable,args,{shell:false,windowsHide:true,env,stdio:['ignore','pipe','pipe']});}catch{finish(null,'unavailable');return;}
  for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{if(settled)return;const next=output+String(chunk);if(Buffer.byteLength(next)>8192){finish(null,'output-limit');stop();return;}output=next;});
  child.once('error',()=>finish(null,'unavailable'));child.once('close',code=>finish(code));
 });
}
