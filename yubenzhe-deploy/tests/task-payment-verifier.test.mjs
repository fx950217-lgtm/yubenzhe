import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTaskPaymentData,createTaskPaymentVerifier} from '../server/task-payment-verifier.mjs';

const id='00000000-0000-4000-8000-000000000097',hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
const intent={id,chainId:97,from:'0x1111111111111111111111111111111111111111',to:'0x2222222222222222222222222222222222222222',valueWei:'1000000000000000',data:buildTaskPaymentData(id,'c'.repeat(64)),createdAt:100000};
function fixture(overrides={}){
 const tx={hash,type:'0x0',v:'0xe5',chainId:'0x61',from:intent.from,to:intent.to,value:'0x38d7ea4c68000',input:intent.data,blockHash,blockNumber:'0x64',...overrides.tx};
 const receipt={transactionHash:hash,status:'0x1',from:intent.from,to:intent.to,blockHash,blockNumber:'0x64',gasUsed:'0x61a8',effectiveGasPrice:'0x3b9aca00',...overrides.receipt};
 const calls=[],results={eth_chainId:'0x61',eth_getTransactionByHash:tx,eth_getTransactionReceipt:receipt,eth_blockNumber:'0x66',eth_getBlockByNumber:{hash:blockHash,number:'0x64',timestamp:'0x65'},...overrides.results};
 const fetchImpl=async(url,options)=>{const request=JSON.parse(options.body);calls.push({url,options,request});assert.equal(options.redirect,'error');assert.ok(!/send|sign/i.test(request.method));return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:results[request.method]}));};
 return {calls,verifier:createTaskPaymentVerifier({rpcUrls:['https://rpc.example.test/bsc'],fetchImpl}),results};
}

test('memo binds one intent and acceptance digest without task text',()=>{
 assert.equal(Buffer.from(intent.data.slice(2),'hex').toString(),'YBZ-TASK-PAYMENT:v1:'+id+':'+'c'.repeat(64));
 assert.notEqual(buildTaskPaymentData(id,'d'.repeat(64)),intent.data);
 assert.throws(()=>buildTaskPaymentData('injected:task','c'.repeat(64)));
 assert.throws(()=>buildTaskPaymentData(id,'not-a-digest'));
});

test('missing RPC is explicit and does not make requests',async()=>{
 const verifier=createTaskPaymentVerifier({fetchImpl:()=>assert.fail('Network forbidden')});assert.equal(verifier.configured,false);
 assert.equal((await verifier.verify(intent,hash)).reason,'TESTNET_RPC_UNCONFIGURED');
 for(const rpcUrls of [['http://rpc.example.test'],['https://user:secret@rpc.example.test'],['https://rpc.example.test/?key=x'],['https://rpc.example.test/#x']])assert.throws(()=>createTaskPaymentVerifier({rpcUrls}));
 for(const minConfirmations of [0,1,2,31])assert.throws(()=>createTaskPaymentVerifier({minConfirmations}));
});

test('exact native testnet transaction requires canonical receipt and three confirmations',async()=>{
 const f=fixture(),result=await f.verifier.verify(intent,hash);assert.equal(result.state,'confirmed');assert.equal(result.confirmations,3);assert.equal(result.blockHash,blockHash);assert.equal(result.blockNumber,100);assert.equal(result.feeWei,'25000000000000');assert.equal(f.verifier.configured,true);
 assert.ok(f.calls.every(call=>call.url==='https://rpc.example.test/bsc'));
 assert.deepEqual([...new Set(f.calls.map(call=>call.request.method))].sort(),['eth_blockNumber','eth_chainId','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt'].sort());
});

test('invalid intent is rejected before reading chain, even with another digest memo',async()=>{
 for(const patch of [{chainId:56},{from:intent.to},{valueWei:'0'},{valueWei:'1e3'},{data:'0x'},{data:buildTaskPaymentData('00000000-0000-4000-8000-000000000098','c'.repeat(64))},{createdAt:0}]){
  const f=fixture();assert.equal((await f.verifier.verify({...intent,...patch},hash)).reason,'INTENT_INVALID');assert.equal(f.calls.length,0);
 }
 const f=fixture();assert.equal((await f.verifier.verify(intent,'0x123')).reason,'HASH_INVALID');assert.equal(f.calls.length,0);
});

test('wrong network and mismatched transaction facts never confirm a payment',async()=>{
 const mainnet=fixture({results:{eth_chainId:'0x38'}});assert.equal((await mainnet.verifier.verify(intent,hash)).reason,'TESTNET_ONLY');assert.equal(mainnet.calls.length,1);
 for(const tx of [{chainId:'0x38'},{hash:'0x'+'d'.repeat(64)},{from:intent.to},{to:intent.from},{value:'0x1'},{input:'0x'},{input:buildTaskPaymentData(id,'d'.repeat(64))}])assert.equal((await fixture({tx}).verifier.verify(intent,hash)).state,'mismatch');
});

test('legacy RPC can omit chainId only when EIP-155 signature v protects chain 97',async()=>{
 for(const type of [undefined,'0x0'])for(const v of ['0xe5','0xe6'])assert.equal((await fixture({tx:{chainId:undefined,type,v}}).verifier.verify(intent,hash)).state,'confirmed');
 for(const patch of [{chainId:undefined,v:'0x1b'},{chainId:'0x61',v:'0x1c'},{chainId:undefined,v:'0x22'},{chainId:undefined,v:'0x23'},{chainId:undefined,v:'0x93'},{chainId:'0x38',v:'0xe6'},{chainId:'0x61',v:undefined},{type:'0x2',chainId:undefined,v:'0xe6'}])assert.equal((await fixture({tx:patch}).verifier.verify(intent,hash)).state,'mismatch');
 assert.equal((await fixture({tx:{type:'0x2',chainId:'0x61',v:'0x0'}}).verifier.verify(intent,hash)).state,'confirmed');
});

test('receipt itself is bound to transaction, sender, recipient and block',async()=>{
 for(const receipt of [{transactionHash:'0x'+'d'.repeat(64)},{from:intent.to},{to:intent.from},{status:'0x2'},{blockHash:'0x'+'d'.repeat(64)},{blockNumber:'0x63'}])assert.equal((await fixture({receipt}).verifier.verify(intent,hash)).state,'mismatch');
});

test('unseen, unmined, shallow and failed transactions keep distinct states',async()=>{
 assert.equal((await fixture({results:{eth_getTransactionByHash:null,eth_getTransactionReceipt:null}}).verifier.verify(intent,hash)).state,'unknown');
 assert.equal((await fixture({results:{eth_getTransactionReceipt:null}}).verifier.verify(intent,hash)).state,'pending');
 const shallow=await fixture({results:{eth_blockNumber:'0x65'}}).verifier.verify(intent,hash);assert.equal(shallow.state,'pending');assert.equal(shallow.confirmations,2);
 assert.equal((await fixture({receipt:{status:'0x0'}}).verifier.verify(intent,hash)).state,'failed');
 assert.equal((await fixture({receipt:{status:'0x0'},results:{eth_blockNumber:'0x64'}}).verifier.verify(intent,hash)).state,'pending');
});

test('reorganization or missing canonical block revokes confirmation and fee evidence',async()=>{
 for(const eth_getBlockByNumber of [null,{hash:'0x'+'d'.repeat(64),number:'0x64'},{hash:blockHash,number:'0x63'}]){
  const result=await fixture({results:{eth_getBlockByNumber}}).verifier.verify(intent,hash);assert.equal(result.state,'unknown');assert.equal(result.reason,'CHAIN_REORGANIZED');assert.equal(result.feeWei,null);assert.equal(result.confirmations,0);
 }
 assert.equal((await fixture({results:{eth_blockNumber:'0x63'}}).verifier.verify(intent,hash)).state,'unknown');
});

test('malformed or unavailable RPC data produces unknown without exposing provider errors',async()=>{
 const sentinel='synthetic-provider-error-do-not-expose';
 const verifier=createTaskPaymentVerifier({rpcUrls:['https://rpc.example.test'],fetchImpl:async()=>{throw Error(sentinel);}});
 const result=await verifier.verify(intent,hash);assert.equal(result.state,'unknown');assert.equal(JSON.stringify(result).includes(sentinel),false);
 for(const receipt of [{gasUsed:'bad'},{effectiveGasPrice:'0x0'}])assert.equal((await fixture({receipt}).verifier.verify(intent,hash)).state,'unknown');
 const badEnvelope=createTaskPaymentVerifier({rpcUrls:['https://rpc.example.test'],fetchImpl:async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:999,result:'0x61'}))});assert.equal((await badEnvelope.verify(intent,hash)).state,'unknown');
});

test('fixed fallback endpoints retry read failures only and never follow caller RPC fields',async()=>{
 const good=fixture(),urls=[];
 const verifier=createTaskPaymentVerifier({rpcUrls:['https://offline.example.test','https://rpc.example.test/bsc'],fetchImpl:async(url,options)=>{urls.push(url);if(url.startsWith('https://offline.'))throw Error('offline');const req=JSON.parse(options.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result:good.results[req.method]}));}});
 assert.equal((await verifier.verify({...intent,rpcUrl:'https://attacker.example.test'},hash)).state,'confirmed');assert.ok(urls.every(url=>!url.includes('attacker')));
});

test('oversized RPC streams are cancelled at the byte limit instead of buffering the body',async()=>{
 let reads=0,cancelled=false;
 const verifier=createTaskPaymentVerifier({rpcUrls:['https://rpc.example.test'],fetchImpl:async()=>new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(256*1024));},cancel(){cancelled=true;}}))});
 assert.equal((await verifier.verify(intent,hash)).state,'unknown');assert.equal(cancelled,true);assert.ok(reads<=11,'Stop reading shortly after 2 MiB');
 let declaredCancelled=false;
 const declared=createTaskPaymentVerifier({rpcUrls:['https://rpc.example.test'],fetchImpl:async()=>new Response(new ReadableStream({cancel(){declaredCancelled=true;}}),{headers:{'content-length':String(3*1024*1024)}})});
 assert.equal((await declared.verify(intent,hash)).state,'unknown');assert.equal(declaredCancelled,true);
});
