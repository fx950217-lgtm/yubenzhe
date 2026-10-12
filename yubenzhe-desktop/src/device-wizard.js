'use strict';
const $=id=>document.getElementById(id),api=window.YbzDeviceSetup;
let current={},working=false;
function render(state){current=state;for(const key of ['origin','name','source']){if(document.activeElement!==$(key))$(key).value=state[key]||'';$(key).disabled=state.paired||Boolean(state.code);}
 $('code').textContent=state.paired?'已配对':state.code||'等待生成机器码';$('expiry').textContent=state.paired?'手机「消息」和「我的设备」中可打开这台电脑。':state.expiresAt?'有效至 '+new Date(state.expiresAt).toLocaleTimeString()+' · 刷新后旧码立即失效':'有效期最多 10 分钟，用后即失效。只交给自己，不公开截图。';
 $('generate').hidden=state.paired;$('generate').textContent=state.code?'刷新机器码':'生成机器码';$('start').hidden=!state.paired||state.running;$('stop').hidden=!state.running;$('import').hidden=state.paired;$('autoStart').checked=state.autoStart;$('workspace').textContent=state.workspace||'';$('message').textContent=state.message||'';
 const labels={screen:'屏幕远控',ai:'AI 任务',files:'文件收发',autoStart:'开机自启'},states={supported:'支持',partial:'部分支持',unsupported:'不支持',unknown:'未验证'},list=$('capabilities');list.replaceChildren();
 for(const [key,name]of Object.entries(labels)){const cap=state.capabilities?.[key]||{state:'unknown',reason:'等待检测。'},row=document.createElement('div');row.className='cap';const title=document.createElement('strong'),status=document.createElement('span'),reason=document.createElement('small');title.textContent=name;status.textContent=states[cap.state]||'未验证';title.append(status);reason.textContent=cap.reason;row.append(title,reason);list.append(row);}
}
async function action(action,extra={}){if(working)return;working=true;document.querySelectorAll('button').forEach(x=>x.disabled=true);try{render(await api.action({action,...extra}));}catch(error){$('message').textContent=error.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}finally{working=false;document.querySelectorAll('button').forEach(x=>x.disabled=false);}}
$('generate').onclick=()=>action('generate',{origin:$('origin').value.trim(),name:$('name').value.trim(),source:$('source').value});
for(const name of ['probe','start','stop','import','reset'])$(name).onclick=()=>action(name);
$('autoStart').onchange=()=>action('autoStart',{enabled:$('autoStart').checked});api.onState(render);action('status');
