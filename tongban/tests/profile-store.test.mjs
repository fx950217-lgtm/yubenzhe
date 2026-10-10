import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocalProfile, saveLocalProfile, applyRemoteProfile, PROFILE_AVATARS, validateUserId, isReservedUserId } from '../src/profile-store.js';
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data }; };
const key = 'tongban.profile.v1';
const editable = { nickname: '新朋友', bio: '一起去海边', avatar: PROFILE_AVATARS[1] };
test('first profile persists a stable random identity independent of wallet keys', () => {
  const store = storage(); store.setItem('tongban.wallet.vault', 'untouched');
  const first = getLocalProfile(store); assert.match(first.userId, /^\d{10}$/); assert.match(first.nickname, /^用户\d{6}$/); assert.equal(first.identityScope, 'local');
  assert.deepEqual(getLocalProfile(store), first);
  const next = saveLocalProfile({ ...editable, userId: '25973186', address: 'fake', level: 99, official: true }, store);
  assert.equal(next.userId, '25973186'); assert.equal(next.localId, next.userId); assert.equal(next.address, undefined);
  assert.equal(next.official, false); assert.equal(next.level, 1); assert.deepEqual(getLocalProfile(store), next); assert.equal(store.getItem('tongban.wallet.vault'), 'untouched');
});
test('v1 migration retains old nickname, bio and avatar and never replaces unreadable data', () => {
  const store = storage(); const previous = { version: 1, nickname: '原来的名字', bio: '旧签名', avatar: '🌊', localId: '本机体验档案' };
  store.setItem(key, JSON.stringify(previous)); const migrated = getLocalProfile(store);
  assert.equal(migrated.version, 2); assert.equal(migrated.nickname, previous.nickname); assert.equal(migrated.bio, previous.bio); assert.equal(migrated.avatar, previous.avatar); assert.equal(migrated.avatarImage, '');
  assert.deepEqual(getLocalProfile(store), migrated);
  for (const raw of ['corrupt', JSON.stringify({ ...previous, avatar: '<script>' }), JSON.stringify({ version: 99 })]) {
    store.setItem(key, raw); assert.throws(() => getLocalProfile(store), /无法读取/); assert.throws(() => saveLocalProfile(editable, store), /无法读取/); assert.equal(store.getItem(key), raw);
  }
});
test('ID rules enforce ASCII identifiers and retained system numbers without claiming global uniqueness', () => {
  for (const id of ['1234', 'abcde'.repeat(5), '１２３４５６', '-123456', '12 3456']) assert.throws(() => validateUserId(id), /5–24/);
  for (const id of ['111111', '123456', '987654', '123123', '121212', '55888826', '5201314']) { assert.equal(isReservedUserId(id), true); assert.throws(() => validateUserId(id), /靓号/); }
  assert.equal(validateUserId(' Hello_User '), 'hello_user'); assert.equal(validateUserId(' 25973186 '), '25973186'); assert.equal(validateUserId('003578'), '003578');
});
test('validation and concurrent edits do not overwrite saved profile or photo', () => {
  const store = storage(); const original = getLocalProfile(store);
  for (const bad of [{ nickname: '' }, { avatar: '<script>' }, { bio: 'x'.repeat(81) }, { avatarImage: 'https://evil.test/photo.jpg' }, { userId: '888888' }]) {
    assert.throws(() => saveLocalProfile({ ...editable, ...bad }, store)); assert.deepEqual(getLocalProfile(store), original);
  }
  saveLocalProfile({ ...editable, revision: original.revision }, store);
  assert.throws(() => saveLocalProfile({ ...editable, nickname: '旧编辑器', revision: original.revision }, store), /其他页面/);
});
test('failed initial save, migration and profile update remain explicit without destroying data', () => {
  const store = storage(); assert.throws(() => getLocalProfile({ getItem: () => null, setItem() { throw new Error('quota'); } }), /没有保存/);
  const original = getLocalProfile(store), raw = store.getItem(key); store.setItem = () => { throw new Error('quota'); };
  assert.throws(() => saveLocalProfile(editable, store), /没有保存/); assert.equal(store.getItem(key), raw); assert.deepEqual(getLocalProfile(store), original);
  const oldRaw = JSON.stringify({ version: 1, ...editable }); const oldStore = { getItem: () => oldRaw, setItem() { throw new Error('quota'); } };
  assert.throws(() => getLocalProfile(oldStore), /没有保存/); assert.equal(oldStore.getItem(key), oldRaw);
});
test('authenticated profile replaces all identity fields and cannot be changed using local save', () => {
  const store = storage(); getLocalProfile(store);
  const remote = { ...editable, userId: '888888', avatarImage: '', level: 12, official: true, revision: 5 };
  const cached = applyRemoteProfile(remote, store); assert.equal(cached.identityScope, 'server'); assert.equal(cached.official, true); assert.equal(cached.level, 12);
  assert.throws(() => saveLocalProfile(editable, store), /账号服务/);
  applyRemoteProfile({ ...editable, nickname: '另一个账号', avatarImage: '', userId: '27953186', level: 1, official: false, revision: 1 }, store);
  const switched = getLocalProfile(store); assert.equal(switched.official, false); assert.equal(switched.level, 1); assert.equal(switched.avatarImage, ''); assert.equal(switched.userId, '27953186');
  const raw = store.getItem(key); assert.throws(() => applyRemoteProfile({ ...remote, revision: undefined }, store)); assert.equal(store.getItem(key), raw);
});
