import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const dataURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const stripCSS = source => source.replace(/import '\.\/[^']+\.css';\n/g, '');
const mediaURL = dataURL(stripCSS(await readFile(new URL('../src/chat-media.js', import.meta.url), 'utf8')));
const source = stripCSS(await readFile(new URL('../src/live-social.js', import.meta.url), 'utf8')).replace("'./chat-media.js'", JSON.stringify(mediaURL));
const { validateFriendId, validateGroup, mergeMessages, safeProfilePhoto, invalidatedConversationIds } = await import(dataURL(source));

test('friend IDs use exact ASCII digits with the same account length limits', () => {
  for (const input of ['000123', '1234567890123456', ' 73648291 ']) assert.equal(validateFriendId(input), input.trim());
  for (const input of ['', '12345', '12345678901234567', '１２３４５６', 'user123', '0x123456', '123 456', '123456\n7']) assert.throws(() => validateFriendId(input), /数字好友 ID/);
});

test('group creation requires two distinct current friends and respects the fifty member limit', () => {
  const a = '73648291', b = '42873615';
  assert.deepEqual(validateGroup(' 旅行群 ', [a, a, b], [a, b]), { name: '旅行群', memberIds: [a, b] });
  assert.throws(() => validateGroup('群', [a, a], [a, b]), /2–49/);
  assert.throws(() => validateGroup('群', [a, '999999'], [a, b]), /当前好友/);
  assert.throws(() => validateGroup(' '.repeat(2), [a, b], [a, b]), /群聊名称/);
  assert.throws(() => validateGroup('群'.repeat(25), [a, b], [a, b]), /群聊名称/);
  const large = Array.from({ length: 50 }, (_, n) => String(100000 + n));
  assert.throws(() => validateGroup('过大', large, large), /2–49/);
});

test('overlapping latest and historical pages preserve messages and deduplicate server acknowledgements', () => {
  const first = { id: 'm1', createdAt: 20, text: 'first' }, second = { id: 'm2', createdAt: 30, text: 'second' };
  const current = [first, second], old = { id: 'm0', createdAt: 10, text: 'older' }, updated = { ...second, text: 'confirmed' };
  const result = mergeMessages(current, [updated, old, updated, null]);
  assert.deepEqual(result.map(message => message.id), ['m0', 'm1', 'm2']);
  assert.equal(result.at(-1).text, 'confirmed');
  assert.equal(current[1].text, 'second');
  assert.deepEqual(mergeMessages(result, [second]).map(message => message.id), ['m0', 'm1', 'm2']);
});

test('profile photos accept only the exact app avatar route or constrained embedded image types', () => {
  const path = '/api/social/avatars/12345678-1234-1234-1234-123456789012';
  assert.equal(safeProfilePhoto({ avatarImage: path }), path);
  assert.equal(safeProfilePhoto({ avatarImage: 'https://66.42.56.29' + path }), 'https://66.42.56.29' + path);
  assert.equal(safeProfilePhoto({ avatarImage: 'data:image/jpeg;base64,YWJj' }), 'data:image/jpeg;base64,YWJj');
  for (const value of ['https://example.com' + path, 'http://66.42.56.29' + path, 'https://66.42.56.29:444' + path, 'https://user@66.42.56.29' + path, 'https://66.42.56.29' + path + '?redirect=evil', 'https://66.42.56.29' + path + '#x', '//66.42.56.29' + path, '/api/social/avatars/not-a-key', 'data:image/svg+xml;base64,YWJj', 'javascript:alert(1)']) assert.equal(safeProfilePhoto({ avatarImage: value }), '');
});


test('revoked or renewed memberships invalidate cached messages even with the same conversation ID', () => {
 const existing = [{ id: 'direct', membershipRevision: '100:0' }, { id: 'group', membershipRevision: '200:0' }];
 assert.deepEqual(invalidatedConversationIds(existing, existing.map(item => ({ ...item, unread: 2 }))), []);
 assert.deepEqual(invalidatedConversationIds(existing, [{ id: 'direct', membershipRevision: '100:0' }]), ['group']);
 assert.deepEqual(invalidatedConversationIds(existing, [{ id: 'direct', membershipRevision: '100:0' }, { id: 'group', membershipRevision: '200:23' }]), ['group']);
 assert.deepEqual(invalidatedConversationIds(existing, [{ id: 'direct', membershipRevision: '301:23' }, { id: 'group', membershipRevision: '200:0' }]), ['direct']);
 assert.deepEqual(invalidatedConversationIds([], [{ id: 'new', membershipRevision: '400:0' }]), []);
});
