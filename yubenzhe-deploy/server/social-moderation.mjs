import { randomUUID,createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const digest=value=>createHash('sha256').update(value).digest('hex');
export function createSocialModeration(ctx){
 const {one,all,run,transaction,now,fail,fields,text,userId,profile,accountById,accountByUserId,membership,limit}=ctx;
 const isBlocked=(a,b)=>Boolean(one('SELECT 1 FROM social_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)',a,b,b,a));
 const restriction=id=>one('SELECT * FROM account_restrictions WHERE account_id=?',id)||{state:'active',reason:''};
 const assertActive=a=>{if(restriction(a.id).state==='suspended')fail(403,'ACCOUNT_SUSPENDED','账号已被暂停，请联系运营申请复核。');};
 const assertCanPublish=a=>{assertActive(a);if(restriction(a.id).state==='muted')fail(403,'ACCOUNT_RESTRICTED','账号暂时无法发布内容，请通过帮助反馈申请复核。');};
 const requireUnblocked=(a,b)=>{if(isBlocked(a,b))fail(403,'CONTACT_BLOCKED','当前无法向这个用户发送申请、私聊或群邀请。');};
 function ownBlocks(a){return all('SELECT a.* FROM accounts a JOIN social_blocks b ON b.blocked_id=a.id WHERE b.blocker_id=? ORDER BY b.created_at DESC',a.id).map(profile);}
 function reportView(r){return {id:r.id,targetType:r.target_type,reason:r.reason,detail:r.detail,status:r.status,resolution:r.resolution,createdAt:r.created_at,resolvedAt:r.resolved_at};}
 async function handle({method,path,input,account:a}){
  if(method==='GET'&&path==='blocks')return {blocked:ownBlocks(a)};
  if(method==='POST'&&(path==='blocks'||path==='blocks/remove')){
   fields(input,['userId']);const other=accountByUserId(userId(input.userId,true));if(!other||other.id===a.id)fail(400,'INVALID_CONTACT','请选择其他用户。');
   return transaction(()=>{if(path==='blocks'){limit('block:'+a.id,60,3600000);run('INSERT OR IGNORE INTO social_blocks VALUES(?,?,?)',a.id,other.id,now());run("UPDATE friend_requests SET status='rejected',updated_at=? WHERE status='pending' AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))",now(),a.id,other.id,other.id,a.id);}else run('DELETE FROM social_blocks WHERE blocker_id=? AND blocked_id=?',a.id,other.id);return {ok:true,blocked:ownBlocks(a)};});
  }
  if(method==='GET'&&path==='reports')return {reports:all('SELECT * FROM social_reports WHERE reporter_id=? ORDER BY created_at DESC LIMIT 100',a.id).map(reportView)};
  if(method!=='POST'||path!=='reports')return undefined;
  fields(input,['targetType','targetId','reason','detail','requestId']);
  const type=input.targetType,reason=input.reason,detail=text(input.detail??'',1000,'补充说明');
  if(!['user','message','group','feedback','moment','comment'].includes(type)||!['spam','harassment','fraud','illegal','other'].includes(reason))fail(400,'INVALID_REPORT','请选择有效的举报类型与原因。');
  if(typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.requestId))fail(400,'INVALID_REQUEST_ID','举报标识无效，请重新打开后重试。');
  if(type==='group'&&(typeof input.targetId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.targetId)))fail(400,'INVALID_REPORT','群聊标识无效。');
  if(type==='message'&&(typeof input.targetId!=='string'||!/^([1-9][0-9]{0,14})$/.test(input.targetId)))fail(400,'INVALID_REPORT','消息标识无效。');
  if(type==='feedback'&&!detail)fail(400,'INVALID_REPORT','请填写需要帮助的问题。');
  const key=input.requestId.toLowerCase(),inputDigest=digest(JSON.stringify({type,targetId:String(input.targetId??''),reason,detail})),old=one('SELECT * FROM social_reports WHERE reporter_id=? AND request_id=?',a.id,key);
  if(old){if(old.input_digest!==inputDigest)fail(409,'REPORT_CONFLICT','这次举报的内容已改变，请重新提交。');return {report:reportView(old)};}
  let targetId='',evidence={};
  if(type==='user'){const other=accountByUserId(userId(input.targetId,true));if(!other||other.id===a.id)fail(404,'REPORT_TARGET_NOT_FOUND','举报对象不存在。');targetId=other.id;evidence={userId:other.user_id,nickname:other.nickname,bio:other.bio};}
  else if(type==='group'){const c=membership(input.targetId,a);if(c.type!=='group')fail(400,'INVALID_REPORT','请选择群聊。');targetId=c.id;evidence={name:c.name,note:c.note,ownerId:c.owner_id};}
  else if(type==='message'){const m=one('SELECT * FROM messages WHERE id=?',String(input.targetId));if(!m)fail(404,'REPORT_TARGET_NOT_FOUND','消息不存在。');const c=membership(m.conversation_id,a);if(m.id<=c.history_start_id)fail(404,'REPORT_TARGET_NOT_FOUND','消息不在可查看范围。');targetId=String(m.id);evidence={conversationId:m.conversation_id,senderId:m.sender,type:m.type,text:m.text,sticker:m.sticker,mediaId:m.media_id,createdAt:m.created_at};}
  else if(type==='moment'||type==='comment'){const value=ctx.reportEvidence?.({account:a,targetType:type,targetId:input.targetId});if(!value)fail(404,'REPORT_TARGET_NOT_FOUND','举报内容不存在或不可查看。');targetId=value.targetId;evidence=value.evidence;}
  if(JSON.stringify(evidence).length>30000)fail(400,'INVALID_REPORT','举报内容过长。');
  return transaction(()=>{limit('report:'+a.id,10,86400000);const id=randomUUID();run('INSERT INTO social_reports(id,reporter_id,request_id,input_digest,target_type,target_id,reason,detail,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,a.id,key,inputDigest,type,targetId,reason,detail,JSON.stringify(evidence),now());return {report:reportView(one('SELECT * FROM social_reports WHERE id=?',id))};});
 }
 const admin={
  list(status='pending'){if(!['pending','resolved','rejected','all'].includes(status))fail(400,'INVALID_STATUS','Invalid report status');return all('SELECT * FROM social_reports'+(status==='all'?'':' WHERE status=?')+' ORDER BY created_at LIMIT 200',...(status==='all'?[]:[status])).map(r=>({...reportView(r),targetId:r.target_id}));},
  show(id){const r=one('SELECT * FROM social_reports WHERE id=?',id);if(!r)fail(404,'REPORT_NOT_FOUND','Report not found');return {...reportView(r),reporterId:r.reporter_id,targetId:r.target_id,evidence:JSON.parse(r.evidence),audit:all('SELECT * FROM social_moderation_audit WHERE report_id=? ORDER BY created_at',id)};},
  resolve({actor,reportId,action,reason}){
   actor=text(actor,120,'Operator',3);reason=text(reason,1000,'Resolution',3);
   if(!['dismiss','resolve','mute-user','suspend-user','restore-user','remove-message','remove-moment','remove-comment'].includes(action))fail(400,'INVALID_ACTION','Invalid moderation action');
   return transaction(()=>{const r=one('SELECT * FROM social_reports WHERE id=?',reportId);if(!r)fail(404,'REPORT_NOT_FOUND','Report not found');if(r.status!=='pending')fail(409,'REPORT_HANDLED','This report is already resolved');const evidence=JSON.parse(r.evidence);let target=r.target_id;
    if(['mute-user','suspend-user','restore-user'].includes(action)){if(r.target_type==='message')target=evidence.senderId;else if(r.target_type!=='user')fail(400,'INVALID_TARGET','Use a user or message report for account restrictions');if(!accountById(target))fail(404,'USER_NOT_FOUND','Account not found');const state=action==='mute-user'?'muted':action==='suspend-user'?'suspended':'active';run('INSERT INTO account_restrictions VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at',target,state,reason,now());run('UPDATE accounts SET revision=revision+1 WHERE id=?',target);}
    if(action==='remove-message'){if(r.target_type!=='message')fail(400,'INVALID_TARGET','Use a message report');run('INSERT OR IGNORE INTO message_moderation VALUES(?,?,?)',Number(target),reason,now());}
    if(action==='remove-moment'||action==='remove-comment'){if(r.target_type!==(action==='remove-moment'?'moment':'comment'))fail(400,'INVALID_TARGET','Content type does not match action');if(!ctx.moderateContent?.({action,targetId:target,now:now()}))fail(404,'REPORT_TARGET_NOT_FOUND','Content not available');}
    run('UPDATE social_reports SET status=?,resolution=?,resolved_at=? WHERE id=?',action==='dismiss'?'rejected':'resolved',reason,now(),r.id);run('INSERT INTO social_moderation_audit VALUES(?,?,?,?,?,?,?)',randomUUID(),actor,r.id,action,target,reason,now());return {ok:true,report:reportView(one('SELECT * FROM social_reports WHERE id=?',r.id))};
   });
  }
 };
 return {handle,admin,isBlocked,restriction,assertActive,assertCanPublish,requireUnblocked,ownBlocks};
}

// This local-only administration entry point is never registered as a public API.
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const usage='Usage: node server/social-moderation.mjs <existing-social.sqlite> list [pending|resolved|rejected|all]\n       node server/social-moderation.mjs <existing-social.sqlite> show <report-id>\n       node server/social-moderation.mjs <existing-social.sqlite> resolve\nFor resolve, send one JSON object on stdin: {"actor":"operator name","reportId":"...","action":"dismiss|resolve|mute-user|suspend-user|restore-user|remove-message|remove-moment|remove-comment","reason":"review reason"}. Uses only the explicitly selected real social database; no default path.';
 let raw;
 try{const [filename,command,arg]=process.argv.slice(2);if(!filename||!['list','show','resolve'].includes(command)){console.log(usage);process.exitCode=filename?1:0;}else{const {realpathSync}=await import('node:fs');const {DatabaseSync}=await import('node:sqlite');const file=realpathSync(filename);raw=new DatabaseSync(file,{readOnly:command!=='resolve',timeout:5000});const tables=raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);if(!['accounts','social_migrations','social_reports','social_moderation_audit'].every(t=>tables.includes(t))||tables.includes('admin_settings'))throw new Error('Refusing a database that is not the real social schema.');raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');const {createSocialService}=await import('./social-service.mjs');const admin=createSocialService({database:{raw}}).moderation;let result;if(command==='list')result=admin.list(arg);else if(command==='show')result=admin.show(arg);else{let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>8000)throw new Error('Input too large');}result=admin.resolve(JSON.parse(input));}console.log(JSON.stringify(result,null,2));}}
 catch(error){console.error(error.message);process.exitCode=1;}finally{raw?.close();}
}
