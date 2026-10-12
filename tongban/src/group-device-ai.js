import './remote-work.css';
import {deviceAIProviders,providerName} from './device-ai-providers.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const live=s=>['ready','running','starting'].includes(s.status);
export function mountGroupDeviceAI(root,{client,conversationId,onBack=()=>{},pollMs=5000}={}){
 const owner=client.getProfile()?.userId;let active=true,busy=false,reading=false,actionError='',loadError='',suspended=false,epoch=0,devices=[],sessions=[],settings={},selected='',providers=new Set(),goal='',share=false,pendingCreate=null;const requests=new Map(),stops=new Set();
 const sameOwner=()=>client.getProfile()?.userId===owner;
 const valid=()=>active&&sameOwner();
 const foreground=()=>valid()&&!suspended&&!globalThis.document?.hidden;
 const current=ticket=>foreground()&&ticket===epoch;
 const api=(path,method='GET',input)=>client.authenticatedRequest('group-device-ai'+path,{method,input});
 function render(){if(!valid())return;const error=actionError||loadError,d=devices.find(d=>d.id===selected),rows=deviceAIProviders(d),primary=sessions.find(s=>s.owner&&s.status==='ready');root.innerHTML='<section class="rw gai"><button data-gai="back">‹ 返回群聊</button><h2>设备 AI 讨论</h2><p>人决定方向，AI 提供方案。回复由设备主人授权分享给本群；设备仍仅本人可操作。</p><p>每轮必须手动批准，最多 10 轮 / 30 分钟。离开页面、断网或切到后台后停止；服务器最迟在 15 秒心跳到期时终止任务。</p>'+(error?'<p role="alert">'+esc(error)+'</p>':'')+(settings.canManage?'<label class="gai-check"><input type="checkbox" data-gai-setting '+(settings.allowDeviceAI?'checked':'')+' '+(busy?'disabled':'')+'>允许本群成员用自己的设备 AI 发言（默认关闭）</label>':'<p>群设备 AI：'+(settings.allowDeviceAI?'已开启':'未开启，请联系群主')+'</p>')+'<form data-gai-create><label>我的设备<select name="device" '+(busy?'disabled':'')+'><option value="">请选择</option>'+devices.filter(d=>!d.revoked).map(d=>'<option value="'+esc(d.id)+'" '+(d.id===selected?'selected':'')+'>'+esc(d.name)+'</option>').join('')+'</select></label><div>'+rows.map(p=>'<label class="gai-check"><input type="checkbox" name="provider" value="'+esc(p.id)+'" '+(providers.has(p.id)?'checked ':'')+(!p.available||busy?'disabled':'')+'>'+esc(p.name)+' · '+esc(p.available?p.executionMode==='chat-only'?'仅文字对话':'在独立任务目录执行':p.reason||'暂不可执行')+'</label>').join('')+'</div><label>讨论目标<textarea name="goal" maxlength="2000" '+(busy?'disabled':'')+'>'+esc(goal)+'</textarea></label><label class="gai-check"><input type="checkbox" name="share" '+(share?'checked ':'')+(busy?'disabled':'')+'>我同意将目标和所选 AI 的回复分享给本群成员</label><button '+(!primary?'class="wh-primary" ':'')+(!settings.allowDeviceAI||!share||!providers.size||!goal.trim()||busy?'disabled':'')+'>创建讨论（尚不执行）</button></form><button data-gai="stop-all" '+(busy||!sessions.some(s=>s.owner&&live(s))?'disabled':'')+'>一键停全部 AI</button>'+sessions.map(s=>'<article class="rw-card"><h3>第 '+s.round+' / '+s.maxRounds+' 轮 · '+esc(({ready:'等待本人批准',running:'执行中',starting:'提交中',finished:'达到轮数上限',stopped:'已停止','awaiting-stop':'停止确认中'})[s.status]||s.status)+'</h3><p>'+esc(s.reason)+'</p>'+s.replies.map(r=>'<section><strong>'+esc(providerName(r.provider))+'</strong><p>'+esc(r.text)+'</p></section>').join('')+(s.owner&&s.status==='ready'?'<p>下一轮会参考上轮各 AI 回复。批准只适用于当前一轮，不授权付款。</p><button data-gai="next" data-id="'+esc(s.id)+'" '+(s===primary?'class="wh-primary" ':'')+(busy?'disabled':'')+'>批准执行'+(s.round?'下一轮':'第一轮')+'并分享回复</button>':'')+'</article>').join('')+'</section>';}
 async function load(){
  if(!foreground()||reading||busy)return;
  reading=true;const ticket=epoch;
  try{
   const [list,config,ds]=await Promise.all([api('?conversationId='+encodeURIComponent(conversationId)),api('/groups/'+conversationId),client.authenticatedRequest('devices',{method:'GET'})]);
   if(!current(ticket))return;
   sessions=projectSessions(list.sessions);settings=config;devices=ds.devices;
   for(const s of sessions.filter(s=>s.owner&&live(s))){await api('/'+s.id+'/heartbeat','POST',{});if(!current(ticket))return;}
   loadError='';render();
  }catch(e){if(current(ticket)){loadError=e.message||'设备讨论暂不可用。';if([401,403,404].includes(e.status)){sessions=[];devices=[];}render();}}
  finally{reading=false;}
 }
 async function action(fn){
  if(!foreground()||busy)return;
  busy=true;actionError='';const ticket=++epoch;render();
  try{await fn(ticket);}catch(e){if(current(ticket))actionError=e.message||'操作结果未确认，请刷新后核对。';}
  finally{busy=false;if(foreground()){render();void load();}}
 }
 function requestId(key){if(!requests.has(key))requests.set(key,crypto.randomUUID());return requests.get(key);}
 async function click(e){const b=e.target.closest?.('[data-gai]');if(!b||b.disabled||!foreground())return;if(b.dataset.gai==='back'){suspend();onBack();return;}if(b.dataset.gai==='stop-all'){await action(async()=>{await Promise.all(sessions.filter(s=>s.owner&&live(s)).map(s=>requestStop(s.id)));});}if(b.dataset.gai==='next'){const s=sessions.find(s=>s.id===b.dataset.id&&s.owner&&s.status==='ready');if(s)await action(async ticket=>{const value=await api('/'+s.id+'/next','POST',{requestId:requestId(s.id+':'+s.round),round:s.round,approveExecution:true});if(!current(ticket)){stopSession(s.id);return;}sessions=sessions.map(row=>row.id===s.id?value.session:row);});}}
 function input(e){if(!foreground()||busy)return;const t=e.target;if(t.name==='goal'){goal=t.value.slice(0,2000);pendingCreate=null;const b=root.querySelector?.('[data-gai-create] button');if(b)b.disabled=!settings.allowDeviceAI||!share||!providers.size||!goal.trim();return;}if(t.name==='device'){selected=t.value;providers.clear();}if(t.name==='provider'){if(t.checked)providers.add(t.value);else providers.delete(t.value);}if(t.name==='share')share=t.checked;pendingCreate=null;render();}
 async function change(e){if(e.target.matches?.('[data-gai-setting]')){await action(async ticket=>{const r=await api('/groups/'+conversationId,'POST',{allowDeviceAI:e.target.checked===true});if(current(ticket))settings=r;});}else input(e);}
 async function submit(e){if(!e.target.matches?.('[data-gai-create]'))return;e.preventDefault();if(!foreground()||busy||!share||!settings.allowDeviceAI||!goal.trim())return;const available=deviceAIProviders(devices.find(d=>d.id===selected)).filter(p=>p.available).map(p=>p.id);if(providers.size<1||providers.size>3||[...providers].some(p=>!available.includes(p))){actionError='请选择一到三个当前可用的 AI。';render();return;}await action(async ticket=>{const creation=pendingCreate??={conversationId,deviceId:selected,providers:[...providers],goal:goal.trim(),requestId:crypto.randomUUID(),approveSharing:true};const r=await api('','POST',creation);if(!current(ticket)){if(pendingCreate===creation)pendingCreate=null;stopSession(r.session.id);return;}sessions=[r.session,...sessions.filter(s=>s.id!==r.session.id)];pendingCreate=null;goal='';share=false;});}
 // Never send an old session's stop using credentials from a different account.
 // If that account has gone away, the server's heartbeat deadline remains the stop boundary.
 function projectSessions(values){return values.map(s=>stops.has(s.id)&&live(s)?{...s,status:'awaiting-stop',reason:'已请求停止，尚未收到确认；此页面不会继续续期或批准。'}:s);}
 async function requestStop(id){if(!sameOwner())return;stops.add(id);sessions=projectSessions(sessions);return api('/'+id+'/stop','POST',{});}
 function stopSession(id){void requestStop(id).catch(()=>{});}
 function suspend(){suspended=true;epoch++;for(const s of sessions.filter(s=>s.owner&&live(s)))stopSession(s.id);}
 function visibility(){if(globalThis.document?.hidden)suspend();else{suspended=false;void load();}}
 root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',change);root.addEventListener('submit',submit);globalThis.window?.addEventListener('pagehide',suspend);globalThis.document?.addEventListener('visibilitychange',visibility);const timer=setInterval(()=>void load(),pollMs);render();void load();
 return()=>{if(!active)return;suspend();active=false;clearInterval(timer);root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',change);root.removeEventListener('submit',submit);globalThis.window?.removeEventListener('pagehide',suspend);globalThis.document?.removeEventListener('visibilitychange',visibility);sessions=[];goal='';pendingCreate=null;};
}
