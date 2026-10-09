import { normalizePublicAddress } from './wallet-compatibility.js';

const WATCH_KEY = 'yubenzhe.wallet.watch.bsc-testnet.v1';
const MAX_WATCH_WALLETS = 20;
function fail(message, code) { const error = new Error(message); error.code = code; return error; }
function store() {
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* translated below */ }
  throw fail('观察地址无法保存，请检查本地存储权限。', 'STORAGE_UNAVAILABLE');
}
function labelText(label) {
  if (typeof label !== 'string' || Array.from(label.trim()).length > 40 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw fail('观察地址备注最多 40 个字，不能包含控制字符。', 'WATCH_LABEL_INVALID');
  }
  return label.trim();
}
export function listWatchWallets() {
  let raw;
  try { raw = store().getItem(WATCH_KEY); }
  catch { throw fail('无法读取观察地址，请检查本地存储权限。', 'STORAGE_UNAVAILABLE'); }
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.chainId !== 97 || !Array.isArray(value.addresses) || value.addresses.length > MAX_WATCH_WALLETS) throw new Error();
    const seen = new Set();
    return value.addresses.map(row => {
      const address = normalizePublicAddress(row.address), label = labelText(row.label);
      if (row.chainId !== 97 || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0 || seen.has(address)) throw new Error();
      seen.add(address);
      // Public address/label only; never pass unexpected stored properties to UI.
      return { address, label, chainId: 97, createdAt: row.createdAt };
    });
  } catch { throw fail('观察地址列表已损坏，未覆盖原有数据。', 'WATCH_STORE_INVALID'); }
}
function save(rows) {
  try { store().setItem(WATCH_KEY, JSON.stringify({ version: 1, chainId: 97, addresses: rows })); }
  catch { throw fail('观察地址未保存，请检查本地存储空间与权限。', 'STORAGE_UNAVAILABLE'); }
}
export function addWatchWallet(input, label = '') {
  const address = normalizePublicAddress(input), checkedLabel = labelText(label);
  const rows = listWatchWallets();
  const previous = rows.find(row => row.address === address);
  if (!previous && rows.length >= MAX_WATCH_WALLETS) throw fail('最多可保存 20 个观察地址，请先移除不需要的地址。', 'WATCH_LIMIT');
  const row = { address, label: checkedLabel, chainId: 97, createdAt: previous?.createdAt ?? Date.now() };
  save([row, ...rows.filter(item => item.address !== address)]);
  return row;
}
export function removeWatchWallet(input) {
  const address = normalizePublicAddress(input), rows = listWatchWallets();
  if (!rows.some(row => row.address === address)) return false;
  save(rows.filter(row => row.address !== address));
  return true;
}
export function requireWatchWallet(input) {
  const address = normalizePublicAddress(input);
  if (!listWatchWallets().some(row => row.address === address)) throw fail('请先添加要查看的观察地址。', 'WATCH_MISSING');
  return address;
}
