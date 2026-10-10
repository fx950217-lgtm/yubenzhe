import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const intentSource=source.slice(source.indexOf('function beginWalletSetup('),source.indexOf('function walletStart('));
test('wallet setup resumes only the pending view once and does not reconstruct the chat',()=>{
 const calls=[];const context={walletIntent:null,walletSetupContext:null,modalCleanup:null,currentView:'messages',walletStart:()=>calls.push('setup'),closeModal:()=>calls.push('close'),layout:()=>calls.push('layout'),refreshBalance:()=>calls.push('refresh'),toast:x=>calls.push(x),wallet:{cancelCreation:()=>calls.push('cancel')}};
 vm.createContext(context);vm.runInContext(intentSource,context);
 let resumed=0;context.beginWalletSetup(()=>resumed++);assert.equal(resumed,0);
 context.finishWalletSetup('完成');assert.equal(resumed,1);assert.equal(context.walletIntent,null);assert.equal(calls.includes('layout'),false);
 context.finishWalletSetup('完成');assert.equal(resumed,1);
});
test('cancelled setup cannot resume a prior financial form',()=>{
 const context={walletIntent:null,walletSetupContext:null,walletStart:()=>{},wallet:{cancelCreation:()=>{}}};
 vm.createContext(context);vm.runInContext(intentSource,context);
 context.beginWalletSetup(()=>assert.fail('cancelled action executed'));context.cancelWalletSetup();assert.equal(context.walletIntent,null);
});

test('wallet setup can preserve its calling form without server binding',()=>{
 const calls=[]; const context={walletIntent:null,walletSetupContext:null,modalCleanup:null,currentView:'wallet',walletStart:()=>{},closeModal:()=>{},layout:()=>calls.push('layout'),refreshBalance:()=>calls.push('refresh'),toast:()=>{},wallet:{cancelCreation:()=>{}}};
 vm.createContext(context);vm.runInContext(intentSource,context);let resumed=0;context.beginWalletSetup(()=>resumed++,{preserveUI:true});context.finishWalletSetup('');assert.equal(resumed,1);assert.deepEqual(calls,['refresh']);assert.equal(context.walletSetupContext,null);
});
test('cancelling wallet setup rejects the pending action only once',()=>{
 let cancelled=0;const context={walletIntent:null,walletSetupContext:null,walletStart:()=>{},wallet:{cancelCreation:()=>{}}};vm.createContext(context);vm.runInContext(intentSource,context);context.beginWalletSetup(()=>assert.fail('resumed'),{onCancel:()=>cancelled++});context.cancelWalletSetup();context.cancelWalletSetup();assert.equal(cancelled,1);
});

test('background chain balance refresh does not redraw independent points or workbench pages',async()=>{
 const refreshSource=source.slice(source.indexOf('async function refreshBalance('),source.indexOf('function showModal('));let finish;const done=new Promise(resolve=>finish=resolve);let renders=0;const context={state:()=>({exists:true}),loadingBalance:false,balance:null,balanceError:'',currentView:'points',wallet:{getBalance:()=>done},renderWallet:()=>renders++,document:{querySelector:()=>({})},toast:()=>{},walletProblem:()=>{}};vm.createContext(context);vm.runInContext(refreshSource,context);const pending=context.refreshBalance();assert.equal(renders,0);finish('1.0');await pending;assert.equal(renders,0);assert.equal(context.balance,'1.0');
 context.currentView='wallet';await context.refreshBalance();assert.equal(renders,2);
});
