/* Appended to the original sandbox-compatible preload only in the isolated QA package. */
{
 const {contextBridge:qaBridge,ipcRenderer:qaIPC}=require('electron');
 qaBridge.exposeInMainWorld('YBZLocalQATheme',Object.freeze({setTheme(theme){if(['light','dark','eyecare'].includes(theme))qaIPC.send('ybz-local-qa:theme',theme);},readState(){return qaIPC.invoke('ybz-local-qa:theme-state');}}));
}
