import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const transferSource=source.slice(source.indexOf('function openTransfer('),source.indexOf('\nfunction ',source.indexOf('function openTransfer(')+1));
const address='0x1111111111111111111111111111111111111111';
test('scanned recipient survives creation then unlock and only prefills the normal form',()=>{
 let status={exists:false,unlocked:false},resume,markup='',prepared=0;
 const ctx={walletProblem:()=>false,state:()=>status,beginWalletSetup:fn=>resume=fn,unlockModal:fn=>resume=fn,showModal:(_title,html)=>markup=html,icon:()=>'',esc:v=>String(v).replace(/"/g,'&quot;'),wallet:{prepareTransfer:()=>prepared++}};
 vm.createContext(ctx);vm.runInContext(transferSource,ctx);
 ctx.openTransfer(address);assert.equal(markup,'');assert.equal(prepared,0);
 status={exists:true,unlocked:false};resume();assert.equal(markup,'');
 status.unlocked=true;resume();assert.match(markup,new RegExp(`value="${address}"`));
 assert.match(markup,/name="amount"/);assert.doesNotMatch(markup,/name="amount"[^>]*value=/);assert.equal(prepared,0);
});
test('a plain transfer action never fills its DOM event object as an address',()=>{
 let markup='';const ctx={walletProblem:()=>false,state:()=>({exists:true,unlocked:true}),showModal:(_title,html)=>markup=html,icon:()=>'',esc:String};
 vm.createContext(ctx);vm.runInContext(transferSource,ctx);ctx.openTransfer({type:'click'});
 assert.match(markup,/name="to" value=""/);assert.doesNotMatch(markup,/object Object/);
});
test('scan results only open a transfer form or an existing profile, never create a friend',()=>{
 const calls=[];let scanner;
 const ctx={dialog:{open:true},mountQrScanner:(_el,opts)=>{scanner=opts;return()=>{}},showModal:(_t,_h,setup)=>setup({querySelector:()=>({})}),toast:x=>calls.push(['toast',x]),closeModal:()=>calls.push(['close']),openTransfer:to=>calls.push(['transfer',to]),getSocialPeople:()=>[{id:'lin'}],navigate:(view,options)=>calls.push(['navigate',view,options])};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function openScan('),source.indexOf('\nfunction mineAction')),ctx);
 ctx.openScan('all');assert.equal(calls.length,0);
 assert.throws(()=>scanner.onResult({kind:'friend',id:'unknown'}),/没有找到/);assert.equal(calls.length,0);
 scanner.onResult({kind:'friend',id:'lin'});assert.equal(calls.at(-1)[1],'contacts');assert.equal(calls.at(-1)[2].profileId,'lin');
 scanner.onResult({kind:'address',address});assert.deepEqual(calls.at(-1),['transfer',address]);
 ctx.dialog.open=false;const length=calls.length;scanner.onResult({kind:'address',address});assert.equal(calls.length,length);
});
