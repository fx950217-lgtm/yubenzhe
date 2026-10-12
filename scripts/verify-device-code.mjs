import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openSocialDatabase} from '../yubenzhe-deploy/server/social-database.mjs';
import {createProductModules} from '../yubenzhe-deploy/server/product-modules.mjs';
import {createAcceptanceServer} from '../yubenzhe-deploy/server/server.mjs';
import {passwordRecord} from '../yubenzhe-deploy/server/auth.mjs';

// Isolated real HTTP acceptance; never reads an existing user database or credential.
// --wait-expiry observes the actual ten-minute deadline without advancing the clock.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.env.YBZ_DEVICE_ACCEPTANCE_OUTPUT||resolve(root,'../../output/ybz-device-installer-20261012'));
mkdirSync(output,{recursive:true});
const records=[], checks=[], fixtures=[];
const scrub=(key,value)=>/^(token|pollSecret|pairToken|password|authorization|cookie)$/i.test(key)?'<redacted>':value;
const save=()=>writeFileSync(resolve(output,'device-code-http-acceptance.json'),JSON.stringify({mode:'REAL LOOPBACK HTTP; SYNTHETIC ACCOUNTS; NO CLOUD OR PHYSICAL PHONE',startedAt,updatedAt:new Date().toISOString(),checks,requests:records},scrub,2));
const startedAt=new Date().toISOString();
async function fixture(label){
 const db=openSocialDatabase(':memory:');
 const modules=createProductModules({database:db,origin:'http://127.0.0.1:12345',simulation:true});
 const server=createAcceptanceServer({role:'frontend',origin:'http://127.0.0.1:12345',publicFrontend:true,authConfig:await passwordRecord('review','Synthetic-test-only-'+randomUUID()),socialService:{...modules,handle:r=>modules.handle(r)},staticRoot:resolve(root,'yubenzhe-deploy/public/frontend')});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const req=(path,input,{token,headers={}}={})=>new Promise((yes,no)=>{
  const begin=performance.now();
  const request=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method:input?'POST':'GET',headers:{Host:'127.0.0.1:12345',...(input?{'Content-Type':'application/json'}:{}),...(path.startsWith('/api/social/')?{Origin:'https://localhost'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers}},response=>{
   const chunks=[];response.on('data',x=>chunks.push(x));response.on('end',()=>{
    const raw=Buffer.concat(chunks).toString();let body;try{body=JSON.parse(raw);}catch{body={raw};}
    const result={status:response.statusCode,body,elapsedMs:Math.round(performance.now()-begin)};
    records.push({fixture:label,time:new Date().toISOString(),method:input?'POST':'GET',path,input,headers,...result});save();yes(result);
   });
  });request.on('error',no);request.end(input?JSON.stringify(input):undefined);
 });
 const register=async()=>{const r=await req('/api/social/register',{password:'492183',requestId:randomUUID()});assert.equal(r.status,200);assert.ok(r.body.token);return r.body.token;};
 const f={label,db,modules,server,req,register};fixtures.push(f);return f;
}
function passed(name,details={}){checks.push({name,status:'passed',...details});save();console.log('PASS '+name);}
try{
 const f=await fixture('pair-and-isolation'),a=await f.register(),b=await f.register();
 const created=await f.req('/api/device-bridge/claim',{action:'create',name:'机器码验收电脑',source:'local'});
 assert.equal(created.status,200);const claim=created.body;
 assert.match(claim.code,/^YBZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);assert.equal(claim.pollSecret.length,43);
 const badPoll=await f.req('/api/device-bridge/claim',{action:'poll',claimId:claim.claimId,pollSecret:'Z'.repeat(43)});assert.ok(badPoll.status>=400);
 await new Promise(r=>setTimeout(r,300)); // Respect actual failure backoff before the legitimate claim.
 const paired=await f.req('/api/social/devices/claim',{code:claim.code},{token:a});assert.equal(paired.status,200);assert.ok(paired.body.device.id);
 const deviceId=paired.body.device.id;
 const reused=await f.req('/api/social/devices/claim',{code:claim.code},{token:a});assert.ok(reused.status>=400);
 const delivered=await f.req('/api/device-bridge/claim',{action:'poll',claimId:claim.claimId,pollSecret:claim.pollSecret});assert.equal(delivered.status,200);assert.equal(delivered.body.status,'paired');assert.equal(delivered.body.deviceId,deviceId);assert.equal(delivered.body.token.length,43);
 const poll=await f.req('/api/device-bridge/poll',{status:'ready'},{token:delivered.body.token});assert.equal(poll.status,200);
 passed('computer code -> authenticated phone claim -> private computer token; code one-time');
 const cross=await f.req('/api/social/devices/'+deviceId+'/state',undefined,{token:b});assert.equal(cross.status,404);
 const own=await f.req('/api/social/devices/conversations',undefined,{token:a});assert.equal(own.status,200);assert.ok(own.body.conversations.some(x=>x.deviceId===deviceId));
 const other=await f.req('/api/social/devices/conversations',undefined,{token:b});assert.equal(other.status,200);assert.ok(!other.body.conversations.some(x=>x.deviceId===deviceId));
 const friend=f.db.raw.prepare('SELECT COUNT(*) AS n FROM friendships').get();assert.equal(friend.n,0);
 passed('device entry is owner-only and creates no friendship');
 const legacy=await f.req('/api/social/devices/pair',{name:'旧文件配对验收'},{token:a});assert.equal(legacy.status,200);
 const legacyEnroll=await f.req('/api/device-bridge/enroll',{pairToken:legacy.body.pairToken});assert.equal(legacyEnroll.status,200);
 const legacyPoll=await f.req('/api/device-bridge/poll',{status:'ready'},{token:legacyEnroll.body.token});assert.equal(legacyPoll.status,200);
 passed('old phone-generated pairing remains operational');
 const hashes=f.db.raw.prepare('SELECT id,pair_hash,token_hash FROM personal_devices ORDER BY id').all();
 assert.ok(hashes.every(x=>x.pair_hash===null&&/^[a-f0-9]{64}$/.test(x.token_hash)));
 const schema=f.db.raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND (name LIKE '%claim%' OR name='personal_devices')").all();
 const claimRows=schema.filter(x=>x.name!=='personal_devices').map(t=>({table:t.name,rows:f.db.raw.prepare('SELECT * FROM "'+t.name.replaceAll('"','""')+'"').all()}));
 const raw=JSON.stringify(claimRows);assert.ok(!raw.includes(claim.pollSecret));assert.ok(!raw.includes(claim.code));assert.ok(!raw.includes(delivered.body.token));
 writeFileSync(resolve(output,'device-code-database-hashes.json'),JSON.stringify({personalDevices:hashes,claimRows},null,2));
 passed('database query stores hashes, no plaintext code, poll secret or long-lived token');
 const rotate=await fixture('rotation'),ruser=await rotate.register();
 const c=(await rotate.req('/api/device-bridge/claim',{action:'create',name:'轮换验证',source:'server'})).body;
 const rotated=await rotate.req('/api/device-bridge/claim',{action:'rotate',claimId:c.claimId,pollSecret:c.pollSecret});assert.equal(rotated.status,200);assert.notEqual(rotated.body.code,c.code);
 assert.ok((await rotate.req('/api/social/devices/claim',{code:c.code},{token:ruser})).status>=400);
 await new Promise(r=>setTimeout(r,300));
 assert.equal((await rotate.req('/api/social/devices/claim',{code:rotated.body.code},{token:ruser})).status,200);
 passed('rotation invalidates old code immediately');
 const rate=await fixture('enumeration'),raccount=await rate.register(),bad=[];
 for(let i=0;i<6;i++)bad.push(await rate.req('/api/social/devices/claim',{code:'YBZ-2345-6789'},{token:raccount,headers:{'X-Forwarded-For':'192.0.2.'+(i+1)}}));
 assert.equal(bad[5].status,429);assert.ok(bad.slice(0,5).every(x=>x.status>=400));
 passed('sixth failed claim limited; changing forwarded header does not bypass', {sixthStatus:bad[5].status,durationsMs:bad.map(x=>x.elapsedMs)});
 const revoke=await f.req('/api/social/devices/'+deviceId+'/revoke',{}, {token:a});assert.equal(revoke.status,200);
 assert.equal((await f.req('/api/device-bridge/poll',{}, {token:delivered.body.token})).status,401);
 assert.ok(!(await f.req('/api/social/devices/conversations',undefined,{token:a})).body.conversations.some(x=>x.deviceId===deviceId));
 passed('revocation removes device conversation and rejects connector token');
 if(process.argv.includes('--wait-expiry')){
  const expiry=await fixture('real-clock-expiry'),owner=await expiry.register();
  const start=Date.now(),created=await expiry.req('/api/device-bridge/claim',{action:'create',name:'真实十分钟到期验证',source:'local'});assert.equal(created.status,200);
  assert.ok(created.body.expiresAt-start<=600100&&created.body.expiresAt-start>590000);
  console.log('WAITING real expiration at '+new Date(created.body.expiresAt).toISOString());
  await new Promise(r=>setTimeout(r,Math.max(0,created.body.expiresAt-Date.now())+150));
  const expired=await expiry.req('/api/social/devices/claim',{code:created.body.code},{token:owner});assert.ok(expired.status>=400);
  passed('actual ten-minute expiry rejected without clock substitution',{startedAt:new Date(start).toISOString(),expiresAt:new Date(created.body.expiresAt).toISOString(),observedAt:new Date().toISOString(),elapsedMs:Date.now()-start,status:expired.status});
 }else checks.push({name:'actual ten-minute expiry',status:'not-run',reason:'Run with --wait-expiry; no clock substitution is used.'});
 save();console.log('Evidence: '+resolve(output,'device-code-http-acceptance.json'));
}catch(error){checks.push({name:'acceptance error',status:'failed',message:error.message,stack:error.stack});save();console.error(error);process.exitCode=1;}
finally{for(const f of fixtures){f.server.closeAllConnections();await new Promise(r=>f.server.close(r));f.db.close();}}
