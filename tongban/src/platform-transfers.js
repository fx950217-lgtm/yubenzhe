import { getAddress, parseUnits, formatUnits } from 'ethers';
import { getWalletState, verifyPassword } from './wallet.js';

// Local requests only. No custody service, blockchain calls, balances, payments,
// token contracts or fees are implemented by this module.
const PREFIX = 'tongban.platform-transfer-drafts.bsc-testnet.v1.';
const NETWORK = 'BSC Testnet';
const STATUS = 'service_not_connected';
const DECIMALS = Object.freeze({ tBNB: 18, USDT: 6 });
const MAX_DRAFTS = 50;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function currentAddress(required = false) {
  const state = getWalletState();
  if (state.corrupt || state.exists && !state.address) {
    throw fail('本地钱包无法读取，请先恢复钱包数据。', 'VAULT_INVALID');
  }
  if (!state.exists) {
    if (required) throw fail('请先创建或恢复钱包，再保存转入或转出草稿。', 'WALLET_MISSING');
    return null;
  }
  try { return getAddress(state.address); }
  catch { throw fail('当前钱包地址无效，请先检查钱包数据。', 'VAULT_INVALID'); }
}

function storage() {
  try {
    if (!globalThis.localStorage) throw new Error();
    return globalThis.localStorage;
  } catch { throw fail('浏览器存储不可用，未保存草稿。', 'STORAGE_UNAVAILABLE'); }
}

function validateAmount(value, asset) {
  if (!Object.hasOwn(DECIMALS, asset)) throw fail('仅支持 BSC 测试网 tBNB 和 USDT 转入转出草稿。', 'ASSET_UNSUPPORTED');
  const digits = DECIMALS[asset];
  if (typeof value !== 'string' || value.length > 80 || !new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`).test(value.trim())) {
    throw fail(`请输入有效金额，${asset} 最多支持 ${digits} 位小数。`, 'AMOUNT_INVALID');
  }
  try {
    const units = parseUnits(value.trim(), digits);
    if (units <= 0n || units >= 2n ** 256n) throw new Error();
    return formatUnits(units, digits);
  } catch { throw fail('金额必须大于 0 且在有效范围内。', 'AMOUNT_INVALID'); }
}

function withdrawalAddress(value) {
  let address;
  try { address = getAddress(typeof value === 'string' ? value.trim() : ''); }
  catch { throw fail('请输入完整有效的 BSC 0x 收款地址，并自行核对目标网络。', 'ADDRESS_INVALID'); }
  if (address === ZERO_ADDRESS) throw fail('不能使用零地址作为收款地址。', 'ADDRESS_ZERO');
  // EVM address syntax cannot prove which chain the recipient intends to use.
  return address;
}

function record(direction, asset, amount, address, walletAddress, id, createdAt) {
  return {
    id, direction, asset, amount, address,
    addressRole: direction === 'deposit' ? 'source' : 'destination',
    source: direction === 'deposit' ? walletAddress : '平台余额',
    destination: direction === 'deposit' ? '平台余额' : address,
    walletAddress, network: NETWORK, chainId: 97, status: STATUS, createdAt,
  };
}

function readDrafts(walletAddress) {
  let raw;
  try { raw = storage().getItem(`${PREFIX}${walletAddress.toLowerCase()}`); }
  catch { throw fail('无法读取本机转账草稿，请检查浏览器存储权限。', 'STORAGE_UNAVAILABLE'); }
  if (raw === null) return [];
  let rows;
  try { rows = JSON.parse(raw); if (!Array.isArray(rows)) throw new Error(); }
  catch { throw fail('本机草稿记录无法读取，原始数据未被覆盖。', 'DRAFTS_INVALID'); }
  // Browser storage is editable and is not financial evidence or authorization.
  // Rebuild the limited draft shape; never accept a forged completed status.
  return rows.flatMap(item => {
    try {
      if (!item || item.status !== STATUS || item.network !== NETWORK || item.chainId !== 97 || item.walletAddress !== walletAddress ||
          !['deposit', 'withdraw'].includes(item.direction) || typeof item.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) ||
          !Number.isSafeInteger(item.createdAt) || item.createdAt < 0) return [];
      const amount = validateAmount(item.amount, item.asset);
      const address = item.direction === 'deposit' ? walletAddress : withdrawalAddress(item.address);
      return [record(item.direction, item.asset, amount, address, walletAddress, item.id, item.createdAt)];
    } catch { return []; }
  }).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_DRAFTS);
}

export function getPlatformTransferDrafts() {
  const walletAddress = currentAddress();
  return walletAddress ? readDrafts(walletAddress) : [];
}

export async function createTransferDraft({ direction, asset, amount, address, password } = {}) {
  const walletAddress = currentAddress(true);
  if (!['deposit', 'withdraw'].includes(direction)) throw fail('请选择转入或转出。', 'DIRECTION_INVALID');
  const normalizedAmount = validateAmount(amount, asset);
  let normalizedAddress = walletAddress;
  if (direction === 'withdraw') normalizedAddress = withdrawalAddress(address);
  else if (address !== undefined && address !== null && address !== '') {
    if (withdrawalAddress(address) !== walletAddress) {
      throw fail('平台尚未配置收款地址；转入草稿只能关联当前钱包作为资金来源。', 'DEPOSIT_ADDRESS_UNAVAILABLE');
    }
  }
  try {
    const verification = await verifyPassword(password);
    if (!verification.verified || verification.address !== walletAddress || currentAddress(true) !== walletAddress) {
      throw fail('钱包已发生变化，请重新验证密码。', 'SESSION_CHANGED');
    }
    const draft = record(direction, asset, normalizedAmount, normalizedAddress, walletAddress, globalThis.crypto.randomUUID(), Date.now());
    const rows = [draft, ...readDrafts(walletAddress)].slice(0, MAX_DRAFTS);
    try { storage().setItem(`${PREFIX}${walletAddress.toLowerCase()}`, JSON.stringify(rows)); }
    catch { throw fail('草稿未保存，请检查浏览器存储空间与权限。', 'STORAGE_UNAVAILABLE'); }
    return draft;
  } finally { password = ''; }
}
