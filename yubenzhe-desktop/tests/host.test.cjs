'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const security = require('../src/security.cjs');

async function host({ saveResult = { canceled: true }, writeError = null, cameraResponse = 0 } = {}) {
  const calls = { writes: [], external: [], sent: [], saves: [] };
  const ipc = new EventEmitter(); ipc.handlers = {}; ipc.handle = (name, callback) => ipc.handlers[name] = callback;
  const ses = new EventEmitter(); ses.protocol = { handle: (name, cb) => ses.protocolHandler = cb };
  ses.webRequest = { onBeforeRequest: cb => ses.requestFilter = cb };
  ses.setPermissionCheckHandler = cb => ses.checkPermission = cb;
  ses.setPermissionRequestHandler = cb => ses.requestPermission = cb;
  ses.setDevicePermissionHandler = cb => ses.devicePermission = cb;
  let win;
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.id = 1;
      this.webContents.mainFrame = { url: 'yubenzhe://app/index.html' };
      this.webContents.setWindowOpenHandler = callback => this.popup = callback;
      this.webContents.getURL = () => this.webContents.mainFrame.url;
      this.webContents.isDestroyed = () => false;
      this.webContents.send = (...args) => calls.sent.push(args);
      win = this;
    }
    setContentProtection(value) { this.protected = value; }
    isDestroyed() { return false; }
    isFocused() { return true; }
    loadURL(url) { this.loaded = url; return Promise.resolve(); }
  }
  const app = new EventEmitter();
  Object.assign(app, { enableSandbox: () => calls.sandbox = true, setName: name => calls.name = name, requestSingleInstanceLock: () => true, quit: () => {}, whenReady: () => Promise.resolve() });
  const electron = {
    app, BrowserWindow: Window, Menu: { setApplicationMenu() {} }, protocol: { registerSchemesAsPrivileged: value => calls.schemes = value },
    session: { fromPartition: value => { calls.partition = value; return ses; } }, ipcMain: ipc, powerMonitor: new EventEmitter(),
    dialog: { showSaveDialog: async (_, options) => { calls.saves.push(options); return saveResult; }, showMessageBox: async () => ({ response: cameraResponse }), showErrorBox() {} },
    shell: { openExternal: async value => calls.external.push(value) },
  };
  const fakeFs = { readFile: async () => Buffer.from('local content'), writeFile: async (...args) => { if (writeError) throw writeError; calls.writes.push(args); } };
  const filename = path.resolve(__dirname, '../src/main.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => name === 'electron' ? electron : name === 'node:fs/promises' ? fakeFs : name === './security.cjs' ? security : name === './internal-preview.cjs' ? {createInternalPreview:()=>({status:async()=>({authenticated:false}),login:async()=>({authenticated:true}),logout:async()=>({authenticated:false}),request:async()=>({status:200,bodyBase64:'',headers:{}}),clear:()=>{calls.previewCleared=true;}})} : name === './local-ai.cjs' ? {createLocalAI:()=>({status:async()=>({available:true,models:[]}),generate:async()=>({text:'test'}),cancel:()=>true})} : require(name),
    __dirname: path.dirname(filename), URL, Response, Buffer, console, Set,
  }, { filename });
  await new Promise(resolve => setImmediate(resolve));
  const event = () => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame });
  return { calls, ipc, ses, win, event, electron };
}
const validExport = { filename: 'backup.json', content: '{"encrypted":"ciphertext"}' };

test('window enforces sandbox, isolation, local origin and no renderer Node APIs', async () => {
  const { calls, win } = await host();
  assert.equal(calls.sandbox, true);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.webSecurity, true);
  assert.equal(win.options.webPreferences.webviewTag, false);
  assert.equal(win.loaded, 'yubenzhe://app/index.html');
  assert.equal(win.protected, true);
  assert.equal(win.popup().action, 'deny');
});
test('save cancel does not write or claim success', async () => {
  const { calls, ipc, event } = await host();
  const result = await ipc.handlers['yubenzhe:save-json'](event(), validExport);
  assert.equal(result.saved, false); assert.equal(calls.writes.length, 0);
});
test('save success waits for writing selected JSON path', async () => {
  const { calls, ipc, event } = await host({ saveResult: { canceled: false, filePath: '/selected/backup.json' } });
  const result = await ipc.handlers['yubenzhe:save-json'](event(), validExport);
  assert.equal(result.saved, true); assert.equal(calls.writes[0][0], '/selected/backup.json');
  assert.equal(calls.writes[0][1], validExport.content);
});
test('disk failure and non JSON selected path never return success', async () => {
  for (const opts of [{ saveResult: { canceled: false, filePath: '/selected/backup.exe' } }, { saveResult: { canceled: false, filePath: '/selected/backup.json' }, writeError: Error('disk full') }]) {
    const { ipc, event } = await host(opts);
    await assert.rejects(ipc.handlers['yubenzhe:save-json'](event(), validExport));
  }
});
test('remote URL and child-frame IPC cannot invoke filesystem dialog', async () => {
  const { calls, ipc, event, win } = await host();
  await assert.rejects(ipc.handlers['yubenzhe:save-json']({ ...event(), senderFrame: { url: 'yubenzhe://app/index.html' } }, validExport));
  win.webContents.mainFrame.url = 'https://evil.example';
  await assert.rejects(ipc.handlers['yubenzhe:save-json'](event(), validExport));
  assert.equal(calls.saves.length, 0);
});
test('focus loss, minimize and OS lock send wallet lock event', async () => {
  const { calls, win, electron } = await host();
  win.emit('blur'); win.emit('minimize'); electron.powerMonitor.emit('lock-screen'); electron.powerMonitor.emit('suspend');
  assert.equal(calls.sent.length, 4);
  for (const event of calls.sent) assert.equal(event[0], 'yubenzhe:background');
});
test('camera starts denied, requires native confirmation and resets after background', async () => {
  const { win, ses } = await host({ cameraResponse: 1 });
  const check = () => ses.checkPermission(win.webContents, 'media', 'yubenzhe://app', { isMainFrame: true, mediaType: 'video' });
  assert.equal(check(), false);
  const request = { isMainFrame: true, requestingUrl: 'yubenzhe://app/index.html', mediaTypes: ['video'] };
  const allowed = await new Promise(resolve => ses.requestPermission(win.webContents, 'media', resolve, request));
  assert.equal(allowed, true); assert.equal(check(), true);
  win.emit('blur'); assert.equal(check(), false);
  const childFrame = await new Promise(resolve => ses.requestPermission(win.webContents, 'media', resolve, { ...request, isMainFrame: false }));
  assert.equal(childFrame, false);
});
test('denied native camera confirmation grants nothing', async () => {
  const { win, ses } = await host({ cameraResponse: 0 });
  const allowed = await new Promise(resolve => ses.requestPermission(win.webContents, 'media', resolve, { isMainFrame: true, requestingUrl: 'yubenzhe://app/index.html', mediaTypes: ['video'] }));
  assert.equal(allowed, false);
});
test('focused local page may copy text but cannot read clipboard', async () => {
  const { win, ses } = await host();
  assert.equal(ses.checkPermission(win.webContents, 'clipboard-sanitized-write', 'yubenzhe://app', { isMainFrame: true }), true);
  assert.equal(ses.checkPermission(win.webContents, 'clipboard-read', 'yubenzhe://app', { isMainFrame: true }), false);
  assert.equal(ses.checkPermission(win.webContents, 'clipboard-sanitized-write', 'https://evil.example', { isMainFrame: true }), false);
});
test('navigation/downloads/device permissions denied; external shell exact allowlist enforced', async () => {
  const { ipc, event, calls, win, ses } = await host();
  let blocked = 0; const nav = { preventDefault: () => blocked++ };
  win.webContents.emit('will-navigate', nav); win.webContents.emit('will-frame-navigate', nav); win.webContents.emit('will-attach-webview', nav); ses.emit('will-download', nav);
  assert.equal(blocked, 4); assert.equal(ses.devicePermission(), false);
  ipc.emit('yubenzhe:open-external', event(), 'https://evil.example');
  ipc.emit('yubenzhe:open-external', event(), 'https://testnet.bscscan.com/tx/0x123');
  assert.deepEqual(calls.external, ['https://testnet.bscscan.com/tx/0x123']);
});

test('local AI IPC accepts only the trusted main frame and scoped cancellation', async () => {
  const {ipc,event,win}=await host();
  assert.equal((await ipc.handlers['yubenzhe:local-ai-status'](event())).available,true);
  for(const method of ['status','generate','cancel']) {
    await assert.rejects(ipc.handlers[`yubenzhe:local-ai-${method}`]({...event(),senderFrame:{url:'yubenzhe://app/index.html'}},'request-1234'));
  }
  await assert.rejects(ipc.handlers['yubenzhe:local-ai-cancel'](event(),undefined));
  win.webContents.mainFrame.url='https://evil.example';
  await assert.rejects(ipc.handlers['yubenzhe:local-ai-generate'](event(),{}));
});

test('internal preview IPC refuses other frames and clears access when window closes',async()=>{const{ipc,event,win,calls}=await host();for(const method of ['status','login','logout','request'])await assert.rejects(ipc.handlers['yubenzhe:internal-'+method]({...event(),senderFrame:{url:'yubenzhe://app/index.html'}}));assert.equal((await ipc.handlers['yubenzhe:internal-status'](event())).authenticated,false);win.emit('closed');assert.equal(calls.previewCleared,true);});
test('artifact export needs trusted frame, handles cancel and preserves chosen text extension',async()=>{const payload={filename:'订单.csv',mimeType:'text/csv',bodyBase64:Buffer.from('a,b\n1,2').toString('base64')};const h=await host({saveResult:{canceled:false,filePath:'/selected/订单.csv'}});await assert.rejects(h.ipc.handlers['yubenzhe:save-artifact']({...h.event(),senderFrame:{url:'https://elsewhere.test'}},payload));assert.equal((await h.ipc.handlers['yubenzhe:save-artifact'](h.event(),payload)).saved,true);assert.equal(h.calls.writes[0][1].toString(),'a,b\n1,2');const cancel=await host();assert.equal((await cancel.ipc.handlers['yubenzhe:save-artifact'](cancel.event(),payload)).saved,false);const wrong=await host({saveResult:{canceled:false,filePath:'/selected/x.exe'}});await assert.rejects(wrong.ipc.handlers['yubenzhe:save-artifact'](wrong.event(),payload));assert.equal(wrong.calls.writes.length,0);});
