import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { openSocialDatabase } from '../server/social-database.mjs';
import { createSocialService } from '../server/social-service.mjs';
import { imageData } from '../server/social-validation.mjs';

// Synthetic accounts and PINs are isolated in temporary test databases.
const PIN = '482615', NEXT_PIN = '735194';
function png(red) {
  const crc = data => { let n=0xffffffff; for(const value of data){n^=value;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0; };
  const chunk = (name, data) => { const type=Buffer.from(name), head=Buffer.alloc(4), tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([head,type,data,tail]); };
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,red,100,200,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const IMAGE=png(64), OTHER_IMAGE=png(192);
const expected = (status,code) => error => error.status === status && error.code === code;
function harness(filename=':memory:') {
  let time=1700000000000;
  const database=openSocialDatabase(filename),service=createSocialService({database,now:()=>time});
  const call=(actor,method,path,input={},query={})=>service.handle({method,path,input,query,token:actor?.token??'',ip:'synthetic-client'});
  const register=(overrides={})=>call(null,'POST','register',{password:PIN,requestId:randomUUID(),...overrides});
  const update=(actor,changes={})=>call(actor,'POST','profile',{nickname:actor.profile.nickname,bio:actor.profile.bio,avatar:actor.profile.avatar,avatarImage:actor.profile.avatarImage,userId:actor.profile.userId,revision:actor.profile.revision,...changes});
  const befriend=async(a,b)=>{const request=await call(a,'POST','friends/request',{userId:b.profile.userId});const accepted=await call(b,'POST','friends/respond',{requestId:request.requestId,accept:true});return accepted.conversationId;};
  const send=(a,id,text,clientId=randomUUID())=>call(a,'POST','conversations/'+id+'/messages',{clientId,type:'text',text});
  const messages=(a,id,query={})=>call(a,'GET','conversations/'+id+'/messages',{},query);
  return {database,service,call,register,update,befriend,send,messages,tick:ms=>time+=ms,close:()=>database.close()};
}

 test('register/login uses independent stable accounts, random IDs and hashed credentials', async t=>{
  const h=harness();t.after(h.close);const requestId=randomUUID(),a=await h.register({requestId}),b=await h.register(),c=await h.register();
  assert.equal(new Set([a.profile.userId,b.profile.userId,c.profile.userId]).size,3);
  assert.match(a.profile.userId,/^\d{6,16}$/);assert.equal(a.profile.level,1);assert.equal(a.profile.official,false);
  assert.equal((await h.register({requestId})).profile.userId,a.profile.userId);
  await assert.rejects(h.register({requestId,password:'735194'}),expected(409,'REGISTRATION_CONFLICT'));
  await assert.rejects(h.register({password:'abcdef'}),expected(400,'INVALID_PASSWORD'));
  await assert.rejects(h.register({official:true}),expected(400,'INVALID_FIELDS'));
  const login=await h.call(null,'POST','login',{userId:a.profile.userId,password:PIN});
  assert.equal(h.service.authenticate(login.token).user_id,a.profile.userId);
  const raw=h.database.raw.prepare('SELECT * FROM accounts WHERE user_id=?').get(a.profile.userId);
  assert.match(raw.password_hash,/^[a-f0-9]{64}$/);assert.notEqual(raw.password_hash,PIN);
  assert.equal(h.database.raw.prepare('SELECT token_hash FROM social_sessions LIMIT 1').get().token_hash.includes(a.token),false);
  await assert.rejects(h.call(null,'GET','state'),expected(401,'ACCOUNT_REQUIRED'));
  await h.call(a,'POST','logout');await assert.rejects(h.call(a,'GET','me'),expected(401,'ACCOUNT_REQUIRED'));
});

 test('PIN guessing limits both login and idempotent registration and expires at the configured window',async t=>{
  const h=harness();t.after(h.close);const requestId=randomUUID(),a=await h.register({requestId});
  for(let i=0;i<8;i++)await assert.rejects(h.call(null,'POST','login',{userId:a.profile.userId,password:'000000'}),expected(401,'BAD_CREDENTIALS'));
  await assert.rejects(h.call(null,'POST','login',{userId:a.profile.userId,password:PIN}),expected(429,'RATE_LIMITED'));
  await assert.rejects(h.register({requestId}),expected(429,'RATE_LIMITED'));
  h.tick(900001);assert.equal((await h.call(null,'POST','login',{userId:a.profile.userId,password:PIN})).profile.userId,a.profile.userId);
});

 test('profile ID changes require password/revision, reserve nice IDs, prevent reuse and preserve friendships',async t=>{
  const h=harness();t.after(h.close);let a=await h.register();const b=await h.register(),c=await h.register(),id=await h.befriend(a,b),oldId=a.profile.userId;
  await assert.rejects(h.update(a,{userId:'888888',currentPassword:PIN}),expected(409,'ID_RESERVED'));
  await assert.rejects(h.update(a,{userId:'123456',currentPassword:PIN}),expected(409,'ID_RESERVED'));
  await assert.rejects(h.update(a,{userId:'4279',currentPassword:PIN}),expected(400,'INVALID_ID'));
  await assert.rejects(h.update(a,{userId:'427918',currentPassword:'000000'}),expected(401,'BAD_PASSWORD'));
  await assert.rejects(h.update(a,{revision:0}),expected(409,'PROFILE_CHANGED'));
  await assert.rejects(h.update(a,{official:true}),expected(400,'INVALID_FIELDS'));
  const updated=await h.update(a,{userId:'427918',currentPassword:PIN,nickname:'已改名',bio:'服务器档案',avatarImage:IMAGE});
  assert.equal(updated.profile.revision,2);a={...a,profile:updated.profile};
  assert.equal((await h.call(b,'GET','state')).friends[0].userId,'427918');
  await h.send(a,id,'身份仍然有效');assert.equal((await h.messages(b,id)).messages[0].senderId,'427918');
  await assert.rejects(h.update(c,{userId:'427918',currentPassword:PIN}),expected(409,'ID_TAKEN'));
  await assert.rejects(h.update(c,{userId:oldId,currentPassword:PIN}),expected(409,'ID_TAKEN'));
  await assert.rejects(h.call(null,'POST','login',{userId:oldId,password:PIN}),expected(401,'BAD_CREDENTIALS'));
  assert.equal((await h.call(null,'POST','login',{userId:'427918',password:PIN})).profile.nickname,'已改名');
  await assert.rejects(h.update(a,{avatarImage:'data:image/svg+xml;base64,PHN2Zz4='}),expected(400,'INVALID_IMAGE'));
});

 test('friend requests are bilateral, idempotent and isolated from third parties',async t=>{
  const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();
  const request=await h.call(a,'POST','friends/request',{userId:b.profile.userId});
  assert.equal((await h.call(a,'POST','friends/request',{userId:b.profile.userId})).requestId,request.requestId);
  assert.equal((await h.call(b,'GET','state')).requests[0].from.userId,a.profile.userId);
  assert.equal((await h.call(c,'GET','state')).requests.length,0);
  await assert.rejects(h.call(c,'POST','friends/respond',{requestId:request.requestId,accept:true}),expected(404,'REQUEST_NOT_FOUND'));
  await assert.rejects(h.call(a,'POST','friends/respond',{requestId:request.requestId,accept:true}),expected(404,'REQUEST_NOT_FOUND'));
  await assert.rejects(h.call(b,'POST','friends/request',{userId:a.profile.userId}),expected(409,'INCOMING_REQUEST'));
  const accepted=await h.call(b,'POST','friends/respond',{requestId:request.requestId,accept:true});
  assert.equal((await h.call(a,'GET','state')).friends.length,1);assert.equal((await h.call(b,'GET','state')).friends.length,1);
  assert.equal((await h.call(b,'POST','friends/respond',{requestId:request.requestId,accept:true})).conversationId,accepted.conversationId);
  await assert.rejects(h.messages(c,accepted.conversationId),expected(404,'CHAT_NOT_FOUND'));
  await assert.rejects(h.call(a,'POST','friends/request',{userId:a.profile.userId}),expected(400,'SELF_FRIEND'));
  await h.call(a,'POST','friends/remove',{userId:b.profile.userId});
  await assert.rejects(h.send(a,accepted.conversationId,'关系解除后不能继续发送'),expected(403,'FRIEND_REQUIRED'));
  assert.equal((await h.call(b,'GET','state')).friends.length,0);
  const rejected=await h.call(c,'POST','friends/request',{userId:b.profile.userId});
  await h.call(b,'POST','friends/respond',{requestId:rejected.requestId,accept:false});
  await assert.rejects(h.call(b,'POST','friends/respond',{requestId:rejected.requestId,accept:true}),expected(409,'REQUEST_HANDLED'));
});

 test('group ownership, invitations, removal, transfer and leaving enforce membership',async t=>{
  const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();
  await h.befriend(a,b);
  await assert.rejects(h.call(a,'POST','groups',{requestId:randomUUID(),name:'小组',memberIds:[b.profile.userId,c.profile.userId]}),expected(403,'FRIEND_REQUIRED'));
  await h.befriend(a,c);const {conversationId:id}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'小组',memberIds:[b.profile.userId,c.profile.userId]});
  await assert.rejects(h.call(b,'POST','conversations/'+id+'/settings',{name:'越权改名'}),expected(403,'MANAGER_REQUIRED'));
  await assert.rejects(h.call(b,'POST','conversations/'+id+'/remove-member',{userId:c.profile.userId}),expected(403,'MANAGER_REQUIRED'));
  await assert.rejects(h.call(a,'POST','conversations/'+id+'/leave'),expected(409,'TRANSFER_OWNER'));
  await h.call(a,'POST','conversations/'+id+'/remove-member',{userId:c.profile.userId});
  await assert.rejects(h.messages(c,id),expected(404,'CHAT_NOT_FOUND'));
  await assert.rejects(h.send(c,id,'已移除成员'),expected(404,'CHAT_NOT_FOUND'));
  await assert.rejects(h.call(b,'POST','conversations/'+id+'/invite',{memberIds:[c.profile.userId]}),expected(403,'FRIEND_REQUIRED'));
  await h.call(a,'POST','conversations/'+id+'/invite',{memberIds:[c.profile.userId]});
  await h.call(a,'POST','conversations/'+id+'/owner',{userId:b.profile.userId});
  await assert.rejects(h.call(a,'POST','conversations/'+id+'/settings',{note:'旧群主越权'}),expected(403,'MANAGER_REQUIRED'));
  await h.call(a,'POST','conversations/'+id+'/leave');
  assert.equal((await h.call(a,'GET','state')).conversations.some(row=>row.id===id),false);
  await h.call(b,'POST','conversations/'+id+'/settings',{name:'新群名',note:'群公告',pinned:true,muted:true});
  const state=await h.call(b,'GET','state'),group=state.conversations.find(row=>row.id===id);
  assert.equal(group.ownerId,b.profile.userId);assert.equal(group.name,'新群名');assert.equal(group.pinned,true);assert.equal(group.muted,true);
});

 test('new and rejoined group members cannot read messages or media from before their admission',async t=>{
  const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);
  const {conversationId:id}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'历史隔离',memberIds:[b.profile.userId,c.profile.userId]});
  const initialMembership=(await h.call(c,'GET','state')).conversations.find(row=>row.id===id).membershipRevision;
  const early=await h.send(a,id,'退出前消息');
  await h.call(a,'POST','conversations/'+id+'/remove-member',{userId:c.profile.userId});
  await h.send(a,id,'退出期间消息');
  const picture=await h.call(a,'POST','conversations/'+id+'/messages',{clientId:randomUUID(),type:'image',image:{src:IMAGE,name:'真实一像素.png'}});
  await h.call(a,'POST','conversations/'+id+'/invite',{memberIds:[c.profile.userId]});
  assert.deepEqual((await h.messages(c,id)).messages,[]);
  const rejoined=(await h.call(c,'GET','state')).conversations.find(row=>row.id===id);
  assert.equal(rejoined.lastMessage,null);assert.notEqual(rejoined.membershipRevision,initialMembership);assert.ok(rejoined.historyStartId>=early.message.id);
  await assert.rejects(h.call(c,'GET','media/'+picture.message.image.id),error=>[403,404].includes(error.status));
  const fresh=await h.send(b,id,'重新加入后的消息');
  assert.deepEqual((await h.messages(c,id)).messages.map(row=>row.id),[fresh.message.id]);
  assert.equal((await h.messages(a,id)).messages.some(row=>row.id===early.message.id),true);
});

 test('messages/media are scoped, content-idempotent, paginated and marked read per member',async t=>{
  const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register(),id=await h.befriend(a,b),other=await h.befriend(a,c);
  const clientId=randomUUID(),first=await h.send(a,id,'第一条',clientId);
  assert.equal((await h.send(a,id,'第一条',clientId)).message.id,first.message.id);
  await assert.rejects(h.send(a,id,'篡改内容',clientId),expected(409,'MESSAGE_CONFLICT'));
  await assert.rejects(h.send(a,other,'第一条',clientId),expected(409,'MESSAGE_CONFLICT'));
  for(let i=0;i<54;i++)await h.send(a,id,'分页 '+i);
  const page=await h.messages(b,id);assert.equal(page.messages.length,50);assert.ok(page.nextBefore);
  const previous=await h.messages(b,id,{before:page.nextBefore});assert.equal(previous.messages.length,5);assert.equal(previous.nextBefore,null);
  assert.equal(new Set([...page.messages,...previous.messages].map(row=>row.id)).size,55);
  await assert.rejects(h.messages(b,id,{before:'NaN'}),expected(400,'INVALID_CURSOR'));
  const pictureId=randomUUID(),pictureInput={clientId:pictureId,type:'image',image:{src:IMAGE,name:'一像素.png'}};
  const picture=await h.call(a,'POST','conversations/'+id+'/messages',pictureInput);
  assert.equal((await h.call(a,'POST','conversations/'+id+'/messages',pictureInput)).message.id,picture.message.id);
  await assert.rejects(h.call(a,'POST','conversations/'+id+'/messages',{...pictureInput,image:{...pictureInput.image,src:OTHER_IMAGE}}),expected(409,'MESSAGE_CONFLICT'));
  const media=await h.call(b,'GET','media/'+picture.message.image.id);assert.equal(media.mime,'image/png');assert.equal(Buffer.from(media.binary).equals(imageData(IMAGE).bytes),true);
  await assert.rejects(h.call(c,'GET','media/'+picture.message.image.id),expected(404,'CHAT_NOT_FOUND'));
  assert.equal((await h.call(b,'GET','state')).conversations.find(row=>row.id===id).unread,56);
  await h.call(b,'POST','conversations/'+id+'/read');assert.equal((await h.call(b,'GET','state')).conversations.find(row=>row.id===id).unread,0);
  assert.equal(h.database.raw.prepare('SELECT count(*) n FROM social_media').get().n,1);
  await assert.rejects(h.call(a,'POST','conversations/'+id+'/messages',{clientId:randomUUID(),type:'image',image:{src:'https://outside.invalid/picture.png'}}),expected(400,'INVALID_IMAGE'));
});

 test('password change revokes old sessions and rejects asynchronous logins verified against stale hashes',async t=>{
  const h=harness();t.after(h.close);const a=await h.register(),oldLogin=await h.call(null,'POST','login',{userId:a.profile.userId,password:PIN});
  await assert.rejects(h.call(a,'POST','password',{currentPassword:'000000',newPassword:NEXT_PIN}),expected(401,'BAD_PASSWORD'));
  const changed=await h.call(a,'POST','password',{currentPassword:PIN,newPassword:NEXT_PIN});
  await assert.rejects(h.call(a,'GET','me'),expected(401,'ACCOUNT_REQUIRED'));await assert.rejects(h.call(oldLogin,'GET','me'),expected(401,'ACCOUNT_REQUIRED'));
  assert.equal((await h.call(changed,'GET','me')).profile.userId,a.profile.userId);
  await assert.rejects(h.call(null,'POST','login',{userId:a.profile.userId,password:PIN}),expected(401,'BAD_CREDENTIALS'));
  // Deterministically model a second connection committing a password rotation
  // while the current scrypt verification is pending; no fake crypto is used.
  const pending=h.call(null,'POST','login',{userId:a.profile.userId,password:NEXT_PIN});
  h.database.raw.prepare('UPDATE accounts SET password_hash=? WHERE user_id=?').run('ab'.repeat(32),a.profile.userId);
  await assert.rejects(pending,error=>[401,409].includes(error.status));
});

 test('registration retries also reject stale password snapshots and retain the latest capped session',async t=>{
  const h=harness();t.after(h.close);const requestId=randomUUID(),a=await h.register({requestId});
  const pending=h.register({requestId});
  h.database.raw.prepare('UPDATE accounts SET password_hash=? WHERE user_id=?').run('ab'.repeat(32),a.profile.userId);
  await assert.rejects(pending,error=>[401,409].includes(error.status));
  const second=await h.register();let latest=second;
  for(let i=0;i<12;i++)latest=await h.call(null,'POST','login',{userId:second.profile.userId,password:PIN});
  assert.equal(h.service.authenticate(latest.token).user_id,second.profile.userId);
  assert.equal(h.database.raw.prepare('SELECT count(*) n FROM social_sessions WHERE account_id=(SELECT id FROM accounts WHERE user_id=?)').get(second.profile.userId).n,10);
});

 test('accounts, friendship, messages, session revocation and rate limits survive restart in an isolated database',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'yubenzhe-social-test-')),filename=join(directory,'social.sqlite');let h;
  try{
   h=harness(filename);const a=await h.register(),b=await h.register(),c=await h.register(),id=await h.befriend(a,b);
   await h.send(a,id,'持久消息');await h.befriend(a,c);const groupInput={requestId:randomUUID(),name:'持久幂等群',memberIds:[b.profile.userId,c.profile.userId]},group=await h.call(a,'POST','groups',groupInput);const changed=await h.call(a,'POST','password',{currentPassword:PIN,newPassword:NEXT_PIN});
   for(let i=0;i<8;i++)await assert.rejects(h.call(null,'POST','login',{userId:c.profile.userId,password:'000000'}),expected(401,'BAD_CREDENTIALS'));
   h.close();h=harness(filename);
   assert.equal((await h.call(changed,'GET','state')).friends.some(row=>row.userId===b.profile.userId),true);
   assert.equal((await h.call(changed,'POST','groups',groupInput)).conversationId,group.conversationId);
   assert.equal((await h.messages(b,id)).messages[0].text,'持久消息');
   await assert.rejects(h.call(a,'GET','me'),expected(401,'ACCOUNT_REQUIRED'));
   await assert.rejects(h.call(null,'POST','login',{userId:c.profile.userId,password:PIN}),expected(429,'RATE_LIMITED'));
   assert.equal(h.database.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   h.tick(30*86400000+1);await assert.rejects(h.call(changed,'GET','me'),expected(401,'ACCOUNT_REQUIRED'));
  }finally{h?.close();const safe=resolve(directory);if(!basename(safe).startsWith('yubenzhe-social-test-')||resolve(join(safe,'..'))!==resolve(tmpdir()))throw new Error('Unexpected cleanup path');await rm(safe,{recursive:true,force:true});}
});


test('malformed JSON field types are validation errors and invalid updates leave no partial records',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);
 for(const requestId of [undefined,{},[],true])await assert.rejects(h.call(a,'POST','friends/respond',{requestId,accept:true}),error=>error.status===400);
 for(const userId of [{toString:null},{},[],427918])await assert.rejects(h.call(a,'GET','lookup',{}, {userId}),error=>error.status===400);
 const {conversationId:id}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'原群名',memberIds:[b.profile.userId,c.profile.userId]});
 await assert.rejects(h.call(a,'POST','conversations/'+id+'/settings',{name:'应当回滚',pinned:'true'}),expected(400,'INVALID_SETTING'));
 assert.equal((await h.call(a,'GET','state')).conversations.find(row=>row.id===id).name,'原群名');
 for(const source of ['data:image/png;base64,'+Buffer.alloc(20).toString('base64'),'data:image/png;base64,notbase64','data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='])assert.throws(()=>imageData(source),expected(400,'INVALID_IMAGE'));
 const overflow=Buffer.from(IMAGE.split(',')[1],'base64');overflow.writeUInt32BE(9000,16);assert.throws(()=>imageData('data:image/png;base64,'+overflow.toString('base64')),expected(400,'INVALID_IMAGE'));
 assert.equal(h.database.raw.prepare('SELECT count(*) n FROM social_media').get().n,0);
});

test('group member capacity checks also protect invited accounts',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);
 const {conversationId:id}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'可邀请组',memberIds:[b.profile.userId,c.profile.userId]});
 await h.call(a,'POST','conversations/'+id+'/remove-member',{userId:c.profile.userId});
 // Fill a synthetic member's capacity as persisted groups whose other members
 // already left. This valid database fixture avoids 30 hours of rate-limit waits.
 const account=h.service.authenticate(c.token).id,raw=h.database.raw;
 const count=raw.prepare('SELECT count(*) n FROM conversation_members WHERE account_id=?').get(account).n;
 raw.exec('BEGIN IMMEDIATE');
 try{for(let i=count;i<100;i++){const chat=randomUUID();raw.prepare("INSERT INTO conversations(id,type,name,owner_id,created_at,updated_at) VALUES(?,'group','容量测试',?,1,1)").run(chat,account);raw.prepare('INSERT INTO conversation_members(conversation_id,account_id,joined_at) VALUES(?,?,1)').run(chat,account);}raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}
 await assert.rejects(h.call(a,'POST','conversations/'+id+'/invite',{memberIds:[c.profile.userId]}),expected(409,'CHAT_LIMIT'));
 await assert.rejects(h.call(a,'POST','groups',{requestId:randomUUID(),name:'不得超额加入',memberIds:[b.profile.userId,c.profile.userId]}),expected(409,'CHAT_LIMIT'));
 assert.equal(raw.prepare('SELECT count(*) n FROM conversation_members WHERE account_id=?').get(account).n,100);
 const request=await h.call(b,'POST','friends/request',{userId:c.profile.userId});
 await assert.rejects(h.call(c,'POST','friends/respond',{requestId:request.requestId,accept:true}),expected(409,'CHAT_LIMIT'));
 assert.equal((await h.call(c,'GET','state')).requests.some(row=>row.id===request.requestId),true);
 assert.equal((await h.call(b,'GET','state')).friends.some(row=>row.userId===c.profile.userId),false);
});


test('shareable avatar capabilities are image-only, compact for contacts, and revoked on replacement/removal',async t=>{
 const h=harness();t.after(h.close);let a=await h.register();const b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);
 const {conversationId:id}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'头像显示',memberIds:[b.profile.userId,c.profile.userId]});
 a={...a,profile:(await h.update(a,{avatarImage:IMAGE})).profile};assert.equal(a.profile.avatarImage,IMAGE);
 assert.equal((await h.call(a,'GET','me')).profile.avatarImage,IMAGE);
 const firstState=await h.call(b,'GET','state'),url=firstState.friends.find(row=>row.userId===a.profile.userId).avatarImage;
 assert.match(url,/^\/api\/social\/avatars\/[a-f0-9-]{36}$/);assert.equal(JSON.stringify(firstState).includes(IMAGE),false);
 assert.equal(firstState.conversations.find(row=>row.id===id).members.find(row=>row.userId===a.profile.userId).avatarImage,url);
 const path=url.replace('/api/social/',''),publicImage=await h.call(null,'GET',path);
 assert.deepEqual(Object.keys(publicImage).sort(),['binary','mime']);assert.equal(publicImage.mime,'image/png');assert.equal(Buffer.from(publicImage.binary).equals(imageData(IMAGE).bytes),true);
 assert.equal(JSON.stringify(publicImage).includes(a.profile.userId),false);
 await assert.rejects(h.call(null,'GET','avatars/'+a.profile.userId),expected(404,'AVATAR_NOT_FOUND'));
 await assert.rejects(h.call(null,'GET','avatars/'+randomUUID()),expected(404,'AVATAR_NOT_FOUND'));
 await assert.rejects(h.call(null,'GET','lookup',{}, {userId:a.profile.userId}),expected(401,'ACCOUNT_REQUIRED'));
 a={...a,profile:(await h.update(a,{nickname:'改名字不换头像'})).profile};
 assert.equal((await h.call(b,'GET','lookup',{}, {userId:a.profile.userId})).profile.avatarImage,url);
 a={...a,profile:(await h.update(a,{avatarImage:OTHER_IMAGE})).profile};
 await assert.rejects(h.call(null,'GET',path),expected(404,'AVATAR_NOT_FOUND'));
 const nextUrl=(await h.call(b,'GET','lookup',{}, {userId:a.profile.userId})).profile.avatarImage;
 assert.notEqual(nextUrl,url);assert.equal((await h.call(null,'GET',nextUrl.replace('/api/social/',''))).mime,'image/png');
 a={...a,profile:(await h.update(a,{avatarImage:''})).profile};
 await assert.rejects(h.call(null,'GET',nextUrl.replace('/api/social/','')),expected(404,'AVATAR_NOT_FOUND'));
 assert.equal((await h.call(b,'GET','lookup',{}, {userId:a.profile.userId})).profile.avatarImage,'');
});

test('canonicalized duplicate group IDs cannot trigger SQLite errors',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);
 const duplicateGroup=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'双人群成员去重',memberIds:[b.profile.userId,' '+b.profile.userId+' ']});assert.equal(h.database.raw.prepare('SELECT count(*) n FROM conversation_members WHERE conversation_id=?').get(duplicateGroup.conversationId).n,2);
 const {conversationId:id}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'正常组',memberIds:[b.profile.userId,c.profile.userId]});
 await h.call(a,'POST','conversations/'+id+'/remove-member',{userId:c.profile.userId});
 await h.call(a,'POST','conversations/'+id+'/invite',{memberIds:[c.profile.userId,' '+c.profile.userId+' ']});
 assert.equal((await h.call(a,'GET','state')).conversations.find(row=>row.id===id).members.length,3);
});


// Real 2x2 RGB fixtures encoded independently using Pillow (no decoder dependency in tests).
const JPEG_FIXTURE="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC7RRRXunin/9k=";
const WEBP_FIXTURE="data:image/webp;base64,UklGRjYAAABXRUJQVlA4ICoAAADwAQCdASoCAAIAAUAmJaACdLoB+AAETAAA/ttR//G7IVD7ef++9AbwMAA=";
test('image validation accepts actual PNG/JPEG/WebP and rejects MIME mismatch or truncation',()=>{
 for(const [src,mime,width] of [[IMAGE,'image/png',1],[JPEG_FIXTURE,'image/jpeg',2],[WEBP_FIXTURE,'image/webp',2]]){
  const result=imageData(src);assert.equal(result.mime,mime);assert.equal(result.width,width);assert.equal(result.height,width);
  const bytes=Buffer.from(src.split(',')[1],'base64');const truncated=src.split(',')[0]+','+bytes.subarray(0,24).toString('base64');
  assert.throws(()=>imageData(truncated),expected(400,'INVALID_IMAGE'));
 }
 assert.throws(()=>imageData(IMAGE.replace('image/png','image/jpeg')),expected(400,'INVALID_IMAGE'));
});


test('group creation retries are canonical, content-bound, isolated per owner and atomic',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);await h.befriend(b,c);
 const requestId=randomUUID(),input={requestId,name:'稳定群聊',memberIds:[b.profile.userId,c.profile.userId]};
 await assert.rejects(h.call(a,'POST','groups',{...input,requestId:undefined}),expected(400,'INVALID_REQUEST_ID'));
 await assert.rejects(h.call(a,'POST','groups',{...input,requestId:{}}),expected(400,'INVALID_REQUEST_ID'));
 const first=await h.call(a,'POST','groups',input);
 const retry=await h.call(a,'POST','groups',{...input,requestId:requestId.toUpperCase(),name:' 稳定群聊 ',memberIds:[c.profile.userId,' '+b.profile.userId+' ',b.profile.userId]});
 assert.equal(retry.conversationId,first.conversationId);
 assert.equal(h.database.raw.prepare("SELECT count(*) n FROM conversations WHERE type='group'").get().n,1);
 assert.equal(h.database.raw.prepare('SELECT count(*) n FROM group_requests').get().n,1);
 await assert.rejects(h.call(a,'POST','groups',{...input,name:'改变的内容'}),expected(409,'GROUP_REQUEST_CONFLICT'));
 // Even an identical request ID belongs to the authenticated owner, and cannot
 // return another owner's conversation or skip the normal membership checks.
 const byB=await h.call(b,'POST','groups',{...input,memberIds:[a.profile.userId,c.profile.userId]});
 assert.notEqual(byB.conversationId,first.conversationId);
 const failedId=randomUUID();
 await assert.rejects(h.call(a,'POST','groups',{...input,requestId:failedId,memberIds:[b.profile.userId,a.profile.userId]}),expected(400,'GROUP_MEMBERS'));
 assert.equal(h.database.raw.prepare('SELECT count(*) n FROM group_requests WHERE request_id=?').get(failedId).n,0);
 assert.equal(h.database.raw.prepare("SELECT count(*) n FROM conversations WHERE type='group'").get().n,2);
 assert.ok((await h.call(a,'POST','groups',{...input,requestId:failedId})).conversationId);
});


test('forward message catch-up returns every offline message with bounded pages and membership fences',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);const {conversationId:id}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'离线同步',memberIds:[b.profile.userId,c.profile.userId]});
 const first=await h.send(a,id,'在线时最后一条');const ids=[];for(let i=0;i<127;i++){if(i===80)h.tick(60001);ids.push((await h.send(a,id,'离线期间 '+i)).message.id);}
 let cursor=first.message.id,result,received=[];do{result=await h.messages(b,id,{after:cursor});assert.ok(result.messages.length<=50);received.push(...result.messages.map(x=>x.id));cursor=result.nextAfter||result.messages.at(-1)?.id||cursor;}while(result.hasMore);assert.deepEqual(received,ids);
 await h.call(b,'POST','conversations/'+id+'/read',{throughId:ids[49]});assert.equal((await h.call(b,'GET','state')).conversations.find(x=>x.id===id).unread,77);
 await assert.rejects(h.messages(b,id,{after:'-1'}),expected(400,'INVALID_CURSOR'));await assert.rejects(h.messages(b,id,{before:'20',after:'1'}),expected(400,'INVALID_CURSOR'));
 await h.call(a,'POST','conversations/'+id+'/remove-member',{userId:c.profile.userId});await h.call(a,'POST','conversations/'+id+'/invite',{memberIds:[c.profile.userId]});assert.deepEqual((await h.messages(c,id,{after:'0'})).messages,[]);const newer=await h.send(b,id,'只看重入后');assert.deepEqual((await h.messages(c,id,{after:'0'})).messages.map(m=>m.id),[newer.message.id]);
});

test('blocking is bilateral for direct contact, independently reversible, and preserves shared-group history',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();const dm=await h.befriend(a,b);await h.befriend(a,c);const {conversationId:group}=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'共同群仍可见',memberIds:[b.profile.userId,c.profile.userId]});
 await h.call(a,'POST','blocks',{userId:b.profile.userId});assert.equal((await h.call(a,'GET','blocks')).blocked[0].userId,b.profile.userId);assert.equal((await h.call(b,'GET','state')).conversations.find(x=>x.id===dm).blocked,true);
 for(const [from,to] of [[a,b],[b,a]]){await assert.rejects(h.send(from,dm,'被拦截'),expected(403,'CONTACT_BLOCKED'));await assert.rejects(h.call(from,'POST','friends/request',{userId:to.profile.userId}),expected(403,'CONTACT_BLOCKED'));}
 await h.call(a,'POST','conversations/'+group+'/remove-member',{userId:b.profile.userId});await assert.rejects(h.call(a,'POST','conversations/'+group+'/invite',{memberIds:[b.profile.userId]}),expected(403,'CONTACT_BLOCKED'));
 await h.call(b,'POST','blocks',{userId:a.profile.userId});await h.call(a,'POST','blocks/remove',{userId:b.profile.userId});await assert.rejects(h.send(a,dm,'对方仍屏蔽'),expected(403,'CONTACT_BLOCKED'));await h.call(b,'POST','blocks/remove',{userId:a.profile.userId});await h.send(a,dm,'双方解除后恢复');
 await h.call(a,'POST','conversations/'+group+'/invite',{memberIds:[b.profile.userId]});await h.call(a,'POST','blocks',{userId:b.profile.userId});const shared=await h.send(b,group,'共同群消息');assert.ok((await h.messages(a,group)).messages.some(m=>m.id===shared.message.id));
});

test('reports are private, idempotent, validated and moderation hides content/media with an auditable revision',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register(),id=await h.befriend(a,b);const sent=await h.call(b,'POST','conversations/'+id+'/messages',{clientId:randomUUID(),type:'image',image:{src:IMAGE,name:'证据.png'}});const input={targetType:'message',targetId:sent.message.id,reason:'harassment',detail:'隔离测试证据',requestId:randomUUID()};
 await assert.rejects(h.call(c,'POST','reports',input),expected(404,'CHAT_NOT_FOUND'));const reported=await h.call(a,'POST','reports',input);assert.equal((await h.call(a,'POST','reports',input)).report.id,reported.report.id);await assert.rejects(h.call(a,'POST','reports',{...input,detail:'更改内容'}),expected(409,'REPORT_CONFLICT'));
 assert.equal((await h.call(c,'GET','reports')).reports.length,0);assert.equal(h.service.moderation.show(reported.report.id).evidence.mediaId,sent.message.image.id);assert.equal(h.service.moderation.list().length,1);await assert.rejects(h.call(a,'GET','admin/reports'),expected(404,'NOT_FOUND'));
 const before=(await h.call(a,'GET','state')).conversations[0].contentRevision;h.service.moderation.resolve({actor:'test-operator',reportId:reported.report.id,action:'remove-message',reason:'独立测试违规内容处置'});assert.notEqual((await h.call(a,'GET','state')).conversations[0].contentRevision,before);const removed=(await h.messages(a,id)).messages[0];assert.equal(removed.removed,true);assert.equal(removed.image,undefined);await assert.rejects(h.call(a,'GET','media/'+sent.message.image.id),expected(404,'MEDIA_NOT_FOUND'));assert.equal((await h.call(a,'GET','reports')).reports[0].status,'resolved');assert.equal(h.service.moderation.show(reported.report.id).audit.length,1);
 assert.throws(()=>h.service.moderation.resolve({actor:'test-operator',reportId:reported.report.id,action:'dismiss',reason:'不应二次处置'}),expected(409,'REPORT_HANDLED'));
 for(const bad of [{...input,targetType:'group',targetId:{}},{...input,targetId:[]},{...input,reason:'unknown'}])await assert.rejects(h.call(a,'POST','reports',{...bad,requestId:randomUUID()}),error=>error.status===400);
});

test('real account restrictions block publishing and authentication while operator resolution restores access',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),dm=await h.befriend(a,b);const report=async()=> (await h.call(a,'POST','reports',{targetType:'user',targetId:b.profile.userId,reason:'spam',detail:'真实产品库的合成账号测试',requestId:randomUUID()})).report.id;
 const act=(reportId,action)=>h.service.moderation.resolve({actor:'isolation-test',reportId,action,reason:'测试限制与恢复流程'});
 act(await report(),'mute-user');await assert.rejects(h.send(b,dm,'被禁言'),expected(403,'ACCOUNT_RESTRICTED'));assert.ok((await h.messages(b,dm)).messages);act(await report(),'suspend-user');await assert.rejects(h.call(b,'GET','state'),expected(403,'ACCOUNT_SUSPENDED'));await assert.rejects(h.call(null,'POST','login',{userId:b.profile.userId,password:PIN}),expected(403,'ACCOUNT_SUSPENDED'));act(await report(),'restore-user');await h.send(b,dm,'恢复后可发送');
 const feedback=await h.call(a,'POST','reports',{targetType:'feedback',reason:'other',detail:'需要帮助但没有伪造客服联系方式',requestId:randomUUID()});assert.equal(feedback.report.targetType,'feedback');assert.equal(h.service.moderation.show(feedback.report.id).evidence.constructor,Object);
});


test('original social schema upgrades atomically without clearing accounts and safety records survive restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'yubenzhe-social-test-')),filename=join(directory,'social.sqlite');let h,raw;
 try{raw=new DatabaseSync(filename);const original=await readFile(new URL('../migrations/003-social.sql',import.meta.url),'utf8');raw.exec('CREATE TABLE social_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL);');raw.exec(original);raw.prepare('INSERT INTO social_migrations VALUES(1,?,1)').run(createHash('sha256').update(original).digest('hex'));raw.prepare('INSERT INTO accounts(id,user_id,nickname,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run('prior-account','73918246','保留旧账号','test-salt','00'.repeat(32),1);raw.close();raw=null;
 h=harness(filename);assert.equal(h.database.raw.prepare('SELECT nickname FROM accounts WHERE id=?').get('prior-account').nickname,'保留旧账号');assert.equal(h.database.raw.prepare('SELECT count(*) n FROM social_migrations').get().n,20);const a=await h.register(),b=await h.register();await h.befriend(a,b);await h.call(a,'POST','blocks',{userId:b.profile.userId});const r=(await h.call(a,'POST','reports',{targetType:'user',targetId:b.profile.userId,reason:'spam',detail:'重启保留',requestId:randomUUID()})).report;h.service.moderation.resolve({actor:'migration-test',reportId:r.id,action:'mute-user',reason:'重启持久验证'});h.close();h=null;
 h=harness(filename);assert.equal((await h.call(a,'GET','blocks')).blocked[0].userId,b.profile.userId);assert.equal((await h.call(a,'GET','reports')).reports[0].status,'resolved');assert.equal(h.service.moderation.show(r.id).audit.length,1);assert.equal(h.database.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');h.database.raw.prepare('UPDATE social_migrations SET checksum=? WHERE version=2').run('tampered');h.close();h=null;assert.throws(()=>openSocialDatabase(filename),/checksum mismatch/);
 }finally{h?.close();raw?.close();const safe=resolve(directory);if(!basename(safe).startsWith('yubenzhe-social-test-')||resolve(join(safe,'..'))!==resolve(tmpdir()))throw new Error('Unexpected cleanup path');await rm(safe,{recursive:true,force:true});}
});


test('revoking a session while PIN verification is pending prevents password or profile writes',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),oldHash=h.service.authenticate(a.token).password_hash;const passwordWrite=h.call(a,'POST','password',{currentPassword:PIN,newPassword:NEXT_PIN});await h.call(a,'POST','logout');await assert.rejects(passwordWrite,expected(401,'ACCOUNT_REQUIRED'));assert.equal(h.database.raw.prepare('SELECT password_hash FROM accounts WHERE user_id=?').get(a.profile.userId).password_hash,oldHash);
 const session=await h.call(null,'POST','login',{userId:a.profile.userId,password:PIN});const profileWrite=h.update(session,{userId:'73928561',currentPassword:PIN});await h.call(session,'POST','logout');await assert.rejects(profileWrite,expected(401,'ACCOUNT_REQUIRED'));assert.equal(h.database.raw.prepare('SELECT user_id FROM accounts WHERE user_id=?').get(a.profile.userId).user_id,a.profile.userId);
});

test('default group capacity accepts 200 total, rejects 201, and configurable lower limits remain authoritative',async t=>{const h=harness();t.after(h.close);const a=await h.register(),owner=h.service.authenticate(a.token),ids=[];for(let i=0;i<200;i++){const id=randomUUID(),publicId='group_test_'+String(i).padStart(4,'0');h.database.raw.prepare('INSERT INTO accounts(id,user_id,nickname,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)').run(id,publicId,'合成群成员 '+i,owner.password_salt,owner.password_hash,1700000000000);h.database.raw.prepare('INSERT INTO user_ids(user_id,account_id) VALUES(?,?)').run(publicId,id);const pair=[id,owner.id].sort();h.database.raw.prepare('INSERT INTO friendships VALUES(?,?,?)').run(...pair,1700000000000);ids.push(publicId);}const group=await h.call(a,'POST','groups',{name:'200 人边界测试',memberIds:ids.slice(0,199),requestId:randomUUID()});assert.equal(h.database.raw.prepare('SELECT count(*) n FROM conversation_members WHERE conversation_id=?').get(group.conversationId).n,200);await assert.rejects(h.call(a,'POST','conversations/'+group.conversationId+'/invite',{memberIds:[ids[199]]}),expected(409,'GROUP_LIMIT'));await assert.rejects(h.call(a,'POST','groups',{name:'越界测试',memberIds:ids,requestId:randomUUID()}),expected(400,'GROUP_MEMBERS'));const limited=createSocialService({database:h.database,maxGroupMembers:3,now:()=>1700000000000});await assert.rejects(limited.handle({method:'POST',path:'groups',token:a.token,input:{name:'自定义边界',memberIds:ids.slice(0,3),requestId:randomUUID()}}),expected(400,'GROUP_MEMBERS'));const small=await limited.handle({method:'POST',path:'groups',token:a.token,input:{name:'小群',memberIds:ids.slice(0,2),requestId:randomUUID()}});assert.equal(h.database.raw.prepare('SELECT count(*) n FROM conversation_members WHERE conversation_id=?').get(small.conversationId).n,3);});
