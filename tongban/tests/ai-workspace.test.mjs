import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createAIClient, cloudAccessSupported } from '../src/ai-workspace-client.js';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/ai-workspace.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {createAIWorkspace}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const caps=ready=>({cloud:{configured:ready,ready,status:ready?'ready':'not_configured'},limits:{dailyTasks:10},billing:{mode:'free_acceptance',realBalanceDeduction:false}});
const workspace=(status='pending_review')=>({id:'ws-1',name:'社区工作区',purpose:'content',requirements:'整理社区成员提供的活动材料',status,version:1,createdAt:1000,reviewNote:''});
const detail=(status='pending_review',tasks=[])=>({workspace:workspace(status),tasks,quota:{remaining:10,used:0,limit:10}});
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};}
function harness(options={}) {
  const calls=[],timers=new Map(),toasts=[],exports=[];let next=0,html='',renders=0;
  const client={supported:()=>options.supported!==false,request:async(path,init)=>{calls.push({path,...init});return options.reply?options.reply(path,init):path.endsWith('capabilities')?caps(false):{items:[]};}};
  const ctx={render(){renders++;html=feature.render();},toast:message=>toasts.push(message),renderLocal:()=>'<form data-work-form="ai">本机模板整理，未调用 AI</form>',getLocalDraft:()=>({title:'私密草稿',prompt:'不应默认导出的私人提示词'})};
  const feature=createAIWorkspace(ctx,{client,bridge:()=>options.bridge,exporter:async value=>{exports.push(value);return {saved:true,method:'browser-download'};},schedule:fn=>{const id=++next;timers.set(id,fn);return id;},unschedule:id=>timers.delete(id)});
  html=feature.render();
  return {feature,calls,timers,toasts,exports,get html(){return html;},get renders(){return renders;},click(action,data={}){feature.handleAction(`ai-${action}`,{dataset:data});},async tick(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());await flush();}};
}
function installForms(t) {const original=globalThis.FormData;globalThis.FormData=class{constructor(form){this.values=form.values;}*[Symbol.iterator](){yield* Object.entries(this.values);}};t.after(()=>globalThis.FormData=original);}
function submit(h,type,values){const form={dataset:{aiForm:type},values};form.closest=selector=>selector==='[data-ai-form]'?form:null;let prevented=false;const handled=h.feature.handleSubmit({target:form,preventDefault(){prevented=true;}});assert.equal(handled,true);assert.equal(prevented,true);}

test('API client accepts only server web, uses same-origin credentials, and never treats an HTML login page as submission',async()=>{
  assert.equal(cloudAccessSupported({location:{protocol:'https:',hostname:'example.test'}}),true);
  for(const env of [{location:{protocol:'file:',hostname:''}},{location:{protocol:'https:',hostname:'localhost'},YubenzheDesktop:{platform:'windows'}},{location:{protocol:'https:',hostname:'localhost'},Capacitor:{getPlatform:()=> 'android'}},{location:{protocol:'https:',hostname:'localhost'},webkit:{messageHandlers:{exportJSON:{}}}}])assert.equal(cloudAccessSupported(env),false);
  let options;const client=createAIClient({supported:()=>true,fetcher:async(path,init)=>{options=init;return new Response('<html>登录</html>',{headers:{'content-type':'text/html'}});}});
  await assert.rejects(client.request('/api/ai/workspaces',{method:'POST',body:{name:'test'}}),error=>error.code==='SERVER_WEB_REQUIRED');
  assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');assert.equal(options.method,'POST');
  await assert.rejects(client.request('https://external.test/api/ai/workspaces'),error=>error.code==='INVALID_PATH');
  const denied=createAIClient({supported:()=>false,fetcher:()=>assert.fail('native must not fetch')});await assert.rejects(denied.request('/api/ai/capabilities'),/服务器网页版/);
});

test('local mode makes no cloud requests; unsupported clients show the real cloud boundary',async()=>{
  const h=harness({supported:false});try{assert.match(h.html,/本地安装/);assert.match(h.html,/Ollama 官方下载/);assert.doesNotMatch(h.html,/data-ai-form="application"/);assert.equal(h.calls.length,0);h.click('mode',{mode:'cloud'});await flush();assert.match(h.html,/请在服务器网页版开通云端/);assert.equal(h.calls.length,0);}finally{h.feature.cleanup();}
});

test('mobile native clients never link to an absent bundled install page or promise local inference',()=>{
  const oldIOS=globalThis.YubenzheNative,oldAndroid=globalThis.Capacitor;
  try{
    for(const platform of ['android','ios']){
      globalThis.YubenzheNative=platform==='ios'?{platform:'ios'}:undefined;
      globalThis.Capacitor=platform==='android'?{getPlatform:()=> 'android'}:undefined;
      const h=harness({supported:false});try{assert.match(h.html,/本地模型请在 Windows 电脑使用/);assert.doesNotMatch(h.html,/href="\.\/install.html"/);assert.doesNotMatch(h.html,/data-disc="ai-local-run"/);h.click('mode',{mode:'cloud'});assert.match(h.html,/请在服务器网页版开通云端/);assert.equal(h.calls.length,0);}finally{h.feature.cleanup();}
    }
  }finally{if(oldIOS===undefined)delete globalThis.YubenzheNative;else globalThis.YubenzheNative=oldIOS;if(oldAndroid===undefined)delete globalThis.Capacitor;else globalThis.Capacitor=oldAndroid;}
});

test('cloud applications require confirmation, preserve request ID on a lost response, and show persisted waiting status',async t=>{
  installForms(t);let creates=0;
  const h=harness({reply:async(path,init)=>{if(path.endsWith('capabilities'))return caps(false);if(path==='/api/ai/workspaces'&&init.method==='POST'){creates++;if(creates===1)throw new Error('连接中断，请重试');return {workspace:workspace('awaiting_configuration')};}if(path==='/api/ai/workspaces')return {items:[]};return detail('awaiting_configuration');}});
  try {
    h.click('mode',{mode:'cloud'});await flush();h.click('new');
    submit(h,'application',{name:'社区工作区',purpose:'content',requirements:'整理社区成员提供的活动材料'});
    assert.equal(h.calls.filter(call=>call.method==='POST').length,0);assert.match(h.html,/确认申请/);
    h.click('create');h.click('create');await flush();assert.equal(creates,1);assert.match(h.html,/连接中断/);
    h.click('retry');await flush();const requests=h.calls.filter(call=>call.method==='POST');assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body);
    assert.match(h.html,/等待配置/);assert.match(h.html,/没有生成内容/);assert.doesNotMatch(h.html,/data-ai-form="task"/);assert.equal(requests[0].body.purpose,'content');assert.equal(requests[0].body.balance,undefined);
  }finally{h.feature.cleanup();}
});

test('leaving AI cancels reads and a late uncooperative response cannot replace the local page',async()=>{
  const pending=deferred(),h=harness({reply:()=>pending.promise});
  try{h.click('mode',{mode:'cloud'});assert.equal(h.calls.length,2);const before=h.renders;h.feature.routeChanged('hub');assert.ok(h.calls.every(call=>call.signal.aborted));pending.resolve({cloud:caps(false).cloud,items:[workspace()]});await flush();assert.equal(h.renders,before);h.click('mode',{mode:'local'});h.feature.render();assert.doesNotMatch(h.html,/社区工作区/);}finally{h.feature.cleanup();}
});

test('rejected reason and completed model output are escaped, and active tasks poll actual server results',async t=>{
  installForms(t);let taskState=null;
  const h=harness({reply:async(path,init)=>{
    if(path.endsWith('capabilities'))return caps(true);
    if(path==='/api/ai/workspaces')return {items:[workspace('active')]};
    if(path.endsWith('/tasks')&&init.method==='POST'){taskState={id:'task-1',workspaceId:'ws-1',prompt:init.body.prompt,status:'running',version:1};return {task:taskState};}
    return detail('active',taskState?[taskState]:[]);
  }});
  try{h.click('mode',{mode:'cloud'});await flush();h.click('detail',{id:'ws-1'});await flush();submit(h,'task',{prompt:'整理以下原始活动资料'});await flush();assert.match(h.html,/服务器正在处理/);assert.equal(h.timers.size,1);taskState={...taskState,status:'succeeded',version:2,output:'<script>模型返回文本</script>'};await h.tick();assert.match(h.html,/&lt;script&gt;模型返回文本/);assert.doesNotMatch(h.html,/<script>/);assert.equal(h.timers.size,0);}finally{h.feature.cleanup();}
  const rejected=harness({reply:async path=>path.endsWith('capabilities')?caps(false):path==='/api/ai/workspaces'?{items:[workspace('rejected')]}:{...detail('rejected'),workspace:{...workspace('rejected'),reviewNote:'<img src=x>补充需求'}}});
  try{rejected.click('mode',{mode:'cloud'});await flush();rejected.click('detail',{id:'ws-1'});await flush();assert.match(rejected.html,/未通过原因/);assert.match(rejected.html,/&lt;img src=x&gt;/);assert.doesNotMatch(rejected.html,/<img src=x>/);}finally{rejected.feature.cleanup();}
});

test('cancelling an application is explicit and stale versions require refreshed confirmation',async()=>{
  const h=harness({reply:async(path,init)=>{if(path.endsWith('capabilities'))return caps(false);if(path==='/api/ai/workspaces')return {items:[workspace()]};if(init.method==='POST'){const error=new Error('状态已变化');error.status=409;throw error;}return detail();}});
  try{h.click('mode',{mode:'cloud'});await flush();h.click('detail',{id:'ws-1'});await flush();h.click('cancel-confirm');assert.equal(h.calls.filter(call=>call.method==='POST').length,0);h.click('cancel');await flush();assert.match(h.html,/刷新详情后重新确认/);assert.match(h.html,/待审核/);}finally{h.feature.cleanup();}
});

test('Windows local model results are real, cancellation prevents late results, and private prompts are opt-in on export',async()=>{
  const pending=deferred(),cancelled=[];const bridge={status:async()=>({available:true,models:[{name:'local-model',sizeBytes:123}]}),generate:()=>pending.promise,cancel:id=>cancelled.push(id)};
  const h=harness({bridge});try{
    h.click('local-check');await flush();assert.match(h.html,/local-model/);
    h.click('local-export');await flush();const config=JSON.parse(h.exports[0].content);assert.equal(config.model,'local-model');assert.equal(config.promptTemplate,undefined);assert.equal(config.apiKey,undefined);
    h.feature.handleInput({target:{name:'includePrompt',checked:true,matches:()=>true}});h.click('local-export');await flush();assert.equal(JSON.parse(h.exports[1].content).promptTemplate,'不应默认导出的私人提示词');
    h.click('local-run');h.feature.routeChanged('hub');assert.equal(cancelled.length,1);const before=h.renders;pending.resolve({text:'不应显示的旧结果',model:'local-model',local:true});await flush();assert.equal(h.renders,before);assert.doesNotMatch(h.html,/不应显示的旧结果/);
  }finally{h.feature.cleanup();}
});

test('running cloud tasks can be cancelled without inventing an output, and failed task reasons remain visible',async()=>{
  let task={id:'task-1',prompt:'整理活动材料',status:'running',version:2};
  const h=harness({reply:async(path,init)=>{
    if(path.endsWith('capabilities'))return caps(true);
    if(path==='/api/ai/workspaces')return {items:[workspace('active')]};
    if(path==='/api/ai/tasks/task-1/cancel'){assert.equal(init.body.version,2);assert.ok(init.body.requestId);task={...task,status:'cancelled',version:3};return {task};}
    return detail('active',[task]);
  }});
  try{h.click('mode',{mode:'cloud'});await flush();h.click('detail',{id:'ws-1'});await flush();assert.doesNotMatch(h.html,/data-ai-form="task"/);h.click('task-cancel',{id:'task-1'});await flush();assert.match(h.html,/任务已取消/);assert.doesNotMatch(h.html,/class="ai-output"/);assert.equal(h.timers.size,0);task={...task,status:'failed',errorMessage:'模型服务暂时不可用'};h.click('detail',{id:'ws-1'});await flush();assert.match(h.html,/模型服务暂时不可用/);assert.doesNotMatch(h.html,/class="ai-output"/);}finally{h.feature.cleanup();}
});

test('local inference displays only validated bridge results and does not send a cloud request',async()=>{
  const calls=[],h=harness({bridge:{status:async()=>({available:true,models:[{name:'chosen-model'}]}),generate:async value=>{calls.push(value);return {text:'<b>真实本地结果</b>',model:value.model,local:true};},cancel(){}}});
  try{h.click('local-check');await flush();h.click('local-run');await flush();assert.equal(calls.length,1);assert.equal(calls[0].model,'chosen-model');assert.equal(h.calls.length,0);assert.match(h.html,/&lt;b&gt;真实本地结果&lt;\/b&gt;/);assert.doesNotMatch(h.html,/<b>真实本地结果/);}finally{h.feature.cleanup();}
});
