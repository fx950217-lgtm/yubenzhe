import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createSocialMoments,deleteAccountMoments } from '../server/social-moments.mjs';
import { fail,fields,text } from '../server/social-validation.mjs';

const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const code=value=>error=>error.code===value;
function harness(t){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;');
 db.exec(readFileSync(new URL('../migrations/003-social.sql',import.meta.url),'utf8'));
 db.exec("CREATE TABLE social_blocks(blocker_id TEXT,blocked_id TEXT,created_at INTEGER,PRIMARY KEY(blocker_id,blocked_id)); CREATE TABLE account_restrictions(account_id TEXT PRIMARY KEY,state TEXT,reason TEXT,updated_at INTEGER);");
 db.exec(readFileSync(new URL('../migrations/006-social-moments.sql',import.meta.url),'utf8'));
 for(const file of ['011-workbench.sql','017-moment-artifacts.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));t.after(()=>db.close());
 const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const accountById=id=>one('SELECT * FROM accounts WHERE id=?',id);
 const profile=a=>({userId:a.user_id,nickname:a.nickname,avatar:a.avatar,avatarImage:'',level:a.level,official:!!a.official});
 const restriction=id=>one('SELECT * FROM account_restrictions WHERE account_id=?',id)||{state:'active'};
 const isFriend=(a,b)=>!!one('SELECT 1 FROM friendships WHERE a=? AND b=?',...[a,b].sort());
 const isBlocked=(a,b)=>!!one('SELECT 1 FROM social_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)',a,b,b,a);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}};
 let time=1700000000000;const limits=new Map();
 const limit=(key,max,period)=>{const old=limits.get(key);if(!old||time-old.at>=period){limits.set(key,{n:1,at:time});return;}if(old.n>=max)fail(429,'RATE_LIMITED','rate');old.n++;};
 const service=createSocialMoments({db,one,all,run,transaction,now:()=>time,fail,fields,text,profile,accountById,isFriend,isBlocked,restriction,assertCanPublish:a=>{if(restriction(a.id).state!=='active')fail(403,'ACCOUNT_RESTRICTED','restricted');},limit});
 const account=index=>{const id=randomUUID();run('INSERT INTO accounts(id,user_id,nickname,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',id,String(7281940000+index),'合成用户'+index,'unused','unused',time);return accountById(id);};
 const [a,b,c,d]=[1,2,3,4].map(account);
 const friend=(a,b)=>run('INSERT OR IGNORE INTO friendships VALUES(?,?,?)',...[a.id,b.id].sort(),time);
 const call=(a,method,path,input={},query={})=>service.handle({account:a,method,path,input,query});
 const publish=(a,overrides={})=>call(a,'POST','moments',{clientId:randomUUID(),text:'真实朋友圈测试内容',audience:'friends',images:[],...overrides});
 return {db,one,all,run,service,a,b,c,d,friend,call,publish,tick:ms=>time+=ms};
}

test('navigation moment waterline excludes own, private and unrelated posts',t=>{
 const h=harness(t);assert.equal(h.service.latestVisibleId(h.a),'0');h.friend(h.a,h.b);
 const visible=h.publish(h.b).post;h.publish(h.b,{audience:'self'});h.publish(h.c);h.publish(h.a);
 assert.equal(h.service.latestVisibleId(h.a),visible.id);assert.equal(h.service.latestVisibleId(h.c),'0');
});
test('navigation moment waterline revokes blocked, unfriended and suspended content in both directions',t=>{
 const h=harness(t);h.friend(h.a,h.b);const p=h.publish(h.b).post;assert.equal(h.service.latestVisibleId(h.a),p.id);
 for(const [from,to]of [[h.a,h.b],[h.b,h.a]]){h.run('INSERT INTO social_blocks VALUES(?,?,?)',from.id,to.id,1);assert.equal(h.service.latestVisibleId(h.a),'0');h.run('DELETE FROM social_blocks');}
 h.run("INSERT INTO account_restrictions VALUES(?,'suspended','test',?)",h.b.id,1);assert.equal(h.service.latestVisibleId(h.a),'0');h.run('DELETE FROM account_restrictions');assert.equal(h.service.latestVisibleId(h.a),p.id);
 h.run('DELETE FROM friendships');assert.equal(h.service.latestVisibleId(h.a),'0');h.friend(h.a,h.b);h.call(h.b,'POST','moments/'+p.id+'/delete');assert.equal(h.service.latestVisibleId(h.a),'0');
});

test('moments use real account identity, current friendships and private audience',t=>{
 const h=harness(t);h.friend(h.a,h.b);const shared=h.publish(h.a).post,privatePost=h.publish(h.a,{audience:'self'}).post;
 assert.deepEqual(h.call(h.a,'GET','moments').posts.map(p=>p.id),[privatePost.id,shared.id]);
 assert.deepEqual(h.call(h.b,'GET','moments').posts.map(p=>p.id),[shared.id]);
 assert.equal(h.call(h.c,'GET','moments').posts.length,0);
 assert.throws(()=>h.call(h.b,'GET','moments/'+privatePost.id),code('MOMENT_NOT_FOUND'));
 assert.throws(()=>h.call(null,'GET','moments'),code('ACCOUNT_REQUIRED'));
 h.run('UPDATE accounts SET user_id=?,nickname=? WHERE id=?','847192','更新后的名字',h.a.id);
 assert.equal(h.call(h.b,'GET','moments/'+shared.id).post.author.userId,'847192');
 assert.equal(h.call(h.b,'GET','moments/'+shared.id).post.author.nickname,'更新后的名字');
});

test('post and image visibility are revoked after unfriending or blocking in either direction',t=>{
 const h=harness(t);h.friend(h.a,h.b);const p=h.publish(h.a,{images:[{src:IMAGE,name:'合成.png'}]}).post,media='moments/media/'+p.images[0].id;
 assert.ok(h.call(h.b,'GET',media).binary.length>0);assert.throws(()=>h.call(h.c,'GET',media),code('MOMENT_NOT_FOUND'));
 h.run('DELETE FROM friendships');assert.throws(()=>h.call(h.b,'GET',media),code('MOMENT_NOT_FOUND'));
 h.friend(h.a,h.b);h.run('INSERT INTO social_blocks VALUES(?,?,?)',h.b.id,h.a.id,1);
 assert.equal(h.call(h.b,'GET','moments').posts.length,0);assert.throws(()=>h.call(h.b,'GET',media),code('MOMENT_NOT_FOUND'));
 h.run('DELETE FROM social_blocks');h.run('INSERT INTO social_blocks VALUES(?,?,?)',h.a.id,h.b.id,1);
 assert.throws(()=>h.call(h.b,'POST','moments/'+p.id+'/like',{liked:true}),code('MOMENT_NOT_FOUND'));
 assert.ok(h.call(h.a,'GET',media).binary.length>0);
});

test('stable descending pages and mine scope never reveal unrelated or private posts',t=>{
 const h=harness(t);h.friend(h.a,h.b);for(let i=0;i<23;i++)h.publish(h.a,{text:'发布 '+i});h.publish(h.c);h.publish(h.b,{audience:'self'});
 const first=h.call(h.b,'GET','moments'),second=h.call(h.b,'GET','moments',{}, {before:first.nextBefore});
 assert.equal(first.posts.length,20);assert.equal(second.posts.length,4);assert.equal(second.nextBefore,null);
 assert.equal(new Set([...first.posts,...second.posts].map(p=>p.id)).size,24);
 assert.equal(h.call(h.b,'GET','moments',{}, {scope:'mine'}).posts.length,1);
 for(const before of ['0','NaN','1.2','-1'])assert.throws(()=>h.call(h.b,'GET','moments',{}, {before}),code('INVALID_MOMENT_ID'));
});

test('publishing is atomic and retries match text, audience, image bytes and names',t=>{
 const h=harness(t),input={clientId:randomUUID(),text:'一次发布',audience:'friends',images:[{src:IMAGE,name:'a.png'}]};
 const one=h.call(h.a,'POST','moments',input).post,two=h.call(h.a,'POST','moments',input).post;assert.equal(one.id,two.id);
 for(const changed of [{text:'变化'},{audience:'self'},{images:[{src:IMAGE,name:'b.png'}]}])assert.throws(()=>h.call(h.a,'POST','moments',{...input,...changed}),code('MOMENT_REQUEST_CONFLICT'));
 assert.equal(h.one('SELECT count(*) n FROM moments').n,1);assert.equal(h.one('SELECT count(*) n FROM moment_media').n,1);
 h.call(h.a,'POST','moments/'+one.id+'/delete');assert.equal(h.one('SELECT count(*) n FROM moment_media').n,0);
 assert.throws(()=>h.call(h.a,'POST','moments',input),code('MOMENT_REMOVED'));assert.equal(h.one('SELECT count(*) n FROM moments').n,0);
});

test('invalid formats and quotas reject without leaving posts, pictures or requests',t=>{
 const h=harness(t);for(const override of [{text:'',images:[]},{text:'x'.repeat(2001)},{images:Array(4).fill({src:IMAGE,name:'x'})},{audience:'public'},{images:[{src:'data:image/svg+xml;base64,PHN2Zy8+',name:'x'}]},{admin:true}])assert.throws(()=>h.publish(h.a,override));
 assert.equal(h.one('SELECT count(*) n FROM moments').n,0);assert.equal(h.one('SELECT count(*) n FROM moment_requests').n,0);
 const p=h.publish(h.a,{images:[{src:IMAGE,name:'x'}]}).post;
 h.run('UPDATE moment_media SET bytes=zeroblob(?) WHERE post_id=?',50*1024*1024,p.id);
 assert.throws(()=>h.publish(h.a,{images:[{src:IMAGE,name:'x'}]}),code('MOMENT_MEDIA_LIMIT'));
 assert.equal(h.one('SELECT count(*) n FROM moments').n,1);assert.equal(h.one('SELECT count(*) n FROM moment_requests').n,1);
});

test('likes are desired-state idempotent and comments expose only mutual friends',t=>{
 const h=harness(t);h.friend(h.a,h.b);h.friend(h.a,h.c);const p=h.publish(h.a).post;
 for(let i=0;i<2;i++)h.call(h.b,'POST','moments/'+p.id+'/like',{liked:true});
 h.call(h.c,'POST','moments/'+p.id+'/like',{liked:true});
 const comment={clientId:randomUUID(),text:'好友评论'};for(let i=0;i<2;i++)h.call(h.c,'POST','moments/'+p.id+'/comments',comment);
 assert.equal(h.call(h.a,'GET','moments/'+p.id).post.likes.length,2);assert.equal(h.call(h.a,'GET','moments/'+p.id).post.comments.length,1);
 assert.equal(h.call(h.b,'GET','moments/'+p.id).post.likes.length,1);assert.equal(h.call(h.b,'GET','moments/'+p.id).post.comments.length,0);
 h.friend(h.b,h.c);assert.equal(h.call(h.b,'GET','moments/'+p.id).post.comments.length,1);
 h.run('INSERT INTO social_blocks VALUES(?,?,?)',h.c.id,h.b.id,1);assert.equal(h.call(h.b,'GET','moments/'+p.id).post.comments.length,0);
 for(let i=0;i<2;i++)h.call(h.b,'POST','moments/'+p.id+'/like',{liked:false});assert.equal(h.call(h.b,'GET','moments/'+p.id).post.liked,false);
});

test('only owners delete content and deleted comments cannot reappear on retry',t=>{
 const h=harness(t);h.friend(h.a,h.b);const p=h.publish(h.a).post,input={clientId:randomUUID(),text:'可删除评论'},comment=h.call(h.b,'POST','moments/'+p.id+'/comments',input).post.comments[0];
 assert.throws(()=>h.call(h.b,'POST','moments/'+p.id+'/delete'),code('MOMENT_OWNER_REQUIRED'));
 assert.throws(()=>h.call(h.a,'POST',`moments/${p.id}/comments/${comment.id}/delete`),code('COMMENT_OWNER_REQUIRED'));
 h.call(h.b,'POST',`moments/${p.id}/comments/${comment.id}/delete`);assert.throws(()=>h.call(h.b,'POST','moments/'+p.id+'/comments',input),code('MOMENT_REMOVED'));
 h.call(h.a,'POST','moments/'+p.id+'/delete');assert.equal(h.one('SELECT count(*) n FROM moment_comments').n,0);
});

test('muted accounts cannot publish while deleted and suspended content stays inaccessible',t=>{
 const h=harness(t);h.friend(h.a,h.b);const p=h.publish(h.a,{images:[{src:IMAGE,name:'x'}]}).post;
 h.run("INSERT INTO account_restrictions VALUES(?,'muted','test',1)",h.b.id);
 assert.equal(h.call(h.b,'GET','moments').posts.length,1);assert.throws(()=>h.publish(h.b),code('ACCOUNT_RESTRICTED'));
 assert.throws(()=>h.call(h.b,'POST','moments/'+p.id+'/comments',{clientId:randomUUID(),text:'no'}),code('ACCOUNT_RESTRICTED'));
 assert.throws(()=>h.call(h.b,'POST','moments/'+p.id+'/like',{liked:true}),code('ACCOUNT_RESTRICTED'));
 h.run("INSERT INTO account_restrictions VALUES(?,'suspended','test',1)",h.a.id);
 assert.equal(h.call(h.b,'GET','moments').posts.length,0);assert.throws(()=>h.call(h.b,'GET','moments/media/'+p.images[0].id),code('MOMENT_NOT_FOUND'));
});

test('reports authorize before recording evidence and moderation deletes private media',t=>{
 const h=harness(t);h.friend(h.a,h.b);const input={clientId:randomUUID(),text:'待审核动态',audience:'friends',images:[{src:IMAGE,name:'x'}]},p=h.call(h.a,'POST','moments',input).post;
 assert.throws(()=>h.service.reportEvidence({account:h.c,targetType:'moment',targetId:p.id}),code('MOMENT_NOT_FOUND'));
 const evidence=h.service.reportEvidence({account:h.b,targetType:'moment',targetId:p.id});assert.equal(evidence.targetId,p.id);assert.equal(JSON.stringify(evidence).includes('base64'),false);assert.equal(JSON.stringify(evidence).includes('password'),false);
 h.service.moderate({action:'remove-moment',targetId:p.id});assert.equal(h.one('SELECT count(*) n FROM moment_media').n,0);assert.throws(()=>h.call(h.a,'POST','moments',input),code('MOMENT_REMOVED'));
});

test('account deletion removes owned posts and all authored social footprints without deleting others posts',t=>{
 const h=harness(t);h.friend(h.a,h.b);const own=h.publish(h.a,{images:[{src:IMAGE,name:'x'}]}).post,other=h.publish(h.b).post;
 h.call(h.a,'POST','moments/'+other.id+'/comments',{clientId:randomUUID(),text:'will be removed'});h.call(h.b,'POST','moments/'+own.id+'/comments',{clientId:randomUUID(),text:'parent removed'});h.call(h.a,'POST','moments/'+other.id+'/like',{liked:true});
 h.db.exec('BEGIN');deleteAccountMoments(h.db,h.a.id);h.db.exec('COMMIT');
 assert.equal(h.one('SELECT count(*) n FROM moments').n,1);assert.equal(h.one('SELECT count(*) n FROM moment_media').n,0);assert.equal(h.one('SELECT count(*) n FROM moment_comments').n,0);assert.equal(h.one('SELECT count(*) n FROM moment_likes').n,0);assert.equal(h.one('SELECT count(*) n FROM moment_requests WHERE account_id=? OR post_id=?',h.a.id,own.id).n,0);
 assert.equal(h.call(h.b,'GET','moments/'+other.id).post.id,other.id);
});

test('per-account publication limits preserve existing data and expire independently',t=>{
 const h=harness(t);for(let i=0;i<30;i++)h.publish(h.a,{text:String(i)});assert.throws(()=>h.publish(h.a),code('RATE_LIMITED'));assert.equal(h.one('SELECT count(*) n FROM moments').n,30);h.publish(h.b);h.tick(3600001);h.publish(h.a);assert.equal(h.one('SELECT count(*) n FROM moments').n,32);
});

test('real social service mounts moments behind product authentication and applies all migrations',async t=>{
 const {openSocialDatabase}=await import('../server/social-database.mjs'),{createSocialService}=await import('../server/social-service.mjs');
 const database=openSocialDatabase(':memory:');t.after(()=>database.close());const service=createSocialService({database});
 const call=(token,method,path,input={})=>service.handle({token,method,path,input,ip:'moments-integration-test'});
 const a=await call('','POST','register',{password:'483716',requestId:randomUUID()}),b=await call('','POST','register',{password:'628194',requestId:randomUUID()});
 const request=await call(a.token,'POST','friends/request',{userId:b.profile.userId});await call(b.token,'POST','friends/respond',{requestId:request.requestId,accept:true});
 const made=await call(a.token,'POST','moments',{clientId:randomUUID(),text:'真实服务集成测试',audience:'friends',images:[{src:IMAGE,name:'fixture.png'}]});
  assert.equal((await call(b.token,'GET','moments')).posts[0].id,made.post.id);
  assert.equal((await call(b.token,'GET','state')).moments.latestVisibleId,made.post.id);
 await assert.rejects(call('','GET','moments/media/'+made.post.images[0].id),code('ACCOUNT_REQUIRED'));
  await call(a.token,'POST','friends/remove',{userId:b.profile.userId});
  assert.equal((await call(b.token,'GET','state')).moments.latestVisibleId,'0');
 await assert.rejects(call(b.token,'GET','moments/media/'+made.post.images[0].id),code('MOMENT_NOT_FOUND'));
});
