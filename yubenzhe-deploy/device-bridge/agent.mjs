import {localDeadline} from './protocol.mjs';

import {readFile,writeFile,mkdir,unlink,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(fileURLToPath(import.meta.url));
const statePath=resolve(process.argv[2]||base+'/device-state.json');
const stopPath=statePath+'.stop';
const config=JSON.parse(await readFile(statePath,'utf8'));
const origin=new URL(config.origin);
if(origin.origin!==config.origin||origin.protocol!=='https:'||origin.username||origin.password)throw Error('A trusted HTTPS origin is required.');
const log=m=>console.log(new Date().toISOString()+' '+m);
let quit=false,sessionId=null,sessionUntil=0,ack=[],frame=null,status='ready',waiting=null;
await unlink(stopPath).catch(()=>{});
async function call(route,input){
 const response=await fetch(origin.origin+'/api/device-bridge/'+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(config.token?{Authorization:'Bearer '+config.token}:{})},body:JSON.stringify(input)});
 if(!response.ok){const e=new Error('Connector HTTP '+response.status);e.status=response.status;throw e;}
 const value=await response.json();return value;
}
if(!config.token){
 const enrolled=await call('enroll',{pairToken:config.pairToken});
 config.token=enrolled.token;config.deviceId=enrolled.deviceId;delete config.pairToken;
 await mkdir(dirname(statePath),{recursive:true});await writeFile(statePath,JSON.stringify(config),{mode:0o600});log('Device paired');
}
const helper=spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-Sta','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',base+'/desktop.ps1','-StopFile',stopPath],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:helper.stdout});
lines.on('line',line=>{try{const v=JSON.parse(line);if(v.stopped){quit=true;waiting?.resolve(v);waiting=null;}else if(waiting){const w=waiting;waiting=null;w.resolve(v);}}catch{}});
helper.stderr.on('data',()=>{status='screen-unavailable';});
helper.on('exit',()=>{quit=true;waiting?.reject(Error('Desktop helper stopped'));waiting=null;});
function desktop(command){return new Promise((resolve,reject)=>{if(quit)return reject(Error('Stopped'));const timer=setTimeout(()=>{if(waiting){waiting=null;reject(Error('Desktop timeout'));helper.kill();}},15000);waiting={resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}};helper.stdin.write(JSON.stringify(command)+'\n');});}
process.on('SIGTERM',()=>{quit=true;});process.on('SIGINT',()=>{quit=true;});
log('Connector online; screen idle. Use the tray menu or stop script to exit.');
try{
 while(!quit){
  try{
   if(await stat(stopPath).then(()=>true).catch(()=>false)){quit=true;break;}
   const sentAt=performance.now();const reply=await call('poll',{sessionId,ack,frame,status});const receivedAt=performance.now(),rtt=receivedAt-sentAt;
   if(!Number.isFinite(reply.serverTime))throw Error('Unsupported relay clock');
   ack=[];frame=null;status='ready';
   sessionId=reply.sessionId;sessionUntil=localDeadline({expiresAt:reply.sessionUntil,serverTime:reply.serverTime,receivedAt,roundTrip:rtt});
   if(!sessionId||sessionUntil<=performance.now()){sessionId=null;await desktop({kind:'idle'});}
   else{
    for(const command of reply.commands||[]){
     command.expiresAt=localDeadline({expiresAt:command.expiresAt,serverTime:reply.serverTime,receivedAt,roundTrip:rtt});
     if(quit||performance.now()>=sessionUntil||performance.now()>=command.expiresAt)break;
     const result=await desktop(command);
     ack.push({id:command.id,status:result.ok?'done':'failed'});if(!result.ok)status='control-error';
    }
    if(!quit&&performance.now()<sessionUntil){const shot=await desktop({kind:'screen'});if(shot.ok&&shot.image?.length<620000)frame=shot.image;else status='screen-unavailable';}
   }
  }catch(e){frame=null;sessionId=null;ack=[];status='screen-unavailable';log(e.status===401?'Device authorization revoked':'Connection interrupted; screen paused');if(e.status===401)break;await desktop({kind:'idle'}).catch(()=>{});}
  if(!quit)await new Promise(r=>setTimeout(r,sessionId?700:2500));
 }
}finally{await call('poll',{localStop:true,status:'stopped'}).catch(()=>{});helper.stdin.end();helper.kill();log('Connector stopped');}
