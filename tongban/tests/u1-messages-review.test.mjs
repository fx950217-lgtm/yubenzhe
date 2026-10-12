import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

const built=await build({entryPoints:[fileURLToPath(new URL('../src/live-social.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {mountLiveSocial}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const did='11111111-1111-4111-8111-111111111111';
const makeDevice=extra=>({id:'device:'+did,kind:'device',deviceId:did,name:'办公电脑',source:'local',online:false,...extra});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function mount(t,{devices=[],view='messages',conversations=[],deviceError=false}={}) {
 const original={window:globalThis.window,document:globalThis.document,location:globalThis.location};
 const listeners=new Map();
 const root={innerHTML:'',classList:{toggle(){}},setAttribute(){},contains:()=>true,remove(){},querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(name,handler)=>listeners.set(name,handler),removeEventListener(){}};
 globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.document={activeElement:null,addEventListener(){},removeEventListener(){},createElement:()=>root};
 globalThis.location={origin:'https://fixture.invalid'};
 const state={profile:{userId:'owner',nickname:'本人'},friends:[],requests:[],conversations};
 const service={getState:async()=>state,authenticatedRequest:async path=>{assert.equal(path,'devices/conversations');if(deviceError)throw new Error('fixture failure');return {conversations:devices};}};
 const cleanup=mountLiveSocial({append(){}},{service,view});
 t.after(()=>{cleanup();for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 await settle();
 return {root,state,listeners};
}

test('U1 device-only inbox is useful without inventing a friend or showing an empty inbox',async t=>{
 const {root,state}=await mount(t,{devices:[makeDevice({name:'个人 <电脑>',aiOnline:true,online:true})]});
 assert.match(root.innerHTML,/个人 &lt;电脑&gt;/);
 assert.match(root.innerHTML,/live-ai-corner/);
 assert.match(root.innerHTML,/AI 助手只有你能看到/);
 assert.doesNotMatch(root.innerHTML,/从一位好友开始/);
 assert.equal(state.friends.length,0);
 assert.equal(state.conversations.length,0);
});

test('U1 a screen-only online device is not advertised as ready for AI chat',async t=>{
 const {root}=await mount(t,{devices:[makeDevice({online:true,aiOnline:false})]});
 assert.doesNotMatch(root.innerHTML,/和电脑上的 AI 聊聊/);
 assert.match(root.innerHTML,/办公电脑/);
});

test('U1 aggregate online from an old device DTO does not prove AI readiness',async t=>{
 const {root}=await mount(t,{devices:[makeDevice({online:true})]});
 assert.doesNotMatch(root.innerHTML,/和电脑上的 AI 聊聊/);
});

test('U1 device conversations never become contacts or add an AI privacy footer to contacts',async t=>{
 const {root}=await mount(t,{view:'contacts',devices:[makeDevice({online:true,aiOnline:true})]});
 assert.doesNotMatch(root.innerHTML,/live-device-entry/);
 assert.doesNotMatch(root.innerHTML,/live-private-note/);
 assert.match(root.innerHTML,/还没有好友/);
});

test('U1 unavailable device metadata preserves real human chats with a retry explanation',async t=>{
 const conversations=[{id:'human-chat',type:'direct',name:'真实聊天',members:[{userId:'owner',nickname:'本人'},{userId:'friend',nickname:'老朋友'}],updatedAt:1,lastMessage:{text:'今天好',createdAt:1},unread:0}];
 const {root}=await mount(t,{deviceError:true,conversations});
 assert.match(root.innerHTML,/老朋友/);
 assert.match(root.innerHTML,/设备入口暂时无法同步/);
 assert.doesNotMatch(root.innerHTML,/live-device-entry/);
});

test('U1 AI group tag uses declared server membership and stays absent in a human-only group',async t=>{
 const base={type:'group',members:[{userId:'owner',nickname:'本人'}],updatedAt:1,lastMessage:null,unread:0};
 const {root}=await mount(t,{conversations:[{...base,id:'group-ai',name:'协作组',aiMembers:[{id:'ai-codex',kind:'ai',alias:'策划 AI',provider:'codex'},{id:'ai-ollama',kind:'ai',alias:'本地 AI',provider:'ollama'}]},{...base,id:'group-human',name:'亲友组',aiMembers:[]}]});
 assert.match(root.innerHTML,/AI×2/);
 assert.doesNotMatch(root.innerHTML,/AI×0/);
 assert.equal((root.innerHTML.match(/live-group-tag/g)||[]).length,1);
});
