import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {passwordRecord} from '../server/auth.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createSocialService} from '../server/social-service.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createSimulationMailAdapter} from '../server/account-mail.mjs';
import {validatePublicAccountMode} from '../server/public-account-mode.mjs';
import {accountPasswordPolicy} from '../server/social-validation.mjs';

const origin='https://public.example.test',password='Synthetic-account-only-2419!';
const auth=await passwordRecord('unused-reviewer','Synthetic-unused-reviewer-3274!');
const mode={origin,publicFrontend:true,publicPasswordRegistration:true};
const fails=code=>error=>error.code===code;
const digest=value=>createHash('sha256').update(value).digest('hex');

function temporary(t){const dir=mkdtempSync(join(tmpdir(),'ybz-public-password-'));t.after(()=>{const target=resolve(dir);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('ybz-public-password-'));rmSync(target,{recursive:true,force:true});});return dir;}
function fixture(t,extra={}){
 const database=openSocialDatabase(':memory:');t.after(()=>database.close());
 const modules=createProductModules({database,...mode,...extra});
 const call=async(path,input={},token='',method='POST',ip='203.0.113.8')=>modules.handle({path,input,token,method,ip});
 const register=(input={},ip)=>call('register',{password,requestId:randomUUID(),...input},'','POST',ip);
 return {database,modules,call,register};
}
async function httpFixture(t,extra={}){
 const f=fixture(t,extra),dir=temporary(t);writeFileSync(join(dir,'index.html'),'SYNTHETIC_PUBLIC_PRODUCT');
 const server=createAcceptanceServer({role:'frontend',origin,authConfig:auth,publicFrontend:true,staticRoot:dir,socialService:{handle:request=>f.modules.handle(request)}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const request=(path,{method='GET',input,cookie='',nativeOrigin,ip='203.0.113.8'}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/api/social/'+path,method,headers:{Host:new URL(origin).host,...(method==='POST'?{Origin:nativeOrigin||origin,'Content-Type':'application/json'}:{}),Cookie:cookie,'x-forwarded-for':ip}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const text=Buffer.concat(chunks).toString();resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text),text,cookie:res.headers['set-cookie']?.[0].split(';')[0]||''});});
  });req.on('error',reject);req.end(input===undefined?undefined:JSON.stringify(input));
 });
 return {...f,request};
}

test('public password and real workflow flags require the explicit HTTPS frontend and reject test mail',()=>{
 assert.doesNotThrow(()=>validatePublicAccountMode({...mode,role:'frontend'}));
 for(const extra of [{role:'admin'},{publicFrontend:false},{internalPreview:true},{simulation:true},{origin:'http://localhost:18938'},{origin:'https://public.example.test/'},{origin:'https://user:password@public.example.test'},{origin:''},{publicTestMail:true}])assert.throws(()=>validatePublicAccountMode({...mode,role:'frontend',...extra}));
 assert.throws(()=>validatePublicAccountMode({...mode,groupWorkflowsEnabled:true}),/WORKBENCH_RULES_ENABLED/);
 assert.doesNotThrow(()=>validatePublicAccountMode({...mode,workbenchRulesEnabled:true,groupWorkflowsEnabled:true}));
 assert.doesNotThrow(()=>validatePublicAccountMode({role:'admin',origin}));
});

test('startup rejects invalid public flags before opening any database or authentication file',t=>{
 const dir=temporary(t),db=join(dir,'must-not-create.sqlite'),env={...process.env,ROLE:'frontend',PUBLIC_ORIGIN:origin,PUBLIC_FRONTEND:'true',PUBLIC_PASSWORD_REGISTRATION:'true',INTERNAL_PREVIEW:'false',M0_SIMULATION:'false',PUBLIC_TEST_MAIL:'false',WORKBENCH_RULES_ENABLED:'false',GROUP_WORKFLOWS_ENABLED:'false',TRUSTED_PROXY_IPS:'',AUTH_CONFIG_FILE:join(dir,'missing-auth'),DATABASE_PATH:db,AI_DATABASE_PATH:db,SOCIAL_DATABASE_PATH:db};
 for(const override of [{ROLE:'admin'},{PUBLIC_FRONTEND:'false'},{INTERNAL_PREVIEW:'true'},{M0_SIMULATION:'true'},{PUBLIC_ORIGIN:'http://localhost:18938'},{PUBLIC_TEST_MAIL:'true'},{GROUP_WORKFLOWS_ENABLED:'true'},{TRUSTED_PROXY_IPS:'0.0.0.0/0'}]){
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../server/start.mjs',import.meta.url))],{env:{...env,...override},encoding:'utf8',timeout:10000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Public account|PUBLIC_TEST_MAIL|GROUP_WORKFLOWS_ENABLED|TRUSTED_PROXY_IPS/);assert.doesNotMatch(result.stderr,/missing-auth/);assert.equal(existsSync(db),false);
 }
});

test('password policy uses 12–128 characters for new credentials and accepts legacy PIN only for existing credentials',()=>{
 const policy=accountPasswordPolicy(true);assert.deepEqual(policy.metadata,{min:12,max:128,legacyPinLogin:true});
 for(const value of ['a'.repeat(12),'x'.repeat(128),'  meaningful password  '])assert.equal(policy.validateNew(value),value);
 for(const value of ['284961','x'.repeat(11),'x'.repeat(129),' '.repeat(12),'long-password\n',null,123456])assert.throws(()=>policy.validateNew(value),fails('INVALID_PASSWORD'));
 assert.equal(policy.validateExisting('284961'),'284961');assert.equal(policy.validateExisting(password),password);
 assert.equal(accountPasswordPolicy().validateNew('284961'),'284961');assert.throws(()=>accountPasswordPolicy().validateNew(password),fails('INVALID_PASSWORD'));
});

test('public capabilities contain no simulated email path and registration must be explicitly enabled',async t=>{
 const f=fixture(t),cap=await f.call('access/capabilities',{},'','GET');
 assert.equal(cap.passwordRegistration,true);assert.deepEqual(cap.passwordPolicy,{min:12,max:128,legacyPinLogin:true});assert.equal(cap.emailMode,'disabled');assert.equal(cap.simulation,false);assert.equal(cap.simulationScope,null);
 for(const path of ['access/email/request','access/email/verify'])await assert.rejects(f.call(path,path.endsWith('request')?{email:'owner@example.test',deviceId:'synthetic_public_device_0001',requestId:randomUUID()}:{challengeId:randomUUID(),code:'123456',deviceId:'synthetic_public_device_0001'}),fails('EMAIL_DISABLED'));
 const disabled=createProductModules({database:f.database,origin,publicFrontend:true});await assert.rejects(Promise.resolve().then(()=>disabled.handle({method:'POST',path:'register',input:{password:'284961',requestId:randomUUID()},ip:'203.0.113.9'})),fails('PUBLIC_REGISTRATION_DISABLED'));
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM account_access_challenges').get().n,0);
});

test('public password mode cannot be combined with any injected email adapter, including a provider',t=>{
 const f=fixture(t);for(const mailAdapter of [createSimulationMailAdapter({origin:'http://localhost:18938'}),{mode:'provider',send:async()=>{}}])assert.throws(()=>createProductModules({database:f.database,...mode,mailAdapter}),/must not enable email OTP/);
});

test('five concurrent HTTP registrations and logins create independent accounts with private sessions',async t=>{
 const f=await httpFixture(t),requests=Array.from({length:5},()=>({password,requestId:randomUUID()}));
 const registrations=await Promise.all(requests.map(input=>f.request('register',{method:'POST',input})));
 assert.equal(new Set(registrations.map(r=>r.body.profile?.userId)).size,5);
 for(const result of registrations){assert.equal(result.status,200);assert.equal(result.body.created,true);assert.match(result.body.profile.userId,/^\d{10}$/);assert.equal(result.body.profile.authMode,'password');assert.equal(result.body.token,undefined);assert.match(result.headers['set-cookie'][0],/HttpOnly; SameSite=Strict.*Secure/);assert.doesNotMatch(result.text,/simulationCode|password_hash|password_salt/);}
 const logins=await Promise.all(registrations.map(r=>f.request('login',{method:'POST',input:{userId:r.body.profile.userId,password}})));
 for(let i=0;i<5;i++){assert.equal(logins[i].status,200);assert.equal(logins[i].body.created,false);assert.equal(logins[i].body.profile.userId,registrations[i].body.profile.userId);const state=await f.request('state',{cookie:logins[i].cookie});assert.equal(state.body.profile.userId,registrations[i].body.profile.userId);}
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM account_emails').get().n,0);
 const stored=f.database.raw.prepare('SELECT password_salt,password_hash FROM accounts').all();assert.equal(new Set(stored.map(a=>a.password_salt)).size,5);for(const a of stored)assert.notEqual(a.password_hash,password);
});

test('native password registration receives scoped bearer credentials and web responses do not',async t=>{
 const f=await httpFixture(t),result=await f.request('register',{method:'POST',nativeOrigin:'https://localhost',input:{password,requestId:randomUUID(),native:true}});
 assert.equal(result.status,200);assert.match(result.body.token,/^[-_A-Za-z0-9]{43}$/);assert.equal(result.headers['access-control-allow-origin'],'https://localhost');assert.equal(result.body.created,true);
});

test('registration retries require the original password and never bind or accept an email identity',async t=>{
 const f=fixture(t),requestId=randomUUID(),first=await f.register({requestId});
 const repeat=await f.register({requestId});assert.equal(repeat.created,false);assert.equal(repeat.profile.userId,first.profile.userId);
 await assert.rejects(f.register({requestId,password:'Different-long-password'}),fails('REGISTRATION_CONFLICT'));
 await assert.rejects(f.register({email:'owner@example.test'}),fails('INVALID_FIELDS'));
 await assert.rejects(f.register({userId:first.profile.userId}),fails('INVALID_FIELDS'));
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM accounts').get().n,1);
});

test('bounded hashing queue accepts five simultaneous users while shedding excess work',async t=>{
 const f=fixture(t),results=await Promise.allSettled(Array.from({length:24},(_,i)=>f.register({},'203.0.113.'+(20+i))));
 const success=results.filter(r=>r.status==='fulfilled'),busy=results.filter(r=>r.status==='rejected');assert.equal(success.length,18);assert.equal(busy.length,6);for(const result of busy)assert.equal(result.reason.code,'BUSY');
 const after=await f.register({},'203.0.113.99');assert.equal(after.created,true);
});

test('legacy PIN login remains valid but password rotation and recovery enforce the new policy and revoke sessions',async t=>{
 const f=fixture(t),legacy=createSocialService({database:f.database}),old=await legacy.handle({method:'POST',path:'register',input:{password:'284961',requestId:randomUUID()},ip:'127.0.0.1'});
 let a=await f.call('login',{userId:old.profile.userId,password:'284961'});assert.equal(a.created,false);
 await assert.rejects(f.register({password:'284961'}),fails('INVALID_PASSWORD'));
 await assert.rejects(f.call('password',{currentPassword:'284961',newPassword:'615938'},a.token),fails('INVALID_PASSWORD'));
 a=await f.call('password',{currentPassword:'284961',newPassword:password},a.token);assert.equal(a.profile.authMode,'password');assert.throws(()=>f.modules.social.authenticate(old.token),fails('ACCOUNT_REQUIRED'));
 const proof=await f.call('security/verify',{currentPassword:password},a.token),recovery=await f.call('security/recovery-code',{verificationToken:proof.verificationToken},a.token);
 await assert.rejects(f.call('security/recover',{userId:a.profile.userId,recoveryCode:recovery.recoveryCode,newPassword:'615938'}),fails('INVALID_PASSWORD'));
 const nextPassword='Changed-recovered-password-2419';await f.call('security/recover',{userId:a.profile.userId,recoveryCode:recovery.recoveryCode,newPassword:nextPassword});
 assert.throws(()=>f.modules.social.authenticate(a.token),fails('ACCOUNT_REQUIRED'));
 const next=await f.call('login',{userId:a.profile.userId,password:nextPassword});assert.equal(next.profile.userId,a.profile.userId);
 await assert.rejects(f.call('security/recover',{userId:a.profile.userId,recoveryCode:recovery.recoveryCode,newPassword:password}),fails('INVALID_RECOVERY'));
});

test('long password proves ID changes and security operations without weakening ownership',async t=>{
 const f=fixture(t),a=await f.register(),state=await f.call('me',{},a.token,'GET');
 const input={userId:'public_person',nickname:'Test person',bio:'',avatar:'🌱',avatarImage:'',revision:state.profile.revision,currentPassword:password};
 const changed=await f.call('profile',input,a.token);assert.equal(changed.profile.userId,'public_person');
 const verify=await f.call('security/verify',{currentPassword:password},a.token);assert.ok(verify.verificationToken);
 await assert.rejects(f.call('security/verify',{currentPassword:'Wrong-long-password'},a.token),fails('BAD_PASSWORD'));
 assert.equal((await f.call('login',{userId:'public_person',password})).created,false);
});

test('historical email account and its devices cannot be claimed through public registration or OTP',async t=>{
 const f=fixture(t),old=createProductModules({database:f.database,origin:'http://localhost:18938',simulation:true}),deviceId='synthetic_old_email_device_01';
 const challenge=await old.handle({method:'POST',path:'access/email/request',ip:'127.0.0.1',input:{email:'old@example.test',deviceId,requestId:randomUUID()}});
 const owner=await old.handle({method:'POST',path:'access/email/verify',ip:'127.0.0.1',input:{challengeId:challenge.challengeId,code:challenge.simulationCode,deviceId}}),ownerId=old.social.authenticate(owner.token).id;
 const paired=await old.handle({method:'POST',path:'devices/pair',token:owner.token,input:{name:'Existing owner computer'}});
 const before=f.database.raw.prepare('SELECT * FROM accounts WHERE id=?').get(ownerId),a=await f.register();
 await assert.rejects(f.call('login',{userId:owner.profile.userId,password}),fails('BAD_CREDENTIALS'));
 await assert.rejects(f.call('access/email/request',{email:'old@example.test',deviceId,requestId:randomUUID()}),fails('EMAIL_DISABLED'));
 await assert.rejects(f.call('access/email/verify',{challengeId:challenge.challengeId,code:challenge.simulationCode,deviceId}),fails('EMAIL_DISABLED'));
 await assert.rejects(f.call('devices/'+paired.deviceId+'/state',{},a.token,'GET'),fails('DEVICE_NOT_FOUND'));
 assert.deepEqual(f.database.raw.prepare('SELECT * FROM accounts WHERE id=?').get(ownerId),before);
 // Only a recovery secret that was already saved for this account can establish a password.
 const raw=randomBytes(24).toString('hex').toUpperCase();f.database.raw.prepare('INSERT INTO account_recovery VALUES(?,?,?)').run(ownerId,digest('yubenzhe:account-recovery:v1:'+ownerId+':'+raw),Date.now());
 const restored=await f.call('security/recover',{userId:owner.profile.userId,recoveryCode:'YBZ-'+raw,newPassword:password});assert.equal(restored.recovered,true);
 const login=await f.call('login',{userId:owner.profile.userId,password});assert.equal(login.profile.authMode,'password');assert.equal(f.modules.social.authenticate(login.token).id,ownerId);
});

test('public real rule tools produce an owned artifact while model and testnet payment remain independently configured',async t=>{
 const f=fixture(t,{workbenchRulesEnabled:true,groupWorkflowsEnabled:true}),a=await f.register(),b=await f.register();
 const cap=await f.call('workbench/capabilities',{},a.token,'GET');assert.equal(cap.enabled,true);assert.equal(cap.simulation,false);assert.equal(cap.executor,'local-file-parser');
 const group=await f.call('group-workflows/capabilities',{},a.token,'GET');assert.equal(group.enabled,true);assert.equal(group.ai.configured,false);assert.equal(group.payment.configured,false);assert.equal(group.payment.mainnet,false);
 let task=(await f.call('workbench/plan',{requestId:randomUUID(),goal:'准备一份产品发布工作清单',fileIds:[]},a.token)).task;assert.equal(task.simulation,false);
 await f.call('workbench/tasks/'+task.id+'/confirm',{requestId:randomUUID(),version:task.version,planVersion:task.planVersion,acceptExecution:true},a.token);
 for(let i=0;i<4;i++)await f.modules.tick();task=(await f.call('workbench/tasks/'+task.id,{},a.token,'GET')).task;assert.equal(task.status,'succeeded');assert.ok(task.outputs[0]?.id);
 const path='workbench/files/'+task.outputs[0].id,output=await f.call(path,{},a.token,'GET');assert.ok(output.binary.length>0);await assert.rejects(f.call(path,{},b.token,'GET'),fails('FILE_NOT_FOUND'));
});
