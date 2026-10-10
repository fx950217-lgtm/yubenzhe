import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/workbench.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountWorkbench}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)}}
function task(overrides={}){return {id:'bdf1a967-e167-43a5-a214-6cd654e8756e',title:'PRIVATE_TASK',operation:'analyze',status:'running',step:0,version:1,workspaceId:'local-workspace',workspace:{state:'running',controller:'ai'},quoteExpiresAt:Date.now()+60000,estimatedMicro:'30000',budgetMicro:'100000',costMicro:'0',settledMicro:'0',outputs:[],approvals:[],events:[],createdAt:1700000000000,...overrides}}
function harness(t,{request}={}){
 let profile={userId:'owner_a'},timer;
 const timers={setInterval:globalThis.setInterval,clearInterval:globalThis.clearInterval};
 globalThis.setInterval=callback=>{timer=callback;return 731};globalThis.clearInterval=()=>{};
 const calls=[],listeners=new Map(),buttons=[{disabled:false}];
 const root={innerHTML:'',contains:()=>true,querySelectorAll:()=>buttons,addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener:name=>listeners.delete(name)};
 const fallback=async path=>path==='workbench/capabilities'?{enabled:true}:path==='workbench/tasks'?{tasks:[task()]}:path==='workbench/files'?{files:[]}:{task:task()};
 const client={getProfile:()=>profile,authenticatedRequest:async(path,options)=>{calls.push({path,options});return request?request(path,options,fallback):fallback(path,options)}};
 const cleanup=mountWorkbench(root,{client});
 t.after(()=>{cleanup();globalThis.setInterval=timers.setInterval;globalThis.clearInterval=timers.clearInterval});
 return {root,calls,cleanup,listeners,buttons,account(value){profile=value},poll(){timer?.()},async click(action,id){const button={dataset:{action,id}};await listeners.get('click')({target:{closest:()=>button}})},upload(file){return listeners.get('change')({target:{closest:()=>({files:[file]})}})}};
}

test('switching account while a file is read never uploads those bytes to the new account',async t=>{
 const h=harness(t),read=deferred();await tick();const pending=h.upload({name:'private.txt',size:7,arrayBuffer:()=>read.promise});h.account({userId:'owner_b'});read.resolve(new TextEncoder().encode('PRIVATE').buffer);await pending;
 assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(h.calls.some(c=>c.options?.input?.base64),false);
});

test('leaving the workbench while a file is read prevents upload and late DOM replacement',async t=>{
 const h=harness(t),read=deferred();await tick();const pending=h.upload({name:'private.txt',size:7,arrayBuffer:()=>read.promise});h.cleanup();h.root.innerHTML='OTHER_PAGE';read.resolve(new TextEncoder().encode('PRIVATE').buffer);await pending;
 assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);assert.equal(h.root.innerHTML,'OTHER_PAGE');assert.equal(h.listeners.size,0);
});

test('back from task details discards a delayed polling response instead of reopening the task',async t=>{
 const late=deferred();let details=0;const h=harness(t,{request:async(path,options,fallback)=>path==='workbench/tasks/'+task().id&&++details===2?late.promise:fallback(path,options)});await tick();await h.click('open',task().id);assert.match(h.root.innerHTML,/成果文件/);h.poll();await tick();assert.equal(details,2);await h.click('back');assert.match(h.root.innerHTML,/新建文件任务/);late.resolve({task:task({title:'STALE_DETAIL_MUST_NOT_RETURN'})});await tick();assert.match(h.root.innerHTML,/新建文件任务/);assert.doesNotMatch(h.root.innerHTML,/STALE_DETAIL_MUST_NOT_RETURN|成果文件/);
});

test('an upload response after unmount does not query files or mutate a replacement page',async t=>{
 const uploaded=deferred(),h=harness(t,{request:async(path,options,fallback)=>path==='workbench/files'&&options?.method==='POST'?uploaded.promise:fallback(path,options)});await tick();const pending=h.upload({name:'file.txt',size:4,arrayBuffer:async()=>new TextEncoder().encode('DATA').buffer});await tick();assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,1);const readCount=h.calls.filter(c=>c.path==='workbench/files'&&!c.options).length;h.cleanup();h.root.innerHTML='NEW_PAGE';uploaded.resolve({file:{id:'saved',name:'file.txt'}});await pending;assert.equal(h.calls.filter(c=>c.path==='workbench/files'&&!c.options).length,readCount);assert.equal(h.root.innerHTML,'NEW_PAGE');
});

test('pending task open blocks local navigation until its guarded response resolves',async t=>{
 const opened=deferred(),h=harness(t,{request:async(path,options,fallback)=>path==='workbench/tasks/'+task().id?opened.promise:fallback(path,options)});await tick();const opening=h.click('open',task().id);await h.click('back');assert.equal(h.buttons.every(b=>b.disabled),true);opened.resolve({task:task()});await opening;assert.match(h.root.innerHTML,/成果文件/);await h.click('back');assert.match(h.root.innerHTML,/新建文件任务/);
});
