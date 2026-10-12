const keyBytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function supportsWebPush(env=globalThis){return !!(env.isSecureContext&&env.navigator?.serviceWorker&&env.PushManager&&env.Notification);}
export function mountNotificationSettings(container,{client}){
 let disposed=false,busy=false,configured=false,canEnable=false,canDisable=false;
 const owner=client.getProfile()?.userId;
 const active=()=>!disposed&&owner&&client.getProfile()?.userId===owner;
 const check=()=>{if(!active())throw Object.assign(new Error('账号或页面已改变，请重新打开通知设置。'),{name:'AbortError'})};
 container.innerHTML='<section class="notification-settings"><p class="modal-copy">仅在执行结束、需要你决策或执行异常时提醒。普通聊天只显示未读；锁屏不显示任务内容、对话正文或决策选项。退出账号或撤销设备后，相应任务不再提醒。</p><p role="status" data-notification-status>正在检查…</p><button class="primary" data-notification-enable hidden disabled>开启任务关键通知</button><button class="secondary" data-notification-disable hidden disabled>关闭本浏览器通知</button></section>';
 const status=container.querySelector('[data-notification-status]'),enable=container.querySelector('[data-notification-enable]'),disable=container.querySelector('[data-notification-disable]');
 const request=(path,body)=>{check();return client.authenticatedRequest(path,body===undefined?{method:'GET'}:{method:'POST',input:body})};
 const controls=()=>{enable.hidden=!canEnable;enable.disabled=busy||!canEnable;disable.hidden=!canDisable;disable.disabled=busy||!canDisable;};
 async function refresh(){
  configured=canEnable=canDisable=false;delete enable.dataset.key;controls();
  if(!supportsWebPush()){status.textContent='当前客户端不支持浏览器后台通知。可在支持通知的浏览器中使用；iPhone 需将网页添加到主屏幕。原生客户端推送仍待接入。';return;}
  try{const result=await request('notifications/status');if(!active())return;
   const registration=await navigator.serviceWorker.getRegistration('/'),sub=await registration?.pushManager.getSubscription();if(!active())return;
   canDisable=!!sub;controls();
   if(result.available!==true){status.textContent='任务关键通知尚未配置。任务和普通聊天仍可正常使用，请在应用内查看状态。';return;}
   if(typeof result.publicKey!=='string'||!result.publicKey||!Array.isArray(result.subscriptions))throw Error('任务关键通知配置无法确认，请稍后重新打开。');
   const linked=!!sub&&result.subscriptions.some(s=>s.currentSession);
   status.textContent=Notification.permission==='denied'?'浏览器已禁止通知，请在网站权限设置中允许后重试。':linked?'本浏览器任务关键通知已开启。':'本浏览器尚未开启任务关键通知。';
   configured=true;canEnable=!linked&&Notification.permission!=='denied';enable.dataset.key=result.publicKey;controls();
  }catch(error){configured=canEnable=false;if(active()){controls();status.textContent=error.message;}}
 }
 enable.onclick=async()=>{if(busy||!active()||!configured||!canEnable||!supportsWebPush())return;busy=true;controls();
  try{const permission=await Notification.requestPermission();check();if(permission!=='granted')throw new Error('未获得通知权限，你仍可正常收发消息。');
   await navigator.serviceWorker.register('./sw.js',{scope:'./'});check();const registration=await navigator.serviceWorker.ready;check();
   let subscription=await registration.pushManager.getSubscription();check();
   if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(enable.dataset.key)});check();
   await request('notifications/subscribe',{subscription:subscription.toJSON()});if(active())await refresh();
  }catch(error){if(active())status.textContent=error.message;}
  finally{busy=false;if(active())controls();}
 };
 disable.onclick=async()=>{if(busy||!active()||!canDisable)return;busy=true;controls();
  try{const registration=await navigator.serviceWorker.getRegistration('/'),sub=await registration?.pushManager.getSubscription();check();if(sub){await request('notifications/unsubscribe',{endpoint:sub.endpoint});check();if(!await sub.unsubscribe())throw new Error('服务器通知已关闭，请在浏览器权限中确认通知设置。');}if(active())await refresh();}
  catch(error){if(active())status.textContent=error.message;}finally{busy=false;if(active())controls();}
 };
 refresh();return ()=>{disposed=true;};
}
