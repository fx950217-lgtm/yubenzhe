const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const providerName=id=>({codex:'Codex',claude:'Claude',workb:'WorkB',ollama:'Ollama'})[id]||id;
export const rosterKey=row=>row.deviceId+':'+row.provider;
export function rosterCandidates(devices){
 if(!Array.isArray(devices))throw Error('电脑列表暂不可用');
 const seen=new Set(),rows=[];
 for(const device of devices){
  if(!uuid(device?.id)||device.revoked||device.paired!==true||!Array.isArray(device.providers))continue;
  for(const p of device.providers){
   if(p?.installed!==true||typeof p.id!=='string'||!/^[a-z][a-z0-9-]{1,23}$/.test(p.id))continue;
   const row={deviceId:device.id,provider:p.id,label:String(device.name||'我的电脑').slice(0,60)+' · '+providerName(p.id),available:(device.aiOnline??device.online)===true&&!device.providersStale&&p.executionSupported===true&&(p.id==='codex'&&p.loggedIn===true&&p.executionMode==='tools'||p.id==='ollama'&&p.loggedIn===null&&p.executionMode==='chat-only')};
   if(!seen.has(rosterKey(row))){seen.add(rosterKey(row));rows.push(row);}
  }
 }
 return rows;
}
export function validateRosterSelection(members,candidates){
 if(!Array.isArray(members)||members.length>3)throw Error('AI 名单最多 3 个');
 const seen=new Set();
 return members.map(row=>{
  const candidate=candidates.find(item=>rosterKey(item)===rosterKey(row));
  if(!candidate||seen.has(rosterKey(row)))throw Error('只能选择自己已绑定电脑上的 AI，同一 AI 不能重复');
  seen.add(rosterKey(row));const alias=String(row.alias||'').trim();
  if(!alias||alias.length>40||/[\x00-\x1f\x7f]/.test(alias))throw Error('请为每个 AI 填写 1–40 字备注，不含控制字符');
  return {...(uuid(row.id)?{id:row.id}:{}),deviceId:candidate.deviceId,provider:candidate.provider,alias};
 });
}
export function rosterFields(target,disabled=''){
 const members=target.aiMembers||[],choices=target.aiCandidates||[];
 return '<fieldset class="live-ai-roster"><legend>AI 名单 · 最多 3 个</legend><p class="live-note">选择自己电脑上的 AI，并给它备注。群友只看到备注，不能操作或单聊你的设备。加入名单不会开启讨论或执行任务。</p>'+(target.aiLoading?'<p role="status">正在读取我的电脑与 AI…</p>':'')+(target.aiError?'<p class="live-error" role="alert">'+esc(target.aiError)+'</p><button type="button" class="live-text" data-action="reload-ai-roster" '+disabled+'>重新读取名单</button>':'')+(target.aiCanManage===false?'<p class="live-note">只有群主可编辑自己电脑的 AI 名单。</p>':'')+(target.aiCanManage!==false?'<div class="live-ai-options">'+choices.map(choice=>'<label><input type="checkbox" name="rosterChoice" value="'+esc(rosterKey(choice))+'" '+(members.some(row=>rosterKey(row)===rosterKey(choice))?'checked ':'')+(disabled||target.aiLoading?'disabled':'')+'/><span>'+esc(choice.label)+'<small>'+esc(choice.available?'当前可执行':'可加入名单；当前不可执行，请到电脑检查 AI 状态')+'</small></span></label>').join('')+'</div>':'')+(members.length?'<div class="live-ai-aliases">'+members.map((row,index)=>'<label class="live-field">AI 备注 '+(index+1)+'<input name="rosterAlias'+index+'" data-roster-index="'+index+'" maxlength="40" value="'+esc(row.alias)+'" '+(disabled||target.aiCanManage===false?'disabled':'')+'/>'+(target.aiCanManage!==false?'<button type="button" class="live-text" data-action="remove-roster-ai" data-index="'+index+'" '+disabled+'>移除</button>':'')+'</label>').join('')+'</div>':!target.aiLoading&&!target.aiError?'<p class="live-note">尚未选择 AI，可先与好友建群。</p>':'')+'</fieldset>';
}
export async function saveRosterDraft(service,target,isCurrent=()=>true){
 if(!isCurrent())throw Object.assign(Error('账号或页面已改变'),{code:'STALE_RESPONSE'});
 if(!Number.isSafeInteger(target.aiVersion)||target.aiVersion<0)throw Error('请先重新读取 AI 名单版本');
 const members=validateRosterSelection(target.aiMembers||[],target.aiCandidates||[]);
 const fingerprint=JSON.stringify({version:target.aiVersion,members});
 if(target.rosterCommand?.fingerprint!==fingerprint)target.rosterCommand={fingerprint,input:{requestId:crypto.randomUUID(),version:target.aiVersion,members}};
 const result=await service.authenticatedRequest('group-device-ai/groups/'+encodeURIComponent(target.conversationId)+'/roster',{method:'POST',input:target.rosterCommand.input});
 if(!isCurrent())throw Object.assign(Error('账号或页面已改变'),{code:'STALE_RESPONSE'});
 if(!Number.isSafeInteger(result?.version)||!Array.isArray(result.members))throw Error('AI 名单保存结果尚未确认，请重试核对');
 target.aiVersion=result.version;target.aiMembers=result.members;target.rosterCommand=null;return result;
}
export async function createDiscussionDraft(service,target,input,isCurrent=()=>true){
 if(!isCurrent())throw Object.assign(Error('账号或页面已改变'),{code:'STALE_RESPONSE'});
 // Validate before the first mutation. Keep a confirmed group ID even when the
 // following roster operation fails, so retry can never create another group.
 if(!target.conversationId){
  validateRosterSelection(target.aiMembers||[],target.aiCandidates||[]);
  const result=await service.createGroup(input);
  if(!isCurrent())throw Object.assign(Error('账号或页面已改变'),{code:'STALE_RESPONSE'});
  if(typeof result?.conversationId!=='string'||!result.conversationId)throw Error('建群结果尚未确认，请重试核对');
  target.conversationId=result.conversationId;target.groupCreated=true;
 }
 if(target.aiMembers?.length||target.rosterCommand){
  try{await saveRosterDraft(service,target,isCurrent);}catch(error){if(error.code==='STALE_RESPONSE'||error.code==='SESSION_CHANGED')throw error;throw Object.assign(Error('讨论组已创建；AI 名单尚未确认。请重试保存名单，或进入已创建的讨论组。'+(error.message||'')),{status:error.status,code:error.code});}
 }
 return {conversationId:target.conversationId};
}
