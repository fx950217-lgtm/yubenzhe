import { saveArtifactFile } from './native-runtime.js';
import './workbench.css';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const estimatedTime=seconds=>typeof seconds==='number'&&Number.isSafeInteger(seconds)&&seconds>0?'约 '+seconds+' 秒':'未提供';
const date=v=>{const value=new Date(v);return v!==null&&v!==undefined&&Number.isFinite(value.getTime())?value.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'时间未提供';};
const labels={'awaiting-confirmation':'等待你确认',queued:'排队中',running:'正在处理',paused:'已暂停','awaiting-user':'等待你的操作','budget-paused':'等待重新确认',succeeded:'已完成',failed:'处理失败',cancelled:'已取消'};
const final=s=>['succeeded','failed','cancelled'].includes(s);
const eventLabels={'step-completed':'完成一个处理步骤','quote-expired':'计划已过期',planned:'已生成计划','scope-updated':'已更新目标','instruction-added':'已补充要求','replanned':'已根据补充要求更新计划',...labels};
const capabilityLabels={'goal-classification':'识别目标',plan:'生成计划',analyze:'分析文件',deduplicate:'文件去重','clean-csv':'表格去重','clean-text':'文本去重','format-json':'格式化 JSON','task-draft':'任务草稿',checklist:'工作清单',outline:'文章大纲','csv-clean':'表格整理','text-clean':'文本整理','json-format':'JSON 整理','file-transform':'文件处理','remote-desktop':'远程桌面','general-reasoning':'通用模型'};
const examples=[
 {title:'整理订单表',goal:'整理订单表，移除重复行并汇总数据',hint:'上传 CSV，获得干净表格与统计报告',file:true},
 {title:'准备工作清单',goal:'帮我列一份准备线上产品发布的工作清单，包含页面检查、用户反馈和成果验收',hint:'不用上传文件，先把事情安排清楚'},
 {title:'写一份大纲',goal:'帮我写一份介绍新产品的文章大纲，面向第一次使用的普通用户',hint:'得到可继续编辑的结构草稿'},
 {title:'整理会议文字',goal:'整理会议文字，删除重复行并统计内容',hint:'上传 TXT 或 Markdown',file:true}
];
export function mountWorkbench(root,{client,onAccount=()=>{},onLegacy=()=>{},onShare=()=>{},toast=()=>{},embedded=false,initialGoal='',initialScreen='home',initialTaskId=null}={}){
 let active=true,timer=null,busy=false,cap=null,tasks=[],files=[],selected=null,error='',uploading=false;
 let screen=initialScreen==='tasks'?'tasks':'home',taskTab='overview',filter='all',search='',catalog=null,reminders=[],planNotice=null,preview=null,cancelPrompt=false,editing=false;
 let requestedTask=typeof initialTaskId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(initialTaskId)?initialTaskId:null;
 const draft={goal:String(initialGoal||'').slice(0,4000),fileIds:[]};let instruction='';
 const pending=new Map(),ownerId=client.getProfile()?.userId;let viewEpoch=0;
 const isCurrent=()=>active&&client.getProfile()?.userId===ownerId;
 const checkCurrent=()=>{if(!isCurrent())throw Error('页面或账号已改变，操作已停止。');};
 const get=path=>client.authenticatedRequest('workbench/'+path);
 async function post(path,input){
  checkCurrent();const signature=JSON.stringify({path,input}),requestId=pending.get(signature)||crypto.randomUUID();pending.set(signature,requestId);
  try{const result=await client.authenticatedRequest('workbench/'+path,{method:'POST',input:{...input,requestId}});checkCurrent();pending.delete(signature);return result;}
  catch(e){if(e.status&&e.status<500)pending.delete(signature);throw e;}
 }
 const button=(action,label,extra='',primary=false,previewAction=false)=>'<button type="button" data-action="'+action+'" '+extra+' class="'+(primary&&(!preview||previewAction)?'primary':'')+'" '+(busy?'disabled':'')+'>'+label+'</button>';
 function shell(body){
  root.innerHTML='<section class="wb">'+(embedded?'':'<header class="wb-head"><div><h1>文件小工具</h1><p>不需要 AI，也能整理文件</p></div><span class="wb-trial">本地试用</span></header>')+
   '<nav class="wb-navigation" aria-label="工作台导航">'+[['home','文件小工具'],['tasks','我的任务'],['files','成果与文件'],['environment','工作环境']].map(([id,label])=>'<button type="button" data-action="screen" data-screen="'+id+'" class="'+(screen===id?'active':'')+'" '+(busy?'disabled':'')+'>'+label+'</button>').join('')+'</nav><p class="wb-plan-notice">这些文件小工具不需要 AI。添加的文件会发送到当前工作台服务处理；本机运行时留在本机，在线使用时会上传服务器。</p>'+
   (error?'<div class="wb-error" role="alert">'+esc(error)+'</div>':'')+body+
   (preview?'<section class="wb-preview" aria-label="文件预览"><div class="wb-row"><h2>'+esc(preview.file.name)+'</h2>'+button('close-preview','关闭')+'</div><p class="wb-muted">纯文本预览'+(preview.preview.truncated?' · 仅显示前一部分':'')+'</p><pre>'+esc(preview.preview.text)+'</pre>'+button('download','下载完整文件','data-id="'+esc(preview.file.id)+'"',true,true)+'</section>':'')+'</section>';
 }
 function render(){
  if(!isCurrent())return;
  if(!client.getProfile()){shell('<div class="wb-empty"><h2>登录后开始</h2><p>任务、文件和成果跟随你的账号。</p>'+button('login','登录账号','',true)+'</div>');return;}
  if(!cap){shell('<div class="wb-empty"><p>正在连接工作台…</p>'+button('refresh','重新连接')+'</div>');return;}
  if(!cap.enabled){shell('<div class="wb-empty"><h2>工作台尚未启用</h2><p>当前文件工具尚未接通。</p>'+button('legacy','查看文字模型设置')+'</div>');return;}
  if(selected){renderTask();return;}
  if(screen==='environment'){renderEnvironment();return;}
  if(screen==='files'){renderFiles();return;}
  if(screen==='tasks'){renderTasks();return;}
  renderHome();
 }
 function noticeHTML(){
  if(!planNotice)return '';
  const title={needs_information:'再补充一点信息',needs_configuration:'这项能力还未接通',unsupported:'这项任务暂时不能执行'}[planNotice.status]||'任务计划';
  return '<section class="wb-plan-notice" role="status"><h2>'+title+'</h2><p>'+esc(planNotice.summary)+'</p>'+
   (planNotice.missingInformation||[]).map(x=>'<p>• '+esc(typeof x==='string'?x:x.question||x.label)+'</p>').join('')+
   '<p class="wb-muted">还未创建执行任务。</p>'+(planNotice.status==='needs_configuration'?button('environment','查看工作环境'):'')+'</section>';
 }
 function renderHome(){
  const selectedFiles=files.filter(f=>draft.fileIds.includes(f.id));
  shell('<section class="wb-composer"><h2>用文件小工具完成什么？</h2><form data-plan><label class="sr-only" for="wb-goal">任务目标</label><textarea id="wb-goal" name="goal" data-draft="goal" rows="4" maxlength="4000" placeholder="例如：把这份订单表去重，给我一份整理后的表格和统计报告。" required>'+esc(draft.goal)+'</textarea>'+
   '<div class="wb-attachments">'+selectedFiles.map(f=>'<span class="wb-attachment">'+esc(f.name)+button('remove-file','×','data-id="'+esc(f.id)+'" aria-label="移除附件 '+esc(f.name)+'"')+'</span>').join('')+'</div>'+
   '<div class="wb-composer-actions"><label class="wb-upload">'+(uploading?'上传中…':'＋ 添加文件')+'<input data-file type="file" accept=".csv,.txt,.md,.json" multiple '+(busy||uploading?'disabled':'')+'></label><button type="submit" class="'+(preview?'':'primary')+'" '+(busy||uploading?'disabled':'')+'>'+(busy?'正在整理计划…':'生成计划')+'</button></div>'+
   '<p class="wb-muted">先看计划，再由你确认执行。平台免费使用，未获批准不会开始。</p></form></section>'+noticeHTML()+
   '<section class="wb-examples"><h2>从一件小事开始</h2><div class="wb-example-grid">'+examples.map((x,i)=>'<button type="button" data-action="example" data-index="'+i+'"><strong>'+esc(x.title)+'</strong><span>'+esc(x.hint)+'</span></button>').join('')+'</div></section>'+
   (files.length?'<details class="wb-library"><summary>使用已上传的文件（'+files.length+'）</summary><p class="wb-muted">CSV、TXT、Markdown、JSON，单文件最多 256 KiB，每次最多 5 个。</p>'+files.map(f=>'<label><input type="checkbox" data-choose-file value="'+esc(f.id)+'" '+(draft.fileIds.includes(f.id)?'checked':'')+'>'+esc(f.name)+' <small>'+Math.ceil(f.size/1024)+' KB</small></label>').join('')+'</details>':'')+
   '<div class="wb-capability-note"><span class="wb-status-dot"></span><p>当前可做文件去重、格式整理与清单、大纲草稿，按固定规则处理，不需要 AI。</p></div>'+
   (tasks.length?'<section class="wb-recent"><div class="wb-row"><h2>最近任务</h2>'+button('all-tasks','查看全部')+'</div>'+tasks.slice(0,3).map(taskRow).join('')+'</section>':''));
 }
 function taskRow(t){return '<button type="button" class="wb-task-row" data-action="open" data-id="'+esc(t.id)+'"><span class="wb-task-icon '+(t.status==='succeeded'?'done':'')+'">'+(t.status==='succeeded'?'✓':'◇')+'</span><span class="wb-task-main"><strong>'+esc(t.title)+'</strong><small>'+date(t.createdAt)+' · '+esc(labels[t.status]||t.status)+'</small></span><span class="wb-row-arrow">›</span></button>';}
 function renderTasks(){
  const groups={all:()=>true,active:t=>['running','queued','paused','awaiting-user','budget-paused'].includes(t.status),pending:t=>t.status==='awaiting-confirmation',done:t=>t.status==='succeeded',issue:t=>['failed','cancelled'].includes(t.status)};
  const rows=tasks.filter(groups[filter]).filter(t=>!search||t.title.toLowerCase().includes(search.toLowerCase()));
  shell('<div class="wb-section-title"><h2>我的任务</h2>'+button('new','＋ 文件小工具')+'</div><label class="wb-search"><span class="sr-only">搜索任务</span><input data-search placeholder="搜索任务" value="'+esc(search)+'"></label>'+
   '<div class="wb-filters">'+[['all','全部'],['active','进行中'],['pending','待确认'],['done','已完成'],['issue','未完成']].map(([key,label])=>button('filter',label,'data-filter="'+key+'" aria-pressed="'+(key===filter)+'"')).join('')+'</div>'+
   (rows.length?'<div class="wb-list">'+rows.map(taskRow).join('')+'</div>':'<div class="wb-empty"><h3>这里还没有任务</h3><p>输入目标，确认计划后开始。</p>'+button('new','使用文件小工具','',true)+'</div>'));
 }
 function renderEnvironment(){
  const services=catalog?.services||[{id:'local',kind:'executor',label:'本地规则与文件整理',status:'available',reason:'实际处理你选中的文件，生成可下载结果。'},{id:'models',kind:'model',label:'通用 AI 模型',status:'unconfigured',reason:'尚未配置模型供应商。'},{id:'desktop',kind:'desktop',label:'云端电脑',status:'unconfigured',reason:'尚未配置远程设备服务商。'}];
  shell('<div class="wb-section-title"><h2>工作环境</h2>'+button('refresh','刷新')+'</div><p class="wb-muted">查看这个账号现在能使用的能力。接入后，手机和电脑将进入同一个任务工作区。</p>'+
   '<div class="wb-list">'+services.map(s=>'<article class="wb-service"><div class="wb-row"><h3>'+esc(s.label)+'</h3><span class="wb-status '+(s.status==='available'?'ready':'')+'">'+(s.status==='available'?'可使用':'待接入')+'</span></div><p>'+esc(s.reason||'')+'</p>'+
   (s.capabilities?.length?'<div class="wb-tags">'+s.capabilities.map(x=>'<span>'+esc(typeof x==='string'?(capabilityLabels[x]||x):x.label||capabilityLabels[x.id]||x.id)+'</span>').join('')+'</div>':'')+'</article>').join('')+'</div>'+
   '<section class="wb-desktop-empty"><span>▣</span><h3>云端电脑尚未连接</h3><p>连接设备服务商后，这里才能观看实时桌面、用手机操作并交回 AI。当前没有远程屏幕。</p></section>'+
   '<details class="wb-library"><summary>已有文字模型工作区</summary><p>保留原来的文字模型配置入口，与云电脑能力分开。</p>'+button('legacy','打开文字模型设置')+'</details>');
 }
 function fileRow(f,output=false){return '<div class="wb-file-row"><div><strong>'+esc(f.name)+'</strong><small>'+Math.ceil(f.size/1024)+' KB · 保留至 '+date(f.expiresAt)+'</small></div><div class="wb-actions">'+button('preview','预览','data-id="'+esc(f.id)+'"')+button('download','下载','data-id="'+esc(f.id)+'"')+(output?button('share','分享','data-id="'+esc(f.id)+'"'):'')+'</div></div>';}
 function renderFiles(){
  const outputs=tasks.flatMap(t=>(t.outputs||[]).map(f=>({...f,taskTitle:t.title})));
  shell('<div class="wb-section-title"><h2>成果与文件</h2>'+button('refresh','刷新')+'</div>'+
   (reminders.length?'<section class="wb-retention"><h3>这些文件即将到期</h3>'+reminders.map(r=>'<p>'+esc(r.name)+' · '+(r.remainingDays<=1?'不足 1 天':Math.ceil(r.remainingDays)+' 天后')+'清理 '+button('preview','查看','data-id="'+esc(r.fileId)+'"')+'</p>').join('')+'</section>':'')+
   '<p class="wb-muted">文件保留 30 天。到期前 7 天和 1 天会在这里提醒，请及时下载。</p><section class="wb-list"><h3>任务成果</h3>'+(outputs.length?outputs.map(f=>fileRow(f,true)).join(''):'<p class="wb-empty">任务完成后，真实生成的文件会放在这里。</p>')+'</section>'+
    '<details class="wb-library"><summary>已上传的原文件（'+files.length+'）</summary>'+files.map(f=>fileRow(f)).join('')+'</details>');
 }
 function taskUsage(task){
  const entries=(Array.isArray(task.events)?task.events:[]).filter(event=>event?.event==='step-completed');
  return '<section class="wb-list" data-task-usage><h3>已记录的处理步骤</h3><p class="wb-muted">以下来自任务执行记录。</p>'+
   (entries.length?entries.map(event=>'<div class="wb-file-row"><div><strong>'+(Number.isSafeInteger(event.payload?.step)&&event.payload.step>0?'处理步骤 '+event.payload.step:'处理步骤（序号未提供）')+'</strong><small>'+(Number.isSafeInteger(event.createdAt)&&!Number.isNaN(new Date(event.createdAt).getTime())?date(event.createdAt):'时间未提供')+'</small></div></div>').join(''):'<p class="wb-empty">暂无已记录的处理步骤。</p>')+'</section>';
 }
 function renderTask(){
  const t=selected,plan=t.plan||{steps:[{title:'核对目标与文件'},{title:'执行文件整理'},{title:'生成成果与报告'}],artifacts:[]},steps=plan.steps||[],w=t.workspace;
  const editable=['awaiting-confirmation','paused','budget-paused','awaiting-user'].includes(t.status),awaiting=['awaiting-confirmation','budget-paused'].includes(t.status);
  let body='<div class="wb-task-top">'+button('back','‹ 我的任务')+'<span class="wb-status">'+esc(labels[t.status]||t.status)+'</span></div><h2 class="wb-task-title">'+esc(t.title)+'</h2>'+
   '<nav class="wb-task-tabs" aria-label="任务内容">'+[['overview','计划与进度'],['outputs','成果与记录'],['workspace','工作区']].map(([id,label])=>button('task-tab',label,'data-tab="'+id+'" aria-pressed="'+(taskTab===id)+'"')).join('')+'</nav>';
  if(taskTab==='workspace'){
   body+='<section class="wb-list"><h3>当前工作区</h3><div class="wb-meta"><div><span>状态</span><strong>'+esc(({ready:'已就绪',running:'处理中',suspended:'已休眠',released:'已释放'})[w?.state]||'等待就绪')+'</strong></div><div><span>控制权</span><strong>'+(w?.controller==='user'?'你正在操作':'任务执行器')+'</strong></div></div><p class="wb-muted">离开页面后任务按原状态继续；重新进入时仍是同一任务。</p>'+
    (!final(t.status)&&!awaiting?'<div class="wb-actions">'+button(w?.controller==='user'?'resume':'takeover',w?.controller==='user'?'交回执行器，继续任务':'暂停自动步骤，我来操作')+'</div>':'')+'</section>'+
    '<section class="wb-desktop-empty"><span>▣</span><h3>还没有可连接的云电脑</h3><p>当前任务由工作台服务处理文件，不操作电脑桌面。连接自己的电脑请返回“我的设备”；云电脑仍待接入。</p>'+button('environment','查看可用能力')+'</section>';
  }else if(taskTab==='outputs'){
   body+='<section class="wb-list"><h3>成果文件</h3>'+((t.outputs||[]).length?t.outputs.map(f=>fileRow(f,true)).join(''):'<div class="wb-empty"><p>'+(t.status==='failed'?'本次没有可用成果。请检查文件或调整目标后重试。':'任务完成后，成果会出现在这里。')+'</p></div>')+'</section>'+
    taskUsage(t);
  }else{
   body+=(t.goal&&t.goal!==t.title?'<section class="wb-plan-notice"><h3>本次目标与补充要求</h3><p class="wb-goal-review">'+esc(t.goal)+'</p></section>':'')+(t.error?'<div class="wb-error">本次处理没有成功。请检查文件格式或调整目标，可查看处理记录后重新生成计划。</div>':'')+
    '<section class="wb-list"><h3>'+(awaiting?'先确认执行计划':'正在做什么')+'</h3><p>'+esc(plan.summary||t.goal||t.title)+'</p><ol class="wb-steps">'+steps.map((s,i)=>'<li class="'+(i<t.step?'complete':i===t.step&&!final(t.status)?'current':'')+'"><span>'+(i<t.step?'✓':i+1)+'</span><div><strong>'+esc(s.title)+'</strong>'+(s.description?'<p>'+esc(s.description)+'</p>':'')+'</div></li>').join('')+'</ol>'+
    ((plan.artifacts||[]).length?'<p class="wb-muted">预计得到：'+plan.artifacts.map(f=>esc(f.name||f.description)).join('、')+'</p>':'')+
    '<p class="wb-local-label">执行方式：工作台服务按固定规则处理文件，不需要 AI</p></section>';
   if(awaiting)body+='<form class="wb-confirm" data-confirm><h3>确认执行范围</h3><p class="wb-muted">预计用时：'+estimatedTime(plan.estimatedSeconds)+'。时间为预估，不是完成时限保证。</p><p class="wb-muted">'+(t.status==='budget-paused'?'这是此前暂停的任务，请重新核对目标与文件。':'')+'确认后按当前目标、文件和方案执行；变更方案需要重新批准。</p><button class="'+(preview?'':'primary')+'" type="submit" '+(busy?'disabled':'')+'>确认计划，开始执行</button></form>';
   if(!awaiting&&!final(t.status))body+='<div class="wb-actions">'+(['running','queued'].includes(t.status)?button('pause','暂停任务'):button('resume','继续同一任务','',true))+button('takeover','我来操作')+button('refresh','刷新进度')+'</div>';
   if(editable)body+='<details class="wb-library"><summary>补充要求，重新查看计划</summary><form data-instructions><label>补充说明<textarea name="instruction" data-instruction maxlength="2000" rows="3" placeholder="例如：请改为去掉重复行，并保留原来的表头。" required>'+esc(instruction)+'</textarea></label><p class="wb-muted">修改后先给你新计划，再确认执行。已完成步骤的处理记录会保留。</p><button type="submit" '+(busy?'disabled':'')+'>更新计划</button></form></details>';
   body+='<section class="wb-result-shortcut"><h3>成果文件</h3><p>'+((t.outputs||[]).length?'已生成 '+t.outputs.length+' 个文件，可预览或下载。':'完成后可在“成果与记录”查看。')+'</p>'+button('task-tab','查看成果与记录','data-tab="outputs"')+'</section>';
  }
  body+='<div class="wb-actions">'+(!final(t.status)?button('cancel-request','取消任务'):'')+(final(t.status)?button('reuse','按这个目标使用文件小工具'):'')+'</div>'+
   (cancelPrompt?'<section class="wb-plan-notice"><p>确定停止这项任务？已完成的处理会保留在记录中。</p>'+button('cancel','确定取消')+button('cancel-dismiss','继续保留')+'</section>':'')+
   '<details class="wb-library"><summary>执行记录与任务信息</summary><p class="wb-muted">任务 '+esc(t.id)+'</p><p class="wb-muted">工作区 '+esc(t.workspaceId)+'</p>'+(t.events||[]).map(e=>'<p class="wb-muted">'+date(e.createdAt)+' · '+esc(eventLabels[e.event]||'任务状态已更新')+'</p>').join('')+'</details>';
  shell(body);if(busy)root.querySelectorAll('button').forEach(b=>b.disabled=true);
 }
 async function load(){
  if(!client.getProfile()){render();return;}const turn=viewEpoch,id=selected?.id||requestedTask;
  try{
   const c=await get('capabilities');if(!isCurrent()||turn!==viewEpoch)return;cap=c;
   if(cap.enabled){
    if(id){const result=await get('tasks/'+id);if(!isCurrent()||turn!==viewEpoch)return;if(!selected||Number(result.task.version)>=Number(selected.version)){selected=result.task;}requestedTask=null;}
    else{const values=await Promise.all([get('tasks'),get('files')]);if(!isCurrent()||turn!==viewEpoch)return;tasks=values[0].tasks||[];files=values[1].files||[];draft.fileIds=draft.fileIds.filter(id=>files.some(f=>f.id===id));}
    if(screen==='environment'){const value=await get('catalog');if(!isCurrent()||turn!==viewEpoch)return;catalog=value;}
    if(screen==='files'){const value=await get('retention');if(!isCurrent()||turn!==viewEpoch)return;reminders=value.reminders||[];}
   }error='';
  }catch(e){if(!isCurrent()||turn!==viewEpoch)return;error=e.message;}
  render();
 }
 async function act(fn){
  if(busy||!isCurrent())return;viewEpoch++;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);error='';
  try{await fn();}catch(e){if(isCurrent())error=e.message;}finally{busy=false;render();}
 }
 async function changeScreen(next){viewEpoch++;screen=next;selected=null;requestedTask=null;preview=null;cancelPrompt=false;await load();}
 async function click(e){
  const b=e.target.closest('[data-action]');if(!b||!root.contains(b))return;e.stopPropagation?.();if(busy)return;const name=b.dataset.action;
  if(name==='login'){onAccount();return;}if(name==='legacy'){onLegacy();return;}
  if(name==='screen'){await changeScreen(b.dataset.screen);return;}
  if(name==='back'||name==='all-tasks'){await changeScreen('tasks');return;}
  if(name==='new'){await changeScreen('home');return;}
  if(name==='environment'){await changeScreen('environment');return;}
  if(name==='refresh'){await load();return;}
  if(name==='filter'){filter=b.dataset.filter;render();return;}
  if(name==='example'){const ex=examples[Number(b.dataset.index)];if(ex){draft.goal=ex.goal;planNotice=null;render();root.querySelector?.('[name=goal]')?.focus();}return;}
  if(name==='remove-file'){draft.fileIds=draft.fileIds.filter(id=>id!==b.dataset.id);render();return;}
  if(name==='task-tab'){taskTab=b.dataset.tab;preview=null;render();return;}
  if(name==='close-preview'){preview=null;render();return;}
  if(name==='cancel-request'||name==='cancel-dismiss'){cancelPrompt=name==='cancel-request';render();return;}
  if(name==='reuse'){draft.goal=selected.goal||selected.title;draft.fileIds=[];planNotice=null;await changeScreen('home');return;}
  await act(async()=>{
   if(name==='open'){const turn=++viewEpoch,value=await get('tasks/'+b.dataset.id);if(isCurrent()&&turn===viewEpoch){selected=value.task;taskTab='overview';cancelPrompt=false;}return;}
   if(name==='share'){
    const f=[...(selected?.outputs||[]),...tasks.flatMap(t=>t.outputs||[])].find(f=>f.id===b.dataset.id);if(!f)return;
    checkCurrent();await onShare({id:f.id,name:f.name});return;
   }
   if(name==='preview'){const turn=viewEpoch,value=await get('files/'+b.dataset.id+'/details');if(isCurrent()&&turn===viewEpoch)preview=value;return;}
   if(name==='download'){
    const f=preview?.file?.id===b.dataset.id?preview.file:[...files,...tasks.flatMap(t=>t.outputs||[]),...(selected?.outputs||[])].find(f=>f.id===b.dataset.id);if(!f)return;
    const blob=await client.authenticatedRequest('workbench/files/'+f.id,{raw:true});if(!isCurrent())return;const result=await saveArtifactFile({filename:f.name,blob});if(isCurrent())toast(result.saved?(result.method==='browser-download'?'已请求下载，请查看下载文件。':'交付文件已保存。'):'已取消保存。');return;
   }
   if(!selected)return;
   const input={version:selected.version};
   if(['pause','resume','cancel','takeover'].includes(name)){selected=(await post('tasks/'+selected.id+'/'+name,input)).task;cancelPrompt=false;}
  });
 }
 function input(e){
  const target=e.target;
  if(target.dataset?.draft==='goal'){draft.goal=target.value;planNotice=null;}
  if(target.hasAttribute?.('data-instruction'))instruction=target.value;
  if(target.hasAttribute?.('data-search')){search=target.value;const start=target.selectionStart;render();const field=root.querySelector('[data-search]');field?.focus();field?.setSelectionRange?.(start,start);}
 }
 async function change(e){
  if(e.target.hasAttribute?.('data-choose-file')){const id=e.target.value;if(e.target.checked){if(draft.fileIds.length>=5){e.target.checked=false;error='每次最多选择 5 个文件。';}else draft.fileIds.push(id);}else draft.fileIds=draft.fileIds.filter(x=>x!==id);render();return;}
  const element=e.target.closest('[data-file]');if(!element?.files?.[0]||uploading||busy)return;
  const picked=[...element.files];if(picked.length+draft.fileIds.length>5){error='每次最多选择 5 个文件。';render();return;}if(picked.some(f=>f.size>262144)){error='每个文件最多 256 KiB。';render();return;}
  uploading=true;error='';render();
  try{for(const file of picked){const bytes=new Uint8Array(await file.arrayBuffer());checkCurrent();let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const value=await post('files',{name:file.name,base64:btoa(binary)});if(value.file?.id)draft.fileIds.push(value.file.id);}
   const value=await get('files');checkCurrent();files=value.files||[];
  }catch(e){if(isCurrent())error=e.message;}finally{uploading=false;render();}
 }
 async function submit(e){
  const form=e.target;if(!form.matches('[data-plan],[data-confirm],[data-instructions]'))return;e.preventDefault();if(uploading)return;
  const data=new FormData(form);
  await act(async()=>{
   if(form.matches('[data-plan]')){
    draft.goal=String(data.get('goal')||draft.goal).trim();if(!draft.goal)throw Error('先说说你希望完成什么。');
    const value=await post('plan',{goal:draft.goal,fileIds:[...draft.fileIds],locale:'zh-CN'});planNotice=value.plan;
    if(value.task){selected=value.task;taskTab='overview';planNotice=null;draft.goal='';draft.fileIds=[];}return;
   }
   if(!selected)return;
   if(form.matches('[data-confirm]')){if(!['awaiting-confirmation','budget-paused'].includes(selected.status)||!Number.isSafeInteger(selected.planVersion)||selected.planVersion<1)throw Error('执行计划已改变或版本不完整，请刷新后重新确认。');const input={version:selected.version,planVersion:selected.planVersion,acceptExecution:true};selected=(await post('tasks/'+selected.id+'/confirm',input)).task;return;}
   if(form.matches('[data-instructions]')){const value=await post('tasks/'+selected.id+'/instructions',{version:selected.version,instruction:String(data.get('instruction')||'').trim()});if(value.task){selected=value.task;instruction='';}if(value.plan&&value.plan.status!=='ready'){error=value.plan.summary+' '+(value.plan.missingInformation||[]).join(' ');}return;}
  });
 }
 const focusin=e=>{editing=!!e.target.matches?.('input,textarea,select');},focusout=()=>{editing=false;};
 root.addEventListener('click',click);root.addEventListener('change',change);root.addEventListener('input',input);root.addEventListener('submit',submit);root.addEventListener('focusin',focusin);root.addEventListener('focusout',focusout);
 render();load();timer=setInterval(()=>{if(active&&selected&&!busy&&!editing&&!preview&&!final(selected.status)&&!['awaiting-confirmation','paused','budget-paused','awaiting-user'].includes(selected.status))load();},1800);
 return ()=>{active=false;viewEpoch++;clearInterval(timer);for(const [name,fn] of [['click',click],['change',change],['input',input],['submit',submit],['focusin',focusin],['focusout',focusout]])root.removeEventListener(name,fn);};
}
