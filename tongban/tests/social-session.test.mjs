import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stripCSS = source => source.replace(/import '\.\/[^']+\.css';\n/g, '');
const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const mediaURL = dataURL(stripCSS(await readFile(new URL('../src/chat-media.js', import.meta.url), 'utf8')));
const source = stripCSS(await readFile(new URL('../src/social.js', import.meta.url), 'utf8'))
  .replace("'./redpacket-model.js'", JSON.stringify(new URL('../src/redpacket-model.js', import.meta.url).href))
  .replace("'./chat-media.js'", JSON.stringify(mediaURL))
  .replace("'./profile-store.js'", JSON.stringify(new URL('../src/profile-store.js', import.meta.url).href))
  + '\nexport { seed, sessionDrafts, sessionLists, createDemoPacket, claimDemoPacket, settleExpired };';
const social = await import(dataURL(source));
const KEY = 'tongban.social.demo.v1', PROFILE = 'tongban.profile.v1';
let store, frames, nextFrame, roots;

// Minimal DOM surface for event-driven session lifecycle tests; no browser or network.
class Root {
  constructor() {
    this.listeners = new Map(); this.classList = { toggle() {} }; this.style = { setProperty() {} }; this.scrollTop = 0;
    this.host = { innerHTML: '' }; this.quickHost = { innerHTML: '' }; this.results = { innerHTML: '' }; this.html = '';
  }
  set innerHTML(value) {
    this.html = value; this.host.innerHTML = '';this.quickHost.innerHTML='';
    this.list = value.includes('data-chat-scroll') ? { scrollTop: 0, scrollHeight: 900, clientHeight: 300, innerHTML: '' } : null;
    this.input = value.includes('name="message"') ? { value: '', focus() {}, setSelectionRange() {} } : null;
  }
  get innerHTML() { return this.html; }
  setAttribute() {}
  querySelector(selector) {
    if (selector === '[data-modal-host]') return this.host;
    if (selector === '[data-chat-scroll]') return this.list;
    if (selector === '[data-search-results]') return this.results;
    if (selector === '[data-quick-menu-host]') return this.quickHost;
    if (selector === '[data-friend-results]') return this.results;
    if (selector === '[name=message]') return this.input;
    return null;
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  removeEventListener(name) { this.listeners.delete(name); }
  contains() { return true; }
  remove() { this.removed = true; }
}
function flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); }
function mount(options = {}) {
  const container = { scrollTop: 0, append(root) { this.root = root; } }, changes = [];
  const cleanup = social.mountSocial(container, { onScreenChange: value => changes.push(value), ...options });
  const root = container.root; flush();
  const click = (action, id, extra = {}) => {
    const target = { dataset: { action, id, ...extra }, matches: () => false, closest: () => target };
    root.listeners.get('click')({ target }); flush();
  };
  const input = (selector, value) => {
    const target = { value, selectionStart: value.length, selectionEnd: value.length, matches: query => query === selector };
    root.listeners.get('input')({ target }); flush();
  };
  return { root, container, cleanup, click, input, changes };
}
test.beforeEach(() => {
  store = new Map(); frames = new Map(); nextFrame = 1; roots = [];
  social.sessionDrafts.clear(); social.sessionLists.clear();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  globalThis.document = { createElement() { const root = new Root(); roots.push(root); return root; } };
  globalThis.window = { scrollY: 0, scrollTo({ top }) { this.scrollY = top; } };
  globalThis.requestAnimationFrame = fn => { const id = nextFrame++; frames.set(id, fn); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
});

test('message plus menu closes before invoking the distinct scanner modes',()=>{
 const calls=[];let a;
 a=mount({onScanTransfer:()=>{assert.equal(a.root.quickHost.innerHTML,'');calls.push('transfer')},onScan:mode=>{assert.equal(a.root.quickHost.innerHTML,'');calls.push(mode)}});
 try{
  a.click('quick-menu');const markup=a.root.quickHost.innerHTML;
  assert.ok(markup.indexOf('扫码转账')<markup.indexOf('添加好友'));assert.ok(markup.indexOf('添加好友')<markup.indexOf('扫一扫'));
  a.click('soc-scan-transfer');a.click('quick-menu');a.click('soc-scan');
  a.click('soc-add-friend');a.click('soc-scan-friend');assert.deepEqual(calls,['transfer','all','friend']);
 }finally{a.cleanup()}
});

test('friend lookup filters existing identities and never grants friendship on profile view',()=>{
 const a=mount();
 try{
  const before=JSON.parse(localStorage.getItem(KEY)).friends;
  a.click('soc-add-friend');assert.match(a.root.innerHTML,/暂不支持跨设备添加好友/);
  a.input('[data-friend-search]','moon');assert.match(a.root.results.innerHTML,/月亮邮递员/);assert.doesNotMatch(a.root.results.innerHTML,/林一/);
  a.click('profile','moon');assert.match(a.root.innerHTML,/data-action="request-friend"/);
  assert.deepEqual(JSON.parse(localStorage.getItem(KEY)).friends,before);
  a.cleanup.back();flush();assert.match(a.root.innerHTML,/value="moon"/);
 }finally{a.cleanup()}
});

test('each conversation retains its unsent draft through internal navigation and remount', () => {
  const a = mount();
  try {
    const saved = localStorage.getItem(KEY);
    a.click('open-chat', 'lin'); a.input('[name=message]', '留给林一 <草稿>');
    a.click('toggle-tray'); assert.match(a.root.innerHTML, /value="留给林一 &lt;草稿&gt;"/);
    a.cleanup.back(); flush(); assert.match(a.root.innerHTML, /\[草稿\]/);
    a.click('open-chat', 'ke'); assert.match(a.root.innerHTML, /aria-label="消息内容" value=""/);
    a.input('[name=message]', '给可可的草稿'); a.cleanup();
    assert.equal(localStorage.getItem(KEY), saved, 'typing and navigation do not fabricate sent messages');
    const b = mount();
    try {
      b.click('open-chat', 'lin'); assert.match(b.root.innerHTML, /value="留给林一 &lt;草稿&gt;"/);
      b.cleanup.back(); flush(); b.click('open-chat', 'ke'); assert.match(b.root.innerHTML, /value="给可可的草稿"/);
    } finally { b.cleanup(); }
  } finally { a.cleanup(); }
});

test('switching conversations preserves drafts and returns directly to the original list', () => {
  const a = mount();
  try {
    a.input('[data-search]', '咖啡');
    a.click('open-chat', 'lin'); a.input('[name=message]', '林一未发送');
    a.click('open-chat', 'ke'); a.input('[name=message]', '可可未发送');
    a.click('open-chat', 'lin'); assert.match(a.root.innerHTML, /value="林一未发送"/);
    a.cleanup.back(); flush();
    assert.equal(a.changes.at(-1).screen, 'list');
    assert.match(a.root.innerHTML, /value="咖啡"/);
    assert.equal(a.cleanup.canGoBack(), false);
    a.click('open-chat', 'ke'); assert.match(a.root.innerHTML, /value="可可未发送"/);
    a.click('back-list'); assert.equal(a.changes.at(-1).screen, 'list');
    assert.equal(a.cleanup.canGoBack(), false);
    assert.equal(social.sessionDrafts.get('lin'), '林一未发送');
    assert.equal(social.sessionDrafts.get('ke'), '可可未发送');
  } finally { a.cleanup(); }
});

test('sidebar return opens messages even when chat began from contacts', () => {
  const routes = [], a = mount({ view: 'contacts', onNavigate: view => routes.push(view) });
  try {
    a.click('open-chat', 'lin'); a.input('[name=message]', '通讯录聊天草稿');
    a.click('open-chat', 'ke'); a.click('back-list');
    assert.deepEqual(routes, ['messages']);
    assert.equal(social.sessionDrafts.get('lin'), '通讯录聊天草稿');
  } finally { a.cleanup(); }
});

test('list search and scroll restore without the removed friend/group filter', () => {
  const a = mount();
  try {
    assert.doesNotMatch(a.root.innerHTML, /aria-label="消息筛选"/);
    a.input('[data-search]', '咖啡'); window.scrollY = 126; a.container.scrollTop = 52;
    a.click('open-chat', 'lin'); a.cleanup.back(); flush();
    assert.match(a.root.innerHTML, /value="咖啡"/); assert.doesNotMatch(a.root.innerHTML, /data-action="filter"/);
    assert.equal(window.scrollY, 126); assert.equal(a.container.scrollTop, 52);
    a.cleanup();
    const b = mount();
    try { assert.match(b.root.innerHTML, /value="咖啡"/); assert.equal(window.scrollY, 126); assert.equal(b.container.scrollTop, 52); }
    finally { b.cleanup(); }
  } finally { a.cleanup(); }
});

test('cleared drafts stay empty after search cancellation, nested details and repeated navigation', () => {
  const a = mount();
  try {
    a.click('open-chat', 'group-weekend'); a.input('[name=message]', '待清空的草稿');
    a.cleanup.back(); flush(); a.input('[data-search]', '周末'); a.click('open-chat', 'group-weekend');
    a.input('[name=message]', ''); assert.equal(social.sessionDrafts.has('group-weekend'), false);
    a.click('close-chat-search'); a.click('chat-details'); a.cleanup.back(); flush(); a.click('toggle-tray');
    assert.match(a.root.innerHTML, /aria-label="消息内容" value=""/); assert.doesNotMatch(a.root.innerHTML, /待清空的草稿/);
    a.cleanup.back(); flush(); assert.doesNotMatch(a.root.innerHTML, /\[草稿\]/);
    a.click('open-chat', 'group-weekend'); assert.match(a.root.innerHTML, /aria-label="消息内容" value=""/);
    a.cleanup();
    const b = mount();
    try { b.click('open-chat', 'group-weekend'); assert.match(b.root.innerHTML, /aria-label="消息内容" value=""/); }
    finally { b.cleanup(); }
  } finally { a.cleanup(); }
});

test('chat rerenders preserve reading position and report screen lifecycle without owning browser history', () => {
  const a = mount();
  try {
    assert.equal(a.cleanup.canGoBack(), false); assert.equal(a.cleanup.back(), false);
    a.click('open-chat', 'lin'); a.root.list.scrollTop = 80;
    a.click('toggle-tray'); assert.equal(a.root.list.scrollTop, 80);
    assert.deepEqual(a.changes.at(-1), { screen: 'chat', conversationId: 'lin' });
    a.click('chat-details'); assert.equal(a.changes.at(-1).screen, 'friend-details');
    assert.equal(a.cleanup.back(), true); flush(); assert.equal(a.root.list.scrollTop, 80);
    a.click('compose-packet'); assert.equal(a.cleanup.back(), true); assert.equal(a.changes.at(-1).screen, 'chat');
    a.cleanup(); assert.deepEqual(a.changes.at(-1), { screen: 'closed', conversationId: null });
    assert.equal(a.cleanup.canGoBack(), false); assert.equal(a.cleanup.back(), false); assert.equal(a.root.listeners.size, 0);
  } finally { a.cleanup(); }
});

test('local profile nickname and emoji render safely, and malformed profile is preserved with an error', () => {
  store.set(PROFILE, JSON.stringify({ version: 1, nickname: '<阿林>', bio: '熟悉的人', avatar: '🌊' }));
  const a = mount();
  try { a.click('open-chat', 'group-weekend'); a.click('chat-details'); assert.match(a.root.innerHTML, /&lt;阿林&gt;/); assert.match(a.root.innerHTML, /🌊/); assert.doesNotMatch(a.root.innerHTML, /<阿林>/); }
  finally { a.cleanup(); }
  store.set(PROFILE, '{corrupt');
  const b = mount();
  try { assert.match(b.root.innerHTML, /本机资料无法读取，原始数据已保留/); assert.equal(store.get(PROFILE), '{corrupt'); }
  finally { b.cleanup(); }
});

test('packet bills separate actual sends, own claims and recorded refunds without mutating storage', () => {
  const data = social.seed(), start = Date.now() - 2 * 86400000;
  const message = social.createDemoPacket(data, 'group-weekend', { kind: 'equal', totalUnits: 300000, count: 3, greeting: '群红包' }, start);
  social.claimDemoPacket(data, message.packet, start + 1000);
  social.settleExpired(data, start + 86400000);
  const raw = JSON.stringify(data); store.set(KEY, raw);
  const bills = social.getSocialPacketBills();
  const own = bills.filter(bill => bill.id.includes(message.id));
  assert.equal(own.length, 3);
  assert.deepEqual(own.map(bill => [bill.direction, bill.amount]), [['in', '0.2'], ['in', '0.1'], ['out', '0.3']]);
  assert.ok(own.every(bill => bill.demo && bill.asset === 'tBNB' && typeof bill.amount === 'string' && Number.isFinite(bill.createdAt)));
  assert.equal(new Set(bills.map(bill => bill.id)).size, bills.length);
  assert.equal(store.get(KEY), raw); assert.deepEqual(social.getSocialPacketBills(), bills);
});

test('viewing bills never settles overdue refunds or invents income from unclaimed sample packets', () => {
  assert.deepEqual(social.getSocialPacketBills(), []); assert.equal(store.size, 0);
  const data = social.seed(), start = Date.now() - 2 * 86400000;
  social.createDemoPacket(data, 'lin', { kind: 'equal', totalUnits: 100000, count: 1, greeting: '过期红包' }, start);
  const raw = JSON.stringify(data); store.set(KEY, raw);
  const bills = social.getSocialPacketBills();
  assert.equal(bills.length, 1); assert.equal(bills[0].direction, 'out'); assert.equal(bills[0].status, '已过期 · 待退回'); assert.equal(store.get(KEY), raw);
  store.set(KEY, '{broken'); assert.throws(() => social.getSocialPacketBills(), /未覆盖旧记录/); assert.equal(store.get(KEY), '{broken');
});

test('wallet summary rejects corrupt storage and failed refund persistence instead of reporting seed funds', () => {
  store.set(KEY, '{broken'); assert.throws(() => social.getSocialWalletSummary(), /未覆盖旧记录/); assert.equal(store.get(KEY), '{broken');
  const data = social.seed();
  social.createDemoPacket(data, 'lin', { kind: 'equal', totalUnits: 100000, count: 1, greeting: '等待退款' }, Date.now() - 2 * 86400000);
  const raw = JSON.stringify(data); store.set(KEY, raw);
  localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => social.getSocialWalletSummary(), /保存失败/); assert.equal(store.get(KEY), raw);
});
