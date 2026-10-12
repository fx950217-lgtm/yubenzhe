import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {createDeviceOnboarding,mountDeviceOnboarding,DEVICE_ONBOARDING_SEEN_KEY,DEVICE_INSTALL_URL} from '../src/device-onboarding.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};};
function browser(){
 const nodes=[],focused=[];let restored=0;
 const document={activeElement:{isConnected:true,focus:()=>restored++},body:{append:node=>{nodes.push(node);node.isConnected=true;}},createElement:()=>{
  const handlers=new Map();return {innerHTML:'',open:false,isConnected:false,attributes:{},handlers,
   setAttribute(name,value){this.attributes[name]=value;},addEventListener:(name,handler)=>handlers.set(name,handler),removeEventListener:name=>handlers.delete(name),
   showModal(){this.open=true;},close(){this.open=false;},remove(){this.isConnected=false;},querySelector:selector=>({focus:()=>focused.push(selector)})};
 }};
 return {document,nodes,focused,get restored(){return restored;},get dialog(){return nodes.at(-1);},
  click(action){return this.dialog.handlers.get('click')?.({target:{closest:()=>({dataset:{onboarding:action}})}});},
  input(value){this.dialog.handlers.get('input')?.({target:{name:'machineCode',value}});},
  submit(){return this.dialog.handlers.get('submit')?.({target:{matches:selector=>selector==='[data-onboarding-form]'},preventDefault(){}});},
  cancel(){return this.dialog.handlers.get('cancel')?.({preventDefault(){}});}
 };
}
function harness(t,{profile={userId:'account-a'},storage=memory(),request=async path=>path==='devices/claim'?{device:{id:'computer-1'}}:{devices:[]},mount}={}){
 let current=profile;const calls=[],paired=[],ui=browser();
 const client={getProfile:()=>current,authenticatedRequest:async(path,options)=>{calls.push({path,...options});return request(path,options);}};
 const guide=createDeviceOnboarding({client,storage,mount:mount||((options)=>mountDeviceOnboarding({...options,document:ui.document})),onPaired:device=>paired.push(device)});
 t.after(()=>guide.dispose());
 return {guide,client,calls,paired,ui,storage,owner:profile=>{current=profile;guide.syncOwner(profile);},toInput:()=>{ui.click('next');ui.click('next');ui.click('next');}};
}

test('only a verified signed-in account with a successful empty device list sees the guide',async t=>{
 const h=harness(t,{profile:null});assert.equal(await h.guide.check(),false);assert.equal(h.calls.length,0);
 h.owner({userId:'account-a'});assert.equal(await h.guide.check(),true);
 assert.deepEqual(h.calls,[{path:'devices?view=onboarding',method:'GET'}]);assert.equal(h.ui.nodes.length,1);
 assert.match(h.ui.dialog.innerHTML,/人做决策，机器干活/);assert.equal(h.storage.getItem(DEVICE_ONBOARDING_SEEN_KEY),'1');
 await h.guide.check();assert.equal(h.calls.length,1);
});
test('an account that already has a device is not interrupted or recorded as having seen the guide',async t=>{
 const h=harness(t,{request:async()=>({devices:[{id:'existing'}]})});assert.equal(await h.guide.check(),false);assert.equal(h.ui.nodes.length,0);assert.equal(h.storage.getItem(DEVICE_ONBOARDING_SEEN_KEY),null);
});
test('network failures and malformed responses are not treated as no devices',async t=>{
 for(const result of [null,{},[],{devices:null},{devices:{}},Error('offline')]){
  const h=harness(t,{request:async()=>{if(result instanceof Error)throw result;return result;}});
  assert.equal(await h.guide.check(),false);assert.equal(h.ui.nodes.length,0);assert.equal(h.storage.getItem(DEVICE_ONBOARDING_SEEN_KEY),null);
 }
});
test('failed detection may be checked again on the next sign-in without any pairing request',async t=>{
 let available=false;const h=harness(t,{request:async()=>{if(!available)throw Error('offline');return {devices:[]};}});
 await h.guide.check();h.owner(null);available=true;h.owner({userId:'account-a'});
 assert.equal(await h.guide.check(),true);assert.equal(h.calls.length,2);assert.ok(h.calls.every(call=>call.method==='GET'));
});
test('four steps provide a native-safe download link and pair only after the final explicit submit',async t=>{
 const h=harness(t);await h.guide.check();const ui=h.ui;
 assert.match(ui.dialog.innerHTML,/第 1 步，共 4 步/);assert.equal(h.calls.length,1);
 ui.click('next');assert.match(ui.dialog.innerHTML,/去电脑装 YBZ/);
 assert.ok(ui.dialog.innerHTML.includes('href="'+DEVICE_INSTALL_URL+'"'));assert.doesNotMatch(ui.dialog.innerHTML,/target=|window\.open|javascript:/);
 assert.equal((ui.dialog.innerHTML.match(/class="device-onboarding-primary"/g)||[]).length,1);
 ui.click('next');assert.match(ui.dialog.innerHTML,/8 位机器码/);assert.match(ui.dialog.innerHTML,/格式示例/);
 ui.click('next');assert.match(ui.dialog.innerHTML,/data-onboarding-form/);assert.equal(h.calls.length,1);
 ui.input('ybz 7k2m 9qx4');await ui.submit();
 assert.deepEqual(h.calls[1],{path:'devices/claim',method:'POST',input:{code:'YBZ-7K2M-9QX4'}});
 assert.deepEqual(h.paired,[{id:'computer-1'}]);assert.equal(ui.dialog.isConnected,false);assert.equal(ui.restored,1);
});
test('each step has Skip, and skip persists on this machine across account changes and remounts',async t=>{
 const storage=memory(),h=harness(t,{storage});await h.guide.check();
 for(let step=0;step<4;step++){assert.match(h.ui.dialog.innerHTML,/data-onboarding="skip"/);if(step<3)h.ui.click('next');}
 h.ui.click('skip');assert.equal(h.ui.dialog.isConnected,false);assert.equal(h.calls.length,1);
 h.owner({userId:'account-b'});await h.guide.check();assert.equal(h.calls.length,1);
 const next=harness(t,{storage});assert.equal(await next.guide.check(),false);assert.equal(next.calls.length,0);
});
test('Escape and Android-style dismiss close the guide without pairing',async t=>{
 const h=harness(t);await h.guide.check();h.ui.cancel();assert.equal(h.ui.dialog.open,false);assert.equal(h.calls.length,1);
 const second=harness(t);await second.guide.check();assert.equal(second.guide.dismiss(),true);assert.equal(second.guide.dismiss(),false);assert.equal(second.calls.length,1);
});
test('invalid or ambiguous machine codes fail locally without a server claim',async t=>{
 const h=harness(t);await h.guide.check();h.toInput();h.ui.input('YBZ-0000-1111');await h.ui.submit();
 assert.equal(h.calls.length,1);assert.match(h.ui.dialog.innerHTML,/请输入电脑显示的 8 位机器码/);
 h.ui.input('7K2M9QX4');await h.ui.submit();assert.equal(h.paired.length,1);
});
test('failed claims retain the entered code, escape errors, and never retry automatically',async t=>{
 const h=harness(t,{request:async path=>{if(path==='devices/claim')throw Error('机器码已过期 <script>bad</script>');return {devices:[]};}});
 await h.guide.check();h.toInput();h.ui.input('7K2M9QX4');await h.ui.submit();await h.guide.check();
 assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.match(h.ui.dialog.innerHTML,/机器码已过期 &lt;script&gt;bad&lt;\/script&gt;/);
 assert.match(h.ui.dialog.innerHTML,/value="7K2M9QX4"/);assert.equal(h.paired.length,0);
});
test('uncertain claim response does not declare success or retry',async t=>{
 const h=harness(t,{request:async path=>path==='devices/claim'?{}:{devices:[]}});await h.guide.check();h.toInput();h.ui.input('7K2M9QX4');await h.ui.submit();
 assert.match(h.ui.dialog.innerHTML,/配对结果尚未确认/);assert.equal(h.calls.length,2);assert.equal(h.paired.length,0);
});
test('duplicate submits are guarded and skipping an in-flight claim ignores its eventual result',async t=>{
 const pending=deferred(),h=harness(t,{request:path=>path==='devices/claim'?pending.promise:{devices:[]}});
 await h.guide.check();h.toInput();h.ui.input('7K2M9QX4');const submitted=h.ui.submit();await h.ui.submit();
 assert.equal(h.calls.filter(call=>call.method==='POST').length,1);assert.match(h.ui.dialog.innerHTML,/正在配对/);
 h.ui.click('back');assert.match(h.ui.dialog.innerHTML,/正在配对/);h.ui.click('skip');pending.resolve({device:{id:'late-device'}});await submitted;
 assert.equal(h.paired.length,0);assert.equal(h.ui.dialog.isConnected,false);
});
test('logout cancels pending empty-list detection; a different account can be checked safely',async t=>{
 const pending=deferred();let reads=0;const h=harness(t,{request:()=>++reads===1?pending.promise:{devices:[]}});
 const first=h.guide.check();h.owner(null);h.owner({userId:'account-b'});assert.equal(await h.guide.check(),true);
 pending.resolve({devices:[]});assert.equal(await first,false);assert.equal(h.ui.nodes.length,1);
});
test('logging out and back into the same ID still invalidates old async detection',async t=>{
 const pending=deferred(),h=harness(t,{request:()=>pending.promise});const first=h.guide.check();h.owner(null);h.owner({userId:'account-a'});
 pending.resolve({devices:[]});assert.equal(await first,false);assert.equal(h.ui.nodes.length,0);assert.equal(h.storage.getItem(DEVICE_ONBOARDING_SEEN_KEY),null);
});
test('switching accounts during claim removes the previous UI and suppresses success callbacks',async t=>{
 const pending=deferred(),h=harness(t,{request:path=>path==='devices/claim'?pending.promise:{devices:[]}});
 await h.guide.check();h.toInput();h.ui.input('7K2M9QX4');const submitted=h.ui.submit();h.owner({userId:'account-b'});
 assert.equal(h.ui.dialog.isConnected,false);pending.resolve({device:{id:'private-old-account-device'}});await submitted;
 assert.equal(h.paired.length,0);assert.equal(await h.guide.check(),false);assert.equal(h.calls.length,2);
});
test('stale guide callbacks cannot initiate a claim under another account',async t=>{
 let callbacks;const h=harness(t,{mount:options=>{callbacks=options;return ()=>{};}});await h.guide.check();h.owner({userId:'account-b'});
 await assert.rejects(()=>callbacks.claim('7K2M9QX4'),/账号已变化/);callbacks.onPaired({id:'forged'});assert.equal(h.calls.length,1);assert.equal(h.paired.length,0);
});
test('disposal invalidates late network results without marking the guide seen',async t=>{
 const pending=deferred(),h=harness(t,{request:()=>pending.promise});const started=h.guide.check();h.guide.dispose();pending.resolve({devices:[]});
 assert.equal(await started,false);assert.equal(await h.guide.check(),false);assert.equal(h.ui.nodes.length,0);assert.equal(h.storage.getItem(DEVICE_ONBOARDING_SEEN_KEY),null);
});
test('blocked storage cannot break the app and the page still remembers the guide once',async t=>{
 const storage={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}},h=harness(t,{storage});assert.equal(await h.guide.check(),true);
 h.ui.click('skip');h.owner(null);h.owner({userId:'account-b'});assert.equal(await h.guide.check(),false);assert.equal(h.calls.length,1);
});
test('a dialog that failed to open does not consume the once-only flag',async t=>{
 const h=harness(t,{mount:()=>{throw Error('dialog unavailable');}});assert.equal(await h.guide.check(),false);assert.equal(h.storage.getItem(DEVICE_ONBOARDING_SEEN_KEY),null);
});
test('going back preserves the machine code without sending it',async t=>{
 const h=harness(t);await h.guide.check();h.toInput();h.ui.input('7K2M9QX4');h.ui.click('back');h.ui.click('next');
 assert.match(h.ui.dialog.innerHTML,/value="7K2M9QX4"/);assert.equal(h.calls.length,1);
});
test('the guide and device page can read simultaneously through the real social client',async t=>{
 const result=await build({entryPoints:[fileURLToPath(new URL('../src/social-client.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
 const {createSocialClient}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const page=deferred(),storage=memory();let mounted=0;
 const profile={userId:'1234567892',nickname:'测试用户',avatar:'🌱',revision:1,level:1,official:false};
 const client=createSocialClient({baseURL:'https://test.invalid',native:false,storage,fetcher:async url=>{
  if(url.endsWith('/devices'))await page.promise;
  return new Response(JSON.stringify(url.endsWith('/me')?{profile}:{devices:[]}),{status:200,headers:{'content-type':'application/json'}});
 }});
 await client.initialize();const guide=createDeviceOnboarding({client,storage,mount:()=>{mounted++;return ()=>{};}});t.after(()=>guide.dispose());
 const devicePage=client.authenticatedRequest('devices');await guide.check();page.resolve();assert.deepEqual(await devicePage,{devices:[]});assert.equal(mounted,1);
});
