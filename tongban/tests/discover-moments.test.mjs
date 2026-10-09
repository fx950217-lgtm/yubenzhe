import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../src/discover-moments.js', import.meta.url), 'utf8')).replace(/import '\.\/[^']+\.css';\n/g, '');
const moments = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6R8AAAAASUVORK5CYII=';
const people = [{ id: 'lin', name: '林一', initial: '林', color: 'mint', isFriend: true }, { id: 'ke', name: '可可', initial: '可', color: 'purple', isFriend: true }, { id: 'stranger', name: '陌生人', isFriend: false }];
const post = (id, authorId, values = {}) => ({ id, authorId, text: id, createdAt: 1000, images: [], likes: [], comments: [], audience: 'friends', archivedAt: null, ...values });
const fixture = () => ({ savedPostIds: ['friend', 'private', 'stranger'], posts: [post('friend', 'lin', { text: '咖啡与生活', likes: ['ke'], comments: [{ id: 'c1', authorId: 'ke', text: '周末见' }] }), post('mine', 'me', { images: [PNG, PNG] }), post('private', 'me', { audience: 'self', text: '仅自己的计划' }), post('stranger', 'stranger'), post('friends-secret', 'ke', { audience: 'self' }), post('archive', 'me', { archivedAt: 1234 }), post('friends-archive', 'lin', { archivedAt: 1234 })] });
const target = (id, extra = {}) => ({ dataset: { id, ...extra } });

test('friend, own, saved and archive filters preserve audience and friendship boundaries', () => {
  const data = fixture();
  assert.deepEqual(moments.selectMomentPosts(data, people).map(post => post.id), ['friend']);
  assert.deepEqual(moments.selectMomentPosts(data, people, { filter: 'mine' }).map(post => post.id), ['mine', 'private']);
  assert.deepEqual(moments.selectMomentPosts(data, people, { filter: 'saved' }).map(post => post.id), ['friend', 'private']);
  assert.deepEqual(moments.selectMomentPosts(data, people, { archived: true }).map(post => post.id), ['archive']);
  assert.equal(moments.selectMomentPosts(data, people, { query: '生活' }).length, 1);
  assert.equal(moments.selectMomentPosts(data, people, { query: '不存在' }).length, 0);
  assert.deepEqual(moments.selectMomentPosts(data, people.map(p => ({ ...p, isFriend: false })), { filter: 'saved' }).map(p => p.id), ['private']);
});

test('only active, visible friend-audience moments can be shared', () => {
  const data = fixture();
  for (const id of ['friend', 'mine']) assert.equal(moments.canShareMoment(data.posts.find(post => post.id === id), people), true);
  for (const id of ['private', 'stranger', 'friends-secret', 'archive', 'friends-archive']) assert.equal(moments.canShareMoment(data.posts.find(post => post.id === id), people), false);
});

test('editing own moments preserves identity and interactions; archiving is reversible', () => {
  const data = fixture(), own = data.posts.find(p => p.id === 'mine'); own.likes = ['lin']; own.comments = [{ id: 'old', authorId: 'me', text: '旧评论' }];
  moments.saveMoment(data, 'mine', { text: '新的日常', images: [PNG], audience: 'self' }, { timestamp: 2000 });
  assert.equal(own.createdAt, 1000); assert.equal(own.updatedAt, 2000); assert.deepEqual(own.likes, ['lin']); assert.equal(own.comments[0].id, 'old');
  moments.setMomentArchived(data, 'mine', true, 3000); assert.equal(moments.canViewMoment(own, people), false);
  assert.throws(() => moments.saveMoment(data, 'mine', { text: '归档不可编辑' }), /未归档/);
  moments.setMomentArchived(data, 'mine', false); assert.equal(own.archivedAt, null); assert.equal(own.audience, 'self'); assert.equal(moments.canViewMoment(own, people), true);
  assert.throws(() => moments.saveMoment(data, 'friend', { text: '不能改朋友' }), /只能编辑/);
  assert.throws(() => moments.setMomentArchived(data, 'friend', true), /只能归档/);
});

test('draft validation rejects unsupported images, excess count and combined oversized payloads', () => {
  assert.throws(() => moments.validateMomentDraft({ text: ' ' }), /文字/);
  assert.throws(() => moments.validateMomentDraft({ text: 'hi', audience: 'everyone' }), /可见范围/);
  assert.throws(() => moments.validateMomentDraft({ text: 'hi', images: ['https://example.com/photo.jpg'] }), /有效/);
  assert.throws(() => moments.validateMomentDraft({ text: 'hi', images: [PNG] }, () => false), /有效/);
  assert.throws(() => moments.validateMomentDraft({ text: 'hi', images: [PNG, PNG, PNG, PNG] }), /最多/);
  const large = 'data:image/png;base64,' + 'A'.repeat(1500000);
  assert.throws(() => moments.validateMomentDraft({ text: 'hi', images: [large, large] }), /2 MB/);
  assert.deepEqual(moments.validateMomentDraft({ text: ' 好日子 ', images: [PNG], audience: 'self' }), { text: '好日子', images: [PNG], audience: 'self' });
});

test('creating moments never silently truncates old data', () => {
  const data = { posts: Array.from({ length: 40 }, (_, i) => post(`old-${i}`, 'me')) }, before = structuredClone(data);
  assert.throws(() => moments.saveMoment(data, null, { text: '41' }), /原有|现有内容未被覆盖/); assert.deepEqual(data, before);
  moments.saveMoment(data, 'old-3', { text: '更新' }); assert.equal(data.posts.length, 40);
});

test('likes and saved items toggle once and cannot target strangers or archived posts', () => {
  const data = fixture();
  assert.equal(moments.toggleMomentLike(data, 'friend', people), true); assert.deepEqual(data.posts[0].likes, ['ke', 'me']);
  assert.equal(moments.toggleMomentLike(data, 'friend', people), false); assert.deepEqual(data.posts[0].likes, ['ke']);
  assert.equal(moments.toggleMomentSaved(data, 'mine', people), true); assert.equal(moments.toggleMomentSaved(data, 'mine', people), false);
  for (const id of ['stranger', 'archive', 'friends-secret']) { assert.throws(() => moments.toggleMomentLike(data, id, people), /不可见/); assert.throws(() => moments.toggleMomentSaved(data, id, people), /不可见/); }
});

test('own comment withdrawal keeps content for restoration and cannot remove other peoples comments', () => {
  const data = fixture();
  const id = moments.addMomentComment(data, 'friend', ' 周末一起 ', people, { id: 'new', timestamp: 2000 });
  const comment = data.posts[0].comments.find(item => item.id === id);
  assert.equal(comment.text, '周末一起'); assert.equal(comment.createdAt, 2000);
  moments.setMomentCommentArchived(data, 'friend', id, true, people, 3000); assert.equal(comment.text, '周末一起'); assert.equal(comment.archivedAt, 3000);
  moments.setMomentCommentArchived(data, 'friend', id, false, people); assert.equal(comment.archivedAt, null);
  assert.throws(() => moments.setMomentCommentArchived(data, 'friend', 'c1', true, people), /自己的评论/);
  assert.throws(() => moments.addMomentComment(data, 'stranger', '你好', people), /不可见/);
  assert.throws(() => moments.addMomentComment(data, 'friend', ' ', people), /评论/);
});

class Element {
  constructor(value = '') { this.value = value; this.innerHTML = ''; this.textContent = ''; this.listeners = new Map(); this.open = true; this.isConnected = true; this.classList = { add() {} }; this.files = []; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  dispatch(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
  focus() {}
  close() { this.open = false; this.isConnected = false; this.dispatch('close'); }
}
function feature(initial = fixture(), overrides = {}) {
  let data = initial, currentDialog = null, html = '', title = '', renders = 0, saved = 0, failing = false;
  const toasts = [], shares = [], me = { id: 'me', name: '<我的昵称>', initial: '🌱', color: 'purple' };
  const context = {
    getData: () => data, getPeople: () => people, getMe: () => me,
    commit(change) { const copy = structuredClone(data); change(copy); if (failing) throw new Error('保存失败'); data = copy; },
    render() { renders++; }, onSaved() { saved++; }, toast: text => toasts.push(text), onProfile() {}, onShare: id => shares.push(id),
    isSafeImage: image => image === PNG, readImages: async files => files.map(() => PNG),
    closeDialog() { currentDialog?.close(); currentDialog = null; },
    showDialog(nextTitle, nextHTML, setup) {
      currentDialog?.close(); title = nextTitle; html = nextHTML;
      const dialog = new Element(), form = new Element(), fields = new Map();
      for (const selector of ['[name=momentText]', '[name=momentAudience]', '[data-moment-file]', '[data-moment-error]', '[data-moment-submit]', '[data-moment-image-preview]', 'textarea']) fields.set(selector, new Element());
      fields.get('[name=momentText]').value = /name="momentText"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] || '';
      fields.get('[name=momentAudience]').value = /value="self" selected/.test(html) ? 'self' : 'friends';
      form.querySelector = selector => fields.get(selector);
      dialog.querySelector = () => form; dialog.form = form; dialog.fields = fields; currentDialog = dialog; setup?.(dialog);
    }, ...overrides,
  };
  const api = moments.createMomentsFeature(context);
  return { api, toasts, shares, data: () => data, dialog: () => currentDialog, html: () => html, title: () => title, renders: () => renders, saved: () => saved, fail(value) { failing = value; } };
}

test('repeated parent renders retain filter selection, safe profile markup and sharing permissions', () => {
  const f = feature(); f.api.render({ ownOnly: false });
  f.api.handleAction('m-filter', target(null, { filter: 'mine' }));
  const html = f.api.render({ ownOnly: false }); assert.match(html, /我的朋友圈/); assert.match(html, /&lt;我的昵称&gt;/); assert.doesNotMatch(html, /<我的昵称>/);
  f.api.handleAction('m-share', target('private')); f.api.handleAction('m-share', target('archive')); f.api.handleAction('m-share', target('stranger')); assert.deepEqual(f.shares, []);
  f.api.handleAction('m-share', target('friend')); assert.deepEqual(f.shares, ['friend']); assert.equal(f.api.handleAction('unrelated', target('friend')), false);
  f.api.cleanup(); assert.equal(f.api.handleAction('m-like', target('friend')), false);
});

test('failed interaction persistence leaves the old data and does not report success', () => {
  const f = feature(), before = structuredClone(f.data()); f.fail(true);
  f.api.handleAction('m-like', target('friend')); assert.deepEqual(f.data(), before); assert.equal(f.renders(), 0); assert.match(f.toasts[0], /保存失败/);
  f.api.cleanup();
});

test('editor removes single images, preserves failed edits, and signals successful save navigation', () => {
  const f = feature(); f.api.compose('mine');
  const dialog = f.dialog(), input = dialog.fields.get('[name=momentText]'); input.value = '修改后'; dialog.form.dispatch('input');
  f.api.handleAction('m-image-remove', target(null, { index: '0' }));
  assert.equal((dialog.fields.get('[data-moment-image-preview]').innerHTML.match(/<img /g) || []).length, 1);
  f.fail(true); dialog.form.dispatch('submit'); assert.equal(f.data().posts.find(p => p.id === 'mine').text, 'mine'); assert.match(dialog.fields.get('[data-moment-error]').textContent, /保存失败/); assert.equal(input.value, '修改后'); assert.equal(f.saved(), 0);
  f.fail(false); dialog.form.dispatch('submit'); const updated = f.data().posts.find(p => p.id === 'mine'); assert.equal(updated.text, '修改后'); assert.equal(updated.images.length, 1); assert.equal(f.saved(), 1); assert.equal(f.dialog(), null); f.api.cleanup();
});

test('closing a composer while images load cancels the async update and prevents accidental saves', async () => {
  let resolveImages;
  const f = feature(fixture(), { readImages: () => new Promise(resolve => { resolveImages = resolve; }) });
  f.api.compose(); const dialog = f.dialog(), file = dialog.fields.get('[data-moment-file]'); file.files = [{ type: 'image/png', size: 20 }];
  const reading = file.dispatch('change'); assert.equal(dialog.fields.get('[data-moment-submit]').disabled, true);
  dialog.close(); resolveImages([PNG]); await reading;
  assert.equal(dialog.fields.get('[data-moment-image-preview]').innerHTML, ''); assert.equal(f.saved(), 0); f.api.cleanup();
});

test('image gallery has bounded previous/next controls and rechecks visibility', () => {
  const f = feature(); f.api.handleAction('m-image', target('mine', { index: '0' })); assert.equal(f.title(), '照片 1 / 2'); assert.match(f.html(), /data-disc="m-image-prev" disabled/);
  f.api.handleAction('m-image-next', target()); assert.equal(f.title(), '照片 2 / 2'); assert.match(f.html(), /data-disc="m-image-next" disabled/);
  f.api.handleAction('m-image-next', target()); assert.equal(f.title(), '照片 2 / 2');
  f.api.handleAction('m-image-prev', target()); assert.equal(f.title(), '照片 1 / 2');
  f.api.handleAction('m-image', target('stranger')); assert.match(f.toasts.at(-1), /不可见/); f.api.cleanup();
});
