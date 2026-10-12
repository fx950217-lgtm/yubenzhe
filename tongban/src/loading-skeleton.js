const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={messages:'正在读取消息',devices:'正在读取设备',tasks:'正在读取任务',wallet:'正在读取链上资产'};
// Pure markup: the application imports loading-skeleton.css once. No fake data,
// focusable controls, timers, or account information belong in a placeholder.
export function loadingSkeleton(kind,{rows=3,label=labels[kind]}={}){
 if(!Object.hasOwn(labels,kind))throw Error('Unknown loading skeleton.');
 const count=Number.isInteger(rows)?Math.max(1,Math.min(rows,6)):3;
 const row='<div class="ybz-skeleton-row" aria-hidden="true"><span class="ybz-skeleton-block ybz-skeleton-tile"></span><span class="ybz-skeleton-copy"><span class="ybz-skeleton-block ybz-skeleton-title"></span><span class="ybz-skeleton-block ybz-skeleton-line"></span>'+(kind==='devices'||kind==='tasks'?'<span class="ybz-skeleton-block ybz-skeleton-short"></span>':'')+'</span>'+(kind==='wallet'||kind==='messages'?'<span class="ybz-skeleton-block ybz-skeleton-meta"></span>':'')+'</div>';
 return '<div class="ybz-skeleton ybz-skeleton-'+kind+'" data-loading-skeleton="'+kind+'" role="status" aria-live="polite" aria-busy="true" aria-label="'+escape(label||labels[kind])+'"><span class="ybz-skeleton-label">'+escape(label||labels[kind])+'</span>'+row.repeat(count)+'</div>';
}
