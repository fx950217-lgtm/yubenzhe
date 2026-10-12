import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {passwordRecord} from '../server/auth.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {parseTrustedProxyIPs} from '../server/social-http.mjs';

const origin='https://public.example.test',password='Synthetic-proxy-test-only-4819!';
const auth=await passwordRecord('reviewer',password);
async function fixture(t,{trustedProxyIPs,internalPreview=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'ybz-trusted-proxy-'));writeFileSync(join(dir,'index.html'),'SYNTHETIC_PROXY_TEST');
 const socialService={handle(request){const value={ip:request.ip,peer:request.devicePeerIp};return request.path.startsWith('desktop')?{value}:value;}};
 const server=createAcceptanceServer({role:'frontend',origin,authConfig:auth,publicFrontend:!internalPreview,internalPreview,trustedProxyIPs,staticRoot:dir,socialService});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const request=(path,{headers={},method='GET',body}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{Host:new URL(origin).host,...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);
 });
 const login=async()=>{const r=await request('/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'reviewer',password}).toString()});assert.equal(r.status,303);return r.headers['set-cookie'][0].split(';')[0];};
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const target=resolve(dir);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('ybz-trusted-proxy-'));rmSync(target,{recursive:true,force:true});});
 return {request,login};
}

test('trusted proxies are exact IP addresses with a bounded validated list and legacy loopback default',()=>{
 assert.deepEqual(parseTrustedProxyIPs(),['127.0.0.1','::1','::ffff:127.0.0.1']);
 assert.deepEqual(parseTrustedProxyIPs('172.19.0.1, ::ffff:172.19.0.1,::1'),['172.19.0.1','::1']);
 for(const value of ['0.0.0.0/0','172.19.0.0/16','*','localhost','example.test','127.0.0.1,','127.0.0.1,,::1',Array(33).fill('127.0.0.1').join(','),'x'.repeat(2049)])assert.throws(()=>parseTrustedProxyIPs(value),/TRUSTED_PROXY_IPS/);
});

test('an untrusted socket peer cannot set identity rate-limit IP using forwarding headers',async t=>{
 const f=await fixture(t,{trustedProxyIPs:parseTrustedProxyIPs('172.19.0.1')});
 for(const path of ['/api/social/state','/api/ai-channel/devices/example','/api/desktop/capabilities']){
  const result=await f.request(path,{headers:{'x-forwarded-for':'198.51.100.1','x-real-ip':'198.51.100.2',forwarded:'for=198.51.100.3'}});
  assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.text),{ip:'127.0.0.1',peer:'127.0.0.1'});
 }
});

test('only a trusted proxy can supply the final valid forwarding hop, while device peer stays physical',async t=>{
 const f=await fixture(t,{trustedProxyIPs:parseTrustedProxyIPs('::ffff:127.0.0.1')});
 for(const path of ['/api/social/state','/api/ai-channel/devices/example','/api/desktop/capabilities']){
  const result=await f.request(path,{headers:{'x-forwarded-for':'192.0.2.99, 203.0.113.7'}});assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.text),{ip:'203.0.113.7',peer:'127.0.0.1'});
 }
 for(const value of ['203.0.113.7, invalid','unknown','203.0.113.7,']){const result=await f.request('/api/social/state',{headers:{'x-forwarded-for':value}});assert.equal(JSON.parse(result.text).ip,'127.0.0.1');}
});

test('internal authenticated aliases use the same explicit proxy list without reopening the gate',async t=>{
 const f=await fixture(t,{internalPreview:true,trustedProxyIPs:parseTrustedProxyIPs('127.0.0.1')}),cookie=await f.login();
 for(const path of ['/api/social/state','/api/ai-channel/devices/example','/api/desktop/capabilities']){
  assert.equal((await f.request(path,{headers:{'x-forwarded-for':'203.0.113.7'}})).status,401);
  const result=await f.request(path,{headers:{Cookie:cookie,'x-forwarded-for':'203.0.113.7'}});assert.equal(result.status,200);assert.deepEqual(JSON.parse(result.text),{ip:'203.0.113.7',peer:'127.0.0.1'});
 }
});

test('an empty explicit whitelist does not implicitly trust loopback or forwarding headers',async t=>{
 const f=await fixture(t,{trustedProxyIPs:[]}),result=await f.request('/api/social/state',{headers:{'x-forwarded-for':'203.0.113.7'}});assert.equal(JSON.parse(result.text).ip,'127.0.0.1');
});
