import './app.css';
import { saveJsonFile, installAndroidControls, isNativeApp } from './native-runtime.js';
import './app-v4.css';
import './app-v6.css';
import './desktop.css';
import { MAIN_NAV, WORKBENCH_FEATURES, isAppView, hashForView, navigationFromHash, normalizeNavigation, activeNavView } from './app-navigation.js';
import { mountQrScanner } from './qr-scanner.js';
import * as wallet from './wallet.js';
import { mountLiveSocial } from './live-social.js';
import { createSocialClient } from './social-client.js';
import { mountAccountGate, accountSettingsHTML, mountAccountSecurity } from './account-ui.js';
import { mountNotificationSettings } from './notification-settings.js';
import { mountWalletImport, mountWatchWallets } from './wallet-import-ui.js';
import QRCode from 'qrcode';
import { mountDiscover } from './discover.js';
import { getLocalProfile } from './profile-store.js';
import { mountMine } from './mine.js';
import { mountBillCenter } from './bill-center.js';
import './theme-lilac.css';
import './theme-minimal.css';
import './social-minimal.css';
import './mine-minimal.css';
import { mountWorkbenchHub } from './workbench-hub.js';
import { mountPoints } from './points.js';
import './chain-wallet.css';
import { createActivityTracker } from './community-client.js';
/* 三皮肤视觉系统：必须保持在所有 CSS 引入的最后（WorkBuddy 2026-10-10） */
import './theme-skins.css';
import './theme-skins.js';

const paths={scan:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M16 21h5v-5 M3 12h18',wallet:'M4 7h14a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12v3 M20 11h-5v4h5 M16.5 13h.1',message:'M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z M7 10h.1 M11 10h.1 M15 10h.1',users:'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M21 21v-2a4 4 0 0 0-3-3.87',discover:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M16 8l-3 5-5 3 3-5Z',user:'M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2 M12 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8',arrow:'M5 12h14 M13 6l6 6-6 6',send:'M7 17 17 7 M7 7h10v10',receive:'M7 7v10h10 M7 17 17 7',gift:'M3 8h18v4H3Z M5 12v9h14v-9 M12 8v13 M12 8H8a3 3 0 1 1 3-3Zm0 0h4a3 3 0 1 0-3-3Z',copy:'M9 8h11v13H9Z M15 8V3H4v13h5',eye:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',eyeoff:'M3 3 21 21 M10 5h2c7 0 10 7 10 7a20 20 0 0 1-4 4 M6 6c-3 2-4 6-4 6s3 7 10 7c2 0 4-.5 5-1 M10 10a3 3 0 0 0 4 4',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z M8 12l3 3 5-6',lock:'M5 10h14v11H5Z M8 10V6a4 4 0 0 1 8 0v4',refresh:'M20 7v5h-5 M4 17v-5h5 M6 5a8 8 0 0 1 14 7 M4 12a8 8 0 0 0 14 7',check:'M5 12l4 4L19 6',close:'M6 6l12 12 M6 18 18 6',chevron:'M9 5l7 7-7 7',bnb:'M12 2 7 7l5 5 5-5Z M5 9l-3 3 3 3 3-3Z M19 9l-3 3 3 3 3-3Z M12 12l-5 5 5 5 5-5Z',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',key:'M14 6a5 5 0 1 1 0 7l-7 7H3v-4l7-7 M17 7h.1',spark:'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z',file:'M6 3h8l4 4v14H6Z M14 3v5h5 M9 12h6 M9 16h4',info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.1'};
const icon=(name,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.info}"/></svg>`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=a=>a?`${a.slice(0,6)}…${a.slice(-4)}`:'尚未创建钱包';
let chainSection='assets';
let currentView='workbench',socialCleanup=null,hideBalance=true,balance=null,balanceError='',loadingBalance=false,modalCleanup=null,backupPhrase='',toastTimer,viewRevision=0;
let routeOptions={},billReturn={view:'mine',options:{}},walletIntent=null,walletSetupContext=null;
const pageScroll=new Map();
const app=document.querySelector('#app'),dialog=document.querySelector('#modal');
const navs=MAIN_NAV;
let accountLoading=true,accountError='',accountWasSignedIn=false;
let activityTracker=null;
const socialClient=createSocialClient({onChange:profile=>{const signedOut=accountWasSignedIn&&!profile;accountWasSignedIn=!!profile;updateRailProfile();if(signedOut&&!accountLoading){wallet.lock();queueMicrotask(()=>layout());}}});
async function initializeAccount(){accountLoading=true;accountError='';try{await socialClient.initialize()}catch(error){accountError=error.message}finally{accountLoading=false;layout()}}
function accountReady(profile,created){accountLoading=false;accountError='';layout();toast(socialClient.getStorageWarning()||(created?'账号已创建，你的 ID 是 '+profile.userId:'登录成功'));}

function state(){try{return wallet.getWalletState()}catch{return {exists:true,address:null,unlocked:false,unavailable:true}}}
function walletProblem(s=state()){if(!s.corrupt&&!s.unavailable&&(!s.exists||s.address))return false;showModal('钱包暂不可用',`<div class="notice warn">${s.unavailable?'浏览器无法读取本地钱包存储，请检查存储权限后重试。':'本机钱包文件无法读取。请保留原始数据、离线助记词和已有加密备份，使用助记词在可信钱包中恢复。'}</div><p class="modal-copy">当前不能生成收款码或签名交易，原有钱包数据不会被覆盖。</p>`);return true}
function toast(msg){const el=document.querySelector('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500)}
function navHtml(){const selected=activeNavView(currentView,billReturn.view,routeOptions);return navs.map(([id,i,label])=>`<button type="button" class="nav-item ${id===selected?'active':''}" data-nav="${id}" ${id===selected?'aria-current="page"':''}>${icon(i)}<span>${label}</span></button>`).join('')}
function profile(){try{return socialClient.getProfile()||getLocalProfile()}catch{return {nickname:'资料暂不可用',avatar:'🌱'}}}
function updateRailProfile(){const p=profile();const el=app.querySelector('.rail .self');if(el){el.querySelector('.avatar').innerHTML=p.avatarImage?'<img src="'+esc(p.avatarImage)+'" alt="我的头像">':esc(p.avatar);el.querySelector('strong').textContent=p.nickname}}
function layout(){
  socialCleanup?.();socialCleanup=null;document.body.classList.remove('social-chat-open');viewRevision++;
  const s=state(),p=profile();
  app.innerHTML=`<div class="layout"><aside class="rail"><a class="brand" href="#workbench" data-nav="workbench"><img src="./icon.png" alt="愚笨者"><span>愚笨者</span></a><nav class="rail-nav" aria-label="主导航">${navHtml()}</nav><div class="rail-bottom"><p class="rail-note"><span class="tiny-tag"><span class="dot"></span> v0.14.0-dev · 本地测试</span></p><button class="self" data-nav="mine"><span class="avatar">${p.avatarImage?`<img src="${esc(p.avatarImage)}" alt="我的头像">`:esc(p.avatar)}</span><span><strong>${esc(p.nickname)}</strong><small>我的个人资料</small></span></button></div></aside><main class="workspace" data-view="${currentView}">${currentView==='wallet'?`<header class="topbar wallet-context-header"><div class="top-actions"><button class="network-pill" data-action="network"><span class="dot"></span>BSC 测试网${icon('chevron')}</button><button class="icon-btn" data-action="notice" aria-label="关于与环境说明">${icon('info')}</button></div></header>`:''}<div class="content-grid"><section class="main-content full-width ${currentView==='wallet'?'wallet-page':'social-main'}" id="page"></section></div></main></div><nav class="bottom-nav" aria-label="手机导航">${navHtml()}</nav>`;
  const page=document.querySelector('#page');
  if(['messages','contacts','mine','workbench','points'].includes(currentView)&&!socialClient.getProfile())socialCleanup=mountAccountGate(page,{client:socialClient,onReady:accountReady,onWallet:()=>navigate('wallet'),onRetry:initializeAccount,error:accountError,loading:accountLoading});
  else if(currentView==='wallet')renderWallet(page);
  else if(currentView==='points')socialCleanup=mountPoints(page,{client:socialClient,onNavigate:navigate});
  else if(currentView==='workbench'&&WORKBENCH_FEATURES.includes(routeOptions.route))socialCleanup=mountDiscoveryPage(page,'workbench');
  else if(currentView==='workbench'){
    let initializing=true;
    socialCleanup=mountWorkbenchHub(page,{client:socialClient,toast,onPoints:()=>navigate('points'),onAccount:()=>navigate('messages'),onLegacy:()=>navigate('workbench',{route:'ai'}),onOpenFeature:route=>navigate('workbench',{route}),initialMode:routeOptions.hub?.mode,initialScreen:routeOptions.hub?.screen,initialSelected:routeOptions.hub?.selected,onScreenChange:hub=>{
      const previous=hashForView(currentView,routeOptions);routeOptions={hub};const next=hashForView(currentView,routeOptions);
      if(initializing||previous===next)history.replaceState({view:currentView,options:routeOptions},'',next);
      else{history.pushState({view:currentView,options:routeOptions},'',next);window.scrollTo({top:0,behavior:'instant'});}
    }});initializing=false;
  }
  else if(currentView==='mine')socialCleanup=mountMine(page,{toast,onNavigate:navigate,onAction:mineAction,getWalletStatus:state,isNative:isNativeApp(),profileService:socialClient});
  else if(currentView==='bills')socialCleanup=mountBillCenter(page,{toast,sources:{chain:()=>wallet.getRecords()},onRefresh:hash=>wallet.getTransactionStatus(hash),onBack:()=>navigate(billReturn.view,billReturn.options)});
  else if(currentView==='discover')socialCleanup=mountDiscoveryPage(page,routeOptions.origin==='mine'?'mine':'discover');
  else if(['messages','contacts'].includes(currentView))socialCleanup=mountLiveSocial(page,{service:socialClient,profile:socialClient.getProfile(),view:currentView,toast,onNavigate:navigate,onScan:openScan,onGift:openDistributionInfo,initialProfileId:routeOptions.profileId,onScreenChange:({screen})=>document.body.classList.toggle('social-chat-open',screen==='chat')});
  else page.innerHTML='<p>页面暂不可用。</p>';
}
function mountDiscoveryPage(page,origin){
  return mountDiscover(page,{socialClient,onAccount:()=>navigate('messages'),toast,onNavigate:navigate,onProfile:openDiscoverProfile,getWalletAddress:()=>state().address||'',initialRoute:routeOptions.route||'hub',initialOwnMoments:!!routeOptions.own,backLabel:origin==='workbench'?'返回 AI 工作台':origin==='mine'?'返回我的':'返回发现',onExit:origin==='discover'?undefined:()=>navigate(origin),onRouteChange:(route,meta={})=>{
    if(!meta.localDraft&&origin==='discover'&&WORKBENCH_FEATURES.includes(route)){queueMicrotask(()=>navigate('workbench',{route}));return;}
    routeOptions={...routeOptions,route:meta.canonicalRoute||route};history.replaceState({view:currentView,options:routeOptions},'',hashForView(currentView,routeOptions));
  }});
}
function navigate(view,options={}){
  if(!isAppView(view))return;
  pageScroll.set(currentView,window.scrollY);walletIntent=null;if(dialog.open)closeModal();
  currentView=view;restoreRouteOptions(options);
  history.pushState({view:currentView,options:routeOptions},'',hashForView(currentView,routeOptions));layout();
  window.scrollTo({top:options.route?0:(pageScroll.get(view)||0),behavior:'instant'});
}
function restoreRouteOptions(options={}){
  const restored=normalizeNavigation(currentView,options);currentView=restored.view;routeOptions=restored.options;
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
      if(!/^[a-z0-9_]{5,24}$/i.test(result.id))throw new Error('好友 ID 无效，请对方提供新版好友码。');
      if(!socialClient.getProfile())throw new Error('请先登录账号，再添加好友。');
      const found=await socialClient.lookup(result.id);
      if(!active||!dialog.open)return;
      closeModal();navigate('contacts',{profileId:found.profile.userId});
    }});
  },()=>{active=false;dispose()});
}
function mineAction(action){const actions={'account-settings':accountSettings,feedback:feedbackModal,install:()=>location.assign('./install.html'),'bill-center':openBillCenter,'profile-updated':updateRailProfile,lock:()=>{wallet.lock();toast('钱包已锁定')},unlock:()=>unlockModal(()=>{socialCleanup?.refresh?.();toast('钱包已解锁')}),create:()=>beginWalletSetup(),export:exportVault,privacy:privacyModal,notice:noticeModal};actions[action]?.()}
function displayedBalance(){if(!state().exists)return '—';if(hideBalance)return '••••••';if(balance===null)return '—';return Number(balance).toLocaleString('en-US',{maximumFractionDigits:6})}
function renderWallet(page){
  const s=state(),bills=chainSection==='bills';
  page.innerHTML=`
    <div class="asset-page-head"><button type="button" class="asset-back" data-nav="mine" aria-label="返回我的">${icon('chevron')}</button><h2>自托管钱包</h2><button type="button" class="subtle-button" data-action="wallet-management">钱包管理</button></div>
    <div class="bsc-only">${icon('shield')}<span><strong>仅支持 BSC 测试网</strong>请勿转入主网资产或其他网络资产。</span></div>
    <div class="chain-wallet">
      <section class="asset-overview">
        <p class="asset-overview-label">链上资产 <button class="eye" data-action="visibility" aria-label="${hideBalance?'显示资产':'隐藏资产'}">${icon(hideBalance?'eyeoff':'eye')}</button></p>
        <strong class="asset-total-number" id="balance-number">${displayedBalance()}</strong><span class="asset-overview-unit">tBNB</span>
        <div class="asset-overview-meta"><span class="asset-trend">测试资产 · 涨幅不适用</span>${s.exists?`<button class="asset-address-copy" data-action="copy" aria-label="复制链上钱包地址" title="${esc(s.address)}">${esc(short(s.address))}${icon('copy')}</button>`:'<span class="asset-address-empty">尚未创建钱包</span>'}</div>
        <p class="asset-overview-note">${s.exists?(balanceError?'余额暂不可用 · 点击刷新':loadingBalance?'正在读取链上余额…':'密钥由你保管 · BSC 测试资产无实际价值'):'创建或导入钱包后读取链上余额'}</p>
      </section>
      <nav class="asset-quick-actions" aria-label="资产快捷操作">
        <button class="asset-quick-action" data-action="send"><span class="asset-quick-icon">${icon('send')}</span><span>转账</span></button>
        <button class="asset-quick-action" data-action="receive"><span class="asset-quick-icon">${icon('receive')}</span><span>收款</span></button>
        <button class="asset-quick-action" data-action="asset-scan"><span class="asset-quick-icon">${icon('scan')}</span><span>扫一扫</span></button>
        <button class="asset-quick-action asset-quick-gift" data-action="asset-gift"><span class="asset-quick-icon">${icon('gift')}</span><span>发红包</span></button>
      </nav>
      <nav class="asset-segments" aria-label="资产与账单"><button class="asset-segment ${!bills?'active':''}" aria-current="${!bills?'page':'false'}" data-action="chain-assets">资产</button><button class="asset-segment ${bills?'active':''}" aria-current="${bills?'page':'false'}" data-action="chain-bills">账单</button></nav>
      ${bills?`<div id="recent-records">${recordsHtml()}</div>`:`
        ${!s.exists?`<div class="setup-card card">${icon('shield')}<div class="setup-text"><h3>开始使用钱包</h3><p>创建后备份助记词，仅用于测试。</p></div><button class="small-primary" data-action="create">创建钱包</button></div>`:''}
        <div class="section-head"><h2>钱包资产</h2><button class="subtle-button" data-action="refresh">${icon('refresh')}刷新</button></div>
        <div class="token-card card"><div class="token-row"><div class="token-logo">${icon('bnb')}</div><div class="token-meta"><strong>BNB</strong><p>BNB Smart Chain · Testnet</p></div><div class="token-value"><span id="token-balance">${displayedBalance()}</span><small>tBNB · 无实际价值</small></div></div><p class="thin-note">仅支持 BSC 测试网原生 BNB。其他网络、主网及代币转账暂未开放。</p></div>
        <section class="wallet-tools">${!s.exists?'<button class="subtle-button" data-action="import-wallet">导入已有钱包</button>':'<button class="subtle-button" data-action="'+(s.unlocked?'lock':'unlock')+'">'+(s.unlocked?'锁定钱包':'解锁钱包')+'</button><button class="subtle-button" data-action="export">导出加密备份</button>'}<button class="subtle-button" data-action="watch-wallets">观察钱包地址</button><button class="subtle-button" data-action="wallet-compatibility">钱包兼容说明</button></section>
      `}
    </div>`;
}

function recordsHtml(limit=100){let rec=[];try{rec=wallet.getRecords()}catch(error){return `<div class="ledger-error" role="alert">记录暂不可用：${esc(error.message)}。原始数据已保留，请检查浏览器存储后重试。</div>`}if(!rec.length)return `<div class="empty-state"><div class="empty-icon">${icon('history')}</div><h3>每一次往来，都会留下记录</h3><p>完成第一笔测试网转账后，可在这里查看。<br>仅显示本机发起的交易，链上完整记录请查看浏览器。</p></div>`;return `<div class="tx-list">${rec.slice(0,limit).map(r=>`<a class="tx-item" href="https://testnet.bscscan.com/tx/${esc(r.hash)}" target="_blank" rel="noopener noreferrer"><span class="tx-icon">${icon('send')}</span><span class="tx-info"><strong>转出 · ${esc(short(r.to))}</strong><small>${esc(short(r.hash))}</small></span><span class="tx-sum"><strong>${hideBalance?'••••':esc(r.amount)} tBNB</strong><small>${r.status==='confirmed'?'已确认':r.status==='failed'?'链上执行失败':r.broadcastUncertain?'广播状态待核实':'等待确认'}</small></span></a>`).join('')}</div>`}
async function refreshBalance(showToast=false){const s=state();if(s.corrupt||s.unavailable){balance=null;balanceError='钱包暂不可用';if(showToast)walletProblem(s);return}if(!s.exists){if(showToast)toast('创建钱包后即可查看链上余额');return}if(loadingBalance)return;loadingBalance=true;balanceError='';if(currentView==='wallet')renderWallet(document.querySelector('#page'));try{balance=await wallet.getBalance();if(showToast)toast('链上余额已更新')}catch(e){balance=null;balanceError=e.message;if(showToast)toast(e.message)}finally{loadingBalance=false;if(currentView==='wallet')renderWallet(document.querySelector('#page'))}}
function showModal(title,html,setup,cleanup){if(dialog.open){modalCleanup?.();modalCleanup=null}dialog.innerHTML=`<div class="modal-inner"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-btn" id="modal-close" aria-label="关闭">${icon('close')}</button></div>${html}</div>`;modalCleanup=cleanup||null;if(!dialog.open)dialog.showModal();dialog.querySelector('#modal-close').onclick=closeModal;setup?.(dialog)}
function closeModal(){dialog.close();clearModal()}
function clearModal(){modalCleanup?.();modalCleanup=null;backupPhrase='';dialog.innerHTML=''}
dialog.addEventListener('cancel',e=>{e.preventDefault();closeModal()});dialog.addEventListener('click',e=>{if(e.target===dialog)closeModal()});
function formError(e){const el=dialog.querySelector('.form-error');if(el)el.textContent=e?.message||String(e)}
async function busyForm(form,job){const btn=form.querySelector('[type="submit"]');const prev=btn.textContent;btn.disabled=true;btn.textContent='正在处理…';formError('');try{await job()}catch(e){if(form.isConnected&&dialog.open)formError(e)}finally{if(btn.isConnected){btn.disabled=false;btn.textContent=prev}}}
function beginWalletSetup(after,options={}){walletIntent=typeof after==='function'?after:null;walletSetupContext=options;walletStart()}
function finishWalletSetup(message){const after=walletIntent,options=walletSetupContext||{};walletIntent=null;walletSetupContext=null;modalCleanup=null;closeModal();if(!options.preserveUI&&['wallet','mine'].includes(currentView))layout();refreshBalance();toast(message);after?.()}
function cancelWalletSetup(){const options=walletSetupContext;walletSetupContext=null;walletIntent=null;wallet.cancelCreation();options?.onCancel?.()}
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
function noticeModal(){showModal('关于愚笨者',`<p class="modal-copy">愚笨者 0.14.0-dev.4 · 本地测试版</p><div class="notice">支持账号资料、好友、私聊、群聊与朋友圈。邮箱验证码在本地页面显示；请在账号安全中管理通行密钥与恢复码。</div><div class="notice">发现中的服务商申请、赏金合作、发币申请与举报保存到本地服务。工作台支持填写目标、确认计划与预算，整理文件或生成清单大纲，下载实际成果。</div><div class="notice warn">POINT 仅用于服务用量，不可转赠或提现；链上红包合约尚未部署。文件任务由本地解析器执行，任务使用本地试用积分，未连接真实邮箱、云桌面或收费模型。</div><p class="modal-copy">钱包密钥在本机加密保存，链上钱包仅支持 BSC 测试网。主网转账、硬件钱包直连、端到端加密与应用商店发布尚未开放。本地测试页面只在这台电脑访问。</p>`) }
function privacyModal(){showModal('隐私与熟人关系',`<div class="notice">申请通过后才能私聊。群成员身份不自动等于好友。</div><p class="modal-copy">账号资料、好友关系与聊天记录存储在服务器，通过 HTTPS 传输，目前不是端到端加密。钱包助记词和私钥只在本机处理，不发送到聊天服务器。</p><div class="transfer-detail"><span>陌生人私聊</span><b>关闭</b></div><div class="transfer-detail"><span>好友验证</span><b>开启</b></div><div class="transfer-detail"><span>资产展示</span><b>默认隐藏</b></div><div class="transfer-detail"><span>加入活跃榜</span><b>默认不参与</b></div><p class="modal-copy" style="margin-top:19px">朋友圈按好友关系与发布范围控制可见；你可以管理登录设备、拉黑、举报或注销账号。<br><a href="./privacy.html">隐私说明</a> · <a href="./terms.html">用户规则</a></p>`) }
function exportVault(){if(walletProblem())return;if(!state().exists)return beginWalletSetup(exportVault);unlockModal(async()=>{try{const payload=wallet.exportEncryptedKeystore();const result=await saveJsonFile(payload);toast(result.saved?(result.method!=='browser-download'?'加密备份已保存，请与密码分开保管':'已请求下载加密备份，请检查下载文件'):'已取消保存，没有导出文件')}catch(e){toast(e.message||'备份没有保存，请重试')}})}
app.addEventListener('click',e=>{const nav=e.target.closest('[data-nav]');if(nav){e.preventDefault();navigate(nav.dataset.nav);return}const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;const handlers={create:()=>beginWalletSetup(),unlock:()=>unlockModal(()=>layout()),send:openTransfer,receive:receiveModal,copy:copyAddress,records:openBillCenter,refresh:()=>refreshBalance(true),visibility:()=>{hideBalance=!hideBalance;renderWallet(document.querySelector('#page'));if(!hideBalance&&balance===null)refreshBalance()},notice:noticeModal,network:()=>showModal('当前网络',`<div class="notice">BSC 测试网 · Chain ID 97 · tBNB</div><p class="modal-copy">目前仅支持 BSC 测试网。其他网络一律不支持，主网暂未开放。测试币无实际价值，不提供跨链切换。</p>`),privacy:privacyModal,'chain-assets':()=>{chainSection='assets';renderWallet(document.querySelector('#page'));},'chain-bills':()=>{chainSection='bills';renderWallet(document.querySelector('#page'));},'asset-scan':()=>openScan(),'asset-gift':openDistributionInfo,'watch-wallets':watchWallets,'wallet-compatibility':walletCompatibility,'import-wallet':restoreModal,'wallet-management':openWalletManagement,lock:()=>{wallet.lock();layout();toast('钱包已锁定')},export:exportVault};handlers[action]?.()});
window.addEventListener('tongban:wallet-locked',()=>{walletIntent=null;backupPhrase='';if(dialog.open){dialog.close();clearModal()}if(currentView==='wallet')layout()});
window.addEventListener('storage',e=>{if(e.key===null||e.key?.startsWith('tongban.wallet')){wallet.lock();balance=null;layout()}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)wallet.lock()});
window.addEventListener('pagehide',()=>wallet.lock());
window.addEventListener('popstate',()=>{const route=navigationFromHash(location.hash);walletIntent=null;if(dialog.open)closeModal();currentView=route.view;restoreRouteOptions(history.state?.view===currentView?history.state.options:route.options);layout();window.scrollTo({top:pageScroll.get(currentView)||0,behavior:'instant'})});
const initialNavigation=navigationFromHash(location.hash);currentView=initialNavigation.view;restoreRouteOptions(history.state?.view===currentView?history.state.options:initialNavigation.options);history.replaceState({view:currentView,options:routeOptions},'',hashForView(currentView,routeOptions));layout();initializeAccount();if(state().exists)refreshBalance();

function openDiscoverProfile(id){navigate('contacts',{profileId:id})}

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
  if(currentView==='points'){navigate('workbench');return true}
  if(currentView!=='workbench'){navigate('workbench');return true}
  return false;
}
installAndroidControls({onBackground:lockForBackground,onBack:androidBack,onError:toast});

function accountSettings(){
 const profile=socialClient.getProfile();if(!profile){navigate('mine');return;}
 showModal('账号设置',accountSettingsHTML(profile),el=>{
  modalCleanup=mountAccountSecurity(el.querySelector('[data-account-security]'),{client:socialClient,onDeleted:()=>{wallet.lock();closeModal();navigate('messages');toast('账号已注销，本机钱包保留并已锁定。')},onRefresh:()=>{updateRailProfile()}});
  el.querySelector('#account-notifications').onclick=()=>showModal('消息通知','<div id="notification-settings"></div>',body=>{modalCleanup=mountNotificationSettings(body.querySelector('#notification-settings'),{client:socialClient})});
  el.querySelector('#account-copy-id').onclick=async()=>{try{await navigator.clipboard.writeText(profile.userId);toast('用户 ID 已复制')}catch{toast('复制权限不可用，请长按 ID 复制')}};
  el.querySelector('#account-qr').onclick=()=>showModal('我的好友码','<canvas id="my-friend-qr" class="receive-qr" aria-label="我的好友二维码"></canvas><div class="address">ID '+esc(profile.userId)+'</div><p class="modal-copy">对方使用“扫一扫”，或输入这个 ID 添加你为好友。修改 ID 后请使用新的好友码。</p>',qr=>QRCode.toCanvas(qr.querySelector('canvas'),'tongban://friend/'+profile.userId,{width:220,margin:2,color:{dark:'#8053BA',light:'#ffffff'}},error=>{if(error)toast('二维码生成失败，请使用 ID 添加好友')}));
  el.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.target;busyForm(form,async()=>{if(form.elements.newPassword.value!==form.elements.repeat.value)throw new Error('两次输入的新密码不一致。');if(!/^\d{6}$/.test(form.elements.newPassword.value))throw new Error('新密码需要 6 位数字。');await socialClient.changePassword(form.elements.currentPassword.value,form.elements.newPassword.value);form.reset();if(form.isConnected&&dialog.open)closeModal();toast('账号密码已更新，其他设备需重新登录。')})};
  el.querySelector('#account-logout').onclick=()=>showModal('退出账号','<p class="modal-copy">退出后，可用 ID 和密码重新登录。服务器聊天记录和本机钱包都会保留；钱包会自动锁定。</p><p class="form-error" role="alert"></p><button class="primary" id="confirm-account-logout">确认退出</button>',confirm=>{confirm.querySelector('button#confirm-account-logout').onclick=async event=>{event.target.disabled=true;try{await socialClient.logout();wallet.lock();closeModal();navigate('messages')}catch(error){formError(error);event.target.disabled=false}}});
 });
}

function feedbackModal(){
 if(!socialClient.getProfile()){navigate('mine');return;}
 const requestId=crypto.randomUUID();
 showModal('问题反馈','<form id="feedback-form"><label class="field">请描述遇到的问题<textarea name="detail" rows="6" minlength="5" maxlength="1000" required placeholder="例如：设备型号、发生步骤和报错文字"></textarea></label><p class="modal-copy">反馈由运营人员查看处理，请勿填写密码、助记词或私钥。</p><p class="form-error" role="alert"></p><button class="primary" type="submit">提交反馈</button></form>',el=>{
  el.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.target;busyForm(form,async()=>{
   const detail=form.elements.detail.value.trim();if(detail.length<5)throw new Error('请至少填写 5 个字，帮助我们定位问题。');
   const result=await socialClient.authenticatedRequest('reports',{method:'POST',input:{targetType:'feedback',reason:'other',detail,requestId}});
   if(form.isConnected)showModal('反馈已提交','<p class="modal-copy">已保存到服务器，运营人员可查看并处理。</p><p class="address">'+esc(result.report?.id||result.id||requestId)+'</p>');
  })};
 });
}

let policyViewEpoch=0;
document.addEventListener('click',event=>{
 const anchor=event.target.closest?.('a[href]');if(!anchor)return;
 const href=anchor.getAttribute('href');if(!['./privacy.html','./terms.html'].includes(href))return;
 event.preventDefault();const title=href.includes('privacy')?'隐私说明':'用户规则';
 showModal(title,'<div class="policy-document"><p role="status">正在读取…</p></div>',undefined,()=>{policyViewEpoch++});
 const turn=++policyViewEpoch,target=dialog.querySelector('.policy-document');
 fetch(href,{credentials:'same-origin',redirect:'error',cache:'no-store'}).then(async response=>{
  if(!response.ok)throw new Error('说明暂时无法读取，请稍后重试。');const html=await response.text();if(html.length>100000)throw new Error('说明格式无效。');
  const doc=new DOMParser().parseFromString(html,'text/html'),main=doc.querySelector('main');if(!main)throw new Error('说明格式无效。');
  if(turn!==policyViewEpoch||!target.isConnected)return;
  // These are bundled local documents. Keep only presentation elements even if a file is damaged.
  const allowed=new Set(['H1','H2','H3','P','STRONG','EM','UL','OL','LI','BR','A','SMALL']);
  function copy(source,parent){for(const child of source.childNodes){if(child.nodeType===3){parent.append(document.createTextNode(child.textContent));continue;}if(child.nodeType!==1)continue;if(!allowed.has(child.tagName)){if(!['SCRIPT','STYLE','IFRAME','OBJECT'].includes(child.tagName))copy(child,parent);continue;}const el=document.createElement(child.tagName.toLowerCase());if(child.tagName==='A'){const link=child.getAttribute('href');if(['./privacy.html','./terms.html'].includes(link))el.setAttribute('href',link);}copy(child,el);parent.append(el);}}
  target.replaceChildren();copy(main,target);
 }).catch(error=>{if(turn===policyViewEpoch&&target.isConnected)target.textContent=error.message;});
});

function openDistributionInfo(){showModal('红包与空投尚未开放','<p class="modal-copy">链上红包合约尚未部署，当前不能发送、领取或托管链上资产。</p><div class="notice">积分只能用于 AI 与平台服务，不能转赠。以后开放活动奖励时，由平台按明确规则发放；当前不会模拟扣款或增加余额。</div>');}
function openWalletManagement(){
 const snapshot=state();if(walletProblem(snapshot))return;
 if(!snapshot.exists){beginWalletSetup();return;}
 showModal('本机钱包管理','<p class="address">'+esc(snapshot.address)+'</p><p class="modal-copy">密钥只保存在当前设备。删除本机钱包不会删除链上资产或其他设备的备份。</p><button class="secondary" data-local-export>导出加密备份</button><button class="secondary" data-local-delete>删除本机钱包</button>',el=>{el.querySelector('[data-local-export]').onclick=exportVault;el.querySelector('[data-local-delete]').onclick=()=>deleteLocalWallet(snapshot.address);});
}
function deleteLocalWallet(expectedAddress){
 let active=true;const revision=viewRevision,owner=socialClient.getProfile()?.userId;
 showModal('删除本机钱包','<p class="address">'+esc(expectedAddress)+'</p><p class="modal-copy">这会移除当前设备的密钥和本机转账记录。请先确认离线备份能恢复钱包。</p><form><label class="check-label"><input name="backedUp" type="checkbox" required>我已妥善备份助记词、私钥或加密备份</label><label class="field">本机钱包密码<input name="password" type="password" autocomplete="current-password" required></label><p class="form-error" role="alert"></p><button class="primary" type="submit">验证并删除本机钱包</button></form>',el=>{el.querySelector('form').onsubmit=event=>{event.preventDefault();const form=event.currentTarget;busyForm(form,async()=>{if(!form.elements.backedUp.checked)throw new Error('请先确认已经完成离线备份。');let password=form.elements.password.value;form.elements.password.value='';let permit;try{permit=await wallet.prepareLocalWalletDeletion(password,{expectedAddress});}finally{password='';}if(!active||revision!==viewRevision||owner!==socialClient.getProfile()?.userId||!form.isConnected||!dialog.open)return;try{await permit.clear();balance=null;closeModal();layout();toast('本机钱包已删除；链上资产不受影响。');}catch(error){toast(error.message);throw error;}});};},()=>{active=false;});
}
activityTracker=createActivityTracker({socialClient,onUpdate:updateRailProfile});
