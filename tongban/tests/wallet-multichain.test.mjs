import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Wallet,encryptKeystoreJson,Transaction,keccak256} from 'ethers';
import {CHAIN_REGISTRY,DEFAULT_CHAIN_ID,getChain,getEnabledChain} from '../src/chain-registry.js';
import {transactionFeeFields,feeCap,sameFeeFields} from '../src/wallet-fee-policy.js';
import * as production from '../src/wallet.js';

// Public test vector. All RPC below is an in-process stub; no chain is contacted.
const privateKey='0x'+'0'.repeat(63)+'1',signer=new Wallet(privateKey),password='synthetic-chain-test-319';
const encryptedJson=await encryptKeystoreJson({address:signer.address,privateKey},password,{scrypt:{N:16,r:1,p:1}});
const legacyKey='tongban.wallet.bsc-testnet.v1',legacy=JSON.stringify({version:1,chainId:97,address:signer.address,encryptedJson});
const partition=id=>'ybz.wallet.evm.v2.'+id,history=id=>'ybz.transactions.evm.v2.'+id+'.'+signer.address.toLowerCase();
const oldHistory='tongban.transactions.bsc-testnet.v1.'+signer.address.toLowerCase(),memory=new Map(),calls=[],signed=[];
let actualChain=97,blockedWrite=null,delayed=null,wrongChain=false;
const local=()=>({getItem:key=>memory.get(key)??null,setItem:(key,value)=>{if(key===blockedWrite)throw Error('quota');memory.set(key,String(value));},removeItem:key=>memory.delete(key)});
globalThis.localStorage=local();
globalThis.fetch=async(url,options)=>{
 const request=JSON.parse(options.body);calls.push({url,redirect:options.redirect,...request});let result;
 if(delayed&&request.method===delayed.method){const next=delayed;delayed=null;await next.promise;}
 if(request.method==='eth_chainId')result='0x'+(wrongChain?1:actualChain).toString(16);
 else if(request.method==='eth_getBalance')result='0x8ac7230489e80000';
 else if(request.method==='eth_getCode')result='0x';
 else if(request.method==='eth_getTransactionCount')result='0x0';
 else if(request.method==='eth_gasPrice')result='0x3b9aca00';
 else if(request.method==='eth_getBlockByNumber')result={baseFeePerGas:'0x3b9aca00'};
 else if(request.method==='eth_maxPriorityFeePerGas')result='0x3b9aca00';
 else if(request.method==='eth_estimateGas')result='0x5208';
 else if(request.method==='eth_sendRawTransaction'){signed.push(Transaction.from(request.params[0]));result=keccak256(request.params[0]);}
 else if(request.method==='eth_getTransactionReceipt'||request.method==='eth_getTransactionByHash')result=null;
 else throw Error('Unexpected RPC '+request.method);
 return {ok:true,json:async()=>({id:request.id,jsonrpc:'2.0',result})};
};
// Enable dormant branches only inside this isolated test bundle. Production's
// frozen registry and empty mainnet endpoint arrays above stay unchanged.
const built=await build({entryPoints:[fileURLToPath(new URL('../src/wallet.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'synthetic-enabled-networks',setup(b){b.onLoad({filter:/[\\/]chain-registry\.js$/},async args=>({contents:(await readFile(args.path,'utf8')).replaceAll('enabled:false','enabled:true').replaceAll('rpcUrls:[]',"rpcUrls:['https://synthetic.invalid/rpc']"),loader:'js'}));}}]});
const fixture=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function deferred(method){let resolve;const promise=new Promise(r=>resolve=r);delayed={method,promise};return resolve;}
function change(id){actualChain=id;return fixture.setNetwork(id);}
test.beforeEach(()=>{production.lock();fixture.lock();blockedWrite=null;delayed=null;wrongChain=false;memory.clear();globalThis.localStorage=local();change(DEFAULT_CHAIN_ID);memory.clear();memory.set(legacyKey,legacy);calls.length=0;signed.length=0;});
test.afterEach(()=>{production.lock();fixture.lock();});

test('production registry exposes five networks but no mainnet endpoint or activation path',async()=>{
 assert.deepEqual(CHAIN_REGISTRY.map(c=>c.chainId),[97,56,1,137,42161]);assert.equal(getChain(97).enabled,true);
 for(const id of [56,1,137,42161]){assert.deepEqual(getChain(id).rpcUrls,[]);assert.equal(getChain(id).enabled,false);assert.throws(()=>getEnabledChain(id),{code:'NETWORK_DISABLED'});assert.throws(()=>production.setNetwork(id),{code:'NETWORK_DISABLED'});await assert.rejects(production.createChainReader({chainId:id}),{code:'NETWORK_DISABLED'});}
 assert.throws(()=>production.setNetwork(1337),{code:'NETWORK_UNSUPPORTED'});assert.equal(production.NETWORK.chainId,97);assert.equal(calls.length,0);assert.equal(memory.size,1);assert.ok(Object.isFrozen(CHAIN_REGISTRY));
});
test('legacy vault stays byte-identical and all synthetic network partitions keep the same encrypted account',async()=>{
 await fixture.unlock(password);for(const id of [56,1,137,42161,97]){change(id);assert.equal(fixture.getWalletState().address,signer.address);assert.equal(fixture.getWalletState().unlocked,false);if(id!==97){const stored=JSON.parse(memory.get(partition(id)));assert.equal(stored.version,2);assert.equal(stored.chainId,id);assert.equal(stored.encryptedJson,encryptedJson);}await fixture.unlock(password);}
 assert.equal(memory.get(legacyKey),legacy);assert.equal(calls.length,0);assert.equal([...memory.values()].join().includes(privateKey.slice(2)),false);
});
test('a failed new partition write leaves the old wallet and selected network intact',async()=>{
 await fixture.unlock(password);blockedWrite=partition(56);assert.throws(()=>change(56),{code:'STORAGE_UNAVAILABLE'});actualChain=97;assert.equal(fixture.NETWORK.chainId,97);assert.equal(fixture.getWalletState().address,signer.address);assert.equal(fixture.getWalletState().unlocked,true);assert.equal(memory.get(legacyKey),legacy);assert.equal(memory.has(partition(56)),false);
});
test('chain switch locks and cancels both prepared transaction and late chain reads',async()=>{
 await fixture.unlock(password);const preview=await fixture.prepareTransfer('0x1111111111111111111111111111111111111111','0.01');
 assert.equal(preview.from,signer.address);assert.equal(preview.data,'0x');assert.equal(preview.gasLimit,'21000');assert.equal(preview.gasPrice,'1000000000');
 const reader=await fixture.createChainReader(),release=deferred('eth_getBalance'),pending=reader('eth_getBalance',[signer.address,'latest']);change(56);release();await assert.rejects(pending,{code:'NETWORK_CHANGED'});await assert.rejects(reader('eth_getBalance',[signer.address,'latest']),{code:'NETWORK_CHANGED'});
 await fixture.unlock(password);await assert.rejects(fixture.confirmTransfer(preview.id,password),{code:'PREVIEW_EXPIRED'});assert.equal(signed.length,0);
});
test('RPC identity and method allowlists remain enforced with zero arbitrary signing',async()=>{
 const reader=await fixture.createChainReader();const before=calls.length;for(const method of ['eth_sign','eth_sendTransaction','eth_sendRawTransaction','personal_unlockAccount']){assert.throws(()=>reader(method,[]),{code:'RPC_METHOD_BLOCKED'});await assert.rejects(fixture.readChain(method),{code:'RPC_METHOD_BLOCKED'});}assert.equal(calls.length,before);wrongChain=true;await assert.rejects(fixture.getBalance(),{code:'CHAIN_MISMATCH'});
 assert.ok(calls.every(call=>call.redirect==='error'),'allowlisted RPCs must never follow redirects');
});
test('records are partitioned and same transaction hash on another chain cannot replace a current record',()=>{
 const hash='0x'+'a'.repeat(64),row={hash,status:'confirmed',createdAt:1};memory.set(oldHistory,JSON.stringify([{...row,chainId:97,amount:'1'}]));memory.set(history(56),JSON.stringify([{...row,chainId:56,amount:'2',createdAt:2}]));
 assert.deepEqual(fixture.getRecords().map(r=>r.chainId),[97]);assert.deepEqual(fixture.getRecords({allChains:true}).map(r=>r.chainId),[56,97]);change(56);assert.equal(fixture.getRecords()[0].amount,'2');assert.equal(memory.get(oldHistory).includes('"amount":"1"'),true);
});
test('malformed transaction history fails closed before preparing another signature',async()=>{
 await fixture.unlock(password);memory.set(oldHistory,'bad JSON');await assert.rejects(fixture.prepareTransfer('0x1111111111111111111111111111111111111111','0.01'),{code:'RECORDS_INVALID'});assert.equal(calls.length,0);
});
test('transaction storage read errors cannot be mistaken for an empty history',async()=>{
 await fixture.unlock(password);globalThis.localStorage={...local(),getItem:key=>{if(key===oldHistory)throw Error('read denied');return memory.get(key)??null;}};
 await assert.rejects(fixture.prepareTransfer('0x1111111111111111111111111111111111111111','0.01'),{code:'RECORDS_INVALID'});assert.equal(calls.length,0);assert.equal(signed.length,0);
});
test('a full new history partition cannot hide an unresolved legacy payment',async()=>{
 const unknownHash='0x'+'f'.repeat(64);memory.set(oldHistory,JSON.stringify([{hash:unknownHash,chainId:97,status:'unknown',createdAt:1}]));
 memory.set(history(97),JSON.stringify(Array.from({length:100},(_,i)=>({hash:'0x'+i.toString(16).padStart(64,'0'),chainId:97,status:'confirmed',createdAt:i+2}))));
 await fixture.unlock(password);assert.equal(fixture.getRecords().find(row=>row.hash===unknownHash).status,'unknown');await assert.rejects(fixture.prepareTransfer('0x1111111111111111111111111111111111111111','0.01'),{code:'TRANSACTION_PENDING'});assert.equal(calls.length,0);assert.equal(signed.length,0);
});
test('task-payment verification stays testnet-only even inside a future enabled chain fixture',async()=>{
 change(1);await fixture.unlock(password);const id='11111111-2222-3333-4444-555555555555',to='0x1111111111111111111111111111111111111111';
 const taskIntent={id,chainId:1,from:signer.address,to,valueWei:'10000000000000000',data:'0x'+Buffer.from('YBZ-TASK-PAYMENT:v1:'+id+':'+'a'.repeat(64)).toString('hex')};
 await assert.rejects(fixture.prepareTransfer(to,'0.01',{taskIntent}),{code:'TASK_PAYMENT_INVALID'});assert.equal(calls.length,0);assert.equal(signed.length,0);
});
test('all network partitions and old originals are removed by one verified local deletion permit',async()=>{
 for(const id of [56,1,137,42161,97])change(id);await fixture.unlock(password);for(const id of [97,56,1,137,42161])memory.set(history(id),'[]');memory.set(oldHistory,'[]');memory.set('social-data','keep');memory.set('tongban.wallet.watchlist.v1','keep-watch');
 const permit=await fixture.prepareLocalWalletDeletion(password,{expectedAddress:signer.address});await permit.clear();assert.equal(fixture.getWalletState().exists,false);for(const id of [97,56,1,137,42161]){assert.equal(memory.has(partition(id)),false);assert.equal(memory.has(history(id)),false);}assert.equal(memory.has(legacyKey),false);assert.equal(memory.has(oldHistory),false);assert.equal(memory.get('social-data'),'keep');assert.equal(memory.get('tongban.wallet.watchlist.v1'),'keep-watch');
});
test('deletion refuses a new same-address partition created after approval',async()=>{
 await fixture.unlock(password);const permit=await fixture.prepareLocalWalletDeletion(password,{expectedAddress:signer.address});memory.set(partition(56),JSON.stringify({version:2,chainId:56,address:signer.address,encryptedJson}));await assert.rejects(permit.clear(),{code:'WALLET_CHANGED'});assert.equal(memory.get(legacyKey),legacy);
});
test('partial multi-partition deletion retries without restoring removed originals or affecting another account',async()=>{
 change(56);change(97);await fixture.unlock(password);const permit=await fixture.prepareLocalWalletDeletion(password,{expectedAddress:signer.address});memory.set('other-user-record','keep');
 globalThis.localStorage={...local(),removeItem:key=>{if(key!==partition(56))memory.delete(key);}};await assert.rejects(permit.clear(),{code:'LOCAL_CLEANUP_FAILED'});assert.equal(memory.has(legacyKey),false);assert.equal(memory.has(partition(56)),true);assert.equal(fixture.getWalletState().unlocked,false);
 globalThis.localStorage=local();await permit.clear();assert.equal(memory.has(partition(56)),false);assert.equal(fixture.getWalletState().exists,false);assert.equal(memory.get('other-user-record'),'keep');
});
test('an unknown payment blocks only its own chain and its hash remains available for reconciliation',async()=>{
 const hash='0x'+'c'.repeat(64);memory.set(oldHistory,JSON.stringify([{hash,chainId:97,status:'unknown',createdAt:1}]));await fixture.unlock(password);await assert.rejects(fixture.prepareTransfer('0x1111111111111111111111111111111111111111','0.01'),{code:'TRANSACTION_PENDING'});
 change(56);await fixture.unlock(password);const preview=await fixture.prepareTransfer('0x1111111111111111111111111111111111111111','0.01');assert.equal(preview.chainId,56);assert.equal(fixture.getRecords({allChains:true}).find(row=>row.hash===hash).status,'unknown');assert.equal(signed.length,0);
});
test('synthetic EIP-1559 branch signs only reviewed fields while actual mainnets remain disabled',async()=>{
 change(1);await fixture.unlock(password);const preview=await fixture.prepareTransfer('0x1111111111111111111111111111111111111111','0.01');assert.equal(preview.type,2);assert.equal(preview.chainId,1);assert.equal(preview.maxFeePerGas,'3000000000');assert.equal(preview.maxPriorityFeePerGas,'1000000000');assert.equal('gasPrice' in preview,false);
 await fixture.confirmTransfer(preview.id,password);assert.equal(signed.length,1);assert.equal(signed[0].type,2);assert.equal(signed[0].chainId,1n);assert.equal(signed[0].maxFeePerGas,3000000000n);assert.equal(getChain(1).enabled,false);assert.ok(calls.every(call=>call.url==='https://synthetic.invalid/rpc'));
});
test('fee policy validates limits and compares the full approved fee cap',()=>{
 const legacyFee=transactionFeeFields('legacy',{gasPrice:1n});assert.equal(feeCap(legacyFee),1n);const dynamic=transactionFeeFields('eip1559',{baseFeePerGas:20n,maxPriorityFeePerGas:2n});assert.deepEqual(dynamic,{type:2,maxFeePerGas:42n,maxPriorityFeePerGas:2n});assert.equal(sameFeeFields(dynamic,{...dynamic,maxPriorityFeePerGas:3n}),false);
 for(const value of [0n,-1n,1000000000001n,'1'])assert.throws(()=>transactionFeeFields('legacy',{gasPrice:value}),{code:'FEE_INVALID'});assert.throws(()=>transactionFeeFields('eip1559',{baseFeePerGas:1000000000000n,maxPriorityFeePerGas:1n}),{code:'FEE_INVALID'});
});
