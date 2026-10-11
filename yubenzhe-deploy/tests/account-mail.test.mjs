import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createDisabledMailAdapter,createSimulationMailAdapter,createInternalPreviewMailAdapter,createHttpMailAdapter,createMailAdapterFromEnvironment} from '../server/account-mail.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {openSocialDatabase} from '../server/social-database.mjs';
const endpoint='https://mail.example.test/v3/mail/send',key='synthetic-mail-key-never-valid',secret='synthetic-persistent-OTP-secret-00001',from='sender@example.test';
const options={endpoint,apiKey:key,from},env={EMAIL_PROVIDER:'http',EMAIL_ENDPOINT:endpoint,EMAIL_API_KEY:key,EMAIL_FROM:from,EMAIL_OTP_SECRET:secret};
const otp={to:'recipient@example.test',kind:'otp',code:'123456',expiresAt:1893456000000,locale:'en'};
function temporary(t){const dir=mkdtempSync(join(tmpdir(),'ybz-mail-test-'));t.after(()=>{const safe=resolve(dir);assert.equal(dirname(safe),resolve(tmpdir()));assert.ok(basename(safe).startsWith('ybz-mail-test-'));rmSync(safe,{recursive:true,force:true});});return dir;}
function database(t){const db=openSocialDatabase(':memory:');t.after(()=>db.close());return db;}
const passFetch=async()=>new Response(null,{status:202});

test('HTTP mail has provider mode and sends the configured HTTPS endpoint, Bearer header and Chinese/English text',async()=>{
 const requests=[],mail=createHttpMailAdapter({...options,fetchImpl:async(url,init)=>{requests.push({url,init,body:JSON.parse(init.body)});return new Response('accepted',{status:202});}});
 assert.equal(mail.mode,'provider');assert.deepEqual(await mail.send({...otp,to:'PERSON@Example.test'}),{accepted:true});await mail.send({...otp,locale:'zh-CN'});
 for(const request of requests){assert.equal(request.url,endpoint);assert.equal(request.init.method,'POST');assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.Authorization,'Bearer '+key);assert.equal(request.init.headers['Content-Type'],'application/json');assert.ok(request.init.signal instanceof AbortSignal);assert.equal(request.body.from,from);assert.match(request.body.text,/123456/);assert.match(request.body.text,/2030-01-01T00:00:00.000Z/);assert.doesNotMatch(request.body.text,/mnemonic|private key|password|助记词|私钥|密码/);assert.deepEqual(Object.keys(request.body),['from','to','subject','text']);}
 assert.equal(requests[0].body.to,'person@example.test');assert.match(requests[0].body.text,/please ignore/);assert.match(requests[1].body.text,/请忽略此邮件/);
});
test('HTTP mail rejects insecure or credential-bearing endpoints before sending',()=>{
 for(const endpoint of ['http://mail.example.test/send','file:///mail','not a URL','https://user:password@mail.example.test/send','https://mail.example.test/send?key=secret','https://mail.example.test/send#secret'])assert.throws(()=>createHttpMailAdapter({...options,endpoint}),/configuration/);
});
test('HTTP mail rejects invalid sender, header keys and timeout settings',()=>{
 for(const from of ['bad','someone@example.test\r\nBcc:other@example.test'])assert.throws(()=>createHttpMailAdapter({...options,from}),/email address/);
 for(const apiKey of ['', 'short', 'x'.repeat(8193), 'synthetic-header-key\nInjected: value','synthetic key with spaces'])assert.throws(()=>createHttpMailAdapter({...options,apiKey}),/configuration/);
 for(const timeoutMs of [0,-1,Infinity,NaN])assert.throws(()=>createHttpMailAdapter({...options,timeoutMs}),/configuration/);
});
test('HTTP mail validates recipient, kind, six-digit OTP and timestamp without network calls',async()=>{
 let calls=0;const mail=createHttpMailAdapter({...options,fetchImpl:async()=>{calls++;return new Response(null,{status:202});}});
 for(const changed of [{to:'bad'},{to:'a@example.test\nBcc:other@example.test'},{kind:'arbitrary'},{code:'12345'},{code:123456},{expiresAt:'2030-01-01'},{expiresAt:0},{expiresAt:Infinity},{expiresAt:8640000000000001}])await assert.rejects(mail.send({...otp,...changed}),/Invalid email/);
 assert.equal(calls,0);
});
test('security-notice supports the existing no-code notification contract without reflecting event input',async()=>{
 const payloads=[],mail=createHttpMailAdapter({...options,fetchImpl:async(url,init)=>{payloads.push(JSON.parse(init.body));return new Response(null,{status:202});}});
 for(const locale of ['en','zh-CN'])await mail.send({to:otp.to,kind:'security-notice',event:'SENSITIVE_EVENT_INJECTION',locale});
 assert.match(payloads[0].subject,/security/);assert.match(payloads[1].subject,/安全/);for(const payload of payloads)assert.doesNotMatch(JSON.stringify(payload),/SENSITIVE_EVENT_INJECTION|undefined|123456/);
});
test('upstream failures discard response bodies and never echo body secrets',async()=>{
 const response=new Response('UPSTREAM_ECHO_'+key+'_'+otp.code,{status:500});const mail=createHttpMailAdapter({...options,fetchImpl:async()=>response});
 await assert.rejects(mail.send(otp),error=>error.message==='Email delivery failed.'&&!error.message.includes(key)&&!error.message.includes(otp.code));assert.equal(response.bodyUsed,true);
});
test('network and redirect exceptions are sanitized rather than exposing provider details',async()=>{
 const mail=createHttpMailAdapter({...options,fetchImpl:async(url,init)=>{assert.equal(init.redirect,'error');throw Error('network exception '+key+' '+otp.code);}});
 await assert.rejects(mail.send(otp),error=>error.message==='Email delivery failed.');
});
test('HTTP delivery aborts at the 10-second maximum even if a longer timeout is configured',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let aborted=false;
 const mail=createHttpMailAdapter({...options,timeoutMs:60000,fetchImpl:async(url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>{aborted=true;reject(Error('synthetic timeout '+key));},{once:true}))});
 const pending=assert.rejects(mail.send(otp),error=>error.message==='Email delivery timed out.');t.mock.timers.tick(9999);assert.equal(aborted,false);t.mock.timers.tick(1);await pending;assert.equal(aborted,true);
});
test('disabled adapter retains its original rejection behavior',async()=>{
 const mail=createDisabledMailAdapter();assert.equal(mail.mode,'disabled');await assert.rejects(mail.send(otp),/Email delivery is not configured/);
});
test('loopback simulation keeps isolation, capped copied outbox and clear behavior',async()=>{
 for(const origin of ['https://remote.example.test','http://localhost/path','http://localhost/?x=1','http://user:password@localhost'])assert.throws(()=>createSimulationMailAdapter({origin}));
 const mail=createSimulationMailAdapter({origin:'http://localhost:18914'});assert.equal(mail.mode,'simulation');assert.equal(mail.scope,'loopback');
 for(let i=0;i<101;i++)await mail.send({...otp,challengeId:String(i)});const outbox=mail.readOutbox();assert.equal(outbox.length,100);assert.equal(outbox[0].challengeId,'1');outbox[0].code='000000';assert.equal(mail.readOutbox()[0].code,otp.code);mail.clear();assert.deepEqual(mail.readOutbox(),[]);
});
test('internal preview simulation retains exact HTTPS origin and the existing outbox contract',async()=>{
 for(const origin of ['http://localhost:18914','https://preview.example.test/','https://user:password@preview.example.test'])assert.throws(()=>createInternalPreviewMailAdapter({origin}));
 const mail=createInternalPreviewMailAdapter({origin:'https://preview.example.test'});assert.equal(mail.mode,'simulation');assert.equal(mail.scope,'internal-preview');await mail.send(otp);assert.equal(mail.readOutbox()[0].code,otp.code);
});
test('environment stays disabled unless explicitly selected and rejects unknown real providers',()=>{
 assert.equal(createMailAdapterFromEnvironment({env:{}}),undefined);assert.equal(createMailAdapterFromEnvironment({env:{EMAIL_API_KEY:key,EMAIL_ENDPOINT:endpoint}}),undefined);assert.equal(createMailAdapterFromEnvironment({env:{...env,EMAIL_PROVIDER:'disabled'}}),undefined);assert.throws(()=>createMailAdapterFromEnvironment({env:{...env,EMAIL_PROVIDER:'unknown'}}),/Unsupported EMAIL_PROVIDER/);
});
test('explicit HTTP configuration requires a persistent OTP secret and complete settings',()=>{
 for(const EMAIL_OTP_SECRET of [undefined,'short','x'.repeat(31)])assert.throws(()=>createMailAdapterFromEnvironment({env:{...env,EMAIL_OTP_SECRET}}),/persistent EMAIL_OTP_SECRET/);
 for(const setting of ['EMAIL_ENDPOINT','EMAIL_API_KEY','EMAIL_FROM'])assert.throws(()=>createMailAdapterFromEnvironment({env:{...env,[setting]:''}}));
 assert.equal(createMailAdapterFromEnvironment({env,fetchImpl:passFetch}).mode,'provider');
});
test('key files take precedence over direct environment credentials and enforce private regular file checks',async()=>{
 const fileKey='synthetic-file-key-never-valid',requests=[],fileEnv={...env,EMAIL_API_KEY_FILE:'/synthetic/test-key'};
 const fileSystem={statSync:path=>{assert.equal(path,fileEnv.EMAIL_API_KEY_FILE);return {isFile:()=>true,size:31,mode:0o100600};},readFileSync:(path,encoding)=>{assert.equal(encoding,'utf8');return fileKey+'\n';}};
 await createMailAdapterFromEnvironment({env:fileEnv,fileSystem,fetchImpl:async(url,init)=>{requests.push(init);return new Response(null,{status:202});}}).send(otp);assert.equal(requests[0].headers.Authorization,'Bearer '+fileKey);
 for(const info of [{isFile:()=>true,size:31,mode:0o100644},{isFile:()=>false,size:31,mode:0o100600},{isFile:()=>true,size:8193,mode:0o100600}])assert.throws(()=>createMailAdapterFromEnvironment({env:fileEnv,fileSystem:{...fileSystem,statSync:()=>info}}),/Invalid EMAIL_API_KEY_FILE/);
 assert.throws(()=>createMailAdapterFromEnvironment({env:fileEnv,fileSystem:{...fileSystem,readFileSync(){throw Error('secret path');}}}),error=>error.message==='Invalid EMAIL_API_KEY_FILE; require a private regular file.');
});
test('real key file loading fails closed on insecure Windows mode and works only with private filesystem permissions',async t=>{
 const dir=temporary(t),path=join(dir,'synthetic-key'),fileKey='synthetic-private-file-key-00001';writeFileSync(path,fileKey,{mode:0o600});
 const selected={...env,EMAIL_API_KEY_FILE:path},info=statSync(path);
 if(info.mode&0o077)assert.throws(()=>createMailAdapterFromEnvironment({env:selected}),/Invalid EMAIL_API_KEY_FILE/);
 else{let header;await createMailAdapterFromEnvironment({env:selected,fetchImpl:async(url,init)=>{header=init.headers.Authorization;return new Response(null,{status:202});}}).send(otp);assert.equal(header,'Bearer '+fileKey);}
 assert.throws(()=>createMailAdapterFromEnvironment({env:{...env,EMAIL_API_KEY_FILE:join(dir,'missing')}}),/Invalid EMAIL_API_KEY_FILE/);
});
test('module precedence preserves explicit adapters, internal preview and M0 despite unrelated mail environment',t=>{
 const db=database(t),badEnv={EMAIL_PROVIDER:'unknown'},explicit=createDisabledMailAdapter();
 assert.equal(createProductModules({database:db,origin:'http://localhost:18914',simulation:true,mailAdapter:explicit,mailEnv:badEnv}).mail,explicit);
 const preview=createProductModules({database:db,origin:'https://preview.example.test',internalPreview:true,otpSecret:secret,mailEnv:badEnv});assert.equal(preview.mail.scope,'internal-preview');
 const local=createProductModules({database:db,origin:'http://localhost:18914',simulation:true,mailEnv:badEnv});assert.equal(local.mail.scope,'loopback');
 assert.throws(()=>createProductModules({database:db,origin:'https://public.example.test',mailEnv:badEnv}),/Unsupported EMAIL_PROVIDER/);
});
test('module defaults without EMAIL configuration retain disabled capabilities and no simulation code',async t=>{
 const db=database(t),modules=createProductModules({database:db,origin:'https://public.example.test',mailEnv:{}});
 const capability=await modules.handle({method:'GET',path:'access/capabilities'});assert.equal(capability.emailMode,'disabled');assert.equal(capability.simulation,false);
 await assert.rejects(modules.handle({method:'POST',path:'access/email/request',input:{email:otp.to,deviceId:'synthetic_mail_device_00001',requestId:randomUUID()},ip:'203.0.113.9'}),e=>e.code==='EMAIL_DISABLED');
 assert.equal(db.raw.prepare('SELECT count(*) n FROM account_access_challenges').get().n,0);
});
test('module environment selects real provider while account-access still requires a long OTP secret',t=>{
 const db=database(t);assert.equal(createProductModules({database:db,origin:'https://public.example.test',mailEnv:env}).mail.mode,'provider');
 for(const otpSecret of ['', 'short'])assert.throws(()=>createProductModules({database:db,origin:'https://public.example.test',mailAdapter:createHttpMailAdapter({...options,fetchImpl:passFetch}),otpSecret,mailEnv:{}}),/persistent OTP secret/);
});
test('remote provider OTP and idempotent requests expose no code, verify normally, and flush existing security notices',async t=>{
 const db=database(t),payloads=[],mail=createHttpMailAdapter({...options,fetchImpl:async(url,init)=>{payloads.push(JSON.parse(init.body));return new Response(null,{status:202});}}),modules=createProductModules({database:db,origin:'https://public.example.test',mailAdapter:mail,otpSecret:secret,mailEnv:{}});
 const deviceId='synthetic_mail_device_00001',input={email:otp.to,deviceId,requestId:randomUUID(),locale:'en'},request={method:'POST',path:'access/email/request',input,ip:'203.0.113.9'};
 const sent=await modules.handle(request),again=await modules.handle(request);assert.equal(sent.mode,'provider');assert.equal(Object.hasOwn(sent,'simulationCode'),false);assert.equal(Object.hasOwn(again,'simulationCode'),false);assert.equal(sent.challengeId,again.challengeId);assert.equal(payloads.length,1);
 const code=payloads[0].text.match(/code: (\d{6})/)[1],a=await modules.handle({method:'POST',path:'access/email/verify',input:{challengeId:sent.challengeId,code,deviceId},ip:'203.0.113.9'});assert.equal(a.created,true);
 const account=modules.social.authenticate(a.token);modules.social.accountAccess.onRecoveryCodeChanged(account);assert.deepEqual(await modules.social.accountAccess.flushNotifications(),{delivered:1});assert.equal(payloads.length,2);assert.match(payloads[1].subject,/安全/);assert.equal(db.raw.prepare("SELECT count(*) n FROM account_security_notifications WHERE status='pending'").get().n,0);
});
test('failed real delivery returns a sanitized error and consumes the challenge rather than allowing verification',async t=>{
 const db=database(t),mail=createHttpMailAdapter({...options,fetchImpl:async()=>new Response('echo '+key,{status:500})}),modules=createProductModules({database:db,origin:'https://public.example.test',mailAdapter:mail,otpSecret:secret,mailEnv:{}}),requestId=randomUUID();
 await assert.rejects(modules.handle({method:'POST',path:'access/email/request',input:{email:otp.to,deviceId:'synthetic_mail_device_00001',requestId},ip:'203.0.113.9'}),error=>error.code==='EMAIL_DELIVERY_FAILED'&&!error.message.includes(key));
 assert.ok(db.raw.prepare('SELECT consumed_at FROM account_access_challenges WHERE request_id=?').get(requestId).consumed_at>0);
});
test('real startup rejects unknown, incomplete or short-secret mail configuration before auth and database access',t=>{
 const dir=temporary(t),base={};for(const name of ['SystemRoot','WINDIR','PATH','TEMP','TMP'])if(process.env[name])base[name]=process.env[name];
 Object.assign(base,{ROLE:'frontend',PUBLIC_ORIGIN:'https://mail-start.example.test',AUTH_CONFIG_FILE:join(dir,'missing-auth.json'),AI_DATABASE_PATH:join(dir,'ai.sqlite'),SOCIAL_DATABASE_PATH:join(dir,'social.sqlite'),DATABASE_PATH:join(dir,'admin.sqlite'),AI_PROVIDER:'disabled'});
 for(const [changes,expected] of [[{...env,EMAIL_PROVIDER:'unknown'},/Unsupported EMAIL_PROVIDER/],[{...env,EMAIL_OTP_SECRET:'short'},/persistent EMAIL_OTP_SECRET/],[{...env,EMAIL_ENDPOINT:'http://mail.example.test/send'},/Invalid HTTP email configuration/]]){
  const result=spawnSync(process.execPath,['server/start.mjs'],{cwd:resolve(dirname(fileURLToPath(import.meta.url)),'..'),env:{...base,...changes},windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,expected);assert.doesNotMatch(result.stderr,/missing-auth|ENOENT|synthetic-mail-key-never-valid/);for(const file of ['ai.sqlite','social.sqlite','admin.sqlite'])assert.equal(existsSync(join(dir,file)),false);
 }
});
