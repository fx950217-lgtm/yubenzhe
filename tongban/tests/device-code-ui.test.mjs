import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {deviceCapability,deviceCanAttempt,normalizeMachineCode} from '../src/device-capabilities.js';
async function bundled(path){const result=await build({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const {mountPersonalDevices}=await bundled('../src/personal-devices.js');
const {mountLiveSocial,privateDeviceEntries}=await bundled('../src/live-social.js');
const {mountWorkbenchHub}=await bundled('../src/workbench-hub.js');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const did='11111111-1111-4111-8111-111111111111';
function browser(){const old={window:globalThis.window,document:globalThis.document,location:globalThis.location,FormData:globalThis.FormData};globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.location={origin:'https://test.invalid'};globalThis.FormData=class{constructor(form){this.values=form.values||{};}get(name){return this.values[name];}};globalThis.document={activeElement:null,addEventListener(){},removeEventListener(){},createElement:()=>({click(){}})};return ()=>{for(const [key,value] of Object.entries(old))if(value===undefined)delete globalThis[key];else globalThis[key]=value;};}
function deviceHarness(t,{devices=[{id:did,name:'办公电脑',online:true,paired:true,source:'local'}],clouds=[],request}={}){const restore=browser();let owner='owner';const handlers=new Map(),calls=[],opened=[];const root={innerHTML:'',querySelector:()=>null,addEventListener(name,fn){if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},removeEventListener(){}};const client={getProfile:()=>({userId:owner}),authenticatedRequest:async(path,options)=>{calls.push({path,...options});if(request){const result=await request(path,options);if(result!==undefined)return result;}return path==='desktop'?{desktops:clouds}:{devices};}};const cleanup=mountPersonalDevices(root,{client,onChat:id=>opened.push(id)});t.after(()=>{cleanup();restore();});return {root,calls,opened,cleanup,owner:value=>{owner=value;},input:(name,value)=>handlers.get('input')[0]({target:{name,value,matches:()=>false}}),click:async(action,id)=>{for(const fn of handlers.get('click'))await fn({target:{closest:()=>({dataset:{device:action,id}}),matches:()=>false}});},submit:async(kind,values={})=>handlers.get('submit')[0]({target:{values,matches:selector=>selector==='[data-device-'+kind+']'},preventDefault(){}})};}
test('machine code formatting accepts readable input and rejects ambiguous or malformed codes',()=>{
 assert.equal(normalizeMachineCode('ybz 7k2m 9qx4'),'YBZ-7K2M-9QX4');assert.equal(normalizeMachineCode('7k2m9qx4'),'YBZ-7K2M-9QX4');
 for(const value of ['', 'YBZ-0O1I-9999','YBZ-7K2M-9QX44','YBZ-7K2M-../.'])assert.throws(()=>normalizeMachineCode(value),/机器码/);
});
test('source never predicts capabilities and old devices remain explicitly unverified',()=>{
 for(const source of ['local','cloud','server']){assert.equal(deviceCapability({source},'screen').state,'unknown');assert.equal(deviceCanAttempt({source},'screen'),true);}
 assert.equal(deviceCanAttempt({capabilities:{screen:{state:'unsupported',reason:'无交互桌面'}}},'screen'),false);
});
test('AI-only online devices cannot offer screen control; paired code awaits computer connection',async t=>{
 const h=deviceHarness(t,{devices:[{id:did,name:'AI-only',online:true,screenOnline:false,paired:true,source:'server'},{id:'pending',name:'Waiting PC',online:false,paired:false,awaitingConnection:true}]});await settle();
 assert.match(h.root.innerHTML,/AI 通道在线，屏幕连接器尚未就绪/);assert.match(h.root.innerHTML,/已绑定 · 等待电脑连接/);
 assert.match(h.root.innerHTML,new RegExp('data-device="start" data-id="'+did+'" disabled'));
 await h.click('start',did);assert.equal(h.calls.some(x=>x.path.endsWith('/start')),false);
});
test('unconfigured cloud provider is stated explicitly while own devices remain available',async t=>{
 const h=deviceHarness(t,{request:path=>{if(path==='desktop')throw Object.assign(Error('未配置'),{code:'DESKTOP_UNCONFIGURED'});}});await settle();
 assert.match(h.root.innerHTML,/云资源服务未接入/);assert.match(h.root.innerHTML,/办公电脑/);assert.doesNotMatch(h.root.innerHTML,/云资源记录暂时无法读取/);
});
test('unified list shows connected devices and cloud resources without pretending the cloud resource is paired',async t=>{
 const h=deviceHarness(t,{devices:[{id:did,name:'真实云电脑',source:'cloud',online:true,paired:true,capabilities:{screen:{state:'unsupported',reason:'无交互桌面'},ai:{state:'supported',reason:'已登录'},files:{state:'partial',reason:'通道待验证'}}}],clouds:[{id:'resource',region:'新加坡',state:'available'}]});await settle();
 assert.match(h.root.innerHTML,/统一设备列表/);assert.match(h.root.innerHTML,/真实云电脑/);assert.match(h.root.innerHTML,/data-cloud-resource="resource"/);assert.match(h.root.innerHTML,/资源可用 · 尚未配对/);assert.match(h.root.innerHTML,/无交互桌面/);assert.match(h.root.innerHTML,/data-capability="files" data-state="partial"/);
 await h.click('start',did);assert.equal(h.calls.some(x=>x.path.endsWith('/start')),false);await h.click('chat',did);assert.deepEqual(h.opened,[did]);
});
test('claim is explicit, normalized, authenticated, and keeps old file pairing available secondarily',async t=>{
 const h=deviceHarness(t,{request:async path=>path==='devices/claim'?{device:{id:did}}:undefined});await settle();await h.click('connect');
 assert.match(h.root.innerHTML,/data-device-claim/);assert.match(h.root.innerHTML,/其他方式：旧版配对文件/);assert.match(h.root.innerHTML,/data-device-pair/);assert.equal((h.root.innerHTML.match(/class="wh-primary"/g)||[]).length,1);
 h.input('machineCode','ybz 7k2m 9qx4');await h.submit('claim',{name:'我的新电脑'});
 assert.deepEqual(h.calls.find(x=>x.path==='devices/claim').input,{code:'YBZ-7K2M-9QX4',name:'我的新电脑'});assert.match(h.root.innerHTML,/已加入我的设备和消息列表/);assert.doesNotMatch(h.root.innerHTML,/ybz 7k2m/);
});
test('invalid code is rejected locally and failed claim is never auto-retried',async t=>{
 const h=deviceHarness(t,{request:async path=>{if(path==='devices/claim')throw Error('机器码已过期');}});await settle();await h.click('connect');h.input('machineCode','0000');await h.submit('claim');assert.equal(h.calls.some(x=>x.path==='devices/claim'),false);
 h.input('machineCode','YBZ-7K2M-9QX4');await h.submit('claim');await settle();assert.match(h.root.innerHTML,/机器码已过期/);assert.equal(h.calls.filter(x=>x.path==='devices/claim').length,1);
});
test('late claim does not reveal previous owner device in another account',async t=>{
 let finish;const pending=new Promise(resolve=>{finish=resolve;});const h=deviceHarness(t,{request:path=>path==='devices/claim'?pending:undefined});await settle();await h.click('connect');h.input('machineCode','YBZ-7K2M-9QX4');const submitted=h.submit('claim');h.owner('other');const before=h.root.innerHTML;finish({device:{id:did,name:'private-old-owner'}});await submitted;assert.equal(h.root.innerHTML,before);assert.equal(h.calls.filter(x=>x.path==='devices').length,1);
});
test('legacy file pairing still posts the original endpoint and creates a downloadable file',async t=>{
 let downloads=0;const h=deviceHarness(t,{request:path=>path==='devices/pair'?{deviceId:did,pairToken:'synthetic-test-token'}:undefined});globalThis.document.createElement=()=>({click(){downloads++;}});await settle();await h.click('connect');await h.submit('pair',{name:'旧连接器'});assert.equal(h.calls.filter(x=>x.path==='devices/pair').length,1);assert.equal(downloads,1);assert.match(h.root.innerHTML,/保存配对文件/);
});
test('device messages are a separate owner endpoint, not friends or group members',async t=>{
 const restore=browser(),cleanups=[];t.after(()=>{for(const cleanup of cleanups)cleanup();restore();});const handlers=new Map(),routes=[];const root={innerHTML:'',classList:{toggle(){}},setAttribute(){},contains:()=>true,remove(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,handler)=>handlers.set(name,handler),removeEventListener(){}};globalThis.document.createElement=()=>root;
 const state={profile:{userId:'owner'},friends:[],requests:[],conversations:[]};const entry={id:'device:'+did,kind:'device',deviceId:did,name:'我的服务器',source:'server',online:true};const calls=[];const service={getState:async()=>state,authenticatedRequest:async path=>{calls.push(path);return {conversations:[entry]};}};
 const cleanup=mountLiveSocial({append(){}},{service,onNavigate:(...args)=>routes.push(args)});cleanups.push(cleanup);await settle();assert.deepEqual(calls,['devices/conversations']);assert.match(root.innerHTML,/AI 助手只有你能看到 · 不会出现在别人的列表里/);assert.match(root.innerHTML,/我的服务器/);assert.match(root.innerHTML,/AI 通道离线 · 等待连接/);assert.doesNotMatch(root.innerHTML,/和电脑上的 AI 聊聊/);assert.equal(state.friends.length,0);assert.equal(state.conversations.length,0);
 handlers.get('click')({target:{matches:()=>false,closest:()=>({dataset:{action:'device-chat',id:did}})}});assert.deepEqual(routes,[['messages',{route:'ai-channel',deviceId:did}]]);
 handlers.get('click')({target:{matches:()=>false,closest:()=>({dataset:{action:'device-chat',id:'forged'}})}});assert.equal(routes.length,1);
 assert.deepEqual(privateDeviceEntries([{...entry,kind:'friend'},{...entry,id:'group:'+did}]),[]);
 cleanup();const cleanupContacts=mountLiveSocial({append(){}},{service,view:'contacts'});cleanups.push(cleanupContacts);await settle();assert.doesNotMatch(root.innerHTML,/我的服务器|device-chat/);
});
test('legacy cloud route mounts the same device list and setup checklist keeps five categories without automatic installation',async t=>{
 const handlers=new Map(),root={innerHTML:'',contains:()=>true,querySelector:()=>({}),addEventListener:(n,h)=>handlers.set(n,h),removeEventListener(){}};let mounts=0;
 const client={getProfile:()=>({userId:'owner'}),authenticatedRequest:()=>new Promise(()=>{})};
 const cleanup=mountWorkbenchHub(root,{client,initialScreen:'connections',mountDevices:()=>{mounts++;return ()=>{};}});t.after(cleanup);assert.equal(mounts,1);
 await handlers.get('click')({target:{closest:()=>({dataset:{hub:'workflows'}})}});
 assert.deepEqual([...root.innerHTML.matchAll(/data-setup-category="([^"]+)"/g)].map(x=>x[1]),['ai','email','browser','social','ybz']);
 for(const name of ['Gmail','Outlook','Proton Mail','Zoho Mail','Chrome','Firefox','Edge','Telegram','WhatsApp','Discord','YBZ 电脑版安装工具','YBZ 手机端','Node.js'])assert.ok(root.innerHTML.includes(name),name);
 for(const text of ['登录必须由你本人完成','仅提供官方入口','请确认来源是官方网站','手机号要求：通常可选','个人邮箱注册需要手机接收验证码','注册难度：按官方验证流程','无需额外安装 Node.js','尚未上传公网'])assert.ok(root.innerHTML.includes(text),text);
 assert.doesNotMatch(root.innerHTML,/一键自动安装|\$\d|\d+\s*美元|name="(?:key|password)"/);
});
