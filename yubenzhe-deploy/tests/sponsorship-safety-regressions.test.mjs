import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Interface,keccak256} from 'ethers';
import {ENTRY_POINT_V07} from '../server/sponsorship-policy.mjs';
import {openSponsorshipJournal} from '../server/sponsorship-accounting.mjs';
import {createPaymasterService} from '../server/paymaster-service.mjs';

// This independent harness does not use keys, RPC, providers, or real receipts.
const address=n=>'0x'+n.toString(16).padStart(40,'0');
const senderA=address(1),ownerA=address(2),target=address(3),factory=address(4),paymaster=address(5),senderB=address(6),ownerB=address(7);
const code='0x60016000',runtimeHash=keccak256(code),call='0x12345678';
const account=new Interface(['function execute(address dest,uint256 value,bytes func)']);
const gas={callGasLimit:'0x2710',verificationGasLimit:'0x2710',preVerificationGas:'0x2710',paymasterVerificationGasLimit:'0x2710',paymasterPostOpGasLimit:'0x2710'};
const paymasterData={paymaster,paymasterData:'0x1234',paymasterVerificationGasLimit:gas.paymasterVerificationGasLimit,paymasterPostOpGasLimit:gas.paymasterPostOpGasLimit};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

async function fixture(t,{at=Date.UTC(2026,0,15,12),budget={}}={}){
 const folder=await mkdtemp(join(tmpdir(),'ybz-sponsorship-safety-')),filename=join(folder,'cost-journal.sqlite');
 let currentTime=at;const journals=[],calls=[],hooks={};
 const policy={mode:'local-harness',id:'independent-safety',chainId:97,testnet:true,entryPoint:ENTRY_POINT_V07,entryPointVersion:'0.7',entryPointRuntimeHash:runtimeHash,accountRuntimeHash:runtimeHash,factory:{address:factory,runtimeHash},paymaster:{address:paymaster,runtimeHash},senders:[{sender:senderA,ownerId:'owner-a',ownerAddress:ownerA,salt:'0'},{sender:senderB,ownerId:'owner-b',ownerAddress:ownerB,salt:'0'}],calls:[{action:'first-entry',target,selector:call,callDataHash:keccak256(call),runtimeHash}],budget:{monthlyWei:'1000000',dailyWei:'1000000',userDailyWei:'1000000',sessionWei:'1000000',singleWei:'100000',userHourly:1,globalHourly:100,...budget}};
 const defaults={
  inspect:({operation})=>({chainId:97,entryPoint:ENTRY_POINT_V07,entryPointCode:code,paymasterCode:code,ownerAddress:operation.sender===senderA?ownerA:ownerB,nonce:operation.nonce,accountCode:code,targetCode:code}),
  getStubData:()=>paymasterData,estimateGas:()=>gas,getFinalData:()=>({data:paymasterData,validUntil:currentTime+60000}),getReceipt:()=>null,
 };
 const fakeTransport={kind:'local-fake'};for(const method of Object.keys(defaults))fakeTransport[method]=input=>{calls.push(method);return (hooks[method]||defaults[method])(input);};
 const open=create=>{const journal=openSponsorshipJournal({filename,create,mode:'local-harness',now:()=>currentTime});journals.push(journal);return journal;};
 const journal=open(true),makeService=store=>createPaymasterService({mode:'local-harness',policy,journal:store,fakeTransport,now:()=>currentTime});
 t.after(async()=>{for(const store of journals)store.close();await rm(folder,{recursive:true,force:true});});
 const input=(owner='a',requestId='request-one')=>({requestId,ownerId:'owner-'+owner,sessionId:'session-'+owner,chainId:97,entryPoint:ENTRY_POINT_V07,operation:{sender:owner==='a'?senderA:senderB,nonce:'0',callData:account.encodeFunctionData('execute',[target,0,call]),callGasLimit:gas.callGasLimit,verificationGasLimit:gas.verificationGasLimit,preVerificationGas:gas.preVerificationGas,maxFeePerGas:'2',maxPriorityFeePerGas:'1'}});
 const receipt=record=>({simulation:true,success:true,actualGasCost:'40000',chainId:record.chainId,entryPoint:record.entryPoint,sender:record.sender,paymaster:record.paymaster,nonce:record.nonce,userOpHash:record.userOpHash,transactionHash:'0x'+'a'.repeat(64),blockHash:'0x'+'b'.repeat(64),canonicalBlockHash:'0x'+'b'.repeat(64),confirmations:3});
 return {journal,service:makeService(journal),input,receipt,hooks,calls,final:defaults.getFinalData,setTime:value=>{currentTime=value;},reopen:()=>makeService(open(false))};
}

for(const scenario of [
 {name:'day',at:Date.UTC(2026,0,15,23,59),later:Date.UTC(2026,0,16,0,1),budget:{dailyWei:'100000'},stat:'dayCommittedWei'},
 {name:'month',at:Date.UTC(2026,0,31,23,59),later:Date.UTC(2026,1,1,0,1),budget:{monthlyWei:'100000'},stat:'monthCommittedWei'},
])test(`a ${scenario.name} rollover cannot erase spending when an old unknown authorization finally settles`,async t=>{
 const f=await fixture(t,scenario),approved=await f.service.request(f.input());assert.equal(approved.status,'authorized-local-only');
 const awaiting=await f.service.reconcile({reservationId:approved.record.id,ownerId:'owner-a'});assert.equal(awaiting.record.state,'unknown');
 f.setTime(scenario.later);assert.equal(f.journal.stats()[scenario.stat],'100000','unknown cap must carry across periods');
 f.hooks.getReceipt=()=>f.receipt(approved.record);
 const settled=await f.service.reconcile({reservationId:approved.record.id,ownerId:'owner-a'});assert.equal(settled.record.state,'confirmed');
 assert.equal(f.journal.stats()[scenario.stat],'40000','actual settled spending must remain in the current budget');
 const next=await f.service.request(f.input('b'));assert.equal(next.status,'self-pay-required');assert.equal(next.reason,'SPONSORSHIP_BUDGET_EXHAUSTED');assert.equal(next.requiresUserApproval,true);assert.equal(f.calls.filter(call=>call==='getFinalData').length,1);
});

test('changing request ID after an unknown result and restart never diverts the same payer to a new self-paid payment',async t=>{
 const f=await fixture(t),approved=await f.service.request(f.input());await f.service.reconcile({reservationId:approved.record.id,ownerId:'owner-a'});
 const restarted=f.reopen(),result=await restarted.request(f.input('a','different-request'));
 assert.equal(result.status,'verify-existing');assert.equal(result.record.id,approved.record.id);assert.equal(result.record.state,'unknown');assert.equal(f.journal.stats().reservations,1);assert.equal(f.calls.filter(call=>call==='getFinalData').length,1);assert.equal(f.journal.stats().heldWei,'100000');assert.equal(result.broadcast,false);
});

test('a slow null receipt cannot roll back or reject a concurrently verified terminal receipt',async t=>{
 const f=await fixture(t),approved=await f.service.request(f.input()),started=deferred(),slow=deferred();let reads=0;
 f.hooks.getReceipt=()=>{if(++reads===1){started.resolve();return slow.promise;}return f.receipt(approved.record);};
 const first=f.service.reconcile({reservationId:approved.record.id,ownerId:'owner-a'});await started.promise;
 const second=await f.service.reconcile({reservationId:approved.record.id,ownerId:'owner-a'});assert.equal(second.record.state,'confirmed');slow.resolve(null);
 const late=await first;assert.equal(late.status,'settled-local-only');assert.equal(late.record.state,'confirmed');assert.equal(f.journal.get(approved.record.id).state,'confirmed');assert.equal(f.journal.stats().heldWei,'0');assert.equal(f.journal.stats().actualCostWei,'40000');
});

test('pausing while final authorization is in flight keeps a hold and cannot return a usable authorization',async t=>{
 const f=await fixture(t),started=deferred(),slow=deferred();f.hooks.getFinalData=()=>{started.resolve();return slow.promise;};
 const pending=f.service.request(f.input());await started.promise;f.journal.setPaused(true);slow.resolve(f.final());
 const result=await pending;assert.equal(result.status,'verify-existing');assert.equal(result.record.state,'unknown');assert.equal(result.signed,false);assert.equal(result.broadcast,false);assert.equal(f.journal.stats().heldWei,'100000');
});

test('emergency pause still permits read-only reconciliation of existing sponsorship costs',async t=>{
 const f=await fixture(t),approved=await f.service.request(f.input());f.journal.setPaused(true);f.hooks.getReceipt=()=>f.receipt(approved.record);
 const result=await f.service.reconcile({reservationId:approved.record.id,ownerId:'owner-a'});assert.equal(result.status,'settled-local-only');assert.equal(result.record.state,'confirmed');assert.equal(f.calls.filter(call=>call==='getReceipt').length,1);assert.equal(f.journal.stats().actualCostWei,'40000');
 const next=await f.service.request(f.input('b'));assert.equal(next.status,'self-pay-required');assert.equal(next.reason,'SPONSORSHIP_PAUSED');assert.equal(f.calls.filter(call=>call==='getFinalData').length,1);
});
