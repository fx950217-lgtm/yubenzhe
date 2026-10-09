import './app.css';
import { saveJsonFile, installAndroidControls, isNativeApp } from './native-runtime.js';
import './app-v4.css';
import './app-v6.css';
import './desktop.css';
import { MAIN_NAV, isAppView, hashForView, viewFromHash, activeNavView } from './app-navigation.js';
import { mountQrScanner } from './qr-scanner.js';
import { mountSocial, getSocialWalletSummary, getSocialPacketBills, getSocialPeople } from './social.js';
import * as wallet from './wallet.js';
import { mountLiveSocial } from './live-social.js';
import { createSocialClient } from './social-client.js';
import { mountAccountGate, accountSettingsHTML } from './account-ui.js';
import { mountWalletImport, mountWatchWallets } from './wallet-import-ui.js';
import QRCode from 'qrcode';
import { mountDiscover, getDiscoverDrafts } from './discover.js';
import { getLocalProfile } from './profile-store.js';
import { mountMine } from './mine.js';
import { mountBillCenter } from './bill-center.js';
import { createTransferDraft, getPlatformTransferDrafts } from './platform-transfers.js';
import { demoAmount } from './redpacket-model.js';
import './theme-lilac.css';

const paths={wallet:'M4 7h14a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12v3 M20 11h-5v4h5 M16.5 13h.1',message:'M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z M7 10h.1 M11 10h.1 M15 10h.1',users:'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M21 21v-2a4 4 0 0 0-3-3.87',discover:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M16 8l-3 5-5 3 3-5Z',user:'M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2 M12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8',arrow:'M5 12h14 M13 6l6 6-6 6',send:'M7 17 17 7 M7 7h10v10',receive:'M7 7v10h10 M7 17 17 7',gift:'M3 8h18v4H3Z M5 12v9h14v-9 M12 8v13 M12 8H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z',copy:'M9 8h11v13H9Z M15 8V3H4v13h5',eye:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',eyeoff:'M3 3 21 21 M10 5h2c7 0 10 7 10 7a20 20 0 0 1-4 4 M6 6c-3 2-4 6-4 6s3 7 10 7c2 0 4-.5 5-1 M10 10a3 3 0 0 0 4 4',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z M8 12l3 3 5-6',lock:'M5 10h14v11H5Z M8 10V6a4 4 0 0 1 8 0v4',refresh:'M20 7v5h-5 M4 17v-5h5 M6 5a8 8 0 0 1 14 7 M4 12a8 8 0 0 0 14 7',check:'M5 12l4 4L19 6',close:'M6 6l12 12 M6 18 18 6',chevron:'M9 5l7 7-7 7',bnb:'M12 2 7 7l5 5 5-5Z M5 9l-3 3 3 3 3-3Z M19 9l-3 3 3 3 3-3Z M12 12l-5 5 5 5 5-5Z',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',key:'M14 6a5 5 0 1 1 0 7l-7 7H3v-4l7-7 M17 7h.1',spark:'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z',file:'M6 3h8l4 4v14H6Z M14 3v5h5 M9 12h6 M9 16h4',info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.1'};
const icon=(name,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.info}"/></svg>`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=a=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'尚未创建钱包';
let assetTab='chain', discoverProfileId=null;
let currentView='messages',socialCleanup=null,hideBalance=true,balance=null,balanceError='',loadingBalance=false,modalCleanup=null,backupPhrase='',toastTimer,viewRevision=0;
let routeOptions={},billReturn={view:'mine',options:{}},walletIntent=null;
const pageScroll=new Map();
const app=document.querySelector('#app'),dialog=document.querySelector('#modal');
const navs=MAIN_NAV;
let accountLoading=true,accountError='';
const socialClient=createSocialClient({onChange:profile=>{updateRailProfile();if(!profile&&!accountLoading){wallet.lock();queueMicrotask(()=>layout());}}});
async function initializeAccount(){accountLoading=true;accountError='';try{await socialClient.initialize()}catch(error){accountError=error.message}finally{accountLoading=false;layout()}}
function accountReady(profile,created){accountLoading=false;accountError='';layout();toast(socialClient.getStorageWarning()||(created?'账号已创建，你的 ID 是 '+profile.userId:'登录成功'));}

function state(){try{return wallet.getWalletState()}catch{return {exists:true,address:null,unlocked:false,unavailable:true}}}
function walletProblem(s=state()){if(!s.corrupt&&!s.unavailable&&(!s.exists||s.address))return false;showModal('钱包暂不可用',`<div class="notice warn">${s.unavailable?'浏览器无法读取本地钱包存储，请检查存储权限后重试。':'本机钱包文件无法读取。请保留原始数据、离线助记词和已有加密备份，使用助记词在可信钱包中恢复。'}</div><p class="modal-copy">当前不能生成收款码或签名交易，原有钱包数据不会被覆盖。</p>`);return true}
function toast(msg){const el=document.querySelector('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500)}
function navHtml(){const selected=activeNavView(currentView,billReturn.view);return navs.map(([id,i,label])=>`<button type="button" class="nav-item ${id===selected?'active':''}" data-nav="${id}" ${id===selected?'aria-current="page"':''}>${icon(i)}<span>${label}</span></button>`).join('')}
function profile(){try{return socialClient.getProfile()||getLocalProfile()}catch{return {nickname:'资料暂不可用',avatar:'🌱'}}}
function updateRailProfile(){const p=profile();const el=app.querySelector('.rail .self');if(el){el.querySelector('.avatar').innerHTML=p.avatarImage?'<img src="'+esc(p.avatarImage)+'" alt="我的头像">':esc(p.avatar);el.querySelector('strong').textContent=p.nickname}}
function layout(){
  socialCleanup?.();socialCleanup=null;document.body.classList.remove('social-chat-open');viewRevision++;
  const s=state(),p=profile();
  app.innerHTML=`<div class="layout"><aside class="rail"><a class="brand" href="#messages" data-nav="messages"><img src="./icon.png" alt="愚笨者"><span>愚笨者</span></a><nav class="rail-nav" aria-label="主导航">${navHtml()}</nav><div class="rail-bottom"><p class="rail-note"><span class="tiny-tag"><span class="dot"></span> v0.11.1</span></p><button class="self" data-nav="mine"><span class="avatar">${p.avatarImage?`<img src="${esc(p.avatarImage)}" alt="我的头像">`:esc(p.avatar)}</span><span><strong>${esc(p.nickname)}</strong><small>我的个人资料</small></span></button></div></aside><main class="workspace">${currentView==='wallet'?`<header class="topbar wallet-context-header"><div class="top-actions"><button class="network-pill" data-action="network"><span class="dot"></span>BSC 测试网${icon('chevron')}</button><button class="icon-btn" data-action="notice" aria-label="关于与环境说明">${icon('info')}</button></div></header>`:''}<div class="content-grid"><section class="main-content full-width ${currentView==='wallet'?'wallet-page':'social-main'}" id="page"></section></div></main></div><nav class="bottom-nav" aria-label="手机导航">${navHtml()}</nav>`;
  const page=document.querySelector('#page');
  if(['messages','contacts','mine'].includes(currentView)&&!socialClient.getProfile())socialCleanup=mountAccountGate(page,{client:socialClient,onReady:accountReady,onWallet:()=>navigate('wallet'),onRetry:initializeAccount,error:accountError,loading:accountLoading});
  else if(currentView==='wallet')renderWallet(page);
  else if(currentView==='mine')socialCleanup=mountMine(page,{toast,onNavigate:navigate,onAction:mineAction,getWalletStatus:state,getDraftCount:()=>getDiscoverDrafts().length,isNative:isNativeApp(),profileService:socialClient});
  else if(currentView==='bills')socialCleanup=mountBillCenter(page,{toast,sources:{chain:()=>wallet.getRecords(),draft:getPlatformTransferDrafts,demo:getSocialPacketBills},onRefresh:hash=>wallet.getTransactionStatus(hash),onBack:()=>navigate(billReturn.view,billReturn.options)});
  else if(currentView==='discover'&&!discoverProfileId)socialCleanup=mountDiscover(page,{toast,onNavigate:navigate,onBalance:openPlatform,onProfile:openDiscoverProfile,getWalletAddress:()=>state().address||'',initialRoute:routeOptions.route||'hub',initialOwnMoments:!!routeOptions.own,onRouteChange:route=>{routeOptions={...routeOptions,route};history.replaceState({view:currentView,options:routeOptions},'',location.hash)}});
  else if(['messages','contacts'].includes(currentView))socialCleanup=mountLiveSocial(page,{service:socialClient,profile:socialClient.getProfile(),view:currentView,toast,onNavigate:navigate,onScan:openScan,initialProfileId:routeOptions.profileId,onScreenChange:({screen})=>document.body.classList.toggle('social-chat-open',screen==='chat')});
  else socialCleanup=mountSocial(page,{view:currentView,toast,onNavigate:navigate,onTransfer:openTransfer,onScanTransfer:()=>openScan('transfer'),onScan:openScan,onAuthorizePacket:authorizePacket,initialProfileId:discoverProfileId||routeOptions.profileId,initialProfileReturn:currentView,onScreenChange:({screen})=>document.body.classList.toggle('social-chat-open',screen==='chat')});
}
function navigate(view,options={}){
  if(!isAppView(view))return;
  pageScroll.set(currentView,window.scrollY);walletIntent=null;if(dialog.open)closeModal();
  discoverProfileId=null;currentView=view;restoreRouteOptions(view==='wallet'?{assetTab,...options}:options);
  history.pushState({view,options:routeOptions},'',hashForView(view));layout();
  window.scrollTo({top:options.route?0:(pageScroll.get(view)||0),behavior:'instant'});
}
function restoreRouteOptions(options={}){
  routeOptions=options&&typeof options==='object'?options:{};
  if(currentView==='wallet')assetTab=routeOptions.assetTab==='platform'?'platform':'chain';
  if(currentView==='bills'){const back=routeOptions.returnTo;billReturn=back&&isAppView(back.view)&&back.view!=='bills'?{view:back.view,options:back.options||{}}:{view:'mine',options:{}}}
}
function openBillCenter(){navigate('bills',{returnTo:{view:currentView,options:{...routeOptions}}})}
function openScan(mode='all'){
  const scanMode=['transfer','friend'].includes(mode)?mode:'all';
  let active=true,dispose=()=>{};
  showModal(scanMode==='transfer'?'扫码转账':scanMode==='friend'?'扫描好友码':'扫一扫','<div data-scan-root></div>',el=>{
    dispose=mountQrScanner(el.querySelector('[data-scan-root]'),{mode:scanMode,toast,onResult:async result=>{
      if(!active||!dialog.open)return;
      if(result.kind==='address'){closeModal();openTransfer(result.address);return}
      if(!/^\d{6,16}$/.test(result.id))throw new Error('这是旧版体验好友码，请对方提供新版数字 ID 好友码。');
      if(!socialClient.getProfile())throw new Error('请先登录账号，再添加好友。');
      const found=await socialClient.lookup(result.id);
      if(!active||!dialog.open)return;
      closeModal();navigate('contacts',{profileId:found.profile.userId});
    }});
  },()=>{active=false;dispose()});
}
function mineAction(action){const actions={'account-settings':accountSettings,install:()=>location.assign('./install.html'),'bill-center':openBillCenter,'profile-updated':updateRailProfile,lock:()=>{wallet.lock();toast('钱包已锁定')},unlock:()=>unlockModal(()=>{socialCleanup?.refresh?.();toast('钱包已解锁')}),create:()=>beginWalletSetup(),export:exportVault,privacy:privacyModal,notice:noticeModal};actions[action]?.()}
function displayedBalance(){if(!state().exists)return '—';if(hideBalance)return '••••••';if(balance===null)return '—';return Number(balance).toLocaleString('en-US',{maximumFractionDigits:6})}
function renderWallet(page){
  const s=state(),platform=assetTab==='platform';let cash=null,cashError='';try{cash=getSocialWalletSummary()}catch(error){cashError=error.message}
  page.innerHTML=`
    <div class="asset-page-head"><button type="button" class="asset-back" data-nav="mine" aria-label="返回我的">${icon('chevron')}</button><h2>我的资产</h2><button type="button" class="subtle-button" data-action="records">账单 ${icon('chevron')}</button></div>
    <div class="asset-tabs" role="tablist" aria-label="资产账户"><button role="tab" aria-selected="${!platform}" class="${!platform?'active':''}" data-action="chain-tab">${icon('key')}链上钱包</button><button role="tab" aria-selected="${platform}" class="${platform?'active':''}" data-action="platform-tab">${icon('wallet')}平台余额</button></div>
    <div class="bsc-only">${icon('shield')}<span><strong>仅支持 BSC 测试网</strong>请勿转入主网资产或其他网络资产。</span></div>
    <section class="balance-card ${platform?'platform-hero':''}">
      <div class="balance-top">${platform?'平台余额服务':'我的链上资产'}<button class="eye" data-action="visibility" aria-label="${hideBalance?'显示资产':'隐藏资产'}">${icon(hideBalance?'eyeoff':'eye')}</button></div>
      <div class="balance-number" id="balance-number">${platform?'<span class="unavailable-balance">尚未开通</span>':displayedBalance()} ${platform?'':'<span>tBNB</span>'}</div>
      <p class="balance-caption">${platform?'充值、提现尚未开放':s.exists?(balanceError?'余额暂不可用 · 点击刷新':loadingBalance?'正在读取链上余额…':'密钥由你保管 · BSC 测试资产'):'创建钱包，自行掌握你的链上资产'}</p>
      <div class="wallet-art"><svg viewBox="0 0 140 140"><rect x="23" y="25" width="85" height="85" rx="24"/><rect x="38" y="40" width="85" height="85" rx="24"/><path d="m58 82 22-22 22 22-22 22Z"/><path d="m67 82 13-13 13 13-13 13Z"/></svg></div>
      <div class="balance-footer"><button data-action="${platform?'platform-rules':s.exists?'copy':'create'}">${icon(platform?'info':s.exists?'copy':'wallet')}${platform?'查看余额说明':short(s.address)}</button><span class="badge-light">${platform?'托管账户 · 未接通':s.exists?(s.unlocked?'已解锁':'已锁定'):'自托管钱包'}</span></div>
    </section>
    <div class="actions-grid ${platform?'platform-actions':''}">${platform?`
      <button class="quick-action" data-action="deposit"><span class="action-icon">${icon('receive')}</span>转入余额</button><button class="quick-action" data-action="withdraw"><span class="action-icon">${icon('send')}</span>转出到钱包</button><button class="quick-action" data-action="platform-records"><span class="action-icon">${icon('history')}</span>余额记录</button><button class="quick-action" data-action="platform-rules"><span class="action-icon">${icon('info')}</span>使用说明</button>`:`
      <button class="quick-action" data-action="send"><span class="action-icon">${icon('send')}</span>转账</button><button class="quick-action" data-action="receive"><span class="action-icon">${icon('receive')}</span>收款</button><button class="quick-action" data-action="deposit"><span class="action-icon">${icon('wallet')}</span>转入余额</button><button class="quick-action" data-action="records"><span class="action-icon">${icon('history')}</span>记录</button>`}</div>
    ${!s.exists?`<div class="setup-card card">${icon('shield')}<div class="setup-text"><h3>开始使用钱包</h3><p>创建后备份助记词，仅用于测试。</p></div><button class="small-primary" data-action="create">创建钱包</button></div>`:''}
    <div class="section-head"><h2>${platform?'余额明细':'钱包资产'}</h2><button class="subtle-button" data-action="${platform?'platform-rules':'refresh'}">${icon(platform?'info':'refresh')}${platform?'结算说明':'刷新'}</button></div>
    <div class="token-card card">${platform?`
      <div class="token-row"><div class="token-logo token-usdt">₮</div><div class="token-meta"><strong>USDT</strong><p>BSC · 服务结算币种 · 待接入</p></div><div class="token-value">—<small>服务尚未开通</small></div></div>
      <p class="thin-note">不同币种分别记账，不自动兑换。发现内服务未来统一通过平台余额结算；当前云端 AI 仅使用免费验收额度，不扣余额。</p>`:`
      <div class="token-row"><div class="token-logo">${icon('bnb')}</div><div class="token-meta"><strong>BNB</strong><p>BNB Smart Chain · Testnet</p></div><div class="token-value"><span id="token-balance">${displayedBalance()}</span><small>tBNB · 无实际价值</small></div></div><p class="thin-note">仅支持 BSC 测试网原生 BNB。其他网络、主网及代币转账暂未开放。</p>`}</div>
    ${platform?`<section class="demo-pocket"><div class="demo-pocket-top"><h3>本机体验额度</h3><span class="demo-tag">演示 · 不可提现</span></div><p>${cashError?`额度暂不可用：${esc(cashError)}`:'用于体验好友与群聊内的互动，独立于链上资产和真实平台余额。'}</p><dl><div><dt>可用体验额度</dt><dd>${cash?(hideBalance?'••••':cash.balance.toFixed(6)):'—'}<small>tBNB</small></dd></div><div><dt>待领取额度</dt><dd>${cash?(hideBalance?'••••':cash.locked.toFixed(6)):'—'}<small>tBNB</small></dd></div></dl></section>`:''}
    ${!platform?`<section class="card wallet-tools">${!s.exists?'<button class="subtle-button" data-action="import-wallet">导入已有钱包</button>':'<button class="subtle-button" data-action="'+(s.unlocked?'lock':'unlock')+'">'+(s.unlocked?'锁定钱包':'解锁钱包')+'</button><button class="subtle-button" data-action="export">导出加密备份</button>'}<button class="subtle-button" data-action="watch-wallets">观察钱包地址</button><button class="subtle-button" data-action="wallet-compatibility">钱包兼容说明</button></section>`:''}
    ${platform?`<details class="balance-flow card"><summary class="flow-title">转入、转出说明</summary><div><span>链上钱包<small>自行保管密钥</small></span>${icon('arrow')}<span>密码验证<small>转入 / 转出均验证</small></span>${icon('arrow')}<span>平台余额<small>平台统一记账</small></span></div><p>当前仅可保存转入 / 转出草稿，不扣款、不入账。正式开放后，转入需等待链上确认，转出需等待提现完成。</p></details>`:`<div class="section-head"><h2>最近活动</h2><button class="subtle-button" data-action="records">全部记录 ${icon('chevron')}</button></div><div class="card" id="recent-records">${recordsHtml(3)}</div>`}`;
}

function recordsHtml(limit=100){let rec=[];try{rec=wallet.getRecords()}catch(error){return `<div class="ledger-error" role="alert">记录暂不可用：${esc(error.message)}。原始数据已保留，请检查浏览器存储后重试。</div>`}if(!rec.length)return `<div class="empty-state"><div class="empty-icon">${icon('history')}</div><h3>每一次往来，都会留下记录</h3><p>完成第一笔测试网转账后，可在这里查看。<br>仅显示本机发起的交易，链上完整记录请查看浏览器。</p></div>`;return `<div class="tx-list">${rec.slice(0,limit).map(r=>`<a class="tx-item" href="https://testnet.bscscan.com/tx/${esc(r.hash)}" target="_blank" rel="noopener noreferrer"><span class="tx-icon">${icon('send')}</span><span class="tx-info"><strong>转出 · ${esc(short(r.to))}</strong><small>${esc(short(r.hash))}</small></span><span class="tx-sum"><strong>${hideBalance?'••••':esc(r.amount)} tBNB</strong><small>${r.status==='confirmed'?'已确认':r.status==='failed'?'链上执行失败':r.broadcastUncertain?'广播状态待核实':'等待确认'}</small></span></a>`).join('')}</div>`}
async function refreshBalance(showToast=false){const s=state();if(s.corrupt||s.unavailable){balance=null;balanceError='钱包暂不可用';if(showToast)walletProblem(s);return}if(!s.exists){if(showToast)toast('创建钱包后即可查看链上余额');return}if(loadingBalance)return;loadingBalance=true;balanceError='';if(currentView==='wallet')renderWallet(document.querySelector('#page'));try{balance=await wallet.getBalance();if(showToast)toast('链上余额已更新')}catch(e){balance=null;balanceError=e.message;if(showToast)toast(e.message)}finally{loadingBalance=false;if(currentView==='wallet')renderWallet(document.querySelector('#page'))}}
function showModal(title,html,setup,cleanup){if(dialog.open){modalCleanup?.();modalCleanup=null}dialog.innerHTML=`<div class="modal-inner"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-btn" id="modal-close" aria-label="关闭">${icon('close')}</button></div>${html}</div>`;modalCleanup=cleanup||null;if(!dialog.open)dialog.showModal();dialog.querySelector('#modal-close').onclick=closeModal;setup?.(dialog)}
function closeModal(){dialog.close();clearModal()}
function authorizePacket(context){
  if(!Number.isSafeInteger(context.totalUnits)||context.totalUnits<=0||context.currency!=='tBNB')return Promise.reject(new Error('红包金额无效，请重新填写。'));
  if(context.signal?.aborted)return Promise.resolve(false);
  if(walletProblem())return Promise.resolve(false);
  if(!state().exists){
    showModal('先设置钱包密码',`<p class="modal-copy">发红包前，需要用本机钱包密码验证。请先创建并备份测试钱包，再返回聊天发送。</p><div class="notice">本次没有扣款。演示红包使用本机平台余额，不使用链上资产。</div><button class="primary" id="packet-create-wallet">创建测试钱包</button>`,el=>el.querySelector('#packet-create-wallet').onclick=walletStart);
    return Promise.resolve(false);
  }
  return new Promise(resolve=>{
    let finished=false;
    const revision=viewRevision;
    const finish=value=>{if(finished)return;finished=true;context.signal?.removeEventListener('abort',abort);resolve(value)};
    const cancel=()=>{wallet.cancelCreation();finish(false)};
    const abort=()=>{if(dialog.querySelector('#packet-password-form'))closeModal();else cancel()};
    context.signal?.addEventListener('abort',abort,{once:true});
    showModal('确认演示红包',`<div class="transfer-amount">${demoAmount(context.totalUnits)} <small>演示 tBNB</small></div><div class="transfer-detail"><span>发送到</span><b>${esc(context.chatName)}</b></div><div class="transfer-detail"><span>付款账户</span><b>平台余额 · 本机演示</b></div><div class="notice warn" style="margin-top:18px">这会改变本机演示余额。不会扣除链上资产，不发送真实红包，也没有 Gas 费用。</div><form id="packet-password-form"><label class="field">验证钱包密码<input name="password" type="password" autocomplete="current-password" required placeholder="每次发送都需要验证"></label><p class="form-error" role="alert"></p><button class="primary" type="submit">验证密码并发送演示红包</button></form>`,el=>{
      el.querySelector('form').onsubmit=event=>{
        event.preventDefault();const form=event.target;
        busyForm(form,async()=>{
          let password=form.elements.password.value;
          form.elements.password.value='';
          try{await wallet.verifyPassword(password)}finally{password=''}
          if(finished||context.signal?.aborted||revision!==viewRevision||!form.isConnected||!dialog.open){finish(false);return}
          modalCleanup=null;closeModal();finish(true);
        });
      };
    },cancel);
  });
}
function clearModal(){modalCleanup?.();modalCleanup=null;backupPhrase='';dialog.innerHTML=''}
dialog.addEventListener('cancel',e=>{e.preventDefault();closeModal()});dialog.addEventListener('click',e=>{if(e.target===dialog)closeModal()});
function formError(e){const el=dialog.querySelector('.form-error');if(el)el.textContent=e?.message||String(e)}
async function busyForm(form,job){const btn=form.querySelector('[type="submit"]');const prev=btn.textContent;btn.disabled=true;btn.textContent='正在处理…';formError('');try{await job()}catch(e){if(form.isConnected&&dialog.open)formError(e)}finally{if(btn.isConnected){btn.disabled=false;btn.textContent=prev}}}
function beginWalletSetup(after){walletIntent=typeof after==='function'?after:null;walletStart()}
function finishWalletSetup(message){const after=walletIntent;walletIntent=null;modalCleanup=null;closeModal();if(['wallet','mine'].includes(currentView))layout();refreshBalance();toast(message);after?.()}
function cancelWalletSetup(){walletIntent=null;wallet.cancelCreation()}
function walletStart(){if(walletProblem())return;if(state().exists){unlockModal(()=>{layout();toast('钱包已解锁')});return}showModal('创建你的钱包',`<p class="modal-copy">密钥在本机生成，由你自己保管。请先创建一个仅用于测试的新钱包。</p><div class="notice warn">当前版本未经独立安全审计，仅供 BSC 测试网使用。请勿导入存有真实资产的钱包。</div><form id="create-form"><label class="field">本机解锁密码<input type="password" id="password" autocomplete="new-password" minlength="10" maxlength="256" required placeholder="至少 10 位，包含字母和数字"></label><label class="field">确认密码<input type="password" id="repeat" autocomplete="new-password" minlength="10" required placeholder="再次输入密码"></label><p class="form-error" role="alert"></p><button type="submit" class="primary">创建并备份钱包 ${icon('arrow')}</button></form><button class="secondary" id="import-wallet">已有钱包，导入助记词 / 私钥 / 备份</button>`,el=>{el.querySelector('#import-wallet').onclick=()=>{wallet.cancelCreation();modalCleanup=null;restoreModal()};el.querySelector('#create-form').onsubmit=e=>{e.preventDefault();const form=e.target;busyForm(form,async()=>{let pw=form.querySelector('#password').value;if(pw!==form.querySelector('#repeat').value)throw new Error('两次输入的密码不一致');form.querySelector('#password').value='';form.querySelector('#repeat').value='';const created=await wallet.createWallet(pw);pw='';if(!form.isConnected||!dialog.open)return;modalCleanup=null;backupPhrase=created.phrase;backupModal();})}},cancelWalletSetup)}
function backupModal(){const words=backupPhrase.split(' ');showModal('备份助记词',`<p class="modal-copy">按顺序抄写以下 12 个单词，保存在只有你能访问的离线位置。</p><div class="notice warn">不要截图、分享或发送给任何人。愚笨者不会索要你的助记词。切到后台将自动锁定并清除当前创建流程。</div><div class="words">${words.map((w,i)=>`<div class="word"><b>${i+1}</b>${esc(w)}</div>`).join('')}</div><label class="check-label"><input id="backed" type="checkbox">我已离线保存助记词，并知道遗失后平台无法找回。</label><button id="verify-backup" class="primary" disabled>验证备份 ${icon('arrow')}</button>`,el=>{el.querySelector('#backed').onchange=e=>el.querySelector('#verify-backup').disabled=!e.target.checked;el.querySelector('#verify-backup').onclick=()=>{modalCleanup=null;verifyBackup()}},()=>{backupPhrase='';cancelWalletSetup()})}
function verifyBackup(){showModal('确认已妥善备份',`<p class="modal-copy">填写对应位置的单词，完成钱包创建。</p><form id="verify-form">${[3,7,11].map(n=>`<label class="field">第 ${n} 个单词<input name="word${n}" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="输入英文单词"></label>`).join('')}<p class="form-error" role="alert"></p><button class="primary" type="submit">完成创建</button></form>`,el=>{el.querySelector('#verify-form').onsubmit=e=>{e.preventDefault();const words=backupPhrase.split(' ');if(![3,7,11].every(n=>e.target.elements[`word${n}`].value.trim().toLowerCase()===words[n-1])){formError('单词不匹配，请核对你的离线备份。');return}try{wallet.commitWallet();backupPhrase='';modalCleanup=null;finishWalletSetup('钱包已创建，备份验证完成')}catch(err){formError(err)}}},()=>{backupPhrase='';cancelWalletSetup()})}
function restoreModal(){let cleanup=()=>{};showModal('导入已有钱包','<div data-wallet-import-root></div>',el=>{cleanup=mountWalletImport(el.querySelector('[data-wallet-import-root]'),{wallet,onSuccess:()=>{modalCleanup=null;cleanup();finishWalletSetup('钱包已导入并加密保存在本机')}})},()=>{cleanup();cancelWalletSetup()})}
function watchWallets(){let cleanup=()=>{};showModal('观察钱包地址','<div data-watch-root></div>',el=>{cleanup=mountWatchWallets(el.querySelector('[data-watch-root]'),{wallet,toast})},()=>cleanup())}
function walletCompatibility(){showModal('钱包兼容说明','<div class="wallet-compat-copy"><p><strong>助记词：</strong>支持标准英文 BIP39；同一助记词、附加口令和 EVM 派生路径会恢复同一地址。</p><p><strong>私钥与加密备份：</strong>支持 EVM 私钥及 Ethereum V3 JSON Keystore 导入，恢复对应的单个地址。</p><p><strong>链上数据：</strong>相同地址在相同网络读取的是同一份链上余额。聊天、个人设置和本机交易记录不靠助记词同步。</p><p><strong>冷钱包：</strong>目前可添加公开地址只读观察，尚未接入硬件设备签名或 WalletConnect。不要为了查看余额导入冷钱包的助记词或私钥。</p><p>当前仅支持 BSC 测试网原生 tBNB。未开放主网、BTC、Solana、跨链或代币资产。钱包提供商之间没有一个能覆盖所有这些功能的通用接口。</p></div>')}

function unlockModal(after){if(walletProblem())return;if(!state().exists){beginWalletSetup(after);return}if(state().unlocked){after?.();return}showModal('解锁钱包',`<p class="modal-copy">输入本机密码，解锁 ${esc(short(state().address))}。</p><form id="unlock-form"><label class="field">钱包密码<input type="password" name="password" autocomplete="current-password" required placeholder="输入本机解锁密码"></label><p class="form-error" role="alert"></p><button type="submit" class="primary">解锁</button></form>`,el=>{el.querySelector('form').onsubmit=e=>{e.preventDefault();const form=e.target;busyForm(form,async()=>{let pw=form.elements.password.value;form.reset();await wallet.unlock(pw);pw='';modalCleanup=null;closeModal();if(currentView==='wallet')layout();after?.()})}},()=>wallet.cancelCreation())}
async function copyAddress(){const s=state();if(walletProblem(s))return;if(!s.address)return beginWalletSetup(copyAddress);try{await navigator.clipboard.writeText(s.address);toast('完整收款地址已复制')}catch{showModal('钱包地址',`<div class="address">${esc(s.address)}</div><p class="modal-copy">复制权限不可用，请长按地址手动复制。</p>`)}}
function receiveModal(){const s=state();if(walletProblem(s))return;if(!s.exists)return beginWalletSetup(receiveModal);showModal('收款',`<div class="notice">仅接收 BSC 测试网 tBNB。其他网络一律不支持，请勿从 Ethereum、TRON、Solana 或其他网络转入。不要转入真实资金。</div><canvas id="qr" class="receive-qr" aria-label="BSC 测试网收款地址二维码"></canvas><div class="address">${esc(s.address)}</div><button class="primary" id="copy-address">${icon('copy')}复制收款地址</button><p class="modal-copy" style="text-align:center;margin:18px 0 0"><a class="link" href="https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/" target="_blank" rel="noopener noreferrer">查看官方测试币水龙头说明 ↗</a></p>`,el=>{el.querySelector('#copy-address').onclick=copyAddress;QRCode.toCanvas(el.querySelector('#qr'),`ethereum:${s.address}@97`,{width:210,margin:1,color:{dark:'#254332',light:'#ffffff'}},err=>{if(err)toast('二维码生成失败，请复制地址')})})}
function openTransfer(recipient=''){recipient=typeof recipient==='string'?recipient:'';if(walletProblem())return;if(!state().exists){beginWalletSetup(()=>openTransfer(recipient));return}if(!state().unlocked){unlockModal(()=>openTransfer(recipient));return}showModal('转账',`<div class="notice">BSC 测试网 · 原生 tBNB<br>直接向收款地址转账，无需对方点击收款。</div><form id="transfer-form"><label class="field">收款地址<input name="to" value="${esc(recipient)}" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="完整的 0x 钱包地址"><span class="field-hint">首版仅支持普通钱包地址，请独立核对收款人。</span></label><label class="field">转账数量 · tBNB<input name="amount" inputmode="decimal" autocomplete="off" required placeholder="0.00"></label><p class="form-error" role="alert"></p><button type="submit" class="primary">查看手续费与转账详情 ${icon('arrow')}</button></form>`,el=>{el.querySelector('form').onsubmit=e=>{e.preventDefault();const form=e.target;busyForm(form,async()=>{const tx=await wallet.prepareTransfer(form.elements.to.value,form.elements.amount.value);if(!form.isConnected||!dialog.open)return;modalCleanup=null;confirmTransferModal(tx)})}},()=>wallet.cancelCreation())}
function confirmTransferModal(tx){showModal('核对转账',`<div class="transfer-amount">${esc(tx.amount)} <small>tBNB</small></div><div class="transfer-detail"><span>网络</span><b>BSC 测试网 · 97</b></div><div class="transfer-detail"><span>收款地址</span><b>${esc(tx.to)}</b></div><div class="transfer-detail"><span>预估网络费</span><b>${esc(tx.gasFee)} tBNB</b></div><div class="transfer-detail"><span>总计扣除</span><b>${esc(tx.total)} tBNB</b></div><form id="confirm-form" style="margin-top:22px"><label class="field">输入密码，确认签名<input name="password" type="password" autocomplete="current-password" required placeholder="密码仅用于本机签名"></label><div class="notice warn">链上交易不可撤回。请再次核对完整地址和金额。</div><p class="form-error" role="alert"></p><button type="submit" class="primary">签名并发送测试币</button></form><button type="button" class="secondary" id="retry-transfer">重新填写转账</button>`,el=>{
  el.querySelector('#retry-transfer').onclick=openTransfer;
  el.querySelector('form').onsubmit=e=>{e.preventDefault();const form=e.target;busyForm(form,async()=>{
    let pw=form.elements.password.value,result;
    form.reset();
    try{result=await wallet.confirmTransfer(tx.id,pw)}catch(error){
      if(form.isConnected&&dialog.open){form.querySelector('[type="submit"]').remove();form.elements.password.disabled=true;form.onsubmit=event=>event.preventDefault();el.querySelector('#retry-transfer').textContent='重新预览转账';}
      throw error;
    }finally{pw=''}
    if(form.isConnected&&dialog.open){modalCleanup=null;transactionResult(result)}
    else{toast(result.broadcastUncertain?'广播状态待核实，请查看本机转账记录。':'交易已提交，请在本机转账记录中查看状态。');}
    refreshBalance();
  })}
},()=>wallet.cancelCreation())}
function transactionResult(result){showModal(result.broadcastUncertain?'广播状态待核实':'交易已提交',`<div class="success-ring">${icon('send')}</div><p class="modal-copy">${result.broadcastUncertain?'网络没有返回明确的广播结果。请先查看链上状态，避免重复转账。':'交易已提交至测试网，等待区块确认。提交并不代表到账。'}</p><div class="address">${esc(result.hash)}</div><a class="primary" href="https://testnet.bscscan.com/tx/${esc(result.hash)}" target="_blank" rel="noopener noreferrer">在 BscScan 查看 ${icon('arrow')}</a><button class="secondary" id="check-tx">刷新确认状态</button><p class="form-error" role="status"></p>`,el=>{el.querySelector('#check-tx').onclick=async e=>{e.target.disabled=true;try{const r=await wallet.getTransactionStatus(result.hash);formError(r.status==='confirmed'?'链上已确认，转账已完成。':r.status==='failed'?'链上执行失败，请查看交易详情。':'仍在等待链上确认，请稍后刷新。');if(currentView==='wallet')renderWallet(document.querySelector('#page'))}catch(err){formError(err)}finally{e.target.disabled=false}}})}
function recordsModal(){showModal('本机转账记录',`${recordsHtml()}<p class="modal-copy" style="margin-top:18px">完整收支记录以区块浏览器为准。清除本机数据不会删除链上记录。</p>`)}
function noticeModal(){showModal('关于愚笨者',`<p class="modal-copy">愚笨者 0.11.1 · 把资产握在手里，把朋友放在身边。</p><div class="notice">已接入真实账号、个人头像与数字 ID、好友申请、私聊和群聊，支持文字、图片与表情。账号资料与聊天记录保存在服务器。</div><div class="notice">钱包支持标准助记词、EVM 私钥和 V3 加密备份导入，以及只读地址观察。密钥在本机加密保存；余额与签名转账仅开放 BSC 测试网。</div><div class="notice warn">发现页、榜单、聊天红包与平台余额仍为体验流程。服务商、赏金与发币仅保存草稿；真实充值、提现和资金托管尚未接通。云端 AI 使用免费验收额度。</div><p class="modal-copy">硬件钱包直连签名、WalletConnect、主网、语音视频及应用商店上架尚未开放。聊天通过 HTTPS 传输，目前不是端到端加密。</p>`) }
function privacyModal(){showModal('隐私与熟人关系',`<div class="notice">申请通过后才能私聊。群成员身份不自动等于好友。</div><p class="modal-copy">账号资料、好友关系与聊天记录存储在服务器，通过 HTTPS 传输，目前不是端到端加密。钱包助记词和私钥只在本机处理，不发送到聊天服务器。</p><div class="transfer-detail"><span>陌生人私聊</span><b>关闭</b></div><div class="transfer-detail"><span>好友验证</span><b>开启</b></div><div class="transfer-detail"><span>资产展示</span><b>默认隐藏</b></div><div class="transfer-detail"><span>加入资产榜</span><b>默认不参与</b></div><p class="modal-copy" style="margin-top:19px">发现页是示例资产榜。正式榜单需用户主动选择公开、验证钱包归属和资产快照。资产多少不能代表信用。</p>`) }
function exportVault(){if(walletProblem())return;if(!state().exists)return beginWalletSetup(exportVault);unlockModal(async()=>{try{const payload=wallet.exportEncryptedKeystore();const result=await saveJsonFile(payload);toast(result.saved?(result.method!=='browser-download'?'加密备份已保存，请与密码分开保管':'已请求下载加密备份，请检查下载文件'):'已取消保存，没有导出文件')}catch(e){toast(e.message||'备份没有保存，请重试')}})}
app.addEventListener('click',e=>{const nav=e.target.closest('[data-nav]');if(nav){e.preventDefault();navigate(nav.dataset.nav);return}const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;const handlers={create:()=>beginWalletSetup(),unlock:()=>unlockModal(()=>layout()),send:openTransfer,receive:receiveModal,copy:copyAddress,records:openBillCenter,refresh:()=>refreshBalance(true),visibility:()=>{hideBalance=!hideBalance;renderWallet(document.querySelector('#page'));if(assetTab==='chain'&&!hideBalance&&balance===null)refreshBalance()},notice:noticeModal,network:()=>showModal('当前网络',`<div class="notice">BSC 测试网 · Chain ID 97 · tBNB</div><p class="modal-copy">目前仅支持 BSC 测试网。其他网络一律不支持，主网暂未开放。测试币无实际价值，不提供跨链切换。</p>`),privacy:privacyModal,cash:openPlatform,'chain-tab':()=>switchAssetTab('chain'),'platform-tab':openPlatform,'watch-wallets':watchWallets,'wallet-compatibility':walletCompatibility,'import-wallet':restoreModal,deposit:()=>platformTransferModal('deposit'),withdraw:()=>platformTransferModal('withdraw'),'platform-rules':platformRules,'platform-records':openBillCenter,lock:()=>{wallet.lock();layout();toast('钱包已锁定')},export:exportVault};handlers[action]?.()});
window.addEventListener('tongban:wallet-locked',()=>{walletIntent=null;backupPhrase='';if(dialog.open){dialog.close();clearModal()}if(currentView==='wallet')layout()});
window.addEventListener('storage',e=>{if(e.key===null||e.key?.startsWith('tongban.wallet')){wallet.lock();balance=null;layout()}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)wallet.lock()});
window.addEventListener('pagehide',()=>wallet.lock());
window.addEventListener('popstate',()=>{const view=viewFromHash(location.hash);walletIntent=null;if(dialog.open)closeModal();discoverProfileId=null;currentView=view;restoreRouteOptions(history.state?.options);layout();window.scrollTo({top:pageScroll.get(view)||0,behavior:'instant'})});
currentView=viewFromHash(location.hash);restoreRouteOptions(history.state?.view===currentView?history.state.options:{});history.replaceState({view:currentView,options:routeOptions},'',hashForView(currentView));layout();initializeAccount();if(state().exists)refreshBalance();

function switchAssetTab(tab){
  if(currentView!=='wallet'){navigate('wallet',{assetTab:tab});return}
  assetTab=tab==='platform'?'platform':'chain';routeOptions={...routeOptions,assetTab};
  history.replaceState({view:currentView,options:routeOptions},'',hashForView(currentView));renderWallet(document.querySelector('#page'));
}
function openPlatform(){switchAssetTab('platform')}
function openDiscoverProfile(id){discoverProfileId=id;currentView='discover';layout();window.scrollTo({top:0,behavior:'instant'})}
function platformRules(){showModal('平台余额说明',`<div class="notice">仅支持 BSC。其他网络一律不支持。</div><p class="modal-copy">链上钱包由你自行保管密钥；平台余额由平台托管、独立记账。发现内的所有服务，包括服务商、AI 工作台、赏金任务与发币相关服务，未来统一通过平台余额结算；当前云端 AI 仅使用免费验收额度，不扣余额。</p><div class="transfer-detail"><span>转入</span><b>验证密码 → 链上确认 → 入账</b></div><div class="transfer-detail"><span>转出</span><b>验证密码 → 提现处理 → 钱包到账</b></div><p class="modal-copy" style="margin-top:18px">不同币种分开记录，不自动兑换。代币创建后默认保存在指定的 BSC 链上钱包，不会自动加入平台余额。</p><div class="notice warn">当前为流程预览：真实充值、提现与资金托管尚未接通。密码验证后仅保存未提交的草稿，不移动资产。</div>`)}
function platformTransferModal(direction){
  if(walletProblem())return;
  if(!state().exists){showModal('先创建钱包',`<p class="modal-copy">转入和转出平台余额都需要验证钱包密码。请先创建一个测试钱包。</p><div class="notice warn">此流程目前只保存草稿，不移动资产。</div><button class="primary" id="start-wallet">创建测试钱包</button>`,el=>el.querySelector('#start-wallet').onclick=()=>beginWalletSetup(()=>platformTransferModal(direction)));return}
  const deposit=direction==='deposit',s=state();
  showModal(deposit?'转入平台余额':'转出到链上钱包',`<div class="notice">仅支持 BSC · 当前为测试网流程预览</div><div class="transfer-steps"><span class="active">1 填写金额</span><i></i><span>2 密码验证</span><i></i><span>3 服务确认</span></div><form id="platform-transfer-form"><label class="field">币种<select name="asset"><option value="tBNB">tBNB · 测试网</option><option value="USDT">USDT · 接入预览</option></select></label><label class="field">${deposit?'转入':'转出'}数量<input name="amount" inputmode="decimal" autocomplete="off" required placeholder="0.00"></label>${deposit?`<div class="transfer-detail"><span>来源钱包</span><b>${esc(s.address)}</b></div><div class="transfer-detail"><span>目标账户</span><b>我的平台余额</b></div>`:`<label class="field">BSC 收款地址<input name="address" autocomplete="off" autocapitalize="off" spellcheck="false" required value="${esc(s.address)}"><span class="field-hint">地址格式无法判断所属网络，请确认收款方使用 BSC。</span></label>`}<label class="field" style="margin-top:18px">钱包密码<input type="password" name="password" autocomplete="current-password" required placeholder="每次转入 / 转出均需验证"></label><div class="notice warn">充值与提现服务尚未接通。本次只验证密码并保存草稿，不扣款、不入账、不发送链上交易。</div><p class="form-error" role="alert"></p><button class="primary" type="submit">验证密码并保存草稿</button></form>`,el=>{el.querySelector('form').onsubmit=e=>{e.preventDefault();const form=e.target;busyForm(form,async()=>{let password=form.elements.password.value;const input={direction,asset:form.elements.asset.value,amount:form.elements.amount.value,address:deposit?s.address:form.elements.address.value,password};form.elements.password.value='';let draft;try{draft=await createTransferDraft(input)}finally{password='';input.password=''}if(!form.isConnected||!dialog.open)return;modalCleanup=null;showModal('草稿已保存 · 尚未提交',`<div class="notice">密码验证已通过。未发生转账或平台余额变动。</div><div class="transfer-detail"><span>方向</span><b>${deposit?'链上钱包 → 平台余额':'平台余额 → 链上钱包'}</b></div><div class="transfer-detail"><span>数量</span><b>${esc(draft.amount)} ${esc(draft.asset)}</b></div><div class="transfer-detail"><span>状态</span><b>服务待接入 · 未扣款</b></div><p class="modal-copy" style="margin-top:18px">真实资金服务上线后，需要重新核对手续费并确认，草稿不会自动执行。</p><button class="primary" id="draft-done">查看平台余额</button>`,modal=>modal.querySelector('#draft-done').onclick=()=>{closeModal();openPlatform()})})}},()=>wallet.cancelCreation())
}
function platformRecords(){let drafts=[];try{drafts=getPlatformTransferDrafts()}catch(error){showModal('记录暂不可用',`<div class="notice warn">${esc(error.message)}</div><p class="modal-copy">未覆盖原有记录，请检查浏览器存储后重试。</p>`);return}showModal('平台余额记录',`<div class="notice">这里是未提交的流程草稿。没有真实资金流水。</div>${drafts.length?drafts.map(d=>`<div class="draft-record"><div><strong>${d.direction==='deposit'?'转入余额':'转出到钱包'}</strong><small>${new Date(d.createdAt).toLocaleString('zh-CN')}</small></div><div><strong>${esc(d.amount)} ${esc(d.asset)}</strong><small>未提交 · 未扣款</small></div></div>`).join(''):'<div class="empty-state"><h3>暂无转入或转出草稿</h3><p>验证密码并保存后，可在这里查看。</p></div>'}`)}

function lockForBackground(){
  wallet.lock();backupPhrase='';walletIntent=null;hideBalance=true;
  if(dialog.open)closeModal();
  if(currentView==='wallet')renderWallet(document.querySelector('#page'));
}
function androidBack(){
  if(dialog.open){closeModal();return true}
  if(socialCleanup?.back?.())return true;
  if(currentView==='bills'){navigate(billReturn.view,billReturn.options);return true}
  if(currentView==='wallet'){navigate('mine');return true}
  if(currentView!=='messages'){navigate('messages');return true}
  return false;
}
installAndroidControls({onBackground:lockForBackground,onBack:androidBack,onError:toast});

function accountSettings(){
 const profile=socialClient.getProfile();if(!profile){navigate('mine');return;}
 showModal('账号设置',accountSettingsHTML(profile),el=>{
  el.querySelector('#account-copy-id').onclick=async()=>{try{await navigator.clipboard.writeText(profile.userId);toast('用户 ID 已复制')}catch{toast('复制权限不可用，请长按 ID 复制')}};
  el.querySelector('#account-qr').onclick=()=>showModal('我的好友码','<canvas id="my-friend-qr" class="receive-qr" aria-label="我的好友二维码"></canvas><div class="address">ID '+esc(profile.userId)+'</div><p class="modal-copy">对方使用“扫一扫”，或输入这个 ID 添加你为好友。修改 ID 后请使用新的好友码。</p>',qr=>QRCode.toCanvas(qr.querySelector('canvas'),'tongban://friend/'+profile.userId,{width:220,margin:2,color:{dark:'#8053BA',light:'#ffffff'}},error=>{if(error)toast('二维码生成失败，请使用 ID 添加好友')}));
  el.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.target;busyForm(form,async()=>{if(form.elements.newPassword.value!==form.elements.repeat.value)throw new Error('两次输入的新密码不一致。');if(!/^\d{6}$/.test(form.elements.newPassword.value))throw new Error('新密码需要 6 位数字。');await socialClient.changePassword(form.elements.currentPassword.value,form.elements.newPassword.value);form.reset();if(form.isConnected&&dialog.open)closeModal();toast('账号密码已更新，其他设备需重新登录。')})};
  el.querySelector('#account-logout').onclick=()=>showModal('退出账号','<p class="modal-copy">退出后，可用 ID 和密码重新登录。服务器聊天记录和本机钱包都会保留；钱包会自动锁定。</p><p class="form-error" role="alert"></p><button class="primary" id="confirm-account-logout">确认退出</button>',confirm=>{confirm.querySelector('button#confirm-account-logout').onclick=async event=>{event.target.disabled=true;try{await socialClient.logout();wallet.lock();closeModal();navigate('messages')}catch(error){formError(error);event.target.disabled=false}}});
 });
}
