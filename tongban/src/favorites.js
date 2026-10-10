const KEY = 'tongban.favorites.v1';
const LIMIT = 200;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function validateFavoriteInput(input) {
  const kind = input?.kind === 'link' ? 'link' : input?.kind === 'text' ? 'text' : '';
  const title = String(input?.title || '').trim();
  let content = String(input?.content || '').trim();
  if (!kind) throw new Error('请选择文字或链接。');
  if (title.length > 80) throw new Error('标题最多 80 个字符。');
  if (!content || content.length > (kind === 'link' ? 2000 : 4000)) throw new Error(kind === 'link' ? '请填写 2000 字以内的完整链接。' : '请填写 1–4000 个字符的内容。');
  if (kind === 'link') {
    let url;
    try { url = new URL(content); } catch { throw new Error('请输入以 https:// 或 http:// 开头的完整链接。'); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f]/.test(content)) throw new Error('只支持不含登录凭据的 HTTP 或 HTTPS 链接。');
    content = url.href;
    if (content.length > 2000) throw new Error('链接太长，请使用 2000 字符以内的链接。');
  }
  return { kind, title, content };
}

export function createFavoritesStore(storage = localStorage) {
  let snapshot = storage.getItem(KEY), entries = [];
  if (snapshot !== null) {
    let parsed;
    try { parsed = JSON.parse(snapshot); } catch { throw new Error('收藏数据无法读取，请保留浏览器数据后重试。'); }
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > LIMIT) throw new Error('收藏数据格式异常，暂时不能保存。');
    const ids = new Set();
    entries = parsed.entries.map(entry => {
      if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100 || ids.has(entry.id) || !Number.isFinite(entry.createdAt)) throw new Error('收藏数据格式异常，暂时不能保存。');
      ids.add(entry.id);
      return { ...validateFavoriteInput(entry), id:entry.id, createdAt:entry.createdAt };
    });
  }
  function save(next) {
    if (storage.getItem(KEY) !== snapshot) throw new Error('另一个页面已更新收藏。本次未保存，请先复制内容，再刷新收藏重试。');
    const serialized = JSON.stringify({ version:1, entries:next });
    try { storage.setItem(KEY, serialized); } catch { throw new Error('本机空间不足或浏览器禁止保存，本次修改没有保存。'); }
    snapshot = serialized;
    entries = next;
  }
  return {
    list:() => entries.map(entry => ({ ...entry })).sort((a,b) => b.createdAt-a.createdAt),
    add(input) {
      const value = validateFavoriteInput(input);
      if (entries.length >= LIMIT) throw new Error('最多保存 200 条收藏，请先整理已有收藏。');
      const item = { ...value, id:crypto.randomUUID(), createdAt:Date.now() };
      save([item,...entries]);
      return { ...item };
    },
    remove(id) {
      if (!entries.some(entry => entry.id === id)) throw new Error('这条收藏已不存在，请刷新列表。');
      save(entries.filter(entry => entry.id !== id));
    },
  };
}

export function createFavoritesFeature(ctx) {
  let store = null, error = '';
  function refresh() {
    try { store = createFavoritesStore(ctx.storage); error = ''; } catch (e) { store = null; error = e.message; }
  }
  refresh();
  const button = (action,label,extra='') => '<button type="button" class="disc-soft" data-disc="favorite-'+action+'" '+extra+'>'+label+'</button>';
  function render() {
    const entries = store?.list() || [], legacy = ctx.getLegacySaved?.() || [];
    return '<section class="favorites-page" aria-label="收藏">'+
      '<div class="favorites-toolbar">'+button('add','新增收藏',store?'':'disabled')+button('refresh','刷新')+'<button type="button" class="disc-text" data-disc="drafts">历史草稿</button></div>'+
      '<p class="disc-note">文字和链接仅保存在本机，不会自动上传。</p>'+
      (error?'<p class="disc-error" role="alert">'+esc(error)+'</p>':'')+
      '<div class="favorites-list">'+entries.map(item => '<article class="favorites-item"><div><h3>'+esc(item.title || (item.kind==='link'?'链接收藏':'文字收藏'))+'</h3><small>'+new Date(item.createdAt).toLocaleDateString('zh-CN')+'</small></div>'+
        (item.kind==='link'?'<a href="'+esc(item.content)+'" target="_blank" rel="noopener noreferrer">'+esc(item.content)+'</a>':'<p>'+esc(item.content)+'</p>')+
        button('remove','取消收藏','data-id="'+esc(item.id)+'"')+'</article>').join('')+'</div>'+
      (legacy.length?'<h3 class="favorites-legacy-title">历史收藏</h3><div class="favorites-list">'+legacy.map(item => '<article class="favorites-item"><h3>本机旧动态</h3><p>'+esc(item.text)+'</p>'+button('legacy-remove','取消收藏','data-id="'+esc(item.id)+'"')+'</article>').join('')+'</div>':'')+
      (!entries.length&&!legacy.length&&!error?'<div class="disc-empty"><h3>还没有收藏</h3><p>把想留住的文字或链接放在这里。</p></div>':'')+'</section>';
  }
  function add() {
    ctx.showDialog('新增收藏','<form data-favorite-form><label class="disc-field">类型<select name="kind"><option value="text">文字</option><option value="link">链接</option></select></label><label class="disc-field">标题（选填）<input name="title" maxlength="80" autocomplete="off"></label><label class="disc-field">内容<textarea name="content" maxlength="4000" required placeholder="输入文字或完整链接"></textarea></label><p class="disc-form-error" role="alert"></p><button type="submit" class="disc-primary">保存到收藏</button></form>', element => {
      const form = element.querySelector('[data-favorite-form]');
      form.addEventListener('submit', event => {
        event.preventDefault();
        try {
          if (!store) throw new Error(error || '收藏暂时无法保存，请刷新后重试。');
          store.add({kind:form.elements.kind.value,title:form.elements.title.value,content:form.elements.content.value});
          ctx.closeDialog();ctx.toast('已收藏到本机');ctx.render();
        } catch (e) { form.querySelector('.disc-form-error').textContent = e.message; }
      });
    });
  }
  function handleAction(action,target) {
    if (!action.startsWith('favorite-')) return false;
    if (action==='favorite-add') add();
    if (action==='favorite-refresh') { refresh();ctx.render(); }
    if (action==='favorite-remove') { if(!store)throw new Error(error);store.remove(target.dataset.id);ctx.render();ctx.toast('已取消收藏'); }
    if (action==='favorite-legacy-remove') { ctx.removeLegacySaved(target.dataset.id);ctx.render();ctx.toast('已取消收藏，原动态保留'); }
    return true;
  }
  return {render,handleAction};
}
