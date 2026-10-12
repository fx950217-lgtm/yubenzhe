import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,encryptKeystoreJson,keccak256} from 'ethers';
import {COLLECTION_KEY,LEGACY_VAULT_KEY,readWalletCollection,cleanLegacySources,vaultDigest} from '../src/wallet-local-vaults.js';

// Public test vectors only. RPC, model, account and backend access are forbidden.
const memory=new Map(),events=new EventTarget(),emitted=[];
const local=()=>({getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)});
globalThis.localStorage=local();globalThis.addEventListener=events.addEventListener.bind(events);
globalThis.dispatchEvent=event=>{emitted.push(event.type);return events.dispatchEvent(event);};
let networkCalls=0;globalThis.fetch=async()=>{networkCalls++;throw Error('No network in multi-wallet tests');};
const wallet=await import('../src/wallet.js?multi-vault-safety');
const otherTab=await import('../src/wallet.js?other-tab-safety');
const keyA='0x'+'0'.repeat(63)+'1',keyB='0x'+'0'.repeat(63)+'2',a=new Wallet(keyA),b=new Wallet(keyB);
const passwordA='synthetic-A-314159',passwordB='synthetic-B-271828';
const encryptedA=await encryptKeystoreJson({address:a.address,privateKey:keyA},passwordA,{scrypt:{N:16,r:1,p:1}});
const encryptedB=await encryptKeystoreJson({address:b.address,privateKey:keyB},passwordB,{scrypt:{N:16,r:1,p:1}});
const oldA=JSON.stringify({version:1,chainId:97,address:a.address,encryptedJson:encryptedA});
const oldB=JSON.stringify({version:2,chainId:56,address:b.address,encryptedJson:encryptedB});
await wallet.importPrivateKey(keyA,passwordA,{name:'旅行用'});
await wallet.importPrivateKey(keyB,passwordB,{additional:true,name:'工作用'});
const baseline=new Map(memory),[idA,idB]=wallet.listLocalWallets().map(item=>item.id);
const collection=()=>JSON.parse(memory.get(COLLECTION_KEY));
const replace=value=>memory.set(COLLECTION_KEY,JSON.stringify({...value,revision:crypto.randomUUID()}));
test.beforeEach(()=>{wallet.lock();otherTab.lock();memory.clear();for(const [key,value]of baseline)memory.set(key,value);globalThis.localStorage=local();emitted.length=0;networkCalls=0;});
test.afterEach(()=>{wallet.lock();otherTab.lock();assert.equal(networkCalls,0);globalThis.localStorage=local();});

test('two independent local wallets select and rename without leaking keys or aliases',async()=>{
 assert.deepEqual(wallet.listLocalWallets().map(({name,address,selected})=>({name,address,selected})),[{name:'旅行用',address:a.address,selected:false},{name:'工作用',address:b.address,selected:true}]);
 await wallet.selectWallet(idA);assert.equal(wallet.getWalletState().unlocked,false);await wallet.unlock(passwordA);
 await wallet.renameWallet(idA,'只在本机的备注');assert.equal(wallet.listLocalWallets()[0].name,'只在本机的备注');
 await wallet.selectWallet(idB);assert.equal(wallet.getWalletState().address,b.address);assert.equal(wallet.getWalletState().unlocked,false);await assert.rejects(wallet.unlock(passwordA),{code:'UNLOCK_FAILED'});await wallet.unlock(passwordB);
 assert.ok(emitted.includes('ybz:wallet-selection-changed'));const stored=memory.get(COLLECTION_KEY);for(const secret of [keyA.slice(2),keyB.slice(2),passwordA,passwordB])assert.equal(stored.includes(secret),false);
 for(const item of collection().wallets){assert.equal(item.envelope.cipher,'aes-256-gcm');assert.equal(item.envelope.iterations,600000);assert.equal('encryptedJson'in item,false);}
});
test('additional creation waits for backup and cancellation preserves both existing vaults',async()=>{
 const before=memory.get(COLLECTION_KEY);await assert.rejects(wallet.createWallet(passwordA),{code:'WALLET_EXISTS'});
 const created=await wallet.createWallet(passwordA,{additional:true,name:'备用'});assert.equal(created.phrase.split(' ').length,12);assert.equal(memory.get(COLLECTION_KEY),before);
 wallet.cancelCreation();await assert.rejects(wallet.commitWallet(),{code:'CREATION_EXPIRED'});assert.equal(memory.get(COLLECTION_KEY),before);
 await wallet.createWallet(passwordA,{additional:true,name:'备用'});await wallet.commitWallet();assert.equal(wallet.listLocalWallets().length,3);assert.equal(wallet.listLocalWallets().at(-1).name,'备用');assert.equal(emitted.includes('ybz:wallet-selection-changed'),false);
});
test('export remains standard Web3 V3 and password verification never unlocks signing',async()=>{
 await wallet.selectWallet(idA);assert.throws(()=>wallet.exportEncryptedKeystore(),{code:'WALLET_LOCKED'});
 await wallet.verifyPassword(passwordA);assert.equal(wallet.getWalletState().unlocked,false);
 const exported=wallet.exportEncryptedKeystore().content;assert.equal(JSON.parse(exported).version,3);assert.equal((await Wallet.fromEncryptedJson(exported,passwordA)).address,a.address);
 await wallet.selectWallet(idB);assert.throws(()=>wallet.exportEncryptedKeystore(),{code:'WALLET_LOCKED'});await wallet.verifyPassword(passwordB);assert.equal((await Wallet.fromEncryptedJson(wallet.exportEncryptedKeystore().content,passwordB)).address,b.address);
});
test('GCM ciphertext tampering and copying another wallet envelope fail authentication',async()=>{
 const changed=collection();changed.wallets[1].envelope.ciphertext='00'+changed.wallets[1].envelope.ciphertext.slice(2);replace(changed);
 await assert.rejects(wallet.unlock(passwordB),{code:'UNLOCK_FAILED'});assert.equal(wallet.getWalletState().unlocked,false);
 const copied=JSON.parse(baseline.get(COLLECTION_KEY));copied.wallets[1].envelope=copied.wallets[0].envelope;replace(copied);
 await assert.rejects(wallet.unlock(passwordA),{code:'UNLOCK_FAILED'});
});
test('v1 and distinct v2 accounts are discovered without password, and migrate one at a time',async()=>{
 memory.clear();memory.set(LEGACY_VAULT_KEY,oldA);memory.set('ybz.wallet.evm.v2.56',oldB);
 const found=wallet.listLocalWallets();assert.equal(found.length,2);assert.equal(found.every(item=>item.migrationRequired),true);assert.equal(memory.has(COLLECTION_KEY),false);
 await wallet.unlock(passwordA);assert.equal(memory.has(LEGACY_VAULT_KEY),false);assert.equal(memory.get('ybz.wallet.evm.v2.56'),oldB);assert.equal(wallet.listLocalWallets()[1].migrationRequired,true);
 await wallet.selectWallet(found[1].id);await wallet.unlock(passwordB);assert.equal(memory.has('ybz.wallet.evm.v2.56'),false);assert.equal(wallet.listLocalWallets().every(item=>!item.migrationRequired),true);assert.equal(wallet.NETWORK.chainId,97,'stored disabled chain must not activate a mainnet');
});
test('failed legacy conversion keeps original bytes and a later retry succeeds',async()=>{
 memory.clear();memory.set(LEGACY_VAULT_KEY,oldA);globalThis.localStorage={...local(),setItem(){throw Error('quota');}};
 await assert.rejects(wallet.unlock(passwordA),{code:'STORAGE_UNAVAILABLE'});assert.equal(memory.get(LEGACY_VAULT_KEY),oldA);assert.equal(memory.has(COLLECTION_KEY),false);
 globalThis.localStorage=local();await wallet.unlock(passwordA);assert.equal(wallet.getWalletState().unlocked,true);assert.equal(memory.has(LEGACY_VAULT_KEY),false);
});
test('failed source cleanup remains explicitly pending and cannot delete another wallet source',async()=>{
 memory.clear();memory.set(LEGACY_VAULT_KEY,oldA);globalThis.localStorage={...local(),removeItem(){}};await wallet.unlock(passwordA);
 assert.equal(wallet.listLocalWallets()[0].migrationRequired,true);assert.equal(memory.get(LEGACY_VAULT_KEY),oldA);
 globalThis.localStorage=local();await wallet.unlock(passwordA);assert.equal(wallet.listLocalWallets()[0].migrationRequired,false);
 memory.set('ybz.wallet.evm.v2.56',oldB);
 assert.throws(()=>cleanLegacySources({address:a.address,legacyCleanup:[{key:'ybz.wallet.evm.v2.56',digest:vaultDigest(oldB)}]}),{code:'WALLET_CHANGED'});assert.equal(memory.get('ybz.wallet.evm.v2.56'),oldB);
});
test('an old tab changing a source during password work cancels migration with the replacement intact',async()=>{
 memory.clear();memory.set(LEGACY_VAULT_KEY,oldA);const pending=wallet.unlock(passwordA),replacement=JSON.stringify({...JSON.parse(oldA),encryptedJson:encryptedA+' '});memory.set(LEGACY_VAULT_KEY,replacement);
 await assert.rejects(pending,{code:'WALLET_CHANGED'});assert.equal(memory.get(LEGACY_VAULT_KEY),replacement);assert.equal(memory.has(COLLECTION_KEY),false);
});
test('unlock arriving after another tab selects a different wallet cannot unlock the new selection',async()=>{
 await wallet.selectWallet(idA);const pending=wallet.unlock(passwordA);await otherTab.selectWallet(idB);
 await assert.rejects(pending,{code:'WALLET_CHANGED'});assert.deepEqual(wallet.getWalletState(),{exists:true,address:b.address,unlocked:false});
});
test('concurrent tabs serialize writes and never overwrite a vault generated by the other tab',async()=>{
 memory.clear();const results=await Promise.allSettled([wallet.importPrivateKey(keyA,passwordA,{additional:true}),otherTab.importPrivateKey(keyB,passwordB,{additional:true})]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected')[0].reason.code,'WALLET_CHANGED');assert.equal(readWalletCollection().value.wallets.length,1);
});
test('deleting B keeps A envelope, name, chain preference and all A transaction records intact',async()=>{
 const before=collection().wallets[0],historyA='ybz.transactions.evm.v2.97.'+a.address.toLowerCase(),historyB='ybz.transactions.evm.v2.97.'+b.address.toLowerCase();
 memory.set(historyA,'[]');memory.set(historyB,'[]');const permit=await wallet.prepareLocalWalletDeletion(passwordB,{expectedAddress:b.address});await permit.clear();
 assert.deepEqual(collection().wallets,[before]);assert.equal(memory.get(historyA),'[]');assert.equal(memory.has(historyB),false);assert.deepEqual(wallet.getWalletState(),{exists:true,address:a.address,unlocked:false});await wallet.unlock(passwordA);
});
test('deletion permits cannot cross a wallet selection or rename revision',async()=>{
 const permit=await wallet.prepareLocalWalletDeletion(passwordB,{expectedAddress:b.address});await wallet.selectWallet(idA);
 await assert.rejects(permit.clear(),{code:'WALLET_CHANGED'});assert.equal(wallet.listLocalWallets().length,2);
});
test('partial record cleanup cannot leave a selectable wallet after its unknown payment record is removed',async()=>{
 const history='ybz.transactions.evm.v2.97.'+b.address.toLowerCase(),blocked='ybz.transactions.evm.v2.56.'+b.address.toLowerCase();memory.set(history,JSON.stringify([{hash:'0x'+'b'.repeat(64),status:'unknown',chainId:97,createdAt:1}]));memory.set(blocked,'[]');
 await wallet.unlock(passwordB);const permit=await wallet.prepareLocalWalletDeletion(passwordB,{expectedAddress:b.address});globalThis.localStorage={...local(),removeItem(key){if(key===blocked)throw Error('blocked');memory.delete(key);}};
 await assert.rejects(permit.clear(),{code:'LOCAL_CLEANUP_FAILED'});assert.equal(memory.has(history),false);assert.equal(wallet.listLocalWallets().some(item=>item.address===b.address),false);assert.equal(wallet.getWalletState().unlocked,false);
 globalThis.localStorage=local();await permit.clear();assert.equal(memory.has(blocked),false);assert.equal(wallet.getWalletState().address,a.address);
});
test('synchronous UI reads on lock events do not recursively invalidate the selection',async()=>{
 wallet.getWalletState();
 let reads=0;const listener=()=>{reads++;assert.ok(reads<5);wallet.getWalletState();};events.addEventListener('tongban:wallet-locked',listener);
 try{await wallet.selectWallet(idA);assert.equal(reads,1);reads=0;const changed=collection();changed.selectedId=idB;replace(changed);assert.equal(wallet.getWalletState().address,b.address);assert.equal(reads,1);}finally{events.removeEventListener('tongban:wallet-locked',listener);}
});
test('storage event adopts selection before notifying UI and revokes unlocked signing',async()=>{
 await wallet.selectWallet(idA);await wallet.unlock(passwordA);const changed=collection();changed.selectedId=idB;replace(changed);
 let seen;const listener=()=>{seen=wallet.getWalletState();};events.addEventListener('ybz:wallet-selection-changed',listener);
 try{const event=new Event('storage');Object.defineProperty(event,'key',{value:COLLECTION_KEY});events.dispatchEvent(event);assert.deepEqual(seen,{exists:true,address:b.address,unlocked:false});}finally{events.removeEventListener('ybz:wallet-selection-changed',listener);}
});
test('new legacy writes cannot be silently hidden by the collection or overwritten',async()=>{
 memory.set(LEGACY_VAULT_KEY,oldA);const saved=memory.get(COLLECTION_KEY);assert.throws(()=>wallet.listLocalWallets(),{code:'WALLET_CHANGED'});await assert.rejects(wallet.selectWallet(idB),{code:'WALLET_CHANGED'});assert.equal(memory.get(COLLECTION_KEY),saved);assert.equal(memory.get(LEGACY_VAULT_KEY),oldA);
});
test('the same address cannot be duplicated to escape unknown-payment history',async()=>{
 const row={hash:'0x'+'a'.repeat(64),chainId:97,status:'unknown',createdAt:1};memory.set('tongban.transactions.bsc-testnet.v1.'+a.address.toLowerCase(),JSON.stringify([row]));
 await assert.rejects(wallet.importPrivateKey(keyA,passwordA,{additional:true}),{code:'WALLET_DUPLICATE'});await wallet.selectWallet(idA);await wallet.unlock(passwordA);
 assert.equal(wallet.getRecords()[0].status,'unknown');await assert.rejects(wallet.prepareTransfer(b.address,'0.01'),{code:'TRANSACTION_PENDING'});
});
function signingStub(){let broadcasts=0;const previous=globalThis.fetch;globalThis.fetch=async(_url,options)=>{const request=JSON.parse(options.body);let result;switch(request.method){case'eth_chainId':result='0x61';break;case'eth_getBalance':result='0x8ac7230489e80000';break;case'eth_getCode':result='0x';break;case'eth_getTransactionCount':result='0x0';break;case'eth_gasPrice':result='0x3b9aca00';break;case'eth_estimateGas':result='0x5208';break;case'eth_sendRawTransaction':broadcasts++;result=keccak256(request.params[0]);break;default:throw Error('Unexpected synthetic method');}return{ok:true,json:async()=>({id:request.id,result})};};return{count:()=>broadcasts,restore:()=>globalThis.fetch=previous};}
test('wallet selection cancels a prepared signature, and another wallet cannot confirm it',async()=>{
 const stub=signingStub();try{await wallet.selectWallet(idA);await wallet.unlock(passwordA);const preview=await wallet.prepareTransfer(b.address,'0.01');await wallet.selectWallet(idB);await wallet.unlock(passwordB);await assert.rejects(wallet.confirmTransfer(preview.id,passwordB),{code:'PREVIEW_EXPIRED'});assert.equal(stub.count(),0);}finally{stub.restore();}
});
test('two tabs cannot broadcast both pre-approved transactions before unknown-history is checked',async()=>{
 const stub=signingStub();try{
  await wallet.selectWallet(idA);await wallet.unlock(passwordA);await otherTab.unlock(passwordA);
  const first=await wallet.prepareTransfer(b.address,'0.01'),second=await otherTab.prepareTransfer(b.address,'0.01');
  const results=await Promise.allSettled([wallet.confirmTransfer(first.id,passwordA),otherTab.confirmTransfer(second.id,passwordA)]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.code,'TRANSACTION_PENDING');assert.equal(stub.count(),1);
 }finally{stub.restore();}
});
test('browsers without cross-tab Web Locks cannot silently perform an unsafe collection write',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator'),oldWindow=globalThis.window,before=memory.get(COLLECTION_KEY);
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{}});globalThis.window={};
 try{await assert.rejects(wallet.renameWallet(idA,'不应保存'),{code:'WALLET_STORAGE_LOCK_UNAVAILABLE'});assert.equal(memory.get(COLLECTION_KEY),before);}finally{Object.defineProperty(globalThis,'navigator',descriptor);if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
});
