import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {loadingSkeleton} from '../src/loading-skeleton.js';
import {walletHomeHTML} from '../src/wallet-home.js';

async function bundled(file){const value=await build({entryPoints:[fileURLToPath(new URL('../src/'+file,import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});return import('data:text/javascript;base64,'+Buffer.from(value.outputFiles[0].text).toString('base64'));}
const {mountLiveSocial}=await bundled('live-social.js');
const {mountPersonalDevices}=await bundled('personal-devices.js');
const {mountWorkbench}=await bundled('workbench.js');
const {mountWorkbenchHub}=await bundled('workbench-hub.js');
const tick=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(t,mount,request,options={}){
 const old={window:globalThis.window,document:globalThis.document,setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 let profile={userId:'owner'},cleanup;const handlers=new Map(),timers=[],writes=[],attributes={};
 const root={get innerHTML(){return writes.at(-1)||'';},set innerHTML(html){writes.push(html);},setAttribute:(key,value)=>attributes[key]=value,classList:{toggle(){}},style:{setProperty(){}},contains:()=>true,querySelector:()=>null,querySelectorAll:()=>[],append(){},remove(){},addEventListener:(name,fn)=>handlers.set(name,[...(handlers.get(name)||[]),fn]),removeEventListener:(name,fn)=>handlers.set(name,(handlers.get(name)||[]).filter(item=>item!==fn))};
 globalThis.document={createElement:()=>root,activeElement:null,hidden:false,addEventListener(){},removeEventListener(){}};
 globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.setInterval=fn=>{timers.push(fn);return timers.length;};globalThis.clearInterval=()=>{};
 const client={getProfile:()=>profile,authenticatedRequest:request,getState:()=>request('state')};
 cleanup=mount(root,{client,service:client,profile,...options});
 t.after(()=>{cleanup();Object.assign(globalThis,old);});
 return {root,writes,attributes,client,cleanup,account:value=>{profile=value;},async poll(){await timers[0]?.();await tick();},async click(key,value){const button={dataset:{[key]:value}},target={matches:()=>false,closest:selector=>selector==='[data-'+key+']'?button:null};for(const fn of handlers.get('click')||[])await fn({target,preventDefault(){},stopPropagation(){}});await tick();}};
}
const state=()=>({profile:{userId:'owner'},friends:[],requests:[],conversations:[{id:'chat',type:'group',name:'已有群聊',members:[],lastMessage:{text:'已有消息'}}]});
const task=()=>({id:'task',title:'已有任务',status:'running',createdAt:1700000000000,step:0,version:1,outputs:[]});
const device=()=>({id:'device',name:'已有电脑',online:false,paired:true});

test('four skeleton shapes have a bounded layout, accessible busy status and no fake interactive content',async()=>{
 for(const kind of ['messages','devices','tasks','wallet']){
  const html=loadingSkeleton(kind,{rows:100,label:'读取 <script> 状态'});
  assert.match(html,new RegExp('data-loading-skeleton="'+kind+'"'));
  assert.match(html,/role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/);
  assert.equal((html.match(/class="ybz-skeleton-row"/g)||[]).length,6);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<button|<input|<script>/);
 }
 const css=await readFile(new URL('../src/loading-skeleton.css',import.meta.url),'utf8');
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)[\s\S]*animation:none/);
 assert.match(css,/var\(--line/);assert.match(css,/min-height:76px/);
});

test('messages show skeleton until first response, then keep existing content through a failed refresh',async t=>{
 let read=deferred();const h=harness(t,mountLiveSocial,path=>path==='state'?read.promise:Promise.resolve({conversations:[]}));
 assert.match(h.root.innerHTML,/data-loading-skeleton="messages"/);assert.equal(h.attributes['aria-busy'],'true');
 assert.doesNotMatch(h.root.innerHTML,/从一位好友开始/);
 read.resolve(state());await tick();assert.match(h.root.innerHTML,/已有群聊/);assert.equal(h.attributes['aria-busy'],'false');
 read=deferred();const polling=h.poll();assert.match(h.root.innerHTML,/已有群聊/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
 read.reject(Error('消息网络失败'));await polling;assert.match(h.root.innerHTML,/已有群聊/);assert.match(h.root.innerHTML,/消息网络失败/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
});

test('failed initial messages stop busy state and a manual retry restores skeleton until success',async t=>{
 let read=deferred();const h=harness(t,mountLiveSocial,path=>path==='state'?read.promise:Promise.resolve({conversations:[]}));
 read.reject(Error('无法读取消息'));await tick();assert.equal(h.attributes['aria-busy'],'false');assert.match(h.root.innerHTML,/无法读取消息/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
 read=deferred();await h.click('action','reload');assert.match(h.root.innerHTML,/data-loading-skeleton="messages"/);
 read.resolve(state());await tick();assert.match(h.root.innerHTML,/已有群聊/);
});

test('a previous account initial message response cannot paint the replacement page',async t=>{
 const read=deferred(),h=harness(t,mountLiveSocial,path=>path==='state'?read.promise:Promise.resolve({conversations:[]}));
 h.account({userId:'next'});h.root.innerHTML='新账号页面';read.resolve(state());await tick();assert.equal(h.root.innerHTML,'新账号页面');
});

test('device list never flashes empty before its first read and preserves devices when a refresh fails',async t=>{
 let read=deferred();const h=harness(t,mountPersonalDevices,path=>path==='devices'?read.promise:Promise.resolve({desktops:[]}));
 assert.match(h.root.innerHTML,/data-loading-skeleton="devices"/);assert.doesNotMatch(h.root.innerHTML,/还没有已连接设备/);
 assert.match(h.root.innerHTML,/href="https:\/\/66\.42\.56\.29\/install\.html"/);assert.doesNotMatch(h.root.innerHTML,/本机审核版，尚未上传/);
 read.resolve({devices:[device()]});await tick();assert.match(h.root.innerHTML,/已有电脑/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
 read=deferred();const pending=h.poll();assert.match(h.root.innerHTML,/已有电脑/);read.reject(Error('设备网络失败'));await pending;
 assert.match(h.root.innerHTML,/已有电脑/);assert.match(h.root.innerHTML,/设备网络失败/);assert.doesNotMatch(h.root.innerHTML,/还没有已连接设备|data-loading-skeleton/);
});

test('initial device failure renders a retry instead of empty or endless skeleton',async t=>{
 const h=harness(t,mountPersonalDevices,path=>path==='devices'?Promise.reject(Error('读取设备失败')):Promise.resolve({desktops:[]}));
 await tick();assert.match(h.root.innerHTML,/读取设备失败/);assert.match(h.root.innerHTML,/data-device="refresh"/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton|还没有已连接设备/);
});

test('device results and loading completion cannot overwrite a switched account',async t=>{
 const read=deferred(),h=harness(t,mountPersonalDevices,path=>path==='devices'?read.promise:Promise.resolve({desktops:[]}));
 h.account(null);h.root.innerHTML='退出后的页面';read.resolve({devices:[device()]});await tick();assert.equal(h.root.innerHTML,'退出后的页面');
});

test('task list skeleton covers capabilities and tasks, then refresh retains the existing rows',async t=>{
 let cap=deferred(),read=deferred();const h=harness(t,mountWorkbench,path=>path==='workbench/capabilities'?cap.promise:path==='workbench/tasks'?read.promise:Promise.resolve({files:[]}),{initialScreen:'tasks'});
 assert.match(h.root.innerHTML,/data-loading-skeleton="tasks"/);cap.resolve({enabled:true});await tick();assert.match(h.root.innerHTML,/data-loading-skeleton="tasks"/);assert.doesNotMatch(h.root.innerHTML,/这里还没有任务/);
 read.resolve({tasks:[task()]});await tick();assert.match(h.root.innerHTML,/已有任务/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
 read=deferred();const pending=h.click('action','refresh');await tick();assert.match(h.root.innerHTML,/已有任务/);read.reject(Error('任务刷新失败'));await pending;
 assert.match(h.root.innerHTML,/已有任务/);assert.match(h.root.innerHTML,/任务刷新失败/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
});

test('task list initial failure exits skeleton without presenting an empty result',async t=>{
 const h=harness(t,mountWorkbench,path=>path==='workbench/capabilities'?Promise.resolve({enabled:true}):path==='workbench/tasks'?Promise.reject(Error('任务首次读取失败')):Promise.resolve({files:[]}),{initialScreen:'tasks'});
 await tick();assert.match(h.root.innerHTML,/任务首次读取失败/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton|这里还没有任务/);
});

test('dashboard retains successful rule and device task snapshots when their next reads fail',async t=>{
 let fail=false;const request=async path=>{if(fail)throw Error('网络中断');if(path==='devices')return {devices:[device()]};if(path==='workbench/tasks')return {tasks:[task()]};return {device:{...device()},tasks:[]};};
 const h=harness(t,mountWorkbenchHub,request);assert.match(h.root.innerHTML,/data-loading-skeleton="devices"/);assert.match(h.root.innerHTML,/data-loading-skeleton="tasks"/);assert.doesNotMatch(h.root.innerHTML,/暂无正在执行的任务/);
 await tick();assert.match(h.root.innerHTML,/已有任务/);assert.match(h.root.innerHTML,/已有电脑/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
 fail=true;await h.click('hub','refresh-summary');assert.match(h.root.innerHTML,/已有任务/);assert.match(h.root.innerHTML,/已有电脑/);assert.match(h.root.innerHTML,/暂不可用/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton/);
});

test('dashboard initial partial failure does not misreport missing tasks as empty',async t=>{
 const h=harness(t,mountWorkbenchHub,path=>path==='devices'?Promise.resolve({devices:[]}):Promise.reject(Error('任务不可用')));
 await tick();assert.match(h.root.innerHTML,/任务暂不可用/);assert.doesNotMatch(h.root.innerHTML,/data-loading-skeleton|暂无正在执行的任务|还没有已完成的任务/);
});

test('wallet skeleton is only initial, retains real cached zero while refreshing and exits on errors',()=>{
 const base={state:{exists:true,address:'0x1111111111111111111111111111111111111111'},network:{symbol:'tBNB',name:'BSC 测试网'},hidden:false,amount:'—',loading:true};
 const initial=walletHomeHTML(base);assert.match(initial,/data-loading-skeleton="wallet"/);assert.match(initial,/ybz-skeleton-amount/);assert.doesNotMatch(initial,/id="token-balance">0/);
 const refresh=walletHomeHTML({...base,hasSnapshot:true,amount:'0'});assert.doesNotMatch(refresh,/data-loading-skeleton|ybz-skeleton-amount/);assert.match(refresh,/id="token-balance">0/);
 const failed=walletHomeHTML({...base,error:'RPC <failed>'});assert.doesNotMatch(failed,/data-loading-skeleton/);assert.match(failed,/role="alert"/);assert.match(failed,/RPC &lt;failed&gt;/);
 const cachedError=walletHomeHTML({...base,hasSnapshot:true,amount:'2.5',error:'网络失败'});assert.match(cachedError,/显示上次读取的资产/);assert.match(cachedError,/id="token-balance">2.5/);
 assert.doesNotMatch(walletHomeHTML({...base,state:{exists:false}}),/data-loading-skeleton/);
});
