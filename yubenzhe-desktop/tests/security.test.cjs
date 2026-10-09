'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isLocalUrl, localAsset, isExternalUrl, isAllowedRequest, validCameraRequest, validateJsonExport } = require('../src/security.cjs');

test('custom origin serves exactly packaged assets, never arbitrary filesystem or admin', () => {
  assert.deepEqual(localAsset('yubenzhe://app/app.js'), ['app.js', 'text/javascript; charset=utf-8']);
  for (const url of ['file:///etc/passwd', 'yubenzhe://admin/app.js', 'yubenzhe://app/admin', 'yubenzhe://app/downloads/private.p12', 'yubenzhe://app/%2e%2e/%2fetc/passwd', 'yubenzhe://app/app.js?path=../secrets', 'yubenzhe://user:password@app/app.js', 'yubenzhe://app:3000/index.html']) assert.equal(localAsset(url), null, url);
});
test('HTTPS external links require exact allowlisted hostname', () => {
  for (const url of ['https://testnet.bscscan.com/tx/0x123', 'https://docs.ethers.org/v6/', 'https://docs.bnbchain.org/']) assert.equal(isExternalUrl(url), true);
  for (const url of ['http://testnet.bscscan.com/', 'https://testnet.bscscan.com.evil.example/', 'https://testnet.bscscan.com@evil.example/', 'https://evil.example@testnet.bscscan.com/', 'file:///tmp/app', 'javascript:alert(1)', 'https://bscscan.com/', 'https://docs.ethers.org:8443/']) assert.equal(isExternalUrl(url), false, url);
});
test('only the BSC testnet RPC can receive app connections', () => {
  assert.equal(isAllowedRequest('https://bsc-testnet.bnbchain.org', 'xhr'), true);
  assert.equal(isAllowedRequest('https://bsc-testnet-dataseed.bnbchain.org', 'fetch'), true);
  for (const url of ['https://bsc-dataseed.bnbchain.org', 'http://bsc-testnet.bnbchain.org', 'https://evil.example', 'https://bsc-testnet.bnbchain.org:3000']) assert.equal(isAllowedRequest(url, 'xhr'), false);
  assert.equal(isAllowedRequest('https://bsc-testnet.bnbchain.org/script.js', 'script'), false);
  assert.equal(isAllowedRequest('data:image/png;base64,abcd', 'image'), true);
  assert.equal(isAllowedRequest('data:text/javascript,alert(1)', 'script'), false);
});
test('camera permissions reject microphones and unspecified media', () => {
  assert.equal(validCameraRequest('media', { mediaTypes: ['video'] }), true);
  for (const mediaTypes of [[], ['audio'], ['video', 'audio'], undefined]) assert.equal(validCameraRequest('media', { mediaTypes }), false);
  for (const permission of ['geolocation', 'notifications', 'clipboard-read', 'display-capture', 'fileSystem']) assert.equal(validCameraRequest(permission, { mediaTypes: ['video'] }), false);
});
test('exports accept bounded JSON objects and safe filenames only', () => {
  const valid = { filename: 'wallet-encrypted.json', mimeType: 'application/json', content: '{"version":1}' };
  assert.deepEqual(validateJsonExport(valid), { filename: valid.filename, content: valid.content });
  for (const filename of ['../secret.json', 'a/b.json', 'C:\\secrets.json', '.hidden.json', 'backup.exe', 'x.json.exe', 'x'.repeat(130) + '.json']) assert.throws(() => validateJsonExport({ ...valid, filename }));
  for (const content of ['null', 'true', '[]', '{bad}', JSON.stringify({ value: '中'.repeat(100000) })]) assert.throws(() => validateJsonExport({ ...valid, content }));
  assert.throws(() => validateJsonExport({ ...valid, mimeType: 'text/html' }));
});
