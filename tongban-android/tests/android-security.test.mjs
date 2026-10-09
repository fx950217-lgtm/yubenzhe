import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(path.join(project, name), 'utf8');
test('fixed stable native versions, local bundled origin, debugging and cleartext off', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, '0.12.0');
  assert.match(read('android/app/build.gradle'), /versionCode 13/);
  assert.match(read('android/app/build.gradle'), /versionName "0\.12\.0"/);
  assert.equal(pkg.dependencies['@capacitor/core'], '8.5.3');
  assert.equal(pkg.dependencies['@capacitor/android'], '8.5.3');
  assert.equal(pkg.devDependencies['@capacitor/cli'], '8.5.3');
  const config = JSON.parse(read('capacitor.config.json'));
  assert.equal(config.appId, 'app.tongban.wallet.demo');
  assert.equal(config.server.url, undefined);
  assert.equal(config.server.androidScheme, 'https');
  assert.equal(config.server.cleartext, false);
  assert.equal(config.android.allowMixedContent, false);
  assert.equal(config.android.webContentsDebuggingEnabled, false);
  assert.equal(config.plugins.SystemBars.insetsHandling, 'css');
  assert.equal(config.android.minWebViewVersion, 105);
  assert.equal(config.server.errorPath, 'webview-unavailable.html');
});
test('manifest keeps minimum permissions, excludes backup/transfer, no broad file provider', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(permissions, ['android.permission.CAMERA', 'android.permission.INTERNET']);
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:fullBackupContent="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(read('android/app/src/main/res/xml/data_extraction_rules.xml'), /<device-transfer>[\s\S]*<exclude domain="root" path="\."/);
  assert.doesNotMatch(read('android/app/src/main/res/xml/file_paths.xml'), /<external-path|path="\."/);
  assert.match(read('android/app/build.gradle'), /release\s*\{\s*debuggable false/);
  const activity = read('android/app/src/main/java/app/tongban/wallet/demo/MainActivity.java');
  assert.match(activity, /FLAG_SECURE/);
  assert.match(activity, /setSupportMultipleWindows\(false\)/);
});
test('bundled snapshot contains only seven application assets and matches consumer build', () => {
  const assets = ['app.css', 'app.js', 'apple-touch-icon.png', 'icon.png', 'icon.svg', 'index.html', 'manifest.webmanifest'];
  assert.deepEqual(readdirSync(path.join(project, 'www')).sort(), [...assets, 'webview-unavailable.html'].sort());
  for (const asset of assets) assert.deepEqual(readFileSync(path.join(project, 'www', asset)), readFileSync(path.resolve(project, '../tongban/dist', asset)));
  const script = read('scripts/copy-web.mjs');
  assert.match(script, /WEB_ASSETS = \['index\.html', 'app\.js', 'app\.css', 'icon\.png', 'icon\.svg', 'manifest\.webmanifest', 'apple-touch-icon\.png'\]/);
});
test('native document and navigation policy executes in JVM', () => {
  const javaHome = process.env.JAVA_HOME;
  assert.ok(javaHome, 'Set JAVA_HOME to JDK 21 before running native tests');
  const output = mkdtempSync(path.join(tmpdir(), 'tongban-native-test-'));
  const source = path.join(project, 'android/app/src/main/java/app/tongban/wallet/demo');
  try {
    execFileSync(path.join(javaHome, 'bin/javac'), ['-d', output, path.join(source, 'DocumentPolicy.java'), path.join(source, 'NavigationPolicy.java'), path.join(project, 'tests/NativePoliciesTest.java')]);
    const result = execFileSync(path.join(javaHome, 'bin/java'), ['-cp', output, 'app.tongban.wallet.demo.NativePoliciesTest'], { encoding: 'utf8' });
    assert.match(result, /native policy assertions passed/);
    console.log(result.trim());
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('social API permission is limited to background requests, not navigation', () => {
  const client = read('android/app/src/main/java/app/tongban/wallet/demo/SafeWebViewClient.java');
  assert.match(client, /!request\.isForMainFrame\(\) && \(NavigationPolicy\.isTestnetRpc\(url\) \|\| NavigationPolicy\.isSocialApi\(url\) \|\| NavigationPolicy\.isSocialAvatar\(url\)\)/);
  const navigation = client.slice(client.indexOf('boolean shouldOverrideUrlLoading'), client.indexOf('WebResourceResponse shouldInterceptRequest'));
  assert.doesNotMatch(navigation, /isSocialApi|isSocialAvatar/);
});
