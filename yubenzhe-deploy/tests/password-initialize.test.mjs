import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {passwordRecord} from '../server/auth.mjs';

const origin='https://public.example.test',password='Synthetic-initial-password-7319!';
const digest=value=>createHash('sha256').update(value).digest('hex');
const fails=code=>error=>error.code===code;
const input={newPassword:password};
const path='access/password/initialize';
function fixture(t){
 const database=openSocialDatabase(':memory:');t.after(()=>database.close());let time=1700000000000;
 const old=createProductModules({database,origin:'http://localhost:18938',simulation:true,now:()=>time});
 const modules=createProductModules({database,origin,publicFrontend:true,publicPasswordRegistration:true,now:()=>time});
 const call=async(path,input={},token='',method='POST')=>modules.handle({path,input,token,method,ip:'203.0.113.8'});
 const emailUser=async(email='historical@example.test')=>{const deviceId='synthetic_old_device_0001',args={method:'POST',ip:'127.0.0.1'};const challenge=await old.handle({...args,path:'access/email/request',input:{email,deviceId,requestId:randomUUID()}});const account=await old.handle({...args,path:'access/email/verify',input:{challengeId:challenge.challengeId,code:challenge.simulationCode,deviceId}});return {...account,id:old.social.authenticate(account.token).id};};
 const one=(sql,...args)=>database.raw.prepare(sql).get(...args),run=(sql,...args)=>database.raw.prepare(sql).run(...args);
 const security=a=>call('access/security-state',{},a.token,'GET');
 return {database,old,modules,call,emailUser,one,run,security,time:()=>time,advance:ms=>time+=ms};
}
function proof(f,a,{purpose='security-change',expiresAt=f.time()+300000}={}){
 const key='synthetic-key-'+a.id,value=randomBytes(32).toString('base64url');
 f.run("INSERT OR IGNORE INTO account_passkeys VALUES(?,?,?,0,'[]','singleDevice',0,'Synthetic key',?,0)",key,a.id,Buffer.from([1]),f.time());
 f.run('UPDATE account_access_state SET ever_strong=1 WHERE account_id=?',a.id);const version=f.one('SELECT credential_version FROM account_access_state WHERE account_id=?',a.id).credential_version;
 f.run('INSERT INTO account_strong_proofs VALUES(?,?,?,?,?,?,?,?,0)',digest(value),a.id,digest(a.token),purpose,key,version,f.time(),expiresAt);return value;
}
async function reachHashing(f,id){
 // Only yield microtasks: the native scrypt callback cannot complete before the
 // test performs the authoritative state change below.
 for(let i=0;i<30;i++){if(f.one('SELECT 1 FROM social_limits WHERE key=?','password-initialize:'+id))return;await Promise.resolve();}
 assert.fail('password initialization did not reach its hashing boundary');
}

test('an existing verified email session can initialize once after five minutes and revoke all prior sessions',async t=>{
 const f=fixture(t),a=await f.emailUser();f.advance(61000);const second=await f.emailUser();f.advance(10*60000);
 const before=f.one('SELECT * FROM accounts WHERE id=?',a.id),version=(await f.security(a)).credentialVersion;assert.equal((await f.security(a)).canInitializePassword,true);
 const result=await f.call(path,input,a.token);assert.equal(result.initialized,true);assert.equal(result.profile.userId,a.profile.userId);assert.equal(result.profile.authMode,'password');assert.equal(result.profile.revision,before.revision+1);assert.notEqual(result.token,a.token);
 for(const token of [a.token,second.token])assert.throws(()=>f.modules.social.authenticate(token),fails('ACCOUNT_REQUIRED'));
 assert.equal(f.modules.social.authenticate(result.token).id,a.id);const state=await f.security(result);assert.equal(state.canInitializePassword,false);assert.equal(state.credentialVersion,version+1);
 const after=f.one('SELECT * FROM accounts WHERE id=?',a.id);assert.notEqual(after.password_salt,before.password_salt);assert.notEqual(after.password_hash,before.password_hash);assert.notEqual(after.password_hash,password);
 const audit=f.one("SELECT * FROM account_access_audit WHERE account_id=? AND event='password-initialized'",a.id);assert.ok(audit);assert.doesNotMatch(JSON.stringify(audit),new RegExp(password));
 assert.equal((await f.call('login',{userId:a.profile.userId,password})).profile.userId,a.profile.userId);
 await assert.rejects(f.call(path,input,result.token),fails('PASSWORD_INITIALIZATION_UNAVAILABLE'));
 assert.equal(f.one("SELECT count(*) n FROM account_access_audit WHERE account_id=? AND event='password-initialized'",a.id).n,1);
});

test('anonymous, expired and revoked sessions cannot initialize a historical account password',async t=>{
 const f=fixture(t),a=await f.emailUser();await assert.rejects(f.call(path,input),fails('ACCOUNT_REQUIRED'));
 f.run('UPDATE social_sessions SET expires_at=? WHERE token_hash=?',f.time()-1,digest(a.token));await assert.rejects(f.call(path,input,a.token),fails('ACCOUNT_REQUIRED'));
 f.advance(61000);const b=await f.emailUser();await f.call('logout',{},b.token);await assert.rejects(f.call(path,input,b.token),fails('ACCOUNT_REQUIRED'));
 assert.equal(f.one('SELECT auth_mode FROM accounts WHERE id=?',a.id).auth_mode,'email');
});

test('initialization accepts no owner ID, email or other-account proof and changes only the session owner',async t=>{
 const f=fixture(t),a=await f.emailUser('first@example.test'),b=await f.emailUser('second@example.test'),before=f.one('SELECT * FROM accounts WHERE id=?',b.id);
 for(const fields of [{userId:b.profile.userId},{accountId:b.id},{email:'second@example.test'}])await assert.rejects(f.call(path,{...input,...fields},a.token),fails('INVALID_FIELDS'));
 const ownProof=proof(f,a),otherProof=proof(f,b);await assert.rejects(f.call(path,{...input,proof:otherProof},a.token),fails('STRONG_PROOF_REQUIRED'));
 const result=await f.call(path,{...input,proof:ownProof},a.token);assert.equal(result.profile.userId,a.profile.userId);assert.deepEqual(f.one('SELECT * FROM accounts WHERE id=?',b.id),before);assert.equal(f.modules.social.authenticate(b.token).id,b.id);
});

test('existing PIN, existing password, recovered email, unverified email and nonpublic modes never offer initialization',async t=>{
 const f=fixture(t),a=await f.emailUser();
 const legacy=await f.old.handle({method:'POST',path:'register',ip:'127.0.0.1',input:{password:'284961',requestId:randomUUID()}}),fresh=await f.call('register',{password,requestId:randomUUID()});
 for(const account of [legacy,fresh]){assert.equal((await f.security(account)).canInitializePassword,false);await assert.rejects(f.call(path,input,account.token),fails('PASSWORD_INITIALIZATION_UNAVAILABLE'));}
 f.run("INSERT INTO account_access_audit VALUES(?,?,'account-recovered',?,'{}')",randomUUID(),a.id,f.time());assert.equal((await f.security(a)).canInitializePassword,false);await assert.rejects(f.call(path,input,a.token),fails('PASSWORD_INITIALIZATION_UNAVAILABLE'));
 const b=await f.emailUser('unverified@example.test');f.run('UPDATE account_emails SET verified_at=0 WHERE account_id=?',b.id);assert.equal((await f.security(b)).canInitializePassword,false);await assert.rejects(f.call(path,input,b.token),fails('PASSWORD_INITIALIZATION_UNAVAILABLE'));
 const c=await f.emailUser('local@example.test');assert.equal(f.old.social.accountAccess.getSecurityState(c.id).canInitializePassword,false);await assert.rejects(f.old.handle({method:'POST',path,token:c.token,input:{newPassword:'284961'},ip:'127.0.0.1'}),fails('PASSWORD_INITIALIZATION_UNAVAILABLE'));
});

test('strong-credential accounts must present the original purpose-bound proof and retain their passkeys',async t=>{
 const f=fixture(t),a=await f.emailUser(),valid=proof(f,a),wrong=proof(f,a,{purpose:'profile-change'}),expired=proof(f,a,{expiresAt:f.time()-1});
 assert.equal((await f.security(a)).canInitializePassword,true);for(const value of [undefined,wrong,expired])await assert.rejects(f.call(path,{...input,...(value?{proof:value}:{})},a.token),fails('STRONG_PROOF_REQUIRED'));
 const result=await f.call(path,{...input,proof:valid},a.token),state=await f.security(result);assert.equal(state.everHadStrongCredential,true);assert.equal(state.credentials.length,1);assert.equal(state.canInitializePassword,false);assert.equal(f.one('SELECT count(*) n FROM account_strong_proofs WHERE account_id=?',a.id).n,0);
 const b=await f.emailUser('lost-strong@example.test');f.run('UPDATE account_access_state SET ever_strong=1 WHERE account_id=?',b.id);assert.equal((await f.security(b)).canInitializePassword,false);await assert.rejects(f.call(path,input,b.token),fails('PASSWORD_INITIALIZATION_UNAVAILABLE'));
});

test('a revoked session during password hashing cannot commit the new credential',async t=>{
 const f=fixture(t),a=await f.emailUser(),before=f.one('SELECT * FROM accounts WHERE id=?',a.id),pending=f.call(path,input,a.token);await reachHashing(f,a.id);
 f.run('DELETE FROM social_sessions WHERE token_hash=?',digest(a.token));await assert.rejects(pending,fails('ACCOUNT_REQUIRED'));assert.deepEqual(f.one('SELECT * FROM accounts WHERE id=?',a.id),before);
});

test('credential version and original password are checked again after hashing',async t=>{
 for(const mutation of ['version','password']){
  const f=fixture(t),a=await f.emailUser(),pending=f.call(path,input,a.token);await reachHashing(f,a.id);
  if(mutation==='version')f.run('UPDATE account_access_state SET credential_version=credential_version+1 WHERE account_id=?',a.id);
  else f.run('UPDATE accounts SET password_hash=? WHERE id=?','f'.repeat(64),a.id);
  await assert.rejects(pending,fails('ACCOUNT_CHANGED'));assert.equal(f.one('SELECT auth_mode FROM accounts WHERE id=?',a.id).auth_mode,'email');assert.equal(f.one("SELECT count(*) n FROM account_access_audit WHERE account_id=? AND event='password-initialized'",a.id).n,0);
 }
});

test('concurrent password initialization commits one credential, audit and replacement session only',async t=>{
 const f=fixture(t),a=await f.emailUser(),results=await Promise.allSettled([f.call(path,input,a.token),f.call(path,{newPassword:'Different-initial-password-4812'},a.token)]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const rejected=results.find(result=>result.status==='rejected');assert.ok(['ACCOUNT_REQUIRED','ACCOUNT_CHANGED'].includes(rejected.reason.code));
 assert.equal(f.one("SELECT count(*) n FROM account_access_audit WHERE account_id=? AND event='password-initialized'",a.id).n,1);assert.equal(f.one('SELECT count(*) n FROM social_sessions WHERE account_id=?',a.id).n,1);
});

test('short, oversized and control-character initialization passwords never alter an eligible account',async t=>{
 const f=fixture(t),a=await f.emailUser(),before=f.one('SELECT * FROM accounts WHERE id=?',a.id);
 for(const newPassword of ['284961','x'.repeat(11),'x'.repeat(129),'long-password\n'])await assert.rejects(f.call(path,{newPassword},a.token),fails('INVALID_PASSWORD'));
 assert.deepEqual(f.one('SELECT * FROM accounts WHERE id=?',a.id),before);assert.equal((await f.security(a)).canInitializePassword,true);
});

test('HTTP password initialization rotates the web cookie and native bearer without exposing web tokens',async t=>{
 const f=fixture(t),dir=mkdtempSync(join(tmpdir(),'ybz-password-initialize-'));writeFileSync(join(dir,'index.html'),'SYNTHETIC_TEST');
 const auth=await passwordRecord('unused','Synthetic-unused-reviewer-3918!'),server=createAcceptanceServer({role:'frontend',origin,authConfig:auth,publicFrontend:true,staticRoot:dir,socialService:{handle:request=>f.modules.handle(request)}});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const target=resolve(dir);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('ybz-password-initialize-'));rmSync(target,{recursive:true,force:true});});
 const request=(account,native)=>new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/api/social/'+path,method:'POST',headers:{Host:new URL(origin).host,Origin:native?'https://localhost':origin,'Content-Type':'application/json',...(native?{Authorization:'Bearer '+account.token}:{Cookie:'ybz_social='+account.token})}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(JSON.stringify(input));});
 const web=await f.emailUser('web@example.test'),native=await f.emailUser('native@example.test');
 const response=await request(web,false);assert.equal(response.status,200);assert.equal(response.body.initialized,true);assert.equal(response.body.token,undefined);assert.match(response.headers['set-cookie'][0],/HttpOnly; SameSite=Strict.*Secure/);assert.throws(()=>f.modules.social.authenticate(web.token),fails('ACCOUNT_REQUIRED'));
 const result=await request(native,true);assert.equal(result.status,200);assert.match(result.body.token,/^[-_A-Za-z0-9]{43}$/);assert.equal(f.modules.social.authenticate(result.body.token).id,native.id);assert.throws(()=>f.modules.social.authenticate(native.token),fails('ACCOUNT_REQUIRED'));
});
