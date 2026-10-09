import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PHOTO_512 } from './helpers/profile-fixtures.mjs';
import { getLocalProfile, PROFILE_AVATARS } from '../src/profile-store.js';

const source = (await readFile(new URL('../src/mine.js', import.meta.url), 'utf8'))
  .replace("import './mine.css';", '')
  .replace("from './profile-store.js'", `from '${new URL('../src/profile-store.js', import.meta.url).href}'`)
  .replace("from './profile-photo.js'", `from '${new URL('../src/profile-photo.js', import.meta.url).href}'`);
const { mountMine } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Minimal event surface: tests exercise the component's public event flows and real
// profile storage, rather than adding a browser DOM dependency to the application.
function harness({ wallet = { exists: false }, drafts = 3, raw = null, failWrite = false, isNative = false, profileService = null, processPhoto = undefined } = {}) {
  const data = new Map(raw === null ? [] : [['tongban.profile.v1', raw]]);
  const events = new Map(), calls = [], messages = [], attrs = new Map(), scrolls = [];
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
    isNative, profileService, processPhoto,
    toast: message => messages.push(message),
    onNavigate: (...args) => calls.push(['navigate', ...args]),
    onAction: name => calls.push(['action', name]),
    getWalletStatus: () => { if (wallet instanceof Error) throw wallet; return wallet; },
    getDraftCount: () => { if (drafts instanceof Error) throw drafts; return drafts; },
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
  return { container, calls, messages, data, click, submit, cleanup, events, preview, attrs, scrolls, photo, photoStatus, removePhoto, save, password, passwordSection };
}

test('web installation entry navigates while the installed app omits it and handles inner back', () => {
  const web = harness();
  assert.match(web.container.innerHTML, /data-mine-action="install"/);
  web.click('install');assert.deepEqual(web.calls,[['action','install']]);web.cleanup();
  const native = harness({isNative:true});
  assert.doesNotMatch(native.container.innerHTML,/data-mine-action="install"/);
  native.click('install');assert.deepEqual(native.calls,[]);
  native.click('security');assert.equal(native.cleanup.back(),true);
  assert.match(native.container.innerHTML,/data-mine-view="home"/);
  assert.equal(native.cleanup.back(),false);native.cleanup();
});

test('personal center labels local identity and forwards drafts and bills without duplicate moments', () => {
  const app = harness();
  assert.match(app.container.innerHTML, /本机资料/);
  assert.match(app.container.innerHTML, /愚笨者 · 0.12.1/);
  assert.match(app.container.innerHTML, /<small>3 份<\/small>/);
  assert.doesNotMatch(app.container.innerHTML, /data-mine-action="moments"/);
  app.click('drafts'); app.click('bill-center'); app.click('ai');
  assert.deepEqual(app.calls, [
    ['navigate', 'discover', { route: 'drafts' }], ['action', 'bill-center'], ['navigate', 'discover', { route: 'ai' }],
  ]);
  app.cleanup();
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

test('corrupt profile and unreadable draft count remain explicit instead of appearing empty', () => {
  const app = harness({ raw: '{broken', drafts: new Error('storage error') });
  assert.match(app.container.innerHTML, /个人资料暂不可用/);
  assert.match(app.container.innerHTML, /数量暂不可用/);
  assert.match(app.container.innerHTML, /data-mine-action="edit"[^>]*disabled/);
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
  assert.match(app.container.innerHTML, /草稿不会自动成为订单/);
  app.click('help');
  assert.match(app.container.innerHTML, /在线支持尚未接通/);
  assert.match(app.container.innerHTML, /没有在线客服或工单提交功能/);
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

test('assets are the first home destination and route to the existing wallet without fake totals', () => {
  const wallet = { exists: true, address: '0x1111111111111111111111111111111111111111', unlocked: false };
  Object.defineProperty(wallet, 'balance', { get() { throw new Error('home must not read balances'); } });
  const app = harness({ wallet }), html = app.container.innerHTML;
  assert.match(html, /我的资产/); assert.match(html, /钱包与平台余额/); assert.match(html, /钱包已创建/);
  const order = ['wallet', 'drafts', 'bill-center', 'security', 'help'].map(action => html.indexOf(`data-mine-action="${action}"`));
  assert.ok(order.every((position, i) => position >= 0 && (i === 0 || position > order[i - 1])));
  assert.doesNotMatch(html, /data-mine-action="orders"|服务订单|0\.00|tBNB|USDT|0x1111111111111111111111111111111111111111/);
  app.click('wallet'); assert.deepEqual(app.calls, [['navigate', 'wallet']]); app.cleanup();
});

test('home wallet state distinguishes missing wallets from damaged or unreadable status', () => {
  for (const [wallet, expected] of [
    [{ exists: false }, '尚未创建钱包'],
    [{ exists: true, address: '' }, '钱包状态暂不可用'],
    [{ exists: true, corrupt: true }, '钱包状态暂不可用'],
    [{ unavailable: true }, '钱包状态暂不可用'],
    [{}, '钱包状态暂不可用'],
    [new Error('unavailable storage'), '钱包状态暂不可用'],
  ]) {
    const app = harness({ wallet }); assert.match(app.container.innerHTML, new RegExp(expected));
    if (expected.includes('暂不可用')) assert.doesNotMatch(app.container.innerHTML, /尚未创建钱包/);
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
  app.click('account-settings'); assert.deepEqual(app.calls, [['action', 'account-settings']]); app.click('edit');
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
