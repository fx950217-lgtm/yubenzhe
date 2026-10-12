'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {stopUtility}=require('./device-process-stop.cjs');
const {SETUP_CATALOG,setupToolUrl}=require('./setup-catalog.cjs');
const CODE=/^YBZ-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
function trustedOrigin(value){let url;try{url=new URL(value);}catch{throw Error('请填写可信服务的 HTTPS 地址。');}if(url.protocol!=='https:'||url.origin!==value||url.username||url.password)throw Error('只允许完整 HTTPS 源地址，不带路径、账号或密码。');return url.origin;}
function publicState(state){return {origin:state.origin||'',name:state.name||os.hostname().slice(0,60),source:state.source||'local',code:state.code||null,expiresAt:state.expiresAt||null,paired:Boolean(state.deviceId&&state.token),deviceId:state.deviceId||null,running:state.running===true,autoStart:state.autoStart===true,capabilities:state.capabilities||null,message:state.message||'',workspace:state.workspace||'',setupCatalog:SETUP_CATALOG};}
function safeEnvironment(env=process.env){const out={...env};for(const key of Object.keys(out))if(/^(NODE_OPTIONS|ELECTRON_RUN_AS_NODE|NODE_TLS_REJECT_UNAUTHORIZED)$/i.test(key))delete out[key];return out;}
async function boundedJson(response){if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'操作过于频繁，请稍后再试。':response.status===401||response.status===403?'当前服务拒绝设备连接，请核对中转服务配置。':'服务暂不可用，请核对地址与网络。');}const reader=response.body?.getReader();if(!reader)throw Error('服务响应无效。');let chunks=[],size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw Error('服务响应过大。');}chunks.push(value);}}finally{reader.releaseLock();}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function createDeviceManager({electron,showApp,connectorDirectory,probeImpl=null,fetchImpl=globalThis.fetch}={}){
 const {app,BrowserWindow,ipcMain,dialog,Tray,Menu,safeStorage,utilityProcess}=electron;
 const data=path.join(app.getPath('userData'),'device-link'),saved=path.join(data,'private-state.bin'),runtime=path.join(data,'runtime'),workspace=path.join(data,'workspace');
 const connector=connectorDirectory||(app.isPackaged?path.join(process.resourcesPath,'device-bridge'):path.resolve(__dirname,'../../yubenzhe-deploy/device-bridge'));
 let state={workspace},wizard=null,tray=null,pairTimer=null,busy=false,worker=null,screen=null,closed=false;
 let operations=Promise.resolve(),intent=0,unreadable=false,stopFailed=false;
 const serialize=fn=>{const next=operations.then(fn);operations=next.catch(()=>{});return next;};
 const wizardUrl=pathToFileURL(path.join(__dirname,'device-wizard.html')).href;
 const privateFile=path.join(runtime,'desktop-device-state.json');
 async function persist(){if(unreadable)throw Error('旧设备凭据无法解密，原文件保持不动；请检查 Windows 账号或在本机重置连接。');if(!safeStorage.isEncryptionAvailable())throw Error('系统安全存储不可用，不能保存设备凭据。');await fs.mkdir(data,{recursive:true});const value={...state};for(const key of ['capabilities','running','message','workspace','executable'])delete value[key];const temp=saved+'.tmp-'+crypto.randomUUID();try{await fs.writeFile(temp,safeStorage.encryptString(JSON.stringify(value)),{flag:'wx',mode:0o600});await fs.rename(temp,saved);}finally{await fs.unlink(temp).catch(()=>{});}}
 function update(message){if(message!==undefined)state.message=message;if(wizard&&!wizard.isDestroyed())wizard.webContents.send('ybz-device:state',publicState(state));}
 async function request(input){return boundedJson(await fetchImpl(trustedOrigin(state.origin)+'/api/device-bridge/claim',{method:'POST',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));}
 async function probe(){const probeCapabilities=probeImpl||(await import(pathToFileURL(path.join(connector,'capabilities.mjs')).href)).probeCapabilities;const result=await probeCapabilities({runtimeDir:runtime,workspace,autoStart:state.autoStart});state.capabilities=result.capabilities;state.executable=result.executable;update();return publicState(state);}
 async function writePrivateState(){await fs.mkdir(runtime,{recursive:true});await fs.writeFile(privateFile,JSON.stringify({origin:state.origin,deviceId:state.deviceId,token:state.token,source:state.source,capabilities:state.capabilities}),{mode:0o600});}
 async function startImpl(epoch){if(unreadable||stopFailed)throw Error('请先解决设备凭据或停止状态，再启动连接。');if(closed||epoch!==intent||state.running||!state.token)return publicState(state);await probe();if(closed||epoch!==intent)return publicState(state);await writePrivateState();if(closed||epoch!==intent){await fs.unlink(privateFile).catch(()=>{});return publicState(state);}state.enabled=true;await persist();if(closed||epoch!==intent)return publicState(state);const config={statePath:privateFile,runtimeDir:path.join(runtime,'ai'),workspace,executable:state.executable,capabilities:state.capabilities,source:state.source};
  try{worker=utilityProcess.fork(path.join(connector,'desktop-worker.mjs'),[],{serviceName:'YBZ device AI connector',cwd:runtime,env:safeEnvironment(),stdio:'pipe'});
  worker.stdout?.on('data',()=>{});worker.stderr?.on('data',()=>{});
  worker.on('message',value=>{if(value?.kind==='ready')update('设备连接器已启动；手机可查看实际在线状态。');else if(value?.kind==='error')update('连接器未继续执行，请检查本机登录与运行环境。');});
  worker.once('exit',()=>{worker=null;state.running=Boolean(screen);update('AI 连接器已停止。');});worker.postMessage({kind:'start',config});
  if(state.capabilities.screen.state==='supported'||state.capabilities.screen.state==='partial'){
   screen=utilityProcess.fork(path.join(connector,'desktop-worker.mjs'),[],{serviceName:'YBZ screen connector',cwd:runtime,env:safeEnvironment(),stdio:'pipe'});screen.stdout?.on('data',()=>{});screen.stderr?.on('data',()=>{});screen.once('exit',()=>{screen=null;state.running=Boolean(worker);update();});screen.postMessage({kind:'screen',statePath:privateFile});
  }
  state.running=true;update();return publicState(state);
  }catch(error){await stopImpl();update('设备连接器未能启动，已停止本次连接。请检查本机运行环境后重试。');throw error;}
 }
 const start=()=>{const epoch=intent;return serialize(()=>startImpl(epoch));};
 async function stopImpl(){state.enabled=false;await fs.writeFile(privateFile+'.stop','stop',{mode:0o600}).catch(()=>{});let persistenceError;try{if(!unreadable)await persist();}catch(error){persistenceError=error;}const results=await Promise.allSettled([worker,screen].filter(Boolean).map(child=>stopUtility(child)));const failed=results.find(x=>x.status==='rejected');if(failed){stopFailed=true;update(failed.reason.message);throw failed.reason;}stopFailed=false;worker=null;screen=null;state.running=false;await fs.unlink(privateFile).catch(()=>{});try{if(!unreadable)await persist();persistenceError=null;}catch(error){persistenceError=error;}if(persistenceError){update('进程已停止，但无法保存停止设置，请检查本机存储后重试。');throw persistenceError;}update(unreadable?'旧设备凭据无法解密，未启动连接，原文件保持不动。':'设备连接已停止，远控与 AI 不再接收新任务。');return publicState(state);}
 function stop(){intent++;return serialize(stopImpl);}
 async function poll(){if(busy||closed||!state.claimId||!state.pollSecret||state.token)return;busy=true;const epoch=intent;try{await serialize(async()=>{if(closed||!state.claimId||state.token)return;const response=await request({action:'poll',claimId:state.claimId,pollSecret:state.pollSecret});if(response.status==='paired'){
   if(!/^[A-Za-z0-9_-]{43}$/.test(response.token||'')||typeof response.deviceId!=='string'||response.deviceId.length>100)throw Error('设备凭据响应无效。');state.token=response.token;state.deviceId=response.deviceId;state.code=null;state.expiresAt=null;delete state.claimId;delete state.pollSecret;await persist();await startImpl(epoch);
  }});}catch(error){update(error.message);}finally{busy=false;}}
 async function generateImpl(input={}){if(unreadable)throw Error('请先检查旧凭据或在本机重置连接。');if(state.token)throw Error('设备已经配对；如需重新配对，先在手机撤销，再使用本机重置连接。');const nextOrigin=trustedOrigin(input.origin||state.origin);if(state.claimId&&nextOrigin!==state.origin)throw Error('已有配对流程时不能更换服务地址。');state.origin=nextOrigin;state.name=String(input.name||state.name||os.hostname()).trim().slice(0,60);if(!state.name)throw Error('请输入设备名称。');if(!['local','cloud','server'].includes(input.source||state.source||'local'))throw Error('设备来源无效。');state.source=input.source||state.source||'local';await probe();
  if(state.expiresAt&&Date.now()>=state.expiresAt){delete state.claimId;delete state.pollSecret;delete state.code;delete state.expiresAt;}
  const response=await request(state.claimId&&state.pollSecret?{action:'rotate',claimId:state.claimId,pollSecret:state.pollSecret}:{action:'create',name:state.name,source:state.source,capabilities:state.capabilities});
  if(!CODE.test(response.code||'')||typeof response.claimId!=='string'||!Number.isFinite(response.expiresAt))throw Error('机器码响应无效。');const secret=response.pollSecret||state.pollSecret;if(!/^[A-Za-z0-9_-]{43}$/.test(secret||''))throw Error('配对保护凭据无效。');Object.assign(state,{claimId:response.claimId,pollSecret:secret,code:response.code,expiresAt:response.expiresAt});await persist();update('在手机「我的设备」输入机器码。持码者可绑定此电脑，请仅交给自己。');return publicState(state);
 }
 const generate=input=>serialize(()=>generateImpl(input));
 async function importLegacy(epoch){
  if(unreadable)throw Error('旧设备凭据无法解密，请先检查或重置连接。');
  if(state.token)throw Error('当前设备已经配对。');
  const selection=await dialog.showOpenDialog(wizard,{title:'选择手机生成的旧配对文件',properties:['openFile'],filters:[{name:'YBZ 配对文件',extensions:['json']}]});
  if(selection.canceled)return publicState(state);
  const filename=selection.filePaths[0],info=await fs.stat(filename);if(!info.isFile()||info.size>16384)throw Error('配对文件无效。');
  const value=JSON.parse(await fs.readFile(filename,'utf8')),origin=trustedOrigin(value.origin);
  if(!/^[A-Za-z0-9_-]{43}$/.test(value.pairToken||''))throw Error('请选择尚未使用的手机配对文件。');
  const confirm=await dialog.showMessageBox(wizard,{type:'question',title:'确认配对服务',message:'允许这台电脑连接该服务？',detail:origin+'\n只导入自己的配对文件。',buttons:['取消','连接'],defaultId:0,cancelId:0});
  if(confirm.response!==1||closed||epoch!==intent)return publicState(state);
  const response=await boundedJson(await fetchImpl(origin+'/api/device-bridge/enroll',{method:'POST',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json'},body:JSON.stringify({pairToken:value.pairToken})}));
  if(!/^[A-Za-z0-9_-]{43}$/.test(response.token||'')||typeof response.deviceId!=='string')throw Error('配对响应无效。');
  Object.assign(state,{origin,token:response.token,deviceId:response.deviceId,code:null,expiresAt:null});delete state.claimId;delete state.pollSecret;
  await persist();return startImpl(epoch);
 }
 async function resetLocal(){
  const answer=await dialog.showMessageBox(wizard,{type:'warning',title:'重置本机设备连接',message:'停止并重新配对这台电脑？',detail:'先在手机撤销旧设备。此操作只重置本机连接，不会替你撤销服务器授权。原加密凭据会保留为本机备份，工作文件和钱包不会删除。',buttons:['取消','停止并重置'],defaultId:0,cancelId:0});
  if(answer.response!==1)return publicState(state);
  await stopImpl();
  try{await fs.copyFile(saved,path.join(data,'private-state-backup-'+Date.now()+'-'+crypto.randomUUID()+'.bin'),require('node:fs').constants.COPYFILE_EXCL);}catch(error){if(error.code!=='ENOENT')throw error;}
  state={workspace,name:state.name,source:state.source,origin:state.origin,autoStart:state.autoStart,enabled:false,running:false};unreadable=false;
  await persist();await probe();update('本机连接已重置。请生成新机器码；旧设备仍需在手机撤销。');return publicState(state);
 }
 function show(){if(wizard&&!wizard.isDestroyed()){wizard.show();wizard.focus();return;}wizard=new BrowserWindow({width:720,height:790,minWidth:620,minHeight:620,title:'YBZ · 连接这台电脑',backgroundColor:'#F7F7F9',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'device-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:false,partition:'ybz-device-setup'}});wizard.setContentProtection(true);wizard.webContents.setWindowOpenHandler(()=>({action:'deny'}));for(const event of ['will-navigate','will-frame-navigate','will-attach-webview'])wizard.webContents.on(event,e=>e.preventDefault());wizard.webContents.session.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));wizard.webContents.session.webRequest.onBeforeRequest((details,cb)=>cb({cancel:!details.url.startsWith(pathToFileURL(__dirname+path.sep).href)}));wizard.on('closed',()=>{wizard=null;});wizard.loadURL(wizardUrl);}
 function trusted(event){return wizard&&!wizard.isDestroyed()&&wizard.isFocused()&&event.sender===wizard.webContents&&event.senderFrame===wizard.webContents.mainFrame&&event.senderFrame.url===wizardUrl;}
 async function initialize(){await fs.mkdir(data,{recursive:true});try{const bytes=await fs.readFile(saved);if(!safeStorage.isEncryptionAvailable())throw Error();state={...JSON.parse(safeStorage.decryptString(bytes)),workspace,running:false};}catch(error){if(error.code!=='ENOENT'){unreadable=true;state.message='旧设备状态无法解密，已停止连接；原文件保持不动，请检查 Windows 账号或使用本机重置连接。';}}
  ipcMain.handle('ybz-device:action',async(event,input)=>{if(!trusted(event))throw Error('请在本机设备设置窗口操作。');try{switch(input?.action){
   case 'status':return publicState(state);
   case 'openTool':{const url=setupToolUrl(input.itemId);try{await electron.shell.openExternal(url);}catch{throw Error('未能打开系统浏览器，请稍后再试。');}update('已请求系统浏览器打开官方页面，请由你本人完成安装与登录。');return publicState(state);}
   case 'probe':return await serialize(probe);
   case 'generate':return await generate(input);
   case 'start':return await start();
   case 'stop':return await stop();
   case 'import':{const epoch=intent;return await serialize(()=>importLegacy(epoch));}
   case 'reset':intent++;return await serialize(resetLocal);
   case 'autoStart':return await serialize(async()=>{if(unreadable)throw Error('请先检查旧设备凭据。');if(typeof input.enabled!=='boolean')throw Error('设置无效。');app.setLoginItemSettings({openAtLogin:input.enabled,args:['--device-background']});state.autoStart=input.enabled;await persist();return await probe();});
   default:throw Error('操作无效。');}}catch(error){update(error.message);throw error;}});
  const icon=app.isPackaged?path.join(process.resourcesPath,'device-icon.ico'):path.join(__dirname,'../build/icon.ico');tray=new Tray(icon);tray.setToolTip('YBZ · 我的设备');tray.setContextMenu(Menu.buildFromTemplate([{label:'打开愚笨者',click:showApp},{label:'机器码与设备设置',click:show},{label:'停止设备连接',click:()=>stop().catch(()=>{})},{type:'separator'},{label:'退出愚笨者',click:()=>app.quit()}]));tray.on('double-click',show);
  await probe();pairTimer=setInterval(()=>void poll(),2000);pairTimer.unref?.();if(state.token&&state.enabled)await start();if(!state.token||process.argv.includes('--device-setup'))show();else if(state.claimId)void poll();
 }
 return {initialize,show,start,stop,probe,get running(){return state.running;},async close(){closed=true;intent++;clearInterval(pairTimer);await serialize(async()=>{const enabled=state.enabled;await stopImpl();state.enabled=enabled;if(!unreadable)await persist();tray?.destroy();});},get state(){return publicState(state);},get wizard(){return wizard;}};
}
module.exports={createDeviceManager,trustedOrigin,publicState,safeEnvironment,boundedJson};
