'use strict';
const { app, BrowserWindow, Menu, protocol, session, ipcMain, dialog, shell, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createLocalAI } = require('./local-ai.cjs');
const localAI = createLocalAI();
const {createInternalPreview} = require('./internal-preview.cjs');
const internalPreview = createInternalPreview();
const { LOCAL_ORIGIN, CSP, isLocalUrl, localAsset, isExternalUrl, isAllowedRequest, validCameraRequest, validateJsonExport, validateArtifactExport } = require('./security.cjs');

app.enableSandbox();
app.setName('愚笨者');
protocol.registerSchemesAsPrivileged([{ scheme: 'yubenzhe', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window = null;
let saving = false;
let cameraPrompt = false;
const cameraGrants = new Set();
let deviceManager = null;
let quitting = false;
// A separate per-user review profile leaves the installed user's wallet intact.
if (process.argv.includes('--device-review')) app.setPath('userData',path.join(app.getPath('appData'),'YBZ Device Installer Review'));

function trustedSender(event) {
  return !!window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isLocalUrl(event.senderFrame.url);
}
function lockWallet() {
  cameraGrants.clear();
  localAI.cancel();
  if (window && !window.isDestroyed()) window.webContents.send('yubenzhe:background');
}

async function initialize() {
  Menu.setApplicationMenu(null);
  const isolatedSession = session.fromPartition('persist:yubenzhe');
  isolatedSession.protocol.handle('yubenzhe', async (request) => {
    const asset = localAsset(request.url);
    if (request.method !== 'GET' || !asset) return new Response('Not found', { status: 404 });
    try {
      const data = await fs.readFile(path.join(__dirname, '..', 'web', asset[0]));
      return new Response(data, { headers: { 'Content-Type': asset[1], 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    } catch { return new Response('App asset unavailable', { status: 503 }); }
  });
  isolatedSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequest(details.url, details.resourceType) }));
  isolatedSession.on('will-download', (event) => event.preventDefault());
  isolatedSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (!window || webContents !== window.webContents || !isLocalUrl(requestingOrigin) || details.isMainFrame !== true || !window.isFocused()) return false;
    if (permission === 'clipboard-sanitized-write') return true;
    return permission === 'media' && details.mediaType === 'video' && cameraGrants.has(webContents.id);
  });
  isolatedSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    if (permission === 'clipboard-sanitized-write') {
      callback(!!window && webContents === window.webContents && window.isFocused() && details.isMainFrame === true && isLocalUrl(details.requestingUrl));
      return;
    }
    if (!window || webContents !== window.webContents || !isLocalUrl(webContents.getURL()) ||
        !details.isMainFrame || !isLocalUrl(details.requestingUrl) || !validCameraRequest(permission, details) || !window.isFocused() || cameraPrompt) {
      callback(false); return;
    }
    if (cameraGrants.has(webContents.id)) { callback(true); return; }
    cameraPrompt = true;
    try {
      const answer = await dialog.showMessageBox(window, { type: 'question', title: '使用摄像头', message: '允许愚笨者使用摄像头扫码？', detail: '只用于扫描二维码，不申请麦克风权限。离开应用后，下次使用会再次询问。', buttons: ['暂不允许', '允许扫码'], defaultId: 0, cancelId: 0, noLink: true });
      const allowed = answer.response === 1 && !!window && !window.isDestroyed() && !webContents.isDestroyed() && isLocalUrl(webContents.getURL());
      if (allowed) cameraGrants.add(webContents.id);
      callback(allowed);
    } catch { callback(false); }
    finally { cameraPrompt = false; }
  });
  isolatedSession.setDevicePermissionHandler(() => false);
  window = new BrowserWindow({
    width: 1180, height: 820, minWidth: 800, minHeight: 620, show: false,
    title: '愚笨者', backgroundColor: '#FCFAFF', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), session: isolatedSession,
      contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, devTools: false, spellcheck: false,
    },
  });
  window.setContentProtection(true);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('page-title-updated', (event) => event.preventDefault());
  // A native permission/save dialog belongs to this app; do not tear down the scanner/export behind it.
  window.on('blur', () => { if (!cameraPrompt && !saving) lockWallet(); });
  window.on('minimize', lockWallet);
  window.on('close',event=>{if(deviceManager&&!quitting){event.preventDefault();lockWallet();window.hide();}});
  window.on('closed', () => { localAI.cancel(); internalPreview.clear(); window = null; });
  window.once('ready-to-show', () => { if (!process.argv.includes('--device-background') && !process.argv.includes('--device-review')) window?.show(); });
  powerMonitor.on('lock-screen', lockWallet);
  powerMonitor.on('suspend', lockWallet);
  await window.loadURL(`${LOCAL_ORIGIN}/index.html`);
  const {createDeviceManager}=require('./device-manager.cjs');
  deviceManager=createDeviceManager({electron:require('electron'),showApp:()=>{if(window){window.show();window.focus();}}});
  await deviceManager.initialize();
  if(process.argv.includes('--device-review')&&process.argv.includes('--device-smoke-test')){
    const output=path.join(app.getPath('userData'),'smoke-evidence');await fs.mkdir(output,{recursive:true});
    const setup=deviceManager.wizard;
    if(setup){if(setup.webContents.isLoading())await new Promise(resolve=>setup.webContents.once('did-finish-load',resolve));await new Promise(resolve=>setTimeout(resolve,1200));await fs.writeFile(path.join(output,'wizard.png'),(await setup.webContents.capturePage()).toPNG());await fs.writeFile(path.join(output,'wizard-dom.txt'),await setup.webContents.executeJavaScript('document.body.innerText'));}
    await fs.writeFile(path.join(output,'installed-state.json'),JSON.stringify({version:app.getVersion(),packaged:app.isPackaged,execPath:process.execPath,state:deviceManager.state},null,2));app.quit();
  }
}

for (const method of ['status','login','logout','request']) ipcMain.handle('yubenzhe:internal-'+method, async (event, value) => {
  if (!trustedSender(event)) throw new Error('无法确认内部预览请求来源。');
  if (method === 'login' && !window.isFocused()) throw new Error('请在当前应用中输入访问凭证。');
  return internalPreview[method](value);
});

ipcMain.on('yubenzhe:open-external', (event, url) => {
  if (trustedSender(event) && isExternalUrl(url)) shell.openExternal(url).catch(() => {});
});
ipcMain.handle('yubenzhe:local-ai-status', async event => {
  if (!trustedSender(event)) throw new Error('无法确认本地 AI 请求来源。');
  return localAI.status();
});
ipcMain.handle('yubenzhe:local-ai-generate', async (event, value) => {
  if (!trustedSender(event) || !window.isFocused()) throw new Error('请在应用内启动本地任务。');
  return localAI.generate(value);
});
ipcMain.handle('yubenzhe:local-ai-cancel', async (event, requestId) => {
  if (!trustedSender(event) || typeof requestId !== 'string') throw new Error('无法确认取消请求来源。');
  return localAI.cancel(requestId);
});
ipcMain.handle('yubenzhe:save-json', async (event, payload) => {
  if (!trustedSender(event)) throw new Error('无法确认导出来源。');
  if (saving) throw new Error('请先完成当前保存操作。');
  const value = validateJsonExport(payload);
  saving = true;
  try {
    const result = await dialog.showSaveDialog(window, { title: '保存加密备份或导出文件', defaultPath: value.filename, filters: [{ name: 'JSON 文件', extensions: ['json'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
    if (result.canceled || !result.filePath) return { saved: false, method: 'desktop' };
    if (path.extname(result.filePath).toLowerCase() !== '.json') throw new Error('请选择 .json 文件。');
    await fs.writeFile(result.filePath, value.content, { encoding: 'utf8', mode: 0o600 });
    return { saved: true, method: 'desktop' };
  } catch { throw new Error('未能保存文件，请检查保存位置后重试。'); }
  finally { saving = false; }
});

ipcMain.handle('yubenzhe:save-artifact',async(event,payload)=>{
 if(!trustedSender(event)||!window.isFocused())throw Error('请在当前应用中保存文件。');
 if(saving)throw Error('请先完成当前保存操作。');
 const value=validateArtifactExport(payload);saving=true;
 try{
  const result=await dialog.showSaveDialog(window,{title:'保存交付文件',defaultPath:value.filename,filters:[{name:'交付文件',extensions:[value.ext]}],properties:['showOverwriteConfirmation','createDirectory']});
  if(result.canceled||!result.filePath)return {saved:false};
  if(path.extname(result.filePath).toLowerCase()!=='.'+value.ext)throw Error('请保留交付文件扩展名。');
  await fs.writeFile(result.filePath,value.bytes,{mode:0o600});return {saved:true};
 }finally{saving=false;}
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(initialize).catch(() => { dialog.showErrorBox('愚笨者无法启动', '应用文件可能不完整，请保留本机数据，重新安装完整客户端。'); app.quit(); });
  app.on('window-all-closed', () => { if(!deviceManager)app.quit(); });
  app.on('before-quit',event=>{if(deviceManager&&!quitting){event.preventDefault();quitting=true;deviceManager.close().then(()=>app.quit()).catch(()=>{quitting=false;dialog.showErrorBox('设备连接尚未停止','后台任务未确认退出，应用保持打开。请在设备设置中重试停止，不要将此状态视为已退出。');deviceManager.show();});}});
}
