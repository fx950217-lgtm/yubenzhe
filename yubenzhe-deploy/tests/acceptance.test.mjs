import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { passwordRecord, readAuthFile } from '../server/auth.mjs';
import { openDatabase } from '../server/sqlite-adapter.mjs';
import { createAcceptanceServer } from '../server/server.mjs';
import { setupAdmin, applyAction, getRecord } from '../upstream/admin/core.mjs';

const password='Synthetic-password-ONLY-3274!';
const auth=await passwordRecord('owner',password);
const owner={userId:auth.userId,displayName:auth.displayName};
async function fixture(role='admin', publicFrontend=false) {
 const dir=mkdtempSync(join(tmpdir(),'ybz-acceptance-'));writeFileSync(join(dir,'index.html'),'<h1>受限验收</h1>');
 const db=role==='admin'?openDatabase(join(dir,'acceptance.sqlite')):null;
 const origin='http://127.0.0.1:18809';const server=createAcceptanceServer({role,origin,publicFrontend,authConfig:auth,database:db,staticRoot:dir});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const request=(path,options={})=>new Promise((resolve,reject)=>{const req=httpRequest(base+path,{method:options.method || 'GET',headers:{Host:'127.0.0.1:18809',...options.headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const headers=new Headers();for(const [key,value] of Object.entries(res.headers)){if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value)}resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers}))})});req.on('error',reject);req.end(options.body?.toString())});
 async function login(){const result=await request('/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'owner',password})});assert.equal(result.status,303);return result.headers.get('set-cookie').split(';')[0]}
 return {dir,db,origin,request,login,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db?.close();rmSync(dir,{recursive:true,force:true})}};
}
test('no identity-header spoof, uninitialized reads stay empty, setup creates exactly 1000 synthetic users',async()=>{
 const f=await fixture();try{
  let r=await f.request('/api/admin/bootstrap',{headers:{'oai-authenticated-user-id':'spoof','oai-authenticated-user-email':'fake@example.test'}});assert.equal(r.status,401);
  const cookie=await f.login();r=await f.request('/api/admin/bootstrap',{headers:{Cookie:cookie}});let data=await r.json();assert.equal(data.initialized,false);assert.equal(data.overview.users,0);
  r=await f.request('/api/admin/setup',{method:'POST',headers:{Cookie:cookie,Origin:f.origin,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,200);
  data=await (await f.request('/api/admin/bootstrap',{headers:{Cookie:cookie}})).json();assert.equal(data.overview.users,1000);assert.equal(data.system.synthetic,true);assert.equal(data.system.consumerConnected,false);assert.equal(data.system.financialActionsEnabled,false);
  data=await (await f.request('/api/admin/records?kind=users&pageSize=20&q=user-0001',{headers:{Cookie:cookie}})).json();assert.equal(data.total,1);assert.equal(data.items[0].id,'user-0001');
 }finally{await f.close()}
});
test('mutations require same origin and reject host spoofing',async()=>{
 const f=await fixture();try{const cookie=await f.login();
  for(const Origin of [undefined,'https://attacker.example']){const headers={Cookie:cookie,'Content-Type':'application/json'};if(Origin)headers.Origin=Origin;const r=await f.request('/api/admin/setup',{method:'POST',headers,body:'{}'});assert.equal(r.status,403)}
  assert.equal((await f.request('/api/admin/bootstrap',{headers:{Cookie:cookie,Host:'attacker.example'}})).status,403);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) AS n FROM admin_records').get().n,0);
 }finally{await f.close()}
});
test('state changes persist and duplicate requests write one audit; money and role mutations denied',async()=>{
 const f=await fixture();try{await setupAdmin(f.db,owner);const cookie=await f.login(),headers={Cookie:cookie,Origin:f.origin,'Content-Type':'application/json'};
  const action={kind:'users',id:'user-0001',action:'restrict',reason:'验收核对限制测试记录',version:1,requestId:'acceptance-action-1'};
  const results=await Promise.all([1,2].map(()=>f.request('/api/admin/actions',{method:'POST',headers,body:JSON.stringify(action)})));assert.ok(results.every(r=>r.status===200));
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE request_id='acceptance-action-1'").get().n,1);
  assert.equal((await getRecord(f.db,owner,'users','user-0001')).status,'restricted');
  assert.equal((await f.request('/api/admin/actions',{method:'POST',headers,body:JSON.stringify({...action,reason:'不同理由不能重用请求'})})).status,409);
  assert.equal((await f.request('/api/admin/actions',{method:'POST',headers,body:JSON.stringify({...action,kind:'ledger',action:'withdraw'})})).status,403);
  assert.equal((await f.request('/api/admin/actions',{method:'POST',headers,body:JSON.stringify({...action,kind:'roles',action:'promote'})})).status,403);
  const reopened=openDatabase(join(f.dir,'acceptance.sqlite'));try{assert.equal((await getRecord(reopened,owner,'users','user-0001')).version,2)}finally{reopened.close()}
 }finally{await f.close()}
});
test('SQLite batch rolls back every update on SQL failure; online backup is consistent',async()=>{
 const f=await fixture();try{await setupAdmin(f.db,owner);
  await assert.rejects(f.db.batch([f.db.prepare("UPDATE admin_records SET status='restricted',version=2 WHERE kind='users' AND id='user-0001'"),f.db.prepare('INSERT INTO missing_table VALUES(1)')]));
  assert.equal((await getRecord(f.db,owner,'users','user-0001')).version,1);
  const path=join(f.dir,'backup.sqlite');await f.db.backup(path);const copy=new DatabaseSync(path,{readOnly:true});try{assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM admin_records WHERE kind='users'").get().n,1000);assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok')}finally{copy.close()}
 }finally{await f.close()}
});
test('frontend session is isolated and cannot reach admin APIs or private files',async()=>{
 const f=await fixture('frontend');try{const cookie=await f.login();assert.match(cookie,/^ybz_front_session=/);
  assert.equal((await f.request('/',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await f.request('/api/admin/bootstrap',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await f.request('/.env',{headers:{Cookie:cookie}})).status,404);
  assert.equal((await f.request('/%2e%2e%2fserver%2fstart.mjs',{headers:{Cookie:cookie}})).status,404);
 }finally{await f.close()}
});
test('authenticated frontend serves installer downloads and nested iOS instructions',async()=>{
 const f=await fixture('frontend');try{
  const installer=Buffer.from([0x4d,0x5a,0,255,1]);
  writeFileSync(join(f.dir,'yubenzhe-windows.exe'),installer);
  mkdirSync(join(f.dir,'ios-repo'));writeFileSync(join(f.dir,'ios-repo','index.html'),'<h1>iOS 源码验收说明</h1>');
  const blocked=await f.request('/yubenzhe-windows.exe');assert.match(blocked.headers.get('content-type'),/^text\/html/);assert.equal(blocked.headers.get('content-disposition'),null);
  const cookie=await f.login(),headers={Cookie:cookie};
  const download=await f.request('/yubenzhe-windows.exe',{headers});
  assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/octet-stream');assert.match(download.headers.get('content-disposition'),/^attachment; filename="yubenzhe-windows.exe"/);
  assert.equal(Number(download.headers.get('content-length')),installer.length);assert.deepEqual(Buffer.from(await download.arrayBuffer()),installer);
  const page=await f.request('/ios-repo/index.html',{headers});assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/^text\/html/);assert.match(await page.text(),/iOS 源码验收说明/);
 }finally{await f.close()}
});
test('logout revokes session; cookies are HttpOnly Strict; errors do not expose credentials',async()=>{
 const f=await fixture();try{const result=await f.request('/login',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'owner',password})});const header=result.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);const cookie=header.split(';')[0];
  await f.request('/logout',{method:'POST',headers:{Cookie:cookie,Origin:f.origin}});
  assert.equal((await f.request('/api/admin/bootstrap',{headers:{Cookie:cookie}})).status,401);
  const r=await f.request('/login',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'owner',password:'wrong-password'})});assert.equal(r.status,401);assert.ok(!(await r.text()).includes(auth.hash));
 }finally{await f.close()}
});
test('authentication config must exist, be valid and be private',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ybz-auth-'));try{assert.throws(()=>readAuthFile());const file=join(dir,'auth.json');writeFileSync(file,JSON.stringify(auth),{mode:0o600});assert.equal(readAuthFile(file).userId,'acceptance-owner');if(process.platform!=='win32'){chmodSync(file,0o644);assert.throws(()=>readAuthFile(file),/0600/)}}finally{rmSync(dir,{recursive:true,force:true})}
});
test('public frontend serves pages and downloads without granting a private identity',async()=>{
 const f=await fixture('frontend',true);try{
  const page=await f.request('/');assert.equal(page.status,200);assert.equal(await page.text(),'<h1>受限验收</h1>');
  writeFileSync(join(f.dir,'app.apk'),Buffer.from([1,2,3]));
  const download=await f.request('/app.apk');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);
   for(const path of ['/api/ai/workspaces','/api/admin/bootstrap']) assert.equal((await f.request(path)).status,path.startsWith('/api/ai/')?404:401);
  for(const path of ['/.env','/%2e%2e%2fserver%2fstart.mjs']) assert.equal((await f.request(path)).status,404);
  assert.equal((await f.request('/',{method:'POST'})).status,405);
  assert.equal((await f.request('/',{headers:{Host:'attacker.example'}})).status,403);
  assert.match(await (await f.request('/login')).text(),/name="password"/);
  assert.equal((await (await f.request('/healthz')).json()).stage,'public-preview');
 }finally{await f.close()}
});
test('public frontend flag never opens the admin role',async()=>{
 const f=await fixture('admin',true);try{
  assert.match(await (await f.request('/')).text(),/name="password"/);
  assert.equal((await f.request('/api/admin/bootstrap')).status,401);
  assert.equal((await (await f.request('/healthz')).json()).stage,'private-acceptance');
 }finally{await f.close()}
});
