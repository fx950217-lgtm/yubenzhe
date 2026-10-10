import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {passwordRecord} from '../server/auth.mjs';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createAcceptanceServer} from '../server/server.mjs';

// A real loopback HTTP lifecycle; no external API or user database is used.
test('V0.2 web cookie reaches POINT plan, confirmation, completed output and retired routes',async t=>{
 const origin='http://localhost:18999',db=openSocialDatabase(':memory:');let now=Date.UTC(2026,9,10);
 const product=createProductModules({database:db,origin,simulation:true,now:()=>now});
 const authConfig=await passwordRecord('fixture','Synthetic-v02-HTTP-fixture-only!');
 const server=createAcceptanceServer({role:'frontend',origin,publicFrontend:true,authConfig,socialService:product,staticRoot:process.cwd()});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));db.close();});
 const call=(path,{method='GET',cookie='',input,originHeader=origin}={})=>new Promise((done,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/api/social/'+path,method,headers:{Host:'localhost:18999',Connection:'close',Origin:originHeader,...(cookie?{Cookie:cookie}:{}),...(input?{'Content-Type':'application/json'}:{})}},res=>{
   const data=[];res.on('data',v=>data.push(v));res.on('error',reject);res.on('end',()=>{try{const body=Buffer.concat(data).toString();done({status:res.statusCode,headers:res.headers,body:JSON.parse(body)});}catch(e){reject(e);}});
  });req.on('error',reject);req.setTimeout(5000,()=>req.destroy(Error('Local HTTP timed out')));req.end(input?JSON.stringify(input):undefined);
 });
 const post=(path,cookie,input={})=>call(path,{method:'POST',cookie,input:{requestId:randomUUID(),...input}});
 const register=async()=>{const r=await post('register','',{password:'472815'});assert.equal(r.status,200);assert.equal(r.body.token,undefined);assert.match(r.headers['set-cookie'][0],/Path=\/api\/social;/);return r.headers['set-cookie'][0].split(';')[0];};
 assert.equal((await call('points/account')).status,401);
 const cookie=await register(),other=await register();
 assert.equal((await call('points/account',{cookie})).body.available,'1000');
 assert.equal((await call('points/account',{cookie})).body.available,'1000');
 for(const path of ['assets/status','gifts','access/funds/activate']){
  const retired=await post(path,cookie);assert.equal(retired.status,410);assert.equal(retired.body.code,'PLATFORM_ASSETS_REMOVED');
 }
 for(const path of ['points/transfer','points/withdraw','points/reward','points/asset-exchange'])assert.equal((await post(path,cookie,{amount:'10'})).status,403);
 assert.equal((await post('point-campaigns/create',cookie)).status,503);
 assert.equal((await call('points/account',{cookie})).body.available,'1000');
 const planned=await post('workbench/plan',cookie,{goal:'准备一份产品发布工作清单',fileIds:[],budgetPoints:'100'});
 assert.equal(planned.status,200,JSON.stringify(planned.body));let task=planned.body.task;
 assert.equal(task.billingUnit,'POINT');assert.equal((await call('points/account',{cookie})).body.reserved,'0');
 const path='workbench/tasks/'+task.id+'/confirm',input={requestId:randomUUID(),version:task.version,planVersion:task.planVersion,pointsPriceVersion:task.pointsPriceVersion,budgetPoints:'100',acceptPoints:true};
 assert.equal((await call(path,{method:'POST',cookie,input,originHeader:'https://outside.example'})).status,403);
 const confirmed=await post(path,cookie,input);assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
 assert.deepEqual((await post(path,cookie,input)).body,confirmed.body);
 assert.equal((await call('points/account',{cookie})).body.available,'900');
 for(let i=0;i<4;i++){now+=1000;await product.tick();}
 const finished=await call('workbench/tasks/'+task.id,{cookie});assert.equal(finished.status,200);task=finished.body.task;
 assert.equal(task.status,'succeeded');assert.equal(task.spentPoints,'30');assert.equal(task.releasedPoints,'70');
 const account=await call('points/account',{cookie});assert.equal(account.body.available,'970');assert.equal(account.body.reserved,'0');
 const output=task.outputs[0];assert.ok(output?.id);
 assert.equal((await call('workbench/files/'+output.id+'/details',{cookie})).status,200);
 assert.equal((await call('workbench/files/'+output.id+'/details',{cookie:other})).status,404);
 const ledger=await call('points/ledger',{cookie});assert.equal(ledger.status,200);assert.ok(ledger.body.entries.some(row=>row.reason==='service-consume'&&row.delta==='-30'));
 const first=ledger.body.entries[0].id;const page=await call('points/ledger?cursor='+first,{cookie});assert.equal(page.status,200);assert.ok(!page.body.entries.some(row=>row.id===first));
 assert.equal((await call('points/ledger?cursor='+first,{cookie:other})).status,400);
 assert.equal((await call('points/account',{cookie:other})).body.available,'1000');
});
