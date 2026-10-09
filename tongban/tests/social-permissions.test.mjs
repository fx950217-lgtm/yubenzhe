import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mediaSource = (await readFile(new URL('../src/chat-media.js', import.meta.url), 'utf8')).replace(/import '\.\/[^']+\.css';\n/g, '');
const mediaURL = `data:text/javascript;base64,${Buffer.from(mediaSource).toString('base64')}`;
const source = (await readFile(new URL('../src/social.js', import.meta.url), 'utf8')).replace(/import '\.\/[^']+\.css';\n/g, '').replace("'./redpacket-model.js'", JSON.stringify(new URL('../src/redpacket-model.js', import.meta.url).href)).replace("'./chat-media.js'", JSON.stringify(mediaURL)).replace("'./profile-store.js'", JSON.stringify(new URL('../src/profile-store.js', import.meta.url).href)) + '\nexport { seed, readState, canChat, setFriendRemark, setConversationSetting, updateGroupDetails, inviteFriendsToGroup, createDemoPacket, messageSearchText, esc };';
const social = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const key = 'tongban.social.demo.v1';
let store;
test.beforeEach(() => {
  store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
});

test('share targets contain only current friends and own groups', () => {
  const targets = social.getSocialShareTargets();
  assert.equal(targets.filter(target => target.type === 'friend').length, 3);
  assert.equal(targets.filter(target => target.type === 'group').length, 2);
  assert.ok(targets.every(target => target.id && target.name && target.initial && target.color));
  assert.ok(!targets.some(target => target.id === 'moon'));
  assert.equal(social.getSocialFriends().length, 3);
  assert.equal(social.getSocialPeople().find(person => person.id === 'moon').isFriend, false);
});

test('moment shares persist their metadata to friends and groups, escaping markup on render', () => {
  const moment = { id: 'moment-1', author: '<svg onload=alert(1)>', text: '<img src=x onerror=alert(1)> 熟人动态' };
  for (const targetId of ['lin', 'group-weekend']) {
    const result = social.shareMomentToChat(targetId, moment);
    assert.equal(result.targetId, targetId);
    const message = social.readState().chats[targetId].at(-1);
    assert.equal(message.type, 'moment');
    assert.equal(message.from, 'me');
    assert.deepEqual(message.share, moment);
    assert.ok(social.messageSearchText(message).includes('熟人动态'));
    assert.ok(!social.esc(message.share.text).includes('<img'));
    assert.match(social.esc(message.share.author), /&lt;svg/);
  }
});

test('strangers, unknown groups, empty shares and unavailable storage cannot report successful shares', () => {
  const moment = { id: 'm', author: '可可', text: '日常' };
  assert.throws(() => social.shareMomentToChat('moon', moment), /只能分享/);
  assert.throws(() => social.shareMomentToChat('group-other', moment), /只能分享/);
  assert.throws(() => social.shareMomentToChat('lin', { ...moment, text: '   ' }), /内容无效/);
  assert.equal(store.size, 0);
  globalThis.localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => social.shareMomentToChat('lin', moment), /未能分享/);
});

test('friend remarks and pin/mute preferences persist without granting stranger privileges', () => {
  const data = social.seed();
  social.setFriendRemark(data, 'lin', '老林');
  social.setConversationSetting(data, 'lin', 'pinned', true);
  social.setConversationSetting(data, 'group-study', 'muted', true);
  assert.throws(() => social.setFriendRemark(data, 'moon', '陌生人'), /只能设置好友/);
  assert.throws(() => social.setConversationSetting(data, 'moon', 'pinned', true), /无法修改/);
  assert.throws(() => social.setConversationSetting(data, 'lin', 'admin', true), /无法修改/);
  localStorage.setItem(key, JSON.stringify(data));
  const restored = social.readState();
  assert.equal(restored.remarks.lin, '老林');
  assert.equal(restored.conversationSettings.lin.pinned, true);
  assert.equal(restored.conversationSettings['group-study'].muted, true);
  assert.equal(social.getSocialFriends().find(person => person.id === 'lin').name, '老林');
  assert.equal(social.getSocialShareTargets().find(target => target.id === 'lin').name, '老林');
  social.setFriendRemark(restored, 'lin', '');
  assert.equal(restored.remarks.lin, undefined);
});

test('group editing and friend-only invites preserve existing packet recipient snapshots', () => {
  const data = social.seed();
  const packet = social.createDemoPacket(data, 'group-study', { totalUnits: 300, count: 3, kind: 'equal', greeting: '演示' }).packet;
  const beforeRecipients = [...packet.recipientIds];
  social.updateGroupDetails(data, 'group-study', { name: '周末学习', note: '周六一起看书' });
  social.inviteFriendsToGroup(data, 'group-study', ['zhou', 'zhou']);
  assert.deepEqual(data.groups.find(group => group.id === 'group-study').members, ['lin', 'ke', 'zhou']);
  assert.deepEqual(packet.recipientIds, beforeRecipients);
  assert.throws(() => social.inviteFriendsToGroup(data, 'group-study', ['moon']), /只能邀请/);
  assert.throws(() => social.updateGroupDetails(data, 'group-study', { name: ' ', note: '' }), /请填写/);
  localStorage.setItem(key, JSON.stringify(data));
  assert.equal(social.readState().groups.find(group => group.id === 'group-study').note, '周六一起看书');
});

test('historical text, shared moments and packet greetings are searchable', () => {
  const data = social.seed();
  assert.match(social.messageSearchText(data.chats.lin[0]), /咖啡/);
  assert.match(social.messageSearchText(data.chats.lin.at(-1)), /好心情/);
  assert.match(social.messageSearchText({ type: 'moment', share: { author: '可可', text: '生活日常' } }), /可可 生活日常/);
});


test('strict financial and media reads preserve corrupt records instead of reseeding', () => {
  localStorage.setItem(key, '{broken');
  assert.throws(() => social.readState({ strict: true }), /未覆盖旧记录/);
  assert.equal(localStorage.getItem(key), '{broken');
  const invalid = social.seed(); invalid.wallets.me = -1;
  localStorage.setItem(key, JSON.stringify(invalid));
  assert.throws(() => social.readState({ strict: true }), /未覆盖旧记录/);
  assert.equal(JSON.parse(localStorage.getItem(key)).wallets.me, -1);
});
