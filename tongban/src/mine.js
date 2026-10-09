import './mine.css';
import { getLocalProfile, saveLocalProfile, PROFILE_AVATARS } from './profile-store.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const paths = {
  back: 'M15 5l-7 7 7 7', arrow: 'M9 5l7 7-7 7', edit: 'M14 5l5 5 M4 20l4-1L20 7l-3-3L5 16Z',
  moments: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M5.6 5.6l2.8 2.8 M15.6 15.6l2.8 2.8 M5.6 18.4l2.8-2.8 M15.6 8.4l2.8-2.8',
  draft: 'M6 3h8l4 4v14H6Z M14 3v5h4 M9 12h6 M9 16h4', bill: 'M5 3h14v18l-3-2-4 2-4-2-3 2Z M8 8h8 M8 12h8',
  order: 'M4 7h16v14H4Z M8 7V5a4 4 0 0 1 8 0v2 M8 12h8', shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z M8 12l3 3 5-6',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M9.5 8a2.5 2.5 0 1 1 3 4v2 M12.5 17h.01', wallet: 'M4 7h15v14H4V4h12v3 M19 11h-5v5h5',
  lock: 'M5 10h14v11H5Z M8 10V6a4 4 0 0 1 8 0v4', key: 'M14 6a5 5 0 1 1 0 7l-7 7H3v-4l7-7 M17 7h.1',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', check: 'M5 12l4 4L19 6',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.help}"/></svg>`;
const button = (action, label, extra = '') => `<button type="button" class="mine-button" data-mine-action="${action}" ${extra}>${label}</button>`;
const row = (action, name, description, symbol, suffix = '') => `<button type="button" class="mine-row" data-mine-action="${action}"><span class="mine-row-icon">${icon(symbol)}</span><span class="mine-row-copy"><strong>${name}</strong><small>${description}</small></span>${suffix ? `<span class="mine-row-note">${suffix}</span>` : ''}${icon('arrow')}</button>`;

/** Local profile and product navigation only. Wallet authorization stays in app.js. */
export function mountMine(container, { toast = () => {}, onNavigate = () => {}, onAction = () => {}, getWalletStatus = () => ({}), getDraftCount = () => 0, isNative = false } = {}) {
  let active = true, view = 'home', profile = null, profileError = false, selectedAvatar = PROFILE_AVATARS[0], homeScroll = 0;

  function readProfile() {
    try { profile = getLocalProfile(); profileError = false; }
    catch { profile = null; profileError = true; }
  }
  function walletStatus() {
    try { return getWalletStatus() || { unavailable: true }; }
    catch { return { unavailable: true }; }
  }
  function draftCount() {
    try { const value = getDraftCount(); return Number.isSafeInteger(value) && value >= 0 ? String(value) : '暂不可用'; }
    catch { return '暂不可用'; }
  }
  function heading(title, description) {
    return `<header class="mine-subhead"><button type="button" class="mine-back" data-mine-action="home" aria-label="返回个人中心">${icon('back')}</button><div><h2 tabindex="-1">${title}</h2><p>${description}</p></div></header>`;
  }
  function home() {
    const count = draftCount(), state = walletStatus();
    const unavailable = state.corrupt || state.unavailable || typeof state.exists !== 'boolean' || state.exists && !state.address;
    const walletLabel = unavailable ? '钱包状态暂不可用' : state.exists ? '钱包已创建' : '尚未创建钱包';
    return `<section class="mine-home-profile"><span class="mine-avatar" aria-hidden="true">${profile ? esc(profile.avatar) : '🌱'}</span><div class="mine-home-profile-copy"><h2>${profile ? esc(profile.nickname) : '个人资料暂不可用'}</h2><p>${profile ? esc(profile.bio || '写一句个人签名') : '原始资料已保留'}</p><span>本机资料</span></div>${button('edit', `${icon('edit')}<span>编辑</span>`, `aria-label="编辑资料" ${profileError ? 'disabled' : ''}`)}</section>${profileError ? `<div class="mine-inline-error" role="alert">本机资料无法读取，请检查存储权限。${button('retry-profile', '重新读取资料')}</div>` : ''}
      <button type="button" class="mine-assets-entry" data-mine-action="wallet"><span class="mine-assets-symbol">${icon('wallet')}</span><span class="mine-assets-copy"><strong>我的资产</strong><small>钱包与平台余额</small></span><span class="mine-assets-state ${unavailable ? 'is-unavailable' : ''}">${walletLabel}</span>${icon('arrow')}</button>
      <div class="mine-home-shortcuts"><button type="button" class="mine-home-shortcut mine-mint" data-mine-action="moments"><span class="mine-shortcut-icon">${icon('moments')}</span><span><strong>朋友圈</strong><small>我的动态</small></span>${icon('arrow')}</button><button type="button" class="mine-home-shortcut mine-lilac" data-mine-action="drafts"><span class="mine-shortcut-icon">${icon('draft')}</span><span><strong>草稿</strong><small>${count === '暂不可用' ? '数量暂不可用' : `${count} 份 · 未提交`}</small></span>${icon('arrow')}</button></div>
      <section class="mine-list mine-home-links" aria-label="个人功能">${row('ai', '我的 AI 工作台', '本地安装与云端进度', 'order')}${row('bill-center', '账单记录', '', 'bill')}${row('security', '安全设置', '', 'shield')}${row('help', '帮助', '', 'help')}${!isNative?row('install', '安装愚笨者', '手机与电脑', 'wallet'):''}</section>
      <p class="mine-footnote mine-home-footnote">愚笨者 · 0.10.0 · 仅支持 BSC 测试网</p>`;
  }
  function edit() {
    if (!profile) return `${heading('编辑资料', '仅保存在当前设备')}<div class="mine-info mine-warning" role="alert">资料暂不可用，当前不能覆盖原始资料。</div>${button('retry-profile', '返回并重新读取')}`;
    return `${heading('编辑资料', '让朋友认出你，也保留自己的风格')}<form class="mine-edit-form mine-panel" data-mine-form="profile"><div class="mine-avatar-preview"><span class="mine-avatar" data-mine-preview aria-hidden="true">${esc(selectedAvatar)}</span><span>选择一个头像<small>预设头像，不上传图片</small></span></div><fieldset class="mine-avatar-fieldset"><legend class="mine-sr-only">选择头像</legend><div class="mine-avatar-options">${PROFILE_AVATARS.map((avatar, index) => `<button type="button" data-mine-action="avatar" data-mine-avatar="${index}" class="mine-avatar-option" aria-label="头像 ${index + 1}：${esc(avatar)}" aria-pressed="${avatar === selectedAvatar}">${esc(avatar)}</button>`).join('')}</div></fieldset><label class="mine-field">昵称 <span>最多 24 个字符</span><input name="nickname" type="text" maxlength="24" required autocomplete="nickname" value="${esc(profile.nickname)}" placeholder="朋友熟悉的名字"></label><label class="mine-field">个人签名 <span>最多 80 个字符</span><textarea name="bio" maxlength="80" rows="3" placeholder="分享一句此刻的心情">${esc(profile.bio)}</textarea></label><div class="mine-readonly"><span>档案标识</span><strong>${esc(profile.localId)}</strong><small>这是本机体验标识，不是注册账号或好友邀请码。</small></div><p class="mine-form-error" role="alert" data-mine-form-error></p><button type="submit" class="mine-primary">保存本机资料</button>${button('home', '取消编辑')}<p class="mine-form-note">只保存昵称、签名和预设头像，不修改钱包地址或密钥。</p></form>`;
  }
  function security() {
    const state = walletStatus(), unavailable = state.corrupt || state.unavailable || state.exists && !state.address;
    const label = unavailable ? '暂不可读取' : state.exists ? state.unlocked ? '已解锁' : '已锁定' : '尚未创建';
    return `${heading('安全中心', '个人资料与钱包，各自管理')}<section class="mine-security-card"><span class="mine-security-symbol">${icon('shield')}</span><div><span class="mine-eyebrow">自托管钱包</span><h3>${label}</h3><p>${unavailable ? '原始钱包数据不会被覆盖。请保留已有离线备份。' : state.exists ? '本机加密保存，密钥由你自行保管。' : '社交资料可以独立使用；资金操作前再创建测试钱包。'}</p></div></section>
      <div class="mine-info">本机资料不是线上账号，钱包密码也不是社交登录密码。目前仅支持 BSC 测试网，其他网络与真实资金服务尚未开放。</div>
      <section class="mine-section"><div class="mine-section-title"><h3>钱包管理</h3></div><div class="mine-list">${row('wallet', '查看我的钱包', '查看链上资产和平台账户', 'wallet')}${!unavailable ? state.exists ? `${row(state.unlocked ? 'lock' : 'unlock', state.unlocked ? '立即锁定钱包' : '解锁钱包', state.unlocked ? '关闭当前签名会话' : '使用本机钱包密码验证', 'lock')}${row('export', '导出加密备份', '导出受密码保护的 JSON 文件', 'draft')}` : row('create', '创建或恢复测试钱包', '创建后完成助记词备份验证', 'key') : row('help', '查看钱包恢复指引', '先保护原始数据，再确认恢复方式', 'help')}</div><p class="mine-form-note">切到后台或闲置 5 分钟后钱包自动锁定。助记词请离线保存；加密文件与密码分开保管。</p></section>
      <section class="mine-section"><div class="mine-section-title"><h3>当前隐私规则</h3><span>默认隐私规则</span></div><div class="mine-rules"><div>${icon('check')}<span><strong>好友通过后才能私聊</strong><small>同群成员不会自动成为好友</small></span></div><div>${icon('eye')}<span><strong>资产默认隐藏</strong><small>可在资产页面临时展开查看</small></span></div><div>${icon('shield')}<span><strong>不自动公开资产或加入榜单</strong><small>当前榜单使用示例资料</small></span></div></div></section><div class="mine-info mine-warning">愚笨者不会索要助记词或私钥。忘记本机密码时，可通过离线助记词在可信钱包中恢复；请勿导入存有真实资产的钱包。</div>`;
  }
  function orders() {
    return `${heading('服务订单', '每一笔真实服务，都应有明确进度')}<section class="mine-empty mine-panel"><span class="mine-empty-symbol">${icon('order')}</span><span class="mine-status-pill">服务尚未接通</span><h3>这里还没有真实订单</h3><p>发现页保存的服务需求、发币和接入申请都是本机草稿，尚未提交，也没有扣款。草稿不会自动成为订单。</p><button type="button" class="mine-primary" data-mine-action="drafts">查看我的草稿</button>${button('home', '返回个人中心')}</section>`;
  }
  function help() {
    return `${heading('帮助与反馈', '先找到原因，再继续下一步')}<div class="mine-help-banner"><span>${icon('help')}</span><div><h3>需要一点帮助？</h3><p>常见问题的处理方法，都放在这里。</p></div></div><section class="mine-faqs" aria-label="常见问题">
      <details><summary>AI 本地安装和云端使用有什么区别？</summary><p>本地版在电脑安装 Ollama 与模型，Windows 客户端可检查连接并运行已有本地模型；网页端可整理并导出提示词。云端版在服务器网页提交申请，审核和服务配置完成后使用；可查看任务结果和取消任务。当前使用免费验收额度，不扣平台余额；请勿输入助记词、私钥、钱包密码或敏感个人资料。</p><button type="button" class="mine-text-button" data-mine-action="ai">打开 AI 工作台</button></details><details><summary>手机、电脑和网页的数据会同步吗？</summary><p>社交、钱包和草稿各自保存本机数据，不自动同步。云端 AI 申请和任务保存在服务器，与服务器访问账号关联。安装 App 后需要创建新的测试钱包，或使用你自己的测试钱包助记词恢复。聊天、图片、朋友圈及草稿仍是单机演示；导出的加密备份请单独保管。请勿导入存有真实资产的钱包。</p></details>
      <details><summary>本机资料和钱包有什么区别？</summary><p>昵称、头像和签名只保存在当前设备，不代表已注册线上账号。钱包管理链上资产，使用独立的本机密码；修改资料不会修改钱包地址。</p></details>
      <details><summary>能使用哪些网络和资产？</summary><p>当前链上功能仅支持 BSC 测试网原生 tBNB。测试币没有实际价值。BSC 主网、其他网络和真实 USDT 充值提现均未开放，请勿转入真实资金。</p><button type="button" class="mine-text-button" data-mine-action="wallet">查看资产页面 ${icon('arrow')}</button></details>
      <details><summary>转账已提交，为什么还没到账？</summary><p>已提交不等于已确认。在账单中心查看最新状态；广播结果不明确时，先核对交易哈希与链上状态，避免重复转账。当前本机记录不代表完整链上收支。</p><button type="button" class="mine-text-button" data-mine-action="bill-center">去账单中心 ${icon('arrow')}</button></details>
      <details><summary>为什么转入、转出余额后金额没变？</summary><p>平台充值、提现和真实资金托管尚未接通。密码验证后只保存未提交草稿，不扣款、不入账。服务接通后也需要重新确认，草稿不会自动执行。</p></details>
      <details><summary>忘记密码、换手机或卸载 App 怎么办？</summary><p>本机密码不能由平台找回。钱包需使用离线助记词在可信钱包中恢复；当前版本只用于测试，不要导入真实资金钱包。昵称、草稿和演示记录没有云端同步，卸载 App 或清除数据会丢失本机记录。操作前请先保留已有备份。</p><button type="button" class="mine-text-button" data-mine-action="security">打开安全中心 ${icon('arrow')}</button></details>
      <details><summary>页面显示存储或网络异常怎么办？</summary><p>先检查网络与浏览器存储权限，再重试读取。不要先清除网站数据，也不要连续重复转账。记录读取失败不代表记录不存在；原始数据不会由错误提示自动覆盖。</p></details></section>
      <section class="mine-support-card"><span class="mine-status-pill">在线支持尚未接通</span><h3>关于问题反馈</h3><p>当前没有在线客服或工单提交功能，页面不会把本机操作显示成已提交反馈。请勿通过任何聊天或反馈发送助记词、私钥和钱包密码。</p></section>`;
  }
  function render(focus = false) {
    if (!active) return;
    const screens = { home, edit, security, orders, help };
    container.innerHTML = `<div class="mine-page" data-mine-view="${view}">${screens[view]()}</div>`;
    if (focus) container.querySelector('h2')?.focus({ preventScroll: true });
  }
  function scrollTo(top) { globalThis.window?.scrollTo({ top, behavior: 'instant' }); }
  function open(next) {
    if (view === 'home') homeScroll = globalThis.window?.scrollY || 0;
    view = next;
    if (next === 'home') readProfile();
    if (next === 'edit') selectedAvatar = profile?.avatar || PROFILE_AVATARS[0];
    render(true); scrollTo(next === 'home' ? homeScroll : 0);
  }
  function action(name) {
    try {
      const result = onAction(name);
      Promise.resolve(result).then(() => { if (active && view === 'security') render(); }).catch(() => { if (active) toast('操作暂未完成，请重试。'); });
    } catch { toast('操作暂未完成，请重试。'); }
  }
  function onClick(event) {
    const target = event.target.closest('[data-mine-action]');
    if (!active || !target || !container.contains(target) || target.disabled) return;
    const name = target.dataset.mineAction;
    if (['home', 'edit', 'security', 'orders', 'help'].includes(name)) { open(name); return; }
    if (name === 'retry-profile') { open('home'); return; }
    if (name === 'moments') { onNavigate('discover', { route: 'moments', own: true }); return; }
    if (name === 'ai') { onNavigate('discover', { route: 'ai' }); return; }
    if (name === 'drafts') { onNavigate('discover', { route: 'drafts' }); return; }
    if (name === 'wallet') { onNavigate('wallet'); return; }
    if (name === 'avatar') {
      const value = PROFILE_AVATARS[Number(target.dataset.mineAvatar)];
      if (view !== 'edit' || !value) return;
      selectedAvatar = value;
      for (const node of container.querySelectorAll('[data-mine-avatar]')) node.setAttribute('aria-pressed', String(PROFILE_AVATARS[Number(node.dataset.mineAvatar)] === value));
      const preview = container.querySelector('[data-mine-preview]'); if (preview) preview.textContent = value;
      return;
    }
    if (['bill-center', 'lock', 'unlock', 'export', 'create'].includes(name) || name === 'install' && !isNative) action(name);
  }
  function onSubmit(event) {
    const form = event.target.closest('form[data-mine-form="profile"]');
    if (!active || !form || !container.contains(form) || view !== 'edit') return;
    event.preventDefault();
    const error = form.querySelector('[data-mine-form-error]');
    error.textContent = '';
    try {
      const saved = saveLocalProfile({ nickname: form.elements.nickname.value, bio: form.elements.bio.value, avatar: selectedAvatar });
      // Do not leave the form or claim success before storage confirms the write.
      profile = saved; profileError = false; view = 'home'; homeScroll = 0; render(true); scrollTo(0); toast('个人资料已保存在本机');
      action('profile-updated');
    } catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : '资料没有保存，请稍后重试。';
    }
  }
  const refreshStatus = () => { if (active && view === 'security') render(); };
  readProfile(); render();
  container.addEventListener('click', onClick);
  container.addEventListener('submit', onSubmit);
  globalThis.window?.addEventListener('tongban:wallet-locked', refreshStatus);
  const cleanup = () => {
    active = false;
    container.removeEventListener('click', onClick);
    container.removeEventListener('submit', onSubmit);
    globalThis.window?.removeEventListener('tongban:wallet-locked', refreshStatus);
  };
  cleanup.back = () => { if(view==='home')return false;open('home');return true; };
  cleanup.refresh = () => { if (view !== 'edit') render(); };
  return cleanup;
}
