import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/live-social.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});const {mountLiveSocial}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(setImmediate),did='11111111-1111-4111-8111-111111111111',rid='22222222-2222-4222-8222-222222222222',gid='33333333-3333-4333-8333-333333333333';
function fixture(t,{existing=false,own=true,post}={}){
 const saved={document:globalThis.document,window:globalThis.window,FormData:globalThis.FormData},handlers=new Map(),modal={innerHTML:''},calls=[];
 const root={innerHTML:'',classList:{toggle(){}},setAttribute(){},contains:()=>true,remove(){},querySelectorAll:()=>[],querySelector:s=>s==='[data-modal-host]'?modal:null,addEventListener:(key,fn)=>handlers.set(key,fn),removeEventListener:key=>handlers.delete(key)};
 globalThis.document={activeElement:null,createElement:()=>root,addEventListener(){},removeEventListener(){}};globalThis.window={};globalThis.FormData=class{constructor(form){this.values=form.values;}get(name){return this.values[name];}};
 const owner={userId:'owner'},friend={userId:'friend'},group={id:gid,type:'group',name:'讨论',ownerId:own?'owner':'other',members:[owner,friend],aiMembers:existing?[{id:rid,kind:'ai',alias:'选品顾问',provider:'codex',canChat:own,...(own?{deviceId:did}:{})}]:[]};
 const state={profile:owner,friends:[friend],requests:[],outgoingRequests:[],conversations:existing?[group]:[]};let current='owner';
 const service={getProfile:()=>({userId:current}),getState:async()=>state,getMessages:async()=>({messages:[]}),markRead:async()=>{},createGroup:async input=>{calls.push({path:'groups',input});state.conversations=[group];return {conversationId:gid};},authenticatedRequest:async(path,options={})=>{
  if(path==='devices/conversations')return {conversations:[]};
  if(path==='devices')return {devices:[{id:did,name:'自己的秘密电脑',paired:true,online:true,providers:[{id:'codex',installed:true,loggedIn:true,executionSupported:true,executionMode:'tools'}]}]};
  assert.equal(path,'group-device-ai/groups/'+gid+'/roster');
  if(options.method!=='POST')return {version:existing?2:0,canManage:own,members:group.aiMembers};
  calls.push({path,input:structuredClone(options.input)});if(post)await post(options.input);
  group.aiMembers=options.input.members.map(row=>({...row,id:row.id||rid,kind:'ai',canChat:true}));return {version:3,members:group.aiMembers};
 }};
 const cleanup=mountLiveSocial({append(){}},{service,initialConversationId:existing?gid:undefined});t.after(()=>{cleanup();Object.assign(globalThis,saved);});
 return {root,modal,calls,state,cleanup,account:value=>current=value,click:(action,extra={})=>handlers.get('click')({target:{matches:()=>false,closest:()=>({dataset:{action,...extra}})}}),change:(name,value,checked)=>handlers.get('change')({target:{name,value,checked,matches:()=>false}}),alias:value=>handlers.get('input')({target:{name:'rosterAlias0',value,dataset:{rosterIndex:'0'}}}),submit:(type,values={})=>{const form={dataset:{form:type},values,closest(){return this;}};return handlers.get('submit')({target:form,preventDefault(){}});}};
}
test('create discussion combines real friends and owned AI aliases without making AI a member account',async t=>{
 const f=fixture(t);await tick();f.click('create-group');await tick();assert.match(f.modal.innerHTML,/自己的秘密电脑 · Codex/);
 f.change('memberIds','friend',true);f.change('rosterChoice',did+':codex',true);f.alias('选品顾问');f.submit('group',{groupName:'工作讨论'});await tick();
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[0].input,{name:'工作讨论',memberIds:['friend']});assert.deepEqual(f.calls[1].input.members,[{deviceId:did,provider:'codex',alias:'选品顾问'}]);assert.equal(f.state.conversations[0].members.length,2);assert.match(f.root.innerHTML,/2 人 · 1 个 AI/);
});
test('second-step failure shows an existing group and retry saves metadata once without rebuilding',async t=>{
 let fail=true;const f=fixture(t,{post:async()=>{if(fail)throw Error('lost response');}});await tick();f.click('create-group');await tick();f.change('memberIds','friend',true);f.change('rosterChoice',did+':codex',true);f.alias('顾问');f.submit('group',{groupName:'群'});await tick();
 assert.match(f.modal.innerHTML,/讨论组已经创建/);assert.match(f.modal.innerHTML,/重试保存 AI 名单/);assert.match(f.modal.innerHTML,/进入已创建的讨论组/);
 fail=false;f.submit('group',{});await tick();assert.equal(f.calls.filter(c=>c.path==='groups').length,1);assert.deepEqual(f.calls[1].input,f.calls[2].input);
});
test('group owner can edit a roster alias with the fetched CAS version',async t=>{
 const f=fixture(t,{existing:true});await tick();f.click('details');f.click('edit-ai-roster');await tick();assert.match(f.modal.innerHTML,/value="选品顾问"/);f.alias('复核顾问');f.submit('ai-roster');await tick();assert.equal(f.calls[0].input.version,2);assert.equal(f.calls[0].input.members[0].id,rid);assert.equal(f.calls[0].input.members[0].alias,'复核顾问');
});
test('another group member sees aliases but no device choice, source identity or editable roster',async t=>{
 const f=fixture(t,{existing:true,own:false});await tick();f.click('details');f.click('edit-ai-roster');await tick();assert.match(f.modal.innerHTML,/选品顾问/);assert.doesNotMatch(f.modal.innerHTML,/自己的秘密电脑|11111111|rosterChoice|保存名单/);f.change('rosterChoice',did+':codex',true);f.submit('ai-roster');await tick();assert.equal(f.calls.length,0);
});
test('account switch invalidates selected AI roster before any group or roster mutation',async t=>{
 const f=fixture(t);await tick();f.click('create-group');await tick();f.change('memberIds','friend',true);f.change('rosterChoice',did+':codex',true);f.alias('顾问');f.account('other');f.submit('group',{groupName:'群'});await tick();assert.equal(f.calls.length,0);
});
