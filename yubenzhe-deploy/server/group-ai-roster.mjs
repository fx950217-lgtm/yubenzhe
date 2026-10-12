import {randomUUID,createHash} from 'node:crypto';
import {fail,fields,text} from './social-validation.mjs';
import {checkedProviderId,readAIProviders} from './ai-providers.mjs';
const uuid=value=>typeof value==='string'&&value.trim()===value&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createGroupAIRoster({database,devices,member,now=Date.now}={}){
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
 function ownerGroup(conversationId,ownerId){const c=member(conversationId,ownerId,{write:true});if(c.owner_id!==ownerId)fail(403,'GROUP_OWNER_REQUIRED','只有群主能加入和使用自己的设备 AI。');return c;}
 function privateDevice(row,viewerId){if(viewerId!==row.owner_id||!row.device_id)return null;const device=one('SELECT * FROM personal_devices WHERE id=? AND owner_id=? AND revoked_at IS NULL AND token_hash IS NOT NULL',row.device_id,viewerId);return device?.id||null;}
 function project(row,viewerId){const deviceId=privateDevice(row,viewerId);return {id:row.id,kind:'ai',alias:row.alias,provider:row.provider,ownerId:one('SELECT user_id FROM accounts WHERE id=?',row.owner_id)?.user_id||'',canChat:!!deviceId,...(deviceId?{deviceId}:{})};}
 function snapshot(conversationId,viewerId){const c=member(conversationId,viewerId);return {version:c.ai_roster_version,canManage:c.owner_id===viewerId,members:all('SELECT * FROM conversation_ai_roster WHERE conversation_id=? AND owner_id=? AND removed_at IS NULL ORDER BY position,id',c.id,c.owner_id).map(row=>project(row,viewerId))};}
 function save(conversationId,account,input={}){
  ownerGroup(conversationId,account.id);fields(input,['requestId','version','members']);
  if(!uuid(input.requestId)||!Number.isSafeInteger(input.version)||input.version<0)fail(400,'GROUP_AI_ROSTER_INPUT','名单版本或操作编号无效。');
  if(!Array.isArray(input.members)||input.members.length>3)fail(400,'GROUP_AI_ROSTER_INPUT','最多添加 3 个设备 AI。');
  const keys=new Set(),ids=new Set(),members=input.members.map(value=>{
   fields(value,['id','deviceId','provider','alias']);if(value.id!==undefined&&!uuid(value.id)||!uuid(value.deviceId))fail(400,'GROUP_AI_ROSTER_INPUT','AI 或设备编号无效。');
   const provider=checkedProviderId(value.provider),alias=text(value.alias,40,'AI 备注',1);if(/[\x00-\x1f\x7f]/.test(value.alias))fail(400,'GROUP_AI_ROSTER_INPUT','AI 备注不能包含控制字符。');
   const key=value.deviceId+':'+provider;if(keys.has(key)||value.id&&ids.has(value.id))fail(400,'GROUP_AI_ROSTER_DUPLICATE','不能重复加入同一个设备 AI。');keys.add(key);if(value.id)ids.add(value.id);
   return {id:value.id??null,deviceId:value.deviceId,provider,alias};
  }),signature=digest({conversationId,version:input.version,members});
  transaction(()=>{
   const c=ownerGroup(conversationId,account.id),old=one('SELECT * FROM conversation_ai_roster_commands WHERE owner_id=? AND request_id=?',account.id,input.requestId);
   if(old){if(old.digest!==signature)fail(409,'IDEMPOTENCY_CONFLICT','同一操作编号不能更改名单。');return;}
   if(c.ai_roster_version!==input.version)fail(409,'GROUP_AI_ROSTER_CHANGED','名单已在另一设备更改，请刷新。');
   const rows=members.map(value=>{
    const device=devices.ownedDevice(account,value.deviceId);if(device.revoked_at||!device.token_hash)fail(409,'GROUP_AI_DEVICE_REVOKED','请先连接有效的本人设备。');
    const report=readAIProviders(one('SELECT * FROM ai_channel_devices WHERE device_id=?',device.id),now());if(!report.providers.some(p=>p.id===value.provider&&p.installed))fail(409,'GROUP_AI_PROVIDER_UNAVAILABLE','电脑尚未检测到这个 AI，请在电脑安装后刷新。');
    const existing=value.id?one('SELECT * FROM conversation_ai_roster WHERE id=?',value.id):one('SELECT * FROM conversation_ai_roster WHERE conversation_id=? AND device_id=? AND provider=?',c.id,device.id,value.provider);
    if(value.id&&!existing||existing&&(existing.conversation_id!==c.id||existing.owner_id!==account.id||existing.device_id!==device.id||existing.provider!==value.provider))fail(404,'GROUP_AI_ROSTER_NOT_FOUND','AI 名单条目不存在或不属于此群与设备。');
    return {...value,id:existing?.id||randomUUID()};
   });
   run('UPDATE conversation_ai_roster SET removed_at=?,updated_at=? WHERE conversation_id=? AND removed_at IS NULL',now(),now(),c.id);
   for(const [position,row]of rows.entries())run('INSERT INTO conversation_ai_roster(id,conversation_id,owner_id,device_id,provider,alias,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET alias=excluded.alias,position=excluded.position,updated_at=excluded.updated_at,removed_at=NULL',row.id,c.id,account.id,row.deviceId,row.provider,row.alias,position,now(),now());
   run('UPDATE conversations SET ai_roster_version=ai_roster_version+1,updated_at=? WHERE id=?',now(),c.id);
   run('INSERT INTO conversation_ai_roster_commands VALUES(?,?,?,?,?)',account.id,input.requestId,c.id,signature,now());
  });return snapshot(conversationId,account.id);
 }
 function selected(conversationId,ownerId,{rosterIds,deviceId,providers}={}){
  ownerGroup(conversationId,ownerId);let rows;
  if(rosterIds!==undefined){
   if(deviceId!==undefined||providers!==undefined||!Array.isArray(rosterIds)||rosterIds.length<1||rosterIds.length>3||rosterIds.some(id=>!uuid(id))||new Set(rosterIds).size!==rosterIds.length)fail(400,'GROUP_AI_PROVIDERS','请选择一到三个不同名单 AI，不要同时指定旧版设备字段。');
   rows=rosterIds.map(id=>one('SELECT * FROM conversation_ai_roster WHERE id=? AND conversation_id=? AND owner_id=? AND removed_at IS NULL',id,conversationId,ownerId));
  }else{
   if(!uuid(deviceId)||!Array.isArray(providers)||providers.length<1||providers.length>3||new Set(providers).size!==providers.length)fail(400,'GROUP_AI_PROVIDERS','请选择一到三个名单中的 AI。');providers.forEach(checkedProviderId);
   rows=providers.map(provider=>one('SELECT * FROM conversation_ai_roster WHERE conversation_id=? AND owner_id=? AND device_id=? AND provider=? AND removed_at IS NULL',conversationId,ownerId,deviceId,provider));
  }
  if(rows.some(row=>!row))fail(409,'GROUP_AI_ROSTER_CHANGED','所选 AI 未加入当前群名单，请刷新。');
  if(new Set(rows.map(row=>row.device_id)).size!==1)fail(400,'GROUP_AI_DEVICE_MISMATCH','每次讨论请选择同一台电脑上的 AI。');
  for(const row of rows){const device=devices.ownedDevice({id:ownerId},row.device_id);if(device.revoked_at||!device.token_hash)fail(409,'GROUP_AI_DEVICE_REVOKED','设备已撤销或未连接。');}
  return rows;
 }
 function sessionRows(s){const c=ownerGroup(s.conversation_id,s.owner_id);if(c.ai_owner_revision!==s.owner_revision)fail(409,'GROUP_AI_ROSTER_CHANGED','群主已变更，请重新批准新的 AI 讨论。');let ids;try{ids=JSON.parse(s.roster_ids);}catch{}if(!Array.isArray(ids)||!ids.length)fail(409,'GROUP_AI_ROSTER_CHANGED','旧讨论没有明确的 AI 名单授权，请重新发起。');const rows=selected(s.conversation_id,s.owner_id,{rosterIds:ids});if(rows[0].device_id!==s.device_id||JSON.stringify(rows.map(r=>r.provider))!==s.providers)fail(409,'GROUP_AI_ROSTER_CHANGED','讨论的 AI 来源已改变，请重新发起。');return rows;}
 return {snapshot,save,selected,sessionRows,privateDevice};
}
