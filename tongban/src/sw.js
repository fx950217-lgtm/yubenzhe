// Notification-only classic service worker. No cache/storage/fetch handlers and no external requests.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
const criticalKinds=['task-completed','decision-required','task-failed'];
const criticalUUID=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
function criticalDisplay(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['version','kind','eventId'].includes(key))||payload.version!==1||!criticalKinds.includes(payload.kind)||!criticalUUID(payload.eventId))return null;
 return {title:'YBZ 愚笨者',options:{body:{'task-completed':'本次执行已结束，请查看成果并验收。','decision-required':'有一项任务需要你决策。','task-failed':'有一项任务执行未完成，请查看。'}[payload.kind],icon:'/icon.png',badge:'/icon.png',tag:'ybz-critical-'+payload.eventId,renotify:false,data:{kind:payload.kind,eventId:payload.eventId}}};
}
self.addEventListener('push',event=>{
 event.waitUntil((async()=>{let payload;try{payload=event.data?.json();}catch{return;}const notification=criticalDisplay(payload);if(notification)await self.registration.showNotification(notification.title,notification.options);})());
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const data=event.notification.data;
 if(!data||!criticalKinds.includes(data.kind)||!criticalUUID(data.eventId))return;
 event.waitUntil((async()=>{
   const path='/#workbench',tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
   for(const tab of tabs){let origin;try{origin=new URL(tab.url).origin;}catch{continue;}if(origin!==self.location.origin)continue;try{await tab.navigate(path);await tab.focus();return;}catch{/* A closed tab cannot prevent the approved fallback. */}}
   await self.clients.openWindow(path);
 })());
});
