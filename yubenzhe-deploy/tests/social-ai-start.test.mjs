import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {passwordRecord} from '../server/auth.mjs';

test('actual start entry wires product AI and notification routes to isolated real HTTP',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'ybz-social-start-')), origin='https://ai-start-isolated.invalid';
 writeFileSync(join(dir,'auth.json'),JSON.stringify(await passwordRecord('isolated','Synthetic-start-test-only-39142!')),{mode:0o600});writeFileSync(join(dir,'index.html'),'<title>Isolated startup</title>');
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const env={};for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{ROLE:'frontend',PORT:String(port),BIND_HOST:'127.0.0.1',PUBLIC_ORIGIN:origin,PUBLIC_FRONTEND:'true',PUBLIC_PASSWORD_REGISTRATION:'true',AUTH_CONFIG_FILE:join(dir,'auth.json'),STATIC_ROOT:dir,SOCIAL_DATABASE_PATH:join(dir,'social.sqlite'),AI_DATABASE_PATH:join(dir,'ai.sqlite'),AI_PROVIDER:'disabled'});
 const child=spawn(process.execPath,['server/start.mjs'],{cwd:resolve(dirname(fileURLToPath(import.meta.url)),'..'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',chunk=>{logs+=chunk});child.stderr.on('data',chunk=>{logs+=chunk});
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}const safe=resolve(dir);assert.equal(resolve(join(safe,'..')),resolve(tmpdir()));assert.ok(basename(safe).startsWith('ybz-social-start-'));rmSync(safe,{recursive:true,force:true});});
 const until=Date.now()+10000;while(!logs.includes('listening on')){if(child.exitCode!==null)throw Error('Isolated startup failed: '+logs);assert.ok(Date.now()<until,'isolated startup timeout');await new Promise(r=>setTimeout(r,25));}
 const request=(path,{method='GET',token,input}={})=>new Promise((done,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port,path:'/api/social/'+path,method,headers:{Host:new URL(origin).host,Origin:'https://localhost',...(token?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/json'}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{done({status:res.statusCode,value:JSON.parse(Buffer.concat(chunks).toString())})}catch(e){reject(e)}})});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('Isolated HTTP timeout')));req.end(input===undefined?undefined:JSON.stringify(input));});
 assert.equal((await request('ai/capabilities')).status,401);
 const account=await request('register',{method:'POST',input:{password:'Synthetic-start-account-294186',requestId:randomUUID(),native:true}});assert.equal(account.status,200);assert.equal(account.value.created,true);const token=account.value.token;
 const cap=await request('ai/capabilities',{token});assert.equal(cap.status,200);assert.equal(cap.value.identityType,'product_account');assert.equal(cap.value.cloud.configured,false);
 const apply=await request('ai/workspaces',{method:'POST',token,input:{name:'启动入口验收',purpose:'research',requirements:'仅隔离本机验证真实产品账号审批入口。',requestId:randomUUID()}});assert.equal(apply.status,200);assert.equal(apply.value.workspace.status,'pending_review');assert.equal((await request('ai/workspaces',{token})).value.items.length,1);
 const push=await request('notifications/status',{token});assert.equal(push.status,200);assert.equal(push.value.available,false);
});
