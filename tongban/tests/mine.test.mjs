import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PHOTO_512 } from './helpers/profile-fixtures.mjs';
import { getLocalProfile, PROFILE_AVATARS } from '../src/profile-store.js';

const { version: packageVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const source = (await readFile(new URL('../src/mine.js', import.meta.url), 'utf8'))
  .replace("import './mine.css';", '')
  .replace("from './profile-store.js'", `from '${new URL('../src/profile-store.js', import.meta.url).href}'`)
  .replace("from './profile-photo.js'", `from '${new URL('../src/profile-photo.js', import.meta.url).href}'`);
const { mountMine } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Minimal event surface: tests exercise the component's public event flows and real
// profile storage, rather than adding a browser DOM dependency to the application.
function harness({ wallet = { exists: false }, drafts = 3, raw = null, failWrite = false, isNative = false, profileService = null, processPhoto = undefined, themeService = undefined } = {}) {
  const data = new Map(raw === null ? [] : [['tongban.profile.v1', raw]]);
  const events = new Map(), calls = [], messages = [], attrs = new Map(), scrolls = [], reads = { wallet: 0, drafts: 0 };
  globalThis.window = {
    scrollY: 0,
    scrollTo(options) { scrolls.push(options); this.scrollY = options.top; },
    addEventListener() {}, removeEventListener() {},
  };
  const preview = { textContent: '', innerHTML: '' }, photoStatus = { textContent: '' }, removePhoto = { disabled: true }, save = { disabled: false };
  const password = { value: '', required: false }, passwordSection = { hidden: true, querySelector: () => password };
  let writesFail = false;
  const avatarNodes = PROFILE_AVATARS.map((_, index) => ({ dataset: { mineAvatar: String(index) }, setAttribute(name, value) { attrs.set(`${index}:${name}`, value); } }));
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { if (writesFail) throw new Error('QuotaExceededError'); data.set(key, value); },
  };
  const container = {
    innerHTML: '',
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: (name, callback) => { if (events.get(name) === callback) events.delete(name); },
    contains: node => node.owner === container,
    querySelector: selector => selector === 'h2' ? { focus() {} } : selector === '[data-mine-preview]' ? preview : selector === '[data-mine-photo-status]' ? photoStatus : selector === '[data-mine-remove-photo]' ? removePhoto : selector === '[data-mine-save]' ? save : selector === '[data-mine-id-password]' ? passwordSection : null,
    querySelectorAll: selector => selector === '[data-mine-avatar]' ? avatarNodes : [],
  };
  const cleanup = mountMine(container, {
    isNative, profileService, processPhoto, themeService,
    toast: message => messages.push(message),
    onNavigate: (...args) => calls.push(['navigate', ...args]),
    onAction: name => calls.push(['action', name]),
    getWalletStatus: () => { reads.wallet++; if (wallet instanceof Error) throw wallet; return wallet; },
    getDraftCount: () => { reads.drafts++; if (drafts instanceof Error) throw drafts; return drafts; },
  });
  writesFail = failWrite;
  function click(name, extra = {}) {
    const node = { owner: container, dataset: { mineAction: name, ...extra }, disabled: false };
    events.get('click')?.({ target: { closest: () => node } });
  }
  function submit(nickname, bio, userId = undefined, currentPassword = '') {
    const error = { textContent: '' };
    const form = { owner: container, elements: { nickname: { value: nickname }, bio: { value: bio }, userId: userId === undefined ? undefined : { value: userId }, currentPassword: { value: currentPassword } }, querySelector: () => error };
    form.closest = () => form;
    const pending = events.get('submit')?.({ target: form, preventDefault() {} });
    return { form, error, pending };
  }
  function photo(file) {
    const input = { owner: container, matches: () => true, files: [file], value: 'chosen' };
    return events.get('change')?.({ target: input });
  }
  return { container, calls, messages, data, reads, click, submit, cleanup, events, preview, attrs, scrolls, photo, photoStatus, removePhoto, save, password, passwordSection };
}

test('installation lives in web settings and nested settings back returns through the correct parent', () => {
  const web = harness();
  assert.doesNotMatch(web.container.innerHTML, /data-mine-action="install"/);
  web.click('settings');assert.match(web.container.innerHTML,/data-mine-view="settings"/);
  assert.match(web.container.innerHTML, /data-mine-action="install"/);
  assert.doesNotMatch(web.container.innerHTML,/data-mine-action="account-settings"/);
  web.click('install');assert.deepEqual(web.calls,[['action','install']]);web.cleanup();
  const native = harness({isNative:true});native.click('settings');
  assert.doesNotMatch(native.container.innerHTML,/data-mine-action="install"/);
  native.click('install');assert.deepEqual(native.calls,[]);
  native.click('security');assert.match(native.container.innerHTML,/aria-label="返回设置"/);
  assert.equal(native.cleanup.back(),true);assert.match(native.container.innerHTML,/data-mine-view="settings"/);
  assert.equal(native.cleanup.back(),true);
  assert.match(native.container.innerHTML,/data-mine-view="home"/);
  assert.equal(native.cleanup.back(),false);native.cleanup();
});

test('personal center keeps identity and the approved direct destinations without reading wallet or drafts', () => {
  const app = harness();
  assert.match(app.container.innerHTML, /本机资料/);
  assert.match(app.container.innerHTML, /data-mine-action="account"/);
  for(const entry of ['favorites','moments','appearance','security','devices'])assert.ok(app.container.innerHTML.includes('data-mine-action="'+entry+'"'));
  assert.doesNotMatch(app.container.innerHTML, /data-mine-action="(?:wallet|drafts|ai|points|bill-center|account-settings|install)"/);
  assert.doesNotMatch(app.container.innerHTML, /3 份|草稿|钱包已创建|尚未创建钱包/);
  app.click('favorites');assert.deepEqual(app.calls,[['navigate','discover',{route:'favorites',origin:'mine'}]]);
  assert.deepEqual(app.reads,{wallet:0,drafts:0});app.cleanup();
});

test('successful profile save persists selected allowlisted avatar, escapes text and updates root once', () => {
  const app = harness();
  app.click('edit'); app.click('avatar', { mineAvatar: '2' });
  assert.equal(app.preview.textContent, PROFILE_AVATARS[2]);
  assert.equal(app.attrs.get('2:aria-pressed'), 'true');
  const result = app.submit('<b>阿青</b>', '<img src=x onerror=1>');
  assert.equal(result.error.textContent, '');
  assert.equal(getLocalProfile().avatar, PROFILE_AVATARS[2]);
  assert.equal(getLocalProfile().nickname, '<b>阿青</b>');
  assert.match(app.container.innerHTML, /&lt;b&gt;阿青&lt;\/b&gt;/);
  assert.doesNotMatch(app.container.innerHTML, /<b>阿青|<img src=x/);
  // The compact home shows the name; the saved signature is displayed in the
  // profile editor. Verify escaping at both actual rendering locations.
  app.click('edit');
  assert.match(app.container.innerHTML, /name="nickname"[^>]*value="&lt;b&gt;阿青&lt;\/b&gt;"/);
  assert.match(app.container.innerHTML, /<textarea[^>]*name="bio"[^>]*>&lt;img src=x onerror=1&gt;<\/textarea>/);
  assert.doesNotMatch(app.container.innerHTML, /<b>阿青|<img src=x/);
  assert.deepEqual(app.messages, ['个人资料已保存在本机']);
  assert.deepEqual(app.calls, [['action', 'profile-updated']]);
  app.cleanup();
});

test('failed storage keeps the editor and entered fields without claiming success', () => {
  const app = harness({ failWrite: true });
  app.click('edit');
  const result = app.submit('新的昵称', '还没有保存的个人签名');
  assert.match(result.error.textContent, /没有保存/);
  assert.equal(result.form.elements.nickname.value, '新的昵称');
  assert.match(app.container.innerHTML, /data-mine-view="edit"/);
  assert.equal(app.data.size, 1);
  assert.deepEqual(app.messages, []);
  assert.deepEqual(app.calls, []);
  app.cleanup();
});

test('invalid fields and unlisted avatar selection cannot save an invalid profile', () => {
  const app = harness();
  app.click('edit'); app.click('avatar', { mineAvatar: '999' });
  assert.match(app.submit(' ', '').error.textContent, /昵称/);
  assert.match(app.submit('合格昵称', 'a'.repeat(81)).error.textContent, /80/);
  assert.equal(app.data.size, 1);
  app.submit('合格昵称', '');
  assert.equal(getLocalProfile().avatar, PROFILE_AVATARS[0]);
  app.cleanup();
});

test('corrupt profile remains explicit and hidden favorites storage is never read on home', () => {
  const app = harness({ raw: '{broken', drafts: new Error('storage error') });
  assert.match(app.container.innerHTML, /个人资料暂不可用/);
  assert.doesNotMatch(app.container.innerHTML, /数量暂不可用|0 份/);
  assert.deepEqual(app.reads,{wallet:0,drafts:0});
  app.click('account');
  assert.match(app.container.innerHTML, /data-mine-action="edit"/);
  app.click('edit');
  assert.doesNotMatch(app.container.innerHTML, /data-mine-form="profile"/);
  assert.equal(app.data.get('tongban.profile.v1'), '{broken');
  app.cleanup();
});

test('wallet management acts on the wallet while orders and help do not invent live services', () => {
  const app = harness({ wallet: { exists: true, unlocked: false, address: '0x1111111111111111111111111111111111111111' } });
  app.click('security');
  assert.match(app.container.innerHTML, /已锁定/);
  assert.match(app.container.innerHTML, /默认隐私规则/);
  app.click('wallet'); app.click('unlock'); app.click('export');
  assert.deepEqual(app.calls, [['navigate', 'wallet'], ['action', 'unlock'], ['action', 'export']]);
  app.click('orders');
  assert.match(app.container.innerHTML, /没有真实订单/);
  assert.match(app.container.innerHTML, /申请和任务完成不代表已经付款/);
  app.click('help');
  assert.match(app.container.innerHTML, /提交反馈/);
  assert.match(app.container.innerHTML, /运营人员查看处理/);
  assert.doesNotMatch(app.container.innerHTML, /没有在线客服或工单提交功能/);
  app.click('feedback');
  assert.deepEqual(app.calls.at(-1), ['action', 'feedback']);
  app.cleanup();
});

test('cleanup detaches handlers and prevents removed personal center from sending actions', () => {
  const app = harness();
  app.cleanup(); app.click('bill-center');
  assert.equal(app.events.size, 0);
  assert.deepEqual(app.calls, []);
});

test('external wallet refresh preserves the security subview and does not reset a profile editor', () => {
  const wallet = { exists: true, address: '0x1111111111111111111111111111111111111111', unlocked: false };
  const app = harness({ wallet });
  app.click('security'); wallet.unlocked = true; app.cleanup.refresh();
  assert.match(app.container.innerHTML, /data-mine-view="security"/);
  assert.match(app.container.innerHTML, /已解锁/);
  app.click('home'); app.click('edit');
  // A profile editor owns its current input DOM until saved or cancelled.
  app.container.innerHTML = 'existing editor input DOM';
  app.cleanup.refresh();
  assert.equal(app.container.innerHTML, 'existing editor input DOM');
  app.cleanup();
});

test('subpages start at the top, home restores its position, and profile save returns to its header', () => {
  const app = harness();
  globalThis.window.scrollY = 380;
  app.click('security');
  assert.equal(globalThis.window.scrollY, 0);
  globalThis.window.scrollY = 160;
  app.click('home');
  assert.equal(globalThis.window.scrollY, 380);
  app.click('edit');
  assert.equal(globalThis.window.scrollY, 0);
  globalThis.window.scrollY = 200;
  app.submit('清风', '和朋友分享每一天');
  assert.equal(globalThis.window.scrollY, 0);
  assert.ok(app.scrolls.every(value => value.behavior === 'instant'));
  app.cleanup();
});

test('home follows the five approved entry groups and opens owned devices without reading wallet status', () => {
  const wallet = { exists: true, address: '0x1111111111111111111111111111111111111111', unlocked: false };
  Object.defineProperty(wallet, 'balance', { get() { throw new Error('home must not read balances'); } });
  const app = harness({ wallet }), html = app.container.innerHTML;
  const entries=[...html.matchAll(/class="mine-row" data-mine-action="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(entries,['devices','favorites','moments','account','security','appearance','help','about','settings']);
  assert.deepEqual([...html.matchAll(/<section class="mine-list[^>]+aria-label="([^"]+)"/g)].map(match=>match[1]),['我的设备','收藏与朋友圈','账号与偏好','支持与关于','设置']);
  assert.doesNotMatch(html, /链上直接收款与转账|钱包已创建|尚未创建钱包|3 份|data-mine-action="orders"|服务订单|0\.00|tBNB|USDT|0x1111111111111111111111111111111111111111/);
  assert.deepEqual(app.reads,{wallet:0,drafts:0});
  app.click('devices'); assert.deepEqual(app.calls, [['navigate', 'workbench', { hub: { mode: 'work', screen: 'devices' } }]]); app.cleanup();
});

test('wallet state is only read in security and unknown or damaged status never claims an empty wallet', () => {
  for (const [wallet, expected] of [
    [{ exists: false }, '尚未创建'],
    [{ exists: true, address: '' }, '暂不可读取'],
    [{ exists: true, corrupt: true }, '暂不可读取'],
    [{ unavailable: true }, '暂不可读取'],
    [{}, '暂不可读取'],
    [new Error('unavailable storage'), '暂不可读取'],
  ]) {
    const app = harness({ wallet });assert.equal(app.reads.wallet,0);
    assert.doesNotMatch(app.container.innerHTML,/尚未创建|暂不可读取/);
    app.click('settings');assert.equal(app.reads.wallet,0);app.click('security');assert.equal(app.reads.wallet,1);
    assert.ok(app.container.innerHTML.includes('<h3>'+expected+'</h3>'));
    if (expected==='暂不可读取') {
      assert.doesNotMatch(app.container.innerHTML, /尚未创建|data-mine-action="create"/);
      assert.match(app.container.innerHTML, /原始钱包数据不会被覆盖/);
    }
    assert.match(app.container.innerHTML, /data-mine-action="wallet"/); app.cleanup();
  }
});

test('photo selection is previewed, cancellation keeps the saved avatar, and removal requires saving', async () => {
  const app = harness({ processPhoto: async () => PHOTO_512 }); const original = getLocalProfile();
  app.click('edit'); await app.photo({ name: 'synthetic.jpg' });
  assert.match(app.preview.innerHTML, /<img/); assert.equal(app.removePhoto.disabled, false); assert.equal(getLocalProfile().avatarImage, '');
  app.click('home'); assert.deepEqual(getLocalProfile(), original);
  app.click('edit'); await app.photo({}); app.submit('有照片的朋友', '', '29573186'); assert.equal(getLocalProfile().avatarImage, PHOTO_512);
  assert.match(app.container.innerHTML, /<img/); app.click('edit'); app.click('remove-photo'); assert.equal(app.preview.textContent, original.avatar); app.submit('有照片的朋友', '', '29573186'); assert.equal(getLocalProfile().avatarImage, ''); app.cleanup();
});
test('failed and late photo processing preserve current edits and never resurrect a canceled photo', async () => {
  let resolve; const app = harness({ processPhoto: () => new Promise(done => { resolve = done; }) });
  app.click('edit'); const pending = app.photo({}); assert.equal(app.save.disabled, true); assert.match(app.submit('名字', '').error.textContent, /处理中/);
  app.click('avatar', { mineAvatar: '4' }); resolve(PHOTO_512); await pending; assert.equal(app.preview.textContent, PROFILE_AVATARS[4]); assert.equal(app.save.disabled, false);
  const stale = app.photo({}); app.click('home'); resolve(PHOTO_512); await stale; assert.match(app.container.innerHTML, /data-mine-view="home"/); assert.equal(getLocalProfile().avatarImage, ''); app.cleanup();
  const broken = harness({ processPhoto: async () => { throw new Error('照片已损坏'); } }); broken.click('edit'); await broken.photo({}); assert.equal(broken.photoStatus.textContent, '照片已损坏'); assert.equal(broken.save.disabled, false); assert.equal(getLocalProfile().avatarImage, ''); broken.cleanup();
});
function cloudProfile() { return { version: 2, nickname: '线上朋友', bio: '', avatar: '✨', avatarImage: '', userId: '25973186', localId: '25973186', level: 3, official: false, identityScope: 'server', revision: 7 }; }
test('cloud profile ID edits require current password and await authoritative save', async () => {
  let profile = cloudProfile(), finish; const submitted = [];
  const app = harness({ profileService: { getProfile: () => profile, saveProfile: input => { submitted.push(input); return new Promise(resolve => { finish = () => { profile = { ...profile, ...input, revision: 8 }; delete profile.currentPassword; resolve(profile); }; }); } } });
  assert.match(app.container.innerHTML, /ID 25973186/); assert.match(app.container.innerHTML, /Lv. 3/); assert.doesNotMatch(app.container.innerHTML, /官方认证/);
  app.click('account');assert.match(app.container.innerHTML,/data-mine-action="account-settings"/);
  app.click('account-settings'); assert.deepEqual(app.calls, [['action', 'account-settings']]); app.click('home');app.click('edit');
  const invalid = app.submit('新的名字', '', '27495381'); await invalid.pending; assert.match(invalid.error.textContent, /当前 6 位/); assert.equal(submitted.length, 0);
  const valid = app.submit('新的名字', '新签名', '27495381', '248635'); assert.equal(app.save.disabled, true); assert.equal(app.messages.length, 0); assert.equal(submitted.length, 1); assert.equal(submitted[0].revision, 7); assert.equal(submitted[0].currentPassword, '248635'); assert.equal(submitted[0].level, undefined); assert.equal(submitted[0].official, undefined);
  finish(); await valid.pending; assert.equal(app.messages.at(-1), '个人资料已保存'); assert.match(app.container.innerHTML, /ID 27495381/); app.cleanup();
});
test('cloud conflicts stay editable and ordinary saves omit passwords; late responses do not update a removed editor', async () => {
  const submitted = []; let finish;
  const app = harness({ profileService: { getProfile: cloudProfile, async saveProfile(input) { submitted.push(input); throw new Error('这个 ID 已被使用，请换一个'); } } });
  app.click('edit'); const result = app.submit('新名字', '新签名'); await result.pending; assert.match(result.error.textContent, /已被使用/); assert.equal('currentPassword' in submitted[0], false); assert.equal(app.messages.length, 0); assert.match(app.container.innerHTML, /data-mine-view="edit"/); app.cleanup();
  const canceled = harness({ profileService: { getProfile: cloudProfile, saveProfile: input => new Promise(resolve => { finish = () => resolve({ ...cloudProfile(), ...input, revision: 8 }); }) } });
  canceled.click('edit'); const pending = canceled.submit('晚返回', ''); canceled.cleanup(); finish(); await pending.pending; assert.equal(canceled.messages.length, 0); assert.match(canceled.container.innerHTML, /data-mine-view="edit"/);
});

function themeFixture(initial='light',persistent=true){let current=initial;const selected=[];return{selected,service:{getTheme:()=>current,setTheme:id=>{current=id;selected.push(id)},isPersistent:()=>persistent}};}
const deviceSettle=()=>new Promise(resolve=>setImmediate(resolve));
const personalProfile=userId=>({identityScope:'server',userId,nickname:'本人',avatar:'愚',level:1,official:false,bio:'',revision:1});
test('personal device counter uses real owner metadata and excludes revoked devices',async()=>{
  const calls=[];
  const app=harness({profileService:{getProfile:()=>personalProfile('owner_a'),authenticatedRequest:async path=>{calls.push(path);return {devices:[{id:'a',online:true},{id:'b',online:false},{id:'c'},{id:'d',online:true,revoked:true}]};}}});
  assert.match(app.container.innerHTML,/正在读取在线状态/);await deviceSettle();
  assert.match(app.container.innerHTML,/1 台在线 · 1 台状态未知/);
  assert.deepEqual(calls,['devices']);assert.deepEqual(app.reads,{wallet:0,drafts:0});app.cleanup();
});
test('personal device empty, malformed, failed and missing status never become invented online devices',async()=>{
  for(const [result,label] of [[{devices:[]},'尚未添加设备'],[{devices:[{id:'only'}]},'0 台在线 · 1 台状态未知'],[{devices:[null]},'在线状态暂不可用'],[{devices:[{id:'a'},{id:'a'}]},'在线状态暂不可用'],[new Error('offline'),'在线状态暂不可用']]){
    const app=harness({profileService:{getProfile:()=>personalProfile('owner_a'),authenticatedRequest:async()=>{if(result instanceof Error)throw result;return result;}}});
    await deviceSettle();assert.ok(app.container.innerHTML.includes(label),label);assert.doesNotMatch(app.container.innerHTML,/2 台在线/);app.cleanup();
  }
});
test('late device metadata cannot reveal an earlier account status or resurrect an unmounted view',async()=>{
  let owner='owner_a',resolve;
  const app=harness({profileService:{getProfile:()=>personalProfile(owner),authenticatedRequest:()=>new Promise(done=>{resolve=done;})}});
  owner='owner_b';app.cleanup.refresh();resolve({devices:[{id:'secret_old_device',online:true}]});await deviceSettle();
  assert.match(app.container.innerHTML,/在线状态未知/);assert.doesNotMatch(app.container.innerHTML,/1 台在线/);app.cleanup();
  let finish;const removed=harness({profileService:{getProfile:()=>personalProfile('owner_a'),authenticatedRequest:()=>new Promise(done=>{finish=done;})}});
  removed.cleanup();const before=removed.container.innerHTML;finish({devices:[{id:'a',online:true}]});await deviceSettle();assert.equal(removed.container.innerHTML,before);
});
test('home QR is only an explicit authenticated action and collection routes preserve mine origin',async()=>{
  const app=harness({profileService:{getProfile:()=>personalProfile('owner_a'),authenticatedRequest:async()=>({devices:[]})}});
  assert.deepEqual(app.calls,[]);app.click('my-qr');app.click('favorites');app.click('moments');
  assert.deepEqual(app.calls,[['action','my-qr'],['navigate','discover',{route:'favorites',origin:'mine'}],['navigate','discover',{route:'moments',origin:'mine'}]]);
  app.cleanup();const local=harness();local.click('my-qr');assert.deepEqual(local.calls,[]);assert.match(local.container.innerHTML,/aria-label="我的好友二维码" disabled/);local.cleanup();
});
test('direct home settings entries return home after an earlier account subview',()=>{
  const app=harness();app.click('account');app.click('edit');app.click('back');app.click('back');app.click('security');
  assert.match(app.container.innerHTML,/aria-label="返回个人中心"/);app.click('back');assert.match(app.container.innerHTML,/data-mine-view="home"/);
  app.click('appearance');app.click('back');assert.match(app.container.innerHTML,/data-mine-view="home"/);app.cleanup();
});
test('device counter refresh never closes a profile editor',async()=>{
  let resolve;const app=harness({profileService:{getProfile:()=>personalProfile('owner_a'),authenticatedRequest:()=>new Promise(done=>{resolve=done;})}});
  app.click('edit');const editor=app.container.innerHTML;resolve({devices:[{id:'a',online:true}]});await deviceSettle();assert.equal(app.container.innerHTML,editor);app.cleanup();
});
test('appearance entry displays exactly the three allowed skins and reads the current selection',()=>{
  const theme=themeFixture('dark'),app=harness({themeService:theme.service});
  assert.match(app.container.innerHTML,/data-mine-action="appearance"/);app.click('settings');
  assert.match(app.container.innerHTML,/data-mine-action="appearance"/);app.click('appearance');
  assert.match(app.container.innerHTML,/data-mine-view="appearance"/);
  const options=[...app.container.innerHTML.matchAll(/data-mine-theme="([^"]+)" aria-pressed="([^"]+)"/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(options,[['light','false'],['dark','true'],['eyecare','false']]);
  for(const label of ['白天','黑天','护眼'])assert.ok(app.container.innerHTML.includes(label));
  assert.equal(theme.selected.length,0);assert.deepEqual(app.messages,[]);app.cleanup();
});
test('skin selection immediately invokes the theme service, updates selection, and names the exact skin in its toast',()=>{
  const theme=themeFixture(),app=harness({themeService:theme.service});app.click('settings');app.click('appearance');
  for(const [id,label] of [['dark','黑天'],['eyecare','护眼'],['light','白天']]){
    app.click('theme-select',{mineTheme:id});
    assert.equal(theme.service.getTheme(),id);
    const selected=[...app.container.innerHTML.matchAll(/data-mine-theme="([^"]+)" aria-pressed="true"/g)].map(m=>m[1]);
    assert.deepEqual(selected,[id]);assert.equal(app.messages.at(-1),'已切换为 '+label+' 皮肤');
  }
  assert.deepEqual(theme.selected,['dark','eyecare','light']);
  assert.deepEqual(app.calls,[]);assert.doesNotMatch(app.container.innerHTML,/确认切换|保存皮肤/);app.cleanup();
});
test('failed persistent storage keeps the live skin selected but explains that it cannot be saved',()=>{
  const theme=themeFixture('light',false),app=harness({themeService:theme.service});app.click('settings');app.click('appearance');app.click('theme-select',{mineTheme:'eyecare'});
  assert.equal(theme.service.getTheme(),'eyecare');
  assert.match(app.container.innerHTML,/data-mine-theme="eyecare" aria-pressed="true"/);
  assert.match(app.container.innerHTML,/本机存储暂不可用，本次选择仅在当前页面生效/);
  assert.equal(app.messages.at(-1),'已切换为 护眼 皮肤；本机暂时无法保存');app.cleanup();
});
test('unlisted themes, out-of-view clicks and a detached appearance view cannot invoke the theme service',()=>{
  const theme=themeFixture(),app=harness({themeService:theme.service});app.click('theme-select',{mineTheme:'dark'});
  assert.deepEqual(theme.selected,[]);app.click('settings');app.click('appearance');
  for(const id of ['system','<script>','',undefined,'__proto__','constructor','toString'])app.click('theme-select',{mineTheme:id});
  assert.deepEqual(theme.selected,[]);assert.equal(theme.service.getTheme(),'light');
  assert.ok(app.messages.every(m=>m==='外观设置暂不可用，请重新打开页面。'));
  assert.match(app.container.innerHTML,/data-mine-theme="light" aria-pressed="true"/);
  app.cleanup();app.click('theme-select',{mineTheme:'dark'});assert.deepEqual(theme.selected,[]);
});

test('appearance returns to settings through visible back, while editing profile returns directly home',()=>{
  const app=harness({themeService:themeFixture().service});app.click('settings');app.click('appearance');
  assert.match(app.container.innerHTML,/aria-label="返回设置"/);app.click('back');assert.match(app.container.innerHTML,/data-mine-view="settings"/);
  app.click('back');assert.match(app.container.innerHTML,/data-mine-view="home"/);app.click('edit');assert.match(app.container.innerHTML,/aria-label="返回个人中心"/);
  assert.equal(app.cleanup.back(),true);assert.match(app.container.innerHTML,/data-mine-view="home"/);app.cleanup();
});

test('account profile editing returns through account and settings help returns through settings',()=>{
  const app=harness();
  app.click('account');app.click('edit');
  assert.match(app.container.innerHTML,/aria-label="返回账号"/);
  app.click('back');assert.match(app.container.innerHTML,/data-mine-view="account"/);
  app.click('back');assert.match(app.container.innerHTML,/data-mine-view="home"/);
  app.click('settings');app.click('help');assert.match(app.container.innerHTML,/aria-label="返回设置"/);
  assert.equal(app.cleanup.back(),true);assert.match(app.container.innerHTML,/data-mine-view="settings"/);
  assert.equal(app.cleanup.back(),true);assert.match(app.container.innerHTML,/data-mine-view="home"/);
  app.cleanup();
});

test('brand avatar is a fallback and never replaces a saved personal photo',()=>{
  const app=harness();
  assert.match(app.container.innerHTML,/<span class="mine-avatar" aria-hidden="true">愚<\/span>/);
  const original=getLocalProfile();app.cleanup();
  const stored={...original,avatarImage:PHOTO_512};
  const photo=harness({raw:JSON.stringify(stored)});
  assert.match(photo.container.innerHTML,/<span class="mine-avatar" aria-hidden="true"><img/);
  assert.equal(getLocalProfile().avatarImage,PHOTO_512);
  photo.cleanup();
});

test('about has the approved brand language and personal views omit prohibited product wording',()=>{
  const app=harness();app.click('about');
  assert.ok(app.container.innerHTML.includes(`class="mine-number">${packageVersion}</span>`),'version is available in About rather than adding a home entry');
  for(const text of ['YBZ','愚笨者','技能交给 AI，判断留给自己。','Let AI do the doing. You do the deciding.','思维','知道要什么、为什么','决策','定方向、做取舍、担结果','创造性','把不相干的东西连起来']) {
    assert.ok(app.container.innerHTML.includes(text),text);
  }
  for(const screen of ['home','account','settings','appearance','security','orders','help','about']) {
    app.click(screen);
    assert.doesNotMatch(app.container.innerHTML,/余额|提现|积分转让|邀请.{0,8}奖励|分享.{0,8}奖励/);
    assert.ok((app.container.innerHTML.match(/class="mine-primary"/g)||[]).length<=1);
  }
  app.cleanup();
});
