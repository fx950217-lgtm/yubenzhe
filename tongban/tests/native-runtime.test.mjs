import test from 'node:test';
import assert from 'node:assert/strict';
import { saveJsonFile, installAndroidControls, getNativePlatform, isNativeApp } from '../src/native-runtime.js';

const file = { filename: 'tongban-backup.json', content: '{"crypto":{"ciphertext":"encrypted-example"}}' };
function native(plugins) {
  globalThis.Capacitor = { getPlatform: () => 'android', isPluginAvailable: name => !!plugins[name], Plugins: plugins };
}
test.afterEach(() => { delete globalThis.Capacitor; delete globalThis.document; delete globalThis.YubenzheDesktop; delete globalThis.YubenzheNative; });

for (const platform of ['windows', 'ios']) {
  test(`${platform} bridge confirms save/cancel and locks on background`, async () => {
    let saved = false, listener, locks = 0;
    const save = async options => { assert.equal(options.filename, file.filename); return { saved }; };
    const subscribe = callback => { listener = callback; return () => {}; };
    if (platform === 'windows') globalThis.YubenzheDesktop = { platform, saveJson: save, onBackground: subscribe };
    else globalThis.YubenzheNative = { platform, saveJsonFile: save, onAppStateChange: subscribe };
    assert.equal(getNativePlatform(), platform); assert.equal(isNativeApp(), true);
    assert.deepEqual(await saveJsonFile(file), { saved: false, method: platform });
    saved = true; assert.deepEqual(await saveJsonFile(file), { saved: true, method: platform });
    globalThis.document = {documentElement:{classList:{add(){}}}};
    await installAndroidControls({ onBackground: () => locks++, onBack: () => false });
    if (platform === 'ios') { listener({isActive:true}); assert.equal(locks, 0); listener({isActive:false}); }
    else listener();
    assert.equal(locks, 1);
  });
  test(`${platform} incomplete export bridge never falls back to a browser download`, async () => {
    if (platform === 'windows') globalThis.YubenzheDesktop = {platform};
    else globalThis.YubenzheNative = {platform};
    await assert.rejects(saveJsonFile(file), /文件保存组件/);
  });
}

test('native export waits for the selected document to be saved and propagates cancellation', async () => {
  let finish, received;
  native({ SaveDocument: { save: options => { received=options; return new Promise(resolve => finish=resolve); } } });
  let done=false;
  const pending=saveJsonFile(file).then(value => { done=true;return value; });
  await Promise.resolve();assert.equal(done,false);assert.equal(received.content,file.content);
  finish({saved:false});assert.deepEqual(await pending,{saved:false,method:'android'});
  native({ SaveDocument: { save: async () => ({saved:true}) } });
  assert.deepEqual(await saveJsonFile(file),{saved:true,method:'android'});
});
test('native failures never silently use an unsupported browser download', async () => {
  globalThis.document={createElement(){assert.fail('Must not fall back to a blob download in Android');}};
  native({});await assert.rejects(saveJsonFile(file),/安卓组件/);
  native({SaveDocument:{save:async()=>{throw new Error('Storage full');}}});
  await assert.rejects(saveJsonFile(file),/Storage full/);
  native({SaveDocument:{save:async()=>({})}});await assert.rejects(saveJsonFile(file),/未能确认/);
});
test('exports reject path traversal, non-JSON and oversized UTF-8 before entering the bridge', async () => {
  native({SaveDocument:{save(){assert.fail('Invalid data reached native bridge');}}});
  for(const filename of ['../wallet.json','/wallet.json','wallet.txt','x\\wallet.json']) await assert.rejects(saveJsonFile({...file,filename}),/格式/);
  await assert.rejects(saveJsonFile({...file,mimeType:'text/html'}),/格式/);
  await assert.rejects(saveJsonFile({...file,content:'not json'}),SyntaxError);
  await assert.rejects(saveJsonFile({...file,content:JSON.stringify('好'.repeat(90000))}),/过大/);
});
test('native background locks and back minimizes only after the UI has no inner screen', async () => {
  const listeners={};let locks=0,minimized=0,inner=true;
  globalThis.document={documentElement:{classList:{add(){}}}};
  native({App:{addListener:async(name,callback)=>{listeners[name]=callback;},minimizeApp:async()=>{minimized++;}}});
  await installAndroidControls({onBackground:()=>locks++,onBack:()=>inner});
  listeners.appStateChange({isActive:true});assert.equal(locks,0);
  listeners.appStateChange({isActive:false});assert.equal(locks,1);
  await listeners.backButton();assert.equal(minimized,0);
  inner=false;await listeners.backButton();assert.equal(minimized,1);
});
test('failed native lifecycle initialization locks instead of leaving a signing session available', async () => {
  globalThis.document={documentElement:{classList:{add(){}}}};
  native({});let locks=0;const notices=[];
  await installAndroidControls({onBackground:()=>locks++,onBack:()=>false,onError:message=>notices.push(message)});
  assert.equal(locks,1);assert.match(notices[0],/钱包已锁定/);
});
