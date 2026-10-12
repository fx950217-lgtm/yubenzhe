import './live-social.css';
import {rosterCandidates,rosterKey,rosterFields,validateRosterSelection,saveRosterDraft,createDiscussionDraft} from './group-ai-roster.js';
import { EMOJI_GROUPS, STICKERS, getSticker, readChatImages, isSafeChatImage } from './chat-media.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const draftSessions = new Map();
function draftSession(userId) { if (!userId) return new Map(); if (!draftSessions.has(userId)) draftSessions.set(userId, new Map()); return draftSessions.get(userId); }
const nameOf = person => person?.nickname || ('用户 ' + (person?.userId || ''));
const stamp = value => { const date = new Date(Number(value) || value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : ''; };
const symbols = { plus: '<path d="M12 5v14M5 12h14"/>', scan: '<path d="M8 3H3v5m13-5h5v5m0 8v5h-5M8 21H3v-5M5 12h14"/>', friend: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m4-13v8m-4-4h8"/>', group: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>', back: '<path d="m14 5-7 7 7 7"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', send: '<path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3"/>', image: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 15 5-5 6 6 3-3 4 4M16 8h.1"/>', smile: '<circle cx="12" cy="12" r="9"/><path d="M8 9h.1M16 9h.1M8 14c2 3 6 3 8 0"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', check: '<path d="m5 12 4 4L19 6"/>' };
const icon = type => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (symbols[type] || symbols.group) + '</svg>';
const iconButton = (action, type, label, attrs = '') => '<button type="button" class="live-icon" data-action="' + action + '" aria-label="' + esc(label) + '" ' + attrs + '>' + icon(type) + '</button>';
export function safeProfilePhoto(person) {
  const value = person?.avatarImage;
  if (typeof value !== 'string') return '';
  if (value.length <= 750000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return value;
  const route = /^\/api\/social\/avatars\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (route.test(value)) return value;
  try { const url = new URL(value); if (url.protocol === 'https:' && url.hostname === '66.42.56.29' && !url.port && !url.username && !url.password && !url.search && !url.hash && route.test(url.pathname)) return url.href; } catch { /* Unsupported avatar locations are not rendered. */ }
  return '';
}
function avatar(person, group = false) { return '<span class="live-avatar' + (group ? ' is-group' : '') + '" aria-hidden="true">' + (group ? icon('group') : safeProfilePhoto(person) ? '<img loading="lazy" src="' + esc(safeProfilePhoto(person)) + '" alt=""/>' : esc(person?.avatar || nameOf(person).slice(0, 1))) + '</span>'; }
function badges(person) { return (Number.isSafeInteger(person?.level) && person.level > 0 ? '<small class="live-level">Lv.' + person.level + '</small>' : '') + (person?.official === true ? '<small class="live-official">官方</small>' : ''); }
function preview(message) { return message?.type === 'image' ? '[图片]' : message?.type === 'sticker' ? '[表情] ' + (getSticker(message.sticker)?.label || '') : message?.text || '还没有消息，打个招呼吧'; }
function safeReceivedImage(image) { return !!image && (typeof image.src === 'string' && image.src.startsWith('blob:') || isSafeChatImage(image)); }
export function trustedGroupWorkflow(message) { const event=message?.groupWorkflow;return !message?.removed&&event?.serverVerified===true&&typeof event.workflowId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(event.workflowId)&&typeof event.type==='string'?event:null; }
export function validateFriendId(value) { const id = String(value || '').trim().toLowerCase(); if (!/^[a-z0-9_]{5,24}$/.test(id)) throw new Error('请输入 5–24 位字母、数字或下划线好友 ID'); return id; }
export function invalidatedConversationIds(previous, next) { const available = new Map(next.map(item => [item.id, item])); return previous.filter(item => !available.has(item.id) || String(item.membershipRevision ?? '') !== String(available.get(item.id).membershipRevision ?? '') || String(item.contentRevision ?? '') !== String(available.get(item.id).contentRevision ?? '')).map(item => item.id); }
export function mergeMessages(current, incoming) { const byId = new Map(current.map(message => [message.id, message])); for (const message of incoming) if (message && typeof message.id === 'string') byId.set(message.id, message); return [...byId.values()].sort((a, b) => Number(a.createdAt) - Number(b.createdAt) || (/^[0-9]+$/.test(a.id) && /^[0-9]+$/.test(b.id) ? Number(a.id) - Number(b.id) : a.id.localeCompare(b.id))); }
export async function catchUpMessages(service, id, after, isCurrent = () => true) {
  let cursor = String(after), values = [], hasMore = false;
  for (let page = 0; page < 10 && isCurrent(); page++) {
    const result = await service.getMessages(id, { after: cursor });
    if (!isCurrent()) return null;
    if (!Array.isArray(result?.messages)) throw new Error('消息同步结果无效，请重试');
    values = mergeMessages(values, result.messages);
    const latest = result.messages.at(-1)?.id;
    if (latest && Number(latest) > Number(cursor)) cursor = latest;
    hasMore = Boolean(result.hasMore);
    if (!hasMore) break;
    if (!result.nextAfter || Number(result.nextAfter) <= Number(after) || result.nextAfter !== cursor) throw new Error('消息同步游标无效，请重试');
    after = cursor;
  }
  return { messages: values, cursor, hasMore };
}
export function validateGroup(name, memberIds, friendIds) { const cleanName = String(name || '').trim(); const ids = [...new Set(memberIds)]; if (!cleanName || cleanName.length > 24) throw new Error('请填写 1–24 字的群聊名称'); if (ids.length < 1 || ids.length > 199) throw new Error('请选择 1–199 位好友，与自己组成群聊'); if (ids.some(id => !friendIds.includes(id))) throw new Error('只能邀请当前好友，请重新选择成员'); return { name: cleanName, memberIds: ids }; }
export function privateDeviceEntries(value){return Array.isArray(value)?value.filter(item=>item?.kind==='device'&&typeof item.deviceId==='string'&&/^[a-f0-9-]{36}$/i.test(item.deviceId)&&item.id==='device:'+item.deviceId&&typeof item.name==='string'):[];}

export function groupAIEntries(item) {
  return item?.type === 'group' && Array.isArray(item.aiMembers) ? item.aiMembers.filter(row => row?.kind === 'ai' && typeof row.id === 'string' && typeof row.alias === 'string' && row.alias.trim()).slice(0,3).map(row => ({...row,alias:row.alias.slice(0,40),canChat:row.canChat === true && typeof row.deviceId === 'string' && /^[a-f0-9-]{36}$/i.test(row.deviceId)})) : [];
}

export async function prepareChatPhoto(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 照片');
  if (file.size > 20 * 1024 * 1024) throw new Error('原始照片不能超过 20 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => { const value = new Image(); value.onload = () => resolve(value); value.onerror = () => reject(new Error('无法读取这张照片，请换一张')); value.src = url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 80000000) throw new Error('照片尺寸过大，请选择较小的照片');
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('系统不支持照片处理');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob;
    for (const quality of [0.86, 0.72, 0.58, 0.42]) { blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality)); if (blob && blob.size <= 512 * 1024) break; }
    if (!blob || blob.size > 512 * 1024) throw new Error('压缩后的照片仍超过 512 KB，请裁剪或换一张');
    const [result] = await readChatImages([new File([blob], String(file.name || '照片').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })]);
    return { ...result, id: uid(), mime: 'image/jpeg', size: blob.size };
  } finally { URL.revokeObjectURL(url); }
}

// This screen talks only to the authenticated social API. The old demonstration
// store remains intact and is never uploaded or merged into real conversations.
export function mountLiveSocial(container, options = {}) {
  const { service, view = 'messages', toast = () => {}, onScan = () => {}, onNavigate = () => {}, onScreenChange = () => {}, initialProfileId, initialConversationId } = options;
  if (!service) throw new Error('社交服务未初始化');
  const root = document.createElement('section'); root.className = 'live-social'; root.setAttribute('aria-label', '好友与消息'); container.append(root);
  let state = { profile: options.profile || null, friends: [], requests: [], outgoingRequests: [], conversations: [] }, loaded = false, loadError = '', networkError = '', disposed = false, loadingState = false;
  let deviceEntries=[],deviceReadError='';
  let page = { type: 'list', view }, menu = false, modal = null, epoch = 0, lookupSequence = 0, busy = new Set(), timer;
  const permissionRevisions = new Map(), readThrough = new Map(), syncCursors = new Map();
  const replies = new Map(), messages = new Map(), messageErrors = new Map(), messageLoading = new Set(), olderCursors = new Map(), drafts = draftSession(options.profile?.userId), pending = new Map();
  const selfId = () => state.profile?.userId;
  const conversation = id => state.conversations.find(item => item.id === id);
  const peer = item => item?.members?.find(person => person.userId !== selfId());
  const title = item => item?.type === 'group' ? item.name : nameOf(peer(item));
  const friend = id => state.friends.find(person => person.userId === id);
  const isOwner = item => item?.ownerId === selfId();
  const isManager = item => isOwner(item) || item?.role === 'admin';
  const mayManage = (item,person) => isManager(item) && person.userId !== item.ownerId && person.userId !== selfId() && (isOwner(item) || person.role !== 'admin');
  const actionBusy = key => busy.has(key);
  const blocked = id => (state.blocked || []).some(person => person.userId === id);
  function safetyButtons(person) { if (!person || person.userId === selfId()) return ''; return '<button class="live-setting" data-action="block-user" data-id="' + esc(person.userId) + '">' + (blocked(person.userId) ? '解除拉黑' : '拉黑用户') + '<span aria-hidden="true">›</span></button><button class="live-setting" data-action="report-user" data-id="' + esc(person.userId) + '">举报用户<span aria-hidden="true">›</span></button>'; }
  function header(label, action = '') { return '<header class="live-header">' + (page.type !== 'list' ? iconButton('back', 'back', '返回') : page.view === 'contacts' ? iconButton('messages', 'back', '返回消息') : '') + '<h1>' + esc(label) + '</h1>' + action + '</header>'; }
  function empty(label, detail, action = '') { return '<div class="live-empty">' + icon('group') + '<h3>' + esc(label) + '</h3><p>' + esc(detail) + '</p>' + action + '</div>'; }
  function errorBox(text, action = '') { return text ? '<div class="live-error" role="alert"><span>' + esc(text) + '</span>' + (action ? '<button type="button" data-action="' + action + '">重试</button>' : '') + '</div>' : ''; }
  function personRow(person, action, extra = '') { return '<button type="button" class="live-person" data-action="' + action + '" data-id="' + esc(person.userId) + '">' + avatar(person) + '<span><strong>' + esc(nameOf(person)) + badges(person) + '</strong><small>ID：' + esc(person.userId) + '</small></span>' + extra + '</button>'; }
  function navigate(next) { menu = false; modal = null; epoch++; page = { ...next, previous: page }; render(); if (page.type === 'chat') void loadMessages(page.id); }
  function back() { if (disposed) return false; if (modal) { if (!modal.busy) { modal = null; renderModal(); } return true; } if (menu) { menu = false; renderMenu(); return true; } if (page.previous) { epoch++; page = page.previous; render(); return true; } if (page.type !== 'list') { epoch++; page = { type: 'list', view }; render(); return true; } return false; }
  function notify() { onScreenChange({ screen: page.type, conversationId: page.type === 'chat' ? page.id : null }); root.classList.toggle('is-chat', page.type === 'chat'); root.classList.toggle('is-contacts', page.type === 'list' && page.view === 'contacts'); root.classList.toggle('is-messages', page.type === 'list' && page.view === 'messages'); fitViewport(); }
  function fitViewport() { const viewport = globalThis.window?.visualViewport; if (viewport) { root.style.setProperty('--live-height', viewport.height + 'px'); root.style.setProperty('--live-top', viewport.offsetTop + 'px'); } }
  function rememberFocus() { const element = document.activeElement; return element && root.contains(element) && element.name ? { name: element.name, start: element.selectionStart, end: element.selectionEnd } : null; }
  function render() {
    if (disposed) return;
    const focus = rememberFocus(), scroll = root.querySelector('[data-messages]'), top = scroll?.scrollTop || 0, bottom = scroll ? scroll.scrollHeight - scroll.clientHeight - top < 70 : true;
    notify();
    let html = '';
    if (!loaded) html = header(view === 'contacts' ? '好友' : '消息') + (loadError ? errorBox(loadError, 'reload') : '<p class="live-loading" role="status">正在连接消息服务…</p>');
    else if (page.type === 'list') html = renderList();
    else if (page.type === 'lookup') html = renderLookup();
    else if (page.type === 'profile') html = renderProfile();
    else if (page.type === 'requests') html = renderRequests();
    else if (page.type === 'groups') html = renderGroups();
    else if (page.type === 'blocks') html = header('黑名单') + (state.blocked?.length ? state.blocked.map(person => personRow(person, 'profile')).join('') : empty('黑名单为空', '拉黑后会阻止双方私聊、好友申请及直接群邀请；共同群聊中的消息仍可见。'));
    else if (page.type === 'reports') html = header('我的举报', iconButton('reports-refresh','search','刷新举报记录')) + errorBox(page.error) + (page.reports ? page.reports.length ? page.reports.map(report => '<article class="live-report-record"><strong>' + esc(({user:'用户举报',message:'消息举报',group:'群聊举报',feedback:'帮助反馈',moment:'动态举报',comment:'评论举报'})[report.targetType] || '举报') + '</strong><span>' + ({pending:'等待处理',resolved:'已处理',rejected:'未采纳'})[report.status] + '</span><p>' + esc(report.detail || '无补充说明') + '</p>' + (report.resolution ? '<p>处理说明：' + esc(report.resolution) + '</p>' : '') + '<small>' + stamp(report.createdAt) + '</small></article>').join('') : empty('还没有举报', '提交后可以在这里查看处理进度。') : '<p class="live-loading">正在读取举报记录…</p>');
    else if (page.type === 'chat') html = renderChat();
    else if (page.type === 'details') html = renderDetails();
    root.innerHTML = html + '<div data-modal-host></div>';
    renderMenu(); renderModal();
    const currentScroll = root.querySelector('[data-messages]'); if (currentScroll) currentScroll.scrollTop = bottom ? currentScroll.scrollHeight : top;
    if (focus) { const element = [...root.querySelectorAll('input,textarea')].find(item => item.name === focus.name); if (element) { element.focus({ preventScroll: true }); if (typeof element.setSelectionRange === 'function' && focus.start !== null) element.setSelectionRange(focus.start, focus.end); } }
  }
  function renderMenu() {
    const host = root.querySelector('[data-menu]'); if (!host) return;
    host.innerHTML = menu ? '<div class="live-menu" role="menu" aria-label="消息快捷菜单">' + [['scan', 'scan', '扫一扫'], ['add-friend', 'friend', '添加好友'], ['create-group', 'group', '发起讨论组']].map(([action, symbol, label]) => '<button type="button" role="menuitem" data-action="' + action + '">' + icon(symbol) + esc(label) + '</button>').join('') + '</div>' : '';
    root.querySelector('[data-action="menu"]')?.setAttribute('aria-expanded', String(menu));
  }
  function renderList() {
    const contacts = page.view === 'contacts', query = String(page.query || '').trim().toLowerCase();
    const head = header(contacts ? '通讯录' : '消息', (contacts ? '' : '<button type="button" class="live-contacts-shortcut" data-action="contacts">' + icon('group') + '<span>通讯录</span></button>') + '<div class="live-quick">' + iconButton('menu', 'plus', '打开快捷菜单', 'aria-haspopup="menu" aria-expanded="' + menu + '"') + '<div data-menu></div></div>');
    const search = '<label class="live-search">' + icon('search') + '<input type="search" name="listQuery" placeholder="' + (contacts ? '搜索好友名字或 ID' : '搜索聊天名称') + '" aria-label="搜索" value="' + esc(page.query || '') + '"/></label>';
    let content;
    if (contacts) {
      const list = state.friends.filter(person => (nameOf(person) + ' ' + person.userId).toLowerCase().includes(query));
      content = '<div class="live-contact-tools"><button data-action="requests"><span class="live-contact-tool-icon">' + icon('friend') + '</span><strong>新的朋友</strong>' + (state.requests.length ? '<b>' + state.requests.length + '</b>' : '') + '<span class="live-contact-tool-detail">›</span></button><button data-action="groups"><span class="live-contact-tool-icon">' + icon('group') + '</span><strong>我的群聊</strong><span class="live-contact-tool-detail">' + state.conversations.filter(item => item.type === 'group').length + ' ›</span></button></div><button class="live-setting" data-action="blocks">黑名单<span>›</span></button><button class="live-setting" data-action="reports">我的举报<span>›</span></button><div class="live-section-title">我的好友 · ' + state.friends.length + '</div><div data-list-results>' + (list.length ? list.map(person => personRow(person, 'profile')).join('') : empty(query ? '没有找到好友' : '还没有好友', query ? '试试其他名字或 ID。' : '输入好友的公开 ID，等对方通过后即可聊天。', '<button class="live-primary" data-action="add-friend">添加好友</button>')) + '</div>';
    } else {
      const list = state.conversations.filter(item => title(item).toLowerCase().includes(query)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Number(b.updatedAt) - Number(a.updatedAt));
      content = '<div data-list-results>' + (list.length ? list.map(item => '<button class="live-conversation' + (item.pinned ? ' is-pinned' : '') + '" data-action="chat" data-id="' + esc(item.id) + '">' + avatar(peer(item), item.type === 'group') + '<span class="live-conversation-copy"><span><strong>' + esc(title(item)) + (item.type === 'group' && groupAIEntries(item).length > 0 ? '<small class="live-group-tag">AI×' + groupAIEntries(item).length + '</small>' : '') + '</strong><time>' + stamp(item.lastMessage?.createdAt) + '</time></span><span><small>' + esc(drafts.get(item.id) ? '[草稿] ' + drafts.get(item.id) : preview(item.lastMessage)) + '</small>' + (item.unread > 0 ? '<b class="live-count">' + Math.min(99, item.unread) + '</b>' : item.muted ? '<small>免打扰</small>' : '') + '</span></span></button>').join('') : deviceEntries.some(item=>item.name.toLowerCase().includes(query)) ? '' : empty(query ? '没有找到聊天' : '从一位好友开始', query ? '试试其他聊天名称。' : '添加好友或创建群聊，消息会同步到同账号的设备。', '<button class="live-primary" data-action="add-friend">添加好友</button>')) + '</div>';
    }
    const deviceRows=!contacts?deviceEntries.filter(item=>item.name.toLowerCase().includes(query)).map(item=>'<button type="button" class="live-conversation live-device-entry" data-action="device-chat" data-id="'+esc(item.deviceId)+'"><span class="live-avatar live-ai-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg><small class="live-ai-corner">AI</small></span><span class="live-conversation-copy"><span><strong>'+esc(item.name)+'</strong><small>'+esc(item.aiOnline===true?'在线':'离线')+'</small></span><span><small>'+esc(item.capabilities?.ai?.state==='unsupported'?'AI 暂不可用 · 查看说明':item.aiOnline===true?'和电脑上的 AI 聊聊':'AI 通道离线 · 等待连接')+'</small></span></span></button>').join(''):'';
    return head + errorBox(networkError, 'reload') + search + (deviceRows?'<div aria-label="我的设备会话" class="live-device-conversations">'+deviceRows+'</div>':'')+(!contacts&&deviceReadError?'<p class="live-note" role="status">'+esc(deviceReadError)+'</p>':'')+content+(!contacts?'<p class="live-private-note">AI 助手只有你能看到 · 不会出现在别人的列表里</p>':'');
  }
  function renderLookup() {
    const result = page.result;
    return header('添加好友') + '<form data-form="lookup"><label class="live-field">好友 ID<input name="friendId" autocapitalize="none" pattern="[A-Za-z0-9_]{5,24}" minlength="5" maxlength="24" required autocomplete="off" value="' + esc(page.userId || '') + '" placeholder="输入好友公开 ID"/></label><button class="' + (result ? 'secondary' : 'live-primary') + ' live-full" type="submit" ' + (actionBusy('lookup') ? 'disabled' : '') + '>' + (actionBusy('lookup') ? '正在查找…' : '查找好友') + '</button></form>' + errorBox(page.error) + (result ? profileCard(result.profile) + relationshipButton(result) + safetyButtons(result.profile) : '<p class="live-note">好友 ID 可以在对方的「我的 → 账号 → 个人资料」中查看。</p>');
  }
  function profileCard(person) { return '<section class="live-profile-card">' + avatar(person) + '<h2>' + esc(nameOf(person)) + badges(person) + '</h2><p>ID：' + esc(person.userId) + '</p><p>' + esc(person.bio || '这个人还没有填写个性签名。') + '</p></section>'; }
  function relationshipButton(result) {
    const relationship = result.relationship, person = result.profile;
    if (blocked(person.userId)) return '<p class="live-note">你已拉黑此用户。共同群聊中的消息仍可见。</p>';
    if (relationship === 'self') return '<p class="live-note">这是你自己的账号。</p>';
    if (relationship === 'friend') return '<button class="live-primary live-full" data-action="friend-chat" data-id="' + esc(person.userId) + '">发消息</button>';
    if (relationship === 'outgoing') return '<p class="live-note" role="status">好友申请已发送，等待对方通过。</p>';
    if (relationship === 'incoming' && result.requestId) return '<button class="live-primary live-full" data-action="accept" data-id="' + esc(result.requestId) + '">通过好友申请</button>';
    return '<button class="live-primary live-full" data-action="request-friend" data-id="' + esc(person.userId) + '" ' + (actionBusy('request-friend') ? 'disabled' : '') + '>添加好友</button><p class="live-note">对方通过申请后，才会开启聊天。</p>';
  }
  function renderProfile() { const result = page.result || (friend(page.userId) ? { profile: friend(page.userId), relationship: 'friend' } : null); return header('个人资料') + errorBox(result ? page.error : '') + (result ? profileCard(result.profile) + relationshipButton(result) + safetyButtons(result.profile) : page.error ? errorBox(page.error, 'profile-retry') : '<p class="live-loading">正在读取资料…</p>'); }
  function renderRequests() { return header('新的朋友') + errorBox(page.error) + '<div class="live-section-title">收到的申请</div>' + (state.requests.length ? state.requests.map(request => '<article class="live-request">' + avatar(request.from) + '<div><strong>' + esc(nameOf(request.from)) + '</strong><small>ID：' + esc(request.from.userId) + '</small>' + (request.greeting ? '<p class="live-greeting">'+esc(request.greeting)+'</p>' : '') + '<time>' + stamp(request.createdAt) + '</time></div><div><button class="live-request-approve" data-action="accept" data-id="' + esc(request.id) + '" ' + (actionBusy('request:' + request.id) ? 'disabled' : '') + '>通过</button><button class="live-text" data-action="reject" data-id="' + esc(request.id) + '" ' + (actionBusy('request:' + request.id) ? 'disabled' : '') + '>忽略</button><button class="live-text" data-action="block-user" data-id="'+esc(request.from.userId)+'">拉黑</button><button class="live-text" data-action="report-user" data-id="'+esc(request.from.userId)+'">举报</button></div></article>').join('') : empty('没有新的申请', '收到好友申请后会显示在这里。')) + '<div class="live-section-title">已发出的申请</div>' + (state.outgoingRequests?.length ? state.outgoingRequests.map(request => '<article class="live-request">' + avatar(request.to) + '<div><strong>' + esc(nameOf(request.to)) + '</strong><small>ID：' + esc(request.to.userId) + '</small></div><small>等待通过</small></article>').join('') : '<p class="live-note">没有等待通过的申请。</p>'); }
  function renderGroups() { const groups = state.conversations.filter(item => item.type === 'group'); return header('我的群聊', iconButton('create-group', 'plus', '创建群聊')) + (groups.length ? groups.map(item => '<button class="live-person" data-action="chat" data-id="' + esc(item.id) + '">' + avatar(null, true) + '<span><strong>' + esc(item.name) + '</strong><small>' + item.members.length + ' 位成员</small></span></button>').join('') : empty('还没有群聊', '选择至少一位好友，共同创建一个群聊。', '<button class="live-primary" data-action="create-group">创建群聊</button>')); }
  function renderMessage(message, item) {
    const person = item.members.find(member => member.userId === message.senderId), mine = message.senderId === selfId();
    const taskEvent=trustedGroupWorkflow(message);
    let content = '<p class="live-bubble">' + esc(message.text) + '</p>';
    if (message.type === 'image') content = safeReceivedImage(message.image) ? '<button class="live-photo-message" data-action="view-image" data-id="' + esc(message.id) + '"><img loading="lazy" src="' + esc(message.image.src) + '" alt="' + esc(message.image.name || '聊天照片') + '"/></button>' : '<div class="live-bubble live-media-error"><span>照片暂时无法加载</span><small>' + esc(message.mediaError || '请检查网络后重试。') + '</small><button type="button" class="live-text" data-action="retry-image" data-id="' + esc(message.id) + '" ' + (messageLoading.has(item.id) ? 'disabled' : '') + '>重新加载照片</button></div>';
    if(message.gift&&!message.removed)content='<div class="live-gift-card"><strong>历史测试记录</strong><span>旧模拟红包已停止，不可领取或转账</span></div>';
    if (message.type === 'sticker') { const sticker = getSticker(message.sticker); content = sticker ? '<div class="live-sticker"><span>' + sticker.emoji + '</span><small>' + esc(sticker.label) + '</small></div>' : '<p class="live-bubble">表情暂不支持</p>'; }
    if(taskEvent&&item.type==='group')content='<section class="live-workflow-event"><strong>YBZ 任务系统记录</strong><p>'+esc(message.text)+'</p><small>当前状态：'+esc(({planning:'拟定方案',"proposal-ready":'等待批准',blocked:'配置阻塞',executing:'执行中',"awaiting-acceptance":'等待验收',accepted:'已验收',"awaiting-signature":'等待本人签署',"payment-pending":'等待核验',paid:'回执已核验',"payment-unknown":'付款状态未知',"payment-mismatch":'付款不匹配',"payment-failed":'付款失败',cancelled:'任务已取消'})[taskEvent.currentStatus]||'请查看任务')+'</small>'+(options.onGroupTask?'<button type="button" class="live-text" data-action="workflow-event" data-id="'+esc(message.id)+'">查看任务与回执</button>':'')+'</section>';
    if(!message.removed&&message.deviceAI?.serverVerified===true)content='<section class="live-ai-reply"><strong>'+esc(message.deviceAI.alias||message.deviceAI.provider)+' · AI</strong><p>'+esc(message.text)+'</p><small>'+esc((mine?'我':person?nameOf(person):'成员')+'授权分享 · 临时中转')+'</small></section>';
    return '<article class="live-message' + (mine && !message.deviceAI ? ' is-mine' : '') + (message.deviceAI?.serverVerified===true?' is-ai':'') + '" data-message-id="' + esc(message.id) + '">' + avatar(person || { nickname: '已离群用户' }) + '<div>' + (item.type === 'group' && !mine ? '<small class="live-sender">' + esc(person ? nameOf(person) : '已离群用户') + '</small>' : '') + (message.reply?'<blockquote class="live-reply-quote">'+esc(message.reply.unavailable?'引用消息不可见或已移除':message.reply.senderId+'：'+message.reply.text)+'</blockquote>':'') + content + '<div class="live-message-meta"><time>' + stamp(message.createdAt) + '</time>' + (!message.removed ? '<button type="button" class="live-message-action" data-action="reply" data-id="'+esc(message.id)+'" aria-label="引用回复此消息">回复</button>' : '') + (!mine && !message.removed ? '<button type="button" class="live-message-action" data-action="report-message" data-id="' + esc(message.id) + '" aria-label="举报此消息">···</button>' : '') + '</div></div></article>';
  }
  function groupMemberStrip(item) {
    if(item.type !== 'group')return '';
    const ais=groupAIEntries(item);
    return '<p class="live-group-count">'+item.members.length+' 人 · '+ais.length+' 个 AI</p><nav class="live-group-strip" aria-label="讨论组成员">'+item.members.map(person=>'<button type="button" data-action="profile" data-id="'+esc(person.userId)+'">'+avatar(person)+'<span>'+esc(nameOf(person))+'</span></button>').join('')+ais.map(ai=>'<button type="button" class="live-group-ai-member" data-action="group-ai-chat" data-id="'+esc(ai.id)+'" '+(ai.canChat?'':'disabled')+' aria-label="'+esc(ai.alias+(ai.canChat?'，打开单聊':'，仅设备主人可单聊'))+'"><span class="live-avatar live-ai-avatar">AI</span><span>'+esc(ai.alias)+'</span></button>').join('')+'</nav>';
  }
  function renderChat() {
    const item = conversation(page.id);
    if (!item) return header('聊天') + empty('当前聊天不可用', '好友关系或群成员状态已变化，请返回消息列表。');
    const list = messages.get(page.id) || [], unsent = pending.get(page.id), query = String(page.query || '').trim().toLowerCase(), visible = query ? list.filter(message => !message.deviceAI&&preview(message).toLowerCase().includes(query)) : list;
    return '<div class="live-chat">' + header(title(item), iconButton('details', 'more', '聊天详情')) + groupMemberStrip(item) + errorBox(networkError) + (item.note ? '<p class="live-announcement"><strong>群公告</strong> ' + esc(item.note) + '</p>' : '') + (page.search ? '<label class="live-search">' + icon('search') + '<input name="chatQuery" type="search" placeholder="搜索已加载的聊天记录" value="' + esc(page.query || '') + '"/>' + iconButton('close-search', 'close', '关闭搜索') + '</label>' : '') + '<div class="live-chat-messages" data-messages aria-live="polite">' + (olderCursors.get(page.id) ? '<button class="live-text live-older" data-action="older" ' + (messageLoading.has(page.id) ? 'disabled' : '') + '>加载更早消息</button>' : '') + errorBox(messageErrors.get(page.id), 'messages-retry') + (!list.length && messageLoading.has(page.id) ? '<p class="live-loading">正在加载消息…</p>' : visible.length ? visible.map(message => renderMessage(message, item)).join('') : empty(query ? '没有找到相关消息' : '从一声你好开始', query ? '可加载更早消息后继续搜索。' : '写下第一句话，发给你的好友。')) + '</div>' + (unsent ? '<div class="live-send-status" role="status">' + esc(unsent.error || '正在发送…') + (unsent.error ? '<button class="live-text" data-action="retry-send">重试发送</button><button class="live-text" data-action="cancel-send">取消重试</button>' : '') + '</div>' : '') + '<div class="live-composer">'+(item.silencedUntil>Date.now()?'<p class="live-note">本群禁言至 '+stamp(item.silencedUntil)+'，仍可阅读消息。</p>':'')+(replies.has(page.id)?'<div class="live-reply-draft"><span>引用：'+esc(preview(replies.get(page.id)))+'</span><button type="button" class="live-text" data-action="cancel-reply">取消</button></div>':'')+'<form data-form="message">' + (options.onGift?iconButton('send-gift','plus','红包与空投说明'):'') + iconButton('emoji', 'smile', '表情') + '<input name="message" maxlength="2000" autocomplete="off" placeholder="说点什么…" aria-label="消息内容" value="' + esc(drafts.get(page.id) || '') + '"/>' + iconButton('photo', 'image', '发送照片') + '<button type="submit" class="live-icon live-send" aria-label="发送消息" ' + (unsent ? 'disabled' : '') + '>' + icon('send') + '</button></form><input type="file" data-chat-photo accept="image/jpeg,image/png,image/webp" hidden/>' + (page.emoji ? '<div class="live-emoji-panel"><div>' + EMOJI_GROUPS.flatMap(group => group.emojis).map(emoji => '<button type="button" data-action="pick-emoji" data-emoji="' + esc(emoji) + '">' + emoji + '</button>').join('') + '</div><p>贴纸 · 点击发送</p><div>' + STICKERS.map(sticker => '<button type="button" data-action="sticker" data-id="' + sticker.id + '" aria-label="' + esc(sticker.label) + '" ' + (unsent ? 'disabled' : '') + '>' + sticker.emoji + '</button>').join('') + '</div></div>' : '') + '</div></div>';
  }
  function renderDetails() {
    const item = conversation(page.id); if (!item) return header('聊天详情') + empty('聊天已不可用', '请返回消息列表。');
    const group = item.type === 'group';
    return header('聊天详情') + (group?'<button class="live-setting" data-action="edit-ai-roster">AI 名单与备注<span>›</span></button>':'')+(group&&options.onGroupAI?'<button class="live-setting" data-action="group-ai">设备 AI 讨论<span>›</span></button>':'')+(group&&options.onGroupTask?'<button class="live-setting" data-action="group-task">协作任务与回执<span>›</span></button>':'') + '<section class="live-profile-card">' + avatar(peer(item), group) + '<h2>' + esc(title(item)) + '</h2><p>' + (group ? item.members.length + ' 位成员' : 'ID：' + esc(peer(item)?.userId)) + '</p></section>' + (group ? '<div class="live-section-title">群成员</div><div class="live-members">' + item.members.map(person => '<button data-action="profile" data-id="' + esc(person.userId) + '">' + avatar(person) + '<strong>' + esc(nameOf(person)) + '</strong><small>' + (person.userId === item.ownerId ? '群主' : person.role === 'admin' ? '管理员' : person.userId === selfId() ? '我' : '成员') + '</small></button>').join('') + '</div><button class="live-setting" data-action="invite-members">邀请好友进群<span>›</span></button>' + (isManager(item) ? '<button class="live-setting" data-action="edit-group">群名与公告<span>编辑 ›</span></button><button class="live-setting" data-action="manage-members">管理群成员<span>›</span></button><button class="live-setting" data-action="join-requests">入群审批<span>'+ (item.joinRequests?.length||0)+' ›</span></button>' : '')+(isOwner(item)?'<button class="live-setting" data-action="toggle-approval" role="switch" aria-checked="'+!!item.joinApproval+'">成员邀请需审批<span>'+(item.joinApproval?'已开启':'已关闭')+'</span></button><button class="live-setting" data-action="transfer-owner">转让群主<span>›</span></button>':'') : personRow(peer(item), 'profile')) + '<button class="live-setting" data-action="search-chat">查找聊天内容<span>›</span></button>' + [['pinned', '置顶聊天'], ['muted', '消息免打扰']].map(([key, label]) => '<button class="live-setting" data-action="toggle" data-key="' + key + '" role="switch" aria-checked="' + !!item[key] + '">' + label + '<span class="live-switch' + (item[key] ? ' is-on' : '') + '"></span></button>').join('') + (group ? '<button class="live-setting" data-action="report-group" data-id="' + esc(item.id) + '">举报群聊<span>›</span></button>' : safetyButtons(peer(item))) + '<p class="live-note">普通聊天消息由服务器保存；设备 AI 回复仅临时中转。新加入或重新入群只能查看本次入群后的消息。普通聊天尚未提供端到端加密。钱包转账与分发以测试网配置及真实回执为准，不提供托管资产。</p><button class="live-danger live-full" data-action="' + (group ? 'leave-group' : 'remove-friend') + '">' + (group ? '退出群聊' : '删除好友') + '</button>';
  }
  function openModal(type, values = {}) { menu = false; modal = { type, ...values }; renderMenu(); renderModal(); }
  const rosterCurrent=target=>!disposed&&modal===target&&selfId()===target.ownerId&&(!service.getProfile||service.getProfile()?.userId===target.ownerId);
  async function loadRosterEditor(target){
    if(!rosterCurrent(target)||target.busy||target.aiLoading)return;
    target.aiLoading=true;target.aiError='';renderModal();
    try{
      const reads=await Promise.allSettled([service.authenticatedRequest('devices',{method:'GET'}),target.conversationId?service.authenticatedRequest('group-device-ai/groups/'+encodeURIComponent(target.conversationId)+'/roster',{method:'GET'}):Promise.resolve({version:0,canManage:true,members:[]})]);
      if(!rosterCurrent(target))return;
      if(reads[1].status!=='fulfilled')throw reads[1].reason;
      const roster=reads[1].value;if(!Number.isSafeInteger(roster?.version)||!Array.isArray(roster.members))throw Error('AI 名单读取结果无效');
      target.aiVersion=roster.version;target.aiCanManage=roster.canManage===true;
      if(target.conversationId)target.aiMembers=roster.members.map(row=>({...row}));
      target.aiCandidates=reads[0].status==='fulfilled'?rosterCandidates(reads[0].value?.devices):[];
      target.rosterCommand=null;
      if(reads[0].status==='rejected'&&target.aiCanManage)throw Error('我的电脑暂不可用，可重新读取；不能确认新增 AI');
    }catch(error){if(rosterCurrent(target)&&!staleResponse(error))target.aiError=error.message||'AI 名单暂不可用';}
    finally{if(rosterCurrent(target)){target.aiLoading=false;renderModal();}}
  }
  function openRosterEditor(type,values={}){openModal(type,{ownerId:selfId(),aiMembers:[],aiCandidates:[],aiVersion:0,aiCanManage:true,...values});void loadRosterEditor(modal);}
  async function submitDiscussion(target,input){
    if(!rosterCurrent(target)||target.busy)return;
    target.busy=true;target.error='';renderModal();
    try{
      const result=target.type==='group'?await createDiscussionDraft(service,target,input,()=>rosterCurrent(target)):await saveRosterDraft(service,target,()=>rosterCurrent(target));
      if(!rosterCurrent(target))return;
      await refresh(true);if(!rosterCurrent(target))return;
      const id=target.conversationId||result.conversationId;modal=null;render();if(target.type==='group')openChat(id);toast(target.type==='group'?(target.aiMembers?.length?'讨论组已创建，AI 名单已保存；尚未开始执行':'讨论组已创建'):'AI 名单已保存');
    }catch(error){if(rosterCurrent(target)&&!staleResponse(error)){target.error=error.message||'保存未确认，请重试';if(error.status===409)target.aiError='名单已发生变化，请重新读取后确认。';}}
    finally{target.busy=false;if(rosterCurrent(target))renderModal();}
  }
  function renderModal() {
    const host = root.querySelector('[data-modal-host]'); if (!host) return; if (!modal) { host.innerHTML = ''; return; }
    const item = conversation(modal.conversationId), selected = modal.selected || [], disabled = modal.busy ? 'disabled' : '';
    let label = '', content = '';
    if (modal.type === 'report') {
      label = '提交举报'; content = '<form data-form="report"><p class="live-note">举报将保存到服务器供运营审核，请如实描述。提交后可在通讯录的“我的举报”查看进度。</p><label class="live-field">举报原因<select name="reportReason">' + [['spam','垃圾广告'],['harassment','骚扰辱骂'],['fraud','诈骗'],['illegal','违法内容'],['other','其他']].map(([value,label]) => '<option value="' + value + '"' + (modal.reason === value ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label><label class="live-field">补充说明<textarea name="reportDetail" maxlength="1000" rows="4" placeholder="描述具体情况（选填）">' + esc(modal.detail || '') + '</textarea></label>' + errorBox(modal.error) + '<button class="live-primary live-full" type="submit" ' + disabled + '>' + (modal.busy ? '正在提交…' : '提交举报') + '</button></form>';
    } else if (['group', 'invite'].includes(modal.type)) {
      label = modal.type === 'group' ? '发起讨论组' : '邀请好友进群';
      const available = state.friends.filter(person => !blocked(person.userId)).filter(person => modal.type === 'group' || !item?.members.some(member => member.userId === person.userId));
      const filtered = available.filter(person => (nameOf(person) + ' ' + person.userId).toLowerCase().includes(String(modal.query || '').toLowerCase()));
      const locked=modal.busy||modal.groupCreated?'disabled':'';
      content = available.length||modal.groupCreated ? '<form data-form="' + modal.type + '">' + (modal.type === 'group' ? '<label class="live-field">群聊名称<input name="groupName" maxlength="24" value="' + esc(modal.name || '') + '" required placeholder="给群聊起个名字" '+locked+'/></label>' : '') + (!modal.groupCreated?'<label class="live-field">选择好友<input name="memberQuery" type="search" value="' + esc(modal.query || '') + '" placeholder="搜索好友"/></label><p class="live-note" data-selection-count>已选择 ' + selected.length + ' 位' + (modal.type === 'group' ? '，至少选择 1 位好友' : '') + '</p><div class="live-select-members">' + (filtered.length ? filtered.map(person => '<label>' + avatar(person) + '<span><strong>' + esc(nameOf(person)) + '</strong><small>ID：' + esc(person.userId) + '</small></span><input type="checkbox" name="memberIds" value="' + esc(person.userId) + '" ' + (selected.includes(person.userId) ? 'checked ' : '') + disabled + '/></label>').join('') : '<p class="live-note">没有匹配的好友。</p>') + '</div>':'<p class="live-note" role="status">讨论组已经创建；这里重试只保存 AI 名单，不会重复建群。</p>') + (modal.type==='group'?rosterFields(modal,disabled):'') + errorBox(modal.error) + '<button class="live-primary live-full" type="submit" ' + disabled + '>' + (modal.busy ? '正在保存…' : modal.groupCreated?'重试保存 AI 名单':label) + '</button>'+(modal.groupCreated?'<button type="button" class="live-setting" data-action="open-created-group" '+disabled+'>进入已创建的讨论组</button>':'')+'</form>' : empty(modal.type === 'group' ? '需要先添加好友' : '好友都在群里了', modal.type === 'group' ? '添加一位好友，即可创建群聊。' : '添加新的好友后再邀请。', '<button class="live-primary" data-action="add-friend">添加好友</button>');
    } else if(modal.type==='ai-roster'){
      label='AI 名单与备注';content='<form data-form="ai-roster">'+rosterFields(modal,disabled)+errorBox(modal.error)+(modal.aiCanManage?'<button class="live-primary live-full" type="submit" '+(modal.busy||modal.aiLoading?'disabled':'')+'>保存名单</button>':'')+'</form>';
    } else if (modal.type === 'edit-group') {
      label = '群名与公告'; content = '<form data-form="group-details"><label class="live-field">群聊名称<input name="groupName" maxlength="24" required value="' + esc(modal.name) + '"/></label><label class="live-field">群公告<textarea name="groupNote" maxlength="300" rows="4">' + esc(modal.note) + '</textarea></label>' + errorBox(modal.error) + '<button class="live-primary live-full" type="submit" ' + disabled + '>保存</button></form>';
    } else if (modal.type === 'members') {
      label = '管理群成员'; const available = item?.members.filter(person => mayManage(item,person)) || [];
      content = errorBox(modal.error)+'<p class="live-note">管理员可管理普通成员；仅群主可变更管理员。移除后不能继续读取群消息。</p>' + available.map(person => '<article class="live-request">' + avatar(person) + '<div><strong>' + esc(nameOf(person)) + '</strong><small>ID：' + esc(person.userId) + '</small></div><div class="live-member-actions">'+(isOwner(item)?'<button class="live-text" data-action="member-role" data-id="'+esc(person.userId)+'" '+disabled+'>'+(person.role==='admin'?'撤销管理员':'设为管理员')+'</button>':'')+'<button class="live-text" data-action="member-silence" data-id="'+esc(person.userId)+'" '+disabled+'>'+(person.silencedUntil>Date.now()?'解除禁言':'禁言 1 小时')+'</button><button class="live-danger" data-action="remove-member" data-id="' + esc(person.userId) + '" '+disabled+'>移除</button></div></article>').join('');
    } else if (modal.type === 'joins') {
      label='入群审批';content=errorBox(modal.error)+(item?.joinRequests?.length?item.joinRequests.map(request=>'<article class="live-request"><div><strong>'+esc(nameOf(request.target))+'</strong><small>由 '+esc(nameOf(request.inviter))+' 邀请</small></div><button class="live-text" data-action="approve-join" data-id="'+esc(request.id)+'" '+disabled+'>通过</button><button class="live-text" data-action="reject-join" data-id="'+esc(request.id)+'" '+disabled+'>拒绝</button></article>').join(''):'<p class="live-note">没有待审批的邀请。</p>');
    } else if (modal.type === 'owner') {
      label = '转让群主'; const available = item?.members.filter(person => person.userId !== selfId()) || [];
      content = '<p class="live-note">转让后，对方可以修改群资料、管理成员与再次转让。</p><form data-form="owner"><div class="live-select-members">' + available.map(person => '<label>' + avatar(person) + '<span>' + esc(nameOf(person)) + '</span><input type="radio" name="ownerId" value="' + esc(person.userId) + '" required ' + disabled + '/></label>').join('') + '</div>' + errorBox(modal.error) + '<button class="live-primary live-full" type="submit" ' + disabled + '>确认转让</button></form>';
    } else if (modal.type === 'confirm') {
      label = modal.label; content = '<p class="live-note">' + esc(modal.detail) + '</p>' + errorBox(modal.error) + '<button class="live-danger live-full" data-action="confirm-operation" ' + disabled + '>' + (modal.busy ? '处理中…' : '确认' + modal.label) + '</button>';
    } else if (modal.type === 'photo') {
      label = '发送照片'; content = modal.reading ? '<p class="live-loading">正在压缩和检查照片…</p>' : (modal.image ? '<img class="live-image-preview" src="' + esc(modal.image.src) + '" alt="待发送照片"/><p class="live-note">压缩后 ' + Math.ceil(modal.image.size / 1024) + ' KB</p>' : '') + errorBox(modal.error) + '<button class="live-primary live-full" data-action="send-photo" ' + (!modal.image || modal.busy ? 'disabled' : '') + '>发送照片</button>';
    } else if (modal.type === 'gallery') {
      label = '聊天照片'; content = modal.error ? errorBox(modal.error) + '<button class="live-primary live-full" data-action="retry-gallery">重新加载照片</button>' : '<img class="live-image-preview" src="' + esc(modal.image?.src) + '" alt="' + esc(modal.image?.name || '聊天照片') + '"/>';
    }
    host.innerHTML = '<div class="live-backdrop" data-dismiss><section class="live-dialog" role="dialog" aria-modal="true" aria-labelledby="live-dialog-title"><header><h2 id="live-dialog-title">' + esc(label) + '</h2>' + iconButton('close-modal', 'close', '关闭') + '</header>' + content + '</section></div>';
  }

  let statePromise = null, snapshotSignature = '', composing = false, pollRunning = false;
  const staleResponse = error => ['SESSION_CHANGED', 'STALE_RESPONSE'].includes(error?.code);
  async function refresh(force = false) {
    if (disposed) return;
    if (statePromise) { await statePromise; if (force && !disposed) return refresh(false); return; }
    loadingState = true;
    statePromise = (async () => {
      try {
        const results=await Promise.allSettled([service.getState(),service.authenticatedRequest?service.authenticatedRequest('devices/conversations'):Promise.resolve({conversations:[]})]);if(disposed)return;if(results[0].status==='rejected')throw results[0].reason;const next=results[0].value;
        if (!next?.profile?.userId || !Array.isArray(next.friends) || !Array.isArray(next.conversations) || !Array.isArray(next.requests)) throw new Error('消息服务返回了不完整的数据，请重试');
        const devices=results[1].status==='fulfilled'?privateDeviceEntries(results[1].value?.conversations):[];deviceReadError=results[1].status==='rejected'?'设备入口暂时无法同步，可从工作台的“我的设备”查看。':'';
        const signature = JSON.stringify({state:next,devices,deviceReadError}), changed = signature !== snapshotSignature || !loaded || !!loadError || !!networkError;deviceEntries=devices;
        for (const id of invalidatedConversationIds(state.conversations, next.conversations)) { permissionRevisions.set(id, (permissionRevisions.get(id) || 0) + 1); messages.delete(id); replies.delete(id); messageErrors.delete(id); olderCursors.delete(id); pending.delete(id); readThrough.delete(id); syncCursors.delete(id); if (['gallery','photo'].includes(modal?.type) && modal.conversationId === id) modal = null; }
        state = next; loaded = true; loadError = ''; networkError = ''; snapshotSignature = signature;
        if (page.result?.profile) { const updated = state.friends.find(person => person.userId === page.result.profile.userId); if (updated) page.result = { profile: updated, relationship: 'friend' }; else if (page.result.relationship === 'friend') page.result.relationship = 'none'; }
        if (changed && !composing) render();
      } catch (error) { if (staleResponse(error)) return; if (!disposed) { if (!loaded) loadError = error.message || '连接失败，请检查网络后重试'; else networkError = '暂时无法同步新消息：' + (error.message || '网络连接中断'); if (!composing) render(); } }
      finally { loadingState = false; }
    })();
    try { await statePromise; } finally { statePromise = null; }
  }
  async function loadMessages(id, older = false, retryMessageId = null) {
    if (disposed || messageLoading.has(id) || !conversation(id)) return;
    messageLoading.add(id); if (!messages.has(id) && page.type === 'chat' && page.id === id) render();
    const permissionRevision = permissionRevisions.get(id) || 0;
    const cached = messages.get(id) || [], retryIndex = retryMessageId ? cached.findIndex(message => message.id === retryMessageId) : -1;
    const before = retryIndex >= 0 ? cached[retryIndex + 1]?.id : older ? olderCursors.get(id) : undefined;
    try {
      const catchingUp = !older && !retryMessageId && syncCursors.has(id);
      const current = () => !disposed && !!conversation(id) && permissionRevision === (permissionRevisions.get(id) || 0);
      const result = catchingUp ? await catchUpMessages(service, id, syncCursors.get(id), current) : await service.getMessages(id, before ? { before } : {}); if (!current() || !result) return;
      if (catchingUp) syncCursors.set(id, result.cursor); else if (!older && !retryMessageId) syncCursors.set(id, result.messages.at(-1)?.id || String(conversation(id)?.historyStartId || 0));
      messageLoading.delete(id); const firstLoad = !messages.has(id);
      if (!Array.isArray(result?.messages)) throw new Error('消息内容读取失败');
      const beforeList = messages.get(id) || [], merged = mergeMessages(beforeList, result.messages);
      const changed = JSON.stringify(merged) !== JSON.stringify(beforeList) || !!messageErrors.get(id);
      messages.set(id, merged); messageErrors.delete(id);
      if (modal?.type === 'gallery' && modal.conversationId === id) { const refreshed = merged.find(message => message.id === modal.messageId); if (safeReceivedImage(refreshed?.image)) { modal.image = refreshed.image; modal.error = ''; } else modal.error = refreshed?.mediaError || '照片暂时无法加载，请重试。'; }
      if (!catchingUp && (older || !olderCursors.has(id))) olderCursors.set(id, result.nextBefore || null);
      if (page.type === 'chat' && page.id === id) {
        if ((changed || older || firstLoad) && !composing) { const list = root.querySelector('[data-messages]'), previousHeight = list?.scrollHeight || 0, previousTop = list?.scrollTop || 0; render(); if (older) { const after = root.querySelector('[data-messages]'); if (after) after.scrollTop = previousTop + after.scrollHeight - previousHeight; } }
        const latestId = syncCursors.get(id) || merged.at(-1)?.id;
        if (!globalThis.document?.hidden && latestId && readThrough.get(id) !== latestId) { try { await service.markRead(id, { throughId: latestId }); if (!disposed && permissionRevision === (permissionRevisions.get(id) || 0)) readThrough.set(id, latestId); } catch { /* A read receipt never blocks opening or sending a message. */ } }
      }
    } catch (error) { messageLoading.delete(id); if (staleResponse(error)) return; if (!disposed && conversation(id) && permissionRevision === (permissionRevisions.get(id) || 0)) { messageErrors.set(id, error.message || '消息读取失败，请重试'); if (page.type === 'chat' && page.id === id && !composing) render(); } }
    finally { messageLoading.delete(id); }
  }
  async function perform(key, operation, complete, context = null) {
    if (disposed || busy.has(key)) return;
    busy.add(key); if (context?.modal) context.modal.busy = true; render();
    try { const result = await operation(); if (disposed) return; await refresh(true); if (disposed) return; await complete?.(result); }
    catch (error) {
      if (disposed || staleResponse(error)) return;
      const message = error.message || '操作未完成，请重试';
      if (context?.modal && modal === context.modal) modal.error = message;
      else if (context?.page && page === context.page) page.error = message;
      else toast(message);
    } finally { busy.delete(key); if (context?.modal) context.modal.busy = false; if (!disposed) render(); }
  }
  async function loadReports() { const destination = page; try { const result = await service.getReports(); if (!disposed && page === destination) { destination.reports = result.reports; destination.error = ''; render(); } } catch(error) { if (!disposed && page === destination && !staleResponse(error)) { destination.error = error.message; render(); } } }
  async function lookup(id, destination = page) {
    if (busy.has('lookup')) return;
    let userId;
    try { userId = validateFriendId(id); } catch (error) { destination.error = error.message; render(); return; }
    const sequence = ++lookupSequence; destination.userId = userId; destination.result = null; destination.error = ''; busy.add('lookup'); render();
    try { const result = await service.lookup(userId); if (disposed || sequence !== lookupSequence || page !== destination) return; if (!result?.profile?.userId) throw new Error('没有找到这个 ID'); destination.result = result; }
    catch (error) { if (staleResponse(error)) return; if (!disposed && sequence === lookupSequence && page === destination) destination.error = error.message || '查找失败，请重试'; }
    finally { if (sequence === lookupSequence) busy.delete('lookup'); if (!disposed && page === destination) render(); }
  }
  function openChat(id) { if (!conversation(id)) { toast('聊天暂不可用，请刷新好友列表'); return; } if (page.type === 'chat' && page.id === id) return; navigate({ type: 'chat', id }); }
  async function openFriendChat(id) { let item = state.conversations.find(value => value.type === 'direct' && value.members.some(member => member.userId === id)); if (!item) { await refresh(true); if (disposed) return; item = state.conversations.find(value => value.type === 'direct' && value.members.some(member => member.userId === id)); } if (item) openChat(item.id); else toast('好友聊天尚未同步，请稍后重试'); }
  async function send(id, payload, retry = false) {
    if (disposed || !conversation(id)) return;
    if (conversation(id).silencedUntil > Date.now()) { toast('你当前在本群禁言中，仍可阅读消息'); return; }
    if (conversation(id).blocked) { toast('当前无法向此用户发送私聊消息，请先检查黑名单'); return; }
    const permissionRevision = permissionRevisions.get(id) || 0;
    let operation = pending.get(id);
    if (operation && (!retry || !operation.error)) return;
    if (!operation) { operation = { payload: { clientId: uid(), ...payload, ...(replies.has(id)?{replyToId:replies.get(id).id}:{}) }, error: '', sending: false }; pending.set(id, operation); }
    if (operation.sending) return;
    operation.error = ''; operation.sending = true; if (page.type === 'chat' && page.id === id) render();
    try {
      const result = await service.sendMessage(id, operation.payload);
      if (!conversation(id) || permissionRevision !== (permissionRevisions.get(id) || 0)) return;
      if (!result?.message?.id) throw new Error('未收到服务器确认，可安全重试这条消息');
      messages.set(id, mergeMessages(messages.get(id) || [], [result.message]));
      if (operation.payload.type === 'text' && (drafts.get(id) || '').trim() === operation.payload.text) drafts.delete(id);
      if(replies.get(id)?.id===operation.payload.replyToId)replies.delete(id);
      pending.delete(id); if (disposed) return; await refresh(true); if (disposed) return;
      if (page.type === 'chat' && page.id === id) { render(); const list = root.querySelector('[data-messages]'); if (list) list.scrollTop = list.scrollHeight; root.querySelector('[name="message"]')?.focus({ preventScroll: true }); }
    } catch (error) { if (!disposed && conversation(id) && permissionRevision === (permissionRevisions.get(id) || 0)) { operation.error = '未发送成功：' + (error.message || '网络连接中断'); if (page.type === 'chat' && page.id === id) render(); else toast(operation.error); } }
    finally { operation.sending = false; }
  }
  async function choosePhoto(file) {
    if (!file || page.type !== 'chat') return; if (pending.has(page.id)) { toast('请先处理上一条未确认的消息'); return; }
    const conversationId = page.id; openModal('photo', { reading: true, conversationId }); const target = modal;
    try { const image = await prepareChatPhoto(file); if (disposed || modal !== target) return; target.image = image; }
    catch (error) { if (!disposed && modal === target) target.error = error.message; }
    finally { if (!disposed && modal === target) { target.reading = false; renderModal(); } }
  }
  function onClick(event) {
    if (event.target.matches('[data-dismiss]')) { if (!modal?.busy) { modal = null; renderModal(); } return; }
    const target = event.target.closest('[data-action]'); if (!target || !root.contains(target)) return;
    const { action, id, key } = target.dataset;
    if (action !== 'menu' && menu) { menu = false; renderMenu(); }
    if (action === 'menu') { menu = !menu; renderMenu(); root.querySelector('[role="menuitem"]')?.focus(); }
    else if (action === 'back') back();
    else if (action === 'contacts') onNavigate('contacts');
    else if (action === 'messages') onNavigate('messages');
    else if (action === 'close-modal') { if (!modal?.busy) { modal = null; renderModal(); } }
    else if (action === 'reload') void refresh(true);
    else if (action === 'scan') { try { Promise.resolve(onScan('all')).catch(error => { if (!disposed) toast(error.message || '扫描未完成'); }); } catch (error) { toast(error.message); } }
    else if (action === 'add-friend') navigate({ type: 'lookup', userId: '' });
    else if (action === 'profile') { navigate({ type: 'profile', userId: id }); void lookup(id); }
    else if (action === 'profile-retry') void lookup(page.userId);
    else if (action === 'requests') navigate({ type: 'requests' });
    else if (action === 'groups') navigate({ type: 'groups' });
    else if (action === 'blocks') navigate({ type: 'blocks' });
    else if (action === 'reports') { navigate({ type: 'reports' }); void loadReports(); }
    else if (action === 'reports-refresh') void loadReports();
    else if (['report-user','report-message','report-group'].includes(action)) openModal('report', { targetType: action.slice(7), targetId: id, reason: 'spam', detail: '', requestId: uid() });
    else if (action === 'block-user') openModal('confirm', { label: blocked(id) ? '解除拉黑' : '拉黑用户', detail: blocked(id) ? '解除后，如果仍是好友即可恢复私聊。' : '将阻止双方私聊、好友申请和直接群邀请，共同群聊中的消息仍可见。', operation: blocked(id) ? 'unblock' : 'block', userId: id });
    else if (action === 'chat') openChat(id);
    else if(action==='group-ai-chat'){const ai=groupAIEntries(conversation(page.id)).find(row=>row.id===id);if(ai?.canChat)onNavigate('messages',{route:'ai-channel',deviceId:ai.deviceId,provider:ai.provider,returnConversationId:page.id});}
    else if (action === 'device-chat') {const device=deviceEntries.find(item=>item.deviceId===id);if(device)onNavigate('messages',{route:'ai-channel',deviceId:device.deviceId});}
    else if (action === 'group-task' && page.type === 'chat' && conversation(page.id)?.type === 'group') options.onGroupTask?.(page.id);
    else if(action==='group-ai'&&page.type==='chat'&&conversation(page.id)?.type==='group')options.onGroupAI?.(page.id);
    else if (action === 'workflow-event' && page.type === 'chat' && conversation(page.id)?.type === 'group') {const taskEvent=trustedGroupWorkflow(messages.get(page.id)?.find(message=>message.id===id));if(taskEvent)options.onGroupTask?.(page.id,taskEvent.workflowId);}
    else if (action === 'friend-chat') void openFriendChat(id);
    else if (action === 'request-friend') {
      const destination = page;
      void perform('request-friend', () => service.requestFriend(id), () => { if (page === destination && destination.result) destination.result.relationship = 'outgoing'; toast('好友申请已发送'); }, { page: destination });
    } else if (action === 'accept' || action === 'reject') {
      const destination = page;
      void perform('request:' + id, () => service.respondFriend(id, action === 'accept'), () => { if (page === destination && destination.result) destination.result.relationship = action === 'accept' ? 'friend' : 'none'; toast(action === 'accept' ? '已成为好友，可以聊天了' : '已忽略这条申请'); }, { page: destination });
    } else if (action === 'create-group') openRosterEditor('group', { selected: [], name: '' });
    else if(action==='edit-ai-roster'&&conversation(page.id)?.type==='group')openRosterEditor('ai-roster',{conversationId:page.id,aiCanManage:isOwner(conversation(page.id))});
    else if(action==='reload-ai-roster'&&modal&&!modal.busy)void loadRosterEditor(modal);
    else if(action==='remove-roster-ai'&&modal?.aiCanManage&&!modal.busy){const index=Number(target.dataset.index);if(Number.isSafeInteger(index)&&index>=0&&index<modal.aiMembers.length){modal.aiMembers.splice(index,1);modal.rosterCommand=null;renderModal();}}
    else if(action==='open-created-group'&&modal?.groupCreated&&!modal.busy){const id=modal.conversationId;modal=null;void refresh(true).then(()=>{if(!disposed)openChat(id);});}
    else if (action === 'details' && conversation(page.id)) navigate({ type: 'details', id: page.id });
    else if (action === 'invite-members') openModal('invite', { conversationId: page.id, selected: [] });
    else if (action === 'edit-group') { const item = conversation(page.id); if (isManager(item)) openModal('edit-group', { conversationId: item.id, name: item.name, note: item.note || '' }); }
    else if (action === 'manage-members') { const item = conversation(page.id); if (isManager(item)) openModal('members', { conversationId: item.id }); }
    else if (action === 'remove-member' && modal?.type === 'members') { const item = conversation(modal.conversationId); if (mayManage(item,item.members.find(p=>p.userId===id)||{})) openModal('confirm', { label: '移除成员', detail: '确认将这位成员移出群聊？对方需要重新受邀才能加入。', operation: 'remove-member', conversationId: item.id, userId: id }); }
    else if (action === 'reply' && page.type === 'chat') { const message=messages.get(page.id)?.find(m=>m.id===id&&!m.removed);if(message){replies.set(page.id,message);render();root.querySelector('[name="message"]')?.focus();} }
    else if (action === 'cancel-reply' && page.type === 'chat') { replies.delete(page.id);render(); }
    else if (action === 'join-requests' && isManager(conversation(page.id))) openModal('joins',{conversationId:page.id});
    else if (['approve-join','reject-join'].includes(action) && modal?.type==='joins') {const m=modal;void perform('join:'+id,()=>service.respondGroupJoin(m.conversationId,id,action==='approve-join'),()=>toast(action==='approve-join'?'已通过入群':'已拒绝邀请'),{modal:m});}
    else if (action === 'toggle-approval' && isOwner(conversation(page.id))) {const item=conversation(page.id);void perform('approval',()=>service.updateConversation(item.id,{joinApproval:!item.joinApproval}));}
    else if (['member-role','member-silence'].includes(action) && modal?.type==='members') {const m=modal,item=conversation(m.conversationId),person=item?.members.find(p=>p.userId===id);if(person&&mayManage(item,person))void perform('member:'+id,()=>action==='member-role'?service.setGroupRole(item.id,id,person.role==='admin'?'member':'admin'):service.silenceMember(item.id,id,person.silencedUntil>Date.now()?0:60),()=>toast('群成员设置已更新'),{modal:m});}
    else if (action === 'transfer-owner') { const item = conversation(page.id); if (isOwner(item)) openModal('owner', { conversationId: item.id }); }
    else if (action === 'toggle' && ['pinned', 'muted'].includes(key)) { const item = conversation(page.id); if (item) void perform('setting:' + key, () => service.updateConversation(item.id, { [key]: !item[key] })); }
    else if (action === 'search-chat') { const id = page.id; if (page.previous?.type === 'chat') { page = page.previous; page.search = true; render(); } else navigate({ type: 'chat', id, search: true }); }
    else if (action === 'close-search') { page.search = false; page.query = ''; render(); }
    else if (action === 'leave-group') {
      const item = conversation(page.id); if (!item) return;
      if (isOwner(item) && item.members.length > 1) { toast('请先转让群主，再退出群聊'); return; }
      openModal('confirm', { label: '退出群聊', detail: '退出后将不能读取和发送这个群的新消息。', operation: 'leave', conversationId: item.id });
    } else if (action === 'remove-friend') { const item = conversation(page.id); if (item) openModal('confirm', { label: '删除好友', detail: '删除后将停止直接聊天；重新添加需要对方再次通过。', operation: 'remove', userId: peer(item)?.userId }); }
    else if (action === 'confirm-operation' && modal?.type === 'confirm') {
      const targetModal = modal;
      void perform('confirm', () => targetModal.operation === 'block' ? service.blockUser(targetModal.userId) : targetModal.operation === 'unblock' ? service.unblockUser(targetModal.userId) : targetModal.operation === 'leave' ? service.leaveGroup(targetModal.conversationId) : targetModal.operation === 'remove-member' ? service.removeMember(targetModal.conversationId, targetModal.userId) : service.removeFriend(targetModal.userId), () => { if (modal === targetModal) { modal = null; if (!['remove-member','block','unblock'].includes(targetModal.operation)) page = { type: 'list', view }; } toast(targetModal.label + '成功'); }, { modal: targetModal });
    } else if (action === 'emoji' && page.type === 'chat') { page.emoji = !page.emoji; render(); }
    else if (action === 'pick-emoji' && page.type === 'chat' && EMOJI_GROUPS.some(group => group.emojis.includes(target.dataset.emoji))) {
      const input = root.querySelector('[name="message"]'), value = drafts.get(page.id) || '', start = input?.selectionStart ?? value.length, end = input?.selectionEnd ?? start, next = value.slice(0, start) + target.dataset.emoji + value.slice(end);
      if (next.length <= 2000) { drafts.set(page.id, next); if (input) { input.value = next; input.focus(); input.setSelectionRange(start + target.dataset.emoji.length, start + target.dataset.emoji.length); } }
    } else if (action === 'sticker' && page.type === 'chat' && getSticker(id)) void send(page.id, { type: 'sticker', sticker: id });
    else if(action==='send-gift'&&page.type==='chat')options.onGift?.({conversationId:page.id,conversationType:conversation(page.id)?.type});
    else if (action === 'photo' && page.type === 'chat') root.querySelector('[data-chat-photo]')?.click();
    else if (action === 'send-photo' && modal?.type === 'photo' && modal.image) { const targetModal = modal; modal = null; renderModal(); void send(targetModal.conversationId, { type: 'image', image: targetModal.image }); }
    else if (action === 'retry-gallery' && modal?.type === 'gallery') void loadMessages(modal.conversationId, false, modal.messageId);
    else if (action === 'retry-image' && page.type === 'chat') void loadMessages(page.id, false, id);
    else if (action === 'view-image' && page.type === 'chat') { const message = messages.get(page.id)?.find(message => message.id === id); if (message && safeReceivedImage(message.image)) openModal('gallery', { image: message.image, conversationId: page.id, messageId: message.id }); }
    else if (action === 'retry-send' && page.type === 'chat') void send(page.id, null, true);
    else if (action === 'cancel-send' && page.type === 'chat' && pending.get(page.id)?.error) { pending.delete(page.id); render(); toast('已取消重试；这不会撤回服务器可能已经收到的消息，请核对聊天记录。'); }
    else if (action === 'older' && page.type === 'chat') void loadMessages(page.id, true);
    else if (action === 'messages-retry' && page.type === 'chat') void loadMessages(page.id);
  }
  function onInput(event) {
    const { name, value } = event.target;
    if (name === 'message' && page.type === 'chat') { if (value) drafts.set(page.id, value.slice(0, 2000)); else drafts.delete(page.id); }
    else if (name === 'listQuery' && page.type === 'list') { page.query = value; render(); }
    else if (name === 'chatQuery' && page.type === 'chat') { page.query = value; render(); }
    else if (name === 'friendId' && page.type === 'lookup') { page.userId = value; const stale = page.result || page.error || busy.has('lookup'); page.result = null; page.error = ''; lookupSequence++; busy.delete('lookup'); if (stale) render(); }
    else if (name === 'groupName' && modal&&!modal.groupCreated&&!modal.busy) modal.name = value;
    else if(name?.startsWith('rosterAlias')&&modal?.aiCanManage&&!modal.busy){const index=Number(event.target.dataset?.rosterIndex);if(Number.isSafeInteger(index)&&modal.aiMembers[index]){modal.aiMembers[index].alias=value.slice(0,40);modal.rosterCommand=null;}}
    else if (name === 'groupNote' && modal) modal.note = value;
    else if (name === 'reportDetail' && modal) modal.detail = value;
    else if (name === 'memberQuery' && modal) { modal.query = value; const selection = event.target.selectionStart; renderModal(); const input = root.querySelector('[name="memberQuery"]'); input?.focus(); input?.setSelectionRange(selection, selection); }
  }
  function onChange(event) {
    if(event.target.name==='rosterChoice'&&modal?.aiCanManage&&!modal.busy&&!modal.aiLoading){const candidate=modal.aiCandidates.find(row=>rosterKey(row)===event.target.value);if(!candidate)return;if(event.target.checked){if(modal.aiMembers.some(row=>rosterKey(row)===rosterKey(candidate)))return;if(modal.aiMembers.length>=3){modal.error='AI 名单最多 3 个';renderModal();return;}modal.aiMembers.push({deviceId:candidate.deviceId,provider:candidate.provider,alias:''});}else modal.aiMembers=modal.aiMembers.filter(row=>rosterKey(row)!==rosterKey(candidate));modal.rosterCommand=null;renderModal();}
    else if (event.target.name === 'reportReason' && modal) modal.reason = event.target.value;
    else if (event.target.matches('[data-chat-photo]')) { void choosePhoto(event.target.files?.[0]); event.target.value = ''; }
    else if (event.target.name === 'memberIds' && modal && !modal.busy&&!modal.groupCreated) { const ids = new Set(modal.selected || []); if (event.target.checked) ids.add(event.target.value); else ids.delete(event.target.value); modal.selected = [...ids]; const count = root.querySelector('[data-selection-count]'); if (count) count.textContent = '已选择 ' + ids.size + ' 位' + (modal.type === 'group' ? '，至少选择 1 位好友' : ''); }
  }
  function onSubmit(event) {
    const form = event.target.closest('[data-form]'); if (!form || !root.contains(form)) return; event.preventDefault();
    const values = new FormData(form), type = form.dataset.form;
    if (type === 'report' && modal?.type === 'report') { const target = modal; target.reason = String(values.get('reportReason')); target.detail = String(values.get('reportDetail') || ''); const fingerprint = JSON.stringify([target.reason,target.detail]); if (target.submittedFingerprint && target.submittedFingerprint !== fingerprint) target.requestId = uid(); target.submittedFingerprint = fingerprint; void perform('report', () => service.submitReport({ targetType: target.targetType, targetId: target.targetId, reason: target.reason, detail: target.detail, requestId: target.requestId }), () => { if (modal === target) modal = null; toast('举报已提交，可在我的举报查看进度'); }, { modal: target }); }
    else if (type === 'lookup') void lookup(values.get('friendId'));
    else if (type === 'message' && page.type === 'chat') { const text = String(values.get('message') || '').trim(); if (text && text.length <= 2000) void send(page.id, { type: 'text', text }); }
    else if(type==='ai-roster'&&modal?.type==='ai-roster'&&modal.aiCanManage){void submitDiscussion(modal);}
    else if (type === 'group' && modal?.type === 'group') {
      const target = modal; let input;
      try { input = target.groupCreated?null:validateGroup(values.get('groupName'), target.selected || [], state.friends.map(person => person.userId));validateRosterSelection(target.aiMembers||[],target.aiCandidates||[]); } catch (error) { target.error = error.message; renderModal(); return; }
      void submitDiscussion(target,input);
    } else if (type === 'invite' && modal?.type === 'invite') {
      const target = modal; if (!target.selected?.length) { target.error = '请至少选择一位好友'; renderModal(); return; }
      void perform('invite-members', () => service.inviteMembers(target.conversationId, { memberIds: target.selected }), result => { if (modal === target) modal = null; toast(result.pendingApproval?'邀请已提交，等待群主或管理员审批':'好友已加入群聊'); }, { modal: target });
    } else if (type === 'group-details' && modal?.type === 'edit-group') {
      const target = modal, name = String(values.get('groupName') || '').trim(), note = String(values.get('groupNote') || '').trim();
      if (!name || name.length > 24 || note.length > 300) { target.error = '群名需 1–24 字，公告不超过 300 字'; renderModal(); return; }
      void perform('group-details', () => service.updateConversation(target.conversationId, { name, note }), () => { if (modal === target) modal = null; toast('群资料已更新'); }, { modal: target });
    } else if (type === 'owner' && modal?.type === 'owner') {
      const target = modal, ownerId = String(values.get('ownerId') || ''); if (!ownerId) { target.error = '请选择新群主'; renderModal(); return; }
      void perform('owner', () => service.transferOwnership(target.conversationId, ownerId), () => { if (modal === target) modal = null; toast('群主已转让'); }, { modal: target });
    }
  }
  function onKeydown(event) {
    if (event.key === 'Escape' && (modal || menu)) { event.preventDefault(); if (!modal?.busy) back(); return; }
    if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const items = [...root.querySelectorAll('[role="menuitem"]')]; const current = items.indexOf(document.activeElement), next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[next]?.focus(); }
    if (modal && event.key === 'Tab') { const items = [...root.querySelectorAll('.live-dialog button:not([disabled]),.live-dialog input:not([disabled]),.live-dialog textarea:not([disabled])')]; const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }
  function onImageError(event) {
    if (disposed || page.type !== 'chat' || event.target?.tagName !== 'IMG') return;
    if (modal?.type === 'gallery' && event.target.matches('.live-image-preview')) { modal.error = '照片缓存已失效或读取失败，请重新加载。'; renderModal(); return; }
    if (!event.target.matches('.live-photo-message img')) return;
    const id = event.target.closest('[data-message-id]')?.dataset.messageId, message = messages.get(page.id)?.find(item => item.id === id);
    if (message) { message.image = null; message.mediaError = '照片缓存已失效或读取失败，请重新加载。'; render(); }
  }
  function onOutside(event) { if (menu && !root.querySelector('.live-quick')?.contains(event.target)) { menu = false; renderMenu(); } }
  function onCompositionStart() { composing = true; }
  function onCompositionEnd() { composing = false; }
  async function poll() { if (disposed || document.hidden || pollRunning) return; pollRunning = true; try { await refresh(); if (!disposed && page.type === 'chat') void loadMessages(page.id); } finally { pollRunning = false; } }
  function onVisibility() { if (!document.hidden) void poll(); }
  const listeners = { click: onClick, input: onInput, change: onChange, submit: onSubmit, keydown: onKeydown, compositionstart: onCompositionStart, compositionend: onCompositionEnd };
  for (const [event, handler] of Object.entries(listeners)) root.addEventListener(event, handler);
  root.addEventListener('error', onImageError, true);
  document.addEventListener('pointerdown', onOutside); document.addEventListener('visibilitychange', onVisibility);
  window.visualViewport?.addEventListener('resize', fitViewport); window.visualViewport?.addEventListener('scroll', fitViewport);
  render();
  void refresh().then(() => { if (!disposed && loaded) { if (initialConversationId) openChat(initialConversationId); else if (initialProfileId) { navigate({ type: 'profile', userId: initialProfileId }); void lookup(initialProfileId); } } });
  timer = setInterval(() => { void poll(); }, 3000);
  const cleanup = () => { if (disposed) return; disposed = true; epoch++; lookupSequence++; clearInterval(timer); for (const [event, handler] of Object.entries(listeners)) root.removeEventListener(event, handler); root.removeEventListener('error', onImageError, true); document.removeEventListener('pointerdown', onOutside); document.removeEventListener('visibilitychange', onVisibility); window.visualViewport?.removeEventListener('resize', fitViewport); window.visualViewport?.removeEventListener('scroll', fitViewport); root.remove(); onScreenChange({ screen: 'closed', conversationId: null }); };
  cleanup.canGoBack = () => !disposed && !!(modal || menu || page.previous || page.type !== 'list'); cleanup.back = back;
  cleanup.openProfile = id => { if (!disposed) { navigate({ type: 'profile', userId: id }); void lookup(id); } };
  return cleanup;
}
