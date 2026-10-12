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
