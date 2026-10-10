import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { createCommunityService,amountUnits } from '../server/community-service.mjs';
import { fail } from '../server/social-validation.mjs';
const code=value=>e=>e.code===value;
const sha=value=>createHash('sha256').update(value).digest('hex');
function harness(t,{filename=':memory:',initialize=true}={}){
 const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');
 if(initialize){db.exec(readFileSync(new URL('../migrations/003-social.sql',import.meta.url),'utf8'));db.exec("ALTER TABLE accounts ADD COLUMN deleted_at INTEGER NOT NULL DEFAULT 0;CREATE TABLE social_blocks(blocker_id TEXT,blocked_id TEXT,created_at INTEGER,PRIMARY KEY(blocker_id,blocked_id));CREATE TABLE account_restrictions(account_id TEXT PRIMARY KEY,state TEXT,reason TEXT,updated_at INTEGER);");db.exec(readFileSync(new URL('../migrations/010-community.sql',import.meta.url),'utf8'));}
 let closed=false;t.after(()=>{if(!closed)db.close()});
 const one=(s,...p)=>db.prepare(s).get(...p),all=(s,...p)=>db.prepare(s).all(...p),run=(s,...p)=>db.prepare(s).run(...p);
 let time=Date.parse('2026-10-10T10:00:00Z'),evidence=[],valuation=null;
 const authenticate=token=>{const a=one('SELECT a.* FROM accounts a JOIN social_sessions s ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.deleted_at=0',sha(token||''),time);if(!a)fail(401,'AUTH_REQUIRED','auth');if(one("SELECT 1 FROM account_restrictions WHERE account_id=? AND state='suspended'",a.id))fail(403,'ACCOUNT_RESTRICTED','restricted');return a;};
 const socialService={authenticate,assertAIAccess(token){const a=authenticate(token);if(one("SELECT 1 FROM account_restrictions WHERE account_id=? AND state<>'active'",a.id))fail(403,'ACCOUNT_RESTRICTED','restricted');}};
 const service=createCommunityService({database:{raw:db},socialService,now:()=>time,getBountyPayments:()=>evidence,getRankBalances:()=>valuation});
 const session=id=>{const token=randomUUID();run('INSERT INTO social_sessions VALUES(?,?,?,?)',sha(token),id,time+100*86400000,time);return token;};
 const account=index=>{const id=randomUUID();run('INSERT INTO accounts(id,user_id,nickname,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',id,'test_'+index,'合成用户'+index,'unused','unused',time);return {id,userId:'test_'+index,token:session(id)};};
 const [a,b,c]=initialize?[1,2,3].map(account):[];
 const call=(who,method,path,input={},query={})=>service.handle({method,path:'community/'+path,input,query,token:typeof who==='string'?who:who?.token});
 const post=(who,path,input={})=>call(who,'POST',path,{requestId:randomUUID(),...input});
 const admin=(path,input={})=>service.adminHandle({method:'POST',path,actor:'private-admin-test',input:{requestId:randomUUID(),reason:'合成审核原因',...input}});
 const publish=(who=a,input={})=>post(who,'bounties',{title:'合成开发任务',description:'这是用于自动化验证的任务详细描述',category:'development',tags:['测试'],assetId:'SIM-USD',rewardAmount:'10.25',deadline:time+86400000,deliverables:'交付源文件',acceptance:'约定用例通过',...input}).bounty;
 const cooperate=(who=a,worker=b)=>{const task=publish(who);post(worker,'bounties/'+task.id+'/apply',{message:'可以完成要求'});const application=call(who,'GET','bounties/'+task.id).bounty.applications[0];post(who,'bounties/'+task.id+'/select',{applicationId:application.id});post(worker,'bounties/'+task.id+'/confirm');return call(who,'GET','bounties/'+task.id).bounty;};
 const provider=(who=b,input={})=>post(who,'providers',{kind:'business',name:'合成服务商',category:'开发',description:'用于验证服务商审核的详细介绍',pricing:'按需求报价',languages:['中文'],regions:['全球'],...input}).provider;
 const heartbeat=(who=a,input={})=>post(who,'activity',{active:true,visible:true,...input});
 return {db,one,all,run,service,a,b,c,call,post,admin,publish,cooperate,provider,heartbeat,session,tick:ms=>time+=ms,setTime:t=>time=t,get time(){return time},set evidence(v){evidence=v},set valuation(v){valuation=v},close(){db.close();closed=true}};
}

test('amounts retain exact decimals and reject malformed or excessive values',()=>{
 assert.equal(amountUnits('10.25',6),'10250000');assert.equal(amountUnits('999999999999999999',0),'999999999999999999');
 for(const value of ['0','-1','1e6','1.0000001','Infinity',' 1','0x10'])assert.throws(()=>amountUnits(value,6));
});

test('task publication is authenticated, immutable and idempotent even after deadline',t=>{
 const h=harness(t),requestId=randomUUID(),task=h.publish(h.a,{requestId,deadline:h.time+1000});
 assert.equal(task.escrow,false);assert.equal(task.payment.status,'unpaid');assert.equal(task.author.official,false);assert.equal(task.author.level,1);
 assert.throws(()=>h.call(null,'GET','bounties'),code('AUTH_REQUIRED'));
 assert.throws(()=>h.publish(h.a,{paid:true}));assert.throws(()=>h.publish(h.a,{assetId:'SIM-FUN'}),code('ASSET_UNAVAILABLE'));
 const original=h.one('SELECT result FROM community_requests WHERE request_id=?',requestId);h.tick(2000);
 const retry=h.publish(h.a,{requestId,deadline:h.time-1000});assert.equal(retry.id,task.id);assert.equal(h.one('SELECT count(*) n FROM community_bounties').n,1);
 assert.equal(original.result,h.one('SELECT result FROM community_requests WHERE request_id=?',requestId).result);
 assert.throws(()=>h.publish(h.a,{requestId,title:'不同任务',deadline:h.time-1000}),code('REQUEST_CONFLICT'));
 h.run('UPDATE accounts SET user_id=? WHERE id=?','renamed_user',h.a.id);assert.equal(h.call(h.b,'GET','bounties/'+task.id).bounty.author.userId,'renamed_user');
});

test('search and pagination are stable; private applications/delivery and bilateral blocks are enforced',t=>{
 const h=harness(t);for(let i=0;i<32;i++)h.publish(h.a,{title:'分页 '+i});
 const first=h.call(h.b,'GET','bounties',{}, {q:'分页'}),next=h.call(h.b,'GET','bounties',{}, {q:'分页',before:first.nextBefore});assert.equal(first.items.length,30);assert.equal(next.items.length,2);assert.equal(new Set([...first.items,...next.items].map(r=>r.id)).size,32);
 const task=h.cooperate();h.post(h.b,'bounties/'+task.id+'/deliver',{body:'仅合作双方可读的交付'});
 assert.equal(h.call(h.c,'GET','bounties/'+task.id).bounty.applications.length,0);assert.equal(h.call(h.c,'GET','bounties/'+task.id).bounty.deliveries.length,0);
 assert.throws(()=>h.post(h.c,'bounties/'+task.id+'/end'),code('OWNER_REQUIRED'));assert.throws(()=>h.post(h.c,'bounties/'+task.id+'/deliver',{body:'越权交付'}),code('PARTNER_REQUIRED'));
 h.run('INSERT INTO social_blocks VALUES(?,?,?)',h.a.id,h.c.id,h.time);assert.throws(()=>h.call(h.c,'GET','bounties/'+task.id),code('BOUNTY_NOT_FOUND'));assert.equal(h.call(h.c,'GET','bounties').items.length,0);
});

test('cooperation completion never fabricates payment; only claimed matching gifts count exactly once',t=>{
 const h=harness(t),r=h.cooperate();h.post(h.b,'bounties/'+r.id+'/deliver',{body:'验证交付说明'});const ended=h.post(h.a,'bounties/'+r.id+'/end').bounty;assert.equal(ended.status,'ended');assert.equal(ended.payment.status,'unpaid');
 const proof={bountyId:r.id,payerId:h.a.id,payeeId:h.b.id,assetId:'SIM-USD',decimals:6,amountUnits:'5000000',giftId:'gift-one',claimId:'claim-one',claimedAt:h.time,mode:'simulation'};
 h.evidence=[proof,proof,{...proof,claimId:'unclaimed',claimedAt:0},{...proof,claimId:'wrong-task',bountyId:randomUUID()},{...proof,claimId:'wrong-worker',payeeId:h.c.id},{...proof,claimId:'wrong-asset',assetId:'SIM-FUN'},{...proof,claimId:'future',claimedAt:h.time+1}];
 let payment=h.call(h.c,'GET','bounties/'+r.id).bounty.payment;assert.equal(payment.verifiedUnits,'5000000');assert.equal(payment.status,'partial');assert.equal(payment.records.length,1);
 h.evidence=[proof,{...proof,claimId:'claim-two',giftId:'gift-two',amountUnits:'5250000'}];payment=h.call(h.a,'GET','bounties/'+r.id).bounty.payment;assert.equal(payment.status,'verified');assert.equal(payment.verifiedUnits,'10250000');assert.equal(payment.records[0].mode,'simulation');
 assert.equal(h.service.assertBountyPayment({bountyId:r.id,payerId:h.a.id,payeeId:h.b.id,assetId:'SIM-USD'}).bountyId,r.id);
 assert.throws(()=>h.service.assertBountyPayment({bountyId:r.id,payerId:h.a.id,payeeId:h.c.id,assetId:'SIM-USD'}),code('BOUNTY_PAYMENT_MISMATCH'));
});

test('reviews require accepted delivery; low ratings persist until independent reported moderation',t=>{
 const h=harness(t),r=h.cooperate();assert.throws(()=>h.post(h.b,'bounties/'+r.id+'/review',{rating:1,body:'尚未交付'}),code('COOPERATION_REQUIRED'));
 h.post(h.b,'bounties/'+r.id+'/deliver',{body:'实际交付说明'});h.post(h.a,'bounties/'+r.id+'/end');assert.throws(()=>h.post(h.c,'bounties/'+r.id+'/review',{rating:5,body:'路人评价'}),code('COOPERATION_REQUIRED'));
 const review=h.post(h.b,'bounties/'+r.id+'/review',{rating:1,body:'低评分需要保留'}).bounty.reviews[0];assert.throws(()=>h.post(h.b,'bounties/'+r.id+'/review',{rating:5,body:'重复评价'}),code('ALREADY_REVIEWED'));
 assert.throws(()=>h.post(h.a,'bounties/'+r.id+'/delete-review',{id:review.id}),code('COMMUNITY_NOT_FOUND'));
 const report=h.post(h.a,'reports',{targetType:'review',targetId:review.id,reason:'合成申诉说明'});assert.equal(h.call(h.c,'GET','reports').items.length,0);h.admin('report',{id:report.id,decision:'hide'});assert.equal(h.call(h.a,'GET','bounties/'+r.id).bounty.reviews.length,0);assert.equal(h.one('SELECT body FROM community_reviews WHERE id=?',review.id).body,'低评分需要保留');assert.ok(h.one("SELECT 1 FROM community_audit WHERE action='report'"));
});

test('providers are segregated, pending by default, revision controlled, and cannot self-certify',t=>{
 const h=harness(t),p=h.provider();assert.equal(p.status,'pending');assert.equal(h.call(h.a,'GET','providers').items.length,0);assert.equal(h.call(h.b,'GET','providers',{}, {mine:'true'}).items.length,1);
 assert.throws(()=>h.provider(h.c,{official:true}));assert.throws(()=>h.call(h.b,'POST','admin/certification',{requestId:randomUUID()}),code('COMMUNITY_NOT_FOUND'));assert.throws(()=>h.service.adminHandle({method:'GET',path:'overview'}),code('ADMIN_REQUIRED'));
 const grant={id:p.id,revision:p.revision,decision:'approve',subject:'合成组织',scope:'设计开发',validUntil:h.time+86400000,requestId:randomUUID()};h.admin('provider',grant);h.admin('provider',grant);
 let shown=h.call(h.a,'GET','providers',{}, {kind:'business'}).items[0];assert.equal(shown.certification.kind,'business');assert.equal(shown.owner.official,false);assert.equal(shown.infrastructureConnected,false);assert.equal(h.call(h.a,'GET','providers',{}, {kind:'cloud'}).items.length,0);
 assert.throws(()=>h.provider(h.b,{revision:1}),code('REVISION_CHANGED'));const update=h.provider(h.b,{revision:shown.revision,description:'审核后编辑仍需要重新审核的介绍'});assert.equal(update.status,'pending');assert.equal(update.certification,null);assert.equal(h.call(h.a,'GET','providers').items.length,0);
});

test('official certification has separate scope, expiry, and moderation revokes provider badge',t=>{
 const h=harness(t),p=h.provider();h.admin('provider',{id:p.id,revision:1,decision:'approve',subject:'测试主体',scope:'开发',validUntil:h.time+1000});
 h.admin('certification',{userId:h.b.userId,kind:'official',subject:'平台测试主体',scope:'平台客服',validUntil:h.time+1000,active:true});assert.equal(h.service.profileExtras(h.b.id).official,true);
 const report=h.post(h.a,'reports',{targetType:'provider',targetId:p.id,reason:'违规服务商测试'});h.admin('report',{id:report.id,decision:'hide'});assert.equal(h.service.profileExtras(h.b.id).certifications.some(c=>c.kind==='business'),false);assert.equal(h.service.profileExtras(h.b.id).official,true);
 h.tick(1001);assert.equal(h.service.profileExtras(h.b.id).official,false);
});

test('asset ranking is retired and activity disclosure remains explicit and reversible',t=>{
 const h=harness(t);assert.equal(Object.hasOwn(h.call(h.a,'GET','identity'),'assetPublic'),false);
 assert.throws(()=>h.call(h.a,'GET','rankings',{}, {kind:'assets'}),code('ASSET_RANK_REMOVED'));
 assert.throws(()=>h.post(h.b,'preferences',{assetPublic:true}));
 assert.equal(h.call(h.a,'GET','rankings').kind,'activity');assert.equal(h.call(h.a,'GET','rankings').rows.length,0);
 h.post(h.b,'preferences',{activityPublic:true});let rank=h.call(h.a,'GET','rankings');assert.equal(rank.rows.length,1);assert.equal(Object.hasOwn(rank.rows[0],'assetRange'),false);
 h.post(h.b,'preferences',{activityPublic:false});assert.equal(h.call(h.a,'GET','rankings').rows.length,0);
});

test('online time is server timed, multi-device deduplicated, idles at five minutes and stops hidden',t=>{
 const h=harness(t),second=h.session(h.a.id);h.heartbeat();h.heartbeat(second);for(let i=0;i<10;i++){h.tick(30000);h.heartbeat(h.a,{active:false});h.heartbeat(second,{active:false});}
 assert.equal(h.call(h.a,'GET','identity').effectiveMinutes,5);h.tick(30000);h.heartbeat(h.a,{active:false});assert.equal(h.call(h.a,'GET','identity').effectiveMinutes,5);
 h.heartbeat();h.tick(30000);h.heartbeat(h.a,{active:false,visible:false});for(let i=0;i<5;i++){h.tick(30000);h.heartbeat(h.a,{active:false,visible:false});}assert.equal(h.one('SELECT total_ms FROM community_activity WHERE account_id=?',h.a.id).total_ms,330000);
 assert.throws(()=>h.post(h.a,'activity',{active:true,visible:true,duration:86400000}));
});

test('daily online cap, midnight split, revoked devices and versioned level thresholds are authoritative',t=>{
 const h=harness(t);h.heartbeat();for(let i=0;i<125;i++){h.tick(60000);h.heartbeat();}let identity=h.call(h.a,'GET','identity');assert.equal(identity.effectiveMinutes,120);assert.equal(identity.todayMinutes,120);assert.equal(identity.level,2);
 h.admin('level-rules',{thresholds:[0,100,110,1000]});identity=h.call(h.a,'GET','identity');assert.equal(identity.level,3);assert.equal(identity.levelRuleVersion,2);assert.equal(identity.dailyLimitMinutes,120);
 const second=h.session(h.b.id);h.setTime(Date.parse('2026-10-10T23:59:30Z'));h.heartbeat(second);h.tick(60000);h.heartbeat(second,{active:false});assert.equal(h.one('SELECT milliseconds FROM community_activity_days WHERE account_id=? AND day=?',h.b.id,'2026-10-10').milliseconds,30000);assert.equal(h.one('SELECT milliseconds FROM community_activity_days WHERE account_id=? AND day=?',h.b.id,'2026-10-11').milliseconds,30000);
 h.run('DELETE FROM social_sessions WHERE token_hash=?',sha(second));h.tick(30000);h.heartbeat(h.b,{active:false});assert.equal(h.call(h.b,'GET','identity').effectiveMinutes,1);assert.equal(h.one('SELECT 1 FROM community_presence WHERE session_hash=?',sha(second)),undefined);
});

test('token approval is only configuration approval; no deployment, zero recipient or forged status',t=>{
 const h=harness(t),input={name:'合成趣味币',symbol:'TEST',description:'合成发行申请',supply:'1000',decimals:18,recipient:'0x'+'1'.repeat(40)};
 assert.throws(()=>h.post(h.a,'tokens',{...input,deployed:true}));assert.throws(()=>h.post(h.a,'tokens',{...input,recipient:'0x'+'0'.repeat(40)}),code('INVALID_TOKEN'));
 const app=h.post(h.a,'tokens',input).application;assert.equal(h.call(h.b,'GET','tokens').items.length,0);const result=h.admin('token',{id:app.id,revision:1,decision:'approve'}).application;assert.equal(result.status,'awaiting_configuration');assert.equal(result.chainId,97);assert.equal(result.deployed,false);assert.equal(result.registered,false);assert.equal(result.settlementEnabled,false);assert.equal('contractAddress' in result,false);
});

test('restrictions cannot be bypassed and account cleanup blocks open cooperation then removes exposure',t=>{
 const h=harness(t),task=h.publish();assert.throws(()=>h.service.deleteAccount(h.a.id),code('COMMUNITY_PENDING'));h.post(h.a,'bounties/'+task.id+'/cancel',{reason:'结束合成测试'});h.post(h.a,'preferences',{activityPublic:true});h.heartbeat();h.service.deleteAccount(h.a.id);assert.equal(h.one('SELECT 1 FROM community_preferences WHERE account_id=?',h.a.id),undefined);assert.equal(h.call(h.b,'GET','bounties').items.length,0);
 h.run('INSERT INTO account_restrictions VALUES(?,?,?,?)',h.b.id,'muted','测试禁言',h.time);assert.throws(()=>h.publish(h.b),code('ACCOUNT_RESTRICTED'));assert.equal(h.call(h.b,'GET','capabilities').realFunds,false);h.post(h.b,'preferences',{activityPublic:false});
});

test('community records and idempotency survive reopening the persistent database',t=>{
 const dir=mkdtempSync(join(tmpdir(),'community-test-'));const filename=join(dir,'social.sqlite'),h=harness(t,{filename}),requestId=randomUUID(),task=h.publish(h.a,{requestId}),account=h.a,time=h.time;h.close();const reopened=harness(t,{filename,initialize:false});t.after(()=>rmSync(dir,{recursive:true,force:true}));reopened.setTime(time);assert.equal(reopened.call(account,'GET','bounties/'+task.id).bounty.id,task.id);assert.equal(reopened.publish(account,{requestId}).id,task.id);assert.equal(reopened.one('SELECT count(*) n FROM community_bounties').n,1);
});
