import {loadingSkeleton} from './loading-skeleton.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unavailable={defi:['DeFi','当前没有接入 DeFi 协议，不能读取持仓或发起操作。'],nft:['NFT','当前没有接入 NFT 索引服务，不能据此判断链上是否持有 NFT。'],authorizations:['授权','授权扫描和撤销尚未接入。这里没有结果，不代表链上没有授权。']};
export function walletHomeHTML({state,network,amount,hidden=true,error='',loading=false,hasSnapshot=false,section='assets',recordsHTML='',walletName='我的钱包',icon=()=>''}){
  const exists=state.exists,short=state.address?state.address.slice(0,6)+'…'+state.address.slice(-4):'';
  const pending=exists&&loading&&!hasSnapshot&&!error;
 // 预留：DeFi / NFT / 授权，接入后恢复 tab。不可从应用导航到达预留面板。
 const tabs=[['assets','资产'],['bills','转账记录']];
 const panel=unavailable[section];
 return `<div class="chain-wallet mobile-wallet" data-wallet-section="${esc(section)}">
   <section class="mobile-wallet-card ybz-wallet-hero" aria-label="本机自托管钱包" aria-busy="${pending}">
   <div class="mobile-wallet-card-top">${exists?`<button type="button" class="wallet-name-switch" data-action="wallet-management" aria-label="切换或管理本机钱包"><span class="wallet-name-label" title="${esc(walletName)}">${esc(walletName)}</span>${icon('chevron')}</button>`:'<strong>我的钱包</strong>'}${exists?'<button data-action="export" class="wallet-backup">立即备份</button>':'<span>尚未创建</span>'}<button class="wallet-card-menu" data-action="wallet-management" aria-label="管理本机钱包">${icon('info')}</button></div>
    <div class="mobile-wallet-amount"><strong class="asset-total-number" id="balance-number">${pending?'<span class="ybz-skeleton-block ybz-skeleton-amount" aria-hidden="true"></span>':esc(amount)}</strong><button class="eye" data-action="visibility" aria-label="${hidden?'显示资产':'隐藏资产'}">${icon(hidden?'eyeoff':'eye')}</button></div>
   <p>${esc(network.symbol)} · <button class="wallet-network-link" data-action="network">${esc(network.name)} ${icon('chevron')}</button></p>
   ${exists?`<button class="asset-address-copy" data-action="copy" aria-label="复制链上钱包地址">${esc(short)}${icon('copy')}</button>`:'<div class="wallet-setup-actions"><button class="primary" data-action="create">创建钱包</button><button class="secondary" data-action="import-wallet">导入钱包</button></div>'}
    <p class="mobile-wallet-status" role="${error?'alert':'status'}">${error?`${hasSnapshot?'显示上次读取的资产':'资产暂不可用'} · ${esc(error)} · 请刷新`:loading?'正在读取链上资产…':'仅用于测试 · 测试资产无实际价值'}</p>
  </section>
  <nav class="mobile-wallet-actions" aria-label="钱包操作">${[['send','send','转账'],['receive','receive','收款'],['wallet-more','info','更多']].map(([action,symbol,label])=>`<button type="button" data-action="${action}">${icon(symbol)}<span>${label}</span></button>`).join('')}</nav>
  <nav class="mobile-wallet-tabs" aria-label="资产分类">${tabs.map(([id,label])=>`<button type="button" class="asset-segment ${section===id?'active':''}" aria-current="${section===id?'page':'false'}" data-action="chain-${id}">${label}</button>`).join('')}</nav>
  ${section==='bills'?`<section><div class="section-head"><h2>转账记录</h2><button class="subtle-button" data-action="refresh">刷新状态</button></div><div id="recent-records">${recordsHTML}</div></section>`:panel?`<section class="wallet-unavailable" role="status"><h2>${panel[0]}尚未接入</h2><p>${panel[1]}</p><button class="subtle-button" data-action="wallet-dapps">查看链上工具</button></section>`:`<section aria-label="钱包资产" class="mobile-token-list">${pending?loadingSkeleton('wallet',{rows:1}):`<div class="mobile-token-row"><span class="mobile-token-icon" aria-hidden="true">${icon('bnb')}</span><span><strong>${esc(network.symbol)}</strong><small>行情与涨跌幅未接入</small></span><span class="mobile-token-value"><strong id="token-balance">${esc(amount)}</strong><small>测试资产不估值</small></span></div>`}<button class="wallet-record-link" data-action="chain-bills">转账记录 ${icon('chevron')}</button><button class="wallet-record-link" data-action="refresh">刷新链上资产 ${icon('refresh')}</button></section>`}
  <p class="wallet-custody-notice">密钥保存在你自己的设备上，平台不托管、不接触你的资金。</p>
 </div>`;
}
