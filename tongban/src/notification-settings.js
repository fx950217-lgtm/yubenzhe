const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyBytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function supportsWebPush(env=globalThis){return !!(env.isSecureContext&&env.navigator?.serviceWorker&&env.PushManager&&env.Notification);}
export function mountNotificationSettings(container,{client}){
 let disposed=false,busy=false;
 const owner=client.getProfile()?.userId;
 const active=()=>!disposed&&owner&&client.getProfile()?.userId===owner;
 const check=()=>{if(!active())throw Object.assign(new Error('账号或页面已改变，请重新打开通知设置。'),{name:'AbortError'})};
 container.innerHTML='<p class="modal-copy">开启后，锁屏通知仅显示“你有新的消息”，不会显示聊天正文。群聊免打扰、拉黑、退出账号或撤销设备会停止相应通知。</p><p role="status" data-notification-status>正在检查…</p><button class="primary" data-notification-enable hidden>开启消息通知</button><button class="secondary" data-notification-disable hidden>关闭本浏览器通知</button>';
 const status=container.querySelector('[data-notification-status]'),enable=container.querySelector('[data-notification-enable]'),disable=container.querySelector('[data-notification-disable]');
 const request=(path,body)=>{check();return client.authenticatedRequest(path,body===undefined?{method:'GET'}:{method:'POST',input:body})};
 async function refresh(){
  if(!supportsWebPush()){status.textContent='当前客户端不支持浏览器后台通知。可在支持通知的浏览器中使用；iPhone 需将网页添加到主屏幕。原生客户端推送仍待接入。';return;}
  try{const result=await request('notifications/status');if(!active())return;
   if(!result.available){status.textContent='服务器消息通知暂不可用，请稍后再试。';return;}
   const registration=await navigator.serviceWorker.getRegistration('/'),sub=await registration?.pushManager.getSubscription();if(!active())return;
   const linked=!!sub&&result.subscriptions.some(s=>s.currentSession);
   status.textContent=Notification.permission==='denied'?'浏览器已禁止通知，请在网站权限设置中允许后重试。':linked?'本浏览器消息通知已开启。':'本浏览器尚未开启消息通知。';
   enable.hidden=linked||Notification.permission==='denied';disable.hidden=!sub;enable.dataset.key=result.publicKey;
  }catch(error){if(active())status.textContent=error.message;}
 }
 enable.onclick=async()=>{if(busy||!active())return;busy=true;enable.disabled=disable.disabled=true;
  try{const permission=await Notification.requestPermission();check();if(permission!=='granted')throw new Error('未获得通知权限，你仍可正常收发消息。');
   await navigator.serviceWorker.register('./sw.js',{scope:'./'});check();const registration=await navigator.serviceWorker.ready;check();
   let subscription=await registration.pushManager.getSubscription();check();
   if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(enable.dataset.key)});check();
   await request('notifications/subscribe',{subscription:subscription.toJSON()});if(active())await refresh();
  }catch(error){if(active())status.textContent=error.message;}
  finally{busy=false;if(active())enable.disabled=disable.disabled=false;}
 };
 disable.onclick=async()=>{if(busy||!active())return;busy=true;enable.disabled=disable.disabled=true;
  try{const registration=await navigator.serviceWorker.getRegistration('/'),sub=await registration?.pushManager.getSubscription();check();if(sub){await request('notifications/unsubscribe',{endpoint:sub.endpoint});check();if(!await sub.unsubscribe())throw new Error('服务器通知已关闭，请在浏览器权限中确认通知设置。');}if(active())await refresh();}
  catch(error){if(active())status.textContent=error.message;}finally{busy=false;if(active())enable.disabled=disable.disabled=false;}
 };
 refresh();return ()=>{disposed=true;};
}
