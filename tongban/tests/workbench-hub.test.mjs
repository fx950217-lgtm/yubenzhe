import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/workbench-hub.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountWorkbenchHub}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function harness({bridge=()=>null}={}){let profile={userId:'owner'},cleaned=0;const listeners=new Map(),calls=[],child={};const root={innerHTML:'',contains:()=>true,querySelector:()=>child,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};const cleanup=mountWorkbenchHub(root,{client:{getProfile:()=>profile,authenticatedRequest(){throw Error('No implicit API calls allowed');}},bridge,mountTasks:(target,options)=>{calls.push({target,options});return ()=>cleaned++;}});return {root,calls,cleanup,cleaned:()=>cleaned,account:value=>{profile=value;},click(action,values={}){const target={dataset:{hub:action,...values}};return listeners.get('click')({target:{closest:()=>target}});},input(name,value){return listeners.get('input')({target:{name,value,closest:()=>({})}});},submit(form){return listeners.get('submit')({target:form,preventDefault(){}});}};}
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve:v=>resolve(v)};}
test('copying a supported workflow opens only a goal draft; unavailable or forged templates never start a task',async()=>{const h=harness();await h.click('use',{id:'research'});await h.click('use',{id:'__proto__'});assert.equal(h.calls.length,0);await h.click('use',{id:'orders'});assert.equal(h.calls.length,1);assert.match(h.calls[0].options.initialGoal,/订单表/);assert.equal(h.calls[0].options.embedded,true);assert.equal('fileIds' in h.calls[0].options,false);h.cleanup();});
test('switching away cleans the task component without requesting cancellation or changing a server task',async()=>{const h=harness();await h.click('tasks');await h.click('mode',{mode:'chat'});assert.equal(h.cleaned(),1);assert.match(h.root.innerHTML,/免费云端模型/);h.cleanup();assert.equal(h.cleaned(),1);});
test('a late local model discovery cannot overwrite another mode or leak model names after account switch',async()=>{for(const exit of ['mode','account','cleanup']){const value=deferred();const h=harness({bridge:()=>({status:()=>value.promise})});await h.click('mode',{mode:'chat'});const p=h.click('check');if(exit==='mode')await h.click('mode',{mode:'work'});if(exit==='account')h.account({userId:'another'});if(exit==='cleanup')h.cleanup();const before=h.root.innerHTML;value.resolve({available:true,models:[{name:'private-model-name'}]});await p;assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/private-model-name/);h.cleanup();}});
test('leaving local chat cancels the same request and discards its eventual reply',async t=>{const result=deferred(),cancelled=[];const h=harness({bridge:()=>({status:async()=>({available:true,models:[{name:'local-model'}]}),generate:()=>result.promise,cancel:id=>cancelled.push(id)})});const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};t.after(()=>{globalThis.FormData=original;h.cleanup();});await h.click('mode',{mode:'chat'});await h.click('check');const running=h.submit({matches:()=>true,values:{prompt:'test prompt',model:'local-model'}});await h.click('mode',{mode:'work'});assert.equal(cancelled.length,1);const before=h.root.innerHTML;result.resolve({local:true,text:'late private reply'});await running;assert.equal(h.root.innerHTML,before);assert.doesNotMatch(h.root.innerHTML,/late private reply/);});
test('local AI output is rendered as text, never executable markup',async t=>{const h=harness({bridge:()=>({status:async()=>({available:true,models:[{name:'local-model'}]}),generate:async()=>({local:true,text:'<img src=x onerror=alert(1)>'})})});const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};t.after(()=>{globalThis.FormData=original;h.cleanup();});await h.click('mode',{mode:'chat'});await h.click('check');await h.submit({matches:()=>true,values:{prompt:'test',model:'local-model'}});assert.match(h.root.innerHTML,/&lt;img/);assert.doesNotMatch(h.root.innerHTML,/<img src=x/);});

test('a running reply keeps its request model even if a stale selection event arrives',async t=>{
 const reply=deferred(),requests=[];
 const h=harness({bridge:()=>({status:async()=>({available:true,models:[{name:'model-a'},{name:'model-b'}]}),generate:input=>{requests.push(input);return reply.promise;}})});
 const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
 t.after(()=>{globalThis.FormData=original;h.cleanup();});
 await h.click('mode',{mode:'chat'});await h.click('check');
 const running=h.submit({matches:()=>true,values:{prompt:'first question',model:'model-a'}});
 assert.equal(requests.length,1);assert.equal(requests[0].model,'model-a');
 assert.match(h.root.innerHTML,/<select\b[^>]*name="model"[^>]*\bdisabled/);
 // A queued/programmatic event cannot change the attribution of an in-flight reply.
 h.input('model','model-b');
 await h.submit({matches:()=>true,values:{prompt:'second question',model:'model-b'}});
 assert.equal(requests.length,1);
 reply.resolve({local:true,text:'answer from model-a'});await running;
 assert.match(h.root.innerHTML,/<strong>AI · model-a<\/strong><p>answer from model-a<\/p>/);
 assert.doesNotMatch(h.root.innerHTML,/<strong>AI · model-b<\/strong>/);
 assert.doesNotMatch(h.root.innerHTML,/<select\b[^>]*name="model"[^>]*\bdisabled/);
});

test('selecting or discovering another model never relabels the completed reply',async t=>{
 let checks=0;const requests=[];
 const h=harness({bridge:()=>({status:async()=>({available:true,models:++checks===1?[{name:'model-a'},{name:'model-b'}]:[{name:'model-b'},{name:'model-a'}]}),generate:async input=>{requests.push(input);return {local:true,text:'reply via '+input.model};}})});
 const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
 t.after(()=>{globalThis.FormData=original;h.cleanup();});
 await h.click('mode',{mode:'chat'});await h.click('check');
 await h.submit({matches:()=>true,values:{prompt:'first',model:'model-a'}});
 h.input('model','model-b');await h.click('check');
 assert.match(h.root.innerHTML,/<option value="model-b" selected/);
 assert.match(h.root.innerHTML,/<strong>AI · model-a<\/strong><p>reply via model-a<\/p>/);
 await h.submit({matches:()=>true,values:{prompt:'second',model:'model-b'}});
 assert.deepEqual(requests.map(request=>request.model),['model-a','model-b']);
 assert.match(h.root.innerHTML,/<strong>AI · model-b<\/strong><p>reply via model-b<\/p>/);
 assert.doesNotMatch(h.root.innerHTML,/reply via model-a/);
});
