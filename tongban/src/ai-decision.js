import './ai-decision.css';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const expiry=value=>typeof value==='number'?value:Date.parse(value);
export function actionableDecision(decision,now=Date.now()){
 return !!decision&&uuid(decision.id)&&Number.isSafeInteger(decision.version)&&decision.version>=1&&decision.status==='pending'&&decision.available===true&&decision.continuationSupported===true&&Number.isFinite(expiry(decision.expiresAt))&&expiry(decision.expiresAt)>now&&typeof decision.digest==='string'&&decision.digest.length>0&&typeof decision.question==='string'&&decision.question.trim().length>0&&Array.isArray(decision.options)&&decision.options.length>=2&&decision.options.length<=4&&new Set(decision.options.map(option=>option?.id)).size===decision.options.length&&decision.options.every(option=>/^option-[1-4]$/.test(option?.id)&&typeof option.label==='string'&&option.label.trim());
}
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
export function createDecisionController({client,owner,storage,isCurrent=()=>true}={}){
 let active=true;const records=new Map();try{storage??=globalThis.localStorage;}catch{}
 const valid=()=>active&&typeof owner==='string'&&owner.length>0&&isCurrent()&&client.getProfile()?.userId===owner;
 // One durable command per immutable decision ID, so a terminal read whose
 // server version has advanced can clear the original uncertain command.
 const key=(taskId,decision)=>'ybz.ai-decision.request.v1.'+[owner,taskId,decision.id].map(value=>encodeURIComponent(value)).join('.');
 const stateKey=(taskId,decision)=>taskId+':'+decision.id+':'+decision.version;
 const state=(taskId,decision)=>records.get(stateKey(taskId,decision))||{};
 async function observe(taskId,decision){
  if(!valid()||!uuid(taskId)||!decision?.id)return;
  const id=stateKey(taskId,decision),current=records.get(id);if(current?.busy)return;
  if(decision.status!=='pending'){try{storage?.removeItem(key(taskId,decision));}catch{}for(const recordId of records.keys())if(recordId.startsWith(taskId+':'+decision.id+':'))records.delete(recordId);return;}
  if(current?.requestId)return;
  let saved;try{saved=JSON.parse(storage?.getItem(key(taskId,decision))||'null');}catch{return;}
  if(!uuid(saved?.requestId)||typeof saved?.digest!=='string')return;
  let optionId=null;for(const option of decision.options||[]){if(await hash([decision.digest,option.id])===saved.digest)optionId=option.id;if(!valid())return;}
  records.set(id,{requestId:saved.requestId,digest:saved.digest,optionId,unknown:true,error:'上次选择结果尚未确认。请刷新核对；重试仅使用原请求与原选项。'});
 }
 async function choose({taskId,decision,optionId,canDecide=true,deviceId=null}){
  if(!valid()||canDecide!==true||!uuid(taskId))return null;
  const id=stateKey(taskId,decision);if(records.get(id)?.busy)return null;
  if(!actionableDecision(decision)||!decision.options.some(option=>option.id===optionId)){records.set(id,{...state(taskId,decision),error:'此决策当前不可继续。请刷新查看真实状态；不会自动执行。'});return null;}
  const local={...state(taskId,decision),busy:true,error:''};records.set(id,local);
  try{
   const digest=await hash([decision.digest,optionId]);if(!valid())return null;if(!actionableDecision(decision))throw Error('决策已过期或当前不可继续，请刷新核对。');
   let saved;try{
    saved=JSON.parse(storage?.getItem(key(taskId,decision))||'null');
    if(saved&&(!uuid(saved.requestId)||typeof saved.digest!=='string'))throw Error('invalid');
    if(saved)saved={requestId:saved.requestId,digest:saved.digest};
    if(local.requestId){
     if(local.digest!==digest)throw Object.assign(Error('上次选择结果仍未确认，不能改选另一项。请先刷新核对。'),{code:'DECISION_CHOICE_LOCKED'});
     if(saved&&(saved.requestId!==local.requestId||saved.digest!==local.digest))throw Object.assign(Error('其他页面更改了本机请求编号。请刷新核对，暂不重新授权执行。'),{code:'DECISION_REQUEST_CONFLICT'});
     saved={requestId:local.requestId,digest:local.digest};
    }
    if(saved&&saved.digest!==digest)throw Object.assign(Error('上次选择结果仍未确认，不能改选另一项。请先刷新核对。'),{code:'DECISION_CHOICE_LOCKED'});
    saved??={requestId:crypto.randomUUID(),digest};
    if(!storage)throw Error('missing');storage.setItem(key(taskId,decision),JSON.stringify(saved));
    if(storage.getItem(key(taskId,decision))!==JSON.stringify(saved))throw Error('unavailable');
   }catch(error){if(['DECISION_CHOICE_LOCKED','DECISION_REQUEST_CONFLICT'].includes(error.code))throw error;throw Error('本机无法保存决策请求编号，暂不授权执行。请允许本机存储后重试。');}
   Object.assign(local,saved,{optionId,unknown:true});
   if(!valid())return null;
   const result=await client.authenticatedRequest('ai-channel/tasks/'+taskId+'/decision',{method:'POST',input:{requestId:saved.requestId,decisionId:decision.id,version:decision.version,optionId,approveExecution:true}});
   if(!valid())return result;
   if(result?.decision?.id!==decision.id||result.decision.status!=='continued'||!uuid(result.task?.id)||!uuid(result.task?.deviceId)||deviceId&&result.task.deviceId!==deviceId||result.decision.continuationTaskId!==result.task.id)throw Error('继续执行结果尚未确认，请刷新核对原请求。');
   try{storage.removeItem(key(taskId,decision));}catch{}
   records.delete(id);return result;
  }catch(error){if(valid()){local.error=error.message||'选择结果尚未确认，请刷新核对。';local.unknown=!!local.requestId;}return null;}
  finally{local.busy=false;}
 }
 return {state,observe,choose,cleanup(){active=false;records.clear();}};
}
export function decisionCard({taskId='',decision,canDecide=true,source='',controller,groupConversationId=null,busy=false,now=Date.now()}={}){
 if(!decision)return '';
 const local=controller?.state(taskId,decision)||{},pending=decision.status==='pending',enabled=canDecide===true&&uuid(taskId)&&actionableDecision(decision,now),expired=Number.isFinite(expiry(decision.expiresAt))&&expiry(decision.expiresAt)<=now;
 const label=decision.status==='continued'?'已授权继续执行':decision.status==='cancelled'?'已取消':decision.status==='suspended'?'已挂起，未自动继续':expired?'选择期限已到，请刷新核对挂起状态':!decision.available?'决策内容不可用，任务不会自动继续':'等待你拍板';
 const options=!groupConversationId&&pending&&decision.available&&!expired&&Array.isArray(decision.options)?decision.options.slice(0,4):[];
 return '<section class="ai-decision" data-decision-id="'+esc(decision.id)+'"><span class="ai-decision-source">'+esc(source)+'</span><h3>需要你拍板</h3><p class="ai-decision-question">'+esc(decision.question||'问句已过期或服务已重启，请核对电脑上的实际结果。')+'</p><p class="ai-decision-status" role="status">'+esc(label)+'</p>'+(pending&&decision.available&&decision.continuationSupported!==true?'<p class="ai-decision-note">请在电脑更新连接器并保持在线，确认所选 AI 已就绪后刷新。</p>':'')+(local.error?'<p class="ai-decision-error" role="alert">'+esc(local.error)+'</p>':'')+(pending&&decision.available?'<p class="ai-decision-note">'+(canDecide?'选择即授权 AI 在原任务目录继续下一段工作。不会恢复旧进程；30 分钟未选择会挂起。':'只有设备主人可以选择；你不能访问这台设备。')+'</p>':'')+(groupConversationId?'<p class="ai-decision-note">这项任务来自讨论组，请回到讨论组选择并保持执行连接。</p>':'')+'<div class="ai-decision-actions">'+options.map((option,index)=>'<button type="button" data-decision-action="choose" data-decision-task="'+esc(taskId)+'" data-decision-option="'+esc(option.id)+'" class="'+(index===options.length-1?'ai-decision-primary':'ai-decision-secondary')+'" '+(!enabled||busy||local.busy||local.unknown&&local.optionId!==option.id?'disabled':'')+'>'+esc(local.unknown&&local.optionId===option.id?'重试同一选择：'+option.label:option.label)+(canDecide&&enabled?' · 继续执行':'')+'</button>').join('')+(uuid(groupConversationId)?'<button type="button" class="ai-decision-primary" data-decision-action="group" data-decision-task="'+esc(taskId)+'" data-decision-conversation="'+esc(groupConversationId)+'">返回讨论组继续</button>':'')+'</div><button type="button" class="ai-decision-refresh" data-decision-action="refresh" '+(busy||local.busy?'disabled':'')+'>刷新核对</button></section>';
}
