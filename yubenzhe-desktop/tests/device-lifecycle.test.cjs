'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {createDeviceManager}=require('../src/device-manager.cjs');
const {stopUtility}=require('../src/device-process-stop.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
const capabilities={screen:{state:'unsupported',reason:'Synthetic no desktop'},ai:{state:'unsupported',reason:'Synthetic no CLI'},files:{state:'partial',reason:'Writable'},autoStart:{state:'supported',reason:'Optional'}};
async function fixture(t,{initial,raw,probe,fetchImpl,failForkAt}={}){
 const parent=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(parent,'ybz-lifecycle-'));let manager,window,actions,forks=[];
 t.after(async()=>{await manager?.close();const actual=await fs.realpath(root);assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(actual).startsWith('ybz-lifecycle-'));await fs.rm(actual,{recursive:true,force:true});});
 const saved=path.join(root,'device-link/private-state.bin');await fs.mkdir(path.dirname(saved),{recursive:true});
 if(initial)await fs.writeFile(saved,Buffer.from('encrypted:'+JSON.stringify(initial)));if(raw)await fs.writeFile(saved,raw);
 class Window extends EventEmitter{constructor(){super();window=this;this.webContents=new EventEmitter();this.webContents.mainFrame={url:pathToFileURL(path.resolve(__dirname,'../src/device-wizard.html')).href};this.webContents.session={setPermissionRequestHandler(){},webRequest:{onBeforeRequest(){}}};this.webContents.send=()=>{};this.webContents.setWindowOpenHandler=()=>{};}isDestroyed(){return false;}isFocused(){return true;}setContentProtection(){}loadURL(){}show(){}focus(){}}
 const electron={app:{getPath:()=>root,isPackaged:false,setLoginItemSettings(){}},BrowserWindow:Window,ipcMain:{handle:(_name,fn)=>{actions=fn;}},dialog:{showMessageBox:async()=>({response:1})},Tray:class{setToolTip(){}setContextMenu(){}on(){}destroy(){}},Menu:{buildFromTemplate:x=>x},safeStorage:{isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from('encrypted:'+x),decryptString:x=>{if(!x.toString().startsWith('encrypted:'))throw Error('Cannot decrypt');return x.toString().slice(10);}},utilityProcess:{fork(){if(forks.length+1===failForkAt)throw Error('Synthetic fork failure');const child=new EventEmitter();child.pid=321;child.postMessage=m=>{if(m.kind==='stop')queueMicrotask(()=>{child.pid=undefined;child.emit('exit',0);});};forks.push(child);return child;}}};
 manager=createDeviceManager({electron,showApp(){},probeImpl:probe||(async()=>({executable:null,capabilities})),fetchImpl});await manager.initialize();manager.show();
 return {manager,root,saved,forks,invoke:input=>actions({sender:window.webContents,senderFrame:window.webContents.mainFrame},input)};
}
test('stop during asynchronous startup prevents subsequent worker spawn',async t=>{
 let resolveProbe,entered;const probeEntered=new Promise(r=>{entered=r;});let calls=0;
 const h=await fixture(t,{initial:{origin:'https://relay.test',token:'t'.repeat(43),deviceId:'synthetic-device',enabled:false},probe:async()=>{if(++calls===2){entered();await new Promise(r=>{resolveProbe=r;});}return {executable:null,capabilities};}});
 const starting=h.manager.start();await probeEntered;const stopping=h.manager.stop();resolveProbe();await Promise.all([starting,stopping]);
 assert.equal(h.forks.length,0);assert.equal(h.manager.running,false);
 await assert.rejects(fs.stat(path.join(h.root,'device-link/runtime/desktop-device-state.json')),{code:'ENOENT'});
});
test('concurrent starts launch only one worker and stop waits for its exit',async t=>{
 const h=await fixture(t,{initial:{origin:'https://relay.test',token:'t'.repeat(43),deviceId:'synthetic-device',enabled:false}});
 await Promise.all([h.manager.start(),h.manager.start()]);assert.equal(h.forks.length,1);assert.equal(h.manager.running,true);
 await h.manager.stop();assert.equal(h.manager.running,false);assert.equal(h.forks[0].pid,undefined);
});
test('unreadable encrypted credentials survive initialization, mutation attempts and close unchanged',async t=>{
 const original=Buffer.from('unreadable-test-state');const h=await fixture(t,{raw:original});
 await assert.rejects(h.invoke({action:'generate',origin:'https://relay.test',name:'test'}));
 await h.manager.close();assert.deepEqual(await fs.readFile(h.saved),original);
});
test('partial startup failure stops already spawned worker and clears restart intent',async t=>{
 const h=await fixture(t,{initial:{origin:'https://relay.test',token:'t'.repeat(43),deviceId:'synthetic-device',enabled:false},failForkAt:2,probe:async()=>({executable:null,capabilities:{...capabilities,screen:{state:'partial',reason:'Synthetic desktop'}}})});
 await assert.rejects(h.manager.start(),/Synthetic fork failure/);assert.equal(h.forks.length,1);assert.equal(h.forks[0].pid,undefined);assert.equal(h.manager.running,false);
 const saved=JSON.parse((await fs.readFile(h.saved,'utf8')).slice(10));assert.equal(saved.enabled,false);
 await assert.rejects(fs.stat(path.join(h.root,'device-link/runtime/desktop-device-state.json')),{code:'ENOENT'});
});
test('explicit local reset preserves old encrypted state backup and permits a new pairing',async t=>{
 const h=await fixture(t,{initial:{origin:'https://relay.test',token:'t'.repeat(43),deviceId:'synthetic-device',enabled:false},fetchImpl:async()=>Response.json({claimId:'synthetic-claim',code:'YBZ-7K2M-9QX4',pollSecret:'s'.repeat(43),expiresAt:Date.now()+600000})});
 await h.invoke({action:'reset'});assert.equal(h.manager.state.paired,false);
 const files=await fs.readdir(path.dirname(h.saved));assert.equal(files.filter(x=>x.startsWith('private-state-backup-')).length,1);
 const generated=await h.invoke({action:'generate',origin:'https://relay.test',name:'repaired'});assert.equal(generated.code,'YBZ-7K2M-9QX4');
});
test('graceful stop is unresolved until actual utility exit',async()=>{
 const child=new EventEmitter();child.pid=123;child.postMessage=()=>{};let done=false;
 const stop=stopUtility(child,{softMs:1000}).then(()=>{done=true;});await tick();assert.equal(done,false);child.emit('exit',0);await stop;assert.equal(done,true);
});
test('forced Windows stop waits for successful taskkill AND actual worker exit',async()=>{
 const child=new EventEmitter(),killer=new EventEmitter();child.pid=123;child.postMessage=()=>{};let invoked,done=false;
 const stop=stopUtility(child,{softMs:1,hardMs:1000,platform:'win32',spawnImpl:(exe,args,opts)=>{invoked={exe,args,opts};return killer;}}).then(()=>{done=true;});
 await new Promise(r=>setTimeout(r,15));assert.equal(done,false);assert.deepEqual(invoked.args,['/PID','123','/T','/F']);assert.equal(invoked.opts.shell,false);assert.equal(invoked.opts.windowsHide,true);
 killer.emit('exit',0);await tick();assert.equal(done,false);child.emit('exit',0);await stop;
});
test('failed process-tree termination does not claim stopped',async()=>{
 const child=new EventEmitter();child.pid=123;child.postMessage=()=>{};
 await assert.rejects(stopUtility(child,{softMs:1,hardMs:1000,platform:'win32',spawnImpl:()=>{const killer=new EventEmitter();queueMicrotask(()=>killer.emit('exit',1));return killer;}}),/进程树失败/);
});
