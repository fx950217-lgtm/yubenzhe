import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialClient } from '../src/social-client.js';
const BASE='https://social.test.invalid',TOKEN='a'.repeat(43),NEXT_TOKEN='b'.repeat(43),TOKEN_KEY='yubenzhe.account.session.v1',PROFILE_KEY='tongban.profile.v1';
const A={userId:'427918',nickname:'测试甲',bio:'',avatar:'🌱',avatarImage:'',level:1,official:false,identityScope:'server',revision:1};
const B={...A,userId:'528194',nickname:'测试乙'};
const ID='dfe561c3-f19e-493a-b057-8883207045d6',OTHER_ID='ea074541-7f1f-47ee-89e0-b0d29b0c2a78';
const snapshot=(profile=A)=>({profile:{...profile},friends:[],requests:[],outgoingRequests:[],conversations:[]});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const clone=value=>JSON.parse(JSON.stringify(value));
function response(value={}, {status=200,etag='',json,blob}={}){return {status,ok:status>=200&&status<300,headers:{get:key=>key.toLowerCase()==='etag'?etag:null},json:json??(async()=>clone(value)),blob:blob??(async()=>new Blob(['public-test-pixels'],{type:'image/png'}))};}
function storage(){const data=new Map();return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};}
function harness(handler,{native=true,store=storage()}={}){
 const calls=[],changes=[];const fetcher=async(url,options)=>{const path=url.slice((BASE+'/api/social/').length);calls.push({url,path,...options,input:options.body?JSON.parse(options.body):undefined});return handler(path,options,calls);};
 const client=createSocialClient({baseURL:BASE,native,storage:store,fetcher,onChange:profile=>changes.push(profile)});return {client,calls,changes,store};
}
function blobURLs(t){let count=0;const created=[],revoked=[];t.mock.method(URL,'createObjectURL',()=>{const url='blob:synthetic/'+(++count);created.push(url);return url;});t.mock.method(URL,'revokeObjectURL',url=>revoked.push(url));return {created,revoked};}

 test('ETag 304 reuses an isolated cache and successful writes invalidate it',async()=>{
  let read=0;const h=harness((path,options)=>{if(options.method==='POST')return response({ok:true});read++;return read===2?response({}, {status:304}):response(snapshot(),{etag:'"state-'+read+'"'});});
  const first=await h.client.getState();first.profile.nickname='caller mutation';first.friends.push({userId:'bad'});
  const second=await h.client.getState();assert.equal(second.profile.nickname,A.nickname);assert.deepEqual(second.friends,[]);assert.equal(h.calls[1].headers['If-None-Match'],'"state-1"');assert.equal(h.client.getProfile().nickname,A.nickname);
  const own=h.client.getProfile();own.nickname='another mutation';assert.equal(h.client.getProfile().nickname,A.nickname);
  await h.client.markRead(ID);await h.client.getState();assert.equal(h.calls.at(-1).headers['If-None-Match'],undefined);h.client.dispose();
 });

 test('a 304 without a cached body is rejected rather than treated as an account error',async()=>{
  const h=harness(()=>response({}, {status:304}));await assert.rejects(h.client.getState(),{code:'CACHE_MISSING'});assert.equal(h.changes.length,0);h.client.dispose();
 });

 test('BAD_PASSWORD preserves the account while ACCOUNT_REQUIRED removes token, profile and caches',async t=>{
  const urls=blobURLs(t);let required=false;
  const h=harness(path=>{if(path==='login')return response({profile:A,token:TOKEN});if(path==='password')return response({error:'当前密码不正确',code:'BAD_PASSWORD'},{status:401});if(path==='state')return required?response({code:'ACCOUNT_REQUIRED',error:'重新登录'},{status:401}):response(snapshot(),{etag:'"a"'});if(path.endsWith('/messages'))return response({messages:[{id:'1',image:{id:ID,src:'https://ignored.invalid/private'}}]});if(path==='media/'+ID)return response();throw Error(path);});
  await h.client.login(A.userId,'482615');await h.client.getMessages(ID);assert.equal(urls.created.length,1);
  await assert.rejects(h.client.changePassword('000000','735194'),{code:'BAD_PASSWORD'});assert.equal(h.client.getProfile().userId,A.userId);assert.equal(h.store.getItem(TOKEN_KEY),TOKEN);
  required=true;await assert.rejects(h.client.getState(),{code:'ACCOUNT_REQUIRED'});assert.equal(h.client.getProfile(),null);assert.equal(h.store.getItem(TOKEN_KEY),null);assert.equal(h.store.getItem(PROFILE_KEY),null);assert.deepEqual(urls.revoked,urls.created);assert.equal(h.changes.at(-1),null);
  await assert.rejects(h.client.getState(),{code:'ACCOUNT_REQUIRED'});assert.equal(h.calls.at(-1).headers.Authorization,undefined);h.client.dispose();
 });

 test('late old-account error JSON cannot log out a newly accepted account',async()=>{
  const body=deferred(),started=deferred();const h=harness(path=>path==='login'?response({profile:B,token:NEXT_TOKEN}):response({}, {status:401,json:()=>{started.resolve();return body.promise;}}));
  const old=assert.rejects(h.client.getState(),{code:'SESSION_CHANGED'});await started.promise;await h.client.login(B.userId,'735194');body.resolve({code:'ACCOUNT_REQUIRED',error:'old token expired'});await old;
  assert.equal(h.client.getProfile().userId,B.userId);assert.equal(h.store.getItem(TOKEN_KEY),NEXT_TOKEN);assert.equal(h.changes.includes(null),false);h.client.dispose();
 });

 test('late successful JSON, out-of-order reads and reads predating a write cannot overwrite current state',async()=>{
  for(const change of ['account','newer-read','write']){
   const body=deferred(),started=deferred();let reads=0;const h=harness((path,options)=>{
    if(path==='login')return response({profile:B,token:NEXT_TOKEN});if(options.method==='POST')return response({ok:true});
    reads++;return reads===1?response({}, {json:()=>{started.resolve();return body.promise;}}):response(snapshot({...A,revision:2}));
   });
   const old=assert.rejects(h.client.getState(),{code:change==='account'?'SESSION_CHANGED':'STALE_RESPONSE'});await started.promise;
   if(change==='account')await h.client.login(B.userId,'735194');else if(change==='newer-read')await h.client.getState();else await h.client.markRead(ID);
   body.resolve(snapshot(A));await old;if(change==='account')assert.equal(h.client.getProfile().userId,B.userId);else if(change==='newer-read')assert.equal(h.client.getProfile().revision,2);h.client.dispose();
  }
 });

 test('native avatar paths become same-service URLs while web paths and private media remain separate',async()=>{
  const avatar='/api/social/avatars/'+ID,remote={...snapshot(),friends:[{...B,avatarImage:avatar}],conversations:[{members:[{...B,avatarImage:avatar}],lastMessage:{image:{src:'/api/social/media/'+OTHER_ID}}}]};
  for(const native of [true,false]){const h=harness(()=>response(remote),{native});const value=await h.client.getState();assert.equal(value.friends[0].avatarImage,native?BASE+avatar:avatar);assert.equal(value.conversations[0].members[0].avatarImage,native?BASE+avatar:avatar);assert.equal(value.conversations[0].lastMessage.image.src,'/api/social/media/'+OTHER_ID);assert.equal(h.calls[0].credentials,native?'omit':'same-origin');h.client.dispose();}
 });

 test('group creation keeps a canonical request ID after uncertain failures and clears it after success/account change',async()=>{
  let calls=0;const h=harness(path=>{if(path==='groups'){calls++;if(calls===1)throw Error('connection lost after acceptance');return response({conversationId:ID});}if(path==='login')return response({profile:B,token:NEXT_TOKEN});throw Error(path);});
  const input={name:' 同组 ',memberIds:['631927','528194']};await assert.rejects(h.client.createGroup(input),{code:'NETWORK_ERROR'});
  await h.client.createGroup({name:'同组',memberIds:['528194','631927','631927']});let groups=h.calls.filter(row=>row.path==='groups');assert.equal(groups[0].input.requestId,groups[1].input.requestId);
  await h.client.createGroup(input);groups=h.calls.filter(row=>row.path==='groups');assert.notEqual(groups[1].input.requestId,groups[2].input.requestId);
  await h.client.login(B.userId,'735194');await h.client.createGroup(input);assert.notEqual(h.calls.at(-1).input.requestId,groups[2].input.requestId);h.client.dispose();
 });

 test('private images use authenticated fixed paths, deduplicate blob reads, and revoke URLs on logout/dispose',async t=>{
  const urls=blobURLs(t);let mediaReads=0;const store=storage();store.setItem(TOKEN_KEY,TOKEN);
  const h=harness(path=>{if(path.startsWith('conversations/'))return response({messages:[{id:'1',image:{id:ID,src:'https://attacker.invalid/collect'}}]},{etag:'"messages"'});if(path==='media/'+ID){mediaReads++;return response();}if(path==='logout')return response({ok:true});throw Error(path);},{store});
  const first=await h.client.getMessages(ID),second=await h.client.getMessages(ID);assert.equal(mediaReads,1);assert.equal(first.messages[0].image.src,second.messages[0].image.src);assert.match(first.messages[0].image.src,/^blob:/);
  const mediaCall=h.calls.find(row=>row.path==='media/'+ID);assert.equal(mediaCall.url,BASE+'/api/social/media/'+ID);assert.equal(mediaCall.headers.Authorization,'Bearer '+TOKEN);assert.equal(h.calls.some(row=>row.url.includes('attacker')),false);
  await h.client.logout();assert.deepEqual(urls.revoked,urls.created);assert.equal(store.getItem(TOKEN_KEY),null);h.client.dispose();assert.equal(urls.revoked.length,1);await assert.rejects(h.client.getMessages(ID),{code:'SESSION_CHANGED'});
 });

 test('changing account during blob decoding cannot return old messages or delete a new pending blob',async t=>{
  const urls=blobURLs(t),oldBlob=deferred(),newBlob=deferred(),oldStarted=deferred(),newStarted=deferred();let mediaReads=0;
  const h=harness(path=>{if(path==='login')return response({profile:B,token:NEXT_TOKEN});if(path.startsWith('conversations/'))return response({messages:[{id:'1',text:'private',image:{id:ID}}]});if(path==='media/'+ID){mediaReads++;return response({}, {blob:()=>{(mediaReads===1?oldStarted:newStarted).resolve();return mediaReads===1?oldBlob.promise:newBlob.promise;}});}throw Error(path);});
  const old=assert.rejects(h.client.getMessages(ID),{code:'SESSION_CHANGED'});await oldStarted.promise;await h.client.login(B.userId,'735194');const next=h.client.getMessages(ID);await newStarted.promise;
  oldBlob.resolve(new Blob(['old'],{type:'image/png'}));await old;assert.equal(urls.created.length,0);
  // A third read must share the new account's pending blob even after the old
  // load's finally block completes.
  const third=h.client.getMessages(ID);await new Promise(resolve=>setImmediate(resolve));assert.equal(mediaReads,2);
  newBlob.resolve(new Blob(['new'],{type:'image/png'}));const [one,two]=await Promise.all([next,third]);assert.equal(one.messages[0].image.src,two.messages[0].image.src);assert.equal(urls.created.length,1);h.client.dispose();assert.deepEqual(urls.revoked,urls.created);
 });

 test('sendMessage also rejects account changes during private image hydration',async t=>{
  blobURLs(t);const body=deferred(),started=deferred();const h=harness(path=>{if(path==='login')return response({profile:B,token:NEXT_TOKEN});if(path==='media/'+ID)return response({}, {blob:()=>{started.resolve();return body.promise;}});return response({message:{id:'1',image:{id:ID}}});});
  const old=assert.rejects(h.client.sendMessage(ID,{type:'image'}),{code:'SESSION_CHANGED'});await started.promise;await h.client.login(B.userId,'735194');body.resolve(new Blob(['old'],{type:'image/png'}));await old;h.client.dispose();
 });

 test('oversized or unsupported private images are reported per message and never become blob URLs',async t=>{
  const urls=blobURLs(t);for(const blob of [new Blob(['html'],{type:'text/html'}),new Blob([new Uint8Array(512*1024+1)],{type:'image/png'})]){const h=harness(path=>path.startsWith('media/')?response({}, {blob:async()=>blob}):response({messages:[{id:'1',image:{id:ID}}]}));const result=await h.client.getMessages(ID);assert.equal(result.messages[0].image,null);assert.match(result.messages[0].mediaError,/无效/);h.client.dispose();}assert.equal(urls.created.length,0);
 });

 test('storage read/write/remove failures are visible without dropping a valid online account',async()=>{
  const store=storage();store.getItem=()=>{throw Error('blocked');};store.setItem=()=>{throw Error('quota');};store.removeItem=()=>{throw Error('blocked');};
  const h=harness(path=>path==='login'?response({profile:A,token:TOKEN}):response({ok:true}),{store});assert.match(h.client.getStorageWarning(),/读取/);await h.client.login(A.userId,'482615');assert.equal(h.client.getProfile().userId,A.userId);assert.match(h.client.getStorageWarning(),/保留登录状态/);
  await h.client.logout();assert.equal(h.client.getProfile(),null);assert.match(h.client.getStorageWarning(),/缓存未能清理/);h.client.dispose();
  const partial=storage();const original=partial.setItem;partial.setItem=(key,value)=>{if(key===PROFILE_KEY)throw Error('quota');original(key,value);};const other=harness(()=>response({profile:A,token:TOKEN}),{store:partial});await other.client.login(A.userId,'482615');assert.match(other.client.getStorageWarning(),/缓存个人资料/);assert.equal(partial.getItem(TOKEN_KEY),TOKEN);other.client.dispose();
 });

 test('expired initialize returns null, malformed profiles cannot replace current data, and tokens are scoped by client mode',async()=>{
  const expired=harness(()=>response({code:'ACCOUNT_REQUIRED'},{status:401}));assert.equal(await expired.client.initialize(),null);expired.client.dispose();
  let bad=false;const h=harness(path=>path==='login'?response({profile:A,token:TOKEN}):response({profile:bad?{...A,official:'yes'}:A}));await h.client.login(A.userId,'482615');bad=true;await assert.rejects(h.client.initialize());assert.equal(h.client.getProfile().official,false);h.client.dispose();
  const store=storage();store.setItem(TOKEN_KEY,TOKEN);const web=harness(()=>response({profile:A}),{native:false,store});await web.client.initialize();assert.equal(web.calls[0].headers.Authorization,undefined);web.client.dispose();
 });
