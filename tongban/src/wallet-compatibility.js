import { HDNodeWallet, Wallet, getAddress } from 'ethers';

export const DEFAULT_DERIVATION_PATH = "m/44'/60'/0'/0/0";
export const MAX_KEYSTORE_BYTES = 1024 * 1024;

function invalid(message, code) { const error = new Error(message); error.code = code; return error; }

export function normalizePublicAddress(address) {
  let checked;
  try { checked = getAddress(typeof address === 'string' ? address.trim() : ''); }
  catch { throw invalid('请输入完整有效的 0x 钱包地址。', 'ADDRESS_INVALID'); }
  if (checked === '0x0000000000000000000000000000000000000000') throw invalid('不能使用零地址。', 'ADDRESS_ZERO');
  return checked;
}

export function validateExpectedAddress(actual, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw invalid('钱包导入参数无效。', 'IMPORT_OPTIONS_INVALID');
  if (options.expectedAddress !== undefined && normalizePublicAddress(options.expectedAddress) !== actual) {
    throw invalid('导入地址与核对地址不同，请检查助记词附加口令、派生路径或密钥文件。', 'ADDRESS_MISMATCH');
  }
}

function derivationOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw invalid('钱包导入参数无效。', 'IMPORT_OPTIONS_INVALID');
  const { passphrase = '', path = DEFAULT_DERIVATION_PATH } = options;
  if (typeof passphrase !== 'string' || passphrase.length > 1024) throw invalid('助记词附加口令最多 1024 个字符。', 'PASSPHRASE_INVALID');
  if (typeof path !== 'string' || path.length > 120 || !/^m\/44'\/60'(?:\/(?:0|[1-9][0-9]*)'?){1,8}$/.test(path)
      || path.split('/').slice(1).some(part => Number(part.replace("'", '')) >= 2 ** 31)) {
    throw invalid("请输入完整的 EVM 派生路径，例如 m/44'/60'/0'/0/0。", 'PATH_INVALID');
  }
  // BIP-39 normalizes the passphrase using NFKD. Its case and spaces are significant.
  return { passphrase: passphrase.normalize('NFKD'), path };
}

export function walletFromMnemonic(phrase, options = {}) {
  const { passphrase, path } = derivationOptions(options);
  if (typeof phrase !== 'string' || phrase.length > 400) throw invalid('请输入有效的英文 BIP39 助记词。', 'PHRASE_INVALID');
  const normalized = phrase.normalize('NFKD').trim().toLowerCase().replace(/\s+/g, ' ');
  if (![12, 15, 18, 21, 24].includes(normalized.split(' ').length)) throw invalid('助记词必须为 12、15、18、21 或 24 个英文单词。', 'PHRASE_INVALID');
  let wallet;
  try { wallet = HDNodeWallet.fromPhrase(normalized, passphrase, path); }
  catch { throw invalid('助记词无效，请检查单词、顺序和校验。', 'PHRASE_INVALID'); }
  validateExpectedAddress(wallet.address, options);
  return wallet;
}

export function previewMnemonic(phrase, options = {}) {
  const wallet = walletFromMnemonic(phrase, options);
  return { address: wallet.address, path: wallet.path, hasPassphrase: Boolean(wallet.mnemonic.password) };
}

export function walletFromPrivateKey(privateKey) {
  if (typeof privateKey !== 'string' || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(privateKey.trim())) {
    throw invalid('私钥应为 64 位十六进制字符，可带 0x 前缀。', 'PRIVATE_KEY_INVALID');
  }
  try { return new Wallet('0x' + privateKey.trim().replace(/^0x/, '')); }
  catch { throw invalid('私钥无效，请检查后重试。', 'PRIVATE_KEY_INVALID'); }
}

export function previewPrivateKey(privateKey) { return { address: walletFromPrivateKey(privateKey).address }; }

export function validateKeystore(json) {
  if (typeof json !== 'string' || json.length > MAX_KEYSTORE_BYTES || new TextEncoder().encode(json).length > MAX_KEYSTORE_BYTES) {
    throw invalid('请选择不超过 1 MB 的 Web3 V3 JSON 密钥库。', 'KEYSTORE_INVALID');
  }
  let data;
  try { data = JSON.parse(json); } catch { throw invalid('密钥库不是有效的 JSON 文件。', 'KEYSTORE_INVALID'); }
  const cipher = data?.Crypto ?? data?.crypto;
  if (data?.version !== 3 || !cipher || cipher.cipher !== 'aes-128-ctr' || !/^[0-9a-f]{64}$/i.test(cipher.ciphertext)
      || !/^[0-9a-f]{64}$/i.test(cipher.mac) || !/^[0-9a-f]{32}$/i.test(cipher.cipherparams?.iv)) {
    throw invalid('仅支持 AES-128-CTR 的 Web3 V3 JSON 密钥库。', 'KEYSTORE_UNSUPPORTED');
  }
  if (data.address !== undefined) normalizePublicAddress('0x' + String(data.address).replace(/^0x/i, '').toLowerCase());
  const kdf = cipher.kdfparams;
  const positive = value => Number.isSafeInteger(value) && value > 0;
  if (!kdf || kdf.dklen !== 32 || typeof kdf.salt !== 'string' || !/^(?:[0-9a-f]{2}){1,64}$/i.test(kdf.salt)) {
    throw invalid('密钥库的加密参数无效。', 'KEYSTORE_INVALID');
  }
  // Bound untrusted KDF parameters before decryption, including mobile memory use.
  // Original files are left intact; supported imports are always re-encrypted locally.
  if (cipher.kdf === 'scrypt') {
    if (!positive(kdf.n) || !positive(kdf.r) || !positive(kdf.p) || (BigInt(kdf.n) & BigInt(kdf.n - 1)) !== 0n
        || kdf.n > 262144 || kdf.r > 32 || kdf.p > 16 || kdf.n * kdf.r > 2097152 || kdf.n * kdf.r * kdf.p > 8388608) {
      throw invalid('密钥库加密参数超过此设备的安全处理上限，请在原钱包中重新导出兼容备份。', 'KEYSTORE_KDF_LIMIT');
    }
  } else if (cipher.kdf === 'pbkdf2') {
    if (!positive(kdf.c) || kdf.c > 2000000 || !['hmac-sha256', 'hmac-sha512'].includes(kdf.prf)) {
      throw invalid('密钥库加密参数超过此设备的安全处理上限。', 'KEYSTORE_KDF_LIMIT');
    }
  } else { throw invalid('仅支持 scrypt 或 PBKDF2 加密的密钥库。', 'KEYSTORE_UNSUPPORTED'); }
  // ethers accepts case-insensitive property names. Rebuild only the validated
  // V3 fields so duplicate aliases or untrusted extension metadata cannot select
  // a different KDF at decryption time. The imported backup restores one key.
  const normalized = { version: 3, crypto: {
    cipher: 'aes-128-ctr', cipherparams: { iv: cipher.cipherparams.iv },
    ciphertext: cipher.ciphertext, mac: cipher.mac, kdf: cipher.kdf,
    kdfparams: cipher.kdf === 'scrypt'
      ? { salt: kdf.salt, dklen: 32, n: kdf.n, r: kdf.r, p: kdf.p }
      : { salt: kdf.salt, dklen: 32, c: kdf.c, prf: kdf.prf },
  } };
  if (data.address !== undefined) normalized.address = normalizePublicAddress('0x' + String(data.address).replace(/^0x/i, '').toLowerCase()).slice(2).toLowerCase();
  return JSON.stringify(normalized);
}

export async function walletFromKeystore(json, password) {
  const checkedJson = validateKeystore(json);
  if (typeof password !== 'string' || password.length > 1024) throw invalid('请输入原密钥库的密码。', 'KEYSTORE_PASSWORD_REQUIRED');
  try { return await Wallet.fromEncryptedJson(checkedJson, password); }
  catch { throw invalid('密钥库密码错误或文件已损坏，请检查原密码与文件。', 'KEYSTORE_DECRYPT_FAILED'); }
}

export async function previewKeystore(json, password) { return { address: (await walletFromKeystore(json, password)).address }; }
