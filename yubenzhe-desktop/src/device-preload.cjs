'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('YbzDeviceSetup',Object.freeze({
 action:value=>ipcRenderer.invoke('ybz-device:action',{action:value?.action,origin:value?.origin,name:value?.name,source:value?.source,enabled:value?.enabled,itemId:value?.itemId}),
 onState:callback=>{if(typeof callback!=='function')throw Error('Invalid callback');const handler=(_event,value)=>callback(value);ipcRenderer.on('ybz-device:state',handler);return()=>ipcRenderer.removeListener('ybz-device:state',handler);}
}));
