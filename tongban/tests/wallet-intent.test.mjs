import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const intentSource=source.slice(source.indexOf('function beginWalletSetup('),source.indexOf('function walletStart('));
test('wallet setup resumes only the pending view once and does not reconstruct the chat',()=>{
 const calls=[];const context={walletIntent:null,modalCleanup:null,currentView:'messages',walletStart:()=>calls.push('setup'),closeModal:()=>calls.push('close'),layout:()=>calls.push('layout'),refreshBalance:()=>calls.push('refresh'),toast:x=>calls.push(x),wallet:{cancelCreation:()=>calls.push('cancel')}};
 vm.createContext(context);vm.runInContext(intentSource,context);
 let resumed=0;context.beginWalletSetup(()=>resumed++);assert.equal(resumed,0);
 context.finishWalletSetup('完成');assert.equal(resumed,1);assert.equal(context.walletIntent,null);assert.equal(calls.includes('layout'),false);
 context.finishWalletSetup('完成');assert.equal(resumed,1);
});
test('cancelled setup cannot resume a prior financial form',()=>{
 const context={walletIntent:null,walletStart:()=>{},wallet:{cancelCreation:()=>{}}};
 vm.createContext(context);vm.runInContext(intentSource,context);
 context.beginWalletSetup(()=>assert.fail('cancelled action executed'));context.cancelWalletSetup();assert.equal(context.walletIntent,null);
});
