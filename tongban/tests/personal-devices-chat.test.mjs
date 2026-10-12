import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/personal-devices.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});const {mountPersonalDevices}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('device card opens its Codex channel without starting screen control and preserves existing remote actions',async t=>{
 const originalWindow=globalThis.window,originalLocation=globalThis.location;globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.location={origin:'http://localhost'};
 const handlers=new Map(),calls=[],opened=[];const root={innerHTML:'',querySelector(){return null;},addEventListener:(name,fn)=>{if(!handlers.has(name))handlers.set(name,[]);handlers.get(name).push(fn);},removeEventListener(){}};
 const id='11111111-1111-4111-8111-111111111111',client={getProfile:()=>({userId:'owner'}),authenticatedRequest:async(path,options)=>{calls.push({path,options});return {devices:[{id,name:'办公电脑',online:false,paired:true}]};}};
 const cleanup=mountPersonalDevices(root,{client,onChat:id=>opened.push(id)});t.after(()=>{cleanup();globalThis.window=originalWindow;if(originalLocation===undefined)delete globalThis.location;else globalThis.location=originalLocation;});await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/和它聊天/);assert.match(root.innerHTML,/查看并控制电脑/);assert.match(root.innerHTML,/撤销这台设备/);
 const event={target:{closest:()=>({dataset:{device:'chat'}}),matches:()=>false}};for(const handler of handlers.get('click'))await handler(event);
 assert.deepEqual(opened,[id]);assert.equal(calls.some(call=>call.path.endsWith('/start')),false);
});

test('phone device cards route actual provider, toggle missing tools and reject forged unavailable clicks',async t=>{
 const old=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};const handlers=new Map(),opened=[],id='11111111-1111-4111-8111-111111111111';
 const root={innerHTML:'',querySelector:()=>null,addEventListener:(name,fn)=>{const rows=handlers.get(name)||[];rows.push(fn);handlers.set(name,rows);},removeEventListener(){}};
 const client={getProfile:()=>({userId:'owner'}),authenticatedRequest:async()=>({devices:[{id,name:'电脑',online:true,aiOnline:true,providers:[{id:'ollama',installed:true,loggedIn:null,executionSupported:true,executionMode:'chat-only'},{id:'claude',installed:false}]}]})};
 const cleanup=mountPersonalDevices(root,{client,onChat:(...args)=>opened.push(args),providerDescriptions:{ollama:'安全本机模型'}});t.after(()=>{cleanup();globalThis.window=old;});await new Promise(resolve=>setImmediate(resolve));assert.match(root.innerHTML,/安全本机模型/);assert.match(root.innerHTML,/data-provider="claude"/);
 for(const provider of ['ollama','claude','evil'])for(const fn of handlers.get('click'))await fn({target:{closest:()=>({dataset:{device:'provider-chat',id,provider}}),matches:()=>false}});assert.deepEqual(opened,[[id,'ollama']]);
 for(const fn of handlers.get('change'))fn({target:{matches:q=>q==='[data-hide-missing]',checked:true}});assert.doesNotMatch(root.innerHTML,/data-provider="claude"/);assert.match(root.innerHTML,/data-provider="ollama"/);
});

test('workbench add-device opens machine-code entry while preserving the legacy file pairing path',async t=>{
 const old=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){}};
 const root={innerHTML:'',querySelector:()=>null,addEventListener(){},removeEventListener(){}},calls=[];
 const client={getProfile:()=>({userId:'owner'}),authenticatedRequest:async(path,options)=>{calls.push({path,options});return {devices:[]};}};
 const cleanup=mountPersonalDevices(root,{client,initialClaim:true});t.after(()=>{cleanup();globalThis.window=old;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(root.innerHTML,/data-device-claim/);assert.match(root.innerHTML,/name="machineCode"/);
 assert.match(root.innerHTML,/data-device-pair/);assert.match(root.innerHTML,/旧版配对文件/);
 assert.equal(calls.some(call=>call.options?.method==='POST'),false);
});
