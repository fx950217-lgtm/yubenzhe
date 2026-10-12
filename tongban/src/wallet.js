import {CHAIN_REGISTRY,DEFAULT_CHAIN_ID,getChain,getEnabledChain} from './chain-registry.js';
import {transactionFeeFields,feeCap,sameFeeFields} from './wallet-fee-policy.js';
import { Wallet, getAddress, formatEther, parseEther, keccak256, toQuantity } from 'ethers';
import { walletFromMnemonic, walletFromPrivateKey, walletFromKeystore, normalizePublicAddress, validateExpectedAddress } from './wallet-compatibility.js';
import { requireWatchWallet } from './wallet-watchlist.js';
import {COLLECTION_KEY,LEGACY_VAULT_KEY,LEGACY_VAULT_PREFIX,legacyVaultLocations,readWalletCollection,selectedLocalVault,collectionWith,persistCollection,withWalletWrite,walletName,encryptLocalVault,decryptLocalVault,cleanLegacySources,vaultDigest,walletStorage} from './wallet-local-vaults.js';
export { listWatchWallets, addWatchWallet, removeWatchWallet } from './wallet-watchlist.js';
export { DEFAULT_DERIVATION_PATH, MAX_KEYSTORE_BYTES, previewMnemonic, previewPrivateKey, previewKeystore } from './wallet-compatibility.js';

// A stored preference never enables a disabled network.
export let NETWORK = getEnabledChain(DEFAULT_CHAIN_ID);
export const getNetworks = () => CHAIN_REGISTRY;
const LEGACY_RECORD_PREFIX = 'tongban.transactions.bsc-testnet.v1.';
const RECORD_PREFIX = 'ybz.transactions.evm.v2.';
let networkEpoch = 0;
const AUTO_LOCK_MS = 5 * 60 * 1000;
const PREVIEW_MS = 2 * 60 * 1000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
let session = null, draft = null, prepared = null, exportCache = null, selectionStamp;
let lockTimer = null, epoch = 0, creating = false, confirming = false, requestId = 0;

function fail(message, code = 'WALLET_ERROR') { return Object.assign(new Error(message),{code}); }
const storage=walletStorage;
const fingerprint=item=>item?.storageFormat==='aes-256-gcm'?JSON.stringify(item.envelope):item?.encryptedJson;
const selectedNetwork=item=>getChain(item?.chainId)?.enabled?getEnabledChain(item.chainId):getEnabledChain(DEFAULT_CHAIN_ID);
function announceSelection(){globalThis.dispatchEvent?.(new Event('ybz:wallet-selection-changed'));}
function adoptSnapshot(snapshot){
 const item=selectedLocalVault(snapshot);selectionStamp=snapshot.stamp;
 if(item)NETWORK=selectedNetwork(item);
 return item;
}
function synchronize(){
 const snapshot=readWalletCollection();
 const changed=selectionStamp!==undefined&&selectionStamp!==snapshot.stamp;
 adoptSnapshot(snapshot);if(changed){networkEpoch++;lock();}return snapshot;
}
function readVault(){
 const item=selectedLocalVault(synchronize());
 return item?{...item,encryptedJson:fingerprint(item)}:null;
}
function unchanged(snapshot){if(readWalletCollection().stamp!==snapshot.stamp)throw fail('另一页面已更改钱包，请重新核对。','WALLET_CHANGED');}
function remember(wallet,item,encryptedJson){session=wallet;exportCache={id:item.id,fingerprint:fingerprint(item),encryptedJson,expiresAt:Date.now()+AUTO_LOCK_MS};armLock();}
function ensureAvailable(snapshot,options={}){
 if(snapshot.value.wallets.length&&!options.additional)throw fail('此设备已有钱包，请使用添加钱包入口。','WALLET_EXISTS');
 if(snapshot.value.wallets.length>=20)throw fail('本机最多保存 20 个钱包。','WALLET_LIMIT');
}
function newItem(wallet,snapshot,options){
 if(snapshot.value.wallets.some(item=>item.address===wallet.address))throw fail('本机已保存这个地址，请选择已有钱包。','WALLET_DUPLICATE');
 return {id:crypto.randomUUID(),address:wallet.address,name:walletName(options.name,'钱包 '+(snapshot.value.wallets.length+1)),chainId:NETWORK.chainId,storageFormat:'aes-256-gcm'};
}
export function listLocalWallets(){
 const snapshot=synchronize();return snapshot.value.wallets.map(item=>({id:item.id,address:item.address,name:item.name,chainId:item.chainId,selected:item.id===snapshot.value.selectedId,storageFormat:item.storageFormat,migrationRequired:item.storageFormat!=='aes-256-gcm'||(item.legacyCleanup||[]).some(source=>storage().getItem(source.key)!==null)}));
}
export async function selectWallet(id){
 if(creating||confirming)throw fail('钱包操作尚未结束，请稍后切换。','WALLET_BUSY');
 return withWalletWrite(()=>{
  const snapshot=synchronize(),item=snapshot.value.wallets.find(row=>row.id===id);
  if(!item)throw fail('本机没有这个钱包。','WALLET_MISSING');
  const saved=persistCollection(snapshot,collectionWith(snapshot,{selectedId:id}));
  networkEpoch++;adoptSnapshot(saved);lock();announceSelection();return getWalletState();
 });
}
export async function renameWallet(id,name){
 name=walletName(name);
 return withWalletWrite(()=>{
  const snapshot=synchronize();if(!snapshot.value.wallets.some(item=>item.id===id))throw fail('本机没有这个钱包。','WALLET_MISSING');
  const saved=persistCollection(snapshot,collectionWith(snapshot,{wallets:snapshot.value.wallets.map(item=>item.id===id?{...item,name}:item)}));
  adoptSnapshot(saved);return listLocalWallets();
 });
}
export async function setNetwork(chainId){
 const next=getEnabledChain(chainId);
 if(creating||confirming)throw fail('钱包操作尚未结束，请稍后切换网络。','WALLET_BUSY');
 return withWalletWrite(()=>{
  const snapshot=synchronize(),item=selectedLocalVault(snapshot);
  if(next.chainId===NETWORK.chainId&&(!item||item.chainId===next.chainId))return NETWORK;
  const saved=item?persistCollection(snapshot,collectionWith(snapshot,{wallets:snapshot.value.wallets.map(row=>row.id===item.id?{...row,chainId:next.chainId}:row)})):snapshot;
  networkEpoch++;adoptSnapshot(saved);NETWORK=next;lock();
  globalThis.dispatchEvent?.(new Event('ybz:wallet-network-changed'));announceSelection();return NETWORK;
 });
}
function checkConnection(connection){
 synchronize();
 if(connection.revision!==networkEpoch||connection.network.chainId!==NETWORK.chainId)throw fail('钱包或网络已改变，请重新核对。','NETWORK_CHANGED');
}
function validatePassword(password){if(typeof password!=='string'||password.length<10||password.length>256||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))throw fail('请设置 10–256 位密码，至少包含字母和数字。','PASSWORD_WEAK');}
function armLock(){clearTimeout(lockTimer);lockTimer=setTimeout(lock,AUTO_LOCK_MS);lockTimer?.unref?.();}
function requireSession(){
 const vault=readVault();if(!vault||!session||vault.address!==session.address||exportCache?.id!==vault.id||exportCache.fingerprint!==vault.encryptedJson){lock();throw fail('请先解锁钱包。','WALLET_LOCKED');}armLock();return vault;
}
function requireSameSession(startEpoch,address,encryptedJson){
 const current=readVault();if(epoch!==startEpoch||!session||session.address!==address||!current||current.encryptedJson!==encryptedJson)throw fail('钱包已锁定或已发生变化，请重新解锁并确认。','SESSION_CHANGED');
}
function clearSession(notify=true){epoch++;session=null;draft=null;prepared=null;exportCache=null;clearTimeout(lockTimer);lockTimer=null;if(notify)globalThis.dispatchEvent?.(new Event('tongban:wallet-locked'));}
export function lock(){clearSession();}
export function getWalletState(){try{const vault=readVault();return {exists:Boolean(vault),address:vault?.address??null,unlocked:Boolean(vault&&session?.address===vault.address)};}catch(error){if(error.code==='VAULT_INVALID')return {exists:true,address:null,unlocked:false,corrupt:true};throw error;}}
export async function createWallet(password,options={}){
 validatePassword(password);const snapshot=synchronize();ensureAvailable(snapshot,options);
 if(creating||confirming)throw fail('钱包正在处理中，请稍候。','WALLET_BUSY');
 creating=true;draft=null;const startEpoch=epoch;
 try{
  const wallet=Wallet.createRandom(),item=newItem(wallet,snapshot,options),encryptedJson=await wallet.encrypt(password);
  item.envelope=await encryptLocalVault(item,encryptedJson,password);
  if(epoch!==startEpoch)throw fail('创建已取消，请重新开始。','CREATION_CANCELLED');
  unchanged(snapshot);draft={wallet,item,encryptedJson,snapshot,epoch:startEpoch,options};armLock();return {address:wallet.address,phrase:wallet.mnemonic.phrase};
 }catch(error){if(error.code&&/^[\u3400-\u9fff]/.test(error.message||''))throw error;throw fail('未能创建钱包，请使用支持安全随机数的现代浏览器。','CREATION_FAILED');}finally{creating=false;}
}
// Only called after the user has verified the backup words.
export async function commitWallet(){
 return withWalletWrite(()=>{
  const pending=draft;if(!pending)throw fail('创建已过期，请重新创建并备份。','CREATION_EXPIRED');
  const current=readWalletCollection();ensureAvailable(current,pending.options);unchanged(pending.snapshot);
  if(epoch!==pending.epoch)throw fail('创建已取消，请重新开始。','CREATION_CANCELLED');
  const saved=persistCollection(current,collectionWith(current,{wallets:[...current.value.wallets,pending.item],selectedId:pending.item.id}));
  clearSession(false);networkEpoch++;adoptSnapshot(saved);remember(pending.wallet,pending.item,pending.encryptedJson);return getWalletState();
 });
}
export function cancelCreation(){epoch++;draft=null;if(!session){clearTimeout(lockTimer);lockTimer=null;}}
async function importWallet(factory,password,options={}){
 validatePassword(password);const snapshot=synchronize();ensureAvailable(snapshot,options);
 if(creating||confirming)throw fail('钱包正在处理中，请稍候。','WALLET_BUSY');
 creating=true;draft=null;const startEpoch=epoch;
 try{
  const wallet=await factory();if(epoch!==startEpoch)throw fail('导入已取消，请重新开始。','CREATION_CANCELLED');
  validateExpectedAddress(wallet.address,options);const item=newItem(wallet,snapshot,options),encryptedJson=await wallet.encrypt(password);
  item.envelope=await encryptLocalVault(item,encryptedJson,password);
  return await withWalletWrite(()=>{
   const current=readWalletCollection();ensureAvailable(current,options);
   if(epoch!==startEpoch)throw fail('导入已取消，请重新开始。','CREATION_CANCELLED');unchanged(snapshot);
   const saved=persistCollection(current,collectionWith(current,{wallets:[...current.value.wallets,item],selectedId:item.id}));
   clearSession(false);networkEpoch++;adoptSnapshot(saved);remember(wallet,item,encryptedJson);return getWalletState();
  });
 }catch(error){if(error.code&&/^[\u3400-\u9fff]/.test(error.message||''))throw error;throw fail('钱包导入失败，请检查输入后重试。','RESTORE_FAILED');}finally{creating=false;}
}
export function restoreWallet(phrase,password,options={}){return importWallet(()=>walletFromMnemonic(phrase,options),password,options);}
export function importPrivateKey(privateKey,password,options={}){return importWallet(()=>walletFromPrivateKey(privateKey),password,options);}
export function importKeystore(json,sourcePassword,password,options={}){return importWallet(()=>walletFromKeystore(json,sourcePassword),password,options);}
async function decryptInfo(vault,password){
 if(typeof password!=='string'||!password||password.length>256)throw fail('请输入钱包密码。','PASSWORD_REQUIRED');
 try{const encryptedJson=vault.storageFormat==='aes-256-gcm'?await decryptLocalVault(vault,password):vault.encryptedJson;const wallet=await Wallet.fromEncryptedJson(encryptedJson,password);if(wallet.address!==vault.address)throw Error();return {wallet,encryptedJson};}
 catch{throw fail('密码错误或钱包文件已损坏，请检查后重试。','UNLOCK_FAILED');}
}
async function decrypt(vault,password){return (await decryptInfo(vault,password)).wallet;}
export async function unlock(password){
 const vault=readVault();if(!vault)throw fail('请先创建或恢复钱包。','WALLET_MISSING');
 const snapshot=readWalletCollection(),startEpoch=epoch,{wallet,encryptedJson}=await decryptInfo(vault,password);
 if(epoch!==startEpoch)throw fail('解锁已取消，请重试。','SESSION_CHANGED');unchanged(snapshot);
 let item=selectedLocalVault(snapshot);
 if(item.storageFormat==='legacy-keystore'){
  const envelope=await encryptLocalVault(item,encryptedJson,password,item.legacySources);
  const {encryptedJson:oldJson,legacySources,...metadata}=item;
  item={...metadata,storageFormat:'aes-256-gcm',envelope,legacyCleanup:legacySources.map(source=>({key:source.key,digest:vaultDigest(source.raw)}))};
  await withWalletWrite(()=>{
   if(epoch!==startEpoch)throw fail('解锁已取消，请重试。','SESSION_CHANGED');unchanged(snapshot);
   const saved=persistCollection(snapshot,collectionWith(snapshot,{wallets:snapshot.value.wallets.map(row=>row.id===item.id?item:row)}));
   adoptSnapshot(saved);cleanLegacySources(item);
  });
 }else if(item.legacyCleanup?.length){await withWalletWrite(()=>{unchanged(snapshot);cleanLegacySources(item);});}
 const current=readVault();if(epoch!==startEpoch||current?.id!==item.id||current.encryptedJson!==fingerprint(item))throw fail('解锁已取消，请重试。','SESSION_CHANGED');
 remember(wallet,item,encryptedJson);return getWalletState();
}
// Credential verification never unlocks a signing session. A short-lived cache
// permits synchronous export of an interoperable Web3 V3 keystore afterwards.
export async function verifyPassword(password){
 const vault=readVault();if(!vault)throw fail('请先创建或恢复钱包。','WALLET_MISSING');
 const startEpoch=epoch,{wallet,encryptedJson}=await decryptInfo(vault,password);
 if(epoch!==startEpoch||readVault()?.encryptedJson!==vault.encryptedJson)throw fail('密码验证已取消或钱包已发生变化，请重新验证。','SESSION_CHANGED');
 exportCache={id:vault.id,fingerprint:vault.encryptedJson,encryptedJson,expiresAt:Date.now()+60000};return {verified:true,address:wallet.address};
}

async function rpc(connection, method, params = []) {
  checkConnection(connection);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const id = ++requestId;
  try {
    const response = await fetch(connection.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    });
    if (!response.ok) throw new Error();
    const body = await response.json();
    checkConnection(connection);
    if (body.id !== id || body.error || !Object.hasOwn(body, 'result')) throw new Error();
    return body.result;
  } catch (error) {
    if(error.code==='NETWORK_CHANGED')throw error;
    checkConnection(connection);
    // RPC responses are untrusted and can contain private input; never expose them.
    throw fail('网络暂时无法连接，请稍后重试。', 'RPC_UNAVAILABLE');
  } finally { clearTimeout(timeout); }
}

async function assertChain(url) {
  const chain = await rpc(url, 'eth_chainId');
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== BigInt(url.network.chainId)) {
    throw fail('网络校验失败：必须匹配当前选择的 '+url.network.name+'，已阻止交易。', 'CHAIN_MISMATCH');
  }
}

async function connectRpc(options={}) {
  synchronize();const chainId=options.chainId??NETWORK.chainId;
  const network=getEnabledChain(chainId),revision=networkEpoch;
  if(chainId!==NETWORK.chainId)throw fail('请先切换到对应网络后再查询。','NETWORK_CHANGED');
  for(const endpoint of network.rpcUrls){
    const connection={url:endpoint,network,revision};
    try {await assertChain(connection);return connection;}
    catch(error){if(['CHAIN_MISMATCH','NETWORK_CHANGED'].includes(error.code))throw error;}
  }
  throw fail(network.name+'暂时无法连接，请稍后重试。','RPC_UNAVAILABLE');
}
async function quoteFeeFields(connection){
  if(connection.network.feeModel==='legacy')return transactionFeeFields('legacy',{gasPrice:quantity(await rpc(connection,'eth_gasPrice'))});
  const [block,priority]=await Promise.all([rpc(connection,'eth_getBlockByNumber',['latest',false]),rpc(connection,'eth_maxPriorityFeePerGas')]);
  return transactionFeeFields('eip1559',{baseFeePerGas:quantity(block?.baseFeePerGas),maxPriorityFeePerGas:quantity(priority)});
}

function quantity(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw fail('网络返回了无效数据，请稍后重试。', 'RPC_INVALID');
  return BigInt(value);
}

function validateTransfer(to, amount, address) {
  let recipient;
  try { recipient = getAddress(typeof to === 'string' ? to.trim() : ''); }
  catch { throw fail('收款地址无效，请输入完整的 0x 钱包地址。', 'ADDRESS_INVALID'); }
  if (recipient === ZERO_ADDRESS) throw fail('不能向零地址转账。', 'ADDRESS_ZERO');
  if (recipient === address) throw fail('收款地址不能是当前钱包。', 'ADDRESS_SELF');
  if (typeof amount !== 'string' || amount.length > 80 || !/^\d+(\.\d{1,18})?$/.test(amount.trim())) {
    throw fail('请输入有效金额，最多支持 18 位小数。', 'AMOUNT_INVALID');
  }
  let value;
  try { value = parseEther(amount.trim()); }
  catch { throw fail('转账金额格式不正确。', 'AMOUNT_INVALID'); }
  if (value <= 0n || value >= 2n ** 256n) throw fail('转账金额必须大于 0 且在有效范围内。', 'AMOUNT_INVALID');
  return { to: recipient, value };
}

async function quote(url, from, to, value, data = '0x') {
  const [code, balanceResult, feeFields, nonceResult, gasResult] = await Promise.all([
    rpc(url, 'eth_getCode', [to, 'latest']),
    rpc(url, 'eth_getBalance', [from, 'pending']),
    quoteFeeFields(url),
    rpc(url, 'eth_getTransactionCount', [from, 'pending']),
    rpc(url, 'eth_estimateGas', [{ from, to, value: toQuantity(value), data }]),
  ]);
  if (code !== '0x' && code !== '0x0') throw fail('当前仅开放普通地址转账；合约收款尚未通过安全验证。', 'CONTRACT_UNSUPPORTED');
  const balance = quantity(balanceResult);
  const maxGasPrice = feeCap(feeFields);
  const nonceValue = quantity(nonceResult);
  const gasLimit = quantity(gasResult);
  if (nonceValue > BigInt(Number.MAX_SAFE_INTEGER) || gasLimit < 21000n || gasLimit > 100000n) {
    throw fail('网络手续费数据异常，已阻止交易。', 'FEE_INVALID');
  }
  const gasFee = maxGasPrice * gasLimit;
  if (balance < value + gasFee) throw fail(url.network.symbol+'数量不足，需要同时支付转账金额与网络手续费。', 'BALANCE_INSUFFICIENT');
  return { feeFields, gasLimit, gasFee, nonce: Number(nonceValue) };
}

const READ_METHODS = new Set(['eth_getCode','eth_call','eth_getBalance','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber','eth_blockNumber','eth_getTransactionCount']);
// Public chain data only. Callers cannot use this path to broadcast or ask a node to sign.
export async function createChainReader(options={}) {
  const url=await connectRpc(options);
  return (method,params=[])=>{if(!READ_METHODS.has(method))throw fail('不支持该链上查询。','RPC_METHOD_BLOCKED');return rpc(url,method,params);};
}
export async function readChain(method, params = [], options={}) {
  if (!READ_METHODS.has(method)) throw fail('不支持该链上查询。', 'RPC_METHOD_BLOCKED');
  return rpc(await connectRpc(options), method, params);
}

function requireNoPending(address) {
  if (readRecords(address).some(item => ['pending', 'unknown'].includes(item.status))) {
    throw fail('还有交易等待核实，请先刷新转账记录；不要重复签名或转账。', 'TRANSACTION_PENDING');
  }
}

export async function refreshRecords() {
  const address = readVault()?.address;
  const chainId=NETWORK.chainId,revision=networkEpoch;
  if (!address) return [];
  const results = [];
  for (const record of readRecords(address).slice(0, 20)) {
    if (revision!==networkEpoch||readVault()?.address !== address) break;
    try { results.push(await getTransactionStatus(record.hash,{chainId})); }
    catch (error) { results.push({hash:record.hash,error:error.code || 'RPC_UNAVAILABLE'}); }
  }
  return results;
}

export async function getBalance() {
  const vault = readVault();
  if (!vault) return '0.0';
  const url = await connectRpc();
  const result = formatEther(quantity(await rpc(url, 'eth_getBalance', [vault.address, 'latest'])));
  if (readVault()?.address !== vault.address) throw fail('钱包已变化，请重新刷新资产。', 'WALLET_CHANGED');
  return result;
}

// This reads a public chain address only. A watch entry never supplies a signer.
export async function getWatchBalance(address) {
  const checked = requireWatchWallet(address);
  const url = await connectRpc();
  return formatEther(quantity(await rpc(url, 'eth_getBalance', [checked, 'latest'])));
}

function taskTransferIntent(intent, transfer, from) {
  if (!intent || intent.chainId !== DEFAULT_CHAIN_ID || intent.chainId !== NETWORK.chainId || typeof intent.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(intent.id) || typeof intent.valueWei !== 'string' || !/^[1-9][0-9]{0,77}$/.test(intent.valueWei) || typeof intent.data !== 'string' || !/^0x(?:[0-9a-f]{2}){1,256}$/i.test(intent.data)) {
    throw fail('任务付款内容无效，请重新打开已验收的任务。', 'TASK_PAYMENT_INVALID');
  }
  let expectedFrom, expectedTo;
  try { expectedFrom = getAddress(intent.from); expectedTo = getAddress(intent.to); }
  catch { throw fail('任务付款地址无效。', 'TASK_PAYMENT_INVALID'); }
  const bytes = new Uint8Array(intent.data.slice(2).match(/../g).map(value => parseInt(value, 16)));
  let memo;
  try { memo = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { throw fail('任务付款授权摘要无效。', 'TASK_PAYMENT_INVALID'); }
  if (expectedFrom !== from || expectedTo !== transfer.to || BigInt(intent.valueWei) !== transfer.value || !new RegExp('^YBZ-TASK-PAYMENT:v1:' + intent.id.toLowerCase() + ':[a-f0-9]{64}$').test(memo)) {
    throw fail('任务付款与当前钱包、金额或授权内容不一致。', 'TASK_PAYMENT_MISMATCH');
  }
  return {intentId:intent.id, data:intent.data.toLowerCase()};
}

export async function prepareTransfer(to, amount, {taskIntent} = {}) {
  const vault = requireSession();
  requireNoPending(vault.address);
  prepared = null;
  const startEpoch = epoch;
  const transfer = validateTransfer(to, amount, vault.address);
  const task = taskIntent === undefined ? {data:'0x'} : taskTransferIntent(taskIntent, transfer, vault.address);
  const url = await connectRpc();
  const fees = await quote(url, vault.address, transfer.to, transfer.value, task.data);
  requireSameSession(startEpoch, vault.address, vault.encryptedJson);
  const id = globalThis.crypto.randomUUID();
  prepared = { id, kind:'transfer', ...transfer, ...task, ...fees, chainId:url.network.chainId, from: vault.address, expiresAt: Date.now() + PREVIEW_MS };
  return {
    id, to: transfer.to, amount: formatEther(transfer.value),
    gasFee: formatEther(fees.gasFee), total: formatEther(transfer.value + fees.gasFee),
    chainId: url.network.chainId, symbol: url.network.symbol, expiresAt: prepared.expiresAt,
    from:vault.address,data:task.data,gasLimit:fees.gasLimit.toString(),type:fees.feeFields.type,
    ...Object.fromEntries(Object.entries(fees.feeFields).filter(([key])=>key!=='type').map(([key,value])=>[key,value.toString()])),
    ...(task.intentId ? {intentId:task.intentId} : {}),
  };
}

function recordsKey(address,chainId=NETWORK.chainId) { return RECORD_PREFIX+chainId+'.'+address.toLowerCase(); }
function readRecords(address,chainId=NETWORK.chainId){
 const local=storage(),keys=[recordsKey(address,chainId)];if(chainId===DEFAULT_CHAIN_ID)keys.push(LEGACY_RECORD_PREFIX+address.toLowerCase());
 const rows=[];
 for(const key of keys){
  let records;
  try{records=JSON.parse(local.getItem(key)||'[]');if(!Array.isArray(records))throw Error();}
  catch{throw fail('本机交易记录无法读取，请保留原始数据后核对，暂不允许新交易。','RECORDS_INVALID');}
  for(const item of records)if(item?.chainId===chainId&&/^0x[0-9a-f]{64}$/i.test(item.hash)&&!rows.some(r=>r.hash.toLowerCase()===item.hash.toLowerCase()))rows.push(item);
 }
 // Never truncate a legacy unresolved payment behind a newer partition's rows.
 return rows;
}
function saveRecord(address,record,required=false){
 try{
  const chainId=record.chainId??NETWORK.chainId;if(!getChain(chainId))throw Error();
  const rows=readRecords(address,chainId),previous=rows.find(item=>item.hash.toLowerCase()===record.hash.toLowerCase());
  const merged=[{...previous,...record,chainId},...rows.filter(item=>item.hash.toLowerCase()!==record.hash.toLowerCase())];
  const next=merged.filter((item,index)=>index<100||['pending','unknown'].includes(item.status));
  const local=storage(),key=recordsKey(address,chainId),value=JSON.stringify(next);
  local.setItem(key,value);if(required&&local.getItem(key)!==value)throw Error();
 }catch{if(required)throw fail('本地存储不可用，交易尚未提交，请保留记录后重试。','STORAGE_UNAVAILABLE');}
}
export function getRecords({allChains=false}={}){
 const vault=readVault();
 return vault?(allChains?CHAIN_REGISTRY.flatMap(chain=>readRecords(vault.address,chain.chainId)):readRecords(vault.address)).sort((a,b)=>b.createdAt-a.createdAt):[];
}

export async function confirmTransfer(id, password, {beforeBroadcast} = {}) {
  return withWalletWrite(()=>confirmTransferLocked(id,password,{beforeBroadcast}));
}
async function confirmTransferLocked(id,password,{beforeBroadcast}={}) {
  if (confirming) throw fail('上一笔交易正在处理中，请稍候。', 'TRANSACTION_BUSY');
  const vault = requireSession();
  const tx = prepared;
  prepared = null; // A confirmation is single-use, including failed confirmations.
  if (!tx || tx.kind !== 'transfer' || tx.id !== id || tx.expiresAt <= Date.now() || tx.from !== vault.address || tx.chainId !== NETWORK.chainId) {
    throw fail('转账预览已过期，请重新核对金额和手续费。', 'PREVIEW_EXPIRED');
  }
  if (tx.intentId && typeof beforeBroadcast !== 'function') throw fail('任务付款需要先登记交易哈希，尚未签名或提交。', 'TASK_PAYMENT_REGISTRATION_REQUIRED');
  requireNoPending(vault.address);
  const startEpoch = epoch;
  confirming = true;
  try {
    const signer = await decrypt(vault, password);
    requireSameSession(startEpoch, vault.address, vault.encryptedJson);
    const url = await connectRpc();
    const fresh = await quote(url, vault.address, tx.to, tx.value, tx.data);
    if (fresh.nonce !== tx.nonce || !sameFeeFields(fresh.feeFields,tx.feeFields) || fresh.gasLimit !== tx.gasLimit) {
      throw fail('网络手续费或账户状态已变化，请重新预览后确认。', 'QUOTE_CHANGED');
    }
    if (tx.expiresAt <= Date.now()) throw fail('转账预览已过期，请重新核对。', 'PREVIEW_EXPIRED');
    await assertChain(url);
    requireSameSession(startEpoch, vault.address, vault.encryptedJson);
    if (signer.address !== tx.from) throw fail('钱包地址校验失败，已阻止交易。', 'SIGNER_MISMATCH');
    const signed = await signer.signTransaction({
      ...fresh.feeFields, chainId: tx.chainId, to: tx.to, value: tx.value,
      nonce: fresh.nonce, gasLimit: fresh.gasLimit, data: tx.data,
    });
    requireSameSession(startEpoch, vault.address, vault.encryptedJson);
    const hash = keccak256(signed);
    const record = {
      hash, from: tx.from, to: tx.to, amount: formatEther(tx.value), gasFee: formatEther(fresh.gasFee),
      createdAt: Date.now(), chainId: tx.chainId, symbol: getChain(tx.chainId).symbol, status: 'pending', nonce: fresh.nonce, kind: 'transfer',
      ...(tx.intentId ? {intentId:tx.intentId, data:tx.data, valueWei:tx.value.toString()} : {}),
    };
    // Store only public transaction details, never the signed transaction or secrets.
    saveRecord(vault.address, record, true);
    if (tx.intentId) {
      try {
        // Only public transaction facts leave the wallet. The signed payload,
        // password, key and decrypted signer are never exposed to this callback.
        await beforeBroadcast(Object.freeze({hash,intentId:tx.intentId,chainId:tx.chainId,from:tx.from,to:tx.to,valueWei:tx.value.toString(),data:tx.data,nonce:fresh.nonce}));
      } catch {
        saveRecord(vault.address, {...record,status:'unknown',broadcastUncertain:true,broadcastAttempted:false});
        const error = fail('付款登记未确认，未广播交易。请核对现有任务和交易哈希，不要重新签名。', 'TASK_PAYMENT_REGISTRATION_FAILED');
        error.hash=hash;error.intentId=tx.intentId;throw error;
      }
      requireSameSession(startEpoch, vault.address, vault.encryptedJson);
      if (tx.expiresAt <= Date.now()) throw fail('付款登记期间预览已过期，未广播；请核对现有交易哈希。', 'PREVIEW_EXPIRED');
    }
    let broadcastUncertain = false;
    try {
      const remoteHash = await rpc(url, 'eth_sendRawTransaction', [signed]);
      if (typeof remoteHash !== 'string' || remoteHash.toLowerCase() !== hash.toLowerCase()) broadcastUncertain = true;
    } catch {
      // A timeout may happen after acceptance. Do not retry or tell the user it failed.
      broadcastUncertain = true;
    }
    const result = { ...record, broadcastUncertain };
    saveRecord(vault.address, result);
    return result;
  } catch (error) {
    if (error.code && error.message && /^[\u3400-\u9fff]/.test(error.message)) throw error;
    throw fail('交易未提交，请重新核对后重试。', 'TRANSACTION_FAILED');
  } finally { confirming = false; }
}

async function quoteContract(url, from, action) {
 const input={from,to:action.to,data:action.data,value:'0x0'};
 const [balanceResult,feeFields,nonceResult,gasResult]=await Promise.all([
  rpc(url,'eth_getBalance',[from,'pending']),quoteFeeFields(url),rpc(url,'eth_getTransactionCount',[from,'pending']),rpc(url,'eth_estimateGas',[input]),rpc(url,'eth_call',[input,'pending'])
 ]);
 const balance=quantity(balanceResult),maxGasPrice=feeCap(feeFields),nonce=quantity(nonceResult),estimate=quantity(gasResult),gasLimit=(estimate*120n+99n)/100n;
 if(nonce>BigInt(Number.MAX_SAFE_INTEGER)||estimate<21000n||gasLimit>5000000n)throw fail('合约手续费数据异常，已阻止交易。','FEE_INVALID');
 const gasFee=maxGasPrice*gasLimit;if(balance<gasFee)throw fail(url.network.symbol+'不足以支付网络手续费。','BALANCE_INSUFFICIENT');
 return {feeFields,gasLimit,gasFee,nonce:Number(nonce)};
}

export async function prepareDistributionAction(action) {
 if(NETWORK.chainId!==DEFAULT_CHAIN_ID)throw fail('当前分发活动仅在原测试网络核验。','DISTRIBUTION_NETWORK_UNSUPPORTED');
 if(confirming)throw fail('上一笔交易正在处理中。','TRANSACTION_BUSY');
 const vault=requireSession();requireNoPending(vault.address);prepared=null;const startEpoch=epoch;
 const {loadDistributionSnapshot,buildEqualAction}=await import('./chain-preview-config.js');
 const snapshot=await loadDistributionSnapshot({address:vault.address});
 const call=buildEqualAction(snapshot,action,vault.address),url=await connectRpc(),fees=await quoteContract(url,vault.address,call);
 requireSameSession(startEpoch,vault.address,vault.encryptedJson);
 const id=globalThis.crypto.randomUUID();prepared={id,kind:'distribution',...call,...fees,chainId:url.network.chainId,from:vault.address,expiresAt:Date.now()+PREVIEW_MS};
 return {id,...call,from:vault.address,chainId:url.network.chainId,gasFee:formatEther(fees.gasFee),gasLimit:fees.gasLimit.toString(),type:fees.feeFields.type,...Object.fromEntries(Object.entries(fees.feeFields).filter(([key])=>key!=='type').map(([key,value])=>[key,value.toString()])),expiresAt:prepared.expiresAt};
}

export async function confirmDistributionAction(id,password) {
 return withWalletWrite(()=>confirmDistributionLocked(id,password));
}
async function confirmDistributionLocked(id,password) {
 if(NETWORK.chainId!==DEFAULT_CHAIN_ID)throw fail('当前分发活动仅在原测试网络核验。','DISTRIBUTION_NETWORK_UNSUPPORTED');
 if(confirming)throw fail('上一笔交易正在处理中。','TRANSACTION_BUSY');
 const vault=requireSession();requireNoPending(vault.address);const tx=prepared;prepared=null;
 if(!tx||tx.kind!=='distribution'||tx.id!==id||tx.expiresAt<=Date.now()||tx.from!==vault.address||tx.chainId!==NETWORK.chainId)throw fail('链上操作预览已过期，请重新核对。','PREVIEW_EXPIRED');
 const startEpoch=epoch;confirming=true;
 try {
  const signer=await decrypt(vault,password);requireSameSession(startEpoch,vault.address,vault.encryptedJson);
  const {loadDistributionSnapshot,buildEqualAction}=await import('./chain-preview-config.js');
  const snapshot=await loadDistributionSnapshot({address:vault.address});const action=buildEqualAction(snapshot,tx.action,vault.address);
  if(['to','data','distributionAddress','tokenAddress','campaignId','runtimeHash','tokenRuntimeHash','amount','recipient'].some(k=>action[k]!==tx[k]))throw fail('链上活动或操作内容已变化，请重新预览。','QUOTE_CHANGED');
  const url=await connectRpc(),fresh=await quoteContract(url,vault.address,action);
  if(fresh.nonce!==tx.nonce||!sameFeeFields(fresh.feeFields,tx.feeFields)||fresh.gasLimit!==tx.gasLimit)throw fail('手续费或账户状态已变化，请重新预览。','QUOTE_CHANGED');
  if(tx.expiresAt<=Date.now())throw fail('链上操作预览已过期。','PREVIEW_EXPIRED');
  await assertChain(url);requireSameSession(startEpoch,vault.address,vault.encryptedJson);
  const signed=await signer.signTransaction({...fresh.feeFields,chainId:tx.chainId,to:tx.to,data:tx.data,value:0n,nonce:fresh.nonce,gasLimit:fresh.gasLimit});
  requireSameSession(startEpoch,vault.address,vault.encryptedJson);const hash=keccak256(signed);
  const record={hash,from:tx.from,to:tx.to,amount:'0.0',gasFee:formatEther(fresh.gasFee),createdAt:Date.now(),chainId:tx.chainId,symbol:getChain(tx.chainId).symbol,status:'pending',nonce:fresh.nonce,kind:'distribution',action:tx.action,title:tx.title,distributionAddress:tx.distributionAddress,tokenAddress:tx.tokenAddress,tokenAmount:tx.amount,tokenSymbol:tx.symbol};
  saveRecord(vault.address,record,true);let broadcastUncertain=false;
  try{const remote=await rpc(url,'eth_sendRawTransaction',[signed]);broadcastUncertain=typeof remote!=='string'||remote.toLowerCase()!==hash.toLowerCase();}catch{broadcastUncertain=true;}
  const result={...record,broadcastUncertain};saveRecord(vault.address,result);return result;
 }catch(error){if(error.code&&/^[\u3400-\u9fff]/.test(error.message||''))throw error;throw fail('链上操作未提交，请重新核对。','TRANSACTION_FAILED');}
 finally{confirming=false;}
}

export async function getTransactionStatus(hash,options={}) {
  synchronize();const chainId=options.chainId??NETWORK.chainId;
  getEnabledChain(chainId);
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw fail('交易哈希无效。', 'HASH_INVALID');
  const vault = readVault();
  const previous = vault && readRecords(vault.address,chainId).find(item => item.hash.toLowerCase() === hash.toLowerCase());
  const url = await connectRpc({chainId});
  const receipt = await rpc(url, 'eth_getTransactionReceipt', [hash]);
  let result;
  if (!receipt) {
    const transaction = await rpc(url, 'eth_getTransactionByHash', [hash]);
    if (transaction && transaction.hash?.toLowerCase() !== hash.toLowerCase()) throw fail('交易查询数据异常。', 'RECEIPT_INVALID');
    result = {hash, status:transaction ? 'pending' : 'unknown', confirmations:0, blockNumber:null, blockHash:null, actualGasFee:null, broadcastUncertain:!transaction};
  } else {
    if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !['0x0', '0x1'].includes(receipt.status) || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash || '')) {
      throw fail('交易回执数据异常，请在区块浏览器中核对。', 'RECEIPT_INVALID');
    }
    const block = quantity(receipt.blockNumber);
    const [latestResult, canonical] = await Promise.all([rpc(url, 'eth_blockNumber'), rpc(url, 'eth_getBlockByNumber', [receipt.blockNumber, false])]);
    const latest = quantity(latestResult);
    if (block > BigInt(Number.MAX_SAFE_INTEGER) || latest > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('区块数据异常。', 'RECEIPT_INVALID');
    if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() || latest < block) {
      result = {hash,status:'unknown',confirmations:0,blockNumber:null,blockHash:null,actualGasFee:null,broadcastUncertain:true,reorg:true};
    } else {
      result = {hash,status:receipt.status === '0x1' ? 'confirmed' : 'failed',confirmations:Number(latest - block + 1n),blockNumber:Number(block),blockHash:receipt.blockHash,broadcastUncertain:false,reorg:false,actualGasFee:null};
      if (receipt.gasUsed !== undefined && receipt.effectiveGasPrice !== undefined) {
        result.actualGasFee = formatEther(quantity(receipt.gasUsed) * quantity(receipt.effectiveGasPrice));
      }
    }
  }
  result.chainId=chainId;
  // Never leave a stale success/fee after a missing receipt or chain reorganization.
  if (previous && readVault()?.address === vault.address) saveRecord(vault.address, result);
  return result;
}

export function exportEncryptedKeystore() {
  const vault = readVault();
  if (!vault) throw fail('请先创建或恢复钱包。', 'WALLET_MISSING');
  const content=vault.storageFormat==='aes-256-gcm'?(exportCache?.id===vault.id&&exportCache.fingerprint===vault.encryptedJson&&(session||exportCache.expiresAt>Date.now())?exportCache.encryptedJson:null):vault.encryptedJson;
  if(!content)throw fail('请先验证钱包密码后导出。','WALLET_LOCKED');
  return {
    filename: `ybz-evm-${vault.address}.json`,
    content, mimeType: 'application/json',
  };
}

// Lock other tabs when the encrypted vault changes. The UI also hides backup words.
globalThis.addEventListener?.('storage',event=>{
 if(event.key!==null&&event.key!==COLLECTION_KEY&&!legacyVaultLocations().some(([key])=>key===event.key))return;
 const previous=NETWORK.chainId;networkEpoch++;
 try{adoptSnapshot(readWalletCollection());}catch{selectionStamp=undefined;}
 lock();if(previous!==NETWORK.chainId)globalThis.dispatchEvent?.(new Event('ybz:wallet-network-changed'));
 announceSelection();
});

// Called after local backup acknowledgement. The permit is local-only and
// verifies that the same encrypted vault is still present before removing it.
export async function prepareLocalWalletDeletion(password,{expectedAddress}={}){
 const vault=readVault();if(!vault||vault.address!==expectedAddress)throw fail('本机钱包已变化，请重新核对。','WALLET_CHANGED');
 const snapshot=readWalletCollection();await verifyPassword(password);unchanged(snapshot);
 const local=storage(),legacySnapshots=new Map(legacyVaultLocations().map(([key])=>[key,local.getItem(key)]));
 const targetKeys=[...legacySnapshots].filter(([,raw])=>raw!==null&&getAddress(JSON.parse(raw).address)===vault.address).map(([key])=>key);
 const recordKeys=[...CHAIN_REGISTRY.map(chain=>recordsKey(vault.address,chain.chainId)),LEGACY_RECORD_PREFIX+vault.address.toLowerCase()];
 const wallets=snapshot.value.wallets.filter(item=>item.id!==vault.id),selectedId=wallets[0]?.id||null;
 let consumed=false,removalStarted=false,committedRaw=null;const removed=new Set();
 return {clear:async()=>withWalletWrite(()=>{
  if(consumed)throw fail('清理授权已经使用，请重新验证。','DELETION_PERMIT_USED');
  try{
   const currentLocal=storage(),currentRaw=currentLocal.getItem(COLLECTION_KEY);
   // A failed read-back after a successful write may be acknowledged on retry,
   // but a different revision or selection can never reuse this permit.
   if(committedRaw&&currentRaw===committedRaw){
    adoptSnapshot(readWalletCollection());lock();
    for(const key of recordKeys){currentLocal.removeItem(key);if(currentLocal.getItem(key)!==null)throw Error('Records remain');}
    consumed=true;announceSelection();return {cleared:true};
   }
   if(currentRaw!==snapshot.raw)throw fail('钱包已变化，未清理新钱包。','WALLET_CHANGED');
   for(const [key,raw]of legacySnapshots){const current=currentLocal.getItem(key);if(current!==raw&&!(removed.has(key)&&current===null))throw fail('钱包副本已变化，未清理新数据。','WALLET_CHANGED');}
   // Revoke signing first, retain unknown-payment records until this wallet is
   // no longer selectable. A partial cleanup must not enable a duplicate send.
   removalStarted=true;lock();
   for(const key of targetKeys){if(removed.has(key)&&currentLocal.getItem(key)===null)continue;removalStarted=true;currentLocal.removeItem(key);removed.add(key);if(currentLocal.getItem(key)!==null){removed.delete(key);throw Error('Vault remains');}}
   const current=readWalletCollection(),value=collectionWith(current,{wallets,selectedId});
   committedRaw=JSON.stringify(value);removalStarted=true;const saved=persistCollection(current,value);
   networkEpoch++;adoptSnapshot(saved);
   for(const key of recordKeys){currentLocal.removeItem(key);if(currentLocal.getItem(key)!==null)throw Error('Records remain');}
   consumed=true;lock();announceSelection();return {cleared:true};
  }catch(error){if(removalStarted)lock();if(error.code==='WALLET_CHANGED')throw error;throw fail('本机清理未完成，请保留离线备份并重试。','LOCAL_CLEANUP_FAILED');}
 })};
}
