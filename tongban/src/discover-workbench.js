import './discover-workbench.css';
import { createAIWorkspace } from './ai-workspace.js';

// Provider and bounty planning remain local; AI cloud requests use their own service component.
export const escapeWorkText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e = escapeWorkText;
const TYPES = ['provider','ai','bounty'];
const TONES = ['自然友好','清晰专业','简短直接','轻松有趣'];
export const PROVIDER_CATEGORIES = ['全部','品牌与设计','社区与运营','技术与合约咨询'];
export const PROVIDER_EXAMPLES = [
  {id:'leaf',name:'青叶设计小组',initial:'叶',category:'品牌与设计',color:'mint',intro:'把一个想法，整理成清楚的视觉语言。',packages:[
    {id:'identity',name:'轻量品牌视觉',period:'交付节奏示例：7–10 天',deliverables:'标志方向 2 组、选定方向精修 1 组、色彩与字体使用说明、可编辑源文件。'},
    {id:'stickers',name:'社区表情设计',period:'交付节奏示例：5–7 天',deliverables:'6 个表情设计、透明底导出图、源文件与使用说明。'},
  ]},
  {id:'bridge',name:'小桥共创小组',initial:'桥',category:'社区与运营',color:'purple',intro:'把群里的共同想法，变成一场有安排的活动。',packages:[
    {id:'event',name:'熟人社区活动方案',period:'交付节奏示例：3–5 天',deliverables:'活动流程、报名信息清单、邀请文案、主持提纲与复盘表。'},
    {id:'guide',name:'社区协作手册',period:'交付节奏示例：5–7 天',deliverables:'群协作约定、角色分工、内容安排和新人指引模板。'},
  ]},
  {id:'field',name:'原野技术小组',initial:'野',category:'技术与合约咨询',color:'blue',intro:'先整理技术边界、依赖与需要验证的问题。',packages:[
    {id:'scope',name:'产品技术需求梳理',period:'交付节奏示例：3–5 天',deliverables:'需求清单、核心流程图、接口范围、技术风险与分阶段验收建议。不包含安全审计或合约部署。'},
    {id:'review',name:'合约咨询需求整理',period:'交付节奏示例：2–3 天',deliverables:'咨询问题清单、待提供材料、权限与资产流转检查项。不包含审计结论或资金安全保证。'},
  ]},
];
export const PROMPT_TEMPLATES = [
  {id:'invite',icon:'✉',label:'社区邀请',tag:'表达',title:'朋友见面会邀请',goal:'邀请熟悉的朋友参加一次小型线下见面会。',audience:'已经认识的社区朋友',tone:'自然友好',deliverable:'一段不超过 200 字的邀请文案，以及时间、地点和参与方式的待填清单。',context:'活动主题、时间、地点尚待补充，请保留占位。'},
  {id:'research',icon:'⌕',label:'研究提纲',tag:'思考',title:'研究问题与验证计划',goal:'围绕一个待研究的主题，整理需要验证的问题和研究顺序。',audience:'准备作出产品决策的小团队',tone:'清晰专业',deliverable:'研究问题表、需查证的信息来源类型和一周内可执行的验证步骤。',context:'主题和已有观察请在这里补充；将事实、假设和待验证问题分开。'},
  {id:'meeting',icon:'≡',label:'会议整理',tag:'协作',title:'会议记录整理提示词',goal:'根据我提供的会议原始记录，提取已达成的决定和行动项。',audience:'本次会议参与者',tone:'简短直接',deliverable:'按决定、行动项、负责人、截止日、待确认问题分组；未提及的信息标记待确认。',context:'在这里粘贴去除敏感信息后的会议记录。'},
  {id:'product',icon:'◇',label:'产品构思',tag:'思考',title:'最小版本需求梳理',goal:'将一个产品想法整理成可以验证的最小版本范围。',audience:'个人创业者与协作伙伴',tone:'清晰专业',deliverable:'目标用户、关键问题、最小闭环、暂缓功能、验收条件与风险假设。',context:'补充你观察到的问题、目标用户和可用时间。'},
  {id:'feedback',icon:'♡',label:'反馈归纳',tag:'协作',title:'用户反馈归纳提示词',goal:'根据原始反馈整理重复问题与待验证的改进方向。',audience:'需要安排下一轮迭代的产品团队',tone:'清晰专业',deliverable:'按问题分组，保留原文依据、影响范围、优先级理由；不要编造样本数量。',context:'在这里粘贴去除个人资料的反馈原文。'},
  {id:'brief',icon:'⚑',label:'任务说明',tag:'表达',title:'任务交付说明提示词',goal:'把任务目标改写成执行者能理解、发起者能验收的任务说明。',audience:'已经认识的协作伙伴',tone:'简短直接',deliverable:'任务背景、交付清单、文件规格、验收标准、时间安排和需要确认的问题。',context:'补充任务背景与已有材料；不自行添加承诺或预算。'},
];
export const BOUNTY_TEMPLATES = [
  {id:'design',icon:'✳',label:'视觉设计',title:'设计一套社区活动海报',details:'为一次社区活动设计主海报和适配手机的分享图，提供可编辑源文件与导出图片。',acceptance:'文字信息与确认稿一致；尺寸清晰标注；交付源文件可打开；素材使用范围说明完整。',count:'1',duration:'7 天'},
  {id:'content',icon:'≡',label:'内容整理',title:'整理一份社区新人指南',details:'根据已有群资料和常见问题，整理结构清楚的新人成员指南，附相关信息来源。',acceptance:'包含加入方式、群协作约定与常见问题；链接可打开；未经确认的信息标注待确认。',count:'1',duration:'7 天'},
  {id:'testing',icon:'✓',label:'体验反馈',title:'邀请朋友完成一次产品体验',details:'按指定任务走完产品主要流程，记录遇到的问题，提供复现步骤与截图。',acceptance:'每人提交独立反馈；覆盖约定流程；问题有步骤和预期结果；截图不包含个人敏感资料。',count:'3',duration:'3 天'},
];

const text = (value,max,label,{required=false,min=1}={}) => {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && result.length < min) || result.length > max) throw new Error(`${label}需为 ${min}–${max} 个字符。`);
  return result;
};
export function parseWorkUsd(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value.trim())) throw new Error('预算需为大于 0、最多两位小数的 USDT 金额。');
  const [whole,fraction=''] = value.trim().split('.');
  const cents = BigInt(whole)*100n + BigInt(fraction.padEnd(2,'0'));
  if (cents <= 0n) throw new Error('预算需大于 0 USDT。');
  return cents;
}
export const formatWorkUsd = cents => `${BigInt(cents)/100n}.${String(BigInt(cents)%100n).padStart(2,'0')}`;
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const afterDays = days => {const date = new Date();date.setDate(date.getDate()+days);return localDate(date);};
function validateDate(value,label,today = localDate()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value) throw new Error(`请选择有效的${label}。`);
  if (value < today) throw new Error(`${label}不能早于今天。`);
  return value;
}
export function buildStructuredPrompt(input) {
  const goal=text(input.goal,400,'目标',{required:true});
  const audience=text(input.audience,160,'对象',{required:true});
  const deliverable=text(input.deliverable,500,'交付要求',{required:true});
  const context=text(input.context,500,'背景');
  if (!TONES.includes(input.tone)) throw new Error('请选择工作台提供的语气。');
  const result=`任务目标：\n${goal}\n\n面向对象：\n${audience}\n\n表达语气：\n${input.tone}\n\n交付要求：\n${deliverable}${context?`\n\n背景与材料：\n${context}`:''}\n\n请先指出缺少的信息；不要虚构事实、来源或已完成的结果。`;
  if (result.length>2000) throw new Error('组合提示词超过 2000 字，请精简内容。');
  return result;
}
export function bountySettlement(input) {
  const total = parseWorkUsd(input.reward);
  if (!/^[1-9]\d?$|^100$/.test(String(input.count ?? ''))) throw new Error('计划人数需为 1–100 的整数。');
  const count = BigInt(input.count);
  if (total<count) throw new Error('总预算至少应为每人 0.01 USDT。');
  const base=total/count,remainder=total%count;
  return {total:formatWorkUsd(total),count:Number(count),base:formatWorkUsd(base),higher:formatWorkUsd(base+1n),higherCount:Number(remainder),baseCount:Number(count-remainder),settlement:'独立服务协议',frozen:false,paid:false};
}
export function validateWorkbenchDraft(type,input,{today=localDate()}={}) {
  if (!TYPES.includes(type)) throw new Error('工作台草稿类型无效。');
  const out={title:text(input.title,80,'名称',{required:true})};
  if (type==='ai') {
    out.prompt=text(input.prompt,2000,'提示词',{required:true,min:5});
    for (const [key,max,label] of [['goal',400,'目标'],['audience',160,'对象'],['deliverable',500,'交付要求'],['context',500,'背景']]) out[key]=text(input[key],max,label);
    out.tone=TONES.includes(input.tone)?input.tone:'自然友好';
    out.templateId=PROMPT_TEMPLATES.some(t=>t.id===input.templateId)?input.templateId:'';
    out.mode='本机模板整理，未调用AI';
  } else {
    out.details=text(input.details,2000,'需求说明',{required:true,min:10});
    if (type==='provider') {
      if (!PROVIDER_CATEGORIES.slice(1).includes(input.category)) throw new Error('请选择服务类别。');
      out.category=input.category;
      out.budget=text(input.budget,20,'预算');if(out.budget)out.budget=formatWorkUsd(parseWorkUsd(out.budget));
      out.date=text(input.date,10,'期望日期');if(out.date)validateDate(out.date,'期望日期',today);
      out.deliverables=text(input.deliverables,1000,'交付清单');
      const provider=PROVIDER_EXAMPLES.find(p=>p.id===input.providerId),pack=provider?.packages.find(p=>p.id===input.packageId);
      if ((input.providerId || input.packageId) && !pack) throw new Error('示例服务组合已失效，请重新选择。');
      if (pack && provider.category!==out.category) throw new Error('所选套餐与服务类别不一致，请取消选择或重新选择套餐。');
      if(pack)Object.assign(out,{providerId:provider.id,providerName:provider.name,packageId:pack.id,packageName:pack.name,verification:'示例团队 · 未认证'});
    } else {
      out.acceptance=text(input.acceptance,1500,'验收标准',{required:true,min:10});
      out.reward=formatWorkUsd(parseWorkUsd(input.reward));
      out.count=String(input.count ?? '');bountySettlement(out);
      out.deadline=validateDate(text(input.deadline,10,'截止日期',{required:true}), '截止日期',today);
      out.duration=['3 天','7 天','14 天','30 天'].includes(input.duration)?input.duration:'7 天';
      out.templateId=BOUNTY_TEMPLATES.some(t=>t.id===input.templateId)?input.templateId:'';
      out.distribution='总预算等分预览';
    }
  }
  return {...out,status:type==='bounty'?'未发布':'未提交',settlement:'独立服务协议'};
}
export function workbenchDraftStats(drafts) {
  const lists=Object.fromEntries(TYPES.map(type=>[type,[]]));
  const seen=new Set();
  for(const draft of Array.isArray(drafts)?drafts:[]) {
    if (!draft || !TYPES.includes(draft.type) || typeof draft.id!=='string' || !draft.values || typeof draft.values!=='object' || Array.isArray(draft.values) || draft.archivedAt || seen.has(draft.id)) continue;
    seen.add(draft.id);lists[draft.type].push({...draft,values:{...draft.values}});
  }
  let budget=0n;for(const draft of lists.bounty){try{budget+=parseWorkUsd(draft.values.reward);}catch{/* A malformed legacy budget is not included in the plan total. */}}
  return {lists,provider:lists.provider.length,ai:lists.ai.length,bounty:lists.bounty.length,total:seen.size,bountyBudget:formatWorkUsd(budget)};
}

const symbols={back:'m14 5-7 7 7 7',arrow:'M5 12h14m-6-6 6 6-6 6',file:'M5 3h9l5 5v13H5ZM14 3v6h5M9 13h6M9 17h4',spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',copy:'M8 8h13v13H8ZM16 8V3H3v13h5',check:'m5 12 4 4L19 6',wallet:'M3 6h17v15H3ZM3 6V3h14v3m3 6h-6v5h6'};
const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${symbols[name]||symbols.spark}"/></svg>`;
const btn=(label,action,cls='work-secondary',attrs='')=>`<button type="button" class="${cls}" data-disc="w-${action}" ${attrs}>${label}</button>`;
const input=(label,name,value='',placeholder='',attrs='')=>`<label class="work-field"><span>${label}</span><input name="${name}" value="${e(value)}" placeholder="${e(placeholder)}" ${attrs}></label>`;
const area=(label,name,value='',placeholder='',attrs='')=>`<label class="work-field"><span>${label}</span><textarea name="${name}" ${!label?'aria-label="最终提示词"':''} placeholder="${e(placeholder)}" ${attrs}>${e(value)}</textarea></label>`;
const select=(label,name,value,options)=>`<label class="work-field"><span>${label}</span><select name="${name}">${options.map(x=>`<option value="${e(x)}" ${x===value?'selected':''}>${e(x)}</option>`).join('')}</select></label>`;
const hidden=(name,value)=>`<input type="hidden" name="${name}" value="${e(value)}">`;
const errorBox='<p class="work-error" role="alert"></p>';
const localNote=copy=>`<p class="work-local-note">${svg('file')}${copy}</p>`;
const timeLabel=draft=>Number.isFinite(draft.updatedAt||draft.createdAt)?new Date(draft.updatedAt||draft.createdAt).toLocaleDateString('zh-CN'):'本机保存';

export function createDiscoveryWorkbench(ctx) {
  let dead=false,category='全部',aiCategory='全部',local={},pendingPreview=null;
  const buffers=new Map();
  const aiWorkspace=createAIWorkspace({socialClient:ctx.socialClient,onAccount:ctx.onAccount,render:()=>ctx.render(),toast:message=>ctx.toast(message),renderLocal:aiPage,getLocalDraft:()=>sync('ai')});
  const readDraft=type=>ctx.getDraft(type)||{};
  const draftKey=type=>JSON.stringify([type,ctx.getDraftKey?.(type)||type]);
  function sync(type) {
    const source=readDraft(type),signature=JSON.stringify(source),key=draftKey(type);
    let buffer=buffers.get(key);
    if(!buffer||buffer.signature!==signature){
      const defaults=type==='provider'?{category:'品牌与设计'}:type==='ai'?{tone:'自然友好'}:{count:'1',duration:'7 天',deadline:afterDays(Number.parseInt(source.duration)||7)};
      buffer={signature,values:{...defaults,...source}};
      buffers.set(key,buffer);
    }
    local[type]=buffer.values;
    return buffer.values;
  }
  function setLocal(type,values){sync(type);buffers.get(draftKey(type)).values=values;local[type]=values;return values;}
  const stats=()=>workbenchDraftStats(ctx.getDrafts());
  const formValues=form=>Object.fromEntries(new FormData(form));
  function capture(form){const type=form?.dataset.workForm;if(TYPES.includes(type))return setLocal(type,{...sync(type),...formValues(form)});return null;}
  function validated(type,values){return ctx.validateDraft(type,validateWorkbenchDraft(type,values));}
  function fail(error,form){const node=form?.querySelector('.work-error');if(node)node.textContent=error.message;else ctx.toast(error.message);}
  function save(type,values){
    const previousKey=draftKey(type);
    ctx.saveDraft(type,validated(type,values));
    // Saving a new draft assigns its persistent ID and may render synchronously.
    // Only retire the former new-draft buffer after persistence succeeds.
    if(previousKey!==draftKey(type))buffers.delete(previousKey);
    sync(type);
  }
  function draftRows(type,limit=3) {
    const entries=stats().lists[type].slice(0,limit);
    return entries.length?`<div class="work-draft-rows">${entries.map(d=>`<button type="button" data-disc="w-edit" data-id="${e(d.id)}" data-type="${type}"><span class="work-small-icon">${svg('file')}</span><span><strong>${e(d.values.title||'未命名草稿')}</strong><small>${type==='bounty'?'未发布':'未提交'} · 本机草稿 · ${e(timeLabel(d))}</small></span>${svg('arrow')}</button>`).join('')}</div>`:`<div class="work-empty">${svg('file')}<span>还没有${type==='bounty'?'任务':type==='ai'?'提示词':'预约'}草稿。保存后会出现在这里。</span></div>`;
  }
  function providerPage() {
    const d=sync('provider'),selected=PROVIDER_EXAMPLES.find(p=>p.id===d.providerId),pack=selected?.packages.find(p=>p.id===d.packageId);
    return `<section class="work-workbench work-provider"><div class="work-intro"><span class="work-feature mint">✳</span><div><h3>先找到合作的方向</h3><p>浏览服务示例，把交付目标和预算说清楚。</p></div><span class="work-badge">服务筹备中</span></div><div class="work-inline-note">以下均为<b>示例团队 · 未认证</b>，用于准备需求，尚未开放真实预约。</div><div class="work-tabs" aria-label="服务类别">${PROVIDER_CATEGORIES.map(x=>btn(e(x),'provider-filter',`work-tab ${category===x?'active':''}`,`data-category="${e(x)}" aria-pressed="${category===x}"`)).join('')}</div><div class="work-provider-grid">${PROVIDER_EXAMPLES.filter(p=>category==='全部'||category===p.category).map(p=>`<button class="work-provider-card" type="button" data-disc="w-provider-detail" data-id="${p.id}"><span class="work-provider-top"><span class="work-team-mark ${p.color}">${p.initial}</span><span><strong>${p.name}</strong><small>示例 · 未认证</small></span>${svg('arrow')}</span><span class="work-category-label">${p.category}</span><p>${p.intro}</p><span class="work-card-foot">${p.packages.length} 个交付套餐示例 <span>查看清单</span></span></button>`).join('')}</div><div class="work-section-label"><h3>我的预约意向</h3><span>${stats().provider} 份本机草稿</span></div><form class="work-form" data-work-form="provider">${pack?`<div class="work-selection"><span class="work-team-mark ${selected.color}">${selected.initial}</span><span><strong>${e(pack.name)}</strong><small>${e(selected.name)} · 示例团队，未认证</small></span>${btn('取消选择','provider-clear','work-text')}</div>`:'<p class="work-form-hint">可选一个示例套餐，也可以直接填写自己的需求。</p>'}${hidden('providerId',d.providerId||'')}${hidden('packageId',d.packageId||'')}${select('服务类别','category',d.category,PROVIDER_CATEGORIES.slice(1))}${input('需求名称','title',d.title,'例如：社区活动品牌视觉','required maxlength="80"')}${area('目标与背景','details',d.details,'想解决什么问题，已有材料有哪些？','required minlength="10" maxlength="2000" rows="4"')}${area('交付清单','deliverables',d.deliverables,'需要哪些文件、版本或可编辑素材？','maxlength="1000" rows="3"')}<div class="work-two">${input('计划预算 · USDT（选填）','budget',d.budget,'通过合作双方约定结算','inputmode="decimal" maxlength="9"')}${input('期望沟通日期（选填）','date',d.date,'','type="date" min="'+localDate()+'"')}</div>${errorBox}<button class="work-primary" type="submit">保存预约意向 ${svg('arrow')}</button>${localNote('仅保存到本机，未发送给团队、未预约、未扣款。')}</form><details class="work-saved-list"><summary>已保存的预约意向 <span>${stats().provider}</span></summary>${draftRows('provider')}</details></section>`;
  }
  function aiPage() {
    const d=sync('ai');
    return `<section class="work-workbench work-ai"><p class="ai-muted">本机模板整理，未调用 AI。保存草稿不会发送任何请求。</p><form class="work-form" data-work-form="ai">${hidden('templateId',d.templateId||'')}${input('草稿名称','title',d.title,'给这次工作起个名字','required maxlength="80"')}<div class="work-prompt-label"><strong>提示词</strong><span data-work-char>${(d.prompt||'').length} / 2000</span></div>${area('','prompt',d.prompt,'输入你的任务要求，或展开模板辅助填写。','required minlength="5" maxlength="2000" rows="5"')}<details class="ai-local-options"><summary>选择模板或分步整理</summary><div class="work-tabs" aria-label="提示词模板类别">${['全部','表达','思考','协作'].map(x=>btn(x,'ai-filter',`work-tab ${aiCategory===x?'active':''}`,`data-category="${x}" aria-pressed="${aiCategory===x}"`)).join('')}</div><div class="work-template-grid">${PROMPT_TEMPLATES.filter(t=>aiCategory==='全部'||t.tag===aiCategory).map(t=>`<button type="button" data-disc="w-ai-template" data-id="${t.id}"><span>${t.icon}</span><strong>${t.label}</strong><small>${t.tag} ${svg('arrow')}</small></button>`).join('')}</div>${area('希望完成什么','goal',d.goal,'写清这次目标','maxlength="400" rows="2"')}<div class="work-two">${input('给谁看','audience',d.audience,'例如：社区朋友','maxlength="160"')}${select('表达语气','tone',d.tone,TONES)}</div>${area('交付要求','deliverable',d.deliverable,'格式与长度要求','maxlength="500" rows="2"')}${area('背景与材料（选填）','context',d.context,'不要填入助记词或私钥','maxlength="500" rows="2"')}${btn('组合提示词','ai-compose','work-secondary')}</details>${errorBox}<div class="work-actions"><button type="submit" class="work-primary">保存草稿</button>${btn('复制提示词','ai-copy','work-secondary')}</div></form><details class="work-saved-list"><summary>已保存的提示词 <span>${stats().ai}</span></summary>${draftRows('ai')}</details></section>`;
  }
  function bountyPage() {
    const d=sync('bounty'),count=stats();
    return `<section class="work-workbench work-bounty"><div class="work-intro"><span class="work-feature peach">⚑</span><div><h3>把任务交代清楚</h3><p>明确交付、验收与预算，方便之后一起协作。</p></div></div><div class="work-task-overview"><div><small>我的任务草稿</small><strong>${count.bounty}<span> 份</span></strong></div><div><small>计划总预算 · USDT</small><strong>${count.bountyBudget}</strong></div><span>未发布 · 未冻结</span></div>${draftRows('bounty')}<div class="work-section-label"><h3>从一个任务模板开始</h3><span>可修改</span></div><div class="work-bounty-templates">${BOUNTY_TEMPLATES.map(t=>btn(`<span>${t.icon}</span>${t.label}`,'bounty-template','work-template-pill',`data-id="${t.id}"`)).join('')}</div><form class="work-form" data-work-form="bounty"><div class="work-form-heading"><h3>准备任务说明</h3><span>本机草稿</span></div>${hidden('templateId',d.templateId||'')}${input('任务名称','title',d.title,'例如：为朋友活动做一套海报','required maxlength="80"')}${area('交付内容与规格','details',d.details,'写清要做什么、交付什么文件，以及使用范围。','required minlength="10" maxlength="2000" rows="4"')}${area('怎样算完成','acceptance',d.acceptance,'列出可核对的验收标准，避免只写「满意为止」。','required minlength="10" maxlength="1500" rows="4"')}<div class="work-two">${input('总预算 · USDT','reward',d.reward,'例如：100.00','required inputmode="decimal" maxlength="9"')}${input('计划人数','count',d.count,'1–100 人','required inputmode="numeric" maxlength="3"')}</div><div class="work-two">${select('准备周期','duration',d.duration,['3 天','7 天','14 天','30 天'])}${input('计划截止日','deadline',d.deadline,'','required type="date" min="'+localDate()+'"')}</div><div class="work-budget-line"><span>${svg('wallet')}报酬由合作双方自行约定</span><strong data-work-budget>${budgetLabel(d)}</strong></div><p class="work-form-hint">按人数等分预览预算；截止日可自行调整。平台服务费待开放前说明，不计入当前预览。</p>${errorBox}<div class="work-actions"><button class="work-primary" type="submit">保存任务草稿</button>${btn('预览任务与结算','bounty-preview','work-secondary')}</div>${localNote('当前只保存需求，不会招募、发布或处理付款。请勿把草稿当作已接单任务。')}</form></section>`;
  }
  function budgetLabel(values){try{const p=bountySettlement(values);return `${p.count} 人 · 总计 ${p.total} USDT`;}catch{return '填写预算和人数后预览';}}
  function providerDetail(id) {
    const p=PROVIDER_EXAMPLES.find(x=>x.id===id);if(!p)throw new Error('服务示例不存在。');
    ctx.showDialog(`${p.name} · 服务示例`,`<div class="work-dialog-content"><p class="work-inline-note">示例团队 · 未认证 · 尚未接受预约</p><p class="work-dialog-intro">${p.intro}</p>${p.packages.map(pack=>`<article class="work-package"><small>${p.category}</small><h3>${pack.name}</h3><p>${pack.deliverables}</p><span>${pack.period}，不是交付承诺</span>${btn('将套餐带入需求','provider-pick','work-primary',`data-id="${p.id}" data-package="${pack.id}"`)}</article>`).join('')}<p class="work-form-hint">尚无真实报价。预算由你填写，服务开放后确认方案，费用仅通过合作双方约定结算。</p></div>`);
  }
  function templateDialog(type,id) {
    const template=(type==='ai'?PROMPT_TEMPLATES:BOUNTY_TEMPLATES).find(t=>t.id===id);if(!template)throw new Error('模板不存在。');
    const preview=type==='ai'?buildStructuredPrompt(template):`${template.details}\n\n验收标准：\n${template.acceptance}`;
    ctx.showDialog(`${template.label}模板`,`<div class="work-dialog-content"><p class="work-form-hint">应用后会替换当前未保存的${type==='ai'?'提示词内容':'任务说明'}，已保存的草稿不受影响。</p><h3>${e(template.title)}</h3><pre class="work-template-preview">${e(preview)}</pre>${btn('使用这个模板',`${type}-apply`,'work-primary',`data-id="${template.id}"`)}${localNote(type==='ai'?'这是预设提示词，尚未调用 AI。':'预算保留当前填写值，请根据任务自行设置。')}</div>`);
  }
  function previewBounty(values) {
    const v=validated('bounty',values),p=bountySettlement(v);pendingPreview=v;
    const split=p.higherCount?`${p.higher} USDT × ${p.higherCount} 人，${p.base} USDT × ${p.baseCount} 人`:`每人 ${p.base} USDT × ${p.count} 人`;
    ctx.showDialog('任务与结算预览',`<div class="work-dialog-content"><span class="work-badge">未发布 · 未冻结 · 未扣款</span><h3>${e(v.title)}</h3><dl class="work-preview-details"><dt>交付内容</dt><dd>${e(v.details)}</dd><dt>验收标准</dt><dd>${e(v.acceptance)}</dd><dt>计划截止日</dt><dd>${e(v.deadline)}</dd></dl><div class="work-preview-money"><small>计划总预算</small><strong>${p.total}<span> USDT</span></strong><p>${split}</p><span>报酬由合作双方自行约定</span></div><ol class="work-flow"><li><b>发布时</b><span>确认任务、费用与预留预算</span></li><li><b>交付后</b><span>依据约定标准验收</span></li><li><b>验收通过</b><span>按确认规则结算给完成者</span></li></ol><p class="work-form-hint">以上是计划流程，尚未启用；实际费用与结算规则会在提交前确认。</p><p class="work-error" role="alert"></p>${btn('保存这份任务草稿','bounty-save-preview','work-primary')}<button type="button" class="work-disabled" disabled>发布并支付 · 尚未开放</button></div>`);
  }
  function handleAction(action,target) {
    if(!dead&&aiWorkspace.handleAction(action,target))return true;
    if(dead||!action?.startsWith('w-'))return false;
    const form=target?.closest?.('[data-work-form]');
    try {
      if(form)capture(form);
      const id=target?.dataset?.id;
      if(action==='w-provider-filter'){category=PROVIDER_CATEGORIES.includes(target.dataset.category)?target.dataset.category:'全部';ctx.render();}
      else if(action==='w-ai-filter'){aiCategory=['全部','表达','思考','协作'].includes(target.dataset.category)?target.dataset.category:'全部';ctx.render();}
      else if(action==='w-provider-detail')providerDetail(id);
      else if(action==='w-provider-pick'){
        const p=PROVIDER_EXAMPLES.find(x=>x.id===id),pack=p?.packages.find(x=>x.id===target.dataset.package);if(!pack)throw new Error('服务示例不存在。');
        const old=sync('provider');setLocal('provider',{...old,providerId:p.id,packageId:pack.id,category:p.category,title:old.title||pack.name,details:old.details||`希望围绕当前项目开展${pack.name}，请根据项目背景确认交付范围与时间。`,deliverables:pack.deliverables});
        ctx.closeDialog();ctx.render();ctx.toast('已带入示例套餐，请完善需求后保存');
      } else if(action==='w-provider-clear'){setLocal('provider',{...sync('provider'),providerId:'',packageId:''});ctx.render();}
      else if(action==='w-ai-template')templateDialog('ai',id);
      else if(action==='w-bounty-template')templateDialog('bounty',id);
      else if(action==='w-ai-apply'){
        const t=PROMPT_TEMPLATES.find(x=>x.id===id);if(!t)throw new Error('模板不存在。');
        setLocal('ai',{...sync('ai'),...t,templateId:t.id,prompt:buildStructuredPrompt(t)});ctx.closeDialog();ctx.render();
      } else if(action==='w-bounty-apply'){
        const t=BOUNTY_TEMPLATES.find(x=>x.id===id);if(!t)throw new Error('模板不存在。');
        setLocal('bounty',{...sync('bounty'),...t,templateId:t.id,deadline:afterDays(Number.parseInt(t.duration))});ctx.closeDialog();ctx.render();
      } else if(action==='w-ai-compose'){
        const d=sync('ai');d.prompt=buildStructuredPrompt(d);if(!d.title)d.title=d.goal.slice(0,80);ctx.render();ctx.toast('已按填写的信息组合提示词，未调用 AI');
      } else if(action==='w-ai-copy'){
        const prompt=text(sync('ai').prompt,2000,'提示词',{required:true,min:5});
        if(!globalThis.navigator?.clipboard?.writeText){form?.querySelector('[name=prompt]')?.select();ctx.toast('当前浏览器不支持自动复制，请选中文字手动复制');}
        else navigator.clipboard.writeText(prompt).then(()=>{if(!dead)ctx.toast('提示词已复制，未发送到 AI 服务');},()=>{if(!dead)ctx.toast('复制未成功，请选中文字手动复制');});
      } else if(action==='w-bounty-preview')previewBounty(sync('bounty'));
      else if(action==='w-bounty-save-preview'){
        if(!pendingPreview)throw new Error('请重新预览任务。');save('bounty',pendingPreview);pendingPreview=null;ctx.closeDialog();
      } else if(action==='w-edit'){
        const draft=stats().lists[target.dataset.type]?.find(x=>x.id===id);if(!draft)throw new Error('这份草稿已不存在。');
        ctx.go(draft.type,{draftId:draft.id});
      }
      else return false;
    } catch(error){fail(error,form||target?.closest?.('.work-dialog-content'));}
    return true;
  }
  function handleSubmit(event){if(!dead&&aiWorkspace.handleSubmit(event))return true;const form=event.target?.closest?.('[data-work-form]'),type=form?.dataset.workForm;if(dead||!TYPES.includes(type))return false;event.preventDefault();try{save(type,capture(form));}catch(error){fail(error,form);}return true;}
  function handleInput(event){if(!dead)aiWorkspace.handleInput(event);const form=event.target?.closest?.('[data-work-form]'),type=form?.dataset.workForm;if(dead||!TYPES.includes(type))return;capture(form);const error=form.querySelector('.work-error');if(error)error.textContent='';if(type==='ai'){const count=form.querySelector('[data-work-char]');if(count)count.textContent=`${(local.ai.prompt||'').length} / 2000`;}if(type==='bounty'){if(event.target.name==='duration'){local.bounty.deadline=afterDays(Number.parseInt(local.bounty.duration)||7);const deadline=form.querySelector('[name=deadline]');if(deadline)deadline.value=local.bounty.deadline;}const total=form.querySelector('[data-work-budget]');if(total)total.textContent=budgetLabel(local.bounty);}}
  return {render(route){if(dead||!TYPES.includes(route))return null;aiWorkspace.routeChanged(route);return route==='provider'?providerPage():route==='ai'?aiWorkspace.render():bountyPage();},routeChanged:route=>aiWorkspace.routeChanged(route),handleAction,handleSubmit,handleInput,cleanup(){dead=true;aiWorkspace.cleanup();local={};buffers.clear();pendingPreview=null;}};
}
