'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
const asar = appBuilderRequire('@electron/asar');
const { getCurrentFuseWire, FuseV1Options } = appBuilderRequire('@electron/fuses');

function hash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function pe(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(0, 2).toString(), 'MZ', `${file} is a PE executable`);
  const offset = b.readUInt32LE(0x3c);
  assert.equal(b.readUInt32LE(offset), 0x4550);
  const magic = b.readUInt16LE(offset + 24);
  const directory = offset + 24 + (magic === 0x20b ? 112 : 96);
  return { machine: b.readUInt16LE(offset + 4), certificateBytes: b.readUInt32LE(directory + 4 * 8 + 4), bytes: b.length, sha256: hash(b) };
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist');
  const archive = path.join(dist, 'win-unpacked/resources/app.asar');
  const expected = JSON.parse(fs.readFileSync(path.join(root, 'web-assets-verification.json'), 'utf8'));
  const packaged = asar.listPackage(archive);
  assert.equal(packaged.some(p => /admin|releases|\.apk$|\.p12$|password\.txt|install\.html/i.test(p)), false);
  for (const [file, sha256] of Object.entries(expected.files)) assert.equal(hash(asar.extractFile(archive, `web/${file}`)), sha256, file);
  for (const file of ['main.cjs', 'preload.cjs', 'security.cjs', 'local-ai.cjs']) assert.deepEqual(asar.extractFile(archive, `src/${file}`), fs.readFileSync(path.join(root, 'src', file)), file);
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  assert.equal(pkg.version, '0.13.0'); assert.equal(pkg.productName, '愚笨者');
  const runtimePath = path.join(dist, 'win-unpacked/Yubenzhe.exe');
  const runtime = pe(runtimePath); assert.equal(runtime.machine, 0x8664);
  const fuses = await getCurrentFuseWire(runtimePath);
  assert.equal(fuses[FuseV1Options.RunAsNode], 48);
  assert.equal(fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable], 48);
  assert.equal(fuses[FuseV1Options.EnableNodeCliInspectArguments], 48);
  assert.equal(fuses[FuseV1Options.OnlyLoadAppFromAsar], 49);
  const files = {};
  for (const filename of ['yubenzhe-0.13.0-windows-x64-setup.exe', 'yubenzhe-0.13.0-windows-x64.zip']) {
    const bytes = fs.readFileSync(path.join(dist, filename));
    files[filename] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  const installer = pe(path.join(dist, 'yubenzhe-0.13.0-windows-x64-setup.exe'));
  assert.equal(installer.certificateBytes, 0, 'This private release has no Authenticode certificate');
  const result = {
    productName: '愚笨者', version: '0.13.0', platform: 'Windows x64',
    electronVersion: '44.7.0', electronBuilderVersion: '26.15.3',
    distribution: 'private-preview', storePublished: false, codeSigned: false,
    checks: { packagedAssetsMatchSource: true, packagedNativeBridgeMatchesSource: true, noAdminOrPrivateSigningMaterial: true, windowsRuntimePE64: true, securityFusesVerified: true, unitAndHostTests: 23, actualWindowsDeviceTested: false, installerRunOnWindows: false, actualLocalModelRunOnWindows: false },
    files, webAssets: expected.files,
  };
  fs.writeFileSync(path.join(root, 'release-verification.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), Object.entries(files).map(([name, info]) => `${info.sha256}  ${name}`).join('\n') + '\n');
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
