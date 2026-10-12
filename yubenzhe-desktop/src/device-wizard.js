'use strict';
const $=id=>document.getElementById(id),api=window.YbzDeviceSetup;
let current={},working=false,catalogRendered=false;
const providerRows=new Map(),catalogProviderIds=new Set();let aiItems=null;
function providerFields(article,id){const fields={};for(const name of ['installed','loggedIn','executionSupported','executionMode','reason']){const status=document.createElement('small');status.className='setup-status';status.dataset.providerField=name;article.append(status);fields[name]=status;}providerRows.set(id,{article,fields});}
function renderCatalog(categories){if(catalogRendered||!Array.isArray(categories))return;const container=$('setup-catalog');container.replaceChildren();
 for(const category of categories){const group=document.createElement('details'),heading=document.createElement('summary'),list=document.createElement('div');group.className='setup-category';group.dataset.setupCategory=category.id;heading.textContent=category.title;list.className='setup-items';group.append(heading,list);if(category.id==='ai')aiItems=list;
  for(const item of category.items){const article=document.createElement('article'),title=document.createElement('strong'),note=document.createElement('p');article.className='setup-item';article.dataset.setupItem=item.id;title.textContent=item.name;note.textContent=item.note;article.append(title,note);if(item.providerId){catalogProviderIds.add(item.providerId);providerFields(article,item.providerId);}if(item.url){const button=document.createElement('button');button.type='button';button.dataset.setupTool=item.id;button.textContent='打开官方页面';button.onclick=()=>action('openTool',{itemId:item.id});article.append(button);}list.append(article);}container.append(group);
 }catalogRendered=true;
}
function extraProviders(providers){if(!aiItems)return;
 const extra=new Map();for(const provider of providers)if(provider&&typeof provider.id==='string'&&/^[a-z][a-z0-9-]{1,23}$/.test(provider.id)&&!catalogProviderIds.has(provider.id)&&!extra.has(provider.id))extra.set(provider.id,provider);
 for(const [id,row]of providerRows)if(!catalogProviderIds.has(id)&&!extra.has(id)){aiItems.removeChild(row.article);providerRows.delete(id);}
 for(const [id,provider]of extra){let row=providerRows.get(id);if(!row){const article=document.createElement('article'),title=document.createElement('strong'),note=document.createElement('p');article.className='setup-item';article.dataset.setupItem=id;title.textContent=id;note.textContent='来自本机 AI 检测；执行能力以本机核验结果为准。';article.append(title,note);providerFields(article,id);row=providerRows.get(id);row.title=title;aiItems.append(article);}row.title.textContent=typeof provider.name==='string'?provider.name:id;}
}
function renderProviders(providers){
 const list=Array.isArray(providers)?providers:[],modes={tools:'工具任务','chat-only':'无工具对话',disabled:'未启用'};extraProviders(list);
 for(const [id,{article,fields}]of providerRows){const matches=list.filter(item=>item&&item.id===id),provider=matches.length===1?matches[0]:null;
  const installed=provider?.installed,loggedIn=provider?.loggedIn,supported=provider?.executionSupported,mode=provider?.executionMode;
  const ready=installed===true&&supported===true&&(mode==='tools'||mode==='chat-only')&&(loggedIn===true||id==='ollama'&&loggedIn===null);
  article.dataset.providerStatus=!provider?'unknown':installed===false?'missing':ready?'ready':'limited';
  fields.installed.textContent='安装：'+(installed===true?'已安装':installed===false?'未检测到':'未检测');
  fields.loggedIn.textContent='登录：'+(loggedIn===true?'已登录':loggedIn===false?'请本人登录':id==='ollama'&&installed===true&&loggedIn===null?'本地模式，无需登录':'状态未检测');
  fields.executionSupported.textContent='执行：'+(supported===true?(ready?'已就绪':'已适配，尚未就绪'):supported===false?'不支持':'未检测');
  fields.executionMode.textContent='模式：'+(Object.hasOwn(modes,mode)?modes[mode]:'未检测');
  fields.reason.textContent=typeof provider?.reason==='string'?provider.reason:'安装与连接状态待检测。';
 }
}
function syncControls(){document.querySelectorAll('button').forEach(button=>button.disabled=working);const locked=working||Boolean(current.running);if($('ollamaModel'))$('ollamaModel').disabled=locked;if($('saveOllamaModel'))$('saveOllamaModel').disabled=locked;}
function render(state){current=state;for(const key of ['origin','name','source']){if(document.activeElement!==$(key))$(key).value=state[key]||'';$(key).disabled=state.paired||Boolean(state.code);}
 renderCatalog(state.setupCatalog);renderProviders(state.providers);if($('ollamaModel')&&document.activeElement!==$('ollamaModel'))$('ollamaModel').value=typeof state.ollamaModel==='string'?state.ollamaModel:'';
 $('code').textContent=state.paired?'已配对':state.code||'等待生成机器码';$('expiry').textContent=state.paired?'手机「消息」和「我的设备」中可打开这台电脑。':state.expiresAt?'有效至 '+new Date(state.expiresAt).toLocaleTimeString()+' · 刷新后旧码立即失效':'有效期最多 10 分钟，用后即失效。只交给自己，不公开截图。';
 $('generate').hidden=state.paired;$('generate').textContent=state.code?'刷新机器码':'生成机器码';$('start').hidden=!state.paired||state.running;$('stop').hidden=!state.running;$('import').hidden=state.paired;$('autoStart').checked=state.autoStart;$('workspace').textContent=state.workspace||'';$('message').textContent=state.message||'';
 const labels={screen:'屏幕远控',ai:'AI 任务',files:'文件收发',autoStart:'开机自启'},states={supported:'支持',partial:'部分支持',unsupported:'不支持',unknown:'未验证'},list=$('capabilities');list.replaceChildren();
 for(const [key,name]of Object.entries(labels)){const cap=state.capabilities?.[key]||{state:'unknown',reason:'等待检测。'},row=document.createElement('div');row.className='cap';const title=document.createElement('strong'),status=document.createElement('span'),reason=document.createElement('small');title.textContent=name;status.textContent=states[cap.state]||'未验证';title.append(status);reason.textContent=cap.reason;row.append(title,reason);list.append(row);}
 syncControls();
}
async function action(action,extra={}){if(working||action==='setOllamaModel'&&current.running)return;working=true;syncControls();try{render(await api.action({action,...extra}));}catch(error){$('message').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}finally{working=false;syncControls();}}
$('generate').onclick=()=>action('generate',{origin:$('origin').value.trim(),name:$('name').value.trim(),source:$('source').value});
for(const name of ['probe','start','stop','import','reset'])$(name).onclick=()=>action(name);
if($('saveOllamaModel'))$('saveOllamaModel').onclick=()=>action('setOllamaModel',{model:$('ollamaModel').value.trim()});
$('autoStart').onchange=()=>action('autoStart',{enabled:$('autoStart').checked});api.onState(render);action('status');
