import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createSocialService} from '../server/social-service.mjs';
const PIN='482615',NEXT='735194';
const error=(status,code)=>e=>e.status===status&&e.code===code;
function harness(filename=':memory:'){
 let time=1700000000000;const database=openSocialDatabase(filename),service=createSocialService({database,now:()=>time,accessConfig:{hasFinancialExposure:()=>false}});
 const call=(a,method,path,input={},extra={})=>service.handle({method,path,input,token:a?.token??'',ip:'192.0.2.10',userAgent:'Synthetic Windows Chrome/123',...extra});
 const register=()=>call(null,'POST','register',{password:PIN,requestId:randomUUID()});
 const login=(a,pin=PIN)=>call(null,'POST','login',{userId:a.profile.userId,password:pin});
 const proof=async a=>(await call(a,'POST','security/verify',{currentPassword:PIN})).verificationToken;
 const recovery=async a=>call(a,'POST','security/recovery-code',{verificationToken:await proof(a)});
 const remove=a=>call(a,'POST','security/delete-account',{currentPassword:PIN,confirmation:'注销账号'});
 const befriend=async(a,b)=>{const r=await call(a,'POST','friends/request',{userId:b.profile.userId});return (await call(b,'POST','friends/respond',{requestId:r.requestId,accept:true})).conversationId;};
 return {database,service,call,register,login,proof,recovery,remove,befriend,tick:ms=>time+=ms,close:()=>database.close()};
}
test('recovery is voluntary, only a hash persists; rotation and revocation invalidate older codes',async t=>{
 const h=harness();t.after(h.close);const a=await h.register();assert.equal((await h.call(a,'GET','security/status')).recoveryEnabled,false);
 const first=await h.recovery(a),second=await h.recovery(a);assert.match(first.recoveryCode,/^YBZ-(?:[A-F0-9]{6}-){7}[A-F0-9]{6}$/);assert.notEqual(first.recoveryCode,second.recoveryCode);
 const row=h.database.raw.prepare('SELECT * FROM account_recovery').get();assert.match(row.code_hash,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(row).includes(second.recoveryCode),false);assert.equal(JSON.stringify(await h.call(a,'GET','security/status')).includes(second.recoveryCode),false);
 await assert.rejects(h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:first.recoveryCode,newPassword:NEXT}),error(401,'INVALID_RECOVERY'));
 await h.call(a,'POST','security/recovery-code/remove',{verificationToken:await h.proof(a)});await assert.rejects(h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:second.recoveryCode,newPassword:NEXT}),error(401,'INVALID_RECOVERY'));
});
test('recovery revokes all sessions, changes PIN, consumes code and requires explicit login',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),other=await h.login(a),r=await h.recovery(a);
 const recovered=await h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:r.recoveryCode.toLowerCase(),newPassword:NEXT});assert.equal(recovered.recovered,true);assert.equal(recovered.requiresLogin,true);assert.match(recovered.accessRecoveryToken,/^[-_A-Za-z0-9]{43}$/);assert.ok(recovered.protectedUntil>1700000000000);
 for(const actor of [a,other])await assert.rejects(h.call(actor,'GET','me'),error(401,'ACCOUNT_REQUIRED'));
 await assert.rejects(h.login(a),error(401,'BAD_CREDENTIALS'));assert.equal((await h.login(a,NEXT)).profile.userId,a.profile.userId);
 await assert.rejects(h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:r.recoveryCode,newPassword:NEXT}),error(401,'INVALID_RECOVERY'));
});
test('concurrent recovery can succeed only once and the losing attempt never changes credentials',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),r=await h.recovery(a);
 const results=await Promise.allSettled([NEXT,'916284'].map(newPassword=>h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:r.recoveryCode,newPassword})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const winning=results[0].status==='fulfilled'?NEXT:'916284';assert.equal((await h.login(a,winning)).profile.userId,a.profile.userId);assert.equal(h.database.raw.prepare('SELECT count(*) n FROM account_recovery').get().n,0);
});
test('recent verification is one-use, session-bound, expires and old password proofs cannot survive password changes',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.login(a),c=await h.register(),p=await h.proof(a);
 for(const actor of [b,c])await assert.rejects(h.call(actor,'POST','security/recovery-code',{verificationToken:p}),error(403,'VERIFICATION_REQUIRED'));
 await h.call(a,'POST','security/recovery-code',{verificationToken:p});await assert.rejects(h.call(a,'POST','security/recovery-code',{verificationToken:p}),error(403,'VERIFICATION_REQUIRED'));
 const expired=await h.proof(a);h.tick(300001);await assert.rejects(h.call(a,'POST','security/recovery-code',{verificationToken:expired}),error(403,'VERIFICATION_REQUIRED'));
 const old=await h.proof(a);await h.call(a,'POST','password',{currentPassword:PIN,newPassword:NEXT});await assert.rejects(h.call(a,'POST','security/recovery-code',{verificationToken:old}),error(401,'ACCOUNT_REQUIRED'));
});
test('device metadata hides tokens and exact IP; revoke another device and all others while preserving current',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.login(a),c=await h.register();let list=(await h.call(a,'GET','security/sessions')).sessions;
 assert.equal(list.length,2);assert.equal(list.filter(s=>s.current).length,1);assert.equal(list[0].ipHint,'192.0.*.*');assert.match(list[0].device,/Windows/);assert.equal(JSON.stringify(list).includes(a.token),false);assert.equal(JSON.stringify(list).includes('token_hash'),false);
 const foreign=(await h.call(c,'GET','security/sessions')).sessions[0].id;await assert.rejects(h.call(a,'POST','security/sessions/revoke',{sessionId:foreign,verificationToken:await h.proof(a)}),error(404,'SESSION_NOT_FOUND'));
 await h.call(a,'POST','security/sessions/revoke',{sessionId:list.find(s=>!s.current).id,verificationToken:await h.proof(a)});await assert.rejects(h.call(b,'GET','me'),error(401,'ACCOUNT_REQUIRED'));await h.call(c,'GET','me');
 const d=await h.login(a);await h.call(a,'POST','security/sessions/revoke',{others:true,verificationToken:await h.proof(a)});await assert.rejects(h.call(d,'GET','me'),error(401,'ACCOUNT_REQUIRED'));assert.equal((await h.call(a,'GET','security/sessions')).sessions.length,1);
});
test('password verification failures are bounded and cannot be bypassed via the security endpoint',async t=>{
 const h=harness();t.after(h.close);const a=await h.register();for(let i=0;i<8;i++)await assert.rejects(h.call(a,'POST','security/verify',{currentPassword:'000000'}),error(401,'BAD_PASSWORD'));
 await assert.rejects(h.proof(a),error(429,'RATE_LIMITED'));await assert.rejects(h.login(a),error(429,'RATE_LIMITED'));h.tick(900001);await h.proof(a);
});
test('public recovery has generic invalid results and persistent per-ID attempt limits',async t=>{
 const h=harness();t.after(h.close);const a=await h.register();for(let i=0;i<8;i++)await assert.rejects(h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:'YBZ-'+('ABC123-'.repeat(8)),newPassword:NEXT}),error(401,'INVALID_RECOVERY'));
 await assert.rejects(h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:'bad',newPassword:NEXT}),error(429,'RATE_LIMITED'));await assert.rejects(h.call(null,'POST','security/recover',{userId:'927463819402',recoveryCode:'bad',newPassword:NEXT}),error(401,'INVALID_RECOVERY'));
});
test('account deletion requires explicit confirmation and password, refuses ownership of a populated group',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);const group=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'测试组',memberIds:[b.profile.userId,c.profile.userId]});
 await assert.rejects(h.call(a,'POST','security/delete-account',{currentPassword:PIN,confirmation:'yes'}),error(400,'CONFIRMATION_REQUIRED'));await assert.rejects(h.call(a,'POST','security/delete-account',{currentPassword:'000000',confirmation:'注销账号'}),error(401,'BAD_PASSWORD'));await assert.rejects(h.remove(a),error(409,'TRANSFER_OWNER'));await h.call(a,'GET','me');
 await h.call(a,'POST','conversations/'+group.conversationId+'/owner',{userId:b.profile.userId});assert.equal((await h.remove(a)).deleted,true);assert.equal((await h.call(b,'GET','state')).conversations.find(c=>c.id===group.conversationId).ownerId,b.profile.userId);
});
test('deletion removes own messages, media, friends, recovery and moments, retains peer content and reserves identity',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register(),chat=await h.befriend(a,b),r=await h.recovery(a);const aId=h.service.authenticate(a.token).id;
 const own=await h.call(a,'POST','conversations/'+chat+'/messages',{clientId:randomUUID(),type:'text',text:'待删除私密文字'});await h.call(b,'POST','conversations/'+chat+'/messages',{clientId:randomUUID(),type:'text',text:'对方保留的文字'});
 await h.call(a,'POST','moments',{clientId:randomUUID(),text:'自己的动态',images:[],audience:'friends'});const peer=await h.call(b,'POST','moments',{clientId:randomUUID(),text:'他人的动态',images:[],audience:'friends'});
 await h.call(a,'POST','moments/'+peer.post.id+'/comments',{clientId:randomUUID(),text:'自己的评论'});
 const oldKey=randomUUID();h.database.raw.prepare("UPDATE accounts SET avatar_image='sensitive-avatar',avatar_key=?,bio='private' WHERE id=?").run(oldKey,aId);
 h.database.raw.prepare("INSERT INTO social_media(id,conversation_id,owner_id,name,mime,bytes,width,height,created_at) VALUES(?,?,?,'test','image/png',?,1,1,?)").run(randomUUID(),chat,aId,Buffer.from('synthetic'),1700000000000);
 assert.deepEqual(await h.remove(a),{deleted:true,walletUnaffected:true});
 const row=h.database.raw.prepare('SELECT * FROM accounts WHERE id=?').get(aId);assert.equal(row.nickname,'已注销账号');assert.equal(row.user_id,a.profile.userId);assert.ok(row.deleted_at);assert.equal(row.avatar_image,'');assert.equal(row.avatar_key,'');assert.equal(row.bio,'');
 for(const table of ['account_recovery','social_sessions','account_verifications'])assert.equal(h.database.raw.prepare('SELECT count(*) n FROM '+table+' WHERE account_id=?').get(aId).n,0);
 assert.equal(h.database.raw.prepare('SELECT count(*) n FROM social_media WHERE owner_id=?').get(aId).n,0);assert.equal(h.database.raw.prepare('SELECT count(*) n FROM moments WHERE author_id=?').get(aId).n,0);assert.equal(h.database.raw.prepare('SELECT count(*) n FROM moment_comments WHERE author_id=?').get(aId).n,0);
 const msgs=(await h.call(b,'GET','conversations/'+chat+'/messages')).messages;assert.equal(msgs.some(m=>m.text==='待删除私密文字'),false);assert.equal(msgs.some(m=>m.text==='对方保留的文字'),true);assert.equal((await h.call(b,'GET','state')).friends.length,0);
 await assert.rejects(h.call(a,'GET','me'),error(401,'ACCOUNT_REQUIRED'));await assert.rejects(h.login(a),error(401,'BAD_CREDENTIALS'));await assert.rejects(h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:r.recoveryCode,newPassword:NEXT}),error(401,'INVALID_RECOVERY'));await assert.rejects(h.call(c,'POST','friends/request',{userId:a.profile.userId}),error(404,'USER_NOT_FOUND'));await assert.rejects(h.call(null,'GET','avatars/'+oldKey),error(404,'AVATAR_NOT_FOUND'));
 assert.equal(h.database.raw.prepare('SELECT count(*) n FROM user_ids WHERE account_id=?').get(aId).n,1);assert.equal((await h.call(b,'GET','moments')).posts.some(p=>p.id===peer.post.id),true);
});
test('security data survives restart and last-seen updates only after a minute',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ybz-security-'));const file=join(dir,'state.sqlite');let h=harness(file);const a=await h.register(),r=await h.recovery(a),initial=(await h.call(a,'GET','security/status')).sessions[0].lastSeenAt;h.tick(30000);assert.equal((await h.call(a,'GET','security/status')).sessions[0].lastSeenAt,initial);h.tick(30001);assert.ok((await h.call(a,'GET','security/status')).sessions[0].lastSeenAt>initial);h.close();h=harness(file);t.after(async()=>{h.close();await rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});});assert.equal((await h.call(a,'GET','security/status')).recoveryEnabled,true);await h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:r.recoveryCode,newPassword:NEXT});await h.login(a,NEXT);
});

test('deletion scrubs copied user, message and moment report evidence while retaining minimal moderation linkage',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),id=await h.befriend(a,b),aId=h.service.authenticate(a.token).id;
 const sent=await h.call(a,'POST','conversations/'+id+'/messages',{clientId:randomUUID(),type:'text',text:'private-report-source'});const post=await h.call(a,'POST','moments',{clientId:randomUUID(),text:'private-moment-source',images:[],audience:'friends'});
 for(const [targetType,targetId] of [['user',a.profile.userId],['message',sent.message.id],['moment',post.post.id]])await h.call(b,'POST','reports',{targetType,targetId,reason:'other',detail:'private-report-detail',requestId:randomUUID()});
 await h.remove(a);const rows=h.database.raw.prepare('SELECT * FROM social_reports').all();assert.equal(rows.length,3);assert.equal(JSON.stringify(rows.map(r=>[r.detail,r.evidence,r.resolution])).includes('private-'),false);const evidence=JSON.parse(rows.find(r=>r.target_type==='message').evidence);assert.deepEqual(evidence,{senderId:aId,conversationId:id});assert.equal(rows.every(r=>r.reason==='other'&&r.status==='pending'),true);
});
test('deletion erases own push subscriptions/jobs and withdrawn sender messages cannot be pushed to other accounts',async t=>{
 const {createSocialNotifications}=await import('../server/social-notifications.mjs');const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),chat=await h.befriend(a,b),aId=h.service.authenticate(a.token).id,bId=h.service.authenticate(b.token).id;
 const m=await h.call(a,'POST','conversations/'+chat+'/messages',{clientId:randomUUID(),type:'text',text:'removed-source'});const subs=[randomUUID(),randomUUID()];for(const [index,actor,id] of [[0,a,aId],[1,b,bId]])h.database.raw.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?)').run(subs[index],id,createHash('sha256').update(actor.token).digest('hex'),'https://fcm.googleapis.com/synthetic-'+index,'{}',1699999999000,1699999999000);
 for(const [index,id] of [[0,aId],[1,bId]])h.database.raw.prepare('INSERT INTO push_jobs(subscription_id,account_id,message_id,conversation_id,next_at,created_at) VALUES(?,?,?,?,?,?)').run(subs[index],id,Number(m.message.id),chat,1700000000000,1700000000000);
 await h.remove(a);assert.equal(h.database.raw.prepare('SELECT count(*) n FROM push_subscriptions WHERE account_id=?').get(aId).n,0);assert.equal(h.database.raw.prepare('SELECT count(*) n FROM push_jobs WHERE account_id=?').get(aId).n,0);
 let sends=0;const notifications=createSocialNotifications({database:h.database,socialService:h.service,now:()=>1700000000000,config:{publicKey:'synthetic',privateKey:'synthetic',subject:'mailto:synthetic@example.invalid'},sendNotification:async()=>sends++});await notifications.tick();await notifications.close();assert.equal(sends,0);assert.equal(h.database.raw.prepare('SELECT count(*) n FROM push_jobs').get().n,0);
});

test('revoking the current session returns the HTTP cookie-clearing flag and ends authentication',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),sessions=(await h.call(a,'GET','security/sessions')).sessions;
 assert.deepEqual(await h.call(a,'POST','security/sessions/revoke',{sessionId:sessions.find(s=>s.current).id,verificationToken:await h.proof(a)}),{revoked:true,currentSessionRevoked:true});await assert.rejects(h.call(a,'GET','me'),error(401,'ACCOUNT_REQUIRED'));
});

test('suspended accounts retain self-protection and deletion access but recovery never lifts restrictions',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),aId=h.service.authenticate(a.token).id;await h.login(a);
 h.database.raw.prepare("INSERT INTO account_restrictions VALUES(?,'suspended','synthetic-review',?)").run(aId,1700000000000);
 await assert.rejects(h.call(a,'GET','state'),error(403,'ACCOUNT_SUSPENDED'));const code=await h.recovery(a);
 await h.call(a,'POST','security/sessions/revoke',{others:true,verificationToken:await h.proof(a)});assert.equal((await h.call(a,'GET','security/status')).sessions.length,1);
 await h.call(null,'POST','security/recover',{userId:a.profile.userId,recoveryCode:code.recoveryCode,newPassword:NEXT});await assert.rejects(h.login(a,NEXT),error(403,'ACCOUNT_SUSPENDED'));
 assert.equal(h.database.raw.prepare('SELECT state FROM account_restrictions WHERE account_id=?').get(aId).state,'suspended');
 const b=await h.register(),bId=h.service.authenticate(b.token).id;h.database.raw.prepare("INSERT INTO account_restrictions VALUES(?,'suspended','synthetic-review',?)").run(bId,1700000000000);assert.equal((await h.remove(b)).deleted,true);
});

test('deletion clears sole-owner group labels and personal content copied into moderation audit reasons',async t=>{
 const h=harness();t.after(h.close);const a=await h.register(),b=await h.register(),c=await h.register();await h.befriend(a,b);await h.befriend(a,c);
 const group=await h.call(a,'POST','groups',{requestId:randomUUID(),name:'private-group-label',memberIds:[b.profile.userId,c.profile.userId]});await h.call(b,'POST','conversations/'+group.conversationId+'/leave');await h.call(c,'POST','conversations/'+group.conversationId+'/leave');
 const r=await h.call(b,'POST','reports',{targetType:'user',targetId:a.profile.userId,reason:'other',detail:'synthetic',requestId:randomUUID()});h.service.moderation.resolve({actor:'synthetic-admin',reportId:r.report.id,action:'resolve',reason:'private-audit-copy'});
 await h.remove(a);const row=h.database.raw.prepare('SELECT * FROM conversations WHERE id=?').get(group.conversationId);assert.equal(row.owner_id,null);assert.equal(row.name,'已结束的群聊');assert.equal(row.note,'');const audit=h.database.raw.prepare('SELECT * FROM social_moderation_audit WHERE report_id=?').get(r.report.id);assert.equal(audit.reason.includes('private-audit-copy'),false);assert.equal(audit.actor,'synthetic-admin');assert.equal(audit.action,'resolve');
});
