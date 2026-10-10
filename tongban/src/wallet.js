import { Wallet, getAddress, formatEther, parseEther, keccak256, toQuantity } from 'ethers';
import { walletFromMnemonic, walletFromPrivateKey, walletFromKeystore, normalizePublicAddress, validateExpectedAddress } from './wallet-compatibility.js';
import { requireWatchWallet } from './wallet-watchlist.js';
export { listWatchWallets, addWatchWallet, removeWatchWallet } from './wallet-watchlist.js';
export { DEFAULT_DERIVATION_PATH, MAX_KEYSTORE_BYTES, previewMnemonic, previewPrivateKey, previewKeystore } from './wallet-compatibility.js';

// This pilot is deliberately pinned to BSC testnet. There is no mainnet toggle.
export const NETWORK = Object.freeze({
  name: 'BSC 测试网', chainId: 97, symbol: 'tBNB',
  explorer: 'https://testnet.bscscan.com',
});
const RPC_URLS = Object.freeze([
  'https://bsc-testnet-dataseed.bnbchain.org',
  'https://bsc-testnet.bnbchain.org',
]);
const VAULT_KEY = 'tongban.wallet.bsc-testnet.v1';
const RECORD_PREFIX = 'tongban.transactions.bsc-testnet.v1.';
const AUTO_LOCK_MS = 5 * 60 * 1000;
const PREVIEW_MS = 2 * 60 * 1000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
let session = null;
let draft = null;
let prepared = null;
let lockTimer = null;
let epoch = 0;
let creating = false;
let confirming = false;
let requestId = 0;

function fail(message, code = 'WALLET_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function storage() {
  try {
    if (!globalThis.localStorage) throw new Error();
    return globalThis.localStorage;
  } catch {
    throw fail('浏览器无法使用本地存储，请关闭无痕模式后重试。', 'STORAGE_UNAVAILABLE');
  }
}

function readVault() {
  let raw;
  try { raw = storage().getItem(VAULT_KEY); }
  catch { throw fail('无法读取本地钱包，请检查浏览器存储权限。', 'STORAGE_UNAVAILABLE'); }
  if (!raw) return null;
  try {
    const vault = JSON.parse(raw);
    if (vault.version !== 1 || vault.chainId !== 97 || typeof vault.encryptedJson !== 'string') throw new Error();
    const address = getAddress(vault.address);
    const encrypted = JSON.parse(vault.encryptedJson);
    if (encrypted.version !== 3 || !encrypted.Crypto && !encrypted.crypto) throw new Error();
    if (getAddress(`0x${encrypted.address.replace(/^0x/, '')}`) !== address) throw new Error();
    return { ...vault, address };
  } catch {
    throw fail('本地钱包文件无法读取，请保留原始数据并使用助记词在可信钱包中恢复。', 'VAULT_INVALID');
  }
}

function persistVault(wallet, encryptedJson) {
  const vault = { version: 1, chainId: 97, address: wallet.address, encryptedJson };
  try { storage().setItem(VAULT_KEY, JSON.stringify(vault)); }
  catch { throw fail('钱包未保存：浏览器存储已满或被禁用，请保留助记词后重试。', 'STORAGE_UNAVAILABLE'); }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 256 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw fail('请设置 10–256 位密码，至少包含字母和数字。', 'PASSWORD_WEAK');
  }
}

function armLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lock, AUTO_LOCK_MS);
  // Do not hold a Node test process open; browsers return a numeric timer ID.
  lockTimer?.unref?.();
}

function requireSession() {
  const vault = readVault();
  if (!vault || !session || vault.address !== session.address) {
    lock();
    throw fail('请先解锁钱包。', 'WALLET_LOCKED');
  }
  armLock();
  return vault;
}

function requireSameSession(startEpoch, address, encryptedJson) {
  const current = readVault();
  if (epoch !== startEpoch || !session || session.address !== address || !current || current.encryptedJson !== encryptedJson) {
    throw fail('钱包已锁定或已发生变化，请重新解锁并确认。', 'SESSION_CHANGED');
  }
}

export function lock() {
  epoch += 1;
  session = null;
  draft = null;
  prepared = null;
  clearTimeout(lockTimer);
  lockTimer = null;
  globalThis.dispatchEvent?.(new Event('tongban:wallet-locked'));
}

export function getWalletState() {
  try {
    const vault = readVault();
    return { exists: Boolean(vault), address: vault?.address ?? null, unlocked: Boolean(vault && session?.address === vault.address) };
  } catch (error) {
    if (error.code === 'VAULT_INVALID') return { exists: true, address: null, unlocked: false, corrupt: true };
    throw error;
  }
}

export async function createWallet(password) {
  validatePassword(password);
  if (readVault()) throw fail('此设备已有钱包，请先解锁现有钱包。', 'WALLET_EXISTS');
  if (creating) throw fail('钱包正在创建，请稍候。', 'WALLET_BUSY');
  creating = true;
  draft = null;
  const startEpoch = epoch;
  try {
    const wallet = Wallet.createRandom();
    const encryptedJson = await wallet.encrypt(password);
    if (epoch !== startEpoch) throw fail('创建已取消，请重新开始。', 'CREATION_CANCELLED');
    draft = { wallet, encryptedJson };
    armLock();
    return { address: wallet.address, phrase: wallet.mnemonic.phrase };
  } catch (error) {
    if (error.code === 'CREATION_CANCELLED') throw error;
    throw fail('未能创建钱包，请使用支持安全随机数的现代浏览器。', 'CREATION_FAILED');
  } finally { creating = false; }
}

// The UI calls this only after the user has verified their backup words.
export function commitWallet() {
  if (!draft) throw fail('创建已过期，请重新创建并备份。', 'CREATION_EXPIRED');
  if (readVault()) throw fail('此设备已有钱包，未覆盖原有数据。', 'WALLET_EXISTS');
  persistVault(draft.wallet, draft.encryptedJson);
  session = draft.wallet;
  draft = null;
  armLock();
  return getWalletState();
}

export function cancelCreation() {
  epoch += 1;
  draft = null;
  if (!session) { clearTimeout(lockTimer); lockTimer = null; }
}

async function importWallet(factory, password, options = {}) {
  validatePassword(password);
  if (readVault()) throw fail('此设备已有钱包，未覆盖原有数据。', 'WALLET_EXISTS');
  if (creating) throw fail('钱包正在处理中，请稍候。', 'WALLET_BUSY');
  creating = true;
  draft = null;
  const startEpoch = epoch;
  try {
    const wallet = await factory();
    if (epoch !== startEpoch) throw fail('导入已取消，请重新开始。', 'CREATION_CANCELLED');
    validateExpectedAddress(wallet.address, options);
    const encryptedJson = await wallet.encrypt(password);
    if (epoch !== startEpoch) throw fail('导入已取消，请重新开始。', 'CREATION_CANCELLED');
    if (readVault()) throw fail('此设备已有钱包，未覆盖原有数据。', 'WALLET_EXISTS');
    persistVault(wallet, encryptedJson);
    session = wallet;
    armLock();
    return getWalletState();
  } catch (error) {
    if (error.code && /^[\u3400-\u9fff]/.test(error.message || '')) throw error;
    throw fail('钱包导入失败，请检查输入后重试。', 'RESTORE_FAILED');
  } finally { creating = false; }
}

// One selected EVM account is imported; this does not synchronize app profiles or
// discover every account belonging to a mnemonic. No raw secrets are persisted.
export function restoreWallet(phrase, password, options = {}) {
  return importWallet(() => walletFromMnemonic(phrase, options), password, options);
}

export function importPrivateKey(privateKey, password, options = {}) {
  return importWallet(() => walletFromPrivateKey(privateKey), password, options);
}

export function importKeystore(json, sourcePassword, password, options = {}) {
  return importWallet(() => walletFromKeystore(json, sourcePassword), password, options);
}

async function decrypt(vault, password) {
  if (typeof password !== 'string' || !password || password.length > 256) throw fail('请输入钱包密码。', 'PASSWORD_REQUIRED');
  try {
    const wallet = await Wallet.fromEncryptedJson(vault.encryptedJson, password);
    if (wallet.address !== vault.address) throw new Error();
    return wallet;
  } catch { throw fail('密码错误或钱包文件已损坏，请检查后重试。', 'UNLOCK_FAILED'); }
}

export async function unlock(password) {
  const vault = readVault();
  if (!vault) throw fail('请先创建或恢复钱包。', 'WALLET_MISSING');
  const startEpoch = epoch;
  const wallet = await decrypt(vault, password);
  if (epoch !== startEpoch || readVault()?.encryptedJson !== vault.encryptedJson) throw fail('解锁已取消，请重试。', 'SESSION_CHANGED');
  session = wallet;
  armLock();
  return getWalletState();
}

// Local credential check only. This does not unlock, authorize a platform payment,
// extend an existing session, or expose the decrypted wallet to callers.
export async function verifyPassword(password) {
  const vault = readVault();
  if (!vault) throw fail('请先创建或恢复钱包。', 'WALLET_MISSING');
  const startEpoch = epoch;
  const checked = await decrypt(vault, password);
  if (epoch !== startEpoch || readVault()?.encryptedJson !== vault.encryptedJson) {
    throw fail('密码验证已取消或钱包已发生变化，请重新验证。', 'SESSION_CHANGED');
  }
  return { verified: true, address: checked.address };
}

async function rpc(url, method, params = []) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const id = ++requestId;
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error();
    const body = await response.json();
    if (body.id !== id || body.error || !Object.hasOwn(body, 'result')) throw new Error();
    return body.result;
  } catch {
    // RPC responses are untrusted and can contain private input; never expose them.
    throw fail('测试网络暂时无法连接，请稍后重试。', 'RPC_UNAVAILABLE');
  } finally { clearTimeout(timeout); }
}

async function assertChain(url) {
  const chain = await rpc(url, 'eth_chainId');
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 97n) {
    throw fail('网络校验失败：仅支持 BSC 测试网（97），已阻止交易。', 'CHAIN_MISMATCH');
  }
}

async function connectRpc() {
  for (const url of RPC_URLS) {
    try { await assertChain(url); return url; }
    catch (error) { if (error.code === 'CHAIN_MISMATCH') throw error; }
  }
  throw fail('BSC 测试网暂时无法连接，请稍后重试。', 'RPC_UNAVAILABLE');
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

async function quote(url, from, to, value) {
  const [code, balanceResult, gasPriceResult, nonceResult, gasResult] = await Promise.all([
    rpc(url, 'eth_getCode', [to, 'latest']),
    rpc(url, 'eth_getBalance', [from, 'pending']),
    rpc(url, 'eth_gasPrice'),
    rpc(url, 'eth_getTransactionCount', [from, 'pending']),
    rpc(url, 'eth_estimateGas', [{ from, to, value: toQuantity(value), data: '0x' }]),
  ]);
  if (code !== '0x' && code !== '0x0') throw fail('首版仅支持向普通钱包地址转账，暂不支持合约收款。', 'CONTRACT_UNSUPPORTED');
  const balance = quantity(balanceResult);
  const gasPrice = quantity(gasPriceResult);
  const nonceValue = quantity(nonceResult);
  const gasLimit = quantity(gasResult);
  if (nonceValue > BigInt(Number.MAX_SAFE_INTEGER) || gasLimit < 21000n || gasLimit > 100000n || gasPrice <= 0n || gasPrice > parseEther('0.000001')) {
    throw fail('网络手续费数据异常，已阻止交易。', 'FEE_INVALID');
  }
  const gasFee = gasPrice * gasLimit;
  if (balance < value + gasFee) throw fail('测试 BNB 数量不足，需要同时支付转账金额与网络手续费。', 'BALANCE_INSUFFICIENT');
  return { gasPrice, gasLimit, gasFee, nonce: Number(nonceValue) };
}

export async function getBalance() {
  const vault = readVault();
  if (!vault) return '0.0';
  const url = await connectRpc();
  return formatEther(quantity(await rpc(url, 'eth_getBalance', [vault.address, 'latest'])));
}

// This reads a public chain address only. A watch entry never supplies a signer.
export async function getWatchBalance(address) {
  const checked = requireWatchWallet(address);
  const url = await connectRpc();
  return formatEther(quantity(await rpc(url, 'eth_getBalance', [checked, 'latest'])));
}

export async function prepareTransfer(to, amount) {
  const vault = requireSession();
  prepared = null;
  const startEpoch = epoch;
  const transfer = validateTransfer(to, amount, vault.address);
  const url = await connectRpc();
  const fees = await quote(url, vault.address, transfer.to, transfer.value);
  requireSameSession(startEpoch, vault.address, vault.encryptedJson);
  const id = globalThis.crypto.randomUUID();
  prepared = { id, ...transfer, ...fees, from: vault.address, expiresAt: Date.now() + PREVIEW_MS };
  return {
    id, to: transfer.to, amount: formatEther(transfer.value),
    gasFee: formatEther(fees.gasFee), total: formatEther(transfer.value + fees.gasFee),
    chainId: 97, symbol: NETWORK.symbol, expiresAt: prepared.expiresAt,
  };
}

function recordsKey(address) { return `${RECORD_PREFIX}${address.toLowerCase()}`; }

function readRecords(address) {
  try {
    const records = JSON.parse(storage().getItem(recordsKey(address)) || '[]');
    return Array.isArray(records) ? records.filter(item => item?.chainId === 97 && /^0x[0-9a-f]{64}$/i.test(item.hash)).slice(0, 100) : [];
  } catch { return []; }
}

function saveRecord(address, record, required = false) {
  try {
    const rows = readRecords(address);
    const previous = rows.find(item => item.hash === record.hash);
    const next = [{ ...previous, ...record }, ...rows.filter(item => item.hash !== record.hash)].slice(0, 100);
    storage().setItem(recordsKey(address), JSON.stringify(next));
  } catch {
    if (required) throw fail('本地存储不可用，交易尚未提交，请清理存储后重试。', 'STORAGE_UNAVAILABLE');
  }
}

export function getRecords() {
  const vault = readVault();
  return vault ? readRecords(vault.address).sort((a, b) => b.createdAt - a.createdAt) : [];
}

export async function confirmTransfer(id, password) {
  if (confirming) throw fail('上一笔交易正在处理中，请稍候。', 'TRANSACTION_BUSY');
  const vault = requireSession();
  const tx = prepared;
  prepared = null; // A confirmation is single-use, including failed confirmations.
  if (!tx || tx.id !== id || tx.expiresAt <= Date.now() || tx.from !== vault.address) {
    throw fail('转账预览已过期，请重新核对金额和手续费。', 'PREVIEW_EXPIRED');
  }
  const startEpoch = epoch;
  confirming = true;
  try {
    const signer = await decrypt(vault, password);
    requireSameSession(startEpoch, vault.address, vault.encryptedJson);
    const url = await connectRpc();
    const fresh = await quote(url, vault.address, tx.to, tx.value);
    if (fresh.nonce !== tx.nonce || fresh.gasPrice !== tx.gasPrice || fresh.gasLimit !== tx.gasLimit) {
      throw fail('网络手续费或账户状态已变化，请重新预览后确认。', 'QUOTE_CHANGED');
    }
    if (tx.expiresAt <= Date.now()) throw fail('转账预览已过期，请重新核对。', 'PREVIEW_EXPIRED');
    await assertChain(url);
    requireSameSession(startEpoch, vault.address, vault.encryptedJson);
    if (signer.address !== tx.from) throw fail('钱包地址校验失败，已阻止交易。', 'SIGNER_MISMATCH');
    const signed = await signer.signTransaction({
      type: 0, chainId: 97, to: tx.to, value: tx.value,
      nonce: fresh.nonce, gasPrice: fresh.gasPrice, gasLimit: fresh.gasLimit, data: '0x',
    });
    requireSameSession(startEpoch, vault.address, vault.encryptedJson);
    const hash = keccak256(signed);
    const record = {
      hash, from: tx.from, to: tx.to, amount: formatEther(tx.value), gasFee: formatEther(fresh.gasFee),
      createdAt: Date.now(), chainId: 97, symbol: NETWORK.symbol, status: 'pending',
    };
    // Store only public transaction details, never the signed transaction or secrets.
    saveRecord(vault.address, record, true);
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

export async function getTransactionStatus(hash) {
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw fail('交易哈希无效。', 'HASH_INVALID');
  const url = await connectRpc();
  const receipt = await rpc(url, 'eth_getTransactionReceipt', [hash]);
  if (!receipt) return { hash, status: 'pending', confirmations: 0 };
  if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !['0x0', '0x1'].includes(receipt.status)) {
    throw fail('交易回执数据异常，请在区块浏览器中核对。', 'RECEIPT_INVALID');
  }
  const block = quantity(receipt.blockNumber);
  const latest = quantity(await rpc(url, 'eth_blockNumber'));
  const result = {
    hash, status: receipt.status === '0x1' ? 'confirmed' : 'failed',
    confirmations: Number(latest >= block ? latest - block + 1n : 0n), blockNumber: Number(block),
  };
  if (receipt.gasUsed !== undefined && receipt.effectiveGasPrice !== undefined) {
    result.actualGasFee = formatEther(quantity(receipt.gasUsed) * quantity(receipt.effectiveGasPrice));
  }
  const vault = readVault();
  if (vault && readRecords(vault.address).some(item => item.hash.toLowerCase() === hash.toLowerCase())) {
    saveRecord(vault.address, { ...result, broadcastUncertain: false });
  }
  return result;
}

export function exportEncryptedKeystore() {
  const vault = readVault();
  if (!vault) throw fail('请先创建或恢复钱包。', 'WALLET_MISSING');
  return {
    filename: `tongban-bsc-testnet-${vault.address}.json`,
    content: vault.encryptedJson, mimeType: 'application/json',
  };
}

// Lock other tabs when the encrypted vault changes. The UI also hides backup words.
globalThis.addEventListener?.('storage', event => { if (event.key === VAULT_KEY) lock(); });

// Called after local backup acknowledgement. The permit is local-only and
// verifies that the same encrypted vault is still present before removing it.
export async function prepareLocalWalletDeletion(password,{expectedAddress}={}){
 const vault=readVault();if(!vault||vault.address!==expectedAddress)throw fail('本机钱包已变化，请重新核对。','WALLET_CHANGED');
 await verifyPassword(password);let consumed=false,removalStarted=false;
 return {clear:async()=>{
  if(consumed)throw fail('清理授权已经使用，请重新验证。','DELETION_PERMIT_USED');
  try{
   const current=readVault();
   if(current&&(current.address!==vault.address||current.encryptedJson!==vault.encryptedJson)||!current&&!removalStarted)throw fail('钱包已变化，未清理新钱包。','WALLET_CHANGED');
   if(current){const local=storage(),key=recordsKey(vault.address);local.removeItem(key);if(local.getItem(key)!==null)throw Error('Records remain');removalStarted=true;local.removeItem(VAULT_KEY);if(local.getItem(VAULT_KEY)!==null)throw Error('Vault remains');}
   consumed=true;lock();return {cleared:true};
  }catch(error){if(error.code==='WALLET_CHANGED')throw error;if(removalStarted)lock();throw fail('本机清理未完成，请保留离线备份并重试。','LOCAL_CLEANUP_FAILED');}
 }};
}
