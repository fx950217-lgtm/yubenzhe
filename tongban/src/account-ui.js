import './account-ui.css';
import {recoverAccount} from './account-security-client.js';
import {createAccountAccessClient} from './account-access-client.js';
import {accountPasswordAttributes, isCurrentAccountPassword, validateNewAccountPassword} from './account-password.js';
export {mountAccountSecurity} from './account-security-client.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accountEmailModeText(capabilities){if(capabilities?.passwordRegistration)return '注册后自动分配公开 ID，用 ID 和个人密码登录。';if(capabilities?.simulationScope==='internal-preview')return '内部预览请使用 example.test 测试邮箱；验证码仅在此页面显示，不发送真实邮件。';if(capabilities?.simulation)return '本机模拟邮件：验证码仅用于本地验证，不代表真实邮件已发送。';return capabilities?.emailMode==='disabled'?'邮箱服务尚未启用，可使用已有 ID 登录。':'';}
export function mountAccountGate(container,{client,onReady,onWallet,onRetry,error='',loading=false}={}){
  let disposed=false,busy=false,mode='checking',email='',savedId='',notice='',challenge=null,capabilities=null,requestedEmail='',requestId=crypto.randomUUID(),resendAt=0,registered=null;
  const access=createAccountAccessClient(client,{isCurrent:()=>!disposed});
  const publicPasswords=()=>capabilities?.passwordRegistration===true;
  const simulatedMail=()=>!publicPasswords()&&capabilities?.simulation===true;
  const freeze=value=>{busy=value;container.querySelectorAll('button,input').forEach(e=>e.disabled=value);};
  function retain(){const f=container.querySelector('form');email=f?.elements.email?.value||email;savedId=f?.elements.userId?.value||savedId;}
  function message(text){const el=container.querySelector('.form-error');if(el)el.textContent=text;}
  async function run(fn){if(busy||disposed)return;freeze(true);message('');try{await fn();}catch(e){if(!disposed)message(e.message);}finally{if(!disposed)freeze(false);}}
  const passwordField=(name,label,current=false)=>'<label class="field">'+label+'<input name="'+name+'" type="password" '+accountPasswordAttributes(capabilities,current)+' required></label>';
  function controls(){
    if(mode==='checking')return '<p role="status">正在读取登录方式…</p><p class="form-error" role="alert">'+esc(error)+'</p>';
    if(mode==='unavailable')return '<p class="form-error" role="alert">'+esc(error)+'</p><button class="primary" data-reload-capabilities>重新连接</button>';
    if(mode==='created')return '<p>请保存你的公开 ID。换设备时使用此 ID 和刚设置的个人密码登录。</p><div class="account-created-id"><output aria-label="你的账号 ID">'+esc(registered.userId)+'</output><button class="secondary" data-copy-created-id>复制 ID</button></div><p class="form-error" role="alert"></p><button class="primary" data-id-saved>已保存 ID，进入</button>';
    let fields='';
    if(mode==='email')fields='<label class="field">邮箱<input name="email" type="email" value="'+esc(email)+'" maxlength="254" autocomplete="email" required placeholder="'+(capabilities?.simulationScope==='internal-preview'?'tester@example.test':'you@example.com')+'"></label>';
    else if(mode==='otp')fields='<p>'+esc(email)+'</p><label class="field">验证码<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></label>'+(simulatedMail()&&challenge?.simulationCode?'<p class="account-simulation">'+(capabilities?.simulationScope==='internal-preview'?'内部测试验证码':'本机模拟验证码')+'：<strong>'+esc(challenge.simulationCode)+'</strong></p>':'');
    else {
      if(mode!=='register')fields+='<label class="field">公开账户 ID<input name="userId" value="'+esc(savedId)+'" pattern="[A-Za-z0-9_]{5,24}" minlength="5" maxlength="24" autocomplete="username" autocapitalize="none" required></label>';
      if(mode==='recover')fields+='<label class="field">账号恢复码<input name="recoveryCode" maxlength="160" autocomplete="off" required></label>';
      fields+=passwordField('password',mode==='login'?'账号密码':publicPasswords()?'设置账号密码（12–128 个字符）':'6 位账号密码',mode==='login');
      if(mode==='recover'||publicPasswords()&&mode==='register')fields+=passwordField('repeat','确认新密码');
    }
    let switches='';
    if(publicPasswords())switches=mode==='register'?'<button class="account-switch" data-mode="login">已有 ID？登录</button>':mode==='recover'?'<button class="account-switch" data-mode="login">返回 ID 登录</button>':'<button class="account-switch" data-mode="register">创建新账号</button><button class="account-switch" data-mode="recover">使用恢复码找回</button>';
    else if(mode==='email')switches='<button class="secondary" data-passkey-login>使用通行密钥登录</button><button class="account-switch" data-mode="login">已有 ID 和密码？登录</button>';
    else if(mode==='otp')switches='<button class="account-switch" data-resend>重新发送验证码</button><button class="account-switch" data-mode="email">修改邮箱</button>';
    else switches=(capabilities?.emailMode!=='disabled'?'<button class="account-switch" data-mode="email">返回邮箱登录</button>':'')+(mode==='login'?'<button class="account-switch" data-mode="recover">使用恢复码找回</button>'+(capabilities?.simulation?'<button class="account-switch" data-mode="register">旧版测试账号入口</button>':''):'<button class="account-switch" data-mode="login">返回 ID 登录</button>');
    if(publicPasswords()&&mode==='login')switches+='<button class="secondary" data-passkey-login>使用通行密钥登录</button>';
    return '<form data-account-form>'+fields+'<p class="form-error" role="alert">'+esc(error)+'</p><button class="primary" type="submit">'+({email:'获取验证码',otp:'验证并进入',recover:'恢复账号',register:'创建账号',login:'登录'}[mode])+'</button></form>'+switches;
  }
  function render(){
    const title={checking:'连接账号服务',unavailable:'暂时无法连接',created:'账号已就绪',email:'邮箱验证，即刻进入',otp:'输入邮箱验证码',login:publicPasswords()?'ID 和密码登录':'已有账号登录',register:publicPasswords()?'创建你的 YBZ 账号':'创建旧版测试账号',recover:'恢复账号'}[mode];
    const description=mode==='email'?'验证邮箱后自动创建或进入账号，头像和公开 ID 可以稍后设置。':mode==='otp'?'验证码 5 分钟有效，仅可使用一次。':mode==='recover'?'使用事先保存的恢复码；恢复后所有旧设备退出，账号安全保护期至少 48 小时。':mode==='login'?'使用你自己的账号密码，旧账号的 6 位数字密码仍可登录。':mode==='register'?'ID 由系统随机分配，昵称与公开 ID 可在个人资料中设置。':'';
    container.innerHTML='<section class="account-gate"><img class="account-logo" src="./icon.png" alt="愚笨者"><span class="account-brand" lang="en">YBZ</span><span class="account-eyebrow">技能交给 AI，判断留给自己。</span><h2>'+title+'</h2><p>'+description+'</p><p data-account-mode class="account-status" role="status">'+accountEmailModeText(capabilities)+'</p>'+(notice?'<p class="account-status" role="status">'+esc(notice)+'</p>':'')+(error&&onRetry?'<button class="subtle-button" data-account-retry>重新连接已有账号</button>':'')+(loading?'<p role="status">正在连接账号服务…</p>':controls())+'<div class="account-details"><p>'+(publicPasswords()?'账号密码与本机钱包密码相互独立。请在安全中心保存账号恢复码；未保存恢复方式时，忘记密码可能无法找回。':'邮箱默认私密，好友通过公开 ID 找到你。邮箱登录不能代替通行密钥的设备确认，也不能恢复钱包助记词或私钥。')+'</p><p><a href="./privacy.html" target="_blank" rel="noopener">隐私政策</a> · <a href="./terms.html" target="_blank" rel="noopener">用户协议</a></p><button class="subtle-button" data-local-wallet>使用本机钱包</button></div></section>';
    for(const b of container.querySelectorAll('[data-mode]'))b.onclick=()=>{if(busy)return;retain();mode=b.dataset.mode;notice='';error='';render();};
    container.querySelector('[data-local-wallet]').onclick=()=>{if(!busy)onWallet?.();};
    const retry=container.querySelector('[data-account-retry]');if(retry)retry.onclick=()=>{if(!busy)onRetry?.();};
    const reload=container.querySelector('[data-reload-capabilities]');if(reload)reload.onclick=()=>run(loadCapabilities);
    const saved=container.querySelector('[data-id-saved]');if(saved)saved.onclick=()=>{if(!busy&&!disposed)onReady(registered,client.getLastAuthCreated?.()??true);};
    const copy=container.querySelector('[data-copy-created-id]');if(copy)copy.onclick=()=>run(async()=>{try{await navigator.clipboard.writeText(registered.userId);if(!disposed)message('ID 已复制，请妥善保存。');}catch{throw Error('复制不可用，请长按 ID 复制或手动保存。');}});
    const passkey=container.querySelector('[data-passkey-login]');if(passkey)passkey.onclick=()=>run(async()=>{const p=await access.loginPasskey();if(!disposed)onReady(p,false);});
    const resend=container.querySelector('[data-resend]');if(resend)resend.onclick=()=>run(async()=>{if(Date.now()<resendAt)throw Error('请等待 60 秒重发间隔结束。');requestId=crypto.randomUUID();challenge=await access.requestEmail(email,requestId);resendAt=challenge.resendAt;if(!disposed)render();});
    const form=container.querySelector('form');if(form)form.onsubmit=e=>{e.preventDefault();return run(async()=>{
      if(mode==='email'){email=form.elements.email.value.trim();if(requestedEmail&&requestedEmail.toLowerCase()!==email.toLowerCase())requestId=crypto.randomUUID();requestedEmail=email;challenge=await access.requestEmail(email,requestId);resendAt=challenge.resendAt;if(!disposed){mode='otp';render();}return;}
      if(mode==='otp'){const p=await access.verifyEmail(challenge.challengeId,form.elements.code.value);form.reset();if(!disposed)onReady(p,client.getLastAuthCreated?.()??true);return;}
      if(mode==='recover'){savedId=form.elements.userId.value.trim().toLowerCase();const recovered=await recoverAccount(client,{userId:savedId,recoveryCode:form.elements.recoveryCode.value,newPassword:form.elements.password.value,repeat:form.elements.repeat.value,capabilities});form.reset();client.clearSession();client.setAccessRecoveryToken?.(recovered.accessRecoveryToken);if(!disposed){mode='login';notice='已恢复，请用新密码登录，并重新绑定通行密钥。账号安全保护期至少 48 小时。';render();}return;}
      if(mode==='register'){validateNewAccountPassword(form.elements.password.value,capabilities);if(publicPasswords()&&form.elements.password.value!==form.elements.repeat.value)throw Error('两次输入的密码不一致。');}
      else if(!isCurrentAccountPassword(form.elements.password.value))throw Error('请输入你的账号密码；新账号至少 12 个字符，旧账号可用原 6 位数字密码。');
      const p=mode==='register'?await client.register(form.elements.password.value,requestId):await client.login(form.elements.userId.value.trim().toLowerCase(),form.elements.password.value);
      form.reset();if(disposed)return;if(mode==='register'&&publicPasswords()){registered=p;mode='created';render();}else onReady(p,mode==='register');
    });};
  }
  async function loadCapabilities(){mode='checking';error='';render();try{const value=await access.capabilities();if(disposed)return;capabilities=value;mode=publicPasswords()?'register':value.emailMode==='disabled'?'login':'email';render();}catch(e){if(disposed)return;mode='unavailable';error=e.message||'登录方式暂不可读取，请重试。';render();}}
  render();if(!loading)loadCapabilities();
  return ()=>{disposed=true;challenge=null;registered=null;container.querySelectorAll('input').forEach(e=>e.value='');container.replaceChildren();};
}
export function accountSettingsHTML(profile,capabilities){return '<div class="account-summary"><strong>'+esc(profile.nickname)+'</strong><span>ID '+esc(profile.userId)+'</span><button class="subtle-button" id="account-copy-id">复制 ID</button><button class="subtle-button" id="account-qr">我的好友码</button></div><button type="button" class="secondary" id="account-notifications">任务关键通知</button><form id="change-account-password" '+(profile.authMode==='email'?'hidden':'')+'><h3>修改账号密码</h3><label class="field">当前密码<input name="currentPassword" type="password" '+accountPasswordAttributes(capabilities,true)+' required></label><label class="field">新密码'+(capabilities?.passwordRegistration?'（12–128 个字符）':'')+'<input name="newPassword" type="password" '+accountPasswordAttributes(capabilities)+' required></label><label class="field">确认新密码<input name="repeat" type="password" '+accountPasswordAttributes(capabilities)+' required></label><p class="form-error" role="alert"></p><button class="secondary" type="submit">保存新密码</button></form><p class="modal-copy" '+(profile.authMode==='email'?'hidden':'')+'>修改后，其他设备需要重新登录。账号密码与本机钱包密码相互独立。</p><section data-account-security></section><button type="button" class="secondary" id="account-logout">退出账号</button><p class="modal-copy">请保存账号恢复码，并在安全中心管理通行密钥。退出不会删除本机钱包或服务器聊天记录。</p>';}

export {requestStrongProof} from './account-access-client.js';
