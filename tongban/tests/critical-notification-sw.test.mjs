import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../src/sw.js',import.meta.url),'utf8'),id='11111111-1111-4111-8111-111111111111';
function worker(tabs=[]){const listeners=new Map(),shown=[],opened=[];vm.runInNewContext(script,{URL,self:{location:{origin:'https://fixture.invalid'},addEventListener:(name,handler)=>listeners.set(name,handler),registration:{showNotification:async(...args)=>shown.push(JSON.parse(JSON.stringify(args)))},clients:{matchAll:async()=>tabs,openWindow:async path=>opened.push(path)}}});return{shown,opened,listeners,async push(value){let done=Promise.resolve();listeners.get('push')({data:{json:()=>value},waitUntil:p=>{done=p;}});await done;},async click(data){let done=Promise.resolve();listeners.get('notificationclick')({notification:{data,close(){}},waitUntil:p=>{done=p;}});await done;}};}
test('actual worker renders fixed critical copy without accepting raw text or old message pushes',async()=>{
 const w=worker();for(const kind of ['task-completed','decision-required','task-failed'])await w.push({version:1,kind,eventId:id});assert.equal(w.shown.length,3);assert.match(w.shown[0][1].body,/执行已结束.*验收/);
 for(const value of [{body:'PRIVATE_SYNTHETIC',url:'/#messages'},{version:1,kind:'progress',eventId:id},{version:1,kind:'task-completed',eventId:id,title:'PRIVATE_SYNTHETIC'}])await w.push(value);assert.equal(w.shown.length,3);assert.doesNotMatch(JSON.stringify(w.shown),/PRIVATE_SYNTHETIC/);assert.equal(w.listeners.has('fetch'),false);
});
test('actual worker retry replaces the same tag without renotify',async()=>{
 const w=worker(),payload={version:1,kind:'decision-required',eventId:id};await w.push(payload);await w.push(payload);assert.deepEqual(w.shown[0],w.shown[1]);assert.equal(w.shown[1][1].renotify,false);
});
test('actual worker only navigates same-origin tabs to fixed workbench',async()=>{
 const visited=[],focused=[];const w=worker([{url:'https://evil.invalid/',navigate:async path=>visited.push('evil'+path),focus:async()=>focused.push('evil')},{url:'https://fixture.invalid/#messages',navigate:async path=>visited.push(path),focus:async()=>focused.push('local')}]);await w.click({kind:'task-failed',eventId:id,url:'https://evil.invalid/'});assert.deepEqual(visited,['/#workbench']);assert.deepEqual(focused,['local']);assert.deepEqual(w.opened,[]);
});
test('actual worker falls back after a closed tab and ignores unrecognized notifications',async()=>{
 const w=worker([{url:'https://fixture.invalid/',navigate:async()=>{throw new Error('closed');},focus:async()=>{}}]);await w.click({kind:'task-completed',eventId:id});assert.deepEqual(w.opened,['/#workbench']);await w.click({kind:'message',eventId:id,url:'/#messages'});assert.equal(w.opened.length,1);
});
test('notification-only worker activates the new policy without waiting for old controlled tabs to close',async()=>{
 const listeners=new Map(),calls=[];vm.runInNewContext(script,{URL,self:{addEventListener:(name,handler)=>listeners.set(name,handler),skipWaiting:async()=>calls.push('skipWaiting'),clients:{claim:async()=>calls.push('claim')}}});
 for(const type of ['install','activate']){let done;listeners.get(type)({waitUntil:promise=>done=promise});await done;}
 assert.deepEqual(calls,['skipWaiting','claim']);assert.equal(listeners.has('fetch'),false);
});
