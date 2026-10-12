import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {DEVICE_CLAIM_LIMITS} from '../server/device-claims.mjs';

const is=(status,code)=>e=>e.status===status&&(!code||e.code===code);
const digest=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
 const db=openSocialDatabase(':memory:');t.after(()=>db.close());let now=1800000000000;
 const m=createProductModules({database:db,origin:'http://127.0.0.1:12345',simulation:true,now:()=>now});
 const call=(token,method,path,input={},ip='192.0.2.20')=>m.handle({token,method,path,input,ip});
 const a=await call(null,'POST','register',{password:'429173',requestId:randomUUID()}),b=await call(null,'POST','register',{password:'637291',requestId:randomUUID()});
 const machine=(input,ip='192.0.2.10')=>m.devices.claimMachine(input,ip);
 const create=(extra={},ip)=>machine({action:'create',name:'Synthetic office PC',source:'local',...extra},ip);
 const claim=(p,who=a,extra={},ip)=>call(who.token,'POST','devices/claim',{code:p.code,...extra},ip);
 const poll=p=>machine({action:'poll',claimId:p.claimId,pollSecret:p.pollSecret});
 return {db,m,a,b,call,machine,create,claim,poll,advance:ms=>now+=ms,now:()=>now};
}

test('computer code is readable, hash-only and ownerless until a signed-in account redeems it',async t=>{
 const f=await fixture(t),p=f.create();assert.match(p.code,/^YBZ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);assert.equal(p.expiresAt-f.now(),600000);assert.match(p.pollSecret,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(f.db.raw.prepare('SELECT count(*) n FROM personal_devices').get().n,0);const pending=f.db.raw.prepare('SELECT * FROM device_pair_claims').get();assert.equal(pending.pair_hash,digest(p.code));assert.equal(pending.poll_hash,digest(p.pollSecret));assert.equal(JSON.stringify(pending).includes(p.code),false);assert.equal(JSON.stringify(pending).includes(p.pollSecret),false);
 assert.throws(()=>f.call(null,'POST','devices/claim',{code:p.code}),is(401));assert.equal(f.poll(p).status,'pending');
 const {device}=f.claim(p);assert.equal(device.paired,false);assert.equal(device.awaitingConnection,true);assert.equal(device.screenOnline,false);assert.equal(device.source,'local');assert.equal(f.call(f.b.token,'GET','devices').devices.length,0);
 const bound=f.db.raw.prepare('SELECT * FROM device_pair_claims').get();assert.equal(bound.pair_hash,null);assert.equal(bound.device_id,device.id);
 const enrolled=f.poll(p);assert.equal(enrolled.status,'paired');assert.equal(enrolled.deviceId,device.id);assert.equal(enrolled.token.length,43);assert.deepEqual(f.poll(p),enrolled);
 const stored=f.db.raw.prepare('SELECT * FROM personal_devices WHERE id=?').get(device.id);assert.equal(stored.token_hash,digest(enrolled.token));assert.equal(stored.pair_hash,null);assert.equal(JSON.stringify(stored).includes(enrolled.token),false);
 assert.equal(f.m.devices.authenticateAgent(enrolled.token).id,device.id);assert.equal(f.call(f.a.token,'GET','devices').devices[0].paired,true);
});

test('short code or product session cannot collect PC credentials; poll needs the independent high-entropy secret',async t=>{
 const f=await fixture(t),p=f.create();f.claim(p);
 for(const candidate of [p.code,f.a.token,randomBytes(32).toString('base64url')]){f.advance(5000);assert.throws(()=>f.machine({action:'poll',claimId:p.claimId,pollSecret:candidate},'192.0.2.30'),is(401));}
 const owner=f.call(f.a.token,'GET','devices');assert.equal(JSON.stringify(owner).includes(p.pollSecret),false);assert.equal(JSON.stringify(owner).includes('poll_hash'),false);assert.equal(f.poll(p).status,'paired');
});

test('code is one-use across two accounts and concurrent redemption only creates one owner',async t=>{
 const f=await fixture(t),p=f.create();const results=await Promise.allSettled([Promise.resolve().then(()=>f.claim(p)),Promise.resolve().then(()=>f.claim(p,f.b,{},'192.0.2.21'))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='PAIR_EXPIRED').length,1);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM personal_devices').get().n,1);
 f.advance(5000);assert.throws(()=>f.claim(p),is(401,'PAIR_EXPIRED'));assert.equal(f.poll(p).deviceId,results[0].value.device.id);
});

test('expiry is inclusive at exactly ten minutes and rotating invalidates the old code immediately',async t=>{
 const f=await fixture(t),p=f.create();f.advance(599999);assert.equal(f.poll(p).status,'pending');f.advance(1);assert.throws(()=>f.claim(p),is(401,'PAIR_EXPIRED'));
 const q=f.create({},'192.0.2.11'),rotated=f.machine({action:'rotate',claimId:q.claimId,pollSecret:q.pollSecret},'192.0.2.11');assert.notEqual(rotated.code,q.code);assert.equal(rotated.claimId,q.claimId);assert.equal(rotated.pollSecret,undefined);
 assert.throws(()=>f.claim(q,f.b,{},'192.0.2.22'),is(401));f.advance(5000);f.claim({...q,code:rotated.code},f.b,{},'192.0.2.22');assert.equal(f.poll(q).status,'paired');assert.throws(()=>f.machine({action:'rotate',claimId:q.claimId,pollSecret:q.pollSecret},'192.0.2.11'),is(409,'DEVICE_ALREADY_CLAIMED'));
});

test('poll delivery expires without invalidating an already installed device token',async t=>{
 const f=await fixture(t),p=f.create();f.claim(p);const device=f.poll(p);f.advance(600000);assert.throws(()=>f.poll(p),is(401));assert.equal(f.m.devices.authenticateAgent(device.token).id,device.deviceId);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM device_pair_claims').get().n,0);
});

test('wrong attempts persist count and cooldown; sixth same-IP or same-account attempt is rate-limited',async t=>{
 const f=await fixture(t);assert.throws(()=>f.claim({code:'YBZ-ZZZZ-ZZZZ'}),is(401));assert.throws(()=>f.claim({code:'YBZ-ZZZZ-ZZZZ'}),is(429,'PAIR_RETRY_LATER'));
 for(let n=0;n<3;n++){f.advance(5000);assert.throws(()=>f.claim({code:'YBZ-ZZZZ-ZZZZ'}),is(401));}
 f.advance(5000);assert.throws(()=>f.claim({code:'YBZ-ZZZZ-ZZZZ'}),is(429,'PAIR_RATE_LIMIT'));
 const rates=f.db.raw.prepare('SELECT * FROM device_pair_rates').all();assert.ok(rates.every(r=>/^[a-f0-9]{64}$/.test(r.bucket_hash)));assert.ok(rates.every(r=>r.attempts===6));assert.ok(rates.every(r=>r.failures>=1));
 f.advance(60000);for(let n=0;n<5;n++){f.advance(5000);assert.throws(()=>f.claim({code:'YBZ-ZZZZ-ZZZZ'},f.a,{},'198.51.100.'+(n+1)),is(401));}f.advance(5000);assert.throws(()=>f.claim({code:'YBZ-ZZZZ-ZZZZ'},f.a,{},'203.0.113.99'),is(429,'PAIR_RATE_LIMIT'));
});

test('anonymous machine generation is five per minute per socket IP and owner injection is rejected',async t=>{
 const f=await fixture(t);for(let n=0;n<5;n++)f.create();assert.throws(()=>f.create(),is(429,'PAIR_RATE_LIMIT'));f.advance(60000);assert.equal(f.create().code.startsWith('YBZ-'),true);
 assert.throws(()=>f.create({ownerId:f.m.social.authenticate(f.b.token).id},'192.0.2.77'),is(400));assert.equal(f.db.raw.prepare('SELECT count(*) n FROM personal_devices').get().n,0);
});

test('pending claims and rate buckets have hard global bounds and fail closed',async t=>{
 const f=await fixture(t);const insert=f.db.raw.prepare('INSERT INTO device_pair_claims(id,pair_hash,poll_hash,name,source,created_at,pair_expires) VALUES(?,?,?,?,?,?,?)');f.db.raw.exec('BEGIN');for(let n=0;n<DEVICE_CLAIM_LIMITS.pending;n++)insert.run(randomUUID(),digest('code'+n),digest('poll'+n),'Synthetic','local',f.now(),f.now()+600000);f.db.raw.exec('COMMIT');assert.throws(()=>f.create(),is(429,'PAIR_CAPACITY'));assert.equal(f.db.raw.prepare('SELECT count(*) n FROM device_pair_claims').get().n,1000);
 f.db.raw.exec('DELETE FROM device_pair_rates');const bucket=f.db.raw.prepare('INSERT INTO device_pair_rates(bucket_hash,started_at,attempts) VALUES(?,?,1)');f.db.raw.exec('BEGIN');for(let n=0;n<DEVICE_CLAIM_LIMITS.rateBuckets;n++)bucket.run(digest('bucket'+n),f.now());f.db.raw.exec('COMMIT');assert.throws(()=>f.create(),is(429,'PAIR_RATE_LIMIT'));assert.equal(f.db.raw.prepare('SELECT count(*) n FROM device_pair_rates').get().n,2048);
});

test('the existing five-device limit includes new codes and legacy pairing, without consuming a refused code',async t=>{
 const f=await fixture(t);for(let n=0;n<5;n++){const legacy=f.call(f.a.token,'POST','devices/pair',{name:'Existing PC '+n});f.m.devices.enroll({pairToken:legacy.pairToken});}
 const p=f.create();assert.throws(()=>f.claim(p),is(429,'DEVICE_LIMIT'));assert.equal(f.db.raw.prepare('SELECT device_id FROM device_pair_claims WHERE id=?').get(p.claimId).device_id,null);f.claim(p,f.b,{},'192.0.2.21');assert.equal(f.poll(p).status,'paired');
});

test('revocation, owner deletion and account restrictions prevent pending credential delivery',async t=>{
 const f=await fixture(t),p=f.create(),{device}=f.claim(p);f.call(f.a.token,'POST','devices/'+device.id+'/revoke');assert.throws(()=>f.poll(p),is(401));
 const q=f.create({},'192.0.2.11');f.claim(q,f.b,{},'192.0.2.22');f.db.raw.prepare('UPDATE accounts SET deleted_at=? WHERE id=?').run(f.now(),f.m.social.authenticate(f.b.token).id);assert.throws(()=>f.poll(q),is(401));
 const s=f.create({},'192.0.2.12');f.claim(s);f.db.raw.prepare("INSERT INTO account_restrictions(account_id,state,reason,updated_at) VALUES(?,'suspended','synthetic review',?)").run(f.m.social.authenticate(f.a.token).id,f.now());assert.throws(()=>f.poll(s),is(401));assert.throws(()=>f.call(f.a.token,'GET','devices/conversations'),is(403));
});

test('paired devices create owner-only message entries, never social friends, group members or shareable conversations',async t=>{
 const f=await fixture(t),p=f.create(),{device}=f.claim(p);f.poll(p);const entries=f.call(f.a.token,'GET','devices/conversations').conversations;assert.equal(entries.length,1);assert.equal(entries[0].id,'device:'+device.id);assert.equal(entries[0].kind,'device');assert.equal(entries[0].aiOnline,false);assert.equal(entries[0].route,'#workbench/devices/'+device.id+'/chat');assert.deepEqual(f.call(f.b.token,'GET','devices/conversations').conversations,[]);
 assert.throws(()=>f.call(f.b.token,'GET','devices/'+device.id+'/state'),is(404));assert.throws(()=>f.call(f.b.token,'GET','ai-channel/devices/'+device.id),is(404));
 assert.equal(f.db.raw.prepare('SELECT count(*) n FROM conversations').get().n,0);f.call(f.a.token,'POST','devices/'+device.id+'/revoke');assert.deepEqual(f.call(f.a.token,'GET','devices/conversations').conversations,[]);
});

test('legacy file pairing still enrolls and keeps unknown capabilities until real connector reports',async t=>{
 const f=await fixture(t),p=f.call(f.a.token,'POST','devices/pair',{name:'Legacy PC'}),agent=f.m.devices.enroll({pairToken:p.pairToken});const device=f.call(f.a.token,'GET','devices').devices[0];assert.equal(device.source,'local');assert.equal(device.capabilities.screen.state,'unknown');assert.throws(()=>f.m.devices.enroll({pairToken:p.pairToken}),is(401));assert.equal(f.m.devices.poll(agent.token,{}).sessionId,null);assert.ok(f.call(f.a.token,'POST','devices/'+device.id+'/start').device.sessionId);
});

test('capability reports retain source without assuming that Windows Server is headless',async t=>{
 const f=await fixture(t),p=f.create({source:'server',capabilities:{screen:{state:'supported',reason:'Interactive session detected'},headless:false}});const {device}=f.claim(p),agent=f.poll(p);f.m.devices.poll(agent.token,{status:'ready'});let state=f.call(f.a.token,'GET','devices/'+device.id+'/state').device;assert.equal(state.source,'server');assert.equal(state.capabilities.headless,false);assert.ok(f.call(f.a.token,'POST','devices/'+device.id+'/start').device.sessionId);
 f.m.devices.poll(agent.token,{capabilities:{screen:{state:'unsupported',reason:'没有可用的交互桌面'},headless:true},status:'screen-unavailable'});state=f.call(f.a.token,'GET','devices/'+device.id+'/state').device;assert.equal(state.capabilities.headless,true);assert.throws(()=>f.call(f.a.token,'POST','devices/'+device.id+'/start'),is(409,'DEVICE_SCREEN_UNAVAILABLE'));
 assert.throws(()=>f.m.devices.poll(agent.token,{capabilities:{screen:{state:'supported',command:'whoami'}}}),is(400));assert.equal(f.call(f.a.token,'GET','devices/'+device.id+'/state').device.capabilities.screen.state,'unsupported');
});

test('AI heartbeat adds capability metadata and known unsupported AI/files are refused without granting broader rights',async t=>{
 const f=await fixture(t),p=f.create();const {device}=f.claim(p),agent=f.poll(p),status={code:'ready',workspaceLabel:'Workspace',provider:'Codex',source:'cloud',capabilities:{ai:{state:'unsupported',reason:'Codex 未安装'},files:{state:'unsupported',reason:'目录不可写'}}};f.m.aiChannel.poll(agent.token,{connectorId:randomUUID(),status});const state=f.call(f.a.token,'GET','ai-channel/devices/'+device.id).device;assert.equal(state.source,'cloud');assert.equal(state.capabilities.ai.state,'unsupported');assert.throws(()=>f.call(f.a.token,'POST','ai-channel/send',{deviceId:device.id,requestId:randomUUID(),prompt:'test'}),is(409,'AI_NOT_READY'));assert.throws(()=>f.m.aiChannel.authorizeOwner(f.a.token,device.id),is(409,'AI_FILES_UNAVAILABLE'));assert.throws(()=>f.m.aiChannel.authorizeOwner(f.b.token,device.id),is(404));
});

test('AI-only devices are online in the unified list but cannot borrow AI liveness to start screen control',async t=>{
 const f=await fixture(t),p=f.create();const {device}=f.claim(p),agent=f.poll(p);f.m.aiChannel.poll(agent.token,{connectorId:randomUUID(),status:{code:'ready',workspaceLabel:'Workspace',provider:'Codex'}});
 const card=f.call(f.a.token,'GET','devices').devices[0];assert.equal(card.online,true);assert.equal(card.awaitingConnection,false);assert.equal(card.screenOnline,false);assert.equal(card.lastSeen,f.now());assert.equal(card.screenLastSeen,null);assert.throws(()=>f.call(f.a.token,'POST','devices/'+device.id+'/start'),is(409,'DEVICE_OFFLINE'));
 const task=f.call(f.a.token,'POST','ai-channel/send',{deviceId:device.id,requestId:randomUUID(),prompt:'test'});assert.equal(task.task.status,'queued');
 f.m.devices.poll(agent.token,{status:'ready'});const active=f.call(f.a.token,'POST','devices/'+device.id+'/start').device;assert.ok(active.sessionId);
 const stopped=f.m.devices.poll(agent.token,{capabilities:{screen:{state:'unsupported',reason:'交互桌面已退出'}}});assert.equal(stopped.sessionId,null);assert.equal(f.call(f.a.token,'GET','devices/'+device.id+'/state').device.sessionId,null);
});

test('metadata never enables attachments on an explicitly unavailable file channel, while text tasks still work',async t=>{
 const f=await fixture(t),p=f.create();const {device}=f.claim(p),agent=f.poll(p);f.m.aiChannel.poll(agent.token,{connectorId:randomUUID(),status:{code:'ready',workspaceLabel:'Workspace',provider:'Codex',capabilities:{ai:{state:'supported',reason:''},files:{state:'unsupported',reason:'文件目录不可写'}}}});
 assert.throws(()=>f.call(f.a.token,'POST','ai-channel/send',{deviceId:device.id,requestId:randomUUID(),prompt:'with file',attachments:[randomUUID()]}),is(409,'AI_FILES_UNAVAILABLE'));assert.equal(f.call(f.a.token,'POST','ai-channel/send',{deviceId:device.id,requestId:randomUUID(),prompt:'text only'}).task.status,'queued');
});
