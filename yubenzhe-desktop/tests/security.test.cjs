'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CSP, isSocialApiUrl, isSocialAvatarUrl, isLocalUrl, localAsset, isExternalUrl, isAllowedRequest, validCameraRequest, validateJsonExport } = require('../src/security.cjs');

test('custom origin serves exactly packaged assets, never arbitrary filesystem or admin', () => {
  assert.deepEqual(localAsset('yubenzhe://app/app.js'), ['app.js', 'text/javascript; charset=utf-8']);
  for (const name of ['privacy.html', 'terms.html']) assert.deepEqual(localAsset('yubenzhe://app/' + name), [name, 'text/html; charset=utf-8']);
  assert.equal(localAsset('yubenzhe://app/sw.js'), null, 'push worker is not included in native clients');
  for (const url of ['file:///etc/passwd', 'yubenzhe://admin/app.js', 'yubenzhe://app/admin', 'yubenzhe://app/downloads/private.p12', 'yubenzhe://app/%2e%2e/%2fetc/passwd', 'yubenzhe://app/app.js?path=../secrets', 'yubenzhe://user:password@app/app.js', 'yubenzhe://app:3000/index.html']) assert.equal(localAsset(url), null, url);
});
test('HTTPS external links require exact allowlisted hostname', () => {
  for (const url of ['https://testnet.bscscan.com/tx/0x123', 'https://docs.ethers.org/v6/', 'https://docs.bnbchain.org/']) assert.equal(isExternalUrl(url), true);
  for (const url of ['http://testnet.bscscan.com/', 'https://testnet.bscscan.com.evil.example/', 'https://testnet.bscscan.com@evil.example/', 'https://evil.example@testnet.bscscan.com/', 'file:///tmp/app', 'javascript:alert(1)', 'https://bscscan.com/', 'https://docs.ethers.org:8443/']) assert.equal(isExternalUrl(url), false, url);
});
test('DApp opens only the exact Remix root and never becomes a renderer network target', () => {
  assert.equal(isExternalUrl('https://app.remix.live/'), true);
  for (const url of [null, {}, 'https://app.remix.live', 'https://app.remix.live/path', 'https://app.remix.live//', 'https://app.remix.live/./', 'https://app.remix.live/%2f', 'https://app.remix.live/?url=https://evil.example', 'https://app.remix.live/#wallet', 'https://app.remix.live:443/', 'https://app.remix.live:8443/', 'https://user:pass@app.remix.live/', 'https://app.remix.live@evil.example/', 'https://app.remix.live.evil.example/', 'https://APP.REMIX.LIVE/', 'http://app.remix.live/', 'javascript:alert(1)']) {
    assert.equal(isExternalUrl(url), false, String(url));
  }
  for (const type of ['mainFrame', 'subFrame', 'script', 'stylesheet', 'image', 'media', 'xhr', 'fetch', 'webSocket', 'other']) {
    assert.equal(isAllowedRequest('https://app.remix.live/', type), false, type);
    assert.equal(isAllowedRequest('https://testnet.bscscan.com/', type), false, type);
  }
  assert.doesNotMatch(CSP, /app\.remix\.live/);
  assert.match(CSP, /frame-src 'none'/);
});
test('public installation page opens in the system browser without granting the host other paths or embedded access',()=>{
  const origin=require('../src/deployment.cjs').previewOrigin,page=origin+'/install.html';
  assert.equal(isExternalUrl(page),true);
  for(const url of [origin,origin+'/',origin+'/downloads/app.exe',origin+'/api/social/me',origin+'/internal/',origin+'/x/../install.html',page+'?from=app',page+'#download',page+'/',origin.replace('https:','http:')+'/install.html',origin.replace('://','://user@')+'/install.html',origin+'.evil.test/install.html'])assert.equal(isExternalUrl(url),false,url);
  for(const type of ['mainFrame','subFrame','script','stylesheet','image','xhr','fetch'])assert.equal(isAllowedRequest(page,type),false,type);
  assert.equal(localAsset('yubenzhe://app/install.html'),null);
});
test('desktop external link IPC is reachable only from a real clicked anchor', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const sends = [], handlers = new Map(), exposed = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/preload.cjs'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { send: (...args) => sends.push(args) } };
    },
    document: { addEventListener: (name, callback) => handlers.set(name, callback) },
  });
  assert.equal(exposed.YubenzheDesktop.openExternal, undefined, 'page code has no arbitrary external-navigation method');
  const click = handlers.get('click');
  let prevented = 0;
  const event = (trusted, href) => ({ isTrusted: trusted, target: { closest: () => href ? { href } : null }, preventDefault: () => prevented++ });
  click(event(false, 'https://app.remix.live/'));
  click(event(true, 'javascript:alert(1)'));
  click(event(true));
  assert.equal(sends.length, 0);
  click(event(true, 'https://app.remix.live/'));
  assert.deepEqual(sends, [['yubenzhe:open-external', 'https://app.remix.live/']]);
  assert.equal(prevented, 1, 'real external link never navigates the embedded application');
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

test('social requests allow only the fixed HTTPS API prefix and never remote navigation or scripts', () => {
  for (const url of ['https://66.42.56.29/api/social/', 'https://66.42.56.29:443/api/social/me', 'https://66.42.56.29/api/social/conversations/1234-abc/messages?after=10']) {
    assert.equal(isSocialApiUrl(url), true, url); assert.equal(isAllowedRequest(url, 'xhr'), true); assert.equal(isAllowedRequest(url, 'fetch'), true);
    for (const type of ['mainFrame', 'subFrame', 'script', 'image', 'stylesheet']) assert.equal(isAllowedRequest(url, type), false, type);
    assert.equal(isExternalUrl(url), false); assert.equal(isLocalUrl(url), false);
  }
  for (const url of ['http://66.42.56.29/api/social/me', 'https://66.42.56.29:8443/api/social/me', 'https://user:pass@66.42.56.29/api/social/me', 'https://66.42.56.29.evil.test/api/social/me', 'https://66.42.56.29/admin', 'https://66.42.56.29/api/ai/jobs', 'https://66.42.56.29/api/social', 'https://66.42.56.29/api/socialevil/me', 'https://66.42.56.29/api/social/../admin', 'https://66.42.56.29/api/admin/../social/me', 'https://66.42.56.29/api/social/%2e%2e/admin', 'https://66.42.56.29/api/social/%2fadmin', 'https://66.42.56.29/api/social//me', 'https://66.42.56.29/api/social/me#fragment', 'https://66.42.56.29/api/social/%255cadmin']) {
    assert.equal(isSocialApiUrl(url), false, url); assert.equal(isAllowedRequest(url, 'xhr'), false, url);
  }
  const connect = CSP.split(';').find(rule => rule.trim().startsWith('connect-src')).trim().split(/\s+/);
  assert.deepEqual(connect, ['connect-src', "'self'", 'https://bsc-testnet-dataseed.bnbchain.org', 'https://bsc-testnet.bnbchain.org', 'https://66.42.56.29/api/social/']);
});

test('remote avatars use only an exact public UUID image route', () => {
  const avatar = 'https://66.42.56.29/api/social/avatars/6e9596a6-9481-4c35-acef-a0424051a4fb';
  assert.equal(isSocialAvatarUrl(avatar), true); assert.equal(isAllowedRequest(avatar, 'image'), true); assert.equal(isSocialApiUrl(avatar), false);
  for (const type of ['xhr', 'fetch', 'script', 'mainFrame', 'subFrame']) assert.equal(isAllowedRequest(avatar, type), false, type);
  assert.equal(isExternalUrl(avatar), false);
  for (const url of [avatar + '?v=1', avatar + '#fragment', avatar + '/', avatar.replace('https:', 'http:'), avatar.replace('66.42.56.29', '66.42.56.29:444'), avatar.replace('6e9596a6', 'not-uuid'), avatar.replace('66.42.56.29', 'user@66.42.56.29'), avatar.replace('/avatars/', '/avatars/%2e%2e/')]) {
    assert.equal(isSocialAvatarUrl(url), false, url); assert.equal(isAllowedRequest(url, 'image'), false, url);
  }
  const images = CSP.split(';').find(rule => rule.trim().startsWith('img-src')).trim().split(/\s+/);
  assert.deepEqual(images, ['img-src', "'self'", 'data:', 'blob:', 'https://66.42.56.29/api/social/avatars/']);
});

test('the real generated index can load its exact versioned JS and CSS in the local protocol',()=>{const fs=require('node:fs'),path=require('node:path'),version=require('../package.json').version;const html=fs.readFileSync(path.resolve(__dirname,'../web/index.html'),'utf8');const assets=[...html.matchAll(/(?:src|href)="(\.\/app\.(?:js|css)[^"]*)"/g)].map(m=>m[1]);assert.equal(assets.length,2);for(const asset of assets){const url=new URL(asset,'yubenzhe://app/index.html').href;assert.ok(localAsset(url),url);assert.equal(isAllowedRequest(url,asset.includes('.js')?'script':'stylesheet'),true);}for(const suffix of ['?path=x','?v='+version+'&file=x','?v=old','?v='+version+'#x']){const url='yubenzhe://app/app.js'+suffix;if(!suffix.includes('#'))assert.equal(localAsset(url),null,url);}assert.equal(localAsset('yubenzhe://app/privacy.html?v='+version),null);});
