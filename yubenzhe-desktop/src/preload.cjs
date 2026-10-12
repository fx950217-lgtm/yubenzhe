'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed preloads cannot read package.json; the host appends its own build version.
const versionArgument=globalThis.process?.argv?.findLast(value=>typeof value==='string'&&value.startsWith('--ybz-app-version='));
const version=typeof versionArgument==='string'&&versionArgument.length<=96?versionArgument.match(/^--ybz-app-version=(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/)?.[1]:null;

contextBridge.exposeInMainWorld('YubenzheDesktop', Object.freeze({
  platform: 'windows',
  version: version||'unknown',
  internalPreview: Object.freeze({
    status: () => ipcRenderer.invoke('yubenzhe:internal-status'),
    login: value => ipcRenderer.invoke('yubenzhe:internal-login', {username:value?.username,password:value?.password}),
    logout: () => ipcRenderer.invoke('yubenzhe:internal-logout'),
    request: value => ipcRenderer.invoke('yubenzhe:internal-request', {path:value?.path,method:value?.method,body:value?.body,headers:value?.headers}),
  }),
  localAI: Object.freeze({
    status: () => ipcRenderer.invoke('yubenzhe:local-ai-status'),
    generate: value => ipcRenderer.invoke('yubenzhe:local-ai-generate', { model:value?.model, prompt:value?.prompt, requestId:value?.requestId }),
    cancel: requestId => ipcRenderer.invoke('yubenzhe:local-ai-cancel', requestId),
  }),
  saveArtifact: value => ipcRenderer.invoke('yubenzhe:save-artifact',{filename:value?.filename,mimeType:value?.mimeType,bodyBase64:value?.bodyBase64}),
  saveJson: (value) => ipcRenderer.invoke('yubenzhe:save-json', {
    filename: value?.filename,
    mimeType: value?.mimeType,
    content: value?.content,
  }),
  onBackground: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    const handler = () => callback();
    ipcRenderer.on('yubenzhe:background', handler);
    return () => ipcRenderer.removeListener('yubenzhe:background', handler);
  },
}));

// Only a real click can ask the host to open a whitelisted documentation/explorer link.
document.addEventListener('click', (event) => {
  if (!event.isTrusted) return;
  const link = event.target?.closest?.('a[href]');
  if (!link || !/^https:\/\//i.test(link.href)) return;
  event.preventDefault();
  ipcRenderer.send('yubenzhe:open-external', link.href);
}, true);
