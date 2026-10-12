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
  assert.equal(pkg.version, '0.14.0-dev.8');
  assert.match(read('android/app/build.gradle'), /versionCode 17/);
  assert.match(read('android/app/build.gradle'), /versionName "0\.14\.0-dev\.8"/);
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
  assert.equal(config.android.useLegacyBridge, false);
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
test('bundled snapshot contains only nine application assets and matches consumer build', () => {
  const assets = ['app.css', 'app.js', 'apple-touch-icon.png', 'icon.png', 'icon.svg', 'index.html', 'manifest.webmanifest', 'privacy.html', 'terms.html'];
  assert.deepEqual(readdirSync(path.join(project, 'www')).sort(), [...assets, 'webview-unavailable.html'].sort());
  for (const asset of assets) assert.deepEqual(readFileSync(path.join(project, 'www', asset)), readFileSync(path.resolve(project, '../tongban/dist', asset)));
  const script = read('scripts/copy-web.mjs');
  assert.match(script, /nativePackage.version !== consumer.version/);
  assert.match(script, /WEB_ASSETS = \['index\.html', 'app\.js', 'app\.css', 'icon\.png', 'icon\.svg', 'manifest\.webmanifest', 'apple-touch-icon\.png', 'privacy\.html', 'terms\.html'\]/);
});
test('native document and navigation policy executes in JVM', () => {
  const javaHome = process.env.JAVA_HOME;
  assert.ok(javaHome, 'Set JAVA_HOME to JDK 21 before running native tests');
  const output = mkdtempSync(path.join(tmpdir(), 'tongban-native-test-'));
  const source = path.join(project, 'android/app/src/main/java/app/tongban/wallet/demo');
  try {
    execFileSync(path.join(javaHome, 'bin/javac'), ['-d', output, path.join(source, 'DeploymentConfig.java'), path.join(source, 'DocumentPolicy.java'), path.join(source, 'NavigationPolicy.java'), path.join(project, 'tests/NativePoliciesTest.java')]);
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
test('DApp navigation requires an actual main-frame click and opens the system browser', () => {
  const prefix = 'android/app/src/main/java/app/tongban/wallet/demo/';
  const client = read(prefix + 'SafeWebViewClient.java');
  const navigation = client.slice(client.indexOf('boolean shouldOverrideUrlLoading'), client.indexOf('WebResourceResponse shouldInterceptRequest'));
  assert.match(navigation, /request\.isForMainFrame\(\) && NavigationPolicy\.mayOpenExternal\(url, request\.hasGesture\(\)\)/);
  assert.match(navigation, /Intent\.ACTION_VIEW/);
  assert.match(navigation, /Intent\.CATEGORY_BROWSABLE/);
  assert.match(navigation, /startActivity\(intent\)/);
  assert.doesNotMatch(navigation, /loadUrl\(|new WebView|addJavascriptInterface/);
  const legacy = navigation.slice(navigation.indexOf('shouldOverrideUrlLoading(WebView view, String url)'));
  assert.doesNotMatch(legacy, /mayOpenExternal|startActivity/);
  assert.doesNotMatch(read(prefix + 'DeploymentConfig.java'), /app\.remix\.live/);
  assert.match(read(prefix + 'SafeChromeClient.java'), /boolean onCreateWindow[\s\S]*return false;/);
});


test('internal preview transport policy and memory-only session execute in JVM', () => {
 const javaHome=process.env.JAVA_HOME;assert.ok(javaHome,'JDK 21 is required');
 const output=mkdtempSync(path.join(tmpdir(),'ybz-preview-native-test-'));
 const source=path.join(project,'android/app/src/main/java/app/tongban/wallet/demo');
 try{
  execFileSync(path.join(javaHome,'bin/javac'),['-d',output,path.join(source,'DeploymentConfig.java'),path.join(source,'InternalPreviewPolicy.java'),path.join(source,'InternalPreviewSession.java'),path.join(source,'InternalPreviewHttps.java'),path.join(project,'tests/InternalPreviewSessionTest.java')]);
  const result=execFileSync(path.join(javaHome,'bin/java'),['-cp',output,'app.tongban.wallet.demo.InternalPreviewSessionTest'],{encoding:'utf8'});
  assert.match(result,/internal preview policy\/session assertions passed/);console.log(result.trim());
 }finally{rmSync(output,{recursive:true,force:true});}
});
test('native gate uses modern main-frame-only bridge and keeps transport secrets out of JS',()=>{
 const prefix='android/app/src/main/java/app/tongban/wallet/demo/';
 const activity=read(prefix+'MainActivity.java'),plugin=read(prefix+'InternalPreviewPlugin.java'),transport=read(prefix+'InternalPreviewHttps.java'),session=read(prefix+'InternalPreviewSession.java');
 assert.match(activity,/registerPlugin\(InternalPreviewPlugin.class\)/);
 assert.match(activity,/removeJavascriptInterface\("androidBridge"\)/);
 assert.match(activity,/getAllowedOriginRules\(\).size\(\) == 1/);
 assert.match(plugin,/hasSecureMainFrameBridge\(\)/);assert.match(plugin,/WEB_MESSAGE_LISTENER/);
 assert.match(transport,/setInstanceFollowRedirects\(false\)/);assert.match(transport,/MAX_RESPONSE_BYTES/);
 assert.doesNotMatch(transport,/setHostnameVerifier|setSSLSocketFactory|TrustAll/);
 assert.doesNotMatch(session,/SharedPreferences|FileOutputStream|CookieManager|System\.out|Log\./);
 assert.doesNotMatch(plugin,/put\("(?:cookie|password|set-cookie)"/i);
 assert.match(plugin,/bodyBase64/);assert.match(plugin,/session.clear\(\)/);
});

test('work artifacts use bounded UTF8 types and a system-selected destination, without broadening wallet backups',()=>{
 const javaHome=process.env.JAVA_HOME;assert.ok(javaHome,'JDK 21 required');const output=mkdtempSync(path.join(tmpdir(),'ybz-artifact-policy-'));
 const source=path.join(project,'android/app/src/main/java/app/tongban/wallet/demo');
 try{execFileSync(path.join(javaHome,'bin/javac'),['-encoding','UTF-8','-d',output,path.join(source,'ArtifactPolicy.java'),path.join(project,'tests/ArtifactPolicyTest.java')]);const result=execFileSync(path.join(javaHome,'bin/java'),['-cp',output,'app.tongban.wallet.demo.ArtifactPolicyTest'],{encoding:'utf8'});assert.match(result,/artifact export policy assertions passed/);console.log(result.trim());}finally{rmSync(output,{recursive:true,force:true});}
 const plugin=read('android/app/src/main/java/app/tongban/wallet/demo/SaveArtifactPlugin.java');
 assert.match(plugin,/ACTION_CREATE_DOCUMENT/);assert.match(plugin,/hasSecureMainFrameBridge/);assert.match(plugin,/"content"\.equals\(destination.getScheme\(\)\)/);assert.match(plugin,/put\("saved",false\)/);assert.match(plugin,/WRITE_FAILED/);assert.doesNotMatch(plugin,/ACTION_VIEW|FileOutputStream|getString\("path"\)|getString\("url"\)/);
 assert.match(read('android/app/src/main/java/app/tongban/wallet/demo/DocumentPolicy.java'),/256 \* 1024/);
});
