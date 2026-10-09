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
test('scan results look up a numeric account without creating a friendship',async()=>{
 const calls=[];let scanner;
 const ctx={dialog:{open:true},mountQrScanner:(_el,opts)=>{scanner=opts;return()=>{}},showModal:(_t,_h,setup)=>setup({querySelector:()=>({})}),toast:x=>calls.push(['toast',x]),closeModal:()=>calls.push(['close']),openTransfer:to=>calls.push(['transfer',to]),socialClient:{getProfile:()=>({userId:'736281'}),lookup:async id=>{if(id==='827364')return {profile:{userId:id}};throw new Error('没有找到这个 ID');}},navigate:(view,options)=>calls.push(['navigate',view,options])};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function openScan('),source.indexOf('\nfunction mineAction')),ctx);
 ctx.openScan('all');assert.equal(calls.length,0);
 await assert.rejects(scanner.onResult({kind:'friend',id:'lin'}),/旧版/);
 await assert.rejects(scanner.onResult({kind:'friend',id:'924681'}),/没有找到/);assert.equal(calls.length,0);
 await scanner.onResult({kind:'friend',id:'827364'});assert.equal(calls.at(-1)[1],'contacts');assert.equal(calls.at(-1)[2].profileId,'827364');
 await scanner.onResult({kind:'address',address});assert.deepEqual(calls.at(-1),['transfer',address]);
 let finish;ctx.socialClient.lookup=()=>new Promise(resolve=>{finish=resolve});const pending=scanner.onResult({kind:'friend',id:'827364'});
 ctx.dialog.open=false;const length=calls.length;finish({profile:{userId:'827364'}});await pending;await scanner.onResult({kind:'address',address});assert.equal(calls.length,length);
});

test('wallet unlock refreshes the visible wallet before continuing a transfer or export',async()=>{
 const events=[];let pending;const form={elements:{password:{value:'synthetic-wallet-password-011'}},reset(){events.push('reset')}};
 const ctx={esc:String,short:String,currentView:'wallet',walletProblem:()=>false,state:()=>({exists:true,unlocked:false}),showModal:(_title,_html,setup)=>setup({querySelector:()=>form}),busyForm:(_form,job)=>{pending=job()},wallet:{unlock:async()=>events.push('unlock')},closeModal:()=>events.push('close'),layout:()=>events.push('layout')};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function unlockModal('),source.indexOf('\nasync function copyAddress')),ctx);
 ctx.unlockModal(()=>events.push('continue'));form.onsubmit({preventDefault(){},target:form});await pending;
 assert.deepEqual(events,['reset','unlock','close','layout','continue']);
});
