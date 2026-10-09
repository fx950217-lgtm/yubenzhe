import './discover-moments.css';

const MAX_IMAGES = 3, MAX_BYTES = 2 * 1024 * 1024, MAX_POSTS = 40;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => globalThis.crypto?.randomUUID?.() || `moment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const active = value => !Number.isFinite(value?.archivedAt) || value.archivedAt <= 0;
const friendIds = people => new Set((people || []).filter(person => person.isFriend).map(person => person.id));
const imageBytes = value => { const base64 = String(value).split(',')[1] || ''; return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0); };
const imageFormat = value => typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
const time = value => {
  const elapsed = Math.max(0, Date.now() - value), minutes = Math.floor(elapsed / 60000);
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : new Date(value).toLocaleDateString('zh-CN');
};
const paths = { search:'m16 16 5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', plus:'M12 4v16M4 12h16', back:'m14 5-7 7 7 7', next:'m10 5 7 7-7 7', heart:'M20 5c-3-3-7-1-8 2-1-3-5-5-8-2-4 5 1 9 8 15 7-6 12-10 8-15Z', comment:'M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM7 10h10M7 14h6', share:'m14 3 7 7-7 7M21 10H9a6 6 0 0 0-6 6v5', bookmark:'M6 3h12v18l-6-4-6 4V3Z', close:'m6 6 12 12M6 18 18 6', image:'M3 4h18v16H3Zm0 12 5-5 5 5 4-4 4 4M15 8h.1', archive:'M3 4h18v5H3ZM5 9v12h14V9M9 13h6', lock:'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3', edit:'m15 4 5 5M4 20l5-1L21 7a3.5 3.5 0 0 0-5-5L4 14v6Z', check:'m5 12 4 4L19 6' };
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.comment}"/></svg>`;
const button = (action, label, extra = '', cls = '') => `<button type="button" class="${cls}" data-disc="${action}" ${extra}>${label}</button>`;

export function canViewMoment(post, people, { includeArchived = false } = {}) {
  if (!post || (!includeArchived && !active(post))) return false;
  if (post.authorId === 'me') return true;
  return active(post) && post.audience !== 'self' && friendIds(people).has(post.authorId);
}
export function canShareMoment(post, people) { return canViewMoment(post, people) && post.audience !== 'self'; }
export function selectMomentPosts(data, people, { filter = 'friends', query = '', archived = false } = {}) {
  const saved = new Set(data.savedPostIds || []), term = String(query).trim().toLowerCase();
  return (data.posts || []).filter(post => {
    if (!canViewMoment(post, people, { includeArchived: archived })) return false;
    if (archived) { if (post.authorId !== 'me' || active(post)) return false; }
    else if (filter === 'mine' && post.authorId !== 'me') return false;
    else if (filter === 'friends' && post.authorId === 'me') return false;
    else if (filter === 'saved' && !saved.has(post.id)) return false;
    return !term || String(post.text || '').toLowerCase().includes(term);
  }).sort((a, b) => b.createdAt - a.createdAt);
}
export function validateMomentDraft(input, isSafeImage = imageFormat) {
  const text = String(input?.text || '').trim();
  if (!text || text.length > 800) throw new Error('动态文字请填写 1–800 个字符。');
  if (!['friends', 'self'].includes(input?.audience || 'friends')) throw new Error('请选择动态可见范围。');
  const images = input?.images ?? [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES || images.some(image => !imageFormat(image) || !isSafeImage(image))) throw new Error('最多添加 3 张有效的 JPG、PNG 或 WebP 图片。');
  if (images.reduce((sum, image) => sum + imageBytes(image), 0) > MAX_BYTES) throw new Error('这条动态的图片总大小不能超过 2 MB。');
  return { text, images: [...images], audience: input?.audience || 'friends' };
}
export function saveMoment(data, postId, input, { isSafeImage = imageFormat, timestamp = Date.now(), id = uid() } = {}) {
  const draft = validateMomentDraft(input, isSafeImage);
  const existing = postId ? data.posts.find(post => post.id === postId) : null;
  if (postId && (!existing || existing.authorId !== 'me' || !active(existing))) throw new Error('只能编辑自己未归档的动态。');
  if (existing) { Object.assign(existing, draft, { updatedAt: timestamp }); return existing.id; }
  if (data.posts.length >= MAX_POSTS) throw new Error('本机最多保存 40 条动态，现有内容未被覆盖。');
  const post = { id, authorId: 'me', ...draft, createdAt: timestamp, updatedAt: timestamp, archivedAt: null, likes: [], comments: [] };
  data.posts.unshift(post); return post.id;
}
export function setMomentArchived(data, postId, archived, timestamp = Date.now()) {
  const post = data.posts.find(item => item.id === postId);
  if (!post || post.authorId !== 'me') throw new Error('只能归档或还原自己的动态。');
  post.archivedAt = archived ? timestamp : null;
}
function requireVisible(data, postId, people) {
  const post = data.posts.find(item => item.id === postId);
  if (!canViewMoment(post, people)) throw new Error('这条动态当前不可见，操作没有保存。');
  return post;
}
export function toggleMomentSaved(data, postId, people) {
  requireVisible(data, postId, people);
  const saved = new Set(data.savedPostIds || []);
  if (saved.has(postId)) saved.delete(postId); else saved.add(postId);
  data.savedPostIds = [...saved]; return saved.has(postId);
}
export function toggleMomentLike(data, postId, people) {
  const post = requireVisible(data, postId, people), likes = new Set(post.likes || []);
  if (likes.has('me')) likes.delete('me'); else likes.add('me');
  post.likes = [...likes]; return likes.has('me');
}
export function addMomentComment(data, postId, text, people, { timestamp = Date.now(), id = uid() } = {}) {
  const post = requireVisible(data, postId, people), value = String(text || '').trim();
  if (!value || value.length > 300) throw new Error('评论请填写 1–300 个字符。');
  post.comments ||= [];
  if (post.comments.length >= 50) throw new Error('这条动态的本机评论已达上限，原有评论未被删除。');
  post.comments.push({ id, authorId: 'me', text: value, createdAt: timestamp, archivedAt: null }); return id;
}
export function setMomentCommentArchived(data, postId, commentId, archived, people, timestamp = Date.now()) {
  const post = requireVisible(data, postId, people), comment = post.comments?.find(item => item.id === commentId);
  if (!comment || comment.authorId !== 'me') throw new Error('只能撤回或恢复自己的评论。');
  comment.archivedAt = archived ? timestamp : null;
}

export function createMomentsFeature(ctx) {
  let filter = 'friends', query = '', archived = false, lastOwnOnly, dead = false, revision = 0, editor = null, gallery = null;
  let detachDialog = () => {};
  const people = () => ctx.getPeople() || [];
  const person = id => id === 'me' ? ctx.getMe() : people().find(item => item.id === id);
  const avatar = user => `<span class="moment-avatar ${['mint', 'purple', 'blue', 'peach'].includes(user?.color) ? user.color : 'mint'}" aria-hidden="true">${esc(user?.initial || '友')}</span>`;
  const safe = image => imageFormat(image) && (ctx.isSafeImage || imageFormat)(image);
  const imagesOf = post => (post.images || []).filter(safe).slice(0, MAX_IMAGES);
  const postById = id => ctx.getData().posts.find(post => post.id === id);
  const fail = error => ctx.toast(error.message || '本机操作未完成，请重试。');
  const write = change => { try { ctx.commit(change); ctx.render(); return true; } catch (error) { fail(error); return false; } };
  function onDialog(dialog, callback) {
    detachDialog();
    const cancel = () => { revision++; editor = null; gallery = null; };
    dialog.addEventListener('close', cancel, { once: true });
    const release = callback?.(dialog);
    detachDialog = () => { dialog.removeEventListener('close', cancel); release?.(); };
  }
  function postHTML(post) {
    const own = post.authorId === 'me', user = person(post.authorId), saved = (ctx.getData().savedPostIds || []).includes(post.id), isArchived = !active(post);
    const known = friendIds(people()); known.add('me');
    const likes = (post.likes || []).filter(id => known.has(id)), comments = (post.comments || []).filter(comment => known.has(comment.authorId) && (active(comment) || comment.authorId === 'me'));
    return `<article class="moment-card" data-moment-id="${esc(post.id)}"><header>${own ? avatar(user) : button('m-profile', avatar(user), `data-id="${esc(post.authorId)}" aria-label="查看${esc(user?.name || '好友')}的资料"`, 'moment-avatar-button')}<div><strong>${esc(user?.name || '好友')}</strong><span>${time(post.createdAt)}${post.updatedAt > post.createdAt ? ' · 已编辑' : ''}</span></div><span class="moment-audience">${post.audience === 'self' ? `${icon('lock')}仅自己` : '好友可见'}</span></header><p class="moment-text">${esc(post.text)}</p>${imagesOf(post).length ? `<div class="moment-images count-${imagesOf(post).length}">${imagesOf(post).map((image, index) => button('m-image', `<img src="${esc(image)}" alt="${esc(user?.name || '好友')}的动态图片 ${index + 1}" loading="lazy"/>`, `data-id="${esc(post.id)}" data-index="${index}" aria-label="放大第 ${index + 1} 张图片"`)).join('')}</div>` : ''}${isArchived ? `<div class="moment-archived-row"><span>${icon('archive')}已归档，仅自己保留</span>${button('m-restore', '还原动态', `data-id="${esc(post.id)}"`, 'moment-text-button')}</div>` : `<div class="moment-actions">${button('m-like', `${icon('heart')}<span>${likes.length || '赞'}</span>`, `data-id="${esc(post.id)}" aria-pressed="${likes.includes('me')}" aria-label="${likes.includes('me') ? '取消点赞' : '点赞'}"`, likes.includes('me') ? 'is-liked' : '')}${button('m-comment', `${icon('comment')}<span>评论</span>`, `data-id="${esc(post.id)}"`)}${canShareMoment(post, people()) ? button('m-share', `${icon('share')}<span>分享</span>`, `data-id="${esc(post.id)}"`) : ''}${button('m-save', icon('bookmark'), `data-id="${esc(post.id)}" aria-label="${saved ? '取消收藏' : '收藏动态'}" aria-pressed="${saved}"`, `moment-save ${saved ? 'is-saved' : ''}`)}</div>`}${likes.length ? `<p class="moment-likes">${icon('heart')}${esc(likes.map(id => person(id)?.name || '好友').join('、'))}</p>` : ''}${comments.length ? `<div class="moment-comments">${comments.map(comment => !active(comment) ? `<p class="moment-comment-archived"><span>你撤回了一条评论</span>${!isArchived ? button('m-comment-restore', '恢复', `data-id="${esc(post.id)}" data-comment-id="${esc(comment.id)}"`) : ''}</p>` : `<div class="moment-comment"><p><strong>${esc(person(comment.authorId)?.name || '好友')}</strong><span>：${esc(comment.text)}</span></p>${comment.authorId === 'me' && !isArchived ? button('m-comment-archive', '撤回', `data-id="${esc(post.id)}" data-comment-id="${esc(comment.id)}" aria-label="撤回自己的评论"`) : ''}</div>`).join('')}</div>` : ''}${own && !isArchived ? `<footer class="moment-manage">${button('m-edit', `${icon('edit')}编辑`, `data-id="${esc(post.id)}"`)}${button('m-archive', `${icon('archive')}归档`, `data-id="${esc(post.id)}"`)}</footer>` : ''}</article>`;
  }
  function resultsHTML() {
    const posts = selectMomentPosts(ctx.getData(), people(), { filter, query, archived });
    if (posts.length) return posts.map(postHTML).join('');
    const title = query.trim() ? '没有找到相关动态' : archived ? '归档里还是空的' : filter === 'saved' ? '收藏喜欢的日常' : filter === 'mine' ? '留下一点今天的日常' : '等待朋友的新鲜事';
    const copy = query.trim() ? '试试动态里的其他文字。' : archived ? '归档后的动态会保留在这里，随时可以还原。' : filter === 'saved' ? '轻点动态上的收藏图标，之后在这里找到它。' : filter === 'mine' ? '写给朋友，也可以只留给自己。' : '这里只展示当前好友与你分享的动态。';
    return `<div class="moment-empty">${icon(archived ? 'archive' : filter === 'saved' ? 'bookmark' : 'comment')}<h3>${title}</h3><p>${copy}</p>${filter === 'mine' && !archived && !query ? button('m-compose', '写一条动态', '', 'moment-primary') : ''}</div>`;
  }
  function render({ ownOnly = false } = {}) {
    if (lastOwnOnly !== ownOnly) { filter = ownOnly ? 'mine' : 'friends'; archived = false; lastOwnOnly = ownOnly; }
    const archiveCount = ctx.getData().posts.filter(post => post.authorId === 'me' && !active(post)).length;
    const heading = archived ? '归档的动态' : filter === 'mine' ? '我的朋友圈' : filter === 'saved' ? '收藏的动态' : '朋友圈';
    return `<section class="moments-feature"><header class="moment-heading">${button('hub', icon('back'), 'aria-label="返回发现"', 'moment-round')}<div><h2>${heading}</h2><p>熟悉的人，最近的日常</p></div>${button('m-compose', `${icon('plus')}记录`, '', 'moment-primary moment-compose')}</header><p class="moment-local">本机体验 · 动态、互动与照片不会发送给他人</p><div class="moment-toolbar"><div class="moment-tabs" role="tablist" aria-label="动态筛选">${[['friends', '好友'], ['mine', '我的'], ['saved', '收藏']].map(([id, label]) => button('m-filter', label, `data-filter="${id}" role="tab" aria-selected="${!archived && filter === id}"`, !archived && filter === id ? 'active' : '')).join('')}</div>${button('m-archives', `${icon('archive')}归档${archiveCount ? ` ${archiveCount}` : ''}`, `aria-pressed="${archived}"`, `moment-archive-tab ${archived ? 'active' : ''}`)}</div><label class="moment-search">${icon('search')}<input type="search" data-moment-search value="${esc(query)}" placeholder="搜索动态文字" aria-label="搜索动态文字" autocomplete="off"/></label>${archived ? '<p class="moment-archive-note">这里保留你归档的动态，还原后会回到原来的可见范围。</p>' : ''}<div data-moment-results>${resultsHTML()}</div></section>`;
  }
  function editorImagesHTML() {
    return editor.images.map((image, index) => `<figure><img src="${esc(image)}" alt="待保存图片 ${index + 1}"/>${button('m-image-remove', icon('close'), `data-index="${index}" aria-label="移除第 ${index + 1} 张图片"`)}</figure>`).join('');
  }
  function compose(postId) {
    if (dead) return;
    const post = postId ? postById(postId) : null;
    if (postId && (!post || post.authorId !== 'me' || !active(post))) return fail(new Error('只能编辑自己未归档的动态。'));
    const draft = { postId, text: post?.text || '', images: imagesOf(post || {}), audience: post?.audience === 'self' ? 'self' : 'friends', busy: false };
    revision++; detachDialog(); editor = draft; gallery = null;
    ctx.showDialog(postId ? '编辑我的动态' : '记录一点日常', `<form data-moment-editor class="moment-editor"><label class="moment-field">想记下什么？<textarea name="momentText" rows="5" maxlength="800" placeholder="和熟悉的人分享，也可以留给自己…" required>${esc(draft.text)}</textarea></label><div class="moment-editor-images" data-moment-image-preview>${editorImagesHTML()}</div><label class="moment-upload">${icon('image')}<span>添加照片<small>最多 3 张，合计 2 MB</small></span><input type="file" data-moment-file accept="image/jpeg,image/png,image/webp" multiple/></label><label class="moment-field moment-visibility"><span>${icon('lock')}谁可以看</span><select name="momentAudience"><option value="friends" ${draft.audience === 'friends' ? 'selected' : ''}>好友可见</option><option value="self" ${draft.audience === 'self' ? 'selected' : ''}>仅自己</option></select></label><p class="moment-editor-note">仅自己可见的动态不能分享至聊天。</p><p class="moment-error" data-moment-error role="alert"></p><button type="submit" class="moment-primary" data-moment-submit>${postId ? '保存修改' : '保存动态'}</button></form>`, dialog => onDialog(dialog, element => {
      const form = element.querySelector('[data-moment-editor]'), input = form.querySelector('[name=momentText]'), audience = form.querySelector('[name=momentAudience]'), fileInput = form.querySelector('[data-moment-file]'), error = form.querySelector('[data-moment-error]'), submit = form.querySelector('[data-moment-submit]');
      draft.dialog = element; draft.preview = form.querySelector('[data-moment-image-preview]');
      const inputChanged = () => { draft.text = input.value; draft.audience = audience.value; };
      const choose = async () => {
        if (draft.busy) { fileInput.value = ''; return; }
        const files = [...fileInput.files]; fileInput.value = ''; if (!files.length) return;
        const token = revision; draft.busy = true; submit.disabled = true; fileInput.disabled = true; error.textContent = '正在本机读取照片…';
        try {
          if (files.length + draft.images.length > MAX_IMAGES) throw new Error('每条动态最多 3 张照片，可先移除不需要的照片。');
          if (typeof ctx.readImages !== 'function') throw new Error('照片读取暂不可用，请稍后重试。');
          const images = await ctx.readImages(files);
          if (dead || revision !== token || editor !== draft || !element.open || !element.isConnected) return;
          validateMomentDraft({ text: draft.text.trim() || '校验照片', images: [...draft.images, ...images], audience: draft.audience }, safe);
          draft.images.push(...images); draft.preview.innerHTML = editorImagesHTML(); error.textContent = '';
        } catch (failure) { if (!dead && revision === token && editor === draft && element.isConnected) error.textContent = failure.message; }
        finally { if (!dead && revision === token && editor === draft) { draft.busy = false; submit.disabled = false; fileInput.disabled = false; } }
      };
      const save = event => {
        event.preventDefault(); if (draft.busy || editor !== draft || dead) return; inputChanged();
        try { ctx.commit(data => saveMoment(data, draft.postId, draft, { isSafeImage: safe })); filter = 'mine'; archived = false; query = ''; ctx.closeDialog(); (ctx.onSaved || ctx.render)(); ctx.toast('动态已保存在本机'); }
        catch (failure) { error.textContent = failure.message; }
      };
      form.addEventListener('input', inputChanged); form.addEventListener('change', inputChanged); fileInput.addEventListener('change', choose); form.addEventListener('submit', save); input.focus();
      return () => { form.removeEventListener('input', inputChanged); form.removeEventListener('change', inputChanged); fileInput.removeEventListener('change', choose); form.removeEventListener('submit', save); };
    }));
  }
  function showComment(id) {
    const post = postById(id); if (!canViewMoment(post, people())) return fail(new Error('这条动态当前不可见。'));
    revision++; detachDialog(); editor = null; gallery = null;
    ctx.showDialog('写评论', `<p class="moment-quote">${esc(post.text.slice(0, 150))}</p><form data-moment-comment-form><label class="moment-field">说点什么<textarea name="comment" maxlength="300" rows="3" required placeholder="留下你的想法…"></textarea></label><p class="moment-error" data-moment-error role="alert"></p><button class="moment-primary" type="submit">保存本机评论</button></form>`, dialog => onDialog(dialog, element => {
      const form = element.querySelector('form'), input = form.querySelector('textarea'), error = form.querySelector('[data-moment-error]');
      const submit = event => { event.preventDefault(); if (dead) return; try { ctx.commit(data => addMomentComment(data, id, input.value, people())); ctx.closeDialog(); ctx.render(); } catch (failure) { error.textContent = failure.message; } };
      form.addEventListener('submit', submit); input.focus(); return () => form.removeEventListener('submit', submit);
    }));
  }
  function showGallery(id, index = 0) {
    const post = postById(id); if (!canViewMoment(post, people(), { includeArchived: true })) return fail(new Error('这条动态当前不可见。'));
    const images = imagesOf(post); if (!images.length) return;
    const position = Math.max(0, Math.min(Number.isInteger(index) ? index : 0, images.length - 1));
    revision++; detachDialog(); editor = null; gallery = { id, index: position };
    ctx.showDialog(`照片 ${position + 1} / ${images.length}`, `<div class="moment-gallery"><img src="${esc(images[position])}" alt="动态图片 ${position + 1}"/></div><div class="moment-gallery-controls">${button('m-image-prev', `${icon('back')}上一张`, position === 0 ? 'disabled' : '')}<span>${position + 1} / ${images.length}</span>${button('m-image-next', `下一张${icon('next')}`, position === images.length - 1 ? 'disabled' : '')}</div>`, dialog => onDialog(dialog, element => {
      element.classList.add('moment-gallery-dialog');
      const keydown = event => { if (!gallery || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault(); showGallery(gallery.id, gallery.index + (event.key === 'ArrowLeft' ? -1 : 1)); };
      element.addEventListener('keydown', keydown); return () => element.removeEventListener('keydown', keydown);
    }));
  }
  function handleAction(action, target) {
    if (dead || typeof action !== 'string' || !action.startsWith('m-')) return false;
    const id = target?.dataset?.id, commentId = target?.dataset?.commentId;
    if (action === 'm-filter' && ['friends', 'mine', 'saved'].includes(target.dataset.filter)) { filter = target.dataset.filter; archived = false; ctx.render(); }
    else if (action === 'm-archives') { archived = !archived; filter = 'mine'; ctx.render(); }
    else if (action === 'm-compose') compose();
    else if (action === 'm-edit') compose(id);
    else if (action === 'm-profile') { if (people().some(user => user.id === id && user.isFriend)) ctx.onProfile(id); }
    else if (action === 'm-share') { const post = postById(id); if (canShareMoment(post, people())) ctx.onShare(id); else fail(new Error('仅自己可见、已归档或不再可见的动态不能分享。')); }
    else if (action === 'm-like') write(data => toggleMomentLike(data, id, people()));
    else if (action === 'm-save') write(data => toggleMomentSaved(data, id, people()));
    else if (action === 'm-archive' || action === 'm-restore') { if (write(data => setMomentArchived(data, id, action === 'm-archive'))) ctx.toast(action === 'm-archive' ? '已移入归档，随时可以还原' : '动态已还原'); }
    else if (action === 'm-comment') showComment(id);
    else if (action === 'm-comment-archive' || action === 'm-comment-restore') write(data => setMomentCommentArchived(data, id, commentId, action === 'm-comment-archive', people()));
    else if (action === 'm-image') showGallery(id, Number(target.dataset.index));
    else if (action === 'm-image-prev' && gallery) showGallery(gallery.id, gallery.index - 1);
    else if (action === 'm-image-next' && gallery) showGallery(gallery.id, gallery.index + 1);
    else if (action === 'm-image-remove' && editor && !editor.busy) { const index = Number(target.dataset.index); if (Number.isInteger(index) && index >= 0 && index < editor.images.length) { editor.images.splice(index, 1); if (editor.preview) editor.preview.innerHTML = editorImagesHTML(); } }
    else return false;
    return true;
  }
  function handleInput(event) {
    if (dead || !event.target.matches('[data-moment-search]')) return;
    query = event.target.value.slice(0, 800);
    const results = event.target.closest('.moments-feature')?.querySelector('[data-moment-results]');
    if (results) results.innerHTML = resultsHTML();
  }
  return { render, compose, handleAction, handleInput, cleanup() { dead = true; revision++; detachDialog(); editor = null; gallery = null; } };
}
