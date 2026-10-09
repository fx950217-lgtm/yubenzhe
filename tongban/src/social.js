import './social.css';
import './social-v3.css';
import './social-v4.css';
import { getLocalProfile } from './profile-store.js';
import { DEMO_UNIT, PACKET_LIFETIME, ledgerPackets, packetRemaining, settleExpired, createDemoPacket, claimDemoPacket, buildPacketDraft, packetStatus } from './redpacket-model.js';
import { EMOJI_GROUPS, STICKERS, getSticker, readChatImages, isSafeChatImage, isValidMediaMessage, renderEmojiPanel, renderStickerPanel, renderMediaMessage } from './chat-media.js';

// The social prototype is deliberately local. It never sends messages, friend
// requests, profiles or red packets to a server or to a blockchain.
const STORAGE_KEY = 'tongban.social.demo.v1';
const LOCAL_NOTICE = '社交体验数据仅保存在本机，消息不会发送给他人';
const PACKET_NOTICE = '演示红包 · 不涉及链上资金';
const demoAmount = units => (Number(units || 0) / DEMO_UNIT).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
const COVERS = [{ id: 'classic', name: '愚笨者好运', symbol: '福' }, { id: 'bloom', name: '花开有喜', symbol: '✿' }, { id: 'starlight', name: '星光祝福', symbol: '✦' }];
const coverFor = packet => COVERS.find(cover => cover.id === packet?.cover) || COVERS[0];
const packetTypeName = (packet, group = packet?.isGroup) => packet?.kind === 'exclusive' ? '专属红包' : packet?.kind === 'random' ? '拼手气红包' : group ? '普通群红包' : '普通红包';
const icons = {
  search: '<circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  shield: '<path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Z"/><path d="m8 11 3 3 5-5"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  gift: '<path d="M4 10h16v11H4zM3 6h18v4H3zM12 6v15"/><path d="M12 6H8a2.5 2.5 0 1 1 2.5-2.5L12 6Zm0 0h4a2.5 2.5 0 1 0-2.5-2.5L12 6Z"/>',
  transfer: '<path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  send: '<path d="m21 3-7 18-4-7-7-4 18-7ZM10 14 21 3"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  crown: '<path d="m3 7 5 4 4-7 4 7 5-4-2 12H5L3 7ZM6 22h12"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 11h10M7 15h6"/>',
  leaf: '<path d="M19 3C5 2 1 9 6 15c6 5 13 1 13-12ZM4 21 14 10"/>',
  pin: '<path d="m9 3 6 0-1 7 4 4H6l4-4-1-7ZM12 14v7"/>',
  mute: '<path d="M6 9a6 6 0 0 1 10-4M18 9v5l2 3H8M10 21h4M3 3l18 18"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a3.5 3.5 0 0 0-5-5L4 14v6Z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 9h.1M16 9h.1M8 14c2 3 6 3 8 0"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m3 15 5-5 6 6 3-3 4 4M16 8h.1"/>',
  scan: '<path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M21 16v4a1 1 0 0 1-1 1h-4M8 21H4a1 1 0 0 1-1-1v-4M5 12h14"/>',
  addFriend: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M19 8v8M15 12h8"/>',
};
const icon = (name, cls = '') => `<svg class="soc-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.chat}</svg>`;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
const uid = () => globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const nowLabel = () => new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
// Drafts and navigation are tab-session UI state, never sent or stored as messages.
const sessionDrafts = new Map();
const sessionLists = new Map();
function rememberDraft(id, value) {
  const text = String(value || '').slice(0, 1000);
  if (text) sessionDrafts.set(id, text); else sessionDrafts.delete(id);
  return text;
}
function listScreen(view) { return { type: 'list', view, filter: 'all', search: '', ...sessionLists.get(view) }; }

const people = {
  lin: { id: 'lin', name: '林一', initial: '林', color: 'mint', bio: '慢慢来，比较快。', handle: 'linyi.demo', amount: 28640.82 },
  ke: { id: 'ke', name: '可可', initial: '可', color: 'purple', bio: '把生活过成喜欢的样子。', handle: 'coco.demo', amount: 12480.00 },
  zhou: { id: 'zhou', name: '周舟', initial: '周', color: 'peach', bio: '周末一起出去走走。', handle: 'zhouzhou.demo', amount: 8320.50 },
  xu: { id: 'xu', name: '许知远', initial: '许', color: 'blue', bio: '保持好奇，认真生活。', handle: 'xuzhi.demo', amount: 3860.00 },
  moon: { id: 'moon', name: '月亮邮递员', initial: '月', color: 'blue', bio: '记录日常，收藏好风景。', handle: 'moon.demo', amount: 168520.30 },
  ocean: { id: 'ocean', name: '山海', initial: '山', color: 'purple', bio: '在自己的节奏里向前。', handle: 'shanhai.demo', amount: 98620.00 },
  green: { id: 'green', name: '青柠', initial: '青', color: 'mint', bio: '生活有一点点甜。', handle: 'lime.demo', amount: 56328.16 },
};

function seed() {
  const createdAt = Date.now() - 10 * 60 * 1000;
  return {
    version: 1,
    friends: ['lin', 'ke', 'zhou'],
    outgoing: [],
    incoming: ['xu'],
    groups: [
      { id: 'group-weekend', name: '周末碰个面', members: ['lin', 'ke', 'zhou'], color: 'mint', note: '有空就一起吃顿饭。' },
      { id: 'group-study', name: '一起学 Web3', members: ['lin', 'ke'], color: 'purple', note: '一起学习，先了解再行动。' },
    ],
    chats: {
      lin: [{ id: 's1', type: 'text', from: 'lin', text: '周末一起喝杯咖啡？发现了一家很不错的小店 ☕', time: '10:42' }, { id: 's2', type: 'text', from: 'me', text: '好呀，周六下午见。', time: '10:43' }, { id: 's3', type: 'text', from: 'lin', text: '那就说定啦，位置到时候发你。', time: '10:43' }, { id: 's9', type: 'packet', from: 'lin', time: '10:44', packet: { totalUnits: 10000, count: 1, kind: 'equal', sender: 'lin', recipientIds: ['me'], allocations: [10000], claims: [], greeting: '见面之前，先送你一点好心情', createdAt, expiresAt: createdAt + PACKET_LIFETIME } }],
      ke: [{ id: 's4', type: 'text', from: 'ke', text: '这个配色好喜欢，清清爽爽的 🌿', time: '09:28' }],
      zhou: [{ id: 's5', type: 'text', from: 'zhou', text: '下次见面再聊，今天也开心一点！', time: '昨天' }],
      'group-weekend': [{ id: 's6', type: 'text', from: 'ke', text: '把大家拉在一起啦，以后约饭在这里说～', time: '昨天' }, { id: 's7', type: 'text', from: 'zhou', text: '周末见，朋友们 🙌', time: '昨天' }],
      'group-study': [{ id: 's8', type: 'text', from: 'lin', text: '今天一起了解一下什么是链上授权。', time: '昨天' }],
    },
    posts: [],
    joinedRank: false,
    remarks: {},
    conversationSettings: {},
    wallets: { me: DEMO_UNIT, lin: DEMO_UNIT - 10000, ke: DEMO_UNIT, zhou: DEMO_UNIT, xu: DEMO_UNIT, moon: DEMO_UNIT, ocean: DEMO_UNIT, green: DEMO_UNIT },
  };
}

function canChat(data, id) { return data.friends.includes(id) || data.groups.some(g => g.id === id); }
function displayName(data, id) { return data.remarks?.[id] || people[id]?.name || data.groups.find(g => g.id === id)?.name || ''; }
function messageSearchText(message) { return message.type === 'packet' ? message.packet?.greeting || '' : message.type === 'moment' ? `${message.share?.author || ''} ${message.share?.text || ''}` : message.type === 'sticker' ? getSticker(message.stickerId)?.label || '' : message.type === 'image' ? (message.images || []).map(image => image.name).join(' ') : String(message.text || ''); }
function setFriendRemark(data, id, value) {
  if (!data.friends.includes(id)) throw new Error('只能设置好友备注');
  const remark = String(value || '').trim().slice(0, 24);
  data.remarks ||= {};
  if (remark) data.remarks[id] = remark; else delete data.remarks[id];
}
function setConversationSetting(data, id, key, value) {
  if (!canChat(data, id) || !['pinned', 'muted'].includes(key)) throw new Error('无法修改该聊天设置');
  data.conversationSettings ||= {};
  data.conversationSettings[id] = { ...(data.conversationSettings[id] || {}), [key]: !!value };
}
function updateGroupDetails(data, id, { name, note }) {
  const group = data.groups.find(g => g.id === id);
  if (!group) throw new Error('群聊不存在');
  const nextName = String(name || '').trim().slice(0, 24);
  if (!nextName) throw new Error('请填写群聊名称');
  group.name = nextName;
  group.note = String(note || '').trim().slice(0, 300);
}
function inviteFriendsToGroup(data, id, members) {
  const group = data.groups.find(g => g.id === id);
  if (!group || !Array.isArray(members) || !members.length || members.some(member => !data.friends.includes(member))) throw new Error('只能邀请当前好友加入群聊');
  group.members = [...new Set([...group.members, ...members])];
}
export function getSocialPeople() {
  const data = readState();
  return Object.values(people).map(person => ({ ...person, name: displayName(data, person.id), originalName: person.name, isFriend: data.friends.includes(person.id), requested: data.outgoing.includes(person.id) }));
}
export function searchSocialDirectory(query, directory = getSocialPeople()) {
  const term = String(query || '').trim().toLowerCase().slice(0,80).replace(/^@/,'');
  return directory.filter(person => person && Object.hasOwn(people, person.id)).filter(person =>
    [person.name,person.originalName,person.id,person.handle].some(value => String(value || '').toLowerCase().includes(term))
  ).map(person => ({ ...person }));
}
export function getSocialFriends() { return getSocialPeople().filter(person => person.isFriend); }
export function getSocialShareTargets() {
  const data = readState();
  return [...data.friends.map(id => ({ id, name: displayName(data, id), type: 'friend', initial: people[id].initial, color: people[id].color })), ...data.groups.map(group => ({ id: group.id, name: group.name, type: 'group', initial: '群', color: group.color }))];
}
export function shareMomentToChat(targetId, moment) {
  const data = readState();
  if (!canChat(data, targetId)) throw new Error('只能分享给已添加的好友或自己的群聊');
  if (!moment || typeof moment.id !== 'string' || typeof moment.author !== 'string' || typeof moment.text !== 'string' || !moment.text.trim()) throw new Error('动态内容无效');
  const share = { id: moment.id.slice(0, 120), author: moment.author.trim().slice(0, 80), text: moment.text.trim().slice(0, 2000) };
  const message = { id: uid(), type: 'moment', from: 'me', share, text: `分享动态：${share.author} · ${share.text}`, time: nowLabel(), createdAt: Date.now() };
  data.chats[targetId] ||= [];
  data.chats[targetId].push(message);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  catch { throw new Error('本机存储不可用，动态未能分享'); }
  return { id: message.id, targetId };
}

export function getSocialWalletSummary() {
  const data = readState({ strict: true });
  if (settleExpired(data)) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { throw new Error('本机红包退款记录保存失败，演示平台余额暂不可用。'); }
  }
  return { balance: data.wallets.me / DEMO_UNIT, locked: ledgerPackets(data).filter(m => m.packet.sender === 'me' && !m.packet.refunded).reduce((sum, m) => sum + packetRemaining(m.packet), 0) / DEMO_UNIT, currency: 'tBNB', isDemo: true };
}

export function getSocialPacketBills() {
  const data = readState({ strict: true }), bills = [];
  for (const [chatId, messages] of Object.entries(data.chats)) {
    for (const message of messages) {
      if (message.type !== 'packet') continue;
      const packet = message.packet, state = packetStatus(packet);
      if (state.code === 'invalid') continue;
      const title = packetTypeName(packet), chatName = displayName(data, chatId);
      const detail = `${chatName} · ${title} · ${packet.greeting || '一点心意'} · ${PACKET_NOTICE}`;
      const add = (suffix, record) => bills.push({ id: `${chatId}:${message.id}:${suffix}`, asset: 'tBNB', detail, demo: true, ...record });
      if (state.isSender) add('send', { title: `发出${title}`, amount: demoAmount(packet.totalUnits), direction: 'out', status: state.completed ? '已领完' : state.refunded ? '余款已退回' : state.expired ? '已过期 · 待退回' : '待领取', createdAt: packet.createdAt });
      if (state.ownClaim) add('claim', { title: `领取${title}`, amount: demoAmount(state.ownClaim.units), direction: 'in', status: '已领取', createdAt: Number(state.ownClaim.timestamp || state.ownClaim.createdAt || packet.createdAt) });
      // A passed deadline is not a refund transaction. Only persisted refunds appear.
      if (state.isSender && state.refunded && packet.refundUnits > 0) add('refund', { title: '红包余款退回', amount: demoAmount(packet.refundUnits), direction: 'in', status: '已退回', createdAt: Number(packet.refundedAt || packet.expiresAt) });
    }
  }
  return bills.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

function readState({ strict = false } = {}) {
  try {
    const serialized = localStorage.getItem(STORAGE_KEY);
    if (serialized === null) return seed();
    const raw = JSON.parse(serialized);
    if (!raw || raw.version !== 1 || !Array.isArray(raw.friends) || !Array.isArray(raw.groups) || !raw.chats) throw new Error('本机记录格式异常');
    const base = seed();
    // Only known demo identities can participate in local social flows.
    base.friends = raw.friends.filter(id => Object.hasOwn(people, id));
    base.outgoing = Array.isArray(raw.outgoing) ? raw.outgoing.filter(id => Object.hasOwn(people, id)) : [];
    base.incoming = Array.isArray(raw.incoming) ? raw.incoming.filter(id => Object.hasOwn(people, id)) : [];
    base.groups = raw.groups.filter(g => g && typeof g.id === 'string' && g.id.startsWith('group-') && typeof g.name === 'string' && Array.isArray(g.members)).map(g => ({ id: g.id, name: g.name.slice(0, 24), members: g.members.filter(id => base.friends.includes(id)), color: ['mint', 'purple', 'blue', 'peach'].includes(g.color) ? g.color : 'mint', note: typeof g.note === 'string' ? g.note : '' }));
    const validChats = [...base.friends, ...base.groups.map(g => g.id)];
    base.chats = Object.create(null);
    for (const id of validChats) {
      base.chats[id] = Array.isArray(raw.chats[id]) ? raw.chats[id].filter(m => m && typeof m.id === 'string' && ['text', 'packet', 'moment', 'system', 'image', 'sticker'].includes(m.type) && (m.from === 'me' || Object.hasOwn(people, m.from)) && (m.type !== 'moment' || (m.share && typeof m.share.text === 'string' && typeof m.share.author === 'string')) && (!['image', 'sticker'].includes(m.type) || isValidMediaMessage(m))) : [];
    }
    base.remarks = Object.fromEntries(base.friends.filter(id => typeof raw.remarks?.[id] === 'string').map(id => [id, raw.remarks[id].slice(0, 24)]));
    base.conversationSettings = Object.fromEntries(validChats.map(id => [id, { pinned: raw.conversationSettings?.[id]?.pinned === true, muted: raw.conversationSettings?.[id]?.muted === true }]));
    base.posts = Array.isArray(raw.posts) ? raw.posts.filter(p => p && typeof p.text === 'string').slice(-40) : [];
    base.joinedRank = raw.joinedRank === true;
    base.demoGroupPacketV3 = raw.demoGroupPacketV3 === true;
    for (const id of ['me', ...Object.keys(people)]) {
      if (strict && raw.wallets && (!Number.isSafeInteger(raw.wallets[id]) || raw.wallets[id] < 0)) throw new Error('演示平台余额记录异常');
      base.wallets[id] = Number.isSafeInteger(raw.wallets?.[id]) && raw.wallets[id] >= 0 ? raw.wallets[id] : DEMO_UNIT;
    }
    if (!raw.wallets) {
      const initial = seed().chats.lin.find(m => m.id === 's9');
      if (base.chats.lin && !base.chats.lin.some(m => m.id === 's9')) {
        base.chats.lin.push(initial);
        base.wallets.lin -= initial.packet.totalUnits;
      }
    }
    return base;
  } catch { if (strict) throw new Error('本机社交记录无法读取。请保留浏览器数据，当前操作已停止，未覆盖旧记录。'); return seed(); }
}

function installDemoPacketSample(data) {
  if (data.demoGroupPacketV3) return false;
  data.demoGroupPacketV3 = true;
  if (Object.values(data.chats).flat().some(message => message.id === 'demo-group-packet-v3')) return true;
  const group = data.groups.find(item => item.members.includes('ke'));
  if (!group || !Number.isSafeInteger(data.wallets.ke) || data.wallets.ke < 30000) return true;
  const recipientIds = [...new Set([...group.members, 'me'])], count = Math.min(3, recipientIds.length), createdAt = Date.now();
  const allocations = count === 3 ? [9000, 8000, 13000] : count === 2 ? [10000, 20000] : [30000];
  data.wallets.ke -= 30000;
  data.chats[group.id] ||= [];
  data.chats[group.id].push({ id: 'demo-group-packet-v3-notice', type: 'system', from: 'me', text: '一次性本机红包样例：扣除可可的演示余额，体验开红包；没有真实好友参与。', time: nowLabel(), createdAt });
  data.chats[group.id].push({ id: 'demo-group-packet-v3', type: 'packet', from: 'ke', time: nowLabel(), createdAt, packet: { kind: 'random', sender: 'ke', isGroup: true, isSample: true, totalUnits: 30000, count, allocations, claims: [], recipientIds, createdAt, expiresAt: createdAt + PACKET_LIFETIME, cover: 'bloom', greeting: '演示红包 · 一起试试手气' } });
  return true;
}

export function mountSocial(container, options = {}) {
  const { view = 'messages', toast = () => {}, onNavigate = () => {}, onTransfer = () => {}, onAuthorizePacket = async () => false, onScreenChange = () => {}, initialProfileId, initialProfileReturn = 'discover',
    onScanTransfer = () => toast('扫码转账暂未接入'), onScan = () => toast('扫一扫暂未接入') } = options;
  let data, storageError = '';
  try { data = readState({ strict: true }); } catch (error) { data = seed(); storageError = error.message; }
  let screen = initialProfileId && Object.hasOwn(people, initialProfileId) ? { type: 'profile', id: initialProfileId, externalProfile: true } : listScreen(view);
  let renderedScreen = null, renderFrame = null, profileError = '', myProfile = null;
  let modal = null, quickMenuOpen = false;
  let destroyed = false;
  let persistenceWarned = false;
  let operationRevision = 0, pendingAuthorization = null, animationTimer = null;
  const root = document.createElement('section');
  root.className = 'soc-root';
  root.setAttribute('aria-label', '本机社交演示');
  container.append(root);

  function ownPerson() { return { id: 'me', name: myProfile?.nickname || '我', initial: myProfile?.avatar || '我', bio: myProfile?.bio || '', color: 'mint' }; }
  function syncProfile() {
    try { myProfile = getLocalProfile(); profileError = ''; }
    catch (error) { myProfile = null; profileError = error.message; }
  }
  function setDraft(value) { screen.draft = rememberDraft(screen.id, value); }
  function rememberScreen() {
    const current = renderedScreen;
    if (!current) return;
    if (current.type === 'chat') {
      const list = root.querySelector('[data-chat-scroll]');
      if (list) { current.scrollTop = list.scrollTop; current.atBottom = list.scrollHeight - list.clientHeight - list.scrollTop < 36; }
    } else {
      current.viewport = { page: globalThis.window?.scrollY || 0, root: root.scrollTop || 0, container: container.scrollTop || 0 };
      if (current.type === 'list') sessionLists.set(current.view, { filter: current.filter, search: current.search, viewport: { ...current.viewport } });
    }
  }
  function notifyScreen() { onScreenChange({ screen: screen.type, conversationId: screen.type === 'chat' ? screen.id : null }); }
  function fitVisualViewport() {
    const viewport = globalThis.window?.visualViewport;
    if (!viewport || screen.type !== 'chat') return;
    root.style.setProperty('--soc-chat-height', `${viewport.height}px`);
    root.style.setProperty('--soc-chat-top', `${viewport.offsetTop}px`);
  }

  function save() {
    if (storageError) { toast(storageError); return; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { if (!persistenceWarned) { toast('本机存储不可用，本次体验数据不会保留'); persistenceWarned = true; } }
  }
  function commitData(next) {
    if (storageError) throw new Error(storageError);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
    catch { throw new Error('本机保存失败，本次操作未完成；请释放存储空间后重试。'); }
    data = next;
  }
  function cancelOperations() { operationRevision++; pendingAuthorization?.abort(); pendingAuthorization = null; clearTimeout(animationTimer); }
  function addMessage(message) {
    const next = readState({ strict: true });
    if (!canChat(next, screen.id)) throw new Error('成为好友或加入群聊后才能发送');
    next.chats[screen.id] ||= [];
    next.chats[screen.id].push({ id: uid(), from: 'me', time: nowLabel(), createdAt: Date.now(), ...message });
    commitData(next);
    screen.forceBottom = true;
  }
  function hasDuePackets() { return ledgerPackets(data).some(message => !message.packet.refunded && packetRemaining(message.packet) > 0 && Date.now() >= message.packet.expiresAt); }
  function settleCurrentExpiry() {
    if (!hasDuePackets()) return false;
    const next = readState({ strict: true });
    if (!settleExpired(next)) return false;
    commitData(next); return true;
  }

  function avatar(person, size = '', group = false) {
    const p = typeof person === 'string' ? people[person] : person;
    if (!p) return '';
    return `<span class="soc-avatar soc-${esc(p.color || 'mint')} ${size} ${group ? 'soc-avatar-group' : ''}" aria-hidden="true">${group ? icon('users') : esc(p.initial || p.name.slice(0, 1))}</span>`;
  }
  function localBanner(compact = false) { return `<p class="soc-local-notice">${icon('lock')}<span>${compact ? '本机演示 · 消息不会发送给他人' : LOCAL_NOTICE}</span></p>`; }
  function header(title, sub, action = '') {
    return `<header class="soc-header"><div>${sub ? `<p class="soc-eyebrow">${sub}</p>` : ''}<h1>${title}</h1></div>${action}</header>`;
  }
  function buttonIcon(action, name, label, extra = '') { return `<button type="button" class="soc-icon-button" data-action="${action}" aria-label="${esc(label)}" ${extra}>${icon(name)}</button>`; }
  function quickActions() {
    return `<div class="soc-quick-actions" data-quick-actions>${buttonIcon('quick-menu','plus','打开快捷菜单',`aria-haspopup="menu" aria-expanded="${quickMenuOpen}" aria-controls="soc-quick-menu"`)}<div data-quick-menu-host></div></div>`;
  }
  function renderQuickMenu() {
    const host = root.querySelector('[data-quick-menu-host]');
    if (host) host.innerHTML = quickMenuOpen ? `<div class="soc-quick-menu" id="soc-quick-menu" role="menu" aria-label="消息快捷菜单">${[
      ['soc-scan-transfer','transfer','扫码转账'], ['soc-add-friend','addFriend','添加好友'], ['soc-scan','scan','扫一扫'],
      ['new-conversation','chat','发起聊天'], ['create-group','users','创建群聊'],
    ].map(([action,symbol,label],index)=>`<button type="button" role="menuitem" tabindex="-1" data-action="${action}" ${index===3?'class="soc-quick-separated"':''}>${icon(symbol)}<span>${label}</span></button>`).join('')}</div>` : '';
    root.querySelector('[data-action="quick-menu"]')?.setAttribute('aria-expanded',String(quickMenuOpen));
  }
  function closeQuickMenu(restoreFocus = false) {
    if (!quickMenuOpen) return false;
    quickMenuOpen = false; renderQuickMenu();
    if (restoreFocus) root.querySelector('[data-action="quick-menu"]')?.focus();
    return true;
  }
  function onOutsideMenu(event) {
    if (quickMenuOpen && !root.querySelector('[data-quick-actions]')?.contains(event.target)) closeQuickMenu();
  }
  function scanFromMenu(mode) {
    closeQuickMenu(); closeModal();
    try { Promise.resolve(mode === 'transfer' ? onScanTransfer() : onScan(mode)).catch(error => { if (!destroyed) toast(error?.message || '扫描未完成，请重试。'); }); }
    catch(error) { if (!destroyed) toast(error?.message || '扫描未完成，请重试。'); }
  }
  function searchBox(placeholder) { return `<label class="soc-search">${icon('search')}<input type="search" data-search placeholder="${esc(placeholder)}" value="${esc(screen.search || '')}" autocomplete="off" aria-label="${esc(placeholder)}"/></label>`; }
  function empty(title, text, symbol = 'chat') { return `<div class="soc-empty">${icon(symbol)}<h3>${title}</h3><p>${text}</p></div>`; }
  function personById(id) { return people[id] ? { ...people[id], name: displayName(data, id) } : undefined; }
  function groupById(id) { return data.groups.find(g => g.id === id); }
  function conversation(id) { return groupById(id) || personById(id); }
  function lastMessage(id) { const messages = data.chats[id] || []; return messages.at(-1); }
  function chatPreview(id) { const m = lastMessage(id); if (!m) return '你们已经是好友了，打个招呼吧'; return m.type === 'packet' ? `[演示红包] ${m.packet?.greeting || '一点心意，愿你开心'}` : m.type === 'moment' ? `[好友动态] ${m.share?.author || ''}：${m.share?.text || ''}` : m.type === 'image' ? `[图片] ${m.images.length} 张` : m.type === 'sticker' ? `[表情] ${getSticker(m.stickerId)?.label || ''}` : String(m.text || ''); }
  function searchMessages(id, query) { const term = String(query || '').trim().toLowerCase(); return (data.chats[id] || []).filter(m => messageSearchText(m).toLowerCase().includes(term)); }
  function highlighted(value, query = screen.chatQuery) {
    const text = String(value || ''), term = String(query || '').trim();
    if (!term) return esc(text);
    const index = text.toLowerCase().indexOf(term.toLowerCase());
    return index < 0 ? esc(text) : `${esc(text.slice(0, index))}<mark>${esc(text.slice(index, index + term.length))}</mark>${esc(text.slice(index + term.length))}`;
  }

  function conversationList() {
    const ids = [...data.friends, ...data.groups.map(g => g.id)].filter(id => {
      const isGroup = !!groupById(id);
      if (screen.filter === 'friends' && isGroup) return false;
      if (screen.filter === 'groups' && !isGroup) return false;
      const term = (screen.search || '').trim().toLowerCase();
      return `${conversation(id)?.name || ''} ${people[id]?.name || ''}`.toLowerCase().includes(term) || searchMessages(id, term).length > 0;
    }).sort((a, b) => Number(!!data.conversationSettings[b]?.pinned) - Number(!!data.conversationSettings[a]?.pinned) || (lastMessage(b)?.createdAt || 0) - (lastMessage(a)?.createdAt || 0));
    if (!ids.length) return empty('没有找到聊天', '试试好友名字或群聊名称。');
    return ids.map(id => {
      const p = conversation(id), group = !!groupById(id), m = lastMessage(id);
      const prefs = data.conversationSettings[id] || {}, matches = screen.search?.trim() ? searchMessages(id, screen.search) : [], draft = sessionDrafts.get(id);
      return `<button class="soc-conversation ${prefs.pinned ? 'soc-is-pinned' : ''} ${screen.type === 'chat' && screen.id === id ? 'soc-selected' : ''}" data-action="open-chat" data-id="${esc(id)}" ${screen.type === 'chat' && screen.id === id ? 'aria-current="true"' : ''}>${avatar(p, '', group)}<span class="soc-conversation-copy"><span class="soc-conversation-top"><strong>${esc(p.name)}${group ? '<span class="soc-group-tag">群</span>' : ''}${prefs.pinned ? `<span class="soc-status-icon" aria-label="已置顶">${icon('pin')}</span>` : ''}${prefs.muted ? `<span class="soc-status-icon" aria-label="消息免打扰">${icon('mute')}</span>` : ''}</strong><time>${esc(m?.time || '')}</time></span><span class="soc-preview">${matches.length ? `<b>${matches.length} 条相关消息 · </b>${highlighted(messageSearchText(matches.at(-1)), screen.search)}` : draft ? `<b class="soc-draft-tag">[草稿]</b> ${esc(draft)}` : esc(chatPreview(id))}</span></span></button>`;
    }).join('');
  }

  function renderMessages() {
    return `<section class="soc-messages-page">${header('消息', '', quickActions())}${localBanner(true)}${searchBox('搜索好友、群聊或消息')}<div class="soc-tabs" role="tablist" aria-label="消息筛选">${[['all', '全部'], ['friends', '好友'], ['groups', '群聊']].map(([id, name]) => `<button role="tab" aria-selected="${screen.filter === id}" class="${screen.filter === id ? 'is-active' : ''}" data-action="filter" data-id="${id}">${name}</button>`).join('')}</div><div class="soc-list" data-search-results>${conversationList()}</div></section>`;
  }

  function contactList() {
    const friends = data.friends.map(personById).filter(p => `${p.name} ${people[p.id].name}`.toLowerCase().includes((screen.search || '').toLowerCase()));
    return friends.length ? friends.map(p => `<button class="soc-contact" data-action="profile" data-id="${p.id}">${avatar(p)}<span><strong>${esc(p.name)}</strong><small>${esc(p.bio)}</small></span>${icon('chevron')}</button>`).join('') : empty('没有找到好友', '试试输入好友名字。', 'users');
  }
  function renderContacts() {
    return `${header('好友', '', buttonIcon('invite', 'plus', '添加好友'))}${localBanner()}${searchBox('搜索我的好友')}<div class="soc-contact-actions"><button data-action="requests"><span class="soc-feature-icon soc-peach">${icon('users')}</span><span><strong>新的朋友</strong><small>${data.incoming.length ? `${data.incoming.length} 条示例好友申请` : '管理好友申请'}</small></span>${data.incoming.length ? `<b class="soc-count">${data.incoming.length}</b>` : icon('chevron')}</button><button data-action="group-list"><span class="soc-feature-icon soc-purple">${icon('chat')}</span><span><strong>我的群聊</strong><small>${data.groups.length} 个熟人小圈子</small></span>${icon('chevron')}</button></div><div class="soc-section-label"><span>我的好友</span><span>${data.friends.length} 位</span></div><div class="soc-list" data-search-results>${contactList()}</div><div class="soc-trust-note">${icon('shield')}<span>双向同意后，才开启对话。</span></div>`;
  }
  function friendDirectoryRows() {
    const list = searchSocialDirectory(screen.friendQuery);
    return list.length ? list.map(person => `<button type="button" class="soc-directory-person" data-action="profile" data-id="${esc(person.id)}">${avatar(person)}<span><strong>${esc(person.name)}</strong><small>ID：${esc(person.id)} · ${esc(person.handle)}</small></span><span class="soc-directory-status ${person.isFriend?'is-friend':''}">${person.isFriend?'我的好友':person.requested?'等待通过':'查看资料'}${icon('chevron')}</span></button>`).join('') : empty('没有找到示例用户','试试昵称或 ID，例如「可可」或「moon」。','search');
  }
  function renderAddFriend() {
    return `<section class="soc-add-friend-page"><header class="soc-subheader">${buttonIcon('back','back','返回')}<h2>添加好友</h2><span></span></header><label class="soc-search">${icon('search')}<input type="search" data-friend-search maxlength="80" value="${esc(screen.friendQuery || '')}" placeholder="搜索昵称或 ID" aria-label="搜索示例好友的昵称或 ID" autocomplete="off"/></label><button class="soc-scan-friend-row" type="button" data-action="soc-scan-friend"><span>${icon('scan')}</span><strong>扫描好友码</strong>${icon('chevron')}</button><p class="soc-directory-note">仅搜索本机示例，暂不支持跨设备添加好友。</p><div class="soc-directory-label"><span>示例目录</span><span data-friend-count role="status">${searchSocialDirectory(screen.friendQuery).length} 位</span></div><div class="soc-directory-list" data-friend-results>${friendDirectoryRows()}</div><p class="soc-directory-footnote">查看资料后可提交申请，对方通过前不能聊天。</p></section>`;
  }

  function rankings() {
    const rows = Object.values(people).sort((a, b) => b.amount - a.amount);
    return rows.map((p, index) => `<button class="soc-ranking-row" data-action="profile" data-id="${p.id}"><span class="soc-rank-position ${index < 3 ? 'soc-rank-top' : ''}">${String(index + 1).padStart(2, '0')}</span>${avatar(p, 'soc-avatar-small')}<span class="soc-rank-person"><strong>${esc(p.name)}</strong><small>${data.friends.includes(p.id) ? '我的好友' : data.outgoing.includes(p.id) ? '已申请 · 等待通过' : '仅可申请加好友'}</small></span><span class="soc-rank-value">$${money(p.amount)}<small>示例资产</small></span></button>`).join('');
  }
  function friendFeed() {
    const posts = [...data.posts].reverse().map(p => ({ ...ownPerson(), text: p.text, time: p.time || '刚刚' })).concat([
      { ...people.ke, text: '今天的快乐很简单：好天气、好咖啡，还有一起聊天的朋友。☕', time: '示例动态 · 1 小时前' },
      { ...people.zhou, text: '比起走得快，更喜欢和熟悉的人一起走。周末出发 🌿', time: '示例动态 · 昨天' },
    ]);
    return `<div class="soc-feed-intro">${icon('lock')}<span>仅好友可见 · 本机演示</span><button data-action="new-post">写动态 ${icon('plus')}</button></div>${posts.map(p => `<article class="soc-post">${avatar(p, 'soc-avatar-small')}<div><strong>${esc(p.name)}</strong><small>${esc(p.time)}</small><p>${esc(p.text)}</p><span class="soc-post-privacy">好友可见</span></div></article>`).join('')}`;
  }
  function renderDiscover() {
    return `${header('发现', 'A SMALLER, BETTER CIRCLE', '<span class="soc-header-flower">✳</span>')}${localBanner()}<div class="soc-discover-tabs" role="tablist" aria-label="发现内容"><button role="tab" aria-selected="${screen.filter !== 'feed'}" class="${screen.filter !== 'feed' ? 'is-active' : ''}" data-action="discover-filter" data-id="rank">资产榜单</button><button role="tab" aria-selected="${screen.filter === 'feed'}" class="${screen.filter === 'feed' ? 'is-active' : ''}" data-action="discover-filter" data-id="feed">好友动态</button></div>${screen.filter === 'feed' ? friendFeed() : `<section class="soc-rank-hero"><div><span class="soc-pill">BSC · 示例榜单</span><h2>遇见同路的人<span>从一声你好开始。</span></h2><p>只有成为好友，才能开启私聊。</p></div><div class="soc-rank-art" aria-hidden="true">${icon('crown')}<i></i><b>✦</b></div></section><div class="soc-ranking-label"><div><h3>资产排行榜</h3><p>示例榜单 · 非实时资产</p></div><span>USD ${icon('chevron')}</span></div><div class="soc-rank-list">${rankings()}</div><div class="soc-rank-opt"><span class="soc-feature-icon soc-mint">${icon('shield')}</span><div><strong>${data.joinedRank ? '已开启本机榜单参与意向' : '我的资产，默认不公开'}</strong><p>正式榜单需本人主动加入。当前无数据上传。</p></div><button data-action="rank-settings" aria-label="设置榜单展示">${icon('chevron')}</button></div><p class="soc-ranking-disclaimer">资产金额不代表信用或身份认证，请独立核实。</p>`}`;
  }

  function renderRequests() {
    return `<header class="soc-subheader">${buttonIcon('back', 'back', '返回好友')}<h2>新的朋友</h2><span></span></header>${localBanner()}<p class="soc-page-intro">先确认是你认识的人，再成为好友。</p><div class="soc-section-label">收到的示例申请</div>${data.incoming.length ? data.incoming.map(id => `<article class="soc-request">${avatar(people[id])}<div><strong>${esc(displayName(data, id))}</strong><p>你好，一起体验愚笨者吧。</p><small>本机预置示例申请</small></div><button class="soc-small-button" data-action="accept-request" data-id="${id}">接受</button></article>`).join('') : empty('暂时没有新申请', '你可以邀请认识的朋友加入。', 'users')}<div class="soc-section-label">我发出的申请</div>${data.outgoing.length ? data.outgoing.map(id => `<article class="soc-request">${avatar(people[id])}<div><strong>${esc(displayName(data, id))}</strong><p>好友申请已保存在本机</p></div><span class="soc-waiting">等待通过</span></article>`).join('') : '<p class="soc-muted-paragraph">还没有发出的申请。</p>'}<p class="soc-bottom-note">演示申请不会发送给真人，也不会自动通过。</p>`;
  }
  function renderGroupList() {
    return `<header class="soc-subheader">${buttonIcon('back', 'back', '返回好友')}<h2>我的群聊</h2>${buttonIcon('create-group', 'plus', '创建群聊')}</header>${localBanner()}<p class="soc-page-intro">把熟悉的人，聚在同一个小圈子。</p>${data.groups.map(g => `<button class="soc-contact" data-action="open-chat" data-id="${esc(g.id)}">${avatar(g, '', true)}<span><strong>${esc(g.name)}</strong><small>${g.members.length + 1} 位成员 · 熟人群聊</small></span>${icon('chevron')}</button>`).join('')}`;
  }

  function renderProfile() {
    const p = personById(screen.id), isFriend = data.friends.includes(p.id), requested = data.outgoing.includes(p.id);
    return `<header class="soc-subheader">${buttonIcon('back', 'back', '返回')}<h2>个人资料</h2><span></span></header>${localBanner()}<section class="soc-profile-card"><span class="soc-demo-tag">示例用户</span>${avatar(p, 'soc-avatar-xl')}<h1>${esc(p.name)}</h1><p class="soc-profile-handle">${data.remarks[p.id] ? `昵称：${esc(people[p.id].name)} · ` : ''}${esc(p.handle)}</p><p class="soc-profile-bio">${esc(p.bio)}</p><span class="soc-relationship">${icon(isFriend ? 'check' : 'lock')}${isFriend ? '我的好友' : requested ? '已申请 · 等待通过' : '尚未成为好友'}</span></section>${isFriend ? `<button class="soc-setting-row" data-action="edit-remark" data-id="${p.id}"><span><strong>好友备注</strong><small>${esc(data.remarks[p.id] || '设置一个熟悉的称呼')}</small></span>${icon('chevron')}</button>` : ''}<div class="soc-profile-facts"><span>资产展示</span><strong>$${money(p.amount)}<small>示例数据</small></strong></div><p class="soc-privacy-explainer">钱包地址不会出现在公开资料中。${isFriend ? '可以在聊天窗口中发起链上转账或红包。' : '成为好友前，仅支持发送好友申请。'}</p>${isFriend ? `<button class="soc-primary soc-full" data-action="open-chat" data-id="${p.id}">${icon('chat')} 发消息</button>` : `<button class="soc-primary soc-full" data-action="request-friend" data-id="${p.id}" ${requested ? 'disabled' : ''}>${icon(requested ? 'check' : 'plus')} ${requested ? '等待对方通过' : '申请加好友'}</button>`}<p class="soc-bottom-note">资产金额不代表信用或身份认证。</p>`;
  }

  function packetCard(m) {
    const p = m.packet || {}, status = packetStatus(p), cover = coverFor(p);
    return `<button class="soc-packet soc-packet-v3 cover-${cover.id} ${status.ownClaim || status.completed || status.expired ? 'is-claimed' : ''}" data-action="open-packet" data-id="${esc(m.id)}"><span class="soc-packet-body"><span class="soc-packet-symbol">${cover.symbol}</span><span><strong>${esc(p.greeting || '一点心意，愿你开心')}</strong><small>${esc(status.label)}</small></span></span><span class="soc-packet-footer"><b>${packetTypeName(p)}</b><span>${PACKET_NOTICE}</span></span></button>`;
  }
  function chatMessages() {
    const query = screen.chatQuery || '', messages = query.trim() ? searchMessages(screen.id, query) : data.chats[screen.id] || [], isGroup = !!groupById(screen.id);
    return messages.length ? `<div class="soc-chat-date">${query.trim() ? `${messages.length} 条相关消息 · 本机记录` : '本机演示对话'}</div>${messages.map(m => m.type === 'system' ? `<p class="soc-chat-system">${esc(m.text)}</p>` : `<article class="soc-message ${m.from === 'me' ? 'soc-message-own' : ''}">${avatar(m.from === 'me' ? ownPerson() : people[m.from], 'soc-avatar-message')}<div class="soc-message-content">${isGroup && m.from !== 'me' ? `<span class="soc-message-name">${esc(displayName(data, m.from))}</span>` : ''}${m.type === 'packet' ? packetCard(m) : ['image', 'sticker'].includes(m.type) ? renderMediaMessage(m) : m.type === 'moment' ? `<button class="soc-moment-card" data-action="shared-moment" data-id="${esc(m.id)}"><span>${icon('leaf')}好友动态 · 本机分享</span><strong>${esc(m.share.author)}</strong><p>${highlighted(m.share.text)}</p><small>查看分享内容 ${icon('chevron')}</small></button>` : `<div class="soc-bubble">${highlighted(m.text)}</div>`}<time>${esc(m.time || '')}</time></div></article>`).join('')}` : query.trim() ? empty('没有找到相关消息', '换个关键词试试，或关闭搜索查看完整对话。', 'search') : empty('从一声你好开始', '写下第一句话，体验本机聊天。');
  }
  function renderChat() {
    const p = conversation(screen.id), isGroup = !!groupById(screen.id);
    return `<div class="soc-chat-screen"><header class="soc-chat-header">${buttonIcon('back', 'back', '返回消息')}<div><h2>${esc(p.name)}${data.conversationSettings[screen.id]?.muted ? `<span class="soc-status-icon">${icon('mute')}</span>` : ''}</h2><span>${isGroup ? `${p.members.length + 1} 位成员 · 熟人群聊` : '我的好友'}</span></div>${buttonIcon('chat-search', 'search', '搜索聊天记录')}${buttonIcon('chat-details', 'more', '聊天详情')}</header>${localBanner()}${screen.searchOpen ? `<div class="soc-chat-search-row"><label class="soc-search">${icon('search')}<input data-chat-search type="search" placeholder="搜索此聊天的文字或动态" aria-label="搜索聊天记录" value="${esc(screen.chatQuery || '')}"/></label><button data-action="close-chat-search">取消</button></div>` : ''}${isGroup && p.note ? `<button class="soc-group-announcement" data-action="chat-details"><span>群公告</span><p>${esc(p.note)}</p>${icon('chevron')}</button>` : ''}<div class="soc-chat-scroll" data-chat-scroll>${chatMessages()}</div><div class="soc-chat-composer"><form data-form="message" class="soc-message-form"><button type="button" class="soc-emoji-button" data-action="toggle-emoji" aria-label="表情与贴纸" aria-expanded="${!!screen.emojiOpen}">${icon('smile')}</button><input name="message" maxlength="1000" autocomplete="off" placeholder="和熟悉的人聊一聊…" aria-label="消息内容" value="${esc(screen.draft || '')}"/><button type="button" class="soc-plus-button ${screen.trayOpen ? 'is-open' : ''}" data-action="toggle-tray" aria-label="更多聊天功能" aria-expanded="${!!screen.trayOpen}">${icon('plus')}</button><button type="submit" aria-label="发送本机演示消息">${icon('send')}</button></form><input type="file" data-chat-file accept="image/jpeg,image/png,image/webp" multiple hidden/>${screen.trayOpen ? `<div class="soc-attachment-tray"><button data-action="transfer"><span>${icon('transfer')}</span><strong>链上转账</strong><small>前往钱包签名</small></button><button data-action="compose-packet"><span>${icon('gift')}</span><strong>红包</strong><small>平台余额 · 演示</small></button><button data-action="choose-images"><span>${icon('image')}</span><strong>照片</strong><small>仅保存在本机</small></button></div>` : ''}${screen.emojiOpen ? `<section class="soc-expression-tray"><div class="soc-expression-tabs"><button data-action="expression-tab" data-tab="emoji" class="${screen.expressionTab !== 'sticker' ? 'active' : ''}">表情</button><button data-action="expression-tab" data-tab="sticker" class="${screen.expressionTab === 'sticker' ? 'active' : ''}">原创贴纸</button></div>${screen.expressionTab === 'sticker' ? renderStickerPanel() : renderEmojiPanel(screen.emojiCategory || EMOJI_GROUPS[0]?.id)}</section>` : ''}</div></div>`;
  }
  function conversationSettings() {
    const settings = data.conversationSettings[screen.id] || {};
    return `<div class="soc-settings-list"><button class="soc-setting-row" data-action="search-from-details"><span><strong>查找聊天内容</strong><small>搜索本机文字消息与动态</small></span>${icon('search')}</button>${[['pinned', '置顶聊天', '在消息列表优先显示'], ['muted', '消息免打扰', '仅保存本机偏好；当前无推送服务']].map(([key, label, hint]) => `<button class="soc-setting-row" data-action="toggle-setting" data-key="${key}" role="switch" aria-checked="${!!settings[key]}"><span><strong>${label}</strong><small>${hint}</small></span><i class="soc-switch ${settings[key] ? 'is-on' : ''}"></i></button>`).join('')}</div>`;
  }
  function renderFriendDetails() {
    const person = personById(screen.id);
    return `<header class="soc-subheader">${buttonIcon('back', 'back', '返回聊天')}<h2>聊天详情</h2><span></span></header>${localBanner()}<button class="soc-contact" data-action="profile" data-id="${person.id}">${avatar(person)}<span><strong>${esc(person.name)}</strong><small>我的好友 · 查看个人资料</small></span>${icon('chevron')}</button><button class="soc-setting-row" data-action="edit-remark" data-id="${person.id}"><span><strong>好友备注</strong><small>${esc(data.remarks[person.id] || '设置备注')}</small></span>${icon('chevron')}</button>${conversationSettings()}`;
  }
  function renderGroupDetails() {
    const g = groupById(screen.id);
    return `<header class="soc-subheader">${buttonIcon('back', 'back', '返回群聊')}<h2>群聊详情</h2><span></span></header>${localBanner()}<section class="soc-group-summary">${avatar(g, 'soc-avatar-xl', true)}<h2>${esc(g.name)}</h2><p>${g.members.length + 1} 位熟悉的朋友</p></section><div class="soc-section-label">群成员</div><div class="soc-member-grid"><div>${avatar(ownPerson())}<strong>${esc(ownPerson().name)}</strong><small>我 · 群成员</small></div>${g.members.map(id => `<button data-action="profile" data-id="${id}">${avatar(people[id])}<strong>${esc(displayName(data, id))}</strong><small>我的好友</small></button>`).join('')}<button class="soc-invite-member" data-action="invite-members"><span>${icon('plus')}</span><strong>邀请好友</strong><small>仅我的好友</small></button></div><button class="soc-setting-row" data-action="edit-group"><span><strong>群聊名称</strong><small>${esc(g.name)}</small></span>${icon('chevron')}</button><button class="soc-setting-row" data-action="edit-group"><span><strong>群公告</strong><small>${esc(g.note || '添加一条群公告')}</small></span>${icon('chevron')}</button>${conversationSettings()}<div class="soc-trust-note">${icon('shield')}<span>仅可邀请自己的好友。群成员身份不会绕过好友权限。</span></div>`;
  }

  function render() {
    if (destroyed) return;
    rememberScreen();
    syncProfile();
    if (screen.type === 'chat') screen.draft = sessionDrafts.get(screen.id) || '';
    try { settleCurrentExpiry(); } catch (error) { toast(error.message); }
    root.classList.toggle('soc-in-chat', screen.type === 'chat');
    notifyScreen();
    fitVisualViewport();
    let html = '';
    if (screen.type === 'chat') html = renderChat();
    else if (screen.type === 'add-friend') html = renderAddFriend();
    else if (screen.type === 'profile') html = renderProfile();
    else if (screen.type === 'requests') html = renderRequests();
    else if (screen.type === 'group-list') html = renderGroupList();
    else if (screen.type === 'group-details') html = renderGroupDetails();
    else if (screen.type === 'friend-details') html = renderFriendDetails();
    else html = screen.view === 'contacts' ? renderContacts() : screen.view === 'discover' ? renderDiscover() : renderMessages();
    if (screen.type === 'chat') html = `<div class="soc-desktop-layout"><aside class="soc-desktop-conversations" aria-label="会话列表"><div class="soc-desktop-list-heading"><strong>消息</strong><button type="button" data-action="back-list">返回列表</button></div>${searchBox('搜索好友、群聊或消息')}<div class="soc-list" data-search-results>${conversationList()}</div></aside>${html}</div>`;
    else if (screen.type === 'list' && screen.view === 'messages') html = `<div class="soc-desktop-layout">${html}<section class="soc-desktop-welcome"><img src="./icon.svg" alt=""><h2>熟悉的人，安心的往来</h2><p>选择一段对话，继续你们的故事。</p><span>愚笨者 · 让连接更简单</span></section></div>`;
    root.innerHTML = `${storageError || profileError ? `<p class="soc-state-error" role="alert">${esc([storageError, profileError].filter(Boolean).join(' '))}</p>` : ''}${html}<div data-modal-host></div>`;
    renderedScreen = screen;
    const rendered = screen;
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = requestAnimationFrame(() => {
      renderFrame = null;
      if (destroyed || rendered !== screen) return;
      if (screen.type === 'chat') {
        const list = root.querySelector('[data-chat-scroll]');
        if (list) list.scrollTop = screen.forceBottom || screen.scrollTop === undefined || screen.atBottom ? list.scrollHeight : screen.scrollTop;
        screen.forceBottom = false;
      } else {
        const viewport = screen.viewport || { page: 0, root: 0, container: 0 };
        root.scrollTop = viewport.root; container.scrollTop = viewport.container;
        globalThis.window?.scrollTo?.({ top: viewport.page, behavior: 'instant' });
      }
    });
    renderModal();
    renderQuickMenu();
  }

  function closeModal() { cancelOperations(); modal = null; renderModal(); }
  function openModal(type, props = {}) { closeQuickMenu(); cancelOperations(); modal = { type, ...props }; renderModal(); requestAnimationFrame(() => root.querySelector('[data-modal-host] input:not([type=checkbox]):not([type=hidden]), [data-modal-host] textarea, [data-modal-host] button')?.focus()); }
  function modalHeader(title, subtitle = '') { return `<div class="soc-modal-header"><div><h2 id="soc-dialog-title">${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${buttonIcon('close-modal', 'close', '关闭弹窗')}</div>`; }
  function renderPacketCompose() {
    const group = groupById(screen.id), draft = modal.draft || {}, kind = group ? draft.kind || 'random' : 'equal';
    const count = kind === 'exclusive' || !group ? 1 : draft.count || group.members.length + 1;
    return `${modalHeader(group ? '发群红包' : '发红包', PACKET_NOTICE)}<form data-form="packet">${group ? `<fieldset class="soc-packet-kind"><legend>红包类型</legend>${[['random', '拼手气'], ['equal', '普通红包'], ['exclusive', '专属红包']].map(([value, label]) => `<label><input type="radio" name="kind" value="${value}" ${kind === value ? 'checked' : ''}/>${label}</label>`).join('')}</fieldset>` : '<input type="hidden" name="kind" value="equal"/>'}${kind === 'exclusive' ? `<label class="soc-field-label">发给谁<select name="recipientId" required><option value="">选择一位群成员</option>${group.members.map(id => `<option value="${id}" ${draft.recipientId === id ? 'selected' : ''}>${esc(displayName(data, id))}</option>`).join('')}</select></label>` : ''}<label class="soc-field-label">${group && kind === 'equal' ? '单个金额' : kind === 'random' ? '总金额' : '金额'}<div class="soc-input-unit"><input type="text" inputmode="decimal" name="amount" placeholder="0.00" value="${esc(draft.amount || '')}" maxlength="16" required/><span>演示 tBNB</span></div></label>${group && kind !== 'exclusive' ? `<label class="soc-field-label">红包个数<div class="soc-input-unit"><input type="number" inputmode="numeric" name="count" min="1" max="${group.members.length + 1}" value="${esc(count)}" required/><span>个</span></div></label><p class="soc-form-hint">${kind === 'equal' ? '每人金额相同，总额＝单个金额 × 红包个数。' : '每人金额随机，总金额固定。'}群内 ${group.members.length + 1} 人，每人限领一次，发送人也可领取。</p>` : '<input type="hidden" name="count" value="1"/>'}<label class="soc-field-label">祝福语<input name="greeting" maxlength="40" value="${esc(draft.greeting || '')}" placeholder="一点心意，愿你开心"/></label><fieldset class="soc-cover-choices"><legend>红包封面</legend>${COVERS.map(cover => `<label class="cover-${cover.id}"><input type="radio" name="cover" value="${cover.id}" ${(draft.cover || 'classic') === cover.id ? 'checked' : ''}/><span>${cover.symbol}</span><strong>${cover.name}</strong><i>${icon('check')}</i></label>`).join('')}</fieldset><div class="soc-detail-line"><span>可用平台余额 · 演示</span><strong>${demoAmount(data.wallets.me)} tBNB</strong></div><p class="soc-form-hint">发送前验证本机钱包密码，仅扣演示平台余额。${kind === 'exclusive' ? '仅指定成员可领。' : ''}24 小时未领部分退回平台余额。</p><p class="soc-form-error" data-form-error role="alert"></p><button class="soc-primary soc-full" type="submit">预览红包</button></form>`;
  }
  function renderPacketPreview() {
    const packet = modal.packet, cover = coverFor(packet);
    return `${modalHeader('确认红包', PACKET_NOTICE)}<div class="soc-packet-preview"><div class="soc-preview-envelope cover-${cover.id}">${cover.symbol}</div><p>${esc(packet.greeting)}</p><h2>${demoAmount(packet.totalUnits)}<span>演示 tBNB · 总额</span></h2><p>${packetTypeName(packet, !!groupById(screen.id))}${packet.kind === 'exclusive' ? ` · 发给 ${esc(displayName(data, packet.recipientId))}` : ` · ${packet.count} 个`}</p>${packet.kind === 'equal' && groupById(screen.id) ? `<p>单个 ${demoAmount(packet.totalUnits / packet.count)} × ${packet.count} 个</p>` : ''}</div><div class="soc-detail-line"><span>发送到</span><strong>${esc(conversation(screen.id).name)}</strong></div><div class="soc-detail-line"><span>支付方式</span><strong>演示平台余额</strong></div><div class="soc-detail-line"><span>发送后余额</span><strong>${demoAmount(data.wallets.me - packet.totalUnits)} tBNB</strong></div><p class="soc-form-hint">验证钱包密码后发送。只扣本机演示余额，不广播链上交易。</p><p class="soc-form-error" role="alert">${esc(modal.error || '')}</p><button class="soc-primary soc-full" data-action="send-packet" ${modal.busy ? 'disabled' : ''}>${modal.busy ? '等待钱包密码验证…' : '验证密码并发送'}</button><button class="soc-text-button soc-full" data-action="edit-packet" ${modal.busy ? 'disabled' : ''}>返回修改</button>`;
  }
  function findPacket(id) { return (data.chats[screen.id] || []).find(message => message.id === id && message.type === 'packet'); }
  function renderPacketCover(message) {
    const packet = message.packet, cover = coverFor(packet), sender = packet.sender === 'me' ? ownPerson() : personById(packet.sender || message.from);
    return `<div class="soc-red-cover cover-${cover.id}"><button class="soc-cover-close" data-action="close-modal" aria-label="关闭红包">${icon('close')}</button><div class="soc-cover-art" aria-hidden="true">${cover.symbol}</div><div class="soc-cover-sender">${avatar(sender, 'soc-avatar-small')}<span>${esc(sender?.name || '好友')} 发来的红包</span></div><h2 id="soc-dialog-title">${esc(packet.greeting || '一点心意，愿你开心')}</h2><p>${packetTypeName(packet)}${packet.kind === 'exclusive' ? ` · 专属 ${esc(displayName(data, packet.recipientId || packet.recipientIds?.[0]))}` : ''}</p><button class="soc-open-seal ${modal.busy ? 'is-opening' : ''}" data-action="claim-packet" data-id="${esc(message.id)}" ${modal.busy ? 'disabled' : ''} aria-label="打开并领取演示红包">开</button><small>${modal.busy ? '正在打开…' : '轻点开启，心意就在这里'}</small><footer>${PACKET_NOTICE}</footer></div>`;
  }
  function renderPacketDetails(message) {
    const packet = message.packet, status = packetStatus(packet), claims = Array.isArray(packet.claims) ? packet.claims.filter(claim => claim && typeof claim.user === 'string' && Number.isSafeInteger(claim.units)) : [], senderName = packet.sender === 'me' ? ownPerson().name : displayName(data, packet.sender || message.from), mine = status.ownClaim;
    const best = status.completed && packet.kind === 'random' ? Math.max(...claims.map(claim => claim.units)) : -1;
    const finalTime = claims.length ? Number(claims.at(-1).timestamp || claims.at(-1).createdAt) : 0;
    const elapsed = finalTime && packet.createdAt ? Math.max(0, Math.floor((finalTime - packet.createdAt) / 1000)) : null;
    const secondsLabel = elapsed === null ? '' : elapsed < 1 ? '不到 1 秒领完' : elapsed < 60 ? `${elapsed} 秒领完` : `${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒领完`;
    const notice = status.completed ? `红包已领完${secondsLabel ? ` · ${secondsLabel}` : ''}` : status.refunded ? `未领 ${demoAmount(packet.refundUnits || status.remainingUnits)} tBNB 已退回发送人的演示平台余额。` : status.expired ? '红包已超过 24 小时，不能继续领取。' : status.code === 'ineligible' ? packet.kind === 'exclusive' ? `这是发给 ${displayName(data, packet.recipientId || packet.recipientIds?.[0])} 的专属红包。` : '你不在这个红包的接收范围内。' : status.code === 'sent' ? packet.kind === 'exclusive' ? '等待指定成员领取，专属红包不能由发送人代领。' : '等待对方领取。单聊发送人不能领取自己发出的红包。' : mine ? '已存入演示平台余额，每人限领一次。' : status.label;
    return `${modalHeader('红包详情', PACKET_NOTICE)}<div class="soc-red-detail-top"><div class="soc-detail-sender">${avatar(packet.sender === 'me' ? ownPerson() : personById(packet.sender || message.from), 'soc-avatar-small')}<strong>${esc(senderName)}的${packetTypeName(packet)}</strong></div><p>${esc(packet.greeting)}</p>${mine ? `<h2>${demoAmount(mine.units)}<span>演示 tBNB</span></h2><small>已存入演示平台余额</small>` : `<div class="soc-packet-state">${esc(status.label)}</div>`}</div><p class="soc-packet-state-copy">${esc(notice)}</p><div class="soc-receipt-summary"><span>已领取 ${status.claimedCount} / ${status.count} 个</span><strong>${demoAmount(claims.reduce((sum, claim) => sum + claim.units, 0))} / ${demoAmount(packet.totalUnits)} tBNB</strong></div><div class="soc-claim-list">${claims.map(claim => `<div class="soc-claim-row">${avatar(claim.user === 'me' ? ownPerson() : personById(claim.user), 'soc-avatar-small')}<span><strong>${esc(claim.user === 'me' ? ownPerson().name : displayName(data, claim.user))}</strong><small>${esc(claim.time || (claim.timestamp || claim.createdAt ? new Date(claim.timestamp || claim.createdAt).toLocaleTimeString('zh-CN') : '领取时间未知'))}</small></span><div><b>${demoAmount(claim.units)} tBNB</b>${claim.units === best ? '<small class="soc-best-luck">♛ 手气最佳</small>' : ''}</div></div>`).join('') || '<p class="soc-muted-paragraph soc-center">还没有人领取</p>'}</div>${status.isSender ? `<div class="soc-detail-line"><span>${status.refunded ? '已退回平台余额' : '未领取金额'}</span><strong>${demoAmount(status.refunded ? packet.refundUnits : status.remainingUnits)} tBNB</strong></div>` : ''}${status.canClaim ? `<button class="soc-primary soc-full" data-action="packet-cover" data-id="${esc(message.id)}">打开红包</button>` : ''}<p class="soc-form-hint soc-center">${PACKET_NOTICE}<br>不会伪造其他成员的领取记录。</p>`;
  }
  function renderModal() {
    const host = root.querySelector('[data-modal-host]');
    if (!host) return;
    if (!modal) { host.innerHTML = ''; return; }
    let content = '';
    if (modal.type === 'new-conversation') {
      content = `${modalHeader('开始一段对话', '从你熟悉的人开始。')}<button class="soc-modal-menu" data-action="create-group"><span class="soc-feature-icon soc-purple">${icon('users')}</span><span><strong>创建群聊</strong><small>邀请自己的好友</small></span>${icon('chevron')}</button><div class="soc-section-label">我的好友</div>${data.friends.map(id => `<button class="soc-contact" data-action="open-chat" data-id="${id}">${avatar(people[id], 'soc-avatar-small')}<span><strong>${esc(displayName(data, id))}</strong></span>${icon('chevron')}</button>`).join('')}`;
    } else if (modal.type === 'edit-remark') {
      content = `${modalHeader('设置好友备注', '备注只对自己可见，留空可恢复昵称。')}<form data-form="remark"><label class="soc-field-label">好友备注<input name="remark" maxlength="24" placeholder="${esc(people[modal.id].name)}" value="${esc(data.remarks[modal.id] || '')}"/></label><p class="soc-form-error" data-form-error role="alert"></p><button class="soc-primary soc-full" type="submit">保存备注</button></form>`;
    } else if (modal.type === 'edit-group') {
      const group = groupById(modal.id);
      content = `${modalHeader('编辑群资料', '仅保存到本机演示群，不会通知他人。')}<form data-form="group-details"><label class="soc-field-label">群聊名称<input name="name" maxlength="24" value="${esc(group.name)}" required/></label><label class="soc-field-label">群公告<textarea name="note" maxlength="300" rows="4" placeholder="写一条大家都能看到的公告">${esc(group.note || '')}</textarea></label><p class="soc-form-error" data-form-error role="alert"></p><button class="soc-primary soc-full" type="submit">保存群资料</button></form>`;
    } else if (modal.type === 'invite-members') {
      const group = groupById(modal.id), available = data.friends.filter(id => !group.members.includes(id));
      content = `${modalHeader('邀请好友进群', '只能选择你已添加的好友。')}${available.length ? `<form data-form="invite-members"><div class="soc-select-friends">${available.map(id => `<label>${avatar(people[id], 'soc-avatar-small')}<strong>${esc(displayName(data, id))}</strong><input type="checkbox" name="members" value="${id}"/><span class="soc-checkbox">${icon('check')}</span></label>`).join('')}</div><p class="soc-form-hint">邀请只会更新本机演示群。此前发出的红包仍按发出时的成员范围领取。</p><p class="soc-form-error" data-form-error role="alert"></p><button class="soc-primary soc-full" type="submit">加入演示群聊</button></form>` : `${empty('好友们都在群里了', '添加新的好友后，可以邀请他们加入。', 'users')}<button class="soc-secondary soc-full" data-action="close-modal">知道了</button>`}`;
    } else if (modal.type === 'shared-moment') {
      const message = (data.chats[screen.id] || []).find(m => m.id === modal.id && m.type === 'moment');
      if (!message) { closeModal(); return; }
      content = `${modalHeader('好友动态', '本机分享 · 不会向他人发送')}<div class="soc-shared-moment-detail"><span>${icon('leaf')}</span><strong>${esc(message.share.author)}</strong><p>${esc(message.share.text)}</p></div><p class="soc-form-hint">这是分享时保存的文字副本。分享记录仅在本机，当前没有外部消息发送。</p><button class="soc-secondary soc-full" data-action="close-modal">返回聊天</button>`;
    } else if (modal.type === 'create-group') {
      content = `${modalHeader('创建一个小圈子', '只有你的好友，才能被邀请。')}<form data-form="group"><label class="soc-field-label">群聊名称<input name="name" placeholder="给小圈子起个名字" maxlength="24" required/></label><div class="soc-section-label">选择好友</div><div class="soc-select-friends">${data.friends.map(id => `<label>${avatar(people[id], 'soc-avatar-small')}<strong>${esc(displayName(data, id))}</strong><input type="checkbox" name="members" value="${id}"/><span class="soc-checkbox">${icon('check')}</span></label>`).join('')}</div><p class="soc-form-hint">群聊与邀请仅在本机演示，不会通知他人。</p><p class="soc-form-error" data-form-error role="alert"></p><button class="soc-primary soc-full" type="submit">创建群聊</button></form>`;
    } else if (modal.type === 'request-friend') {
      const p = people[modal.id];
      content = `${modalHeader('申请加好友', '通过申请后，才可以开始私聊。')}<div class="soc-request-target">${avatar(p)}<div><strong>${esc(p.name)}</strong><small>示例用户</small></div></div><form data-form="request"><label class="soc-field-label">打个招呼<textarea name="greeting" rows="3" maxlength="100" placeholder="你好，很高兴认识你。"></textarea></label><p class="soc-form-hint">此申请仅保存在本机，不会实际发送，也不会自动通过。</p><p class="soc-form-error" data-form-error role="alert"></p><button class="soc-primary soc-full" type="submit">保存演示申请</button></form>`;
    } else if (modal.type === 'compose-packet') {
      content = renderPacketCompose();
    } else if (modal.type === 'packet-preview') {
      content = renderPacketPreview();
    } else if (modal.type === 'packet-cover' || modal.type === 'packet-details') {
      const message = findPacket(modal.id);
      if (!message?.packet) { closeModal(); return; }
      if (modal.type === 'packet-cover' && !packetStatus(message.packet).canClaim) modal.type = 'packet-details';
      content = modal.type === 'packet-cover' ? renderPacketCover(message) : renderPacketDetails(message);
    } else if (modal.type === 'images') {
      content = `${modalHeader('发送照片', '最多 3 张、总计 2 MB · 仅保存在本机')}<div class="soc-image-preview-grid">${(modal.images || []).map((image, index) => `<figure><img src="${esc(image.src)}" alt="${esc(image.name || '待发送照片')}"/><button data-action="remove-image" data-index="${index}" aria-label="移除照片">${icon('close')}</button></figure>`).join('')}</div>${modal.reading ? '<p class="soc-form-hint">正在本机检查照片…</p>' : ''}<p class="soc-form-error" role="alert">${esc(modal.error || '')}</p><button class="soc-primary soc-full" data-action="send-images" ${modal.reading || !modal.images?.length ? 'disabled' : ''}>发送 ${modal.images?.length || 0} 张照片</button><p class="soc-form-hint">照片不上传，不发送到外部服务；浏览器空间不足时不会发送。</p>`;
    } else if (modal.type === 'image-gallery') {
      const message = (data.chats[screen.id] || []).find(m => m.id === modal.id && m.type === 'image');
      const images = message?.images?.filter(isSafeChatImage) || [];
      if (!images.length) { closeModal(); return; }
      const index = Math.max(0, Math.min(modal.index || 0, images.length - 1)); modal.index = index;
      content = `${modalHeader(`照片 ${index + 1} / ${images.length}`, '本机图片')}<div class="soc-gallery-stage"><img src="${esc(images[index].src)}" alt="${esc(images[index].name || '聊天照片')}"/></div><div class="soc-gallery-controls"><button data-action="gallery-prev" ${index === 0 ? 'disabled' : ''}>${icon('back')} 上一张</button><button data-action="gallery-next" ${index === images.length - 1 ? 'disabled' : ''}>下一张 ${icon('chevron')}</button></div>`;
    } else if (modal.type === 'social-wallet') {
      const locked = ledgerPackets(data).filter(m => m.packet.sender === 'me' && !m.packet.refunded).reduce((sum, m) => sum + packetRemaining(m.packet), 0);
      content = `${modalHeader('我的平台余额', '本机演示账本 · 不是链上钱包余额')}<div class="soc-packet-preview"><div class="soc-rank-setting-art">${icon('gift')}</div><p>可用平台余额 · 演示余额</p><h2>${demoAmount(data.wallets.me)}<span>演示 tBNB</span></h2></div><div class="soc-detail-line"><span>红包待领取</span><strong>${demoAmount(locked)} tBNB</strong></div><p class="soc-modal-paragraph">红包从平台余额扣款，领取后进入平台余额；未领部分 24 小时后退回。当前只模拟平台托管平台余额的账本规则，初始演示余额为 1 tBNB，充值、提现与真实资金托管尚未接入。</p><button class="soc-primary soc-full" data-action="close-modal">知道了</button>`;
    } else if (modal.type === 'rank-settings') {
      content = `${modalHeader('资产榜单展示', '你的资产，由你决定是否公开。')}<div class="soc-rank-setting-art">${icon('shield')}</div><h3 class="soc-center">默认保持私密</h3><p class="soc-modal-paragraph">正式榜单只展示主动参与的用户。当前排行榜全部是示例数据，此处只保存你的本机参与意向，不会读取或上传钱包余额、地址。</p><button class="soc-primary soc-full" data-action="toggle-rank">${data.joinedRank ? '关闭本机参与意向' : '开启本机参与意向'}</button><p class="soc-form-hint soc-center">当前状态：${data.joinedRank ? '已开启意向 · 无数据上传' : '未参与 · 资产私密'}</p>`;
    } else if (modal.type === 'new-post') {
      content = `${modalHeader('记录一点日常', '好友可见 · 本机演示')}<form data-form="post"><label class="soc-field-label">这一刻，想说点什么？<textarea name="text" rows="5" maxlength="500" placeholder="分享给熟悉的人…" required></textarea></label><p class="soc-form-hint">动态只会保存在本机，不会向他人发布。</p><p class="soc-form-error" data-form-error role="alert"></p><button class="soc-primary soc-full" type="submit">保存本机动态</button></form>`;
    }
    host.innerHTML = `<div class="soc-modal-backdrop" data-dismiss-overlay><section class="soc-modal ${modal.type === 'packet-cover' ? 'soc-cover-modal' : modal.type === 'image-gallery' ? 'soc-gallery-modal' : ''}" role="dialog" aria-modal="true" aria-labelledby="soc-dialog-title">${content}</section></div>`;
  }

  function navigate(next, replace = false) { closeQuickMenu(); cancelOperations(); modal = null; rememberScreen(); screen = { ...next, previous: replace ? screen.previous : screen }; render(); }
  function backToMessages() {
    closeQuickMenu(); cancelOperations(); modal = null; rememberScreen();
    if (view !== 'messages') { onNavigate('messages'); return; }
    screen = listScreen('messages'); render();
  }
  function back() {
    if (destroyed) return false;
    if (closeQuickMenu(true)) return true;
    if (modal) { closeModal(); return true; }
    if (!screen.previous && !screen.externalProfile && screen.type === 'list') return false;
    cancelOperations();
    modal = null;
    rememberScreen();
    if (screen.externalProfile && !screen.previous) { onNavigate(initialProfileReturn); return true; }
    if (screen.previous) screen = screen.previous;
    else screen = listScreen(view);
    render();
    return true;
  }
  function openChat(id) {
    if (!data.friends.includes(id) && !groupById(id)) { toast('成为好友后才能开始聊天'); return; }
    if (screen.type === 'chat' && screen.id === id) { closeModal(); return; }
    data.chats[id] ||= [];
    const query = screen.type === 'list' && screen.search?.trim() && searchMessages(id, screen.search).length ? screen.search.trim() : '';
    navigate({ type: 'chat', id, chatQuery: query, searchOpen: !!query, trayOpen: false, draft: sessionDrafts.get(id) || '' }, screen.type === 'chat');
  }
  function formError(form, message) { const target = form.querySelector('[data-form-error]'); if (target) target.textContent = message; }
  async function authorizeAndSendPacket() {
    if (modal?.type !== 'packet-preview' || modal.busy || screen.type !== 'chat') return;
    const preview = modal, chatId = screen.id, revision = ++operationRevision;
    const controller = new AbortController(); pendingAuthorization = controller;
    preview.busy = true; preview.error = ''; renderModal();
    try {
      const approved = await onAuthorizePacket({ totalUnits: preview.packet.totalUnits, currency: 'tBNB', kind: preview.packet.kind, count: preview.packet.count, chatName: conversation(chatId).name, signal: controller.signal });
      if (destroyed || controller.signal.aborted || revision !== operationRevision || modal !== preview || screen.type !== 'chat' || screen.id !== chatId) return;
      pendingAuthorization = null;
      if (approved !== true) { preview.busy = false; preview.error = '验证已取消，红包未发送，平台余额未扣款。'; renderModal(); return; }
      const next = readState({ strict: true });
      if (!canChat(next, chatId)) throw new Error('聊天关系已变化，红包未发送');
      settleExpired(next);
      const draft = buildPacketDraft(next, chatId, preview.packet);
      if (draft.totalUnits !== preview.packet.totalUnits) throw new Error('红包金额已变化，请重新确认');
      createDemoPacket(next, chatId, draft);
      commitData(next);
      modal = null; screen.trayOpen = false; screen.forceBottom = true; render(); toast('演示红包已发送，仅扣演示平台余额');
    } catch (error) {
      if (destroyed || revision !== operationRevision || modal !== preview) return;
      pendingAuthorization = null; preview.busy = false; preview.error = error.message || '验证未完成，红包未发送'; renderModal();
    }
  }
  function openAndClaimPacket(id) {
    if (modal?.type !== 'packet-cover' || modal.busy || modal.id !== id) return;
    const cover = modal, chatId = screen.id, revision = ++operationRevision;
    cover.busy = true; renderModal();
    animationTimer = setTimeout(() => {
      if (destroyed || revision !== operationRevision || modal !== cover || screen.id !== chatId) return;
      try {
        const next = readState({ strict: true }); settleExpired(next);
        const message = next.chats[chatId]?.find(item => item.id === id && item.type === 'packet');
        if (!message) throw new Error('红包已不可用');
        claimDemoPacket(next, message.packet);
        const completed = packetStatus(message.packet).completed;
        const sender = message.packet.sender === 'me' ? '自己' : displayName(next, message.packet.sender);
        next.chats[chatId].push({ id: uid(), type: 'system', from: 'me', text: `你领取了${sender}的${packetTypeName(message.packet)}${completed ? '，红包已领完' : ''} · 本机演示`, time: nowLabel(), createdAt: Date.now() });
        commitData(next); screen.forceBottom = true; modal = { type: 'packet-details', id }; render();
      } catch (error) {
        try { data = readState({ strict: true }); } catch { /* Preserve the current view when storage is corrupt. */ }
        modal = { type: 'packet-details', id }; render(); toast(error.message);
      }
    }, 480);
  }
  async function chooseImages(files) {
    if (!files.length || screen.type !== 'chat') return;
    openModal('images', { images: [], reading: true });
    const preview = modal, revision = operationRevision;
    try { const images = await readChatImages(files); if (destroyed || revision !== operationRevision || modal !== preview) return; preview.images = images; }
    catch (error) { if (destroyed || revision !== operationRevision || modal !== preview) return; preview.error = error.message; }
    if (modal === preview) { preview.reading = false; renderModal(); }
  }

  function onClick(event) {
    try { settleCurrentExpiry(); } catch (error) { toast(error.message); }
    if (event.target.matches('[data-dismiss-overlay]')) { closeModal(); return; }
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    const { action, id } = target.dataset;
    if (quickMenuOpen && action !== 'quick-menu') closeQuickMenu();
    if (action === 'quick-menu' && screen.type === 'list' && screen.view === 'messages') {
      quickMenuOpen = !quickMenuOpen; renderQuickMenu();
      if (quickMenuOpen) requestAnimationFrame(() => { if (!destroyed && quickMenuOpen) root.querySelector('[data-quick-menu-host] [role="menuitem"]')?.focus(); });
    }
    else if (action === 'soc-scan-transfer') scanFromMenu('transfer');
    else if (action === 'soc-scan') scanFromMenu('all');
    else if (action === 'soc-scan-friend') scanFromMenu('friend');
    else if (action === 'soc-add-friend') navigate({ type:'add-friend', friendQuery:'' });
    else if (action === 'close-modal') closeModal();
    else if (action === 'back') back();
    else if (action === 'back-list') backToMessages();
    else if (action === 'back-chat') { rememberScreen(); screen = screen.previous?.type === 'chat' ? screen.previous : { type: 'chat', id: screen.id, previous: screen.previous, draft: sessionDrafts.get(screen.id) || '' }; render(); }
    else if (action === 'filter') { screen.filter = id; render(); }
    else if (action === 'discover-filter') { screen.filter = id; render(); }
    else if (action === 'open-chat') openChat(id);
    else if (action === 'profile' && people[id]) navigate({ type: 'profile', id });
    else if (action === 'requests') navigate({ type: 'requests' });
    else if (action === 'group-list') navigate({ type: 'group-list' });
    else if (action === 'new-conversation') openModal('new-conversation');
    else if (action === 'create-group') openModal('create-group');
    else if (action === 'invite') navigate({ type:'add-friend', friendQuery:'' });
    else if (action === 'new-post') openModal('new-post');
    else if (action === 'edit-remark' && data.friends.includes(id)) openModal('edit-remark', { id });
    else if (action === 'edit-group' && groupById(screen.id)) openModal('edit-group', { id: screen.id });
    else if (action === 'invite-members' && groupById(screen.id)) openModal('invite-members', { id: screen.id });
    else if (action === 'shared-moment' && screen.type === 'chat') openModal('shared-moment', { id });
    else if (action === 'toggle-tray' && screen.type === 'chat') { screen.trayOpen = !screen.trayOpen; screen.emojiOpen = false; render(); }
    else if (action === 'chat-search' && screen.type === 'chat') { screen.searchOpen = true; screen.trayOpen = false; render(); root.querySelector('[data-chat-search]')?.focus(); }
    else if (action === 'close-chat-search' && screen.type === 'chat') { screen.searchOpen = false; screen.chatQuery = ''; render(); }
    else if (action === 'search-from-details') {
      const chatId = screen.id; rememberScreen();
      if (screen.previous?.type === 'chat') screen = screen.previous;
      else screen = { type: 'chat', id: chatId, previous: screen, draft: sessionDrafts.get(chatId) || '' };
      screen.searchOpen = true; screen.chatQuery = ''; screen.trayOpen = false; render(); root.querySelector('[data-chat-search]')?.focus();
    }
    else if (action === 'toggle-setting') {
      const key = target.dataset.key;
      try { setConversationSetting(data, screen.id, key, !data.conversationSettings[screen.id]?.[key]); save(); render(); }
      catch (error) { toast(error.message); }
    }
    else if (action === 'social-wallet') openModal('social-wallet');
    else if (action === 'rank-settings') openModal('rank-settings');
    else if (action === 'toggle-rank') { data.joinedRank = !data.joinedRank; save(); closeModal(); render(); toast(data.joinedRank ? '参与意向已保存在本机，未上传资产' : '已关闭本机参与意向'); }
    else if (action === 'request-friend' && people[id] && !data.friends.includes(id) && !data.outgoing.includes(id)) openModal('request-friend', { id });
    else if (action === 'accept-request' && data.incoming.includes(id)) {
      data.incoming = data.incoming.filter(p => p !== id);
      if (!data.friends.includes(id)) data.friends.push(id);
      data.chats[id] ||= [];
      save(); render(); toast('已添加示例好友，可以体验聊天了');
    } else if (action === 'chat-details') {
      if (groupById(screen.id)) navigate({ type: 'group-details', id: screen.id });
      else if (data.friends.includes(screen.id)) navigate({ type: 'friend-details', id: screen.id });
    } else if (action === 'transfer' && screen.type === 'chat' && canChat(data, screen.id)) {
      // No fake or prefilled address is ever passed into the real wallet flow.
      closeModal(); onTransfer();
    } else if (action === 'compose-packet' && screen.type === 'chat') openModal('compose-packet');
    else if (action === 'edit-packet' && modal?.type === 'packet-preview') openModal('compose-packet', { draft: { ...modal.packet } });
    else if (action === 'send-packet') void authorizeAndSendPacket();
    else if (action === 'open-packet' || action === 'packet-cover') {
      if (screen.type !== 'chat') return;
      const message = findPacket(id);
      if (message) openModal(packetStatus(message.packet).canClaim ? 'packet-cover' : 'packet-details', { id });
    } else if (action === 'claim-packet') openAndClaimPacket(id);
    else if (action === 'toggle-emoji' && screen.type === 'chat') { const input = root.querySelector('[name=message]'); screen.caretStart = input?.selectionStart; screen.caretEnd = input?.selectionEnd; screen.emojiOpen = !screen.emojiOpen; screen.trayOpen = false; render(); }
    else if (action === 'expression-tab') { screen.expressionTab = target.dataset.tab; render(); }
    else if (action === 'emoji-category') { screen.emojiCategory = target.dataset.category; render(); }
    else if (action === 'emoji-pick' && screen.type === 'chat') {
      const emoji = target.dataset.emoji;
      if (!EMOJI_GROUPS.some(group => group.emojis.includes(emoji))) return;
      const input = root.querySelector('[name=message]'), value = screen.draft || '', start = screen.caretStart ?? input?.selectionStart ?? value.length, end = screen.caretEnd ?? input?.selectionEnd ?? start;
      const next = value.slice(0, start) + emoji + value.slice(end);
      if (next.length > 1000) return;
      setDraft(next); screen.caretStart = start + emoji.length; screen.caretEnd = screen.caretStart; if (input) { input.value = next; input.focus(); input.setSelectionRange(start + emoji.length, start + emoji.length); }
    } else if (action === 'sticker-send' && screen.type === 'chat' && getSticker(id)) {
      try { addMessage({ type: 'sticker', stickerId: id }); render(); } catch (error) { toast(error.message); }
    } else if (action === 'choose-images' && screen.type === 'chat') root.querySelector('[data-chat-file]')?.click();
    else if (action === 'remove-image' && modal?.type === 'images') { modal.images.splice(Number(target.dataset.index), 1); renderModal(); }
    else if (action === 'send-images' && modal?.type === 'images' && !modal.reading) {
      try { const message = { id: uid(), type: 'image', images: modal.images }; if (!isValidMediaMessage(message)) throw new Error('图片格式无效，请重新选择'); addMessage(message); closeModal(); screen.trayOpen = false; render(); }
      catch (error) { modal.error = error.message; renderModal(); }
    } else if (action === 'image-view' && screen.type === 'chat') openModal('image-gallery', { id, index: Number(target.dataset.index) || 0 });
    else if (action === 'gallery-prev' && modal?.type === 'image-gallery') { modal.index = Math.max(0, modal.index - 1); renderModal(); }
    else if (action === 'gallery-next' && modal?.type === 'image-gallery') { modal.index++; renderModal(); }

  }
  function onInput(event) {
    if (event.target.matches('[data-friend-search]') && screen.type === 'add-friend') {
      screen.friendQuery = String(event.target.value || '').slice(0,80);
      const results = root.querySelector('[data-friend-results]'), count = root.querySelector('[data-friend-count]');
      if (results) results.innerHTML = friendDirectoryRows();
      if (count) count.textContent = `${searchSocialDirectory(screen.friendQuery).length} 位`;
    } else if (event.target.matches('[data-search]')) {
      screen.search = event.target.value;
      const results = root.querySelector('[data-search-results]');
      if (results) results.innerHTML = screen.view === 'contacts' ? contactList() : conversationList();
    } else if (event.target.matches('[data-chat-search]') && screen.type === 'chat') {
      screen.chatQuery = event.target.value;
      const results = root.querySelector('[data-chat-scroll]');
      if (results) results.innerHTML = chatMessages();
    } else if (event.target.matches('[name=message]') && screen.type === 'chat') {
      setDraft(event.target.value); screen.caretStart = event.target.selectionStart; screen.caretEnd = event.target.selectionEnd;
    }
  }
  function onChange(event) {
    if (event.target.matches('[data-chat-file]')) { void chooseImages([...event.target.files]); event.target.value = ''; }
    else if (event.target.matches('[name=kind]') && modal?.type === 'compose-packet') {
      modal.draft = Object.fromEntries(new FormData(event.target.closest('form')));
      if (modal.draft.kind === 'exclusive') modal.draft.count = 1;
      renderModal(); root.querySelector(`[name=kind][value="${modal.draft.kind}"]`)?.focus();
    }
  }
  function onPaste(event) {
    if (screen.type !== 'chat' || !event.target.matches('[name=message]')) return;
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); void chooseImages(files); }
  }
  function onSubmit(event) {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    const values = new FormData(form);
    if (form.dataset.form === 'message' && screen.type === 'chat') {
      const message = String(values.get('message') || '').trim();
      if (!message) return;
      if (!canChat(data, screen.id)) return;
      try { addMessage({ type: 'text', text: message.slice(0, 1000) }); } catch (error) { toast(error.message); return; }
      setDraft(''); screen.chatQuery = ''; screen.searchOpen = false;
      render(); root.querySelector('[name=message]')?.focus();
    } else if (form.dataset.form === 'remark' && modal?.type === 'edit-remark') {
      try { setFriendRemark(data, modal.id, values.get('remark')); save(); closeModal(); render(); toast('好友备注已保存在本机'); }
      catch (error) { formError(form, error.message); }
    } else if (form.dataset.form === 'group-details' && modal?.type === 'edit-group') {
      try { updateGroupDetails(data, modal.id, { name: values.get('name'), note: values.get('note') }); save(); closeModal(); render(); toast('群资料已更新'); }
      catch (error) { formError(form, error.message); }
    } else if (form.dataset.form === 'invite-members' && modal?.type === 'invite-members') {
      try { inviteFriendsToGroup(data, modal.id, values.getAll('members')); save(); closeModal(); render(); toast('好友已加入本机演示群'); }
      catch (error) { formError(form, error.message); }
    } else if (form.dataset.form === 'group') {
      const name = String(values.get('name') || '').trim().slice(0, 24), members = values.getAll('members').filter(id => data.friends.includes(id));
      if (!name) return formError(form, '给群聊起个名字吧。');
      if (!members.length) return formError(form, '至少选择 1 位好友。');
      const id = `group-${uid()}`;
      data.groups.push({ id, name, members, color: 'mint', note: '和熟悉的人，聊有温度的日常。' });
      data.chats[id] = [];
      save(); closeModal(); openChat(id); toast('本机演示群聊已创建');
    } else if (form.dataset.form === 'request' && modal?.type === 'request-friend' && Object.hasOwn(people, modal.id)) {
      try {
        const next = readState({ strict:true });
        if (next.friends.includes(modal.id)) throw new Error('你们已经是好友。');
        if (!next.outgoing.includes(modal.id)) next.outgoing.push(modal.id);
        commitData(next); closeModal(); render(); toast('演示申请已保存，未发送给他人');
      } catch(error) { formError(form,error.message); }
    } else if (form.dataset.form === 'packet') {
      try {
        const fresh = readState({ strict: true }), draft = buildPacketDraft(fresh, screen.id, Object.fromEntries(values));
        if (draft.totalUnits > fresh.wallets.me) throw new Error(`演示平台余额不足，当前可用 ${demoAmount(fresh.wallets.me)} tBNB。`);
        data = fresh; openModal('packet-preview', { packet: draft });
      } catch (error) { formError(form, error.message); }
    } else if (form.dataset.form === 'post') {
      const value = String(values.get('text') || '').trim().slice(0, 500);
      if (!value) return formError(form, '写一点想分享的日常吧。');
      data.posts.push({ id: uid(), text: value, time: `本机动态 · ${nowLabel()}` });
      save(); closeModal(); render(); toast('动态已保存在本机');
    }
  }
  function onKeydown(event) {
    if (quickMenuOpen) {
      if (event.key === 'Escape') { event.preventDefault(); closeQuickMenu(true); return; }
      if (event.key === 'Tab') { closeQuickMenu(true); return; }
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
        event.preventDefault();
        const items = [...root.querySelectorAll('[data-quick-menu-host] [role="menuitem"]')];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length-1 : event.key === 'ArrowDown' ? (index+1)%items.length : (index-1+items.length)%items.length;
        items[next]?.focus(); return;
      }
    }
    if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
    if (modal.type === 'image-gallery' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); modal.index = Math.max(0, modal.index + (event.key === 'ArrowLeft' ? -1 : 1)); renderModal(); return; }
    if (event.key === 'Tab') {
      const focusables = [...root.querySelectorAll('.soc-modal button:not([disabled]), .soc-modal input:not([type=hidden]), .soc-modal textarea')];
      const first = focusables[0], last = focusables.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('paste', onPaste);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('keydown', onKeydown);
  document.addEventListener?.('pointerdown', onOutsideMenu);
  globalThis.window?.visualViewport?.addEventListener('resize', fitVisualViewport);
  globalThis.window?.visualViewport?.addEventListener('scroll', fitVisualViewport);
  if (!storageError) {
    try { const next = structuredClone(data); installDemoPacketSample(next); commitData(next); }
    catch (error) { toast(error.message); }
  }
  render();
  const expiryTimer = setInterval(() => {
    if (destroyed || storageError || !hasDuePackets()) return;
    try {
      if (settleCurrentExpiry()) {
        const list = root.querySelector('[data-chat-scroll]'); if (list) list.innerHTML = chatMessages();
        if (modal && ['packet-cover', 'packet-details'].includes(modal.type)) { cancelOperations(); modal.busy = false; renderModal(); }
      }
    } catch (error) { if (!persistenceWarned) { toast(error.message); persistenceWarned = true; } }
  }, 1000);
  const cleanup = () => {
    if (destroyed) return;
    rememberScreen();
    destroyed = true;
    cancelOperations(); clearInterval(expiryTimer);
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.removeEventListener('paste', onPaste);
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('keydown', onKeydown);
    document.removeEventListener?.('pointerdown', onOutsideMenu);
    quickMenuOpen = false;
    globalThis.window?.visualViewport?.removeEventListener('resize', fitVisualViewport);
    globalThis.window?.visualViewport?.removeEventListener('scroll', fitVisualViewport);
    root.remove();
    onScreenChange({ screen: 'closed', conversationId: null });
  };
  cleanup.canGoBack = () => !destroyed && !!(quickMenuOpen || modal || screen.previous || screen.externalProfile || screen.type !== 'list');
  cleanup.back = back;
  return cleanup;
}
