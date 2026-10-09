import { randomUUID, createHash } from 'node:crypto';
import { imageData } from './social-validation.mjs';

const MAX_IMAGE_BYTES=512*1024, PAGE_SIZE=20;
const digest=value=>createHash('sha256').update(value).digest('hex');

// Called inside the account-deletion transaction, before deleting the account.
export function deleteAccountMoments(db,accountId){
 db.prepare('DELETE FROM moment_requests WHERE account_id=? OR post_id IN(SELECT id FROM moments WHERE author_id=?)').run(accountId,accountId);
 db.prepare('DELETE FROM moment_comments WHERE author_id=?').run(accountId);
 db.prepare('DELETE FROM moment_likes WHERE account_id=?').run(accountId);
 db.prepare('DELETE FROM moments WHERE author_id=?').run(accountId);
 db.prepare('DELETE FROM moment_media WHERE owner_id=?').run(accountId);
}

export function createSocialMoments(ctx){
 const {db,now,one,all,run,transaction,fail,fields,text,profile,accountById,isFriend,isBlocked,limit}=ctx;
 function numeric(value){if(typeof value!=='string'||! /^[1-9]\d{0,14}$/.test(value)||!Number.isSafeInteger(Number(value)))fail(400,'INVALID_MOMENT_ID','动态或评论标识无效。');return Number(value);}
 function clientId(value){if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))fail(400,'INVALID_CLIENT_ID','操作标识无效，请重新打开后重试。');return value.toLowerCase();}
 const authorAvailable=id=>ctx.restriction?.(id)?.state!=='suspended';
 function visible(post,a){return Boolean(post)&&authorAvailable(post.author_id)&&(post.author_id===a.id||(post.audience==='friends'&&isFriend(a.id,post.author_id)&&!isBlocked(a.id,post.author_id)));}
 function requirePost(id,a){const post=one('SELECT * FROM moments WHERE id=?',id);if(!visible(post,a))fail(404,'MOMENT_NOT_FOUND','动态已删除或当前不可见。');return post;}
 const peerVisible=(id,a)=>id===a.id||(authorAvailable(id)&&!isBlocked(a.id,id)&&isFriend(a.id,id));
 const commentView=row=>({id:String(row.id),postId:String(row.post_id),author:profile(accountById(row.author_id)),text:row.text,createdAt:row.created_at});
 function postView(row,a){
  const comments=all('SELECT * FROM moment_comments WHERE post_id=? ORDER BY id',row.id).filter(c=>peerVisible(c.author_id,a));
  const likes=all('SELECT account_id FROM moment_likes WHERE post_id=? ORDER BY created_at,account_id',row.id).filter(l=>peerVisible(l.account_id,a));
  return {id:String(row.id),author:profile(accountById(row.author_id)),text:row.text,audience:row.audience,createdAt:row.created_at,own:row.author_id===a.id,
   images:all('SELECT id,name,mime,width,height,length(bytes) size FROM moment_media WHERE post_id=? ORDER BY rowid',row.id).map(m=>({...m,src:'/api/social/moments/media/'+m.id})),
   comments:comments.map(c=>({...commentView(c),own:c.author_id===a.id})),likes:likes.map(l=>profile(accountById(l.account_id))),liked:likes.some(l=>l.account_id===a.id)};
 }
 function previousRequest(a,id,operation,checksum){const old=one('SELECT * FROM moment_requests WHERE account_id=? AND client_id=?',a.id,id);if(!old)return null;if(old.operation!==operation||old.digest!==checksum)fail(409,'MOMENT_REQUEST_CONFLICT','同一次操作的内容已改变，请重新编辑后发送。');if(old.removed)fail(410,'MOMENT_REMOVED','这条内容已删除，不会重复发布。');return old;}
 function removePost(id){run('UPDATE moment_requests SET removed=1 WHERE post_id=?',id);run('DELETE FROM moments WHERE id=?',id);}
 function removeComment(id){run("UPDATE moment_requests SET removed=1 WHERE operation='comment' AND resource_id=?",id);run('DELETE FROM moment_comments WHERE id=?',id);}
 const assertCanPublish=a=>ctx.assertCanPublish?.(a);
 function preparePost(input){
  fields(input,['clientId','text','audience','images']);const id=clientId(input.clientId),content=text(input.text??'',2000,'动态'),audience=input.audience??'friends';
  if(!['friends','self'].includes(audience))fail(400,'INVALID_AUDIENCE','请选择好友可见或仅自己可见。');
  if(!Array.isArray(input.images)||input.images.length>3)fail(400,'INVALID_IMAGE','每条动态最多添加 3 张图片。');
  const images=input.images.map(image=>{fields(image,['src','name']);return {...imageData(image.src,MAX_IMAGE_BYTES),name:text(image.name??'图片',80,'图片名称',1)};});
  if(images.reduce((sum,i)=>sum+i.bytes.length,0)>MAX_IMAGE_BYTES)fail(400,'INVALID_IMAGE','这条动态的图片总大小不能超过 512 KB。');
  if(!content&&!images.length)fail(400,'EMPTY_MOMENT','请填写文字或选择图片。');
  const checksum=digest(JSON.stringify({text:content,audience,images:images.map(i=>({name:i.name,mime:i.mime,hash:digest(i.bytes)}))}));return {id,content,audience,images,checksum};
 }
 function reportEvidence({account,targetType,targetId}){
  if(!['moment','comment'].includes(targetType))return;
  const id=numeric(String(targetId));let post,comment;
  if(targetType==='comment'){comment=one('SELECT * FROM moment_comments WHERE id=?',id);if(!comment||!peerVisible(comment.author_id,account))fail(404,'MOMENT_NOT_FOUND','评论已删除或当前不可见。');post=requirePost(comment.post_id,account);}
  else post=requirePost(id,account);
  return {targetId:String(id),evidence:{postId:String(post.id),author:profile(accountById(post.author_id)),text:post.text,audience:post.audience,createdAt:post.created_at,images:all('SELECT id,mime,width,height FROM moment_media WHERE post_id=?',post.id),...(comment?{comment:commentView(comment)}:{})}};
 }
 function moderate({action,targetId}){
  if(!['remove-moment','remove-comment'].includes(action))return;
  const id=numeric(String(targetId));if(action==='remove-moment')removePost(id);else removeComment(id);return {ok:true};
 }
 function handle({method,path,input={},query={},account:a}){
  if(path!=='moments'&&!path.startsWith('moments/'))return;
  if(!a)fail(401,'ACCOUNT_REQUIRED','请先登录。');
  if(method==='GET'&&path==='moments'){
   fields(query,['before','scope']);const before=query.before===undefined?Number.MAX_SAFE_INTEGER:numeric(query.before),scope=query.scope??'all';if(!['all','mine'].includes(scope))fail(400,'INVALID_SCOPE','动态筛选无效。');
   const rows=all(`SELECT p.* FROM moments p WHERE p.id<? AND (p.author_id=? OR (?='all' AND p.audience='friends' AND EXISTS(SELECT 1 FROM friendships f WHERE (f.a=? AND f.b=p.author_id) OR (f.b=? AND f.a=p.author_id)))) AND NOT EXISTS(SELECT 1 FROM social_blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.author_id) OR (b.blocked_id=? AND b.blocker_id=p.author_id)) AND NOT EXISTS(SELECT 1 FROM account_restrictions r WHERE r.account_id=p.author_id AND r.state='suspended') ORDER BY p.id DESC LIMIT ?`,before,a.id,scope,a.id,a.id,a.id,a.id,PAGE_SIZE+1);
   return {posts:rows.slice(0,PAGE_SIZE).map(p=>postView(p,a)),nextBefore:rows.length>PAGE_SIZE?String(rows[PAGE_SIZE-1].id):null};
  }
  if(method==='POST'&&path==='moments'){
   const p=preparePost(input);return transaction(()=>{
    const old=previousRequest(a,p.id,'post',p.checksum);if(old)return {post:postView(requirePost(old.post_id,a),a)};
    assertCanPublish(a);limit('moment-post:'+a.id,30,3600000);
    if(one('SELECT count(*) n FROM moments WHERE author_id=?',a.id).n>=1000)fail(409,'MOMENT_LIMIT','动态已达 1,000 条上限，请先删除不需要的内容。');
    const used=one('SELECT COALESCE(sum(length(bytes)),0) n FROM moment_media WHERE owner_id=?',a.id).n;if(used+p.images.reduce((sum,i)=>sum+i.bytes.length,0)>50*1024*1024)fail(409,'MOMENT_MEDIA_LIMIT','朋友圈图片已达 50 MB 上限，请先删除不需要的内容。');
    const id=Number(run('INSERT INTO moments(author_id,text,audience,created_at) VALUES(?,?,?,?)',a.id,p.content,p.audience,now()).lastInsertRowid);
    for(const image of p.images)run('INSERT INTO moment_media VALUES(?,?,?,?,?,?,?,?)',randomUUID(),id,a.id,image.name,image.mime,image.bytes,image.width,image.height);
    run("INSERT INTO moment_requests(account_id,client_id,operation,digest,post_id,resource_id) VALUES(?,?,'post',?,?,?)",a.id,p.id,p.checksum,id,id);return {post:postView(one('SELECT * FROM moments WHERE id=?',id),a)};
   });
  }
  const media=/^moments\/media\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(path);
  if(method==='GET'&&media){fields(query,[]);const row=one('SELECT * FROM moment_media WHERE id=?',media[1]);if(!row)fail(404,'MOMENT_NOT_FOUND','图片已删除或当前不可见。');requirePost(row.post_id,a);return {binary:Buffer.from(row.bytes),mime:row.mime};}
  const route=/^moments\/([1-9]\d{0,14})(?:\/(delete|like|comments)(?:\/([1-9]\d{0,14})\/(delete))?)?$/.exec(path);
  if(!route)fail(404,'MOMENT_NOT_FOUND','动态操作不存在。');const id=numeric(route[1]),action=route[2];
  if(method==='GET'&&!action){fields(query,[]);return {post:postView(requirePost(id,a),a)};}
  if(method==='POST'&&action==='delete'&&!route[3]){fields(input,[]);return transaction(()=>{const post=one('SELECT * FROM moments WHERE id=?',id);if(!post)return {ok:true};if(post.author_id!==a.id)fail(403,'MOMENT_OWNER_REQUIRED','只能删除自己的动态。');removePost(id);return {ok:true};});}
  if(method==='POST'&&action==='like'&&!route[3]){fields(input,['liked']);if(typeof input.liked!=='boolean')fail(400,'INVALID_ACTION','点赞状态无效。');return transaction(()=>{const post=requirePost(id,a);if(input.liked){assertCanPublish(a);limit('moment-like:'+a.id,120,60000);run('INSERT OR IGNORE INTO moment_likes VALUES(?,?,?)',id,a.id,now());}else run('DELETE FROM moment_likes WHERE post_id=? AND account_id=?',id,a.id);return {post:postView(post,a)};});}
  if(method==='POST'&&action==='comments'&&!route[3]){
   fields(input,['clientId','text']);const requestId=clientId(input.clientId),content=text(input.text,300,'评论',1),checksum=digest(JSON.stringify({postId:id,text:content}));return transaction(()=>{const post=requirePost(id,a),old=previousRequest(a,requestId,'comment',checksum);if(old)return {post:postView(post,a)};assertCanPublish(a);limit('moment-comment:'+a.id,60,3600000);if(one('SELECT count(*) n FROM moment_comments WHERE post_id=?',id).n>=200)fail(409,'COMMENT_LIMIT','这条动态的评论已达 200 条上限。');const commentId=Number(run('INSERT INTO moment_comments(post_id,author_id,text,created_at) VALUES(?,?,?,?)',id,a.id,content,now()).lastInsertRowid);run("INSERT INTO moment_requests(account_id,client_id,operation,digest,post_id,resource_id) VALUES(?,?,'comment',?,?,?)",a.id,requestId,checksum,id,commentId);return {post:postView(post,a)};});
  }
  if(method==='POST'&&action==='comments'&&route[3]&&route[4]==='delete'){fields(input,[]);return transaction(()=>{const post=one('SELECT * FROM moments WHERE id=?',id),comment=one('SELECT * FROM moment_comments WHERE id=? AND post_id=?',numeric(route[3]),id);if(comment&&comment.author_id!==a.id)fail(403,'COMMENT_OWNER_REQUIRED','只能删除自己的评论。');if(comment)removeComment(comment.id);return visible(post,a)?{post:postView(post,a)}:{ok:true};});}
  fail(404,'MOMENT_NOT_FOUND','动态操作不存在。');
 }
 return {handle,reportEvidence,moderate};
}
