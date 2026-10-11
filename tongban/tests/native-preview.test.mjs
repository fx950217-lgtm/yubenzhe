import test from 'node:test';import assert from 'node:assert/strict';
import {createNativePreviewFetch,nativePreviewPath,nativePreviewBridge} from '../src/native-preview.js';
const payload=(body,status=200,headers={'content-type':'application/json'})=>({status,headers,bodyBase64:Buffer.from(body).toString('base64')});
test('only fixed product APIs use native preview; RPCs and local assets use original fetch',async()=>{
 let bridgeCalls=[],direct=[];const f=createNativePreviewFetch({bridge:{request:async x=>{bridgeCalls.push(x);return payload('{"ok":true}');}},fetcher:async(...args)=>{direct.push(args);return new Response('asset');}});
 assert.equal((await(await f('https://66.42.56.29/api/social/me')).json()).ok,true);
 await f('/api/chain-preview/config');await f('https://bsc-testnet.bnbchain.org',{method:'POST',body:'rpc'});await f('./privacy.html');
 assert.equal(bridgeCalls.length,2);assert.equal(direct.length,2);assert.equal(bridgeCalls[1].path,'/api/chain-preview/config');
 for(const x of ['/api/social/../admin','/api/social/%2e%2e/admin','https://evil.test/api/social/me','/api/social/a//b','/api/social/me#secret'])assert.equal(nativePreviewPath(x),null);
});
test('binary product files and 304 responses preserve content without exposing cookies',async()=>{
 const data=Buffer.from([0,255,128,5]);const f=createNativePreviewFetch({bridge:{request:async x=>x.path.endsWith('me')?payload('',304,{}):{status:200,headers:{'content-type':'application/octet-stream'},bodyBase64:data.toString('base64')}}});
 assert.deepEqual(Buffer.from(await(await f('/api/social/files/id')).arrayBuffer()),data);assert.equal((await f('/api/social/me')).status,304);
});
test('expired gate triggers re-auth, but product account failures do not erase outer access',async()=>{
 let required=0,code='ACCOUNT_REQUIRED';const f=createNativePreviewFetch({bridge:{request:async()=>payload(JSON.stringify({code}),401)},onRequired:()=>required++});
 await f('/api/social/me');assert.equal(required,0);code='INTERNAL_PREVIEW_REQUIRED';await f('/api/social/me');assert.equal(required,1);
});
test('aborted user actions do not start a native request and late replies stay aborted',async()=>{
 let calls=0,finish;const f=createNativePreviewFetch({bridge:{request:()=>{calls++;return new Promise(r=>finish=r);}}});const first=new AbortController();first.abort();await assert.rejects(f('/api/social/me',{signal:first.signal}),{name:'AbortError'});assert.equal(calls,0);
 const second=new AbortController(),p=f('/api/social/me',{signal:second.signal});await Promise.resolve();second.abort();await assert.rejects(p,{name:'AbortError'});finish(payload('{}'));assert.equal(calls,1);
});
test('bridges do not activate on normal browsers or unsupported platforms',()=>{assert.equal(nativePreviewBridge({}),null);assert.equal(nativePreviewBridge({YubenzheNative:{platform:'ios'}}),null);const bridge={status(){}};assert.equal(nativePreviewBridge({YubenzheDesktop:{platform:'windows',internalPreview:bridge}}),bridge);});
