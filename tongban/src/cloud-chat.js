
import './remote-work.css';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountCloudChat(root,{client,onAccount=()=>{}}={}){
 let active=true,state=null,error='',draft='',busy=false,loading=false,pending=null;
 const owner=client.getProfile()?.userId,valid=()=>active&&client.getProfile()?.userId===owner;
 const call=(path,method='GET',input)=>client.authenticatedRequest('ai/'+path,{method,input});
 function render(){
  if(!valid())return;
  const tasks=[...(state?.tasks||[])].reverse(),running=tasks.find(x=>x.status==='running');
  root.innerHTML='<section class="rw"><h2>已连接的云端模型</h2><p class="rw-muted">连接现有开源模型 · 免费内测，每天 '+(state?.quota?.limit||10)+' 次。需登录愚笨者账号，内容会发到服务器处理。回复来自所连接的模型；电脑操作请使用“我的设备”。</p>'+
  (!owner?'<button data-chat="login">登录账号</button>':'')+
  (state?.capabilities?.cloud?.configured===false?'<p class="rw-error">'+esc(state.capabilities.cloud.message)+'</p>':'')+
  (error?'<p role="alert" class="rw-error">'+esc(error)+'</p>':'')+
  '<div class="rw-messages" aria-live="polite">'+tasks.map(t=>'<article class="rw-message"><strong>你</strong><p>'+esc(t.prompt)+'</p><strong>模型回复</strong><p>'+esc(t.status==='succeeded'?t.output:t.status==='running'?'正在思考…':t.errorMessage||'本次回复未完成')+'</p>'+(t.status==='succeeded'?'<button data-chat="download" data-id="'+esc(t.id)+'">保存回复为文件</button>':'')+(t.status==='running'?'<button data-chat="cancel" data-id="'+esc(t.id)+'">停止回复</button>':'')+'</article>').join('')+'</div>'+
  (owner?'<form data-cloud-form><label>告诉 AI 你想完成什么<textarea name="prompt" rows="4" maxlength="6000" required placeholder="例如：帮我写一份三天的产品推广计划，简洁一点。">'+esc(draft)+'</textarea></label><button class="wh-primary" '+(busy||running?'disabled':'')+'>'+(busy||running?'正在回复…':'发送')+'</button><span class="rw-muted">今日剩余 '+(state?.quota?.remaining??'—')+' 次</span></form>':'')+'</section>';
 }
 async function load(){if(!valid()||!owner||loading)return;loading=true;try{const data=await call('chat');if(valid()){state=data;render();}}catch(e){if(valid()){error=e.message;render();}}finally{loading=false;}}
 async function submit(e){if(!e.target.matches('[data-cloud-form]'))return;e.preventDefault();if(!valid()||busy)return;const prompt=draft.trim();if(!prompt)return;busy=true;error='';pending=pending?.prompt===prompt?pending:{prompt,requestId:crypto.randomUUID()};render();try{await call('chat/messages','POST',pending);if(valid()){draft='';pending=null;await load();}}catch(e){if(valid())error=e.message;}finally{busy=false;render();}}
 async function click(e){const b=e.target.closest('[data-chat]');if(!b||!valid())return;
 if(b.dataset.chat==='login'){onAccount();return;}
 const t=state?.tasks.find(t=>t.id===b.dataset.id);if(!t)return;
 if(b.dataset.chat==='download'&&t.status==='succeeded'){const url=URL.createObjectURL(new Blob([t.output],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='YBZ-AI-'+t.id.slice(-8)+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 if(b.dataset.chat==='cancel'){try{await call('tasks/'+t.id+'/cancel','POST',{version:t.version,requestId:crypto.randomUUID()});await load();}catch(e){error=e.message;render();}}
 }
 function input(e){if(e.target.name==='prompt')draft=e.target.value;}
 root.addEventListener('input',input);root.addEventListener('submit',submit);root.addEventListener('click',click);render();void load();
 const timer=setInterval(()=>{if(state?.tasks.some(t=>t.status==='running'))void load();},1500);
 return()=>{active=false;clearInterval(timer);root.removeEventListener('input',input);root.removeEventListener('submit',submit);root.removeEventListener('click',click);};
}
