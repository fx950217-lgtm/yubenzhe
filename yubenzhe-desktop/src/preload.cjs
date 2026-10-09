'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('YubenzheDesktop', Object.freeze({
  platform: 'windows',
  version: '0.12.0',
  localAI: Object.freeze({
    status: () => ipcRenderer.invoke('yubenzhe:local-ai-status'),
    generate: value => ipcRenderer.invoke('yubenzhe:local-ai-generate', { model:value?.model, prompt:value?.prompt, requestId:value?.requestId }),
    cancel: requestId => ipcRenderer.invoke('yubenzhe:local-ai-cancel', requestId),
  }),
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
