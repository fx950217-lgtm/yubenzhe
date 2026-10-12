import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,encryptKeystoreJson} from 'ethers';
import * as wallet from '../src/wallet.js';
import {COLLECTION_KEY} from '../src/wallet-local-vaults.js';
// Public private-key-one test vector only; no requests leave this process.
const key='0x'+'0'.repeat(63)+'1',signer=new Wallet(key),password='synthetic-delete-1234';
const vaultKey='tongban.wallet.bsc-testnet.v1',recordKey='tongban.transactions.bsc-testnet.v1.'+signer.address.toLowerCase(),memory=new Map();
const encryptedJson=await encryptKeystoreJson({address:signer.address,privateKey:key},password,{scrypt:{N:16,r:1,p:1}});
const stored=JSON.stringify({version:1,chainId:97,address:signer.address,encryptedJson});
function local(){return {getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)}}
globalThis.fetch=async()=>{throw Error('Network access forbidden in local deletion tests')};
test.beforeEach(async()=>{wallet.lock();memory.clear();globalThis.localStorage=local();memory.set(vaultKey,stored);await wallet.unlock(password)});
test.afterEach(()=>{wallet.lock();globalThis.localStorage=local()});
test('deletion verifies password/address and removes only the selected wallet and its records',async()=>{
 await assert.rejects(wallet.prepareLocalWalletDeletion(password,{expectedAddress:'0x1111111111111111111111111111111111111111'}),{code:'WALLET_CHANGED'});
 await assert.rejects(wallet.prepareLocalWalletDeletion('bad-password',{expectedAddress:signer.address}),{code:'UNLOCK_FAILED'});
 memory.set(recordKey,'old-public-history');const untouched={'tongban.profile.v1':'profile','tongban.social.session':'synthetic-session','ybz-m0-wallet-deletion:synthetic':'server-unbound','tongban.wallet.watchlist.v1':'watch-only','platform-independent-ledger':'not-wallet','tongban.transactions.bsc-testnet.v1.other':'other-history'};
 for(const [k,v]of Object.entries(untouched))memory.set(k,v);
 const saved=memory.get(COLLECTION_KEY),permit=await wallet.prepareLocalWalletDeletion(password,{expectedAddress:signer.address});assert.equal(memory.get(COLLECTION_KEY),saved);
 assert.equal((await permit.clear()).cleared,true);assert.equal(memory.has(vaultKey),false);assert.equal(memory.has(recordKey),false);
 for(const [k,v]of Object.entries(untouched))assert.equal(memory.get(k),v);assert.deepEqual(wallet.getWalletState(),{exists:false,address:null,unlocked:false});await assert.rejects(permit.clear(),{code:'DELETION_PERMIT_USED'});
});
test('record removal and collection write failures can retry the same permit without deleting other data',async()=>{
 memory.set(recordKey,'public-history');memory.set('platform-data','keep');const saved=memory.get(COLLECTION_KEY),permit=await wallet.prepareLocalWalletDeletion(password,{expectedAddress:signer.address});
 globalThis.localStorage={...local(),setItem(){throw Error('quota');}};
 await assert.rejects(permit.clear(),{code:'LOCAL_CLEANUP_FAILED'});assert.equal(memory.get(COLLECTION_KEY),saved);assert.equal(wallet.getWalletState().unlocked,false);
 assert.equal(memory.get(recordKey),'public-history');
 globalThis.localStorage={...local(),removeItem:key=>{if(key!==recordKey)memory.delete(key)}};
 await assert.rejects(permit.clear(),{code:'LOCAL_CLEANUP_FAILED'});assert.equal(wallet.getWalletState().exists,false);assert.equal(memory.get(recordKey),'public-history');
 globalThis.localStorage=local();assert.equal((await permit.clear()).cleared,true);assert.equal(memory.get('platform-data'),'keep');
});
test('collection read failure after the removal write locks signer and permits retry acknowledgement',async()=>{
 const permit=await wallet.prepareLocalWalletDeletion(password,{expectedAddress:signer.address});let afterWrite=false;
 globalThis.localStorage={...local(),setItem(key,value){memory.set(key,String(value));if(key===COLLECTION_KEY)afterWrite=true;},getItem(key){if(afterWrite&&key===COLLECTION_KEY)throw Error('transient read failure');return memory.get(key)??null;}};
 await assert.rejects(permit.clear(),{code:'LOCAL_CLEANUP_FAILED'});globalThis.localStorage=local();assert.equal(wallet.getWalletState().unlocked,false);assert.equal((await permit.clear()).cleared,true);
});
test('a verified permit cannot remove a replaced same-address old vault',async()=>{
 const permit=await wallet.prepareLocalWalletDeletion(password,{expectedAddress:signer.address}),replacement=JSON.stringify({...JSON.parse(stored),encryptedJson:encryptedJson+' '});memory.set(vaultKey,replacement);
 await assert.rejects(permit.clear(),{code:'WALLET_CHANGED'});assert.equal(memory.get(vaultKey),replacement);
});
