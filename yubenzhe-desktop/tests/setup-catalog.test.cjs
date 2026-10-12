const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {pathToFileURL}=require('node:url');
const {SETUP_CATALOG,setupToolUrl}=require('../src/setup-catalog.cjs');
const {createDeviceManager}=require('../src/device-manager.cjs');

test('installer has five categories, distinct phone requirements, optional Node and four AI provider keys',()=>{
 assert.deepEqual(SETUP_CATALOG.map(x=>x.id),['email','browser','social','ai','ybz']);
 const items=SETUP_CATALOG.flatMap(x=>x.items);
 assert.equal(items.length,new Set(items.map(x=>x.id)).size);
 assert.deepEqual(SETUP_CATALOG.find(x=>x.id==='ai').items.map(x=>x.providerId),['codex','claude','workb','ollama']);
 for(const item of SETUP_CATALOG.find(x=>x.id==='email').items){assert.match(item.note,/手机号要求/);assert.match(item.note,/注册难度/);assert.ok(item.sourceUrl.startsWith('https:'));}
 assert.match(items.find(x=>x.id==='zoho').note,/需要手机接收验证码/);
 assert.match(items.find(x=>x.id==='nodejs').note,/无需额外安装 Node.js/);
 assert.equal(items.find(x=>x.id==='ybz-connector').url,undefined);
 assert.doesNotMatch(JSON.stringify(items),/一键自动|自动登录|自动安装|\$\d|\d+\s*美元/);
 assert.ok(Object.isFrozen(SETUP_CATALOG)&&items.every(Object.isFrozen));
});
test('link resolver accepts catalog ids only, never renderer URLs or executable protocols',()=>{
 for(const item of SETUP_CATALOG.flatMap(x=>x.items).filter(x=>x.url))assert.equal(setupToolUrl(item.id),new URL(item.url).href);
 for(const value of ['https://evil.test','nodejs?url=https://evil.test','javascript:alert(1)','file:///C:/Windows/cmd.exe','ms-settings:','unknown','ybz-connector','__proto__',null,{},'a'.repeat(100)])assert.throws(()=>setupToolUrl(value));
});
async function harness(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'ybz-setup-links-'));
 t.after(async()=>{const resolved=path.resolve(base),parent=path.resolve(os.tmpdir());assert.ok(path.dirname(resolved)===parent&&path.basename(resolved).startsWith('ybz-setup-links-'));await fs.rm(resolved,{recursive:true,force:true});});
 let win,focused=true;const handlers={},opened=[],calls=[];
 class Window extends EventEmitter{constructor(){super();win=this;this.webContents=new EventEmitter();this.webContents.mainFrame={url:pathToFileURL(path.resolve(__dirname,'../src/device-wizard.html')).href};this.webContents.session={setPermissionRequestHandler(){},webRequest:{onBeforeRequest(){}}};this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=()=>{};}isDestroyed(){return false;}isFocused(){return focused;}setContentProtection(){}loadURL(){}show(){}focus(){}}
 const electron={app:{getPath:()=>base,isPackaged:false},BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers[name]=fn},dialog:{},Tray:class{setToolTip(){}setContextMenu(){}on(){}destroy(){}},Menu:{buildFromTemplate:x=>x},safeStorage:{isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x),decryptString:x=>x.toString()},utilityProcess:{fork(){calls.push('spawn');throw Error('No workers expected');}},shell:{openExternal:async url=>opened.push(url)}};
 const manager=createDeviceManager({electron,showApp(){},probeImpl:async()=>({executable:null,capabilities:{screen:{state:'unknown'},ai:{state:'unknown'},files:{state:'unknown'},autoStart:{state:'unknown'}}}),fetchImpl:async()=>{calls.push('network');throw Error('No relay expected');}});
 await manager.initialize();t.after(()=>manager.close());
 const event=()=>({sender:win.webContents,senderFrame:win.webContents.mainFrame});
 return {manager,electron,opened,calls,event,win,focus:value=>{focused=value;},invoke:(input,ev=event())=>handlers['ybz-device:action'](ev,input)};
}
test('official link click opens only the system browser without changing connection state or spawning installers',async t=>{
 const h=await harness(t);const before=h.manager.state;
 const result=await h.invoke({action:'openTool',itemId:'nodejs',url:'https://evil.test',command:'cmd.exe'});
 assert.deepEqual(h.opened,['https://nodejs.org/en/download']);assert.deepEqual(h.calls,[]);
 for(const field of ['origin','paired','deviceId','code','running','autoStart'])assert.equal(result[field],before[field]);
 assert.equal(result.setupCatalog.length,5);assert.match(result.message,/已请求系统浏览器/);
});
test('tool opening rejects foreign frames, foreign windows, unfocused window and forged ids',async t=>{
 const h=await harness(t);
 await assert.rejects(h.invoke({action:'openTool',itemId:'nodejs'},{...h.event(),senderFrame:{url:h.event().senderFrame.url}}));
 await assert.rejects(h.invoke({action:'openTool',itemId:'nodejs'},{...h.event(),sender:{}}));
 h.focus(false);await assert.rejects(h.invoke({action:'openTool',itemId:'nodejs'}));h.focus(true);
 await assert.rejects(h.invoke({action:'openTool',itemId:'https://evil.test'}));
 assert.deepEqual(h.opened,[]);assert.deepEqual(h.calls,[]);
});
test('browser launch failure is reported without claiming an installation or triggering a relay request',async t=>{
 const h=await harness(t);h.electron.shell.openExternal=async()=>{throw Error('Synthetic OS failure');};
 await assert.rejects(h.invoke({action:'openTool',itemId:'nodejs'}),/未能打开系统浏览器/);
 assert.equal(h.manager.state.paired,false);assert.deepEqual(h.calls,[]);
});
test('preload transfers a tool id but strips arbitrary URL, command and credential fields',async()=>{
 let exposed;const calls=[];const electron={contextBridge:{exposeInMainWorld:(_name,value)=>{exposed=value;}},ipcRenderer:{invoke:async(...args)=>calls.push(args),on(){},removeListener(){}}};
 vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../src/device-preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return electron;}});
 await exposed.action({action:'openTool',itemId:'nodejs',url:'https://evil.test',command:'cmd.exe',password:'synthetic-private'});
 assert.equal(calls[0][1].itemId,'nodejs');for(const key of ['url','command','password'])assert.equal(key in calls[0][1],false);
});
test('wizard renders catalog DOM and button carries only selected id; refresh preserves expanded catalog',async()=>{
 class Element{constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.textContent='';}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}}
 const names=['origin','name','source','code','expiry','generate','start','stop','import','reset','autoStart','workspace','message','capabilities','probe','setup-catalog'],elements=Object.fromEntries(names.map(id=>[id,new Element('div')]));
 let receive;const requests=[],state={setupCatalog:SETUP_CATALOG};
 const all=()=>{const result=[];const visit=node=>{result.push(node);node.children.forEach(visit);};Object.values(elements).forEach(visit);return result;};
 const context={document:{activeElement:null,getElementById:id=>elements[id],createElement:tag=>new Element(tag),querySelectorAll:tag=>all().filter(x=>x.tagName===tag)},window:{YbzDeviceSetup:{onState:fn=>{receive=fn;},action:async input=>{requests.push(input);return state;}}},Date};
 vm.runInNewContext(await fs.readFile(path.resolve(__dirname,'../src/device-wizard.js'),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
 const categories=elements['setup-catalog'].children;assert.deepEqual(categories.map(x=>x.dataset.setupCategory),['email','browser','social','ai','ybz']);
 categories[0].open=true;receive(state);assert.equal(elements['setup-catalog'].children[0],categories[0]);assert.equal(categories[0].open,true);
 const button=all().find(x=>x.dataset.setupTool==='nodejs');await button.onclick();
 assert.equal(requests.at(-1).action,'openTool');assert.equal(requests.at(-1).itemId,'nodejs');assert.equal('url' in requests.at(-1),false);
 const html=await fs.readFile(path.resolve(__dirname,'../src/device-wizard.html'),'utf8');assert.match(html,/frame-src 'none'/);assert.doesNotMatch(html,/<webview|<iframe/);
 const pkg=JSON.parse(await fs.readFile(path.resolve(__dirname,'../package.json'),'utf8'));assert.ok(pkg.build.files.includes('src/*.cjs'));
});
