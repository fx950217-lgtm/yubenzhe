import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AccountElement} from './helpers/account-dom.mjs';
import {isCurrentAccountPassword,validateNewAccountPassword} from '../src/account-password.js';
let source=await readFile(new URL('../src/account-ui.js',import.meta.url),'utf8');
source=source.replace("import './account-ui.css';",'').replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL('../src/'+path.slice(2),import.meta.url).href}'`);
const {mountAccountGate,accountSettingsHTML}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const PUBLIC={passwordRegistration:true,passwordPolicy:{min:12,max:128,legacyPinLogin:true},emailMode:'disabled',simulation:false};
const PASSWORD='  synthetic long phrase  ';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function harness({capabilities=PUBLIC,register,login,request}={}){
 const root=new AccountElement(),calls=[],ready=[];
 const client={publicRequest:async(path,options)=>{calls.push({path,...options});if(path==='access/capabilities')return await capabilities;if(request)return request(path,options);if(path==='access/email/request')return {challengeId:'synthetic-challenge',simulationCode:'284693',resendAt:0};throw Error('Unexpected '+path);},register:register??(async(password,requestId)=>{calls.push({path:'register',password,requestId});return {userId:'4937218635',authMode:'password'};}),login:login??(async(userId,password)=>{calls.push({path:'login',userId,password});return {userId};}),verifyEmail:async input=>{calls.push({path:'verifyEmail',input});return {userId:'4937218635'};},clearSession(){calls.push({path:'clearSession'})},setAccessRecoveryToken(token){calls.push({path:'recoveryToken',token})}};
 const cleanup=mountAccountGate(root,{client,onReady:(...args)=>ready.push(args)});
 return {root,client,calls,ready,cleanup,click:selector=>root.querySelector(selector).onclick(),submit(values){const form=root.querySelector('form');for(const [name,value]of Object.entries(values))form.elements[name].value=value;return form.onsubmit({preventDefault(){},currentTarget:form});}};
}
test('public registration loads capabilities, validates both passwords, then explicitly saves the random ID',async()=>{
 const h=harness();assert.equal(h.root.querySelector('form'),null);await tick();
 let form=h.root.querySelector('form');assert.equal(form.elements.email,undefined);assert.equal(form.elements.userId,undefined);assert.equal(form.elements.password.attrs.minlength,'12');assert.equal(form.elements.password.attrs.maxlength,'128');assert.equal(form.elements.password.attrs.inputmode,undefined);
 await h.submit({password:'482615',repeat:'482615'});assert.equal(h.calls.some(c=>c.path==='register'),false);assert.match(h.root.querySelector('.form-error').textContent,/12–128/);
 await h.submit({password:PASSWORD,repeat:'different password'});assert.equal(h.calls.some(c=>c.path==='register'),false);
 await h.submit({password:PASSWORD,repeat:PASSWORD});assert.equal(h.calls.at(-1).password,PASSWORD);assert.equal(h.ready.length,0);assert.equal(h.root.querySelector('output').textContent,'4937218635');assert.equal(h.root.querySelector('input'),null);assert.doesNotMatch(h.root.html,/synthetic long phrase|验证码/);assert.match(h.root.html,/钱包密码相互独立/);
 h.click('[data-id-saved]');assert.equal(h.ready[0][0].userId,'4937218635');assert.equal(h.ready[0][1],true);h.cleanup();
});
test('registration retry retains idempotency key and cannot double submit or redraw after disposal',async()=>{
 const ids=[],pending=deferred();let attempt=0;
 const h=harness({register:async(password,id)=>{ids.push(id);if(++attempt===1)throw Error('uncertain');return pending.promise;}});await tick();
 await h.submit({password:PASSWORD,repeat:PASSWORD});const second=h.submit({password:PASSWORD,repeat:PASSWORD});await h.submit({password:PASSWORD,repeat:PASSWORD});assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);h.cleanup();pending.resolve({userId:'4937218635'});await second;assert.deepEqual(h.ready,[]);assert.equal(h.root.children.length,0);
});
test('ID login accepts existing numeric PIN and long password without trimming account secrets',async()=>{
 for(const password of ['482615',PASSWORD]){const h=harness();await tick();h.click('[data-mode="login"]');await h.submit({userId:' Owner_ID ',password});assert.deepEqual(h.calls.at(-1),{path:'login',userId:'owner_id',password});assert.equal(h.ready[0][1],false);h.cleanup();}
});
test('public recovery uses ID plus saved recovery code and new policy; never requests an email code',async()=>{
 const h=harness({request:async path=>{assert.equal(path,'security/recover');return {recovered:true,accessRecoveryToken:'synthetic-proof'};}});await tick();h.click('[data-mode="login"]');h.click('[data-mode="recover"]');
 await h.submit({userId:' Owner_ID ',recoveryCode:' saved-code ',password:PASSWORD,repeat:PASSWORD});
 assert.deepEqual(h.calls.find(c=>c.path==='security/recover').input,{userId:'owner_id',recoveryCode:'saved-code',newPassword:PASSWORD});assert.equal(h.root.querySelector('form').elements.userId.value,'owner_id');assert.equal(h.root.querySelector('form').elements.password.value,'');assert.equal(h.calls.some(c=>c.path==='access/email/request'),false);h.cleanup();
});
test('internal and local simulation retain explicit test mail, while real providers never display returned simulation codes',async()=>{
 for(const scope of ['internal-preview','loopback','provider']){
  const h=harness({capabilities:{emailMode:scope==='provider'?'provider':'simulation',simulation:scope!=='provider',simulationScope:scope}});await tick();await h.submit({email:'tester@example.test'});
  assert.equal(!!h.root.querySelector('.account-simulation'),scope!=='provider');if(scope==='internal-preview')assert.match(h.root.html,/内部测试验证码/);if(scope==='provider')assert.doesNotMatch(h.root.html,/284693/);h.cleanup();
 }
});
test('failed capabilities cannot expose fallback registration or simulated email; explicit retry works',async()=>{
 const h=harness({capabilities:Promise.reject(Error('network unavailable'))});await tick();assert.equal(h.root.querySelector('form'),null);assert.equal(h.root.querySelector('[data-mode="email"]'),null);
 h.client.getAccountCapabilities=async()=>PUBLIC;await h.click('[data-reload-capabilities]');assert.equal(h.root.querySelector('form').elements.password.attrs.minlength,'12');h.cleanup();
 const pending=deferred(),late=harness({capabilities:pending.promise});late.cleanup();pending.resolve(PUBLIC);await tick();assert.equal(late.root.children.length,0);
});
test('disabled email without public registration provides login but no test registration entry',async()=>{
 const h=harness({capabilities:{emailMode:'disabled',simulation:false,passwordRegistration:false}});await tick();assert.ok(h.root.querySelector('form').elements.userId);assert.equal(h.root.querySelector('[data-mode="register"]'),null);assert.equal(h.root.querySelector('[data-mode="email"]'),null);h.cleanup();
});
test('account password settings and policy keep legacy login compatibility without relaxing public new passwords',()=>{
 const html=accountSettingsHTML({nickname:'本人',userId:'4937218635',authMode:'password'},PUBLIC),root=new AccountElement();root.innerHTML=html;
 const f=root.querySelector('form');assert.equal(f.elements.currentPassword.attrs.maxlength,'128');assert.equal(f.elements.newPassword.attrs.minlength,'12');assert.equal(f.elements.repeat.attrs.maxlength,'128');assert.equal(f.attrs.hidden,undefined);
 assert.equal(isCurrentAccountPassword('482615'),true);assert.equal(isCurrentAccountPassword(PASSWORD),true);assert.equal(isCurrentAccountPassword('abc123'),false);
 for(const value of ['482615','a'.repeat(129),'safe phrase\nno',' '.repeat(12),'\u3000'.repeat(12)])assert.throws(()=>validateNewAccountPassword(value,PUBLIC));
 assert.equal(isCurrentAccountPassword(' '.repeat(12)),false);assert.equal(isCurrentAccountPassword('\u3000'.repeat(12)),false);
 assert.equal(validateNewAccountPassword(PASSWORD,PUBLIC),PASSWORD);assert.equal(validateNewAccountPassword('482615',{simulation:true}),'482615');
});
