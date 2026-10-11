import './bill-center.css';
import { walletFeeText } from './wallet-fees.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>Number.isFinite(Number(v))?new Date(Number(v)).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'时间未知';
export function collectBills(sources){
  const items=[],errors=[];
  for(const [type,read] of Object.entries(sources).filter(([type])=>type==='chain')){
    try{const rows=read();if(!Array.isArray(rows))throw new Error('记录格式异常');
      for(const r of rows){
        if(type==='chain')items.push({id:r.id||r.hash,type,title:r.kind==='distribution'?r.title||'等额分发操作':'链上转出',amount:r.kind==='distribution'?r.tokenAmount:r.amount,asset:r.kind==='distribution'?r.tokenSymbol:'tBNB',fee:walletFeeText(r),direction:r.kind==='distribution'?(r.action==='fund'?'out':r.action==='claim'?'in':'neutral'):'out',status:r.status==='confirmed'?'链上已确认':r.status==='failed'?'链上执行失败':r.broadcastUncertain||r.status==='unknown'?'广播状态待核实':'等待链上确认',createdAt:r.createdAt,address:r.to,hash:/^0x[a-fA-F0-9]{64}$/.test(r.hash)?r.hash:null,detail:r.kind==='distribution'?'BSC 测试网 · 等额分发操作。显示的是确认时的代币数量，授权不等于转账，提交不代表执行成功，以链上回执为准。':'BSC 测试网 · 本机发起记录。提交不代表到账，以链上确认状态为准。'});
      }
    }catch(e){errors.push({type,message:e.message||'记录读取失败'})}
  }
  return {items:items.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)),errors};
}
export function mountBillCenter(container,{sources,onBack,onRefresh,toast=()=>{}}){
  let filter='all',selected=null,data=collectBills(sources),refreshing=false,destroyed=false;
  const labels={chain:'链上转账'};
  const filters=[['all','全部'],...Object.entries(labels)];
  function render(){
    if(destroyed)return;
    if(selected){const r=selected;container.innerHTML=`<div class="bill-page"><button class="bill-back" data-bill="list">← 返回账单</button><section class="bill-detail card"><span class="bill-tag ${r.type}">${labels[r.type]}</span><h2>${esc(r.title)}</h2><div class="bill-amount">${esc(r.amount??'—')} <small>${esc(r.asset)}</small></div><p>${esc(r.status)}</p><dl><div><dt>记录时间</dt><dd>${esc(date(r.createdAt))}</dd></div><div><dt>网络费用</dt><dd>${esc(r.fee)}</dd></div><div><dt>网络 / 账户</dt><dd>BSC 测试网</dd></div>${r.address?`<div><dt>相关地址</dt><dd>${esc(r.address)}</dd></div>`:''}${r.hash?`<div><dt>交易哈希</dt><dd>${esc(r.hash)}</dd></div>`:''}</dl><div class="notice">${esc(r.detail)}</div>${r.hash?`<a class="primary" target="_blank" rel="noopener noreferrer" href="https://testnet.bscscan.com/tx/${esc(r.hash)}">在 BscScan 查看 ↗</a><button class="secondary" data-bill="refresh" ${refreshing?'disabled':''}>${refreshing?'正在读取链上状态…':'刷新确认状态'}</button>`:''}</section></div>`;return}
    const visible=data.items.filter(r=>filter==='all'||r.type===filter);
    container.innerHTML=`<section class="bill-page"><button class="bill-back" data-bill="back">← 返回</button><div class="bill-heading"><div><p class="eyebrow">转账记录</p><h2>账单中心</h2><p>每一笔记录，清楚有据</p></div><span class="bill-heading-icon">↗</span></div><p class="bill-scope">仅展示当前设备发起的链上交易，完整收支请查看区块浏览器。积分用量在独立积分页面查看。</p><div class="bill-filters" aria-label="账单分类">${filters.map(([key,label])=>`<button class="${filter===key?'active':''}" aria-pressed="${filter===key}" data-bill-filter="${key}">${label}</button>`).join('')}</div>${data.errors.map(e=>`<div class="notice warn" role="alert">${labels[e.type]}读取失败：${esc(e.message)}。原始记录已保留。</div>`).join('')}<div class="bill-list card">${visible.length?visible.map(r=>`<button class="bill-row" data-bill-id="${esc(r.type+':'+r.id)}"><span class="bill-type-icon ${r.type}">↗</span><span class="bill-row-info"><strong>${esc(r.title)}</strong><small>${esc(date(r.createdAt))} · ${labels[r.type]}</small><em>${esc(r.status)}</em></span><span class="bill-row-amount">${r.direction==='out'?'−':r.direction==='in'?'+':''}${esc(r.amount??'—')}<small>${esc(r.asset)}</small><small class="bill-fee">${esc(r.fee)}</small></span></button>`).join(''):`<div class="empty-state"><div class="empty-icon">↗</div><h3>这里还没有${filter==='all'?'记录':labels[filter]}</h3><p>完成测试网转账后，可以在这里核对交易状态。</p></div>`}</div><p class="bill-foot">清除浏览器数据会移除本机记录，链上交易仍可在区块浏览器查询。</p></section>`;
  }
  container.onclick=async e=>{
    const f=e.target.closest('[data-bill-filter]');if(f){filter=f.dataset.billFilter;render();return}
    const row=e.target.closest('[data-bill-id]');if(row){selected=data.items.find(r=>r.type+':'+r.id===row.dataset.billId);render();return}
    const a=e.target.closest('[data-bill]')?.dataset.bill;
    if(a==='back')onBack();if(a==='list'){selected=null;render()}
    if(a==='refresh'&&selected?.hash&&!refreshing){refreshing=true;const hash=selected.hash;render();try{await onRefresh(hash);data=collectBills(sources);selected=data.items.find(r=>r.hash===hash)||selected;toast('已读取链上确认状态')}catch(error){toast(error.message)}finally{refreshing=false;render()}}
  };
  render();return()=>{destroyed=true;container.onclick=null};
}
