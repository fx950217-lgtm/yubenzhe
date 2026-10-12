import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createAcceptanceServer} from '../server/server.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {openSocialDatabase} from '../server/social-database.mjs';
import {passwordRecord} from '../server/auth.mjs';
import {parseTrustedProxyIPs,requestClientIP} from '../server/request-client-ip.mjs';

const origin='https://public.example.test';
const auth=await passwordRecord('unused-reviewer','Synthetic-proxy-device-test-password-123');
async function fixture(t,{trustedProxyIPs=parseTrustedProxyIPs('127.0.0.1')}={}){
 const database=openSocialDatabase(':memory:');let now=Date.now();
 const modules=createProductModules({database,origin,publicFrontend:true,publicPasswordRegistration:true,now:()=>now});
 const owners=await Promise.all(Array.from({length:2},(_,i)=>modules.handle({method:'POST',path:'register',input:{password:'Synthetic-owner-'+i+'-password',requestId:randomUUID()},ip:'seed-account-'+i})));
 const server=createAcceptanceServer({role:'frontend',origin,publicFrontend:true,trustedProxyIPs,authConfig:auth,staticRoot:fileURLToPath(new URL('../public/frontend',import.meta.url)),socialService:{devices:modules.devices,handle:request=>modules.handle(request)}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));database.close();});
 const request=(route,input,{ip,token,headers={}}={})=>new Promise((resolve,reject)=>{
  const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:route,method:'POST',headers:{Host:'public.example.test','Content-Type':'application/json',...(route.startsWith('/api/social/')?{Origin:origin}:{}),...(ip===undefined?{}:{'X-Forwarded-For':ip}),...(token?{Authorization:'Bearer '+token}:{}),...headers}},res=>{
   const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));
  });req.on('error',reject);req.end(JSON.stringify(input));
 });
 const create=(ip,headers)=>request('/api/device-bridge/claim',{action:'create',name:'Synthetic device',source:'local'},{ip,headers});
 const claim=(code,owner,ip)=>request('/api/social/devices/claim',{code},{token:owner.token,ip});
 return {database,owners,create,claim,request,advance:ms=>{now+=ms;}};
}

test('trusted proxy preserves two public client IP buckets for both computer-code creation and phone claim',async t=>{
 const f=await fixture(t),ips=['192.0.2.31','198.51.100.41'],codes=[[],[]];
 // Ten HTTP requests share one physical socket address but not one client bucket.
 for(let round=0;round<5;round++)for(let i=0;i<2;i++){
  const result=await f.create('203.0.113.99, '+ips[i]);assert.equal(result.status,200);codes[i].push(result.body.code);
 }
 for(const ip of ips){const result=await f.create(ip);assert.equal(result.status,429);assert.equal(result.body.code,'PAIR_RATE_LIMIT');}
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM device_pair_claims').get().n,10);
 f.advance(61000);
 for(let round=0;round<5;round++)for(let i=0;i<2;i++){
  const result=await f.claim(codes[i][round],f.owners[i],ips[i]);assert.equal(result.status,200);assert.equal(result.body.device.paired,false);
 }
 const ownership=f.database.raw.prepare('SELECT owner_id,count(*) n FROM personal_devices GROUP BY owner_id').all();
 assert.deepEqual(ownership.map(row=>row.n),[5,5]);
 const rates=f.database.raw.prepare('SELECT attempts FROM device_pair_rates').all();assert.equal(rates.length,4);assert.ok(rates.every(row=>row.attempts===5));
});

test('untrusted peers cannot rotate forwarding headers to bypass machine-code rate limiting',async t=>{
 const f=await fixture(t,{trustedProxyIPs:parseTrustedProxyIPs('172.19.0.1')});
 for(let i=0;i<5;i++)assert.equal((await f.create('198.51.100.'+(i+1),{'X-Real-IP':'192.0.2.'+(i+1),Forwarded:'for=203.0.113.'+(i+1)})).status,200);
 const blocked=await f.create('198.51.100.99');assert.equal(blocked.status,429);assert.equal(blocked.body.code,'PAIR_RATE_LIMIT');
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM device_pair_rates').get().n,1);
});

test('trusted missing or malformed final forwarding hop falls back to the socket without trusting earlier hops',async t=>{
 const f=await fixture(t);
 for(const ip of [undefined,'unknown','192.0.2.2, invalid','192.0.2.2,',''])assert.equal((await f.create(ip)).status,200);
 assert.equal((await f.create('different-invalid-value')).status,429);
 assert.equal((await f.create('203.0.113.88')).status,200);
 assert.equal(f.database.raw.prepare('SELECT count(*) n FROM device_pair_rates').get().n,2);
});

test('an explicitly empty proxy allowlist never trusts forwarded machine-code addresses',async t=>{
 const f=await fixture(t,{trustedProxyIPs:[]});
 for(let i=0;i<5;i++)assert.equal((await f.create('203.0.113.'+(i+1))).status,200);
 assert.equal((await f.create('198.51.100.20')).status,429);
});

test('phone claims from untrusted peers share the real IP bucket even across different accounts',async t=>{
 const f=await fixture(t,{trustedProxyIPs:[]});const codes=[];
 for(let i=0;i<5;i++)codes.push((await f.create()).body.code);f.advance(61000);
 for(let i=0;i<5;i++)assert.equal((await f.claim(codes[i],f.owners[i%2],'198.51.100.'+(i+1))).status,200);
 const blocked=await f.claim('YBZ-ZZZZ-ZZZZ',f.owners[1],'198.51.100.99');assert.equal(blocked.status,429);assert.equal(blocked.body.code,'PAIR_RATE_LIMIT');
});

test('code creation and redemption still count together for the same real client IP',async t=>{
 const f=await fixture(t),ip='192.0.2.8';
 for(let i=0;i<2;i++){const created=await f.create(ip);assert.equal(created.status,200);assert.equal((await f.claim(created.body.code,f.owners[i],ip)).status,200);}
 const last=await f.create(ip);assert.equal(last.status,200);
 const blocked=await f.claim(last.body.code,f.owners[0],ip);assert.equal(blocked.status,429);
 f.advance(61000);assert.equal((await f.claim(last.body.code,f.owners[0],ip)).status,200);
});

test('IP normalization retains exact trust matching and never promotes external callers to loopback',()=>{
 const req=(peer,forwarded)=>({socket:{remoteAddress:peer},headers:{'x-forwarded-for':forwarded}});
 const trusted=parseTrustedProxyIPs('172.19.0.1,::1');
 assert.equal(requestClientIP(req('::ffff:172.19.0.1','198.51.100.10, ::ffff:203.0.113.8'),trusted),'203.0.113.8');
 assert.equal(requestClientIP(req('203.0.113.8','127.0.0.1'),trusted),'203.0.113.8');
 assert.equal(requestClientIP(req('172.19.0.10','127.0.0.1'),trusted),'172.19.0.10');
 assert.equal(requestClientIP(req('::1','2001:db8::7'),trusted),'2001:db8::7');
 assert.equal(requestClientIP(req('::1','invalid'),trusted),'::1');
 assert.equal(requestClientIP(req(undefined,'127.0.0.1'),trusted),'unknown');
});
