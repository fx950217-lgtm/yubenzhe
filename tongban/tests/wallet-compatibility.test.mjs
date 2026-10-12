import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, HDNodeWallet, Mnemonic, encryptKeystoreJson, getAddress, pbkdf2, keccak256, concat, getBytes } from 'ethers';
import { createCipheriv } from 'node:crypto';
import * as wallet from '../src/wallet.js';
import { validateKeystore } from '../src/wallet-compatibility.js';

// All keys below are public test vectors. Never fund these addresses.
const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const hardhat = 'test test test test test test test test test test test junk';
const privateKey = '0x' + '0'.repeat(63) + '1';
const keyAddress = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const password = 'synthetic-import-34989';
const oldPassword = 'synthetic-backup-42850';
const vaultKey = 'tongban.wallet.bsc-testnet.v1';
const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
let requests = [];
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body); requests.push(request);
  if (!['eth_chainId', 'eth_getBalance'].includes(request.method)) throw new Error('Signing or broadcasting forbidden');
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x61' : '0xde0b6b3a7640000' }) };
};
function reset() { wallet.lock(); memory.clear(); requests = []; }

function pbkdfFixture() {
  const salt = 'ab'.repeat(32), iv = 'cd'.repeat(16);
  const key = getBytes(pbkdf2(new TextEncoder().encode(oldPassword), '0x' + salt, 2, 32, 'sha256'));
  const cipher = createCipheriv('aes-128-ctr', key.slice(0, 16), getBytes('0x' + iv));
  const ciphertext = Buffer.concat([cipher.update(getBytes(privateKey)), cipher.final()]);
  return JSON.stringify({ version: 3, address: keyAddress.slice(2).toLowerCase(), crypto: {
    cipher: 'aes-128-ctr', cipherparams: { iv }, ciphertext: Buffer.from(ciphertext).toString('hex'),
    mac: keccak256(concat([key.slice(16, 32), ciphertext])).slice(2),
    kdf: 'pbkdf2', kdfparams: { salt, c: 2, dklen: 32, prf: 'hmac-sha256' },
  } });
}

test('BIP39/BIP44 address compatibility, explicit account paths and passphrases', () => {
  reset();
  assert.deepEqual(wallet.previewMnemonic(hardhat), { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', path: "m/44'/60'/0'/0/0", hasPassphrase: false });
  assert.equal(wallet.previewMnemonic(hardhat, { path: "m/44'/60'/0'/0/1" }).address, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
  // Published BIP39 vector with passphrase TREZOR, plus its EVM child address.
  assert.equal(Mnemonic.fromPhrase(phrase, 'TREZOR').computeSeed(), '0xc55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04');
  assert.equal(wallet.previewMnemonic(phrase, { passphrase: 'TREZOR' }).address, '0x9c32F71D4DB8Fb9e1A58B0a80dF79935e7256FA6');
  assert.notEqual(wallet.previewMnemonic(phrase, { passphrase: ' TREZOR' }).address, wallet.previewMnemonic(phrase, { passphrase: 'TREZOR' }).address);
  assert.notEqual(wallet.previewMnemonic(phrase, { passphrase: 'trezor' }).address, wallet.previewMnemonic(phrase, { passphrase: 'TREZOR' }).address);
  assert.equal(wallet.previewMnemonic(phrase, { passphrase: '\u00e9' }).address, wallet.previewMnemonic(phrase, { passphrase: 'e\u0301' }).address);
  assert.equal(wallet.previewMnemonic('  '+phrase.toUpperCase().replaceAll(' ', '  ')+'  ').address, wallet.previewMnemonic(phrase).address);
  assert.equal(memory.size, 0); assert.equal(requests.length, 0);
});

test('malformed secrets, wrong checksums, non-EVM paths and mismatched address fail without persistence', async () => {
  reset();
  for (const value of ['0x' + '0'.repeat(64), '0x' + 'f'.repeat(64), phrase, '1234', null]) assert.throws(() => wallet.previewPrivateKey(value), { code: 'PRIVATE_KEY_INVALID' });
  assert.deepEqual(wallet.previewPrivateKey(privateKey.slice(2)), { address: keyAddress });
  for (const path of ['m', "m/44'/0'/0'/0/0", "m/44'/60'/2147483648'/0/0", "m/44'/60'/01'/0/0", "m/44'/60'/0'/0/0/", null]) assert.throws(() => wallet.previewMnemonic(phrase, { path }), { code: 'PATH_INVALID' });
  assert.throws(() => wallet.previewMnemonic(Array(12).fill('abandon').join(' ')), { code: 'PHRASE_INVALID' });
  await assert.rejects(wallet.importPrivateKey(privateKey, password, { expectedAddress: '0x1111111111111111111111111111111111111111' }), { code: 'ADDRESS_MISMATCH' });
  await assert.rejects(wallet.restoreWallet(phrase, password, { expectedAddress: keyAddress }), { code: 'ADDRESS_MISMATCH' });
  assert.equal(memory.size, 0); assert.equal(requests.length, 0);
});

test('private-key import, encrypted V3 export and re-import preserve only the selected account', async () => {
  reset();
  const result = await wallet.importPrivateKey(privateKey, password, { expectedAddress: keyAddress });
  assert.equal(result.address, keyAddress); assert.equal(result.unlocked, true);
  const backup = wallet.exportEncryptedKeystore().content;
  assert.equal(JSON.parse(backup).version, 3);
  const raw = memory.get('ybz.wallet.collection.v3');
  assert.equal(JSON.parse(raw).wallets[0].envelope.cipher, 'aes-256-gcm');
  assert.equal(raw.includes(privateKey.slice(2)), false); assert.equal(raw.includes(password), false);
  assert.equal((await Wallet.fromEncryptedJson(backup, password)).address, keyAddress);
  wallet.lock(); assert.equal((await wallet.unlock(password)).address, keyAddress);
  await assert.rejects(wallet.importPrivateKey(privateKey, password), { code: 'WALLET_EXISTS' });
  reset();
  assert.deepEqual(await wallet.previewKeystore(backup, password), { address: keyAddress });
  await wallet.importKeystore(backup, password, oldPassword, { expectedAddress: keyAddress });
  wallet.lock();
  await assert.rejects(wallet.unlock(password), { code: 'UNLOCK_FAILED' });
  assert.equal((await wallet.unlock(oldPassword)).address, keyAddress);
  assert.equal(requests.length, 0);
});

test('BIP39 passphrase and non-default account survive encrypted storage and unlock', async () => {
  reset();
  const options = { passphrase: 'TREZOR', path: "m/44'/60'/2'/0/1" };
  const expectedAddress = HDNodeWallet.fromPhrase(phrase, options.passphrase, options.path).address;
  assert.equal((await wallet.restoreWallet(phrase, password, { ...options, expectedAddress })).address, expectedAddress);
  const raw = memory.get('ybz.wallet.collection.v3');
  assert.equal(raw.includes(phrase), false); assert.equal(raw.includes('TREZOR'), false);
  wallet.lock(); assert.equal((await wallet.unlock(password)).address, expectedAddress);
  assert.equal((await Wallet.fromEncryptedJson(wallet.exportEncryptedKeystore().content, password)).address, expectedAddress);
});

test('scrypt and PBKDF2 V3 imports are validated before expensive decryption', async () => {
  reset();
  const fixture = pbkdfFixture();
  assert.equal((await wallet.previewKeystore(fixture, oldPassword)).address, keyAddress);
  await wallet.importKeystore(fixture, oldPassword, password);
  assert.equal(wallet.getWalletState().address, keyAddress);
  reset();
  await assert.rejects(wallet.importKeystore(fixture, 'bad', password), { code: 'KEYSTORE_DECRYPT_FAILED' });
  assert.equal(memory.size, 0);
  const bad = JSON.parse(fixture); bad.crypto.kdfparams.c = 2000001;
  assert.throws(() => validateKeystore(JSON.stringify(bad)), { code: 'KEYSTORE_KDF_LIMIT' });
  const scrypt = JSON.parse(await encryptKeystoreJson({ address: keyAddress, privateKey }, oldPassword, { scrypt: { N: 1024, r: 8, p: 1 } }));
  assert.equal((await wallet.previewKeystore(JSON.stringify(scrypt), oldPassword)).address, keyAddress);
  scrypt.Crypto.kdfparams.n = 2 ** 30;
  assert.throws(() => validateKeystore(JSON.stringify(scrypt)), { code: 'KEYSTORE_KDF_LIMIT' });
  assert.throws(() => validateKeystore(' '.repeat(1024 * 1024 + 1)), { code: 'KEYSTORE_INVALID' });
  assert.throws(() => validateKeystore('{'), { code: 'KEYSTORE_INVALID' });
  assert.throws(() => validateKeystore('{"version":4}'), { code: 'KEYSTORE_UNSUPPORTED' });
  const aliases = JSON.parse(fixture);
  aliases.Crypto = { ...aliases.crypto, kdfparams: { C: 99999999999, ...aliases.crypto.kdfparams } };
  aliases.crypto.kdfparams.c = 99999999999;
  aliases['x-ethers'] = { version: '0.1', mnemonicCiphertext: 'bad' };
  assert.equal((await wallet.previewKeystore(JSON.stringify(aliases), oldPassword)).address, keyAddress);
  const normalized = JSON.parse(validateKeystore(JSON.stringify(aliases)));
  assert.deepEqual(Object.keys(normalized).sort(), ['address', 'crypto', 'version']);
  assert.equal(normalized.crypto.kdfparams.c, 2); assert.equal(normalized.crypto.kdfparams.C, undefined);
  const mixedAddress = JSON.parse(fixture); mixedAddress.address = '0X' + keyAddress.slice(2).toUpperCase();
  assert.equal((await wallet.previewKeystore(JSON.stringify(mixedAddress), oldPassword)).address, keyAddress);
  const tampered = JSON.parse(fixture); tampered.address = '11'.repeat(20);
  await assert.rejects(wallet.previewKeystore(JSON.stringify(tampered), oldPassword), { code: 'KEYSTORE_DECRYPT_FAILED' });
});

test('cancelled or concurrent imports never persist late results or overwrite another vault', async () => {
  reset();
  const pending = wallet.importPrivateKey(privateKey, password);
  await assert.rejects(wallet.restoreWallet(phrase, password), { code: 'WALLET_BUSY' });
  wallet.cancelCreation();
  await assert.rejects(pending, { code: 'CREATION_CANCELLED' });
  assert.equal(memory.size, 0);
  const importBackup = wallet.importKeystore(pbkdfFixture(), oldPassword, password);
  wallet.lock();
  await assert.rejects(importBackup, { code: 'CREATION_CANCELLED' });
  assert.equal(memory.size, 0);
  const late = wallet.importPrivateKey(privateKey, password);
  const otherWallet = HDNodeWallet.fromPhrase(hardhat);
  const encryptedJson = await encryptKeystoreJson({ address: otherWallet.address, privateKey: otherWallet.privateKey }, password, { scrypt: { N: 1024, r: 8, p: 1 } });
  memory.set(vaultKey, JSON.stringify({ version: 1, chainId: 97, address: otherWallet.address, encryptedJson }));
  await assert.rejects(late, { code: 'WALLET_EXISTS' });
  assert.equal(wallet.getWalletState().address, otherWallet.address);
});

test('watch addresses remain separate and can only query the pinned testnet', async () => {
  reset();
  assert.deepEqual(wallet.listWatchWallets(), []);
  assert.throws(() => wallet.addWatchWallet(privateKey), { code: 'ADDRESS_INVALID' });
  wallet.addWatchWallet(keyAddress, '冷钱包');
  wallet.addWatchWallet(keyAddress.toLowerCase(), '只读地址');
  assert.equal(wallet.listWatchWallets().length, 1); assert.equal(wallet.listWatchWallets()[0].label, '只读地址');
  assert.deepEqual(wallet.getWalletState(), { exists: false, address: null, unlocked: false });
  assert.equal(await wallet.getWatchBalance(keyAddress), '1.0');
  assert.deepEqual(requests.map(row => row.method), ['eth_chainId', 'eth_getBalance']);
  assert.equal(requests[1].params[0], keyAddress);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => ({ ok: true, json: async () => ({ id: JSON.parse(options.body).id, result: '0x38' }) });
  await assert.rejects(wallet.getWatchBalance(keyAddress), { code: 'CHAIN_MISMATCH' });
  globalThis.fetch = originalFetch;
  await assert.rejects(wallet.prepareTransfer('0x1111111111111111111111111111111111111111', '1'), { code: 'WALLET_LOCKED' });
  assert.throws(() => wallet.exportEncryptedKeystore(), { code: 'WALLET_MISSING' });
  assert.throws(() => wallet.addWatchWallet(keyAddress, '字'.repeat(41)), { code: 'WATCH_LABEL_INVALID' });
  for (let i = 1; i < 20; i++) wallet.addWatchWallet(getAddress('0x' + i.toString(16).padStart(40, '0')));
  assert.throws(() => wallet.addWatchWallet('0x1111111111111111111111111111111111111111'), { code: 'WATCH_LIMIT' });
  assert.equal(wallet.removeWatchWallet(keyAddress), true); assert.equal(wallet.removeWatchWallet(keyAddress), false);
  await assert.rejects(wallet.getWatchBalance(keyAddress), { code: 'WATCH_MISSING' });
});

test('storage failures and malformed watch data are explicit instead of false successes', async () => {
  reset();
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: original.getItem, setItem() { throw new Error('quota'); } };
  assert.throws(() => wallet.addWatchWallet(keyAddress), { code: 'STORAGE_UNAVAILABLE' });
  await assert.rejects(wallet.importPrivateKey(privateKey, password), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(wallet.getWalletState().exists, false);
  globalThis.localStorage = original;
  memory.set('yubenzhe.wallet.watch.bsc-testnet.v1', '{}');
  assert.throws(() => wallet.listWatchWallets(), { code: 'WATCH_STORE_INVALID' });
  assert.throws(() => wallet.addWatchWallet(keyAddress), { code: 'WATCH_STORE_INVALID' });
  reset();
});
