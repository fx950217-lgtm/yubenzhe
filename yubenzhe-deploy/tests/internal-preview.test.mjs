import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {passwordRecord} from '../server/auth.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createSimulationMailAdapter,createInternalPreviewMailAdapter} from '../server/account-mail.mjs';
import {validateInternalPreview} from '../server/internal-preview.mjs';

const origin='https://preview.example.test',password='Synthetic-preview-ONLY-3274!',deviceId='synthetic_preview_device_0001';
const auth=await passwordRecord('preview',password);
const cookieOf=response=>response.headers.get('set-cookie')?.split(';')[0]||'';
async function fixture(t,{withConfig=false,aiService=null}={}){
 const dir=mkdtempSync(join(tmpdir(),'ybz-internal-preview-'));
 writeFileSync(join(dir,'index.html'),'<h1>PRIVATE_PRODUCT_MARKER</h1>');
 writeFileSync(join(dir,'app.js'),'PRIVATE_SCRIPT_MARKER');
 writeFileSync(join(dir,'app.zip'),'PRIVATE_DOWNLOAD_MARKER');
 mkdirSync(join(dir,'nested'));writeFileSync(join(dir,'nested','index.html'),'PRIVATE_NESTED_MARKER');
 const configFile=join(dir,'config.private.json');
 if(withConfig)writeFileSync(configFile,JSON.stringify({enabled:false,chainId:97,mode:'equal'}));
 const database=openSocialDatabase(':memory:');
 const modules=createProductModules({database,origin,internalPreview:true,otpSecret:'Synthetic-OTP-secret-for-internal-preview-'.repeat(2)});
 let calls=0;
 const server=createAcceptanceServer({role:'frontend',origin,authConfig:auth,aiService,internalPreview:true,publicFrontend:false,staticRoot:dir,chainPreviewConfigFile:withConfig?configFile:undefined,socialService:{handle:request=>{calls++;return modules.handle(request);}}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const request=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{Host:new URL(origin).host,...headers}},res=>{
   const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
  });req.on('error',reject);req.end(body);
 });
 const post=(path,input={},cookie='',headers={})=>request(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie,...headers},body:JSON.stringify(input)});
 const login=async()=>{const r=await request('/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'preview',password}).toString()});assert.equal(r.status,303);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict.*; Secure/);return cookieOf(r);};
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();rmSync(dir,{recursive:true,force:true});});
 return {dir,configFile,database,modules,request,post,login,get calls(){return calls;}};
}
test('internal preview rejects public, insecure, administrative and M0-combined configurations',()=>{
 for(const override of [{publicFrontend:true},{origin:'http://localhost:18914'},{role:'admin'},{simulation:true}]){
  assert.throws(()=>validateInternalPreview({internalPreview:true,role:'frontend',origin,...override}));
 }
 assert.doesNotThrow(()=>validateInternalPreview({internalPreview:true,role:'frontend',origin}));
 assert.throws(()=>createSimulationMailAdapter({origin}),/loopback/);
 assert.throws(()=>createInternalPreviewMailAdapter({origin:'http://localhost:18914'}),/HTTPS/);
 assert.throws(()=>createAcceptanceServer({role:'frontend',origin,authConfig:auth,internalPreview:true,publicFrontend:true,staticRoot:'.'}),/PUBLIC_FRONTEND/);
});
test('outer login protects every static file, download, product API and native preflight before dispatch',async t=>{
 const f=await fixture(t);
 for(const path of ['/','/app.js','/app.zip','/nested/index.html','/nested/']){
  const r=await f.request(path);assert.match(r.headers.get('content-type'),/text\/html/);assert.equal(r.headers.get('content-disposition'),null);assert.match(await r.text(),/name="password"/);
 }
 const paths=['/api/social/access/capabilities','/api/social/state','/api/social/avatars/'+randomUUID(),'/api/social/workbench/files/'+randomUUID(),'/api/social/workbench/capabilities','/api/social/notifications/status','/api/social/ai/capabilities','/api/ai/workspaces','/api/admin/bootstrap','/api/chain-preview/config'];
 for(const path of paths){const r=await f.request(path);assert.equal(r.status,401,path);assert.equal((await r.json()).code,'INTERNAL_PREVIEW_REQUIRED');}
 const forged={'x-internal-preview':'true','x-forwarded-for':'127.0.0.1','oai-authenticated-user-id':'owner',Authorization:'Bearer '+'x'.repeat(43),Cookie:'ybz_front_session=fake; ybz_admin_session=fake; ybz_social=fake'};
 for(const path of ['/api/social/access/email/request','/api/social/register','/api/social/security/recover']){
  const r=await f.post(path,{email:'nobody@example.test',deviceId,requestId:randomUUID(),internalPreviewSession:true},'',forged);assert.equal(r.status,401);assert.doesNotMatch(await r.text(),/simulationCode/);
 }
 const preflight=await f.request('/api/social/access/email/request',{method:'OPTIONS',headers:{Origin:'https://localhost'}});assert.equal(preflight.status,401);assert.equal(preflight.headers.get('access-control-allow-origin'),null);
 assert.equal(f.calls,0);assert.equal(f.database.raw.prepare('SELECT count(*) n FROM accounts').get().n,0);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM account_access_challenges').get().n,0);
 assert.equal((await (await f.request('/healthz')).json()).stage,'internal-preview');
});
test('an authenticated remote preview session can test email registration but product identity alone cannot open the gate',async t=>{
 const f=await fixture(t),gate=await f.login(),headers={Cookie:gate,'x-forwarded-for':'203.0.113.8'};
 const cap=await (await f.request('/api/social/access/capabilities',{headers})).json();assert.equal(cap.emailMode,'simulation');assert.equal(cap.simulationScope,'internal-preview');
 const request={email:'tester@example.test',deviceId,requestId:randomUUID()};
 const sent=await f.post('/api/social/access/email/request',request,gate,{'x-forwarded-for':'203.0.113.8'});assert.equal(sent.status,200);const challenge=await sent.json();assert.match(challenge.simulationCode,/^\d{6}$/);
 const outside=await f.post('/api/social/access/email/request',request);assert.equal(outside.status,401);assert.doesNotMatch(await outside.text(),/simulationCode/);
 const verify=await f.post('/api/social/access/email/verify',{challengeId:challenge.challengeId,code:challenge.simulationCode,deviceId},gate,{'x-forwarded-for':'203.0.113.8'});assert.equal(verify.status,200);const account=await verify.json();assert.equal(account.created,true);assert.equal(account.token,undefined);
 const product=cookieOf(verify),both=gate+'; '+product;
 const state=await f.request('/api/social/state',{headers:{Cookie:both}});assert.equal(state.status,200);
 const capability=await f.request('/api/social/workbench/capabilities',{headers:{Cookie:both}});assert.equal(capability.status,200);
 assert.equal((await f.request('/api/social/state',{headers:{Cookie:product}})).status,401);
 assert.equal(await (await f.request('/app.js',{headers:{Cookie:gate}})).text(),'PRIVATE_SCRIPT_MARKER');
 assert.match((await f.request('/app.zip',{headers:{Cookie:gate}})).headers.get('content-disposition'),/attachment/);
 await f.request('/logout',{method:'POST',headers:{Cookie:gate,Origin:origin}});
 assert.equal((await f.request('/api/social/state',{headers:{Cookie:both}})).status,401);
 assert.equal((await f.post('/api/social/access/email/verify',{challengeId:challenge.challengeId,code:challenge.simulationCode,deviceId},both)).status,401);
});
test('account recovery remains testable behind the outer gate and revokes the old product session',async t=>{
 const f=await fixture(t),gate=await f.login(),pin='284961',newPin='615938';
 const register=await f.post('/api/social/register',{password:pin,requestId:randomUUID()},gate);assert.equal(register.status,200);const a=await register.json(),product=cookieOf(register),both=gate+'; '+product;
 const proof=await (await f.post('/api/social/security/verify',{currentPassword:pin},both)).json();
 const recovery=await f.post('/api/social/security/recovery-code',{verificationToken:proof.verificationToken},both);assert.equal(recovery.status,200);const {recoveryCode}=await recovery.json();
 const input={userId:a.profile.userId,recoveryCode,newPassword:newPin};
 assert.equal((await f.post('/api/social/security/recover',input,product)).status,401);
 const recovered=await f.post('/api/social/security/recover',input,gate);assert.equal(recovered.status,200);assert.ok((await recovered.json()).protectedUntil>Date.now());
 assert.equal((await f.request('/api/social/state',{headers:{Cookie:both}})).status,401);
 assert.equal((await f.post('/api/social/login',{userId:a.profile.userId,password:newPin},gate)).status,200);
});
test('module and mail safeguards reject forged session fields even from a loopback caller',async t=>{
 const f=await fixture(t),request={method:'POST',path:'access/email/request',ip:'127.0.0.1',input:{email:'forged@example.test',deviceId,requestId:randomUUID()},internalPreviewSession:true};
 await assert.rejects(Promise.resolve().then(()=>f.modules.handle(request)),e=>e.code==='INTERNAL_PREVIEW_REQUIRED');
 await assert.rejects(f.modules.social.handle(request),e=>e.code==='INTERNAL_PREVIEW_REQUIRED');
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM account_access_challenges').get().n,0);
});
test('upgrade requests never obtain an unauthenticated websocket or bypass origin checks',async t=>{
 const f=await fixture(t),gate=await f.login(),headers={Connection:'Upgrade',Upgrade:'websocket',Origin:origin};
 assert.equal((await f.request('/api/social/stream',{headers})).status,401);
 assert.equal((await f.request('/api/social/stream',{headers:{...headers,Cookie:gate}})).status,404);
 assert.equal((await f.request('/api/social/stream',{headers:{...headers,Cookie:gate,Origin:'https://evil.example'}})).status,401);
});
test('chain configuration is same-origin authenticated GET only, validates testnet and never exposes extra fields',async t=>{
 const f=await fixture(t,{withConfig:true}),gate=await f.login(),get=()=>f.request('/api/chain-preview/config',{headers:{Cookie:gate}});
 assert.deepEqual(await (await get()).json(),{enabled:false,chainId:97,mode:'equal',reason:'测试网分发合约尚未配置。'});
 const value={enabled:true,chainId:97,mode:'equal',distributionAddress:'0x'+'1'.repeat(40),tokenAddress:'0x'+'2'.repeat(40),campaignId:'0x'+'3'.repeat(64),runtimeHash:'0x'+'4'.repeat(64),tokenRuntimeHash:'0x'+'5'.repeat(64)};
 writeFileSync(f.configFile,JSON.stringify({...value,secret:'NEVER_EXPOSE_THIS',privateKey:'NEVER_EXPOSE_THIS',rpcUrl:'https://secret.invalid'}));
 const result=await get();assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);assert.deepEqual(await result.json(),value);
 assert.equal((await f.post('/api/chain-preview/config',{enabled:false},gate)).status,405);
 assert.equal((await f.request('/api/chain-preview/config',{headers:{Cookie:gate,Host:'evil.example'}})).status,403);
 assert.equal((await f.request('/api/chain-preview/config',{headers:{Cookie:gate,Origin:'https://evil.example'}})).status,403);
 assert.equal((await f.request('/api/chain-preview/config',{headers:{Cookie:gate,'sec-fetch-site':'cross-site'}})).status,403);
 for(const invalid of [{...value,chainId:56},{...value,mode:'random'},{...value,campaignId:'0x00'},{...value,distributionAddress:'0x'+'0'.repeat(40)},{...value,runtimeHash:'secret'}]){
  writeFileSync(f.configFile,JSON.stringify(invalid));const r=await get();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/NEVER_EXPOSE_THIS|config\.private/);
 }
});

test('private remote rule tasks produce real downloadable output with product ownership and outer-gate checks',async t=>{
 const f=await fixture(t),gate=await f.login(),registration=await f.post('/api/social/register',{password:'284961',requestId:randomUUID()},gate);
 const cookie=gate+'; '+cookieOf(registration);
 const planned=await f.post('/api/social/workbench/plan',{requestId:randomUUID(),goal:'准备一份产品发布工作清单',fileIds:[]},cookie);
 assert.equal(planned.status,200);let task=(await planned.json()).task;
 const confirmed=await f.post('/api/social/workbench/tasks/'+task.id+'/confirm',{requestId:randomUUID(),version:task.version,planVersion:task.planVersion,acceptExecution:true},cookie);
 assert.equal(confirmed.status,200);
 for(let i=0;i<4;i++)await f.modules.tick();
 task=(await (await f.request('/api/social/workbench/tasks/'+task.id,{headers:{Cookie:cookie}})).json()).task;
 assert.equal(task.status,'succeeded');assert.equal(task.step,3);assert.ok(task.outputs[0]?.id);
 const path='/api/social/workbench/files/'+task.outputs[0].id;
 const download=await f.request(path,{headers:{Cookie:cookie}});
 assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.ok((await download.text()).length>0);
 assert.equal((await f.request(path,{headers:{Cookie:cookieOf(registration)}})).status,401);
 const other=await f.post('/api/social/register',{password:'615938',requestId:randomUUID()},gate);
 assert.equal((await f.request(path,{headers:{Cookie:gate+'; '+cookieOf(other)}})).status,404);
});

test('internal simulated OTP cannot take over an existing real-email account or redeem a prior real-email challenge',async t=>{
 const f=await fixture(t),gate=await f.login();
 const legacy=createProductModules({database:f.database,origin:'http://localhost:18999',simulation:true,otpSecret:'Synthetic-OTP-secret-for-internal-preview-'.repeat(2)});
 const a=await legacy.handle({method:'POST',path:'register',ip:'127.0.0.1',input:{password:'284961',requestId:randomUUID()}});
 const oldId=legacy.social.authenticate(a.token).id;
 f.database.raw.prepare('INSERT INTO account_emails VALUES(?,?,?)').run(oldId,'existing@example.com',Date.now());
 const oldChallenge=await legacy.handle({method:'POST',path:'access/email/request',ip:'127.0.0.1',input:{email:'existing@example.com',deviceId,requestId:randomUUID()}});
 for(const email of ['existing@example.com','new@example.com','trick@example.test.attacker.com']){
  const r=await f.post('/api/social/access/email/request',{email,deviceId,requestId:randomUUID()},gate);
  assert.equal(r.status,403);assert.equal((await r.json()).code,'INTERNAL_TEST_EMAIL_ONLY');
 }
 const redeem=await f.post('/api/social/access/email/verify',{challengeId:oldChallenge.challengeId,code:oldChallenge.simulationCode,deviceId},gate);
 assert.equal(redeem.status,403);assert.equal((await redeem.json()).code,'INTERNAL_TEST_EMAIL_ONLY');
 const existing=await f.request('/api/social/state',{headers:{Cookie:gate+'; ybz_social='+a.token}});
 assert.equal(existing.status,200);assert.equal(legacy.social.authenticate(a.token).id,oldId);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM accounts').get().n,1);
 assert.equal(f.database.raw.prepare('SELECT consumed_at FROM account_access_challenges WHERE id=?').get(oldChallenge.challengeId).consumed_at,0);
});
test('public gate reveals only a concise YBZ login form and health reveals no user or secret material',async t=>{
 const f=await fixture(t),r=await f.request('/login'),html=await r.text();
 assert.match(html,/YBZ 愚笨者 内部预览/);assert.match(html,/仅供内部体验与反馈。链上功能使用 BSC 测试网。/);
 assert.match(html,/#F7F7F9/);assert.match(html,/linear-gradient\(90deg,#6C5CE7,#A29BFE\)/);
 assert.equal((html.match(/<button\b/g)||[]).length,1);assert.doesNotMatch(html,/PRIVATE ACCEPTANCE|#14835f|model|simulationCode|Synthetic-preview|password_hash/);
 const health=await (await f.request('/healthz')).json();assert.deepEqual(Object.keys(health).sort(),['ok','service','stage','version']);
});

test('PDF plans and text documents under internal directories require the outer login',async t=>{
 const f=await fixture(t),gate=await f.login();mkdirSync(join(f.dir,'internal'));
 const pdf=Buffer.from('%PDF-1.7\nSYNTHETIC_PRIVATE_PLAN\n%%EOF');
 writeFileSync(join(f.dir,'internal','plan.pdf'),pdf);writeFileSync(join(f.dir,'internal','plan.txt'),'SYNTHETIC_PRIVATE_PLAN');
  for(const path of ['/internal/plan.pdf','/internal/plan.txt','/internal/','/%69nternal/plan.txt','/internal%2fplan.txt']){
  const r=await f.request(path);assert.match(r.headers.get('content-type'),/text\/html/);const text=await r.text();assert.match(text,/name="password"/);assert.doesNotMatch(text,/SYNTHETIC_PRIVATE_PLAN/);
 }
 const r=await f.request('/internal/plan.pdf',{headers:{Cookie:gate}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');assert.deepEqual(Buffer.from(await r.arrayBuffer()),pdf);
  assert.equal(await (await f.request('/internal/plan.txt',{headers:{Cookie:gate}})).text(),'SYNTHETIC_PRIVATE_PLAN');
  assert.equal(await (await f.request('/%69nternal%2fplan.txt',{headers:{Cookie:gate}})).text(),'SYNTHETIC_PRIVATE_PLAN');
 assert.equal((await f.request('/internal/',{headers:{Cookie:gate}})).status,404);
});
test('internal preview disables legacy shared-acceptance AI routes while keeping their data untouched',async t=>{
 let calls=0;
 const f=await fixture(t,{aiService:{handle(){calls++;throw Error('Legacy acceptance AI must not be dispatched.');}}}),gate=await f.login();
 for(const path of ['/api/ai/capabilities','/api/ai/workspaces','/api/ai/workspaces/old-private-workspace','/api/ai/tasks/old-private-task/cancel']){
  assert.equal((await f.request(path,{headers:{Cookie:gate}})).status,404);
  assert.equal((await f.post(path,{},gate)).status,404);
 }
 assert.equal(calls,0);
});
