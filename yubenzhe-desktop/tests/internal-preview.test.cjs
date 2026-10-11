'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createInternalPreview,validateRequest,pathAllowed}=require('../src/internal-preview.cjs');
const response=(status,body='',headers={})=>new Response(body,{status,headers});
test('native transport rejects path aliases, arbitrary hosts, non-JSON writes and injected headers',()=>{
 for(const path of ['https://evil.test/api/social/me','//evil.test/api/social/me','/api/social/../admin','/api/social/%2e%2e/admin','/api/social/a//b','/api/admin/users','/api/social/me#x','/api/social/me\\x'])assert.equal(pathAllowed(path,'GET'),false,path);
 assert.equal(pathAllowed('/api/social/conversations/abc/messages?after=0','GET'),true);
 assert.throws(()=>validateRequest({path:'/api/social/me',method:'POST',body:'{}',headers:{'content-type':'text/plain'}}));
 assert.throws(()=>validateRequest({path:'/api/social/me',headers:{Cookie:'stolen'}}));
 assert.throws(()=>validateRequest({path:'/api/social/me',headers:{Authorization:'Bearer x\r\nInjected: yes'}}));
 assert.equal(pathAllowed('/api/chain-preview/config','POST'),false);
});
test('outer login stays in native memory, social retains native Origin, config uses server Origin',async()=>{
 const calls=[];const client=createInternalPreview({fetcher:async(url,init)=>{calls.push({url,init});if(url.endsWith('/login'))return response(303,'',{location:'/', 'set-cookie':'ybz_front_session=opaque; Path=/; HttpOnly; Secure'});return response(200,'{"ok":true}',{'content-type':'application/json','set-cookie':'ybz_social=product; Path=/api/social; HttpOnly','etag':'"a"'});}});
 assert.deepEqual(await client.status(),{authenticated:false});
 const denied=await client.request({path:'/api/social/me'});assert.equal(denied.status,401);assert.equal(calls.length,0);
 assert.deepEqual(await client.login({username:'internal-tester',password:'synthetic-only'}),{authenticated:true});
 const result=await client.request({path:'/api/social/me',method:'GET'});
 assert.equal(calls[0].init.headers.Origin,'https://66.42.56.29');assert.equal(calls[1].init.headers.Origin,'yubenzhe://app');assert.equal(calls[1].init.headers.Cookie,'ybz_front_session=opaque');
 assert.equal(Object.keys(result.headers).includes('set-cookie'),false);assert.equal(JSON.stringify(result).includes('opaque'),false);
 await client.request({path:'/api/chain-preview/config',method:'GET'});assert.equal(calls[2].init.headers.Origin,'https://66.42.56.29');
 client.clear();assert.equal((await client.status()).authenticated,false);
});
test('redirects never forward credentials to another host; gate expiry clears memory',async()=>{
 let mode='login';const client=createInternalPreview({fetcher:async(url,init)=>{assert.equal(init.redirect,'manual');if(mode==='login')return response(303,'',{location:'/', 'set-cookie':'ybz_front_session=opaque; Path=/'});if(mode==='redirect')return response(302,'',{location:'https://evil.test'});return response(401,'{"code":"INTERNAL_PREVIEW_REQUIRED"}',{'content-type':'application/json'});}});
 await client.login({username:'qa',password:'synthetic-only'});mode='redirect';await assert.rejects(client.request({path:'/api/social/me'}),/跳转/);mode='expired';assert.equal((await client.request({path:'/api/social/me'})).status,401);assert.equal((await client.status()).authenticated,false);
});
test('signout during an in-flight request prevents stale authentication resurrection',async()=>{
 let resolveCall;const client=createInternalPreview({fetcher:async(url)=>url.endsWith('/login')?response(303,'',{location:'/', 'set-cookie':'ybz_front_session=opaque; Path=/'}):await new Promise(r=>resolveCall=r)});
 await client.login({username:'qa',password:'synthetic-only'});const pending=client.request({path:'/api/social/me'});await new Promise(r=>setImmediate(r));client.clear();resolveCall(response(200,'{}',{'set-cookie':'ybz_front_session=old; Path=/'}));await assert.rejects(pending,/访问凭证/);assert.equal((await client.status()).authenticated,false);
});

test('product logout cannot be undone by a late product cookie; identity stays in Bearer token',async()=>{
 let finish;const calls=[];const client=createInternalPreview({fetcher:async(url,init)=>{calls.push(init.headers);if(url.endsWith('/login'))return response(303,'',{location:'/', 'set-cookie':'ybz_front_session=gate; Path=/'});if(url.endsWith('/password'))return new Promise(r=>finish=r);if(url.endsWith('/logout'))return response(200,'{}',{'set-cookie':'ybz_social=; Max-Age=0'});return response(200,'{}');}});
 await client.login({username:'qa',password:'synthetic'});const pending=client.request({path:'/api/social/password',method:'POST',body:'{}',headers:{'content-type':'application/json',authorization:'Bearer old'}});await new Promise(r=>setImmediate(r));await client.request({path:'/api/social/logout',method:'POST',body:'{}',headers:{'content-type':'application/json',authorization:'Bearer old'}});finish(response(200,'{}',{'set-cookie':'ybz_social=late; Path=/api/social'}));await pending;await client.request({path:'/api/social/me'});assert.equal(calls.at(-1).Cookie,'ybz_front_session=gate');assert.equal(calls.at(-1).authorization,undefined);
});
