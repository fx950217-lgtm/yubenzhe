import {createHash,randomUUID} from 'node:crypto';
import {fail,fields,text,imageData} from './social-validation.mjs';

const id=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))fail(400,'INVALID_ID','记录标识无效。');return value;};
const parse=value=>{try{return JSON.parse(value)}catch{return []}};
// This service is reachable only behind the independent owner authorization in server.mjs.
// Views deliberately omit credentials, private chats, task inputs and generated file contents.
export function createProductAdmin({database,community,now=Date.now}){
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const person=account=>account?{id:account.id,userId:account.user_id,nickname:account.nickname,avatar:account.avatar,hasAvatar:!!account.avatar_key,revision:account.revision,deleted:!!account.deleted_at,...community.profileExtras(account.id)}:null;
 const owner=accountId=>person(one('SELECT id,user_id,nickname,avatar,avatar_key,revision,deleted_at FROM accounts WHERE id=?',accountId));
 const accountRow=row=>({...person(row),bio:row.bio,status:row.deleted_at?'deleted':row.state||'active',restrictionReason:row.restriction_reason||'',createdAt:row.created_at});
 const providerRow=row=>({id:row.id,owner:owner(row.account_id),kind:row.kind,name:row.name,category:row.category,description:row.description,pricing:row.pricing,languages:parse(row.languages),regions:parse(row.regions),status:row.status,revision:row.revision,reason:row.reason,certification:community.profileExtras(row.account_id).certifications.find(c=>c.kind===row.kind)||null,updatedAt:row.updated_at,infrastructureConnected:false});
 const tokenRow=row=>({id:row.id,owner:owner(row.account_id),name:row.name,symbol:row.symbol,description:row.description,supplyUnits:row.supply_units,decimals:row.decimals,recipient:row.recipient,status:row.status,revision:row.revision,reason:row.review_reason,createdAt:row.created_at,chainId:97,deployed:false,registered:false});
 const bountyRow=row=>({id:row.id,owner:owner(row.author_id),title:row.title,description:row.description,category:row.category,deliverables:row.deliverables,acceptance:row.acceptance,status:row.status,hidden:!!row.hidden,assetId:row.asset_id,rewardUnits:row.reward_units,decimals:row.decimals,deadline:row.deadline,partner:row.partner_id?owner(row.partner_id):null,partnerConfirmed:!!row.partner_confirmed,escrow:false,paymentVerification:'unavailable',createdAt:row.created_at});
 const reportRow=row=>({id:row.id,targetType:row.target_type,targetId:row.target_id,reason:row.reason,status:row.status,resolution:row.resolution,createdAt:row.created_at});
 const pointRow=row=>({id:row.owner_id,owner:owner(row.owner_id),available:row.available,reserved:row.reserved,status:row.closed_at===null?'active':'closed',unit:'POINT',updatedAt:row.updated_at});
 const taskRow=row=>({id:row.id,owner:owner(row.owner_id),title:row.title,operation:row.operation,status:row.status,step:row.step,version:row.version,billingUnit:row.billing_unit,estimatedPoints:row.estimated_points,budgetPoints:row.budget_points,reservedPoints:row.reserved_points,spentPoints:row.spent_points,releasedPoints:row.released_points,billingState:row.billing_state,errorCode:row.error_code,createdAt:row.created_at,updatedAt:row.updated_at});
 const definitions={
  accounts:{table:'accounts a LEFT JOIN account_restrictions r ON r.account_id=a.id',select:'a.*,r.state,r.reason restriction_reason',seq:'a.rowid',key:'a.id',search:"a.user_id||' '||a.nickname",status:"CASE WHEN a.deleted_at<>0 THEN 'deleted' ELSE coalesce(r.state,'active') END",map:accountRow},
  providers:{table:'community_providers',search:"name||' '||category",map:providerRow},
  tokens:{table:'community_token_applications',search:"name||' '||symbol",map:tokenRow},
  bounties:{table:'community_bounties',search:"title||' '||category",map:bountyRow},
  reports:{table:'community_reports',search:"target_type||' '||reason",map:reportRow},
  points:{table:'points_accounts',key:'owner_id',search:'owner_id',status:"CASE WHEN closed_at IS NULL THEN 'active' ELSE 'closed' END",map:pointRow},
  tasks:{table:'workbench_tasks',search:"title||' '||operation||' '||owner_id",map:taskRow},
 };
 function listing(kind,query){
  fields(query,['q','status','before']);const q=text(query.q||'',120,'搜索词'),status=text(query.status||'',40,'状态'),before=query.before===undefined?Number.MAX_SAFE_INTEGER:Number(query.before);
  if(!Number.isSafeInteger(before)||before<1)fail(400,'INVALID_CURSOR','分页位置无效。');
  if(kind==='audit'){
   // Idempotency envelopes store machine results; never display them as operator audit rows.
   const rows=all("SELECT * FROM community_audit WHERE id<? AND action NOT LIKE 'request:%' AND (?='' OR instr(lower(actor||' '||action||' '||target||' '||reason),lower(?))>0) ORDER BY id DESC LIMIT 51",before,q,q);
   return {items:rows.slice(0,50).map(r=>({id:String(r.id),actor:r.actor,action:r.action,target:r.target,reason:r.reason,createdAt:r.created_at})),nextBefore:rows.length>50?String(rows[49].id):null,readOnly:true};
  }
  const d=definitions[kind];if(!d)fail(404,'PRODUCT_ADMIN_NOT_FOUND','管理入口不存在。');
  const seq=d.seq||'rowid',rows=all(`SELECT ${d.select||'*'},${seq} AS seq FROM ${d.table} WHERE ${seq}<? AND (?='' OR instr(lower(${d.search}),lower(?))>0) AND (?='' OR ${d.status||'status'}=?) ORDER BY ${seq} DESC LIMIT 51`,before,q,q,status,status);
  return {items:rows.slice(0,50).map(d.map),nextBefore:rows.length>50?String(rows[49].seq):null,readOnly:['points','tasks','bounties'].includes(kind)};
 }
 function detail(kind,recordId){
  const d=definitions[kind];if(!d)fail(404,'PRODUCT_ADMIN_NOT_FOUND','管理入口不存在。');
  const row=one(`SELECT ${d.select||'*'} FROM ${d.table} WHERE ${d.key||'id'}=?`,id(recordId));if(!row)fail(404,'RECORD_NOT_FOUND','记录不存在。');const item=d.map(row);
  const audit=all("SELECT id,actor,action,target,reason,created_at AS createdAt FROM community_audit WHERE target=? AND action NOT LIKE 'request:%' ORDER BY id DESC LIMIT 50",recordId);
  if(kind==='accounts')return {item,audit,moderationAudit:all('SELECT actor,action,reason,created_at AS createdAt FROM social_moderation_audit WHERE target_id=? ORDER BY created_at DESC LIMIT 50',recordId)};
  if(kind==='reports'){
   const type=row.target_type;let content=null;
   if(type==='bounty'){const r=one('SELECT * FROM community_bounties WHERE id=?',row.target_id);if(r)content=bountyRow(r);}
   if(type==='provider'){const r=one('SELECT * FROM community_providers WHERE id=?',row.target_id);if(r)content=providerRow(r);}
   if(type==='comment'||type==='review'){const r=one('SELECT * FROM '+(type==='comment'?'community_comments':'community_reviews')+' WHERE id=?',row.target_id);if(r)content={id:r.id,bountyId:r.bounty_id,body:r.body,hidden:!!r.hidden,owner:owner(r.account_id||r.author_id),createdAt:r.created_at};}
   return {item,audit,content,evidenceScope:'current-content'};
  }
  if(kind==='points'){
   const entries=all('SELECT e.transaction_id,e.account_key,e.delta FROM points_entries e JOIN points_transactions t ON t.id=e.transaction_id WHERE t.owner_id=?',recordId);
   let available=0n,reserved=0n;const totals=new Map(),ownerTotals=new Map();for(const entry of entries){const delta=BigInt(entry.delta);totals.set(entry.transaction_id,(totals.get(entry.transaction_id)||0n)+delta);if(entry.account_key===recordId+':available')available+=delta;if(entry.account_key===recordId+':reserved')reserved+=delta;if([recordId+':available',recordId+':reserved'].includes(entry.account_key))ownerTotals.set(entry.transaction_id,(ownerTotals.get(entry.transaction_id)||0n)+delta);}
   const reservations=all('SELECT resource_id AS taskId,amount,spent,released,status,updated_at AS updatedAt FROM points_reservations WHERE owner_id=? ORDER BY updated_at DESC',recordId),held=reservations.filter(r=>r.status==='reserved').reduce((sum,r)=>sum+BigInt(r.amount),0n);
   const journals=all('SELECT id,delta FROM points_transactions WHERE owner_id=?',recordId);
   const balanced=[...totals.values()].every(total=>total===0n),consistent=journals.every(t=>BigInt(t.delta)===(ownerTotals.get(t.id)||0n)),matches=available===BigInt(row.available)&&reserved===BigInt(row.reserved)&&held===reserved;
   const ledger=all('SELECT id,reason,delta,status,resource_id AS taskId,created_at AS createdAt FROM points_transactions WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 101',recordId);
   return {item,audit,reconciliation:{ok:balanced&&consistent&&matches&&available>=0n&&reserved>=0n,journalsBalanced:balanced,journalsConsistent:consistent,accountMatches:matches,derivedAvailable:available.toString(),derivedReserved:reserved.toString(),activeReservations:held.toString()},ledger:ledger.slice(0,100),ledgerTruncated:ledger.length>100,reservations:reservations.slice(0,100),reservationsTruncated:reservations.length>100,readOnly:true};
  }
  if(kind==='tasks')return {item,audit,events:all('SELECT id,event,created_at AS createdAt FROM workbench_events WHERE task_id=? ORDER BY created_at DESC LIMIT 100',recordId),usage:all('SELECT event_key AS event,step,created_at AS createdAt FROM workbench_usage WHERE task_id=? ORDER BY created_at DESC LIMIT 100',recordId),files:all('SELECT kind,count(*) AS count FROM workbench_files WHERE task_id=? GROUP BY kind',recordId),readOnly:true};
  return {item,audit};
 }
 function accountAction(recordId,input,actor){
  fields(input,['requestId','revision','action','reason']);id(recordId);id(input.requestId);const reason=text(input.reason,1000,'处理原因',3);
  if(!Number.isSafeInteger(input.revision)||input.revision<1||!['mute','suspend','restore','remove-avatar'].includes(input.action))fail(400,'INVALID_ACTION','处理方式或版本无效。');
  const key='request:product:'+actor+':'+input.requestId,digest=createHash('sha256').update(JSON.stringify([recordId,input.revision,input.action,reason])).digest('hex');
  db.exec('BEGIN IMMEDIATE');try{
   const previous=one('SELECT actor,reason FROM community_audit WHERE action=?',key);if(previous){if(previous.actor!==digest)fail(409,'REQUEST_CONFLICT','同一请求不能修改内容。');const result=JSON.parse(previous.reason);db.exec('COMMIT');return result;}
   const a=one('SELECT * FROM accounts WHERE id=? AND deleted_at=0',recordId);if(!a)fail(404,'ACCOUNT_NOT_FOUND','账号不存在或已注销。');if(a.revision!==input.revision)fail(409,'REVISION_CHANGED','账号资料已改变，请刷新后重新核对。');
   const prior=one('SELECT state FROM account_restrictions WHERE account_id=?',recordId)?.state||'active';
   if(input.action==='remove-avatar'){if(!a.avatar_key&&!a.avatar_image)fail(409,'AVATAR_ALREADY_REMOVED','账号当前没有上传头像。');run("UPDATE accounts SET avatar_image='',avatar_key='',revision=revision+1 WHERE id=?",recordId);}
   else{const state={mute:'muted',suspend:'suspended',restore:'active'}[input.action];if(prior===state)fail(409,'STATE_UNCHANGED','账号已经处于这个状态。');run('INSERT INTO account_restrictions VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at',recordId,state,reason,now());run('UPDATE accounts SET revision=revision+1 WHERE id=?',recordId);if(state==='suspended')run('DELETE FROM social_sessions WHERE account_id=?',recordId);}
   run('INSERT INTO social_moderation_audit VALUES(?,?,?,?,?,?,?)',randomUUID(),actor,null,'account-'+input.action,recordId,reason,now());
   run('INSERT INTO community_audit(actor,action,target,reason,created_at) VALUES(?,?,?,?,?)',actor,'account-'+input.action,recordId,reason,now());
   const result={ok:true,...detail('accounts',recordId)};run('INSERT INTO community_audit(actor,action,target,reason,created_at) VALUES(?,?,?,?,?)',digest,key,recordId,JSON.stringify(result),now());db.exec('COMMIT');return result;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function handle({method,path,input={},query={},actor}){
  if(typeof actor!=='string'||!actor||actor.length>200)fail(403,'ADMIN_REQUIRED','需要独立管理端授权。');
  const match=/^(accounts|providers|tokens|bounties|reports|points|tasks)(?:\/([a-f0-9-]{36})(?:\/(actions|avatar))?)?$/.exec(path);
  if(method==='GET'&&path==='audit')return listing('audit',query);
  if(!match)fail(404,'PRODUCT_ADMIN_NOT_FOUND','管理入口不存在。');const [,kind,recordId,action]=match;
  if(method==='POST'&&kind==='accounts'&&recordId&&action==='actions')return accountAction(recordId,input,actor);
  if(method!=='GET'||action&&action!=='avatar')fail(405,'METHOD_NOT_ALLOWED','此管理入口不支持该操作。');
  if(action==='avatar'){fields(query,[]);if(kind!=='accounts')fail(404,'RECORD_NOT_FOUND','头像不存在。');const account=one('SELECT avatar_image FROM accounts WHERE id=? AND deleted_at=0',id(recordId));if(!account?.avatar_image)fail(404,'AVATAR_NOT_FOUND','头像不存在。');const image=imageData(account.avatar_image,256*1024);return {binary:image.bytes,mime:image.mime};}
  if(recordId){fields(query,[]);if(kind==='points'){
   // Frontend and admin are separate SQLite writers; reconcile one consistent snapshot.
   db.exec('BEGIN');try{const result=detail(kind,recordId);db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}
  }return detail(kind,recordId);}return listing(kind,query);
 }
 return {handle};
}
