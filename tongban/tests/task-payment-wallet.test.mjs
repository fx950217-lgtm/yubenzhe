import test from 'node:test';
import assert from 'node:assert/strict';
import {Transaction,keccak256,Wallet} from 'ethers';

// Synthetic key and a fully intercepted RPC. Nothing in this test reaches a
// real chain, reads an existing wallet, or signs with user credentials.
const syntheticKey='0x'+'0'.repeat(62)+'97',password='synthetic-task-password-97';
const from=new Wallet(syntheticKey).address,to='0x1111111111111111111111111111111111111111';
const id='00000000-0000-4000-8000-000000000097';
const data='0x'+Buffer.from('YBZ-TASK-PAYMENT:v1:'+id+':'+'c'.repeat(64)).toString('hex');
const intent={id,chainId:97,from,to,valueWei:'20000000000000000',data};
const memory=new Map(),calls=[],signed=[];
let broadcastThrows=false,storageThrows=false;
globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>{if(storageThrows&&key.includes('transactions'))throw Error('Synthetic full storage');memory.set(key,String(value));},removeItem:key=>memory.delete(key)};
globalThis.fetch=async(_url,options)=>{
 const request=JSON.parse(options.body);calls.push(request);let result;
 switch(request.method){
  case 'eth_chainId':result='0x61';break;
  case 'eth_getCode':result='0x';break;
  case 'eth_getBalance':result='0x8ac7230489e80000';break;
  case 'eth_gasPrice':result='0x3b9aca00';break;
  case 'eth_getTransactionCount':result='0x0';break;
  case 'eth_estimateGas':result='0x61a8';break;
  case 'eth_getTransactionReceipt':result=null;break;
  case 'eth_getTransactionByHash':result=null;break;
  case 'eth_sendRawTransaction':signed.push(Transaction.from(request.params[0]));if(broadcastThrows)throw Error('Synthetic transport loss');result=keccak256(request.params[0]);break;
  default:assert.fail('Unexpected RPC method: '+request.method);
 }
 return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
};
const wallet=await import('../src/wallet.js');

test('task payments preserve local keys and require durable intent/hash acknowledgement before broadcast',async t=>{
 await wallet.importPrivateKey(syntheticKey,password);
 const storedVault=[...memory.entries()][0];
 const reset=async()=>{wallet.lock();memory.clear();memory.set(...storedVault);calls.length=0;signed.length=0;broadcastThrows=false;storageThrows=false;await wallet.unlock(password);};
 t.after(()=>wallet.lock());

 await t.test('binds immutable payer, recipient, native amount, chain and task memo before RPC',async()=>{
  for(const patch of [{chainId:56},{from:to},{to:from},{valueWei:'1'},{data:'0x'},{data:'0x'+Buffer.from('YBZ-TASK-PAYMENT:v1:00000000-0000-4000-8000-000000000098:'+'c'.repeat(64)).toString('hex')}]){
   const before=calls.length;await assert.rejects(wallet.prepareTransfer(to,'0.02',{taskIntent:{...intent,...patch}}));assert.equal(calls.length,before);
  }
 });

 await t.test('a task preview cannot be signed without the registration hook',async()=>{
  const preview=await wallet.prepareTransfer(to,'0.02',{taskIntent:intent});assert.equal(preview.intentId,id);assert.equal(preview.from,from);assert.equal(preview.data,data);
  await assert.rejects(wallet.confirmTransfer(preview.id,password),{code:'TASK_PAYMENT_REGISTRATION_REQUIRED'});assert.equal(signed.length,0);assert.equal(wallet.getRecords().length,0);
 });

 await t.test('stores the public hash before acknowledgement and signs exactly the approved memo',async()=>{
  await reset();const preview=await wallet.prepareTransfer(to,'0.02',{taskIntent:intent});let publicFacts;
  const result=await wallet.confirmTransfer(preview.id,password,{beforeBroadcast:async facts=>{
   publicFacts=facts;assert.equal(signed.length,0);assert.equal(wallet.getRecords()[0].hash,facts.hash);assert.equal(wallet.getRecords()[0].intentId,id);assert.equal(Object.isFrozen(facts),true);
   assert.deepEqual(Object.keys(facts).sort(),['hash','intentId','chainId','from','to','valueWei','data','nonce'].sort());
   assert.equal(JSON.stringify(facts).includes(syntheticKey),false);assert.equal(JSON.stringify(facts).includes(password),false);
  }});
  assert.equal(result.hash,publicFacts.hash);assert.equal(result.intentId,id);assert.equal(result.broadcastUncertain,false);assert.equal(signed.length,1);assert.equal(signed[0].chainId,97n);assert.equal(signed[0].data,data);assert.equal(signed[0].to,to);assert.equal(signed[0].value,BigInt(intent.valueWei));
  assert.ok(calls.filter(call=>call.method==='eth_estimateGas').every(call=>call.params[0].data===data));
  assert.equal([...memory.values()].join().includes(syntheticKey),false);
 });

 await t.test('registration timeout retains the only hash and never broadcasts or signs again',async()=>{
  await reset();const preview=await wallet.prepareTransfer(to,'0.02',{taskIntent:intent});let knownHash;
  await assert.rejects(wallet.confirmTransfer(preview.id,password,{beforeBroadcast:async facts=>{knownHash=facts.hash;throw Error('Synthetic acknowledgement lost');}}),error=>error.code==='TASK_PAYMENT_REGISTRATION_FAILED'&&error.hash===knownHash&&error.intentId===id);
  assert.equal(signed.length,0);const record=wallet.getRecords()[0];assert.equal(record.hash,knownHash);assert.equal(record.status,'unknown');assert.equal(record.broadcastAttempted,false);
  await assert.rejects(wallet.prepareTransfer(to,'0.02',{taskIntent:intent}),{code:'TRANSACTION_PENDING'});
  await assert.rejects(wallet.confirmTransfer(preview.id,password,{beforeBroadcast:()=>assert.fail('No callback retry')}),{code:'PREVIEW_EXPIRED'});
  const checked=await wallet.getTransactionStatus(knownHash);assert.equal(checked.status,'unknown');assert.equal(signed.length,0);
 });

 await t.test('transport failure after acknowledgement broadcasts once and only permits receipt lookup',async()=>{
  await reset();const preview=await wallet.prepareTransfer(to,'0.02',{taskIntent:intent});broadcastThrows=true;
  const result=await wallet.confirmTransfer(preview.id,password,{beforeBroadcast:async()=>{}});assert.equal(result.broadcastUncertain,true);assert.equal(signed.length,1);
  await wallet.getTransactionStatus(result.hash);await assert.rejects(wallet.prepareTransfer(to,'0.02',{taskIntent:intent}),{code:'TRANSACTION_PENDING'});assert.equal(signed.length,1);
 });

 await t.test('locking the wallet while the server acknowledges prevents broadcast',async()=>{
  await reset();const preview=await wallet.prepareTransfer(to,'0.02',{taskIntent:intent});
  await assert.rejects(wallet.confirmTransfer(preview.id,password,{beforeBroadcast:async()=>wallet.lock()}),{code:'SESSION_CHANGED'});assert.equal(signed.length,0);assert.equal(wallet.getRecords().length,1);
 });

 await t.test('failed local durable storage prevents acknowledgement and broadcasting',async()=>{
  await reset();const preview=await wallet.prepareTransfer(to,'0.02',{taskIntent:intent});storageThrows=true;
  await assert.rejects(wallet.confirmTransfer(preview.id,password,{beforeBroadcast:()=>assert.fail('Do not register an untracked transaction')}),{code:'STORAGE_UNAVAILABLE'});assert.equal(signed.length,0);storageThrows=false;
 });
});
