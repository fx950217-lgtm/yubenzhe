
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';
import {createAcceptanceServer} from '../server/server.mjs';
import {passwordRecord} from '../server/auth.mjs';
test('public connector endpoint accepts scoped device tokens while product, admin and browser access stay gated',async t=>{
 const db=openSocialDatabase(':memory:');
 const modules=createProductModules({database:db,origin:'http://127.0.0.1:12345',simulation:true});
 const account=await modules.handle({method:'POST',path:'register',input:{password:'492183',requestId:randomUUID()},ip:'127.0.0.1'});
 const pair=modules.handle({method:'POST',path:'devices/pair',token:account.token,input:{name:'Scoped connector'}});
 const server=createAcceptanceServer({role:'frontend',origin:'https://preview.example.test',internalPreview:true,authConfig:await passwordRecord('preview','Synthetic-only-long-password-728361'),socialService:{devices:modules.devices,handle:r=>modules.handle(r)},staticRoot:fileURLToPath(new URL('../public/frontend',import.meta.url))});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();});
 const req=(path,input,headers={})=>new Promise((resolve,reject)=>{const r=httpRequest({host:'127.0.0.1',port:server.address().port,path,method:input?'POST':'GET',headers:{Host:'preview.example.test',...(input?{'Content-Type':'application/json'}:{}),...headers}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});r.on('error',reject);r.end(input?JSON.stringify(input):undefined);});
 assert.equal((await req('/api/social/devices')).status,401);
 assert.equal((await req('/api/device-bridge/enroll',{pairToken:pair.pairToken},{Origin:'https://preview.example.test'})).status,403);
 assert.equal((await req('/api/device-bridge/enroll',{pairToken:'invalid'})).status,401);
 const enrolled=await req('/api/device-bridge/enroll',{pairToken:pair.pairToken});assert.equal(enrolled.status,200);const token=JSON.parse(enrolled.body).token;
 assert.equal((await req('/api/device-bridge/poll',{}, {Authorization:'Bearer '+token})).status,200);
 for(const path of ['/api/social/devices','/api/social/ai/chat','/api/admin/product/accounts'])assert.equal((await req(path,null,{Authorization:'Bearer '+token})).status,401);
 assert.equal((await req('/api/device-bridge/poll',{})).status,401);
 assert.equal((await req('/api/device-bridge/poll',{}, {Authorization:'Bearer '+token,Origin:'https://evil.invalid'})).status,403);
});
