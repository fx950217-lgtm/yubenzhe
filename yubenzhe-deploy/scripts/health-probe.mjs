import { readFile,writeFile,mkdir,rename,statfs } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
const [origin,statusFile,backupDir]=process.argv.slice(2);
if(!origin||!statusFile||!backupDir)throw Error('Usage: health-probe.mjs <public-origin> <status-json> <backup-directory>');
const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||url.pathname!=='/'||url.username||url.password)throw Error('Invalid origin.');
const target=resolve(statusFile);await mkdir(dirname(target),{recursive:true,mode:0o700});let previous={};try{previous=JSON.parse(await readFile(target,'utf8'))}catch{}
const started=Date.now(),checks={};try{const response=await fetch(new URL('/healthz',url),{signal:AbortSignal.timeout(10000),redirect:'error'});const data=await response.json();checks.http=response.ok&&data.ok===true;checks.version=typeof data.version==='string'?data.version:null;}catch{checks.http=false;}
try{const response=await fetch(new URL('/api/social/me',url),{signal:AbortSignal.timeout(10000),redirect:'error'});const data=await response.json();checks.accountBoundary=response.status===401&&data.code==='ACCOUNT_REQUIRED';}catch{checks.accountBoundary=false;}
try{const disk=await statfs(backupDir);checks.diskFreePercent=Math.round(Number(disk.bavail)/Number(disk.blocks)*100);checks.disk=checks.diskFreePercent>=10;}catch{checks.disk=false;}
const ok=checks.http&&checks.accountBoundary&&checks.disk,result={checkedAt:new Date().toISOString(),ok,checks,durationMs:Date.now()-started,consecutiveFailures:ok?0:Number(previous.consecutiveFailures||0)+1};
await writeFile(target+'.tmp',JSON.stringify(result,null,2),{mode:0o600});await rename(target+'.tmp',target);
if(previous.ok!==ok||!ok)console.log(JSON.stringify(result));else console.log('Health probe passed; state unchanged.');
process.exitCode=ok?0:1;
