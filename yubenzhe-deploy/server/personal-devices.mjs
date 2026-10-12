import {readAIProviders,aiLoginReminders} from './ai-providers.mjs';

import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {fail,fields,text,imageData} from './social-validation.mjs';
import {createDeviceClaims} from './device-claims.mjs';
import {readDeviceCapabilities,updateDeviceMetadata} from './device-capabilities.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const keys=new Set(['Enter','Backspace','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','Delete','Home','End','PageUp','PageDown','Ctrl+C','Ctrl+V','Ctrl+A','Ctrl+Z']);
export function createPersonalDevices({database,socialService,now=Date.now,onDeviceRevoked=()=>{}}){
 const db=database.raw,frames=new Map(),payloads=new Map();
 const one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
 function owned(account,id){const r=one('SELECT * FROM personal_devices WHERE id=? AND owner_id=?',id,account.id);if(!r)fail(404,'DEVICE_NOT_FOUND','设备不存在。');return r;}
 const live=r=>!r.revoked_at&&r.session_id&&r.session_until>now()&&r.viewer_until>now();
 function view(r){const ai=one('SELECT * FROM ai_channel_devices WHERE device_id=?',r.id),lastSeen=Math.max(r.last_seen||0,ai?.last_seen||0)||null;const awaitingConnection=!r.revoked_at&&!r.token_hash&&!!one('SELECT 1 FROM device_pair_claims WHERE device_id=? AND delivery_expires>?',r.id,now());const report=readAIProviders(ai,now()),aiOnline=Boolean(!r.revoked_at&&r.token_hash&&ai?.last_seen&&ai.last_seen>now()-20000);return {providers:report.providers,scannedAt:report.scannedAt,providersStale:report.stale,aiOnline,loginReminders:aiLoginReminders(report,{online:aiOnline}),id:r.id,name:r.name,paired:!!r.token_hash,awaitingConnection,online:!r.revoked_at&&!!lastSeen&&lastSeen>now()-20000,screenOnline:!r.revoked_at&&!!r.last_seen&&r.last_seen>now()-20000,revoked:!!r.revoked_at,lastSeen,screenLastSeen:r.last_seen,sessionId:live(r)?r.session_id:null,sessionUntil:live(r)?r.session_until:null,status:r.agent_status,source:r.source,capabilities:readDeviceCapabilities(r),capabilitiesAt:r.capabilities_at};}
 function stop(id){run("UPDATE personal_devices SET session_id=NULL,session_until=NULL,viewer_until=NULL WHERE id=?",id);run("UPDATE personal_device_commands SET status='expired' WHERE device_id=? AND status IN('queued','sent')",id);frames.delete(id);for(const [key,p]of payloads)if(p.deviceId===id)payloads.delete(key);}
 function metadata(device,input){updateDeviceMetadata(db,device,input,now());if(input.capabilities?.screen?.state==='unsupported')stop(device.id);}
 function active(r,session){if(!live(r)||session!==r.session_id)fail(409,'CONTROL_EXPIRED','控制已停止或授权已到期，请重新连接。');}
 function agent(token){
  if(typeof token!=='string'||token.length!==43)fail(401,'DEVICE_AUTH_REQUIRED','设备凭据无效。');
  const r=one('SELECT * FROM personal_devices WHERE token_hash=? AND revoked_at IS NULL',hash(token));
  if(!r||!one('SELECT 1 FROM accounts WHERE id=? AND deleted_at=0',r.owner_id)||one("SELECT 1 FROM account_restrictions WHERE account_id=? AND state<>'active'",r.owner_id))fail(401,'DEVICE_AUTH_REQUIRED','设备已撤销或账号不可用。');
  return r;
 }
 function command(input){
  fields(input,['requestId','sessionId','kind','x','y','text','key','delta']);
  text(input.requestId,80,'请求编号',8);text(input.sessionId,80,'会话编号',8);
  if(['click','doubleclick','rightclick'].includes(input.kind)){
   if(!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x<0||input.x>1||input.y<0||input.y>1)fail(400,'INVALID_POINTER','坐标无效。');
   return {kind:input.kind,x:input.x,y:input.y};
  }
  if(input.kind==='text')return {kind:'text',text:text(input.text,500,'输入文字',1)};
  if(input.kind==='key'&&keys.has(input.key))return {kind:'key',key:input.key};
  if(input.kind==='scroll'&&[-3,-1,1,3].includes(input.delta))return {kind:'scroll',delta:input.delta};
  fail(400,'INVALID_COMMAND','不支持这个操作。');
 }
 const claims=createDeviceClaims({database,now,view,authenticateDevice:agent});
 return {
  authenticateAgent:agent,
  ownedDevice:owned,
  updateMetadata:metadata,
  claimMachine:claims.machine,
  maintain(){claims.maintain();for(const [id,f]of frames)if(f.time<now()-10000)frames.delete(id);for(const [id,p]of payloads)if(p.expiresAt<=now())payloads.delete(id);run("UPDATE personal_device_commands SET status='expired' WHERE status IN('queued','sent') AND expires_at<=?",now());},
  resetSessions(){for(const r of db.prepare('SELECT id FROM personal_devices WHERE session_id IS NOT NULL').all())stop(r.id);},
  cleanup(owner){for(const r of db.prepare('SELECT id FROM personal_devices WHERE owner_id=?').all(owner)){stop(r.id);onDeviceRevoked(r.id);}run('DELETE FROM personal_device_commands WHERE device_id IN(SELECT id FROM personal_devices WHERE owner_id=?)',owner);run('DELETE FROM personal_devices WHERE owner_id=?',owner);},
  handle({method,path,input={},query={},token,ip,devicePeerIp}){
   const account=socialService.assertAIAccess(token,{write:method==='POST'});
   const parts=path.split('/'),id=parts[1],action=parts[2];
   if(path==='devices'&&method==='GET')return {devices:db.prepare('SELECT * FROM personal_devices WHERE owner_id=? ORDER BY created_at DESC LIMIT 20').all(account.id).map(view)};
   if(path==='devices/claim'&&method==='POST')return claims.claim(account,input,devicePeerIp??ip);
   if(path==='devices/conversations'&&method==='GET')return {conversations:db.prepare('SELECT * FROM personal_devices WHERE owner_id=? AND token_hash IS NOT NULL AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 5').all(account.id).map(r=>({id:'device:'+r.id,kind:'device',deviceId:r.id,name:r.name,source:r.source,capabilities:readDeviceCapabilities(r),online:view(r).online,route:'#workbench/devices/'+r.id+'/chat'}))};
   if(path==='devices/pair'&&method==='POST'){
    fields(input,['name']);const name=text(input.name,60,'设备名称',1);
    return transaction(()=>{
     run('UPDATE personal_devices SET revoked_at=?,pair_hash=NULL WHERE owner_id=? AND token_hash IS NULL AND pair_expires<? AND revoked_at IS NULL',now(),account.id,now());
     if(one('SELECT COUNT(*) n FROM personal_devices WHERE owner_id=? AND revoked_at IS NULL',account.id).n>=5)fail(429,'DEVICE_LIMIT','最多连接 5 台设备，请先撤销不再使用的设备。');
     const id=randomUUID(),pairToken=secret(),time=now();
     run('INSERT INTO personal_devices(id,owner_id,name,pair_hash,pair_expires,created_at) VALUES(?,?,?,?,?,?)',id,account.id,name,hash(pairToken),time+600000,time);
     return {deviceId:id,pairToken,expiresAt:time+600000};
    });
   }
   const r=owned(account,id);
   if(method==='GET'&&action==='frame'){
    active(r,query.sessionId||'');
    const f=frames.get(id);return {frame:f&&f.sessionId===r.session_id&&f.time>now()-10000?f:null,device:view(r)};
   }
   if(method==='GET'&&action==='state')return {device:view(r),commands:db.prepare('SELECT id,status FROM personal_device_commands WHERE device_id=? ORDER BY created_at DESC LIMIT 8').all(id)};
   if(method==='POST'&&action==='start'){
    fields(input,[]);if(r.revoked_at||!r.token_hash)fail(409,'DEVICE_UNPAIRED','请先连接电脑。');
    if(readDeviceCapabilities(r).screen.state==='unsupported')fail(409,'DEVICE_SCREEN_UNAVAILABLE',readDeviceCapabilities(r).screen.reason||'这台设备不支持屏幕远控。');
    if(!r.last_seen||r.last_seen<now()-20000)fail(409,'DEVICE_OFFLINE','电脑当前离线，请启动连接器。');
    stop(id);const sessionId=randomUUID(),until=now()+600000;
    run('UPDATE personal_devices SET session_id=?,session_until=?,viewer_until=? WHERE id=?',sessionId,until,now()+15000,id);
    return {device:view(owned(account,id))};
   }
   if(method==='POST'&&action==='heartbeat'){fields(input,['sessionId']);active(r,input.sessionId);run('UPDATE personal_devices SET viewer_until=? WHERE id=?',Math.min(r.session_until,now()+15000),id);return {alive:true};}
   if(method==='POST'&&action==='stop'){fields(input,[]);stop(id);return {stopped:true};}
   if(method==='POST'&&action==='revoke'){fields(input,[]);stop(id);run('UPDATE personal_devices SET revoked_at=?,token_hash=NULL,pair_hash=NULL WHERE id=?',now(),id);onDeviceRevoked(id);return {revoked:true};}
   if(method==='POST'&&action==='input'){
    active(r,input.sessionId);const payload=JSON.stringify(command(input));
    return transaction(()=>{
     const prev=one('SELECT * FROM personal_device_commands WHERE device_id=? AND request_id=?',id,input.requestId);
     if(prev){if(prev.payload!==hash(payload)||prev.session_id!==input.sessionId)fail(409,'IDEMPOTENCY_CONFLICT','请求编号已使用。');return {commandId:prev.id,status:prev.status};}
     if(one("SELECT COUNT(*) n FROM personal_device_commands WHERE device_id=? AND status='queued' AND expires_at>?",id,now()).n>=20)fail(429,'DEVICE_BUSY','操作队列繁忙，请稍后重试。');
     const commandId=randomUUID();run("INSERT INTO personal_device_commands VALUES(?,?,?,?,?,'queued',?,?)",commandId,id,r.session_id,input.requestId,hash(payload),now(),now()+15000);payloads.set(commandId,{deviceId:id,payload,expiresAt:now()+15000});
     return {commandId,status:'queued'};
    });
   }
   fail(404,'NOT_FOUND','设备接口不存在。');
  },
  frame({token,id,sessionId}){
   const account=socialService.authenticate(token),r=owned(account,id);active(r,sessionId);
   const f=frames.get(id);
   return {frame:f&&f.sessionId===r.session_id&&f.time>now()-10000?f:null,device:view(r)};
  },
  enroll(input){
   fields(input,['pairToken']);if(typeof input.pairToken!=='string'||input.pairToken.length!==43)fail(401,'PAIR_EXPIRED','配对码无效。');
   return transaction(()=>{
    const r=one('SELECT * FROM personal_devices WHERE pair_hash=? AND pair_expires>? AND revoked_at IS NULL AND token_hash IS NULL',hash(input.pairToken),now());
    if(!r)fail(401,'PAIR_EXPIRED','配对码已过期或已使用，请重新创建。');
    const token=secret();run('UPDATE personal_devices SET token_hash=?,pair_hash=NULL,last_seen=? WHERE id=?',hash(token),now(),r.id);
    return {deviceId:r.id,name:r.name,token};
   });
  },
  poll(token,input){
   fields(input,['sessionId','frame','ack','status','localStop','source','capabilities']);
   return transaction(()=>{
    let r=agent(token);
    if(input.localStop===true){stop(r.id);r=agent(token);}
    if(input.status!==undefined&&!['ready','screen-unavailable','control-error','stopped'].includes(input.status))fail(400,'INVALID_STATUS','设备状态无效。');
    metadata(r,input);r=agent(token);
    run('UPDATE personal_devices SET last_seen=?,agent_status=? WHERE id=?',now(),input.status||'ready',r.id);
    if(input.sessionId&&live(r)&&input.sessionId===r.session_id){
     if(input.frame){
      const img=imageData(input.frame,450*1024);
      if(img.mime!=='image/jpeg')fail(400,'INVALID_FRAME','屏幕只支持 JPEG。');
      frames.set(r.id,{sessionId:r.session_id,image:input.frame,width:img.width,height:img.height,time:now()});
     }
     if(input.ack!==undefined){
      if(!Array.isArray(input.ack)||input.ack.length>20)fail(400,'INVALID_ACK','回执无效。');
      for(const ack of input.ack){if(!ack||typeof ack.id!=='string'||!['done','failed'].includes(ack.status))fail(400,'INVALID_ACK','回执无效。');if(run("UPDATE personal_device_commands SET status=? WHERE id=? AND device_id=? AND session_id=? AND status='sent'",ack.status,ack.id,r.id,r.session_id).changes)payloads.delete(ack.id);}
     }
    }
    run("UPDATE personal_device_commands SET status='expired' WHERE expires_at<? AND status IN('queued','sent')",now());
    run('DELETE FROM personal_device_commands WHERE created_at<?',now()-86400000);
    if(!live(r)){frames.delete(r.id);return {serverTime:now(),sessionId:null,sessionUntil:null,commands:[]};}
    const commands=db.prepare("SELECT * FROM personal_device_commands WHERE device_id=? AND session_id=? AND status='queued' AND expires_at>? ORDER BY created_at LIMIT 10").all(r.id,r.session_id,now());
    for(const c of commands)run("UPDATE personal_device_commands SET status='sent' WHERE id=?",c.id);
    return {serverTime:now(),sessionId:r.session_id,sessionUntil:Math.min(r.session_until,r.viewer_until),commands:commands.filter(c=>payloads.has(c.id)).map(c=>({id:c.id,...JSON.parse(payloads.get(c.id).payload),expiresAt:c.expires_at}))};
   });
  }
 };
}
