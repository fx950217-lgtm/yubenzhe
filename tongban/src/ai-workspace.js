import './ai-workspace.css';
import { createAIClient } from './ai-workspace-client.js';
import { saveJsonFile, isNativeApp } from './native-runtime.js';

const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const purposes = [{id:'content',label:'内容整理'},{id:'customer_service',label:'群运营'},{id:'research',label:'研究协作'}];
const labels = {pending_review:'待审核',awaiting_configuration:'等待配置',active:'可使用',paused:'已暂停',closed:'已关闭',rejected:'未通过',cancelled:'已取消',running:'正在处理',succeeded:'已完成',failed:'处理失败'};
const stamp = value => value ? new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
const uuid = () => globalThis.crypto?.randomUUID?.() || `ai-${Date.now()}-${Math.random().toString(36).slice(2,14)}`;
const button = (label, action, extra = '', primary = false) => `<button type="button" data-disc="ai-${action}" class="ai-button ${primary?'primary':''}" ${extra}>${label}</button>`;
const status = value => `<span class="ai-status ${value==='active'||value==='succeeded'?'ready':''}">${e(labels[value] || value || '待确认')}</span>`;
const optionalId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value) ? value : '';
const localMessage = (cause, fallback) => String(cause?.message || fallback).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

export function createAIWorkspace(ctx, { client = createAIClient(), bridge = () => globalThis.YubenzheDesktop?.localAI, exporter = saveJsonFile, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let dead=false, active=false, generation=0, controllers=new Set(), timer=null, mode='local', page='list';
  let loading=false,busy='',error='',capabilities=null,items=[],detail=null,cloudLoaded=false,selectedWorkspaceId='';
  let form={name:'',purpose:'content',requirements:''},taskPrompt='',pending=null,confirmCancel=false,needsRefresh=false;
  let localStatus=null,selectedModel='',localResult='',localError='',localRequest=null,includePrompt=false;
  function redraw() { if (!dead && active) ctx.render(); }
  function cancelRequests() {
    generation++; for(const controller of controllers)controller.abort(); controllers.clear();
    if(timer!==null)unschedule(timer);timer=null;
    if(localRequest){try{Promise.resolve(bridge()?.cancel?.(localRequest)).catch(()=>{});}catch{}localRequest=null;}
    loading=false;busy='';
  }
  async function request(path, options={}) {
    const controller=new AbortController();controllers.add(controller);
    try{return await client.request(path,{...options,signal:controller.signal});}finally{controllers.delete(controller);}
  }
  const valid = token => !dead && active && token===generation;
  function showError(cause) { error=cause.message || '操作未完成，请重试。';if(cause.status===409){pending=null;confirmCancel=false;needsRefresh=true;error+=' 请刷新详情后重新确认。';} }
  async function loadHome() {
    cancelRequests(); const token=generation;loading=true;error='';page='list';redraw();
    try {
      const [caps,workspaces]=await Promise.all([request('/api/ai/capabilities'),request('/api/ai/workspaces')]);
      if(!valid(token))return;
      if(!caps.cloud || !Array.isArray(workspaces.items))throw new Error('服务返回内容不完整，请重试。');
      capabilities=caps;items=workspaces.items;cloudLoaded=true;
    }catch(cause){if(valid(token)&&cause.name!=='AbortError')showError(cause);}
    finally{if(valid(token)){loading=false;redraw();}}
  }
  function scheduleDetail() {
    if(timer!==null)unschedule(timer);timer=null;
    if(active&&mode==='cloud'&&page==='detail'&&detail?.tasks?.some(task=>task.status==='running'))timer=schedule(()=>{timer=null;void loadDetail(detail.workspace.id,true);},2500);
  }
  async function loadDetail(id, quiet=false) {
    if(!optionalId(id))return;
    selectedWorkspaceId=id;
    if(!quiet){cancelRequests();if(pending?.workspaceId&&pending.workspaceId!==id)pending=null;loading=true;error='';page='detail';detail=null;confirmCancel=false;redraw();}
    const token=generation;
    try{const [data,caps]=await Promise.all([request(`/api/ai/workspaces/${id}`),request('/api/ai/capabilities')]);if(!valid(token))return;if(!data.workspace||!Array.isArray(data.tasks)||!caps.cloud)throw new Error('工作区返回内容不完整，请重试。');detail=data;capabilities=caps;items=items.map(item=>item.id===id?data.workspace:item);error='';needsRefresh=false;}
    catch(cause){if(valid(token)&&cause.name!=='AbortError')showError(cause);}
    finally{if(valid(token)){loading=false;redraw();if(!error)scheduleDetail();}}
  }
  async function mutate(operation) {
    if(busy||needsRefresh)return;
    if(timer!==null)unschedule(timer);timer=null;
    pending=operation;const token=generation;busy=operation.type;error='';redraw();
    try {
      const result=await request(operation.path,{method:'POST',body:operation.body});
      if(!valid(token))return;
      if(operation.type==='create'&&!optionalId(result.workspace?.id))throw new Error('未能确认申请结果，请重试同一次请求。');
      if(operation.type==='task'&&!optionalId(result.task?.id))throw new Error('未能确认任务结果，请重试同一次请求。');
      pending=null;busy='';confirmCancel=false;
      if(operation.type==='create') { form={name:'',purpose:'content',requirements:''};cloudLoaded=false;await loadDetail(result.workspace?.id); }
      else { if(operation.type==='task')taskPrompt='';await loadDetail(operation.workspaceId); }
    }catch(cause){if(valid(token)&&cause.name!=='AbortError'){showError(cause);busy='';redraw();}}
    finally{if(valid(token)&&busy){busy='';redraw();}}
  }
  function newOperation(type,path,body,workspaceId) { return {type,path,body:{...body,requestId:uuid()},workspaceId}; }
  function pendingMatches(type) { return pending?.type===type; }
  function notice() {return '<p class="ai-note">受限验收期间不扣平台余额。请勿提交助记词、私钥、密码或敏感客户资料。</p>';}
  function localPage() {
    const native=!!bridge(),nativeWithoutModelBridge=!native&&(isNativeApp()||!!globalThis.webkit?.messageHandlers?.exportJSON),models=localStatus?.models || [],canRun=localStatus?.available && models.some(model=>model.name===selectedModel);
    return `<div class="ai-local"><ol class="ai-steps"><li><span>1</span><div><strong>准备桌面端</strong><p>${native?'当前正在使用桌面端。':nativeWithoutModelBridge?'本地模型请在 Windows 电脑使用；此客户端可先整理和导出提示词。':'安装桌面端后可连接本地模型；网页可先整理提示词。'}</p>${!native&&!nativeWithoutModelBridge?'<a href="./install.html">查看客户端下载</a>':''}</div></li><li><span>2</span><div><strong>安装模型工具，选择模型</strong><p>先到官方安装 Ollama，再按设备性能选择并下载模型。愚笨者不附带推理引擎。</p>${nativeWithoutModelBridge?'<small class="ai-muted">请在电脑上打开 Ollama 官方网站。</small>':'<a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer">Ollama 官方下载 ↗</a>'}</div></li><li><span>3</span><div><strong>使用或导出提示词</strong><p>${native?'检查连接后，选择已下载的模型执行任务。':nativeWithoutModelBridge?'在下方整理并导出提示词，之后到 Windows 电脑上使用。':'先在下方整理提示词，再复制到 Ollama 使用。网页不会探测你的本机模型。'}</p></div></li></ol>${native?`<section class="ai-panel"><div class="ai-section-head"><h3>本地模型</h3>${button(busy==='local-status'?'检查中…':'检查连接','local-check',busy?'disabled':'')}</div>${localStatus?.available?models.length?`<label class="ai-field">已安装模型<select name="localModel" data-ai-local ${busy?'disabled':''}><option value="">请选择模型</option>${models.map(model=>`<option value="${e(model.name)}" ${selectedModel===model.name?'selected':''}>${e(model.name)}</option>`).join('')}</select></label>`:'<p class="ai-muted">已连接 Ollama，尚未检测到模型。请在 Ollama 中先下载一个模型，再检查连接。</p>':`<p class="ai-muted">${e(localStatus?.error || '按需检查 Ollama 连接，不会自动下载或安装模型。')}</p>`}</section>`:''}${ctx.renderLocal()}${native?`<div class="ai-local-run">${button(busy==='local-task'?'本地处理中…':'使用当前提示词运行','local-run',!canRun||busy?'disabled':'',true)}${busy==='local-task'?button('取消','local-cancel'):''}<p class="ai-muted">使用你安装的本地模型，不发送到平台云端。</p></div>`:''}${localError?`<p class="ai-error" role="alert">${e(localError)}</p>`:''}${localResult?`<section class="ai-panel"><div class="ai-section-head"><h3>本地模型结果</h3><span class="ai-status ready">本机返回</span></div><pre class="ai-output">${e(localResult)}</pre></section>`:''}<details class="ai-export"><summary>导出本地配置</summary><p class="ai-muted">配置包含本地模型名称和连接地址，不包含 API Key。导入或运行能力由你使用的模型工具决定。</p><label class="ai-check"><input type="checkbox" name="includePrompt" data-ai-local ${includePrompt?'checked':''}>包含当前提示词（可能含私密内容）</label>${button('下载配置 JSON','local-export',busy?'disabled':'')}</details></div>`;
  }
  function cloudList() {
    return `<div class="ai-section-head"><h3>我的工作区</h3>${button('刷新','refresh',loading||busy?'disabled':'')}</div>${!cloudLoaded&&!loading?'':items.length?`<div class="ai-workspaces">${items.map(workspace=>`<button class="ai-workspace-row" type="button" data-disc="ai-detail" data-id="${e(workspace.id)}"><span><strong>${e(workspace.name)}</strong><small>${e(purposes.find(p=>p.id===workspace.purpose)?.label||workspace.purpose)} · ${e(stamp(workspace.createdAt))}</small></span>${status(workspace.status)}<span aria-hidden="true">›</span></button>`).join('')}</div>`:'<div class="ai-empty"><strong>还没有云端工作区</strong><p>先提交用途和需求，审核后可在这里查看进度。</p></div>'}${capabilities?button('申请工作区','new',busy?'disabled':'',true):''}`;
  }
  function cloudForm() {
    if(page==='confirm')return `<section class="ai-panel"><h3>确认申请</h3><dl class="ai-summary"><dt>名称</dt><dd>${e(form.name)}</dd><dt>用途</dt><dd>${e(purposes.find(p=>p.id===form.purpose)?.label)}</dd><dt>需求</dt><dd>${e(form.requirements)}</dd></dl><p class="ai-note">提交后保存到服务器，需审核及配置。验收期间不扣平台余额，不代表服务已开通。</p><div class="ai-actions">${button('返回修改','edit',busy?'disabled':'')}${button(busy?'正在提交…':'确认提交申请','create',busy?'disabled':'',true)}</div></section>`;
    return `<form data-ai-form="application" class="ai-panel"><h3>申请云端工作区</h3><label class="ai-field">用途<select name="purpose">${purposes.map(p=>`<option value="${p.id}" ${form.purpose===p.id?'selected':''}>${p.label}</option>`).join('')}</select></label><label class="ai-field">名称<input name="name" required minlength="2" maxlength="60" value="${e(form.name)}" placeholder="例如：社区内容助手"></label><label class="ai-field">希望完成什么<textarea name="requirements" required minlength="10" maxlength="2000" rows="5" placeholder="说明要处理的内容和期望结果">${e(form.requirements)}</textarea></label><div class="ai-actions">${button('返回工作区','list')}<button class="ai-button primary" type="submit">下一步</button></div></form>`;
  }
  function cloudDetail() {
    if(!detail)return '';
    const workspace=detail.workspace,canCancel=!needsRefresh&&['pending_review','awaiting_configuration'].includes(workspace.status),ready=!needsRefresh&&workspace.status==='active'&&capabilities?.cloud?.ready;
    const steps=workspace.status==='pending_review'?1:workspace.status==='awaiting_configuration'?2:workspace.status==='active'?3:0;
    return `<section class="ai-panel"><div class="ai-section-head"><h3>${e(workspace.name)}</h3>${status(workspace.status)}</div><p class="ai-detail-need">${e(workspace.requirements)}</p>${steps?`<ol class="ai-progress">${['已提交','审核与配置','可使用'].map((label,i)=>`<li class="${i<steps?'done':''}">${label}</li>`).join('')}</ol>`:''}${workspace.reviewNote?`<p class="ai-note"><b>${workspace.status==='rejected'?'未通过原因':'审核说明'}：</b>${e(workspace.reviewNote)}</p>`:''}${workspace.status==='awaiting_configuration'?'<p class="ai-note">申请已审核，等待服务配置；当前没有生成内容。</p>':''}${workspace.status==='active'&&!ready?'<p class="ai-note">工作区已开通，但模型服务尚未就绪。请等待配置后刷新。</p>':''}<div class="ai-actions">${button('工作区列表','list',busy?'disabled':'')}${button('刷新状态','detail',`data-id="${e(workspace.id)}" ${busy?'disabled':''}`)}${canCancel?button('取消申请','cancel-confirm',busy?'disabled':''):''}</div>${confirmCancel?`<div class="ai-confirm"><p>确认取消“${e(workspace.name)}”的申请？</p>${button('保留申请','cancel-dismiss',busy?'disabled':'')}${button(busy?'取消中…':'确认取消','cancel',busy?'disabled':'')}</div>`:''}</section>${ready&&!detail.tasks.some(task=>task.status==='running')?`<form data-ai-form="task" class="ai-panel"><div class="ai-section-head"><h3>开始任务</h3><small>今日剩余 ${e(detail.quota?.remaining??'待确认')} 次</small></div><label class="ai-field">任务内容<textarea name="prompt" required maxlength="6000" rows="5" ${busy?'disabled':''} placeholder="提供材料，说明这次想获得的结果">${e(taskPrompt)}</textarea></label><p class="ai-muted">失败或取消也计入当日次数。内容会交给已配置的模型服务处理。</p><button type="submit" class="ai-button primary" ${busy||detail.quota?.remaining===0?'disabled':''}>${busy==='task'?'正在提交…':'运行任务'}</button></form>`:''}<section class="ai-panel"><h3>任务记录</h3>${detail.tasks.length?detail.tasks.map(task=>`<article class="ai-task"><div class="ai-section-head">${status(task.status)}<small>${e(stamp(task.createdAt))}</small></div><details><summary>${e(String(task.prompt||'任务').slice(0,70))}</summary><p class="ai-detail-need">${e(task.prompt)}</p></details>${task.status==='succeeded'?`<pre class="ai-output">${e(task.output||'服务未返回文本。')}</pre>`:task.status==='failed'?`<p class="ai-error">${e(task.errorMessage||'本次任务未完成。请调整内容后重新提交。')}</p>`:task.status==='running'?`<p class="ai-muted">服务器正在处理，结果会自动更新。</p>${button('取消任务','task-cancel',`data-id="${e(task.id)}" ${busy?'disabled':''}`)}`:'<p class="ai-muted">任务已取消。</p>'}</article>`).join(''):'<p class="ai-empty">还没有任务记录。</p>'}</section>`;
  }
  function cloudPage() {
    if(!client.supported())return '<section class="ai-empty"><strong>请在服务器网页版开通云端</strong><p>在网页版登录后，申请和任务会保存在服务器。当前客户端可以继续使用本地功能。</p></section>';
    return `${capabilities?`<p class="ai-service-state">${capabilities.cloud.ready?'模型服务已就绪':'模型服务等待配置或验证'} · 验收期间不扣余额</p>`:''}${loading?'<p class="ai-loading" role="status">正在读取服务器数据…</p>':''}${error?`<div class="ai-error" role="alert">${e(error)}<div>${button(pending?'重试同一次请求':'重试读取','retry',busy?'disabled':'')}</div></div>`:''}${page==='list'?cloudList():page==='new'||page==='confirm'?cloudForm():cloudDetail()}${notice()}`;
  }
  async function checkLocal() {
    if(busy)return;const token=generation;busy='local-status';localError='';redraw();
    try{const result=await bridge().status();if(!valid(token))return;if(!result||typeof result.available!=='boolean'||!Array.isArray(result.models))throw new Error('未能确认本地模型状态。');localStatus=result;if(!result.models.some(model=>model.name===selectedModel))selectedModel=result.models[0]?.name||'';}
    catch(cause){if(valid(token))localError=localMessage(cause,'本地模型连接失败。');}
    finally{if(valid(token)){busy='';redraw();}}
  }
  async function runLocal() {
    if(busy)return;
    const prompt=String(ctx.getLocalDraft().prompt||'').trim();
    if(!prompt||prompt.length>6000){localError='请先填写 1–6000 字的提示词。';redraw();return;}
    if(!localStatus?.available||!localStatus.models.some(model=>model.name===selectedModel)){localError='请先检查连接并选择已有模型。';redraw();return;}
    const token=generation,id=uuid();localRequest=id;busy='local-task';localError='';localResult='';redraw();
    try{const result=await bridge().generate({model:selectedModel,prompt,requestId:id});if(!valid(token)||localRequest!==id)return;if(result?.local!==true||typeof result.text!=='string')throw new Error('本地模型没有返回有效文本。');localResult=result.text;}
    catch(cause){if(valid(token)&&localRequest===id)localError=localMessage(cause,'本地任务没有完成。');}
    finally{if(valid(token)&&localRequest===id){localRequest=null;busy='';redraw();}}
  }
  async function exportLocal() {
    if(busy)return;const token=generation;busy='export';localError='';redraw();
    try {const config={schemaVersion:1,application:'愚笨者',mode:'local',provider:'ollama',endpoint:'http://127.0.0.1:11434',model:selectedModel||null,privacy:{cloudUpload:false},...(includePrompt?{promptTemplate:String(ctx.getLocalDraft().prompt||'')}:{})};const result=await exporter({filename:'yubenzhe-local-ai.json',content:JSON.stringify(config,null,2)});if(valid(token))ctx.toast(result.saved?(result.method==='browser-download'?'已请求下载本地配置，请检查下载文件。':'本地配置已保存。'):'已取消保存，没有导出文件。');}
    catch(cause){if(valid(token))localError=cause.message||'配置没有保存，请重试。';}
    finally{if(valid(token)){busy='';redraw();}}
  }
  function handleAction(action,target) {
    if(dead||!action?.startsWith('ai-'))return false;
    const id=optionalId(target?.dataset?.id);
    if(action==='ai-mode') {const next=target.dataset.mode;if(!['local','cloud'].includes(next)||mode===next)return true;cancelRequests();mode=next;error='';localError='';redraw();if(mode==='cloud'&&client.supported())void loadHome();}
    else if(action==='ai-local-check'&&bridge())void checkLocal();
    else if(action==='ai-local-run'&&bridge())void runLocal();
    else if(action==='ai-local-cancel'){cancelRequests();localError='本地任务已取消，未显示未确认的结果。';redraw();}
    else if(action==='ai-local-export')void exportLocal();
    else if(mode==='cloud'&&client.supported()) {
      if(action==='ai-refresh'||action==='ai-list'){if(!busy)void loadHome();}
      else if(action==='ai-detail'&&!busy&&id){taskPrompt='';void loadDetail(id);}
      else if(action==='ai-new'&&!busy){cancelRequests();pending=null;page='new';error='';needsRefresh=false;redraw();}
      else if(action==='ai-edit'&&!busy){pending=null;page='new';redraw();}
      else if(action==='ai-create'&&page==='confirm'&&!busy)void mutate(pendingMatches('create')?pending:newOperation('create','/api/ai/workspaces',form));
      else if(action==='ai-cancel-confirm'&&!busy){confirmCancel=true;redraw();}
      else if(action==='ai-cancel-dismiss'&&!busy){confirmCancel=false;redraw();}
      else if(action==='ai-cancel'&&confirmCancel&&detail&&!busy)void mutate(pendingMatches('cancel')?pending:newOperation('cancel',`/api/ai/workspaces/${detail.workspace.id}/actions`,{action:'cancel',version:detail.workspace.version},detail.workspace.id));
      else if(action==='ai-task-cancel'&&!busy){const task=detail?.tasks.find(task=>task.id===id&&task.status==='running');if(task)void mutate(pendingMatches('task-cancel')&&pending.path===`/api/ai/tasks/${id}/cancel`?pending:newOperation('task-cancel',`/api/ai/tasks/${id}/cancel`,{version:task.version},detail.workspace.id));}
      else if(action==='ai-retry'&&!busy){if(pending)void mutate(pending);else if(page==='detail'&&selectedWorkspaceId)void loadDetail(selectedWorkspaceId);else void loadHome();}
    }
    return true;
  }
  function handleInput(event) {
    if(dead)return;
    const input=event.target,cloudForm=input.closest?.('[data-ai-form]');
    if(cloudForm&&!busy){const values=Object.fromEntries(new FormData(cloudForm));if(cloudForm.dataset.aiForm==='application'){form={...form,...values};pending=null;}else if(cloudForm.dataset.aiForm==='task'){taskPrompt=String(values.prompt||'');pending=null;}return;}
    if(input.matches?.('[data-ai-local]')&&!busy){if(input.name==='localModel')selectedModel=input.value;if(input.name==='includePrompt')includePrompt=input.checked;}
  }
  function handleSubmit(event) {
    const element=event.target?.closest?.('[data-ai-form]');if(dead||!element)return false;event.preventDefault();if(busy||mode!=='cloud'||!client.supported())return true;
    const values=Object.fromEntries(new FormData(element));error='';
    if(element.dataset.aiForm==='application') {
      form={name:String(values.name||'').trim(),purpose:values.purpose,requirements:String(values.requirements||'').trim()};
      if(form.name.length<2||form.name.length>60||form.requirements.length<10||form.requirements.length>2000||!purposes.some(p=>p.id===form.purpose)){error='请填写 2–60 字名称、10–2000 字需求，并选择用途。';redraw();return true;}page='confirm';pending=null;redraw();
    }else if(element.dataset.aiForm==='task'&&detail){taskPrompt=String(values.prompt||'').trim();if(!taskPrompt||taskPrompt.length>6000){error='请填写 1–6000 字任务内容。';redraw();return true;}if(detail.workspace.status!=='active'||!capabilities?.cloud?.ready){error='工作区或模型尚未就绪，请刷新状态。';redraw();return true;}void mutate(pendingMatches('task')?pending:newOperation('task',`/api/ai/workspaces/${detail.workspace.id}/tasks`,{prompt:taskPrompt,version:detail.workspace.version},detail.workspace.id));}
    return true;
  }
  return {
    render(){if(dead)return '';active=true;return `<section class="ai-workspace"><div class="ai-modes" role="tablist" aria-label="AI 使用方式">${[['local','本地安装'],['cloud','云端使用']].map(([id,label])=>`<button type="button" role="tab" aria-selected="${mode===id}" class="${mode===id?'active':''}" data-disc="ai-mode" data-mode="${id}">${label}</button>`).join('')}</div>${mode==='local'?localPage():cloudPage()}</section>`;},
    routeChanged(route){if(route!=='ai'&&active){active=false;cancelRequests();}else if(route==='ai'&&!active){active=true;if(mode==='cloud'&&client.supported())void loadHome();}},
    handleAction,handleInput,handleSubmit,
    cleanup(){dead=true;active=false;cancelRequests();}
  };
}
