import './mine.css';
import { getLocalProfile, saveLocalProfile, PROFILE_AVATARS, validateUserId } from './profile-store.js';
import { prepareProfilePhoto } from './profile-photo.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const paths = {
  back: 'M15 5l-7 7 7 7', arrow: 'M9 5l7 7-7 7', edit: 'M14 5l5 5 M4 20l4-1L20 7l-3-3L5 16Z',
  draft: 'M6 3h8l4 4v14H6Z M14 3v5h4 M9 12h6 M9 16h4', bill: 'M5 3h14v18l-3-2-4 2-4-2-3 2Z M8 8h8 M8 12h8',
  order: 'M4 7h16v14H4Z M8 7V5a4 4 0 0 1 8 0v2 M8 12h8', shield: 'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z M8 12l3 3 5-6',
  help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M9.5 8a2.5 2.5 0 1 1 3 4v2 M12.5 17h.01', wallet: 'M4 7h15v14H4V4h12v3 M19 11h-5v5h5',
  lock: 'M5 10h14v11H5Z M8 10V6a4 4 0 0 1 8 0v4', key: 'M14 6a5 5 0 1 1 0 7l-7 7H3v-4l7-7 M17 7h.1',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', check: 'M5 12l4 4L19 6',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.help}"/></svg>`;
const button = (action, label, extra = '') => `<button type="button" class="mine-button" data-mine-action="${action}" ${extra}>${label}</button>`;
const row = (action, name, description, symbol, suffix = '') => `<button type="button" class="mine-row" data-mine-action="${action}"><span class="mine-row-icon">${icon(symbol)}</span><span class="mine-row-copy"><strong>${name}</strong>${description ? `<small>${description}</small>` : ''}</span>${suffix ? `<span class="mine-row-note">${suffix}</span>` : ''}${icon('arrow')}</button>`;

/** Local profile and product navigation only. Wallet authorization stays in app.js. */
export function mountMine(container, { toast = () => {}, onNavigate = () => {}, onAction = () => {}, getWalletStatus = () => ({}), getDraftCount = () => 0, isNative = false, profileService = null, processPhoto = prepareProfilePhoto } = {}) {
  let active = true, view = 'home', profile = null, profileError = false, selectedAvatar = PROFILE_AVATARS[0], selectedPhoto = '', homeScroll = 0, generation = 0, photoTask = 0, photoBusy = false, saving = false;
  const remote = () => profile?.identityScope === 'server';
  const avatarContent = (avatar, photo) => photo ? `<img src="${esc(photo)}" alt="个人头像" width="512" height="512">` : esc(avatar);
  const identity = () => profile ? `<span class="mine-user-id">ID ${esc(profile.userId)}</span><span class="mine-level">Lv. ${esc(profile.level)}</span>${profile.official ? '<span class="mine-official">官方认证</span>' : ''}` : '';

  function readProfile() {
    try { profile = profileService ? profileService.getProfile() : getLocalProfile();
      if (!profile || typeof profile.then === 'function') throw new Error('资料尚未加载');
      profileError = false; }
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
    return `<header class="mine-subhead"><button type="button" class="mine-back" data-mine-action="home" aria-label="返回个人中心">${icon('back')}</button><div><h2 tabindex="-1">${title}</h2>${description ? `<p>${description}</p>` : ''}</div></header>`;
  }
  function home() {
    const count = draftCount(), state = walletStatus();
    const unavailable = state.corrupt || state.unavailable || typeof state.exists !== 'boolean' || state.exists && !state.address;
    const walletLabel = unavailable ? '钱包状态暂不可用' : state.exists ? '钱包已创建' : '尚未创建钱包';
    return `<section class="mine-home-profile"><span class="mine-avatar" aria-hidden="true">${profile ? avatarContent(profile.avatar, profile.avatarImage) : '🌱'}</span><div class="mine-home-profile-copy"><h2>${profile ? esc(profile.nickname) : '个人资料暂不可用'}</h2>${profile ? '' : '<p>原始资料已保留</p>'}<div class="mine-profile-meta">${identity()}</div>${!remote() && profile ? '<span>本机资料 · ID 尚未云端登记</span>' : ''}</div>${button('edit', `<span>资料</span>${icon('arrow')}`, `aria-label="编辑资料" ${profileError ? 'disabled' : ''}`)}</section>${profileError ? `<div class="mine-inline-error" role="alert">${profileService ? '账号资料暂不可读，请检查网络后重新连接。' : '本机资料无法读取，请检查存储权限。'}${button('retry-profile', '重新读取资料')}</div>` : ''}
      <button type="button" class="mine-assets-entry" data-mine-action="wallet"><span class="mine-assets-symbol">${icon('wallet')}</span><span class="mine-assets-copy"><strong>我的资产</strong><small>平台资产 · 链上钱包</small></span><span class="mine-assets-state ${unavailable ? 'is-unavailable' : ''}">${walletLabel}</span>${icon('arrow')}</button>
      <div class="mine-home-shortcuts"><button type="button" class="mine-home-shortcut mine-lilac" data-mine-action="drafts"><span class="mine-shortcut-icon">${icon('draft')}</span><span><strong>草稿</strong><small>${count === '暂不可用' ? '数量暂不可用' : `${count} 份`}</small></span>${icon('arrow')}</button></div>
      <section class="mine-list mine-home-links" aria-label="个人功能">${row('ai', 'AI 工作台', '', 'order')}${row('bill-center', '账单记录', '', 'bill')}${profileService ? row('account-settings', '账号设置', '登录方式、恢复与设备', 'lock') : ''}${row('security', '安全设置', '', 'shield')}${row('help', '帮助', '', 'help')}${!isNative?row('install', '安装愚笨者', '手机与电脑', 'wallet'):''}</section>
      <p class="mine-footnote mine-home-footnote">愚笨者 · 0.14.0-dev.2</p>`;
  }
  function edit() {
    if (!profile) return `${heading('个人资料', '资料暂不可用')}<div class="mine-info mine-warning" role="alert">资料暂不可用，当前不能覆盖原始资料。</div>${button('retry-profile', '返回并重新读取')}`;
    return `${heading('个人资料', '')}<form class="mine-edit-form mine-panel" data-mine-form="profile"><div class="mine-avatar-preview"><span class="mine-avatar" data-mine-preview>${avatarContent(selectedAvatar, selectedPhoto)}</span><div><strong>头像</strong><div class="mine-photo-actions">${button('choose-photo', '选择照片')}${button('remove-photo', '移除照片', `data-mine-remove-photo ${selectedPhoto ? '' : 'disabled'}`)}</div></div></div><input class="mine-sr-only" type="file" data-mine-photo accept="image/jpeg,image/png,image/webp" aria-label="选择个人照片"><p class="mine-photo-status" data-mine-photo-status role="status" aria-live="polite">JPG、PNG、WebP · 最大 10 MB</p><details class="mine-avatar-presets"><summary>使用预设头像</summary><fieldset class="mine-avatar-fieldset"><legend class="mine-sr-only">预设头像</legend><div class="mine-avatar-options">${PROFILE_AVATARS.map((avatar, index) => `<button type="button" data-mine-action="avatar" data-mine-avatar="${index}" class="mine-avatar-option" aria-label="头像 ${index + 1}：${esc(avatar)}" aria-pressed="${!selectedPhoto && avatar === selectedAvatar}">${esc(avatar)}</button>`).join('')}</div></fieldset></details><label class="mine-field"><span class="mine-field-label">用户名</span><input name="nickname" type="text" maxlength="24" required autocomplete="nickname" value="${esc(profile.nickname)}" placeholder="朋友熟悉的名字"></label><label class="mine-field"><span class="mine-field-label">用户 ID</span><input name="userId" type="text" autocapitalize="none" pattern="[A-Za-z0-9_]{5,24}" minlength="5" maxlength="24" required autocomplete="off" value="${esc(profile.userId)}" aria-describedby="mine-id-help"></label><div class="mine-id-tools">${button('copy-id', '复制当前 ID')}<small id="mine-id-help">${remote() ? '5–24 位英文字母、数字或下划线，忽略大小写。修改间隔 30 天，旧 ID 至少保留 90 天。' : '此 ID 尚未云端登记，不保证与其他用户不重复。'}</small></div>${remote() && profile.authMode !== 'email' ? '<label class="mine-field" data-mine-id-password hidden><span class="mine-field-label">当前密码</span><input name="currentPassword" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" placeholder="6 位登录密码"></label>' : ''}<label class="mine-field mine-bio-field"><span class="mine-field-label">个人签名</span><textarea name="bio" maxlength="80" rows="2" placeholder="分享一句此刻的心情">${esc(profile.bio)}</textarea></label><div class="mine-readonly"><span>等级与认证</span><strong>Lv. ${esc(profile.level)} · ${profile.official ? '官方认证' : '普通账号'}</strong><small>等级由系统记录，官方标志仅由平台授予。</small></div><p class="mine-form-error" role="alert" data-mine-form-error></p><button type="submit" class="mine-primary" data-mine-save>保存资料</button>${button('home', '取消编辑')}<p class="mine-form-note">${remote() ? '资料保存后随账号同步。' : '资料仅保存在本机。'}不会更改钱包；取消将放弃本次修改。</p></form>`;
  }
  function security() {
    const state = walletStatus(), unavailable = state.corrupt || state.unavailable || state.exists && !state.address;
    const label = unavailable ? '暂不可读取' : state.exists ? state.unlocked ? '已解锁' : '已锁定' : '尚未创建';
    return `${heading('安全中心', '个人资料与钱包，各自管理')}<section class="mine-security-card"><span class="mine-security-symbol">${icon('shield')}</span><div><span class="mine-eyebrow">自托管钱包</span><h3>${label}</h3><p>${unavailable ? '原始钱包数据不会被覆盖。请保留已有离线备份。' : state.exists ? '本机加密保存，密钥由你自行保管。' : '社交资料可以独立使用；资金操作前再创建测试钱包。'}</p></div></section>
      <div class="mine-info">${remote() ? '账号登录和钱包使用独立密码，修改资料不会改变钱包密钥。' : '本机资料尚未登记为线上账号，钱包密码也不是社交登录密码。'}目前仅支持 BSC 测试网，其他网络与真实资金服务尚未开放。</div>
      <section class="mine-section"><div class="mine-section-title"><h3>钱包管理</h3></div><div class="mine-list">${row('wallet', '查看我的钱包', '查看链上资产和平台账户', 'wallet')}${!unavailable ? state.exists ? `${row(state.unlocked ? 'lock' : 'unlock', state.unlocked ? '立即锁定钱包' : '解锁钱包', state.unlocked ? '关闭当前签名会话' : '使用本机钱包密码验证', 'lock')}${row('export', '导出加密备份', '导出受密码保护的 JSON 文件', 'draft')}` : row('create', '创建或恢复测试钱包', '创建后完成助记词备份验证', 'key') : row('help', '查看钱包恢复指引', '先保护原始数据，再确认恢复方式', 'help')}</div><p class="mine-form-note">切到后台或闲置 5 分钟后钱包自动锁定。助记词请离线保存；加密文件与密码分开保管。</p></section>
      <section class="mine-section"><div class="mine-section-title"><h3>当前隐私规则</h3><span>默认隐私规则</span></div><div class="mine-rules"><div>${icon('check')}<span><strong>好友通过后才能私聊</strong><small>同群成员不会自动成为好友</small></span></div><div>${icon('eye')}<span><strong>资产默认隐藏</strong><small>可在资产页面临时展开查看</small></span></div><div>${icon('shield')}<span><strong>不自动公开资产或加入榜单</strong><small>公开展示由你选择；没有可靠价格时不生成资产排名</small></span></div></div></section><div class="mine-info mine-warning">愚笨者不会索要助记词或私钥。忘记本机密码时，可通过离线助记词在可信钱包中恢复；请勿导入存有真实资产的钱包。</div>`;
  }
  function orders() {
    return `${heading('服务订单', '每一笔真实服务，都应有明确进度')}<section class="mine-empty mine-panel"><span class="mine-empty-symbol">${icon('order')}</span><span class="mine-status-pill">服务尚未接通</span><h3>这里还没有真实订单</h3><p>赏金合作、服务商申请和发行申请会保存到当前服务，申请和任务完成不代表已经付款。AI 任务进度与成果可在工作台查看。</p><button type="button" class="mine-primary" data-mine-action="drafts">查看我的草稿</button>${button('home', '返回个人中心')}</section>`;
  }
  function help() {
    return `${heading('帮助与反馈', '先找到原因，再继续下一步')}<div class="mine-help-banner"><span>${icon('help')}</span><div><h3>需要一点帮助？</h3><p>常见问题的处理方法，都放在这里。</p></div></div><section class="mine-faqs" aria-label="常见问题">
      <details><summary>AI 工作台现在能做什么？</summary><p>填写目标后先看计划和预算，再确认执行。当前可用本地规则整理文本、表格、JSON，生成清单或大纲草稿并下载成果；没有通用 AI 模型或远程桌面。本地试用由平台承担模拟费用，不扣平台余额。</p><button type="button" class="mine-text-button" data-mine-action="ai">打开 AI 工作台</button></details><details><summary>手机、电脑和网页的数据会同步吗？</summary><p>${remote() ? '账号资料保存在服务器，登录同一账号后可获取。' : '本机资料尚未与云端账号关联。'}钱包密钥与本机草稿不会自动上传。云端 AI 申请和任务保存在服务器，与提交申请的账号关联。安装 App 后需要创建新的测试钱包，或使用你自己的测试钱包助记词恢复。${remote() ? '好友、群聊、聊天文字和图片随账号同步；新发布的朋友圈由服务器保存，旧本机内容和草稿不会自动发布。' : '未登录时的体验内容只保存在本机。'}导出的加密备份请单独保管。请勿导入存有真实资产的钱包。</p></details>
      <details><summary>本机资料和钱包有什么区别？</summary><p>${remote() ? '用户名、ID、头像和签名保存到账号，可在其他设备登录后获取。' : '用户名、ID、头像和签名只保存在当前设备，ID 尚未云端登记。'}钱包管理链上资产，使用独立的本机密码；修改资料不会修改钱包地址。</p></details>
      <details><summary>能使用哪些网络和资产？</summary><p>当前链上功能仅支持 BSC 测试网原生 tBNB。测试币没有实际价值。BSC 主网、其他网络和真实 USDT 充值提现均未开放，请勿转入真实资金。</p><button type="button" class="mine-text-button" data-mine-action="wallet">查看资产页面 ${icon('arrow')}</button></details>
      <details><summary>转账已提交，为什么还没到账？</summary><p>已提交不等于已确认。在账单中心查看最新状态；广播结果不明确时，先核对交易哈希与链上状态，避免重复转账。当前本机记录不代表完整链上收支。</p><button type="button" class="mine-text-button" data-mine-action="bill-center">去账单中心 ${icon('arrow')}</button></details>
      <details><summary>为什么转入、转出余额后金额没变？</summary><p>当前使用无真实价值的 SIM 测试资产。转入意向等待测试入账事件；转出确认后显示订单状态，广播结果未知时继续核查，不能重复转出或提前退款。可以在平台资产的账单中查看详情。真实链上充值提现尚未接通。</p></details>
      <details><summary>忘记密码、换手机或卸载 App 怎么办？</summary><p>账号密码遗失时，可用事先保存的账号恢复码重设密码；没有恢复码时请通过帮助反馈联系运营，不能凭昵称直接重置。钱包密码不能由账号恢复码找回，钱包需使用离线助记词在可信钱包中恢复；当前版本只用于测试，不要导入真实资金钱包。${remote() ? '账号资料可再次登录获取；本机草稿和演示记录不会随账号恢复。' : '本机资料、草稿和演示记录没有云端同步。'}卸载 App 或清除数据前，请保留本机记录。操作前请先保留已有备份。</p><button type="button" class="mine-text-button" data-mine-action="security">打开安全中心 ${icon('arrow')}</button></details>
      <details><summary>页面显示存储或网络异常怎么办？</summary><p>先检查网络与浏览器存储权限，再重试读取。不要先清除网站数据，也不要连续重复转账。记录读取失败不代表记录不存在；原始数据不会由错误提示自动覆盖。</p></details></section>
      <section class="mine-support-card"><h3>问题反馈</h3><p>提交使用问题或隐私请求，由运营人员查看处理。请勿发送助记词、私钥和钱包密码。</p>${button('feedback', '提交反馈')}<p><a href="./privacy.html">隐私说明</a> · <a href="./terms.html">用户规则</a></p></section>`;
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
    generation++; photoTask++; photoBusy = false; saving = false;
    view = next;
    if (next === 'home') readProfile();
    if (next === 'edit') { selectedAvatar = profile?.avatar || PROFILE_AVATARS[0]; selectedPhoto = profile?.avatarImage || ''; }
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
    if (saving && ['home', 'edit', 'avatar', 'choose-photo', 'remove-photo'].includes(name)) { toast('资料正在保存，请稍候。'); return; }
    if (['home', 'edit', 'security', 'orders', 'help'].includes(name)) { open(name); return; }
    if (name === 'retry-profile') { open('home'); return; }
    if (name === 'ai') { onNavigate('workbench'); return; }
    if (name === 'drafts') { onNavigate('discover', { route: 'drafts' }); return; }
    if (name === 'wallet') { onNavigate('wallet'); return; }
    if (name === 'choose-photo' && view === 'edit' && !saving) { container.querySelector('[data-mine-photo]')?.click(); return; }
    if (name === 'remove-photo' && view === 'edit' && !saving) { photoTask++; photoBusy = false; selectedPhoto = ''; updatePhoto('照片已移除，保存后生效。'); return; }
    if (name === 'copy-id' && profile) {
      const copiedId = profile.userId;
      Promise.resolve().then(() => { if (!globalThis.navigator?.clipboard?.writeText) throw new Error(); return navigator.clipboard.writeText(copiedId); }).then(() => { if (active) toast('用户 ID 已复制'); }, () => { if (active) toast('复制暂不可用，请长按 ID 输入框复制。'); });
      return;
    }
    if (name === 'avatar') {
      const value = PROFILE_AVATARS[Number(target.dataset.mineAvatar)];
      if (view !== 'edit' || !value || saving) return;
      photoTask++; photoBusy = false; selectedAvatar = value; selectedPhoto = '';
      updatePhoto('预设头像已选择，保存后生效。');
      for (const node of container.querySelectorAll('[data-mine-avatar]')) node.setAttribute('aria-pressed', String(PROFILE_AVATARS[Number(node.dataset.mineAvatar)] === value));
      const preview = container.querySelector('[data-mine-preview]'); if (preview) preview.textContent = value;
      return;
    }
    if (['bill-center', 'lock', 'unlock', 'export', 'create', 'account-settings', 'feedback'].includes(name) || name === 'install' && !isNative) action(name);
  }
  function updatePhoto(message) {
    for (const node of container.querySelectorAll('[data-mine-form] input, [data-mine-form] textarea, [data-mine-form] button, .mine-back')) node.disabled = saving;
    const preview = container.querySelector('[data-mine-preview]');
    if (preview) { if (selectedPhoto) preview.innerHTML = avatarContent(selectedAvatar, selectedPhoto); else preview.textContent = selectedAvatar; }
    for (const node of container.querySelectorAll('[data-mine-avatar]')) node.setAttribute('aria-pressed', String(!selectedPhoto && PROFILE_AVATARS[Number(node.dataset.mineAvatar)] === selectedAvatar));
    const status = container.querySelector('[data-mine-photo-status]'); if (status) status.textContent = message;
    const remove = container.querySelector('[data-mine-remove-photo]'); if (remove) remove.disabled = !selectedPhoto || saving;
    const save = container.querySelector('[data-mine-save]'); if (save) save.disabled = photoBusy || saving;
  }
  async function onChange(event) {
    const input = event.target;
    if (!active || view !== 'edit' || !container.contains(input) || !input.matches?.('[data-mine-photo]') || saving) return;
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    const task = ++photoTask, currentGeneration = generation;
    photoBusy = true; updatePhoto('正在处理照片…');
    try {
      const photo = await processPhoto(file);
      if (!active || view !== 'edit' || currentGeneration !== generation || task !== photoTask) return;
      selectedPhoto = photo; photoBusy = false; updatePhoto('照片已准备好，点击保存资料后生效。');
    } catch (error) {
      if (!active || view !== 'edit' || currentGeneration !== generation || task !== photoTask) return;
      photoBusy = false; updatePhoto(error instanceof Error ? error.message : '照片处理失败，请重新选择。');
    }
  }
  function onInput(event) {
    if (view !== 'edit' || event.target.name !== 'userId' || !remote()) return;
    const section = container.querySelector('[data-mine-id-password]');
    if (section) {
      const changed = event.target.value.trim() !== profile.userId;
      section.hidden = !changed;
      const input = section.querySelector('input'); if (input) { input.required = changed; if (!changed) input.value = ''; }
    }
  }
  async function onSubmit(event) {
    const form = event.target.closest('form[data-mine-form="profile"]');
    if (!active || !form || !container.contains(form) || view !== 'edit') return;
    event.preventDefault();
    const error = form.querySelector('[data-mine-form-error]'); error.textContent = '';
    if (saving) return;
    if (photoBusy) { error.textContent = '照片还在处理中，请稍等。'; return; }
    const currentGeneration = generation;
    try {
      const userId = validateUserId(form.elements.userId?.value ?? profile.userId, { allowReserved: (form.elements.userId?.value ?? profile.userId).trim() === profile.userId });
      const input = { nickname: form.elements.nickname.value, bio: form.elements.bio.value, avatar: selectedAvatar, avatarImage: selectedPhoto, userId, revision: profile.revision };
      if (remote() && profile.authMode !== 'email' && userId !== profile.userId) {
        input.currentPassword = form.elements.currentPassword?.value || '';
        if (!/^\d{6}$/.test(input.currentPassword)) throw new Error('修改用户 ID 需要输入当前 6 位登录密码。');
      }
      saving = true; updatePhoto('正在保存资料…');
      const saved = profileService ? await profileService.saveProfile(input) : saveLocalProfile(input);
      if (!active || view !== 'edit' || generation !== currentGeneration) return;
      profile = saved; profileError = false; saving = false; view = 'home'; homeScroll = 0; render(true); scrollTo(0); toast(profileService ? '个人资料已保存' : '个人资料已保存在本机');
      action('profile-updated');
    } catch (failure) {
      if (!active || view !== 'edit' || generation !== currentGeneration) return;
      saving = false; updatePhoto(''); error.textContent = failure instanceof Error ? failure.message : '资料没有保存，请稍后重试。';
    }
  }
  const refreshStatus = () => { if (active && view === 'security') render(); };
  readProfile(); render();
  container.addEventListener('click', onClick);
  container.addEventListener('submit', onSubmit);
  container.addEventListener('change', onChange);
  container.addEventListener('input', onInput);
  globalThis.window?.addEventListener('tongban:wallet-locked', refreshStatus);
  const cleanup = () => {
    active = false; generation++; photoTask++;
    container.removeEventListener('click', onClick);
    container.removeEventListener('submit', onSubmit);
    container.removeEventListener('change', onChange);
    container.removeEventListener('input', onInput);
    globalThis.window?.removeEventListener('tongban:wallet-locked', refreshStatus);
  };
  cleanup.back = () => { if (saving) { toast('资料正在保存，请稍候。'); return true; } if(view==='home')return false;open('home');return true; };
  cleanup.refresh = () => { if (view !== 'edit') { readProfile(); render(); } };
  return cleanup;
}
