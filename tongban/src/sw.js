// Notification-only worker: never cache authenticated pages, wallet files or API responses.
self.addEventListener('push',event=>{
 event.waitUntil(self.registration.showNotification('愚笨者',{body:'你有新的消息',icon:'/icon.png',badge:'/icon.png',tag:'ybz-messages',data:{url:'/#messages'}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{const tabs=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const tab of tabs){if(new URL(tab.url).origin===self.location.origin){await tab.navigate('/#messages');await tab.focus();return;}}await self.clients.openWindow('/#messages');})());
});
