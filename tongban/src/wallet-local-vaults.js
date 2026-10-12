import {getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {CHAIN_REGISTRY,DEFAULT_CHAIN_ID,getChain} from './chain-registry.js';

export const COLLECTION_KEY='ybz.wallet.collection.v3';
export const LEGACY_VAULT_KEY='tongban.wallet.bsc-testnet.v1';
export const LEGACY_VAULT_PREFIX='ybz.wallet.evm.v2.';
const FORMAT='aes-256-gcm',ITERATIONS=600000,MAX_WALLETS=20;
const bad=(message,code='VAULT_INVALID')=>Object.assign(Error(message),{code});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const identity=value=>uuid(value)||/^legacy-0x[a-f0-9]{40}$/.test(value||'');
export function walletStorage(){try{if(!globalThis.localStorage)throw Error();return globalThis.localStorage;}catch{throw bad('浏览器无法使用本地存储，请检查存储权限。','STORAGE_UNAVAILABLE');}}
export const legacyVaultLocations=()=>[[LEGACY_VAULT_KEY,DEFAULT_CHAIN_ID,1],...CHAIN_REGISTRY.map(chain=>[LEGACY_VAULT_PREFIX+chain.chainId,chain.chainId,2])];
export const vaultDigest=raw=>keccak256(toUtf8Bytes(raw));
export function walletName(value,fallback='本机钱包'){
 if(value===undefined)return fallback;
 if(typeof value!=='string'||!value.trim()||value.trim().length>40||/[\x00-\x1f\x7f]/.test(value))throw bad('钱包备注名须为 1–40 个可见字符。','WALLET_NAME_INVALID');
 return value.trim();
}
export function readLegacyVault(key,chainId,version){
 const raw=walletStorage().getItem(key);if(raw===null)return null;
 return parseLegacyVault(raw,key,chainId,version);
}
function parseLegacyVault(raw,key,chainId,version){
 try{const value=JSON.parse(raw),encrypted=JSON.parse(value.encryptedJson);if(value.version!==version||value.chainId!==chainId||!getChain(chainId)||encrypted.version!==3||!encrypted.Crypto&&!encrypted.crypto)throw Error();const address=getAddress(value.address);if(getAddress('0x'+String(encrypted.address).replace(/^0x/,''))!==address)throw Error();return {...value,address,key,raw};}
 catch{throw bad('本地钱包无法读取，请保留原始数据后恢复。');}
}
function checkedEnvelope(value){
 if(!object(value)||value.version!==1||value.cipher!==FORMAT||value.kdf!=='pbkdf2-sha256'||value.iterations!==ITERATIONS||!/^[a-f0-9]{32}$/.test(value.salt)||!/^[a-f0-9]{24}$/.test(value.iv)||typeof value.ciphertext!=='string'||value.ciphertext.length<32||value.ciphertext.length>8*1024*1024||!/^(?:[a-f0-9]{2})+$/.test(value.ciphertext))throw bad('本机加密钱包格式无效，请保留原数据。');
 return value;
}
function checkedCollection(value){
 if(!object(value)||value.version!==3||!uuid(value.revision)||!Array.isArray(value.wallets)||value.wallets.length>MAX_WALLETS)throw bad('本机钱包集合无法读取，请保留原数据。');
 const ids=new Set(),addresses=new Set();
 for(const item of value.wallets){
  if(!object(item)||!identity(item.id)||ids.has(item.id)||!getChain(item.chainId)||!['legacy-keystore',FORMAT].includes(item.storageFormat))throw bad('本机钱包集合包含无效项目。');
  const address=getAddress(item.address);if(address!==item.address||addresses.has(address))throw bad('本机钱包地址重复或无效。');ids.add(item.id);addresses.add(address);walletName(item.name);
  if(item.storageFormat===FORMAT)checkedEnvelope(item.envelope);
  else if(typeof item.encryptedJson!=='string'||!Array.isArray(item.legacySources))throw bad('旧钱包记录无法读取。');
  if(item.legacySources!==undefined&&(!Array.isArray(item.legacySources)||item.legacySources.length>6||item.legacySources.some(source=>!legacyVaultLocations().some(([key])=>key===source.key)||typeof source.raw!=='string')))throw bad('旧钱包来源记录无法读取。');
  if(item.legacyCleanup!==undefined&&(!Array.isArray(item.legacyCleanup)||item.legacyCleanup.some(source=>!legacyVaultLocations().some(([key])=>key===source.key)||!/^0x[a-f0-9]{64}$/.test(source.digest))))throw bad('旧钱包清理记录无法读取。');
  for(const source of item.legacySources||[]){const [key,chainId,version]=legacyVaultLocations().find(([key])=>key===source.key);if(parseLegacyVault(source.raw,key,chainId,version).address!==address)throw bad('旧钱包来源与钱包地址不一致。');}
 }
 if(value.selectedId!==null&&!ids.has(value.selectedId)||value.wallets.length>0&&value.selectedId===null)throw bad('当前钱包选择无效。');return value;
}
export function readWalletCollection(){
 const local=walletStorage();let raw;try{raw=local.getItem(COLLECTION_KEY);}catch{throw bad('无法读取本机钱包，请检查存储权限。','STORAGE_UNAVAILABLE');}
 if(raw!==null){try{const value=checkedCollection(JSON.parse(raw));
  // Old clients can still write their own keys. Never hide a new/replaced vault
  // behind the new collection, or silently delete it during a later cleanup.
  for(const [key]of legacyVaultLocations()){
   const source=local.getItem(key);if(source===null)continue;
   const known=value.wallets.some(item=>(item.legacySources||[]).some(row=>row.key===key&&row.raw===source)||(item.legacyCleanup||[]).some(row=>row.key===key&&row.digest===vaultDigest(source)));
   if(!known)throw bad('检测到旧页面更改了钱包，请关闭旧页面并保留原始数据后重新核对。','WALLET_CHANGED');
  }
  return {raw,stamp:raw,value};}catch(error){if(error.code)throw error;throw bad('本机钱包集合无法读取，请保留原数据。');}}
 const wallets=[];
 for(const [key,chainId,version]of legacyVaultLocations()){
  const old=readLegacyVault(key,chainId,version);if(!old)continue;
  let item=wallets.find(row=>row.address===old.address);
  if(!item){item={id:'legacy-'+old.address.toLowerCase(),address:old.address,name:'钱包 '+(wallets.length+1),chainId,storageFormat:'legacy-keystore',encryptedJson:old.encryptedJson,legacySources:[]};wallets.push(item);}
  item.legacySources.push({key,raw:old.raw});
  // The v2 partition was the active representation in the previous release.
  if(chainId===DEFAULT_CHAIN_ID&&version===2){item.encryptedJson=old.encryptedJson;item.chainId=chainId;}
 }
 const selected=wallets.find(item=>item.chainId===DEFAULT_CHAIN_ID)||wallets[0];
 const value={version:3,revision:null,selectedId:selected?.id||null,wallets};return {raw:null,stamp:JSON.stringify(value),value};
}
export function collectionWith(snapshot,changes){return {...snapshot.value,...changes,revision:crypto.randomUUID()};}
export function persistCollection(snapshot,value){
 checkedCollection(value);const local=walletStorage(),raw=JSON.stringify(value);
 if(readWalletCollection().stamp!==snapshot.stamp)throw bad('另一页面已更改钱包，请重新核对。','WALLET_CHANGED');
 try{local.setItem(COLLECTION_KEY,raw);if(local.getItem(COLLECTION_KEY)!==raw)throw Error();}
 catch{throw bad('钱包保存结果未确认，请保留备份并核对本机钱包列表。','STORAGE_UNAVAILABLE');}
 return {raw,stamp:raw,value};
}
// Web Locks serializes all collection writers across tabs. On old browsers we
// fail closed instead of pretending localStorage read/compare/write is atomic.
const localLocks=globalThis[Symbol.for('ybz.wallet.local-write-locks')]??=new Map();
export async function withWalletWrite(job){
 if(globalThis.navigator?.locks?.request)return navigator.locks.request(COLLECTION_KEY,{mode:'exclusive'},async()=>job());
 if(typeof window!=='undefined')throw bad('此浏览器缺少安全的多页面钱包锁，请升级浏览器后重试。','WALLET_STORAGE_LOCK_UNAVAILABLE');
 const previous=localLocks.get(COLLECTION_KEY)||Promise.resolve();let release;const held=new Promise(resolve=>release=resolve);localLocks.set(COLLECTION_KEY,held);await previous;try{return await job();}finally{release();if(localLocks.get(COLLECTION_KEY)===held)localLocks.delete(COLLECTION_KEY);}
}
const hex=bytes=>[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
const unhex=value=>Uint8Array.from(value.match(/../g)||[],byte=>parseInt(byte,16));
const aad=item=>new TextEncoder().encode('YBZ-LOCAL-VAULT-GCM:v1:'+item.id+':'+item.address);
async function encryptionKey(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
export async function encryptLocalVault(item,encryptedJson,password,legacySources=[]){
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await encryptionKey(password,salt);
 const payload=new TextEncoder().encode(JSON.stringify({keystore:encryptedJson,legacyArchives:legacySources}));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(item),tagLength:128},key,payload);payload.fill(0);
 return {version:1,cipher:FORMAT,kdf:'pbkdf2-sha256',iterations:ITERATIONS,salt:hex(salt),iv:hex(iv),ciphertext:hex(new Uint8Array(ciphertext))};
}
export async function decryptLocalVault(item,password){
 const envelope=checkedEnvelope(item.envelope),key=await encryptionKey(password,unhex(envelope.salt));
 const bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(envelope.iv),additionalData:aad(item),tagLength:128},key,unhex(envelope.ciphertext)));
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(typeof value.keystore!=='string')throw Error();return value.keystore;}finally{bytes.fill(0);}
}
export function selectedLocalVault(snapshot=readWalletCollection()){return snapshot.value.wallets.find(item=>item.id===snapshot.value.selectedId)||null;}
export function cleanLegacySources(item){
 const local=walletStorage();let complete=true;
 for(const source of item.legacyCleanup||[]){const raw=local.getItem(source.key);if(raw===null)continue;const [key,chainId,version]=legacyVaultLocations().find(([key])=>key===source.key)||[];if(!key||parseLegacyVault(raw,key,chainId,version).address!==item.address||vaultDigest(raw)!==source.digest)throw bad('旧钱包副本已改变，未清理新数据。','WALLET_CHANGED');try{local.removeItem(source.key);if(local.getItem(source.key)!==null)complete=false;}catch{complete=false;}}
 return complete;
}
