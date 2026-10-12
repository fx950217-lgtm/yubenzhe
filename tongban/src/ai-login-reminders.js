const names=Object.freeze({codex:'Codex',claude:'Claude',workb:'WorkB',ollama:'Ollama'});
// D1 is a reminder, never a credential form or delegated login. D2 could expose
// users to provider terms violations and account restrictions; it is not wired.
export function aiLoginReminderCards(device){
 if(!device?.online||device.providersStale||!Array.isArray(device.loginReminders)||!Array.isArray(device.providers))return '';
 const seen=new Set();
 return device.loginReminders.filter(item=>{const id=item?.providerId,row=device.providers.find(row=>row.id===id);if(!Object.hasOwn(names,id)||seen.has(id)||item.kind!=='login-required'||!row?.installed||row.loggedIn!==false)return false;seen.add(id);return true;}).map(item=>'<aside class="rw-card ac-login-reminder" role="status"><strong>'+names[item.providerId]+' 需要登录</strong><p>这台电脑上的 '+names[item.providerId]+' 需要登录，请在电脑上完成</p><small>由你本人在电脑上操作，完成后刷新设备状态。YBZ 不收集登录密码或验证码。</small></aside>').join('');
}
