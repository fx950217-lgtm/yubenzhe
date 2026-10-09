import './discover-token.css';
import { saveJsonFile } from './native-runtime.js';
import { getAddress } from 'ethers';

const ZERO = '0x0000000000000000000000000000000000000000';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
export const TOKEN_TEMPLATES = Object.freeze([
  Object.freeze({ id:'lime', emoji:'🍋', title:'朋友俱乐部', name:'Lime Club', symbol:'LIME', supply:'1000000000' }),
  Object.freeze({ id:'cat', emoji:'🐱', title:'猫咪小队', name:'Cat Friends', symbol:'CATS', supply:'100000000' }),
  Object.freeze({ id:'sun', emoji:'☀️', title:'每日好心情', name:'Sunny Day', symbol:'SUNNY', supply:'1000000' }),
]);

export function validateTokenBasics(input = {}) {
  const name = String(input.name ?? '').trim(), symbol = String(input.symbol ?? '').trim().toUpperCase(), supply = String(input.supply ?? '').trim();
  if (name.length < 2 || name.length > 24) throw new Error('代币名称需为 2–24 个字符。');
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(symbol)) throw new Error('代币符号需为 2–10 位英文字母或数字，以字母开头。');
  if (!/^[1-9]\d{0,15}$/.test(supply) || BigInt(supply) > 1000000000000000n) throw new Error('固定总量需为 1–1,000,000,000,000,000 的整数。');
  return { name, symbol, supply };
}
function validAddress(input, label) {
  let address;
  try { address = getAddress(String(input ?? '').trim()); }
  catch { throw new Error(`请输入有效的 ${label}，混合大小写地址须通过校验。`); }
  if (address === ZERO) throw new Error(`${label}不能使用零地址。`);
  return address;
}
export function validateTokenRecipient(input = {}) {
  const address = validAddress(input.address, '0x 接收钱包地址');
  if (input.ownsWallet !== true) throw new Error('请确认接收钱包由你自己控制。');
  return { address, ownsWallet:true };
}
export function validateTokenPreparation(input = {}) {
  return { ...validateTokenBasics(input), ...validateTokenRecipient(input), status:'未部署', network:'BSC 测试网', serviceFee:'0 USDT', settlement:'平台余额' };
}
export function tokenParameterDocument(input = {}) {
  const value = validateTokenPreparation(input);
  return {
    format:'tongban-token-preparation', version:1, network:'BSC Testnet', chainId:97,
    name:value.name, symbol:value.symbol, supply:value.supply, recipientAddress:value.address,
    ownership:'user_declared_only', status:'not_deployed', contractAddress:null, issuedTokens:false,
    serviceFee:{ amount:'0', asset:'USDT', charged:false }, networkFee:{ status:'not_connected', amount:null },
    note:'Local preparation parameters only. No contract has been deployed and no tokens have been issued.',
  };
}
export function validateIntegrationPreparation(input = {}, tokenDrafts = []) {
  const title = String(input.title ?? '').trim(), details = String(input.details ?? '').trim();
  if (!title || title.length > 80) throw new Error('项目名称需为 1–80 个字符。');
  if (details.length < 10 || details.length > 2000) throw new Error('请用 10–2000 个字符说明接入用途。');
  const relatedDraftId = String(input.relatedDraftId ?? '');
  if (relatedDraftId && !tokenDrafts.some(draft => draft.type === 'token' && draft.id === relatedDraftId)) throw new Error('关联的发币草稿已不存在，请重新选择。');
  const hasContract = input.hasContract === true;
  let contractAddress = '';
  if (hasContract) contractAddress = validAddress(input.contractAddress, '0x 代币合约地址');
  else if (String(input.contractAddress ?? '').trim()) throw new Error('只有已经部署的代币才能填写合约地址。');
  return { title, details, relatedDraftId, hasContract, contractAddress, status:'未提交', network:'BSC 测试网', serviceFee:'300 USDT', settlement:'平台余额' };
}

const textField = (label, name, value, placeholder, attrs = '') => `<label class="tk-field">${label}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}></label>`;
const textArea = (label, name, value, placeholder, attrs = '') => `<label class="tk-field">${label}<textarea name="${name}" placeholder="${esc(placeholder)}" ${attrs}>${esc(value)}</textarea></label>`;
const button = (label, action, style = 'tk-secondary', extra = '') => `<button type="button" class="${style}" data-disc="${action}" ${extra}>${label}</button>`;
const contextLabel = session => `<p class="tk-context"><span data-token-context-state>${session.saved ? '已保存本机草稿' : session.key.startsWith('new:') ? '未保存 · 当前页面暂存' : '正在续编本机草稿'}</span><span>固定 BSC 测试网</span></p>`;
const errorHtml = session => `<p class="tk-error" role="alert" data-token-error>${esc(session.error)}</p>`;
const blankValues = type => type === 'token' ? { name:'', symbol:'', supply:'1000000000', address:'', ownsWallet:false } : type === 'integration' ? { title:'', details:'', relatedDraftId:'', hasContract:false, contractAddress:'' } : { title:'', details:'' };
const fieldNames = { token:['name','symbol','supply','address','ownsWallet'], integration:['title','details','relatedDraftId','hasContract','contractAddress'], business:['title','details'] };

export function createTokenStudio(ctx) {
  const sessions = new Map();
  let currentRoute = '', dead = false;
  function keyFor(type) { return String(ctx.getDraftKey?.(type) || ctx.getDraftMeta?.(type)?.id || `new:${type}`); }
  function sessionFor(type) {
    const key = keyFor(type), cacheKey = `${type}:${key}`;
    if (!sessions.has(cacheKey)) {
      const original = ctx.getDraft(type) || {}, values = blankValues(type);
      for (const field of fieldNames[type]) if (Object.hasOwn(original, field)) values[field] = typeof values[field] === 'boolean' ? original[field] === true : String(original[field] ?? '');
      sessions.set(cacheKey, { type, key, cacheKey, values, step:1, saved:false, error:'' });
    }
    return sessions.get(cacheKey);
  }
  function projects() {
    const list = ctx.getDrafts();
    if (!Array.isArray(list)) throw new Error('本机项目暂不可读取，请稍后重试。');
    return list.filter(draft => draft?.type === 'token' && !draft.archivedAt && typeof draft.id === 'string' && draft.values && typeof draft.values === 'object');
  }
  function refresh() { if (!dead) ctx.render(); }
  function tabs(active) {
    return `<nav class="tk-tabs" aria-label="代币工作室">${[['token','发币准备'],['token-projects','我的项目'],['integration','余额接入']].map(([route,label]) => button(label,`t-route-${route}`,active===route?'active':'',`aria-current="${active===route?'page':'false'}"`)).join('')}</nav>`;
  }
  function steps(step) {
    return `<ol class="tk-steps" aria-label="发币准备步骤">${['基础信息','接收钱包','核对预览'].map((label,index) => `<li class="${step===index+1?'active':step>index+1?'done':''}" ${step===index+1?'aria-current="step"':''}><span>${step>index+1?'✓':index+1}</span><b>${label}</b></li>`).join('')}</ol>`;
  }
  function tokenForm(session) {
    const value = session.values;
    if (session.step === 1) return `<div class="tk-section-heading"><span>01 / 基础信息</span><h3>先给灵感起个名字。</h3><p>从空白开始，或点一个模板再修改。</p></div><div class="tk-templates">${TOKEN_TEMPLATES.map(template => button(`<span>${template.emoji}</span><b>${template.title}</b><small>填入示例</small>`,'t-template','',`data-template="${template.id}"`)).join('')}</div><div class="tk-two-fields">${textField('代币名称','name',value.name,'例如 Lime Club','required minlength="2" maxlength="24"')}${textField('代币符号','symbol',value.symbol,'例如 LIME','required minlength="2" maxlength="10" autocapitalize="characters" spellcheck="false"')}</div>${textField('固定供应总量','supply',value.supply,'填写完整正整数','required inputmode="numeric" maxlength="16"')}<p class="tk-hint">总量上限 1,000,000,000,000,000；此流程不提供增发、税费等复杂功能。</p>${errorHtml(session)}<button class="tk-primary" type="submit">下一步：接收钱包 <span>→</span></button>`;
    if (session.step === 2) return `<div class="tk-section-heading"><span>02 / 接收钱包</span><h3>未来的代币，放在哪里？</h3><p>填写由你控制的 BSC 钱包地址。</p></div><div class="tk-wallet-choice">${button('填入当前本机钱包地址','t-use-wallet','tk-wallet-button')}<small>只读取地址，不创建或解锁钱包</small></div>${textField('接收钱包地址','address',value.address,'0x…','required maxlength="42" autocomplete="off" autocapitalize="off" spellcheck="false"')}<p class="tk-hint">地址格式不能证明网络或归属，请核对接收方使用 BSC 测试网。</p><label class="tk-check"><input type="checkbox" name="ownsWallet" ${value.ownsWallet?'checked':''} required><span>我确认这个接收钱包由我自己控制。</span></label>${errorHtml(session)}<div class="tk-form-actions">${button('上一步','t-prev')}<button class="tk-primary" type="submit">核对发币参数 <span>→</span></button></div>`;
    let safe;
    try { safe = validateTokenPreparation(value); }
    catch (error) { session.step = 1; session.error = error.message; return tokenForm(session); }
    return `<div class="tk-section-heading"><span>03 / 核对预览</span><h3>${session.saved?'参数已留好，之后可以继续。':'最后，再核对一次。'}</h3><p>${session.saved?'仅保存了本机草稿，没有部署或扣款。':'保存只记录准备参数，不会签名或发送交易。'}</p></div><section class="tk-token-preview"><span class="tk-token-mark">${esc(safe.symbol.slice(0,1))}</span><div><h4>${esc(safe.name)}</h4><span>${esc(safe.symbol)} · 固定供应量</span></div><b class="tk-state">未部署</b></section><dl class="tk-summary"><div><dt>固定总量</dt><dd>${BigInt(safe.supply).toLocaleString('en-US')}</dd></div><div><dt>网络</dt><dd>BSC 测试网 · Chain ID 97</dd></div><div><dt>接收钱包</dt><dd class="tk-address">${esc(safe.address)}</dd></div><div><dt>发币服务费</dt><dd>0 USDT</dd></div><div><dt>网络费</dt><dd>服务未接通 · 暂无报价</dd></div><div><dt>代币合约</dt><dd>尚未创建</dd></div></dl><p class="tk-result-note">当前没有合约地址、代币余额或可提现资产。免费服务费不代表未来链上网络费为零。</p>${errorHtml(session)}${session.saved?`<p class="tk-saved" role="status">✓ 草稿已保存 · 未部署 · 未扣款</p><div class="tk-form-actions">${button('继续调整','t-edit-basic')}${button('查看我的项目','t-route-token-projects','tk-primary')}</div>`:`<div class="tk-form-actions">${button('上一步','t-prev')}<button class="tk-primary" type="submit">保存发币草稿</button></div>`}<button type="button" class="tk-disabled" disabled>部署代币 · 尚未开放</button>`;
  }
  function renderToken() {
    const session = sessionFor('token');
    return `${tabs('token')}<section class="tk-hero"><div><span class="tk-eyebrow">MEME TOKEN STUDIO</span><h2>把一个好玩的想法，<br>准备成自己的代币。</h2><p>3 步准备 · 本机保存 · 暂不部署</p></div><strong>0<small>USDT 服务费</small></strong></section>${steps(session.step)}${contextLabel(session)}<form class="tk-form" data-token-form="token" data-token-key="${esc(session.key)}">${tokenForm(session)}</form><details class="tk-explainer"><summary>代币放在哪里，之后如何转出？</summary><p><strong>存放与查看：</strong>按计划，真实部署开放后，代币将分配至你指定的 BSC 钱包；可在支持的钱包中按实际合约地址添加并查看。目前固定 BSC 测试网，尚未部署任何代币。</p><p><strong>转到其他钱包：</strong>真实部署后，接收钱包需要支持该代币和同一网络；发送方还需准备该网络的原生币支付网络费。当前 BSC 测试网对应 tBNB。</p><p><strong>转出与变现：</strong>把代币转到另一个钱包，不等于兑换法币，也不保证有人交易、具有流动性或能够变现。</p><p><strong>接入平台余额：</strong>300 USDT 接入服务是独立申请，不会自动把链上资产存入平台余额。只有服务开放并完成审核与接入后，才可能按确认规则使用相应功能。</p><p class="tk-explainer-current">当前只保存未部署草稿，没有已发行代币或可提现资产，也不会收费。</p></details><div class="tk-bottom-links">${button('需要增发、权限等商业方案？','t-route-business','tk-text-button')}${button('另建一份草稿','t-new-token','tk-text-button')}</div>`;
  }
  function renderProjects() {
    let list;
    try { list = projects(); }
    catch (error) { return `${tabs('token-projects')}<div class="tk-empty"><h3>项目暂不可读取</h3><p>${esc(error.message)}</p>${button('重新读取','t-refresh','tk-primary')}</div>`; }
    return `${tabs('token-projects')}<div class="tk-project-heading"><div><h3>我的代币项目 <small>${list.length}</small></h3><p>这里只展示你保存过的发币草稿。</p></div>${button('新建草稿','t-new-token','tk-primary')}</div><div class="tk-project-list">${list.map(draft => `<article class="tk-project"><div class="tk-project-top"><span class="tk-project-symbol">${esc(String(draft.values.symbol || '?').slice(0,2))}</span><div><h4>${esc(String(draft.values.name || '未命名草稿').slice(0,24))}</h4><p>${esc(String(draft.values.symbol || '').slice(0,10))} · BSC 测试网</p></div><span class="tk-state">未部署</span></div><dl><div><dt>计划供应量</dt><dd>${esc(String(draft.values.supply || '—').slice(0,20))}</dd></div><div><dt>合约 / 代币余额</dt><dd>尚未生成</dd></div></dl><div class="tk-project-actions">${button('继续编辑','t-edit-project','tk-primary',`data-id="${esc(draft.id)}"`)}${button('下载参数','t-download','tk-secondary',`data-id="${esc(draft.id)}"`)}${button('复制参数','t-copy','tk-secondary',`data-id="${esc(draft.id)}"`)}</div></article>`).join('') || `<div class="tk-empty"><span>🌱</span><h3>第一个项目，从一个名字开始。</h3><p>保存发币草稿后可在这里续编或导出参数。<br>不会生成示例项目或虚构代币。</p>${button('开始准备','t-new-token','tk-primary')}</div>`}</div><p class="tk-hint">参数文件不是合约或资产凭证，导出不会部署代币。</p>`;
  }
  function renderIntegration() {
    const session = sessionFor('integration'), value = session.values;
    let list = [], listError = '';
    try { list = projects(); } catch { listError = '关联草稿暂不可读取；请稍后重试。'; }
    return `${tabs('integration')}<section class="tk-integration-hero"><div><span class="tk-eyebrow">可选 · 独立申请</span><h2>让代币接入平台余额</h2><p>与免费发币分开，当前只保存申请。</p></div><strong>300<small>USDT 接入服务费</small></strong></section>${contextLabel(session)}<form class="tk-form" data-token-form="integration" data-token-key="${esc(session.key)}"><label class="tk-field">关联我的发币草稿 <span class="tk-optional">选填</span><select name="relatedDraftId"><option value="">不关联，手动填写</option>${list.map(draft => `<option value="${esc(draft.id)}" ${value.relatedDraftId===draft.id?'selected':''}>${esc(draft.values.name || '未命名草稿')} · 未部署</option>`).join('')}</select></label>${listError?`<p class="tk-error">${listError}</p>`:''}${textField('项目或代币名称','title',value.title,'填写希望接入的项目','required maxlength="80"')}<label class="tk-check"><input name="hasContract" type="checkbox" ${value.hasContract?'checked':''}><span>代币已经部署，我有合约地址<span class="tk-hint">这只是自行声明，平台尚未核验合约。</span></span></label>${value.hasContract?textField('已部署的 BSC 测试网代币合约','contractAddress',value.contractAddress,'0x… 不是个人收款地址','required maxlength="42" autocomplete="off" autocapitalize="off" spellcheck="false"'):'<p class="tk-hint">尚未部署可留空；发币草稿没有合约地址。</p>'}${textArea('接入用途与需求','details',value.details,'说明代币用途、使用场景和希望接入的能力。','required minlength="10" maxlength="2000" rows="5"')}<dl class="tk-summary tk-fees"><div><dt>计划服务费</dt><dd>300 USDT</dd></div><div><dt>未来结算方式</dt><dd>平台余额</dd></div><div><dt>当前申请状态</dt><dd>未提交 · 不收费</dd></div></dl><p class="tk-result-note">缴费不等于审核通过或自动接入，也不保证充值提现、交易所上币、流动性或兑换变现。当前没有支付和审核服务。</p>${errorHtml(session)}${session.saved?'<p class="tk-saved" role="status">✓ 接入申请已保存本机 · 未提交、未扣款</p>':''}<button class="tk-primary" type="submit">保存接入申请</button><button class="tk-disabled" type="button" disabled>支付 300 USDT · 尚未开放</button></form>`;
  }
  function renderBusiness() {
    const session = sessionFor('business'), value = session.values;
    return `<section class="tk-business-hero"><span>✦</span><div><h2>复杂的方案，先把需求说清楚。</h2><p>增发规则、权限、分配与商业用途，都可以写进来。</p></div></section>${contextLabel(session)}<form class="tk-form" data-token-form="business" data-token-key="${esc(session.key)}">${textField('项目名称','title',value.title,'你的项目叫什么？','required maxlength="80"')}${textArea('项目与代币需求','details',value.details,'可说明业务目标、代币用途、权限、分配规则与期望交付。','required minlength="10" maxlength="2000" rows="7"')}<p class="tk-result-note">仅保存在本机，未发送给商务人员。复杂方案尚无报价，也未约定交付或收取费用。</p>${errorHtml(session)}${session.saved?'<p class="tk-saved" role="status">✓ 商务需求已保存本机 · 未提交、未扣款</p>':''}<button type="submit" class="tk-primary">保存商务需求</button>${button('返回发币准备','t-route-token','tk-text-button')}</form>`;
  }
  function render(route) {
    if (dead) return '';
    currentRoute = route;
    const renderers = { token:renderToken, 'token-projects':renderProjects, integration:renderIntegration, business:renderBusiness };
    if (!renderers[route]) return '';
    try { return `<div class="token-studio">${renderers[route]()}</div>`; }
    catch (error) { return `<div class="token-studio"><div class="tk-empty"><h3>草稿暂不可读取</h3><p>${esc(error.message)}</p>${button('重新读取','t-refresh','tk-primary')}</div></div>`; }
  }
  function collect(form, session) {
    for (const name of fieldNames[session.type]) {
      const field = form.elements?.namedItem?.(name) || form.elements?.[name];
      if (field) session.values[name] = ['ownsWallet','hasContract'].includes(name) ? field.checked === true : field.value;
    }
  }
  function errorOn(form, session, error) {
    session.error = error?.message || '操作暂未完成，请重试。';
    const box = form?.querySelector('[data-token-error]');
    if (box) box.textContent = session.error; else refresh();
  }
  function save(session, values) {
    const savedId = ctx.saveDraft(session.type, values);
    const next = sessionFor(session.type);
    next.values = { ...blankValues(session.type), ...values }; next.saved = true; next.error = '';
    if (session.type === 'token') next.step = 3;
    if (session.key.startsWith('new:') && next.key !== session.key) sessions.delete(session.cacheKey);
    refresh(); return savedId;
  }
  function handleSubmit(event) {
    const form = event.target.closest('[data-token-form]');
    if (!form || dead || !Object.hasOwn(fieldNames, form.dataset.tokenForm)) return false;
    event.preventDefault();
    const type = form.dataset.tokenForm, session = sessionFor(type);
    if (session.key !== form.dataset.tokenKey || currentRoute !== type) return true;
    collect(form, session); session.saved = false; session.error = '';
    try {
      if (type === 'token') {
        Object.assign(session.values, validateTokenBasics(session.values));
        if (session.step === 1) { session.step = 2; refresh(); return true; }
        Object.assign(session.values, validateTokenRecipient(session.values));
        if (session.step === 2) { session.step = 3; refresh(); return true; }
        const values = validateTokenPreparation(session.values); ctx.validateToken(values); save(session, values);
      } else if (type === 'integration') {
        const values = validateIntegrationPreparation(session.values, projects()); ctx.validateService(type, values); save(session, values);
      } else {
        const values = ctx.validateService(type, { title:session.values.title, details:session.values.details });
        save(session, { title:values.title, details:values.details, status:'未提交', settlement:'平台余额' });
      }
    } catch (error) { errorOn(form, session, error); }
    return true;
  }
  function handleInput(event) {
    const field = event.target, form = field.closest?.('[data-token-form]');
    if (!form || dead || !Object.hasOwn(fieldNames, form.dataset.tokenForm)) return;
    const session = sessionFor(form.dataset.tokenForm);
    if (session.key !== form.dataset.tokenKey || !fieldNames[session.type].includes(field.name)) return;
    session.values[field.name] = ['ownsWallet','hasContract'].includes(field.name) ? field.checked === true : field.value;
    session.saved = false; session.error = '';
    form.querySelector('.tk-saved')?.remove?.();
    const error = form.querySelector('[data-token-error]'); if (error) error.textContent = '';
    const state = form.parentElement?.querySelector('[data-token-context-state]'); if (state) state.textContent = '有未保存的修改';
    if (field.name === 'address') {
      session.values.ownsWallet = false;
      const ownership = form.elements?.namedItem?.('ownsWallet') || form.elements?.ownsWallet;
      if (ownership) ownership.checked = false;
    }
    if (field.name === 'hasContract') { if (!field.checked) session.values.contractAddress = ''; refresh(); }
    if (field.name === 'relatedDraftId') {
      try { const related = projects().find(draft => draft.id === field.value); if (related && !session.values.title.trim()) session.values.title = String(related.values.name || ''); refresh(); }
      catch (error) { errorOn(form, session, error); }
    }
  }
  function parameterText(id) {
    const draft = projects().find(value => value.id === id);
    if (!draft) throw new Error('项目草稿已不存在，请重新读取列表。');
    return { document:tokenParameterDocument(draft.values), draft };
  }
  async function download(id) {
    try {
      const { document:parameters } = parameterText(id);
      const result=await saveJsonFile({filename:`${parameters.symbol.toLowerCase()}-bsc-testnet-preparation.json`,content:JSON.stringify(parameters,null,2)});
      if(!dead)ctx.toast(result.saved?(result.method!=='browser-download'?'参数文件已保存 · 未部署代币':'已请求下载参数文件 · 未部署代币'):'已取消保存');
    } catch(error){if(!dead)ctx.toast(error.message||'参数文件没有导出，请重试。')}
  }
  function handleAction(action, target) {
    const known = ['t-route-token','t-route-token-projects','t-route-integration','t-route-business','t-refresh','t-new-token','t-edit-project','t-download','t-copy','t-template','t-prev','t-edit-basic','t-use-wallet'];
    if (dead || !known.includes(action)) return false;
    try {
      if (action.startsWith('t-route-')) { const route=action.slice(8); if (['token','token-projects','integration','business'].includes(route)) ctx.go(route); return true; }
      if (action === 't-refresh') { refresh(); return true; }
      if (action === 't-new-token') { ctx.go('token',{draftId:null}); return true; }
      if (action === 't-edit-project') { const id = target.dataset.id; if (!projects().some(draft => draft.id === id)) throw new Error('项目草稿已不存在，请重新读取。'); ctx.go('token',{draftId:id}); return true; }
      if (action === 't-download') { download(target.dataset.id); return true; }
      if (action === 't-copy') {
        const { document:parameters } = parameterText(target.dataset.id), text = JSON.stringify(parameters,null,2);
        const fallback = () => { if (!dead) ctx.showDialog('复制准备参数',`<p class="tk-hint">自动复制不可用，请长按选择以下参数。仅为准备文件，未部署代币。</p><textarea class="tk-copy-params" readonly rows="12" aria-label="代币准备参数">${esc(text)}</textarea>`); };
        if (!globalThis.navigator?.clipboard?.writeText) fallback();
        else globalThis.navigator.clipboard.writeText(text).then(() => { if (!dead) ctx.toast('准备参数已复制 · 未部署'); }).catch(fallback);
        return true;
      }
      if (!['token','integration','business'].includes(currentRoute)) return true;
      const session = sessionFor(currentRoute);
      if (action === 't-template' && currentRoute === 'token') {
        const template = TOKEN_TEMPLATES.find(value => value.id === target.dataset.template);
        if (template) { const { name,symbol,supply } = template; Object.assign(session.values,{name,symbol,supply}); session.saved=false; session.error=''; refresh(); }
      } else if (action === 't-prev' && currentRoute === 'token') { session.step = Math.max(1,session.step-1); session.error=''; refresh(); }
      else if (action === 't-edit-basic' && currentRoute === 'token') { session.step=1; session.saved=false; refresh(); }
      else if (action === 't-use-wallet' && currentRoute === 'token') {
        const address = ctx.getWalletAddress();
        if (!address) throw new Error('尚无可读取的本机钱包。可先在资产页创建测试钱包，或手动填写你控制的地址。');
        session.values.address = validAddress(address,'0x 接收钱包地址'); session.values.ownsWallet=false; session.error=''; session.saved=false; refresh();
      }
    } catch (error) {
      if (['token','integration','business'].includes(currentRoute)) { const session=sessionFor(currentRoute); session.error=error.message; refresh(); }
      else ctx.toast(error.message || '操作暂未完成，请重试。');
    }
    return true;
  }
  function cleanup() {
    dead = true; sessions.clear();
  }
  return { render, handleAction, handleSubmit, handleInput, cleanup };
}
