import {DAPP_LINKS,getWalletConnectAvailability} from './wallet-dapp-policy.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function networkPickerHTML(networks,currentId){
 return '<p class="modal-copy">链上资产和交易记录按网络区分。切换网络会锁定钱包，并清除尚未签署的预览。</p><div class="wallet-network-list">'+networks.map(network=>`<button type="button" class="secondary" data-wallet-chain="${Number(network.chainId)}" ${!network.enabled||network.chainId===currentId?'disabled':''}><strong>${esc(network.name)}</strong> · ${Number(network.chainId)} · ${esc(network.symbol)}<br><small>${network.chainId===currentId?'当前网络':network.enabled?'可切换':esc(network.reason||'主网未开放')}</small></button>`).join('')+'</div><p class="form-error" role="alert"></p>';
}

export function mountNetworkPicker(root,{wallet,onChanged=()=>{}}){
 root.innerHTML=networkPickerHTML(wallet.getNetworks(),wallet.NETWORK.chainId);
 let active=true,busy=false;
 const click=async event=>{const button=event.target.closest?.('[data-wallet-chain]');if(!active||busy||!button||button.disabled)return;busy=true;button.disabled=true;try{await wallet.setNetwork(Number(button.dataset.walletChain));if(active)onChanged();}catch(error){if(active){root.querySelector('.form-error').textContent=error.message;button.disabled=false;}}finally{busy=false;}};
 root.addEventListener('click',click);return()=>{active=false;root.removeEventListener('click',click);};
}

export function walletToolsHTML(){
 const availability=getWalletConnectAvailability();
 return `<p class="modal-copy">只打开下列官方工具的系统浏览器页面。请自行核对网址，不要把助记词或私钥输入网页。</p><div class="wallet-dapp-links">${DAPP_LINKS.map(item=>`<article><h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><p class="thin-note">${esc(item.warning)}</p><a class="secondary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">打开官方页面 ↗</a></article>`).join('')}</div><div class="notice"><strong>钱包连接</strong><p>${esc(availability.reason)}</p><p>当前没有已连接的 DApp。外链可打开，不代表本站钱包已授权；硬件钱包直连尚未接入。</p></div><div class="notice"><strong>网络手续费</strong><p>Gas 代付暂未开放。当前转账的网络手续费由你承担，每笔签署前会显示预估费用。</p><p>钱包地址和资产不会自动迁移，也不会自动替你付款。</p></div>`;
}

// All signable parameters are rendered as text, including empty calldata.
export function transferDetailsHTML(tx,network){
 const fields=[['网络',`${network.name} · ${tx.chainId}`],['发送地址',tx.from],['收款地址',tx.to],['金额',`${tx.amount} ${tx.symbol}`],['方法',tx.data&&tx.data!=='0x'?'原生资产转账（附带任务摘要）':'原生资产转账'],['交易类型',tx.type===2?'EIP-1559 · type 2':'Legacy · type 0'],['Gas 上限',tx.gasLimit],['Gas 单价（wei）',tx.gasPrice],['最高 Gas 单价（wei）',tx.maxFeePerGas],['最高优先费（wei）',tx.maxPriorityFeePerGas],['完整调用数据',tx.data||'0x'],['预估网络费',`${tx.gasFee} ${tx.symbol}`],['总计扣除',`${tx.total} ${tx.symbol}`]];
 return fields.filter(([,value])=>value!==undefined&&value!==null).map(([label,value])=>`<div class="transfer-detail"><span>${esc(label)}</span><b style="overflow-wrap:anywhere">${esc(value)}</b></div>`).join('');
}
