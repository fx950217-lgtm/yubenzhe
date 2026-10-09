const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('zh-CN'):'尚无记录';
export async function recoverAccount(client,{userId,recoveryCode,newPassword,repeat}){
 if(!/^\d{6,16}$/.test(userId?.trim()??''))throw new Error('请输入 6–16 位数字 ID。');
 if(!/^\d{6}$/.test(newPassword??''))throw new Error('请输入 6 位数字新密码。');
 if(newPassword!==repeat)throw new Error('两次输入的新密码不一致。');
 if(typeof recoveryCode!=='string'||!recoveryCode.trim())throw new Error('请输入此前保存的账号恢复码。');
 return client.publicRequest('security/recover',{method:'POST',input:{userId:userId.trim(),recoveryCode:recoveryCode.trim(),newPassword}});
}
export function mountAccountSecurity(container,{client,onDeleted,onRefresh}={}){
 let disposed=false,busy=false,epoch=0,status=null,action=null;
 const request=(path,method='GET',input)=>client.authenticatedRequest('security/'+path,{method,input});
 function freeze(value){busy=value;container.querySelectorAll('button,input').forEach(c=>c.disabled=value);}
 function render(){
  container.innerHTML='<section class="account-security"><h3>账号安全</h3><p class="modal-copy">恢复码只用于愚笨者账号，与钱包助记词无关。设备记录按登录会话显示，位置仅作粗略提示。</p><p data-security-error class="form-error" role="alert"></p>'+(status?'<div class="security-recovery"><strong>账号恢复码</strong><span>'+ (status.recoveryEnabled?'已设置 · '+esc(date(status.recoveryCreatedAt)):'尚未设置；忘记密码时无法通过手机号找回')+'</span><button class="secondary" data-security-action="generate">'+(status.recoveryEnabled?'重新生成恢复码':'生成恢复码')+'</button>'+(status.recoveryEnabled?'<button class="subtle-button" data-security-action="revoke">停用恢复码</button>':'')+'</div><h3>已登录的设备</h3><div class="security-sessions">'+status.sessions.map(s=>'<article><div><strong>'+esc(s.device)+(s.current?' · 当前设备':'')+'</strong><small>'+esc(s.ipHint||'网络未知')+' · 最近活动 '+esc(date(s.lastSeenAt))+'</small><small>登录于 '+esc(date(s.createdAt))+'</small></div>'+(!s.current?'<button class="subtle-button" data-session-revoke="'+esc(s.id)+'">退出此设备</button>':'')+'</article>').join('')+'</div><button class="secondary" data-security-action="others">退出其他设备</button><button class="subtle-button" data-security-refresh>刷新设备列表</button><hr><button class="security-danger" data-security-action="delete">注销账号</button><div data-security-panel></div>':'<p role="status">正在读取账号安全设置…</p><button class="secondary" data-security-refresh>重试</button>')+'</section>';
  container.querySelectorAll('[data-security-action]').forEach(b=>b.onclick=()=>open(b.dataset.securityAction));
  container.querySelectorAll('[data-session-revoke]').forEach(b=>b.onclick=()=>open('session',b.dataset.sessionRevoke));
  const refresh=container.querySelector('[data-security-refresh]');if(refresh)refresh.onclick=()=>{if(!busy)load();};
 }
 async function load(){const turn=++epoch;status=null;action=null;render();freeze(true);try{const result=await request('status');if(disposed||turn!==epoch)return;status=result;render();}catch(e){if(!disposed&&turn===epoch)container.querySelector('[data-security-error]').textContent=e.message;}finally{if(!disposed&&turn===epoch)freeze(false);}}
 function open(kind,sessionId){if(busy||disposed)return;action={kind,sessionId};const panel=container.querySelector('[data-security-panel]');
  const labels={generate:'生成新的恢复码',revoke:'停用恢复码',others:'退出其他设备',session:'退出指定设备',delete:'永久注销账号'};
  panel.innerHTML='<form data-security-form class="security-confirm"><h4>'+labels[kind]+'</h4>'+(kind==='delete'?'<p class="security-delete-copy">注销后账号无法恢复，当前服务中的头像、个人资料、好友关系、本人发送的消息及图片、动态和互动会删除，其他设备会退出。群主需先转让群主。保留已占用 ID、防滥用审计和消息删除标记；安全备份按保留策略清理。他人另存的副本无法撤回。</p><p><strong>本机钱包、助记词与链上资产不会删除。</strong></p><label class="field">输入“注销账号”确认<input name="confirmation" autocomplete="off" required></label>':kind==='generate'?'<p class="modal-copy">新码仅显示这一次，原恢复码立即失效。请保存到安全的位置，不要交给任何人；使用后会失效并退出所有设备。</p>':'<p class="modal-copy">请验证当前账号密码，确认由你本人操作。</p>')+'<label class="field">当前账号密码<input name="currentPassword" type="password" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="current-password" required></label><p class="form-error" role="alert"></p><div class="security-actions"><button type="submit" class="'+(kind==='delete'?'security-danger':'primary')+'">确认'+(kind==='delete'?'注销':'')+'</button><button type="button" class="secondary" data-security-cancel>取消</button></div></form>';
  const form=panel.querySelector('form');form.querySelector('[data-security-cancel]').onclick=()=>{if(!busy){form.reset();panel.replaceChildren();action=null;}};
  form.onsubmit=async event=>{event.preventDefault();if(busy||disposed)return;const submitted=action,turn=epoch;let currentPassword=form.elements.currentPassword.value;const confirmation=form.elements.confirmation?.value;
   form.querySelector('.form-error').textContent='';if(!/^\d{6}$/.test(currentPassword)){form.querySelector('.form-error').textContent='请输入 6 位数字账号密码。';return;}if(submitted.kind==='delete'&&confirmation!=='注销账号'){form.querySelector('.form-error').textContent='请输入“注销账号”以确认。';return;}freeze(true);form.elements.currentPassword.value='';
   try{let result;if(submitted.kind==='delete')result=await request('delete-account','POST',{currentPassword,confirmation});else{const verified=await request('verify','POST',{currentPassword});currentPassword='';if(disposed||turn!==epoch)return;const input={verificationToken:verified.verificationToken};if(submitted.kind==='generate')result=await request('recovery-code','POST',input);if(submitted.kind==='revoke')result=await request('recovery-code/remove','POST',input);if(submitted.kind==='others'||submitted.kind==='session')result=await request('sessions/revoke','POST',{...input,...(submitted.kind==='others'?{others:true}:{sessionId:submitted.sessionId})});}
    if(submitted.kind==='delete'&&result.deleted){client.clearSession();if(!disposed)onDeleted?.();return;}
    if(disposed||turn!==epoch)return;
    if(submitted.kind==='generate'){status.recoveryEnabled=true;status.recoveryCreatedAt=result.createdAt;render();container.querySelector('[data-security-panel]').innerHTML='<div class="security-recovery-code"><strong>请立即安全保存，关闭后不再显示</strong><output>'+esc(result.recoveryCode)+'</output><p class="modal-copy">这是账号恢复码，不是钱包助记词。请同时记住你的用户 ID。</p><button class="primary" data-code-saved>我已安全保存</button></div>';container.querySelector('[data-code-saved]').onclick=()=>{container.querySelector('[data-security-panel]').replaceChildren();onRefresh?.();};}else{await load();onRefresh?.();}
   }catch(e){if(!disposed&&turn===epoch&&form.isConnected)form.querySelector('.form-error').textContent=e.message;}finally{currentPassword='';if(!disposed&&turn===epoch)freeze(false);}
  };
 }
 load();return ()=>{disposed=true;epoch++;status=null;action=null;container.querySelectorAll('input').forEach(c=>c.value='');container.replaceChildren();};
}
