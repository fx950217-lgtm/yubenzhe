import './discover.css';
import { saveJsonFile } from './native-runtime.js';
import './discover-v5.css';
import { createLiveMomentsFeature } from './live-moments.js';
import { createDiscoveryWorkbench } from './discover-workbench.js';
import { createTokenStudio } from './discover-token.js';
import { getAddress } from 'ethers';
import { getSocialPeople, getSocialShareTargets, shareMomentToChat } from './social.js';
import { getLocalProfile } from './profile-store.js';

const STORE = 'tongban.discover.v1';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID();
const paths = {
  arrow:'M5 12h14m-6-6 6 6-6 6', back:'m14 5-7 7 7 7', close:'m6 6 12 12M6 18 18 6',
  spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  moment:'M20 11a8 8 0 1 1-8-8M16 3h5v5M14 10l7-7',
  wallet:'M4 6h14v3M4 6a2 2 0 0 0-2 2v11h19V9H4m17 3h-6v4h6',
  shield:'m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6Zm-4 8 3 3 5-5',
  ai:'m12 3 2 6 6 2-6 2-2 6-2-6-6-2 6-2ZM20 3v4M18 5h4',
  flag:'M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0',
  rank:'M5 21V12h5v9m4 0V6h5v15M3 21h18M6 6l4-3 4 1 5-3',
  rocket:'M14 4c2-1 5-1 7-1 0 3 0 5-2 8l-7 7-6-6Zm-2 14-1 4-3-3M6 12l-4-1 4-4 5-1M4 17l-2 5 5-2M15 8h.1',
  lock:'M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3',
  heart:'M20 5c-3-3-7-1-8 2-1-3-5-5-8-2-4 5 1 9 8 15 7-6 12-10 8-15Z',
  chat:'M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM7 10h10M7 14h6',
  share:'m14 3 7 7-7 7M21 10H9a6 6 0 0 0-6 6v5',
  image:'M3 4h18v16H3Zm0 12 5-5 5 5 4-4 4 4M15 8h.1',
  plus:'M12 5v14M5 12h14', check:'m5 12 4 4L19 6',
  file:'M5 3h9l5 5v13H5ZM14 3v6h5M9 13h6M9 17h4',
  briefcase:'M3 7h18v14H3ZM8 7V3h8v4M3 12h18M10 12v3h4v-3',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
const names = { provider:'服务预约意向', ai:'AI 工作草稿', bounty:'悬赏任务草稿', token:'发币草稿', integration:'余额接入申请', business:'商务需求' };
const routes = new Set(['hub','services','moments','rank','provider','ai','bounty','token','integration','business','drafts','token-projects']);
const draftStatus = type => type === 'token' ? '未部署' : type === 'bounty' ? '未发布' : '未提交';
const draftTime = draft => draft.updatedAt || draft.createdAt;
const draftTitle = draft => draft.values.title || draft.values.name || names[draft.type];
const draftGroup = draft => ['token','integration'].includes(draft.type) ? 'token' : 'work';
const normalizedRoute = route => routes.has(route) ? route : 'hub';
const relativeTime = timestamp => {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : minutes < 1440 ? `${Math.floor(minutes / 60)} 小时前` : new Date(timestamp).toLocaleDateString('zh-CN');
};
const color = value => ['mint','purple','blue','peach'].includes(value) ? value : 'mint';
const avatar = person => `<span class="disc-avatar ${color(person?.color)} ${person?.isSelf?'disc-profile-avatar':''}">${esc(person?.initial || '我')}</span>`;
function ownPerson(profile) {
  return { id:'me',name:profile.nickname || '我',initial:profile.avatar || '我',bio:profile.bio || '',color:'purple',isFriend:true,isSelf:true };
}

function seedDiscover() {
  const now = Date.now();
  return { version:1, rankConsent:false, savedPostIds:[], drafts:[], posts:[
    { id:'moment-lin', authorId:'lin', text:'忙碌之外，也要留一点时间给朋友。周六的咖啡已经安排上了 ☕', images:[], createdAt:now-38*60000, likes:['ke'], comments:[] },
    { id:'moment-ke', authorId:'ke', text:'今天的小确幸：一个喜欢的配色，和一群聊得来的朋友。🌿', images:[], createdAt:now-3*3600000, likes:['lin','zhou'], comments:[] },
    { id:'moment-zhou', authorId:'zhou', text:'新的一周，慢一点也没关系。把想做的事一点点做出来。', images:[], createdAt:now-22*3600000, likes:[], comments:[] },
  ] };
}

function safeImageData(value) {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100) return false;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  try {
    const bytes = atob(match[2].slice(0, 32));
    if (match[1] === 'image/jpeg') return bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(2) === 255;
    if (match[1] === 'image/png') return bytes.startsWith('\x89PNG\r\n\x1a\n');
    return bytes.startsWith('RIFF') && bytes.slice(8,12) === 'WEBP';
  } catch { return false; }
}

function readDiscover(storage = localStorage) {
  const raw = storage.getItem(STORE);
  if (!raw) {
    const initial = seedDiscover();
    // Read only the known V1 social post field. Never change the old social key.
    try {
      const old = JSON.parse(storage.getItem('tongban.social.demo.v1'));
      if (Array.isArray(old?.posts)) {
        const legacy = old.posts.filter(p => p && typeof p.text === 'string' && p.text.trim()).slice(0,30).map((p,i) => {
          const text = p.text.slice(0,800);
          let hash = 2166136261;
          for (const character of `${i}|${text}|${p.time || ''}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
          return { id:`legacy-${i}-${hash.toString(16)}`, authorId:'me',text,images:[],createdAt:Date.now()-i,migrated:true,likes:[],comments:[] };
        });
        initial.posts = [...legacy,...initial.posts];
      }
    } catch { /* A corrupt unrelated V1 record must not be overwritten. */ }
    return initial;
  }
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('本机发现数据无法读取，请先保留浏览器数据，不要继续覆盖。'); }
  if (data?.version !== 1 || !Array.isArray(data.posts) || !Array.isArray(data.drafts)) throw new Error('本机发现数据格式异常，暂时无法保存。');
  return {
    version:1, rankConsent:data.rankConsent === true,
    savedPostIds:Array.isArray(data.savedPostIds)?[...new Set(data.savedPostIds.filter(id=>typeof id==='string'&&id.length<=100))].slice(0,100):[],
    posts:data.posts.slice(0,40).filter(p => p && typeof p.id === 'string' && typeof p.authorId === 'string' && typeof p.text === 'string' && Number.isFinite(p.createdAt)).map(p => ({
      id:p.id.slice(0,100), authorId:p.authorId.slice(0,100), text:p.text.slice(0,800), createdAt:p.createdAt,migrated:p.migrated===true,audience:p.audience==='self'?'self':'friends',updatedAt:Number.isFinite(p.updatedAt)?p.updatedAt:p.createdAt,archivedAt:Number.isFinite(p.archivedAt)&&p.archivedAt>0?p.archivedAt:null,
      images:Array.isArray(p.images) ? p.images.filter(safeImageData).slice(0,3) : [],
      likes:Array.isArray(p.likes) ? [...new Set(p.likes.filter(x => typeof x === 'string'))].slice(0,100) : [],
      comments:Array.isArray(p.comments) ? p.comments.filter(c => c && typeof c.text === 'string' && typeof c.authorId === 'string').slice(-50).map(c => ({ id:String(c.id).slice(0,100), authorId:c.authorId.slice(0,100), text:c.text.slice(0,300),createdAt:Number.isFinite(c.createdAt)?c.createdAt:p.createdAt,archivedAt:Number.isFinite(c.archivedAt)&&c.archivedAt>0?c.archivedAt:null })) : [],
    })),
    drafts:data.drafts.filter(d => d && Object.hasOwn(names,d.type) && typeof d.id === 'string' && d.values && typeof d.values === 'object' && !Array.isArray(d.values)).slice(0,100).map(d => ({
      id:d.id.slice(0,100), type:d.type, archivedAt:Number.isFinite(d.archivedAt)&&d.archivedAt>0?d.archivedAt:null, createdAt:Number.isFinite(d.createdAt) ? d.createdAt : Date.now(),
      updatedAt:Number.isFinite(d.updatedAt) ? d.updatedAt : Number.isFinite(d.createdAt) ? d.createdAt : Date.now(),
      values:Object.fromEntries(Object.entries(d.values).filter(([key,value]) => /^[a-zA-Z]{1,30}$/.test(key) && (typeof value === 'string' || typeof value === 'boolean')).map(([key,value]) => [key,typeof value === 'string' ? value.slice(0,3000) : value])),
    })),
  };
}

function persistDiscover(data, storage = localStorage) {
  try { storage.setItem(STORE, JSON.stringify(data)); }
  catch { throw new Error('本机空间不足或浏览器禁止保存。请减少图片后重试；本次修改没有保存。'); }
}

function visiblePosts(data, people, ownOnly = false) {
  const friends = new Set(people.filter(p => p.isFriend).map(p => p.id));
  return data.posts.filter(p => !p.archivedAt && (p.authorId === 'me' || (!ownOnly && p.audience!=='self' && friends.has(p.authorId)))).sort((a,b) => b.createdAt-a.createdAt);
}

// Read-only, detached local drafts. They are not orders, bills or paid transactions.
export function getDiscoverDrafts(storage = localStorage) {
  return readDiscover(storage).drafts.filter(d=>!d.archivedAt).sort((a,b) => draftTime(b)-draftTime(a)).map(d => ({
    ...d,values:{...d.values,status:draftStatus(d.type)},title:draftTitle(d),status:draftStatus(d.type),
    route:d.type,isLocal:true,isDraft:true,chargeStatus:'未扣款',
  }));
}

function upsertDraft(data, type, values, editingId, timestamp = Date.now()) {
  if (!Object.hasOwn(names,type)) throw new Error('草稿类型无效。');
  const existing = editingId ? data.drafts.find(d => d.id === editingId && d.type === type && !d.archivedAt) : null;
  if (editingId && !existing) throw new Error('这份草稿已不存在，请返回草稿列表。');
  if(!existing&&data.drafts.length>=100)throw new Error('本机已保存 100 份草稿，请先导出备份；暂不能新增。');
  const draft = { id:existing?.id || uid(),type,archivedAt:null,values:{...values,status:draftStatus(type)},
    createdAt:existing?.createdAt ?? timestamp,updatedAt:timestamp };
  data.drafts = [draft,...data.drafts.filter(d => d.id !== draft.id)];
  return draft.id;
}

function filterRankPeople(people,{query='',scope='all',sort='desc'}={}){
  const term=String(query).trim().toLocaleLowerCase();
  return people.filter(p=>Number.isFinite(p.amount)&&(scope==='all'||scope==='friends'&&p.isFriend||scope==='new'&&!p.isFriend)&&`${p.name} ${p.handle||''}`.toLocaleLowerCase().includes(term)).sort((a,b)=>sort==='asc'?a.amount-b.amount:b.amount-a.amount);
}
function filterDrafts(drafts,{query='',group='all',archived=false}={}){
  const term=String(query).trim().toLocaleLowerCase();
  return drafts.filter(d=>!!d.archivedAt===archived&&(group==='all'||draftGroup(d)===group)&&`${draftTitle(d)} ${d.values.prompt||''} ${d.values.details||''} ${d.values.symbol||''}`.toLocaleLowerCase().includes(term)).sort((a,b)=>draftTime(b)-draftTime(a));
}
function setDraftArchived(data,id,archived,timestamp=Date.now()){
  const draft=data.drafts.find(d=>d.id===id);if(!draft)throw new Error('这份草稿已不存在。');
  draft.archivedAt=archived?timestamp:null;
}
function duplicateDraft(data,id,timestamp=Date.now()){
  const original=data.drafts.find(d=>d.id===id);if(!original)throw new Error('这份草稿已不存在。');
  const values={...original.values};if(values.title)values.title=values.title.slice(0,75)+' · 副本';if(values.name)values.name=values.name.slice(0,19)+' · 副本';
  return upsertDraft(data,original.type,values,null,timestamp);
}

function validateUsd(value) {
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value) || Number(value) <= 0) throw new Error('请输入大于 0、最多两位小数的 USDT 金额。');
  return value;
}

function validateTokenDraft(values) {
  const name = String(values.name || '').trim();
  const symbol = String(values.symbol || '').trim().toUpperCase();
  const supply = String(values.supply || '').trim();
  if (name.length < 2 || name.length > 24) throw new Error('代币名称需为 2–24 个字符。');
  if (!/^[A-Z][A-Z0-9]{1,9}$/.test(symbol)) throw new Error('代币符号需为 2–10 位英文字母或数字，以字母开头。');
  if (!/^[1-9]\d{0,15}$/.test(supply) || BigInt(supply) > 1000000000000000n) throw new Error('固定总量需为 1–1,000,000,000,000,000 的整数。');
  let address;
  try { address = getAddress(String(values.address || '').trim()); } catch { throw new Error('请输入有效的 0x 钱包地址，混合大小写地址须通过校验。'); }
  if (address === '0x0000000000000000000000000000000000000000') throw new Error('不能使用零地址作为接收钱包。');
  if (values.ownsWallet !== true) throw new Error('请确认接收钱包由你自己控制。');
  return { name,symbol,supply,address,ownsWallet:true,status:'未部署',network:'BSC 测试网',serviceFee:'0 USDT',settlement:'平台余额' };
}

function validateServiceDraft(type, input) {
  const values=Object.fromEntries(Object.entries(input).map(([key,value])=>[key,typeof value==='string'?value.trim():value]));
  if (!values.title || values.title.length>80) throw new Error('请填写 1–80 个字符的名称。');
  if(type==='ai') {
    if(!values.prompt || values.prompt.length<5 || values.prompt.length>2000) throw new Error('提示词需为 5–2000 个字符。');
  } else if(!values.details || values.details.length<10 || values.details.length>2000) throw new Error('请用至少 10 个字符说明需求。');
  if(type==='provider'&&values.budget)values.budget=validateUsd(values.budget);
  if(type==='bounty')values.reward=validateUsd(values.reward);
  if(type==='integration')values.serviceFee='300 USDT';
  return {...values,status:type==='bounty'?'未发布':'未提交',settlement:'平台余额'};
}

async function readMomentImages(files) {
  if (files.length > 3) throw new Error('每条动态最多选择 3 张图片。');
  if (files.reduce((sum,f) => sum+f.size,0) > MAX_IMAGE_BYTES) throw new Error('图片总大小请控制在 2 MB 以内。');
  return Promise.all(files.map(file => {
    if (!IMAGE_TYPES.includes(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) throw new Error('仅支持 2 MB 以内的 JPG、PNG、WebP 图片。');
    return new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败，请重新选择。'));
      reader.onload = () => safeImageData(reader.result) ? resolve(reader.result) : reject(new Error('图片内容与格式不匹配，请更换图片。'));
      reader.readAsDataURL(file);
    });
  }));
}

export function mountDiscover(container, options = {}) {
  const { toast = () => {}, onNavigate = () => {}, onBalance = () => {}, onProfile = () => {},
    initialRoute = 'hub',initialOwnMoments = false,onRouteChange = () => {},getWalletAddress=()=>'' } = options;
  let view = normalizedRoute(initialRoute),ownMoments = initialOwnMoments === true,data,storageError = '',profileError = '',
    dialog = null,dead = false,sort = 'desc',savedType = '',draftFilter = 'all',editingDraftId = null,
    draftQuery='',draftArchive=false,rankFilter='all',rankQuery='',newDraftRevisions={},draftSelections={},storageSnapshot=null;
  try { data = readDiscover();storageSnapshot=localStorage.getItem(STORE); } catch (error) { storageError = error.message; data = seedDiscover(); }
  data.drafts.sort((a,b) => draftTime(b)-draftTime(a));
  if (Object.hasOwn(names,view)) editingDraftId = data.drafts.find(d => d.type === view&&!d.archivedAt)?.id || null;
  if (Object.hasOwn(names,view)) draftSelections[view]=editingDraftId;
  const people = () => getSocialPeople();
  const me = () => {
    try { const profile=getLocalProfile();profileError='';return ownPerson(profile); }
    catch(error) { profileError=error.message;return ownPerson({nickname:'我',avatar:'🌱'}); }
  };
  const person = id => id === 'me' ? me() : people().find(p => p.id === id);
  const posts = (ownOnly = false) => visiblePosts(data,people(),ownOnly);
  const button = (label,action,cls='disc-primary',extra='') => `<button type="button" class="${cls}" data-disc="${action}" ${extra}>${label}</button>`;
  const status = '';
  const settlement = () => `<button class="disc-settlement" type="button" data-disc="balance">${icon('wallet')}<span>平台余额结算 · 尚未开放</span>${icon('arrow')}</button>`;
  const header = (title,subtitle='') => `<header class="disc-subhead">${button(icon('back'),'hub','disc-round','aria-label="返回发现"')}<div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${status}</header>`;
  const saved = type => `${savedType === type ? `<p class="disc-saved" role="status">${icon('check')}草稿已保存，${type==='token'?'未部署':type==='bounty'?'未发布':'未提交'}、未扣款。</p>` : ''}${editingDraftId ? `<div class="disc-draft-context"><span>${icon('file')}正在编辑已保存的草稿</span>${button('另建一份','new-draft','disc-text')}</div>` : ''}`;
  const getDraftMeta = type => data.drafts.find(d => d.id === editingDraftId && d.type === type&&!d.archivedAt)||null;
  const latestDraft = type => getDraftMeta(type)?.values || {};
  const activeDrafts = () => data.drafts.filter(d=>!d.archivedAt);
  const field = (label,name,value='',placeholder='',extra='') => `<label class="disc-field">${label}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}></label>`;
  const textarea = (label,name,value='',placeholder='',extra='') => `<label class="disc-field">${label}<textarea name="${name}" placeholder="${esc(placeholder)}" ${extra}>${esc(value)}</textarea></label>`;
  const panelNote = copy => `<p class="disc-note">${copy}</p>`;

  const moments=createLiveMomentsFeature({service:options.socialClient||options.service,onAccount:options.onAccount,getLegacyDrafts:()=>data.posts.filter(post=>post.authorId==='me'),showDialog,closeDialog,toast,render,onSaved:()=>go('moments')});
  const shared={socialClient:options.socialClient||options.service,onAccount:options.onAccount,getDraft:latestDraft,getDraftMeta,getDraftKey:type=>getDraftMeta(type)?.id||`new:${type}:${newDraftRevisions[type]||0}`,getDrafts:activeDrafts,saveDraft,showDialog,closeDialog,toast,go,onBalance,render};
  const workbench=createDiscoveryWorkbench({...shared,validateDraft:validateServiceDraft});
  const tokenStudio=createTokenStudio({...shared,validateToken:validateTokenDraft,validateService:validateServiceDraft,getWalletAddress});

  function commit(change) {
    if (storageError) throw new Error(storageError);
    if(localStorage.getItem(STORE)!==storageSnapshot)throw new Error('另一个页面已更新发现数据。本次未保存，请先复制未保存内容，再刷新页面。');
    const next = structuredClone(data);
    change(next);
    persistDiscover(next);
    storageSnapshot=JSON.stringify(next);
    data = next;
  }
  function saveDraft(type,values) {
    let savedId;
    commit(next => { savedId=upsertDraft(next,type,values,editingDraftId); });
    editingDraftId=savedId;
    draftSelections[type]=savedId;
    savedType = type;
    toast('已保存本机草稿 · 未提交、未扣款');
    render();
    return savedId;
  }
  function go(route,config = {}) {
    const {draftId,ownOnly=false}=config;if(Object.hasOwn(config,'draftId')&&draftId===null)newDraftRevisions[route]=(newDraftRevisions[route]||0)+1;
    view=normalizedRoute(route);
    if(view==='moments')ownMoments=ownOnly;
    editingDraftId=null;
    if(Object.hasOwn(names,view)){
      const remembered=draftSelections[view];
      editingDraftId=Object.hasOwn(config,'draftId')?draftId:
        Object.hasOwn(draftSelections,view)&&(remembered===null||data.drafts.some(d=>d.id===remembered&&d.type===view&&!d.archivedAt))?remembered:
        data.drafts.find(d=>d.type===view&&!d.archivedAt)?.id||null;
      draftSelections[view]=editingDraftId;
    }
    savedType='';
    render();
    onRouteChange(view);
    container.scrollIntoView?.({block:'start',behavior:'instant'});
  }
  function closeDialog() { const current=dialog;dialog=null;if(current){current.close();current.remove()} }
  function showDialog(title,html,setup) {
    closeDialog();
    dialog = document.createElement('dialog');
    dialog.className = 'disc-dialog';
    dialog.setAttribute('aria-label',title);
    dialog.innerHTML = `<div class="disc-modal"><header><h2>${esc(title)}</h2><button type="button" class="disc-round" data-disc="close" aria-label="关闭">${icon('close')}</button></header>${html}</div>`;
    dialog.addEventListener('click',handleClick);
    const created=dialog;created.addEventListener('close',()=>{if(dialog===created)dialog=null;created.remove()});
    document.body.append(dialog);
    dialog.showModal();
    setup?.(dialog);
  }
  function renderHub() {
    const friends=people().filter(p=>p.isFriend),draft=activeDrafts()[0];
    return `<div class="disc-home-top"><div><h2>发现</h2><p class="disc-home-subtitle">和熟悉的人，分享与协作</p></div>${button(`${icon('plus')} 发动态`,'compose','disc-record')}</div>
      <section class="disc-circle-panel disc-simple-circle" aria-label="朋友圈入口"><button type="button" class="disc-circle-entry" data-disc="moments"><span class="disc-circle-symbol">${icon('moment')}</span><span><strong>朋友圈</strong><small>朋友的近况，自己的生活</small></span>${icon('arrow')}</button>
      </section>
      <section class="disc-work-list disc-simple-entries" aria-label="发现功能"><button class="disc-work-row" type="button" data-disc="ai"><span class="disc-work-icon purple">${icon('ai')}</span><span><strong>AI 工作台</strong><small>本地安装 · 云端使用</small></span>${icon('arrow')}</button><button class="disc-work-row" type="button" data-disc="drafts"><span class="disc-work-icon blue">${icon('file')}</span><span><strong>本机草稿</strong><small>继续编辑、导出或归档</small></span>${icon('arrow')}</button></section>
      ${draft?`<section class="disc-resume-section disc-compact-resume" aria-label="继续草稿"><div class="disc-section-head"><h3>上次未完成</h3>${button('全部草稿','drafts','disc-text')}</div><button type="button" class="disc-resume-card" data-disc="edit-draft" data-id="${esc(draft.id)}"><span class="disc-resume-icon">${icon('file')}</span><span><small>${names[draft.type]} · ${draftStatus(draft.type)}</small><strong>${esc(draftTitle(draft))}</strong></span>${icon('arrow')}</button></section>`:''}
      `;
  }
  function renderServices() {
    const entries=[['bounty','flag','赏金任务','整理任务、奖励与交付要求','peach','未开放发布'],['provider','shield','认证服务商','寻找协助，整理服务需求','mint','示例目录'],['rank','rank','排行榜','认识同路的人，先添加好友','blue','示例榜单'],['token','rocket','一键发币','准备自己的趣味代币','purple','未部署']];
    return `${header('更多服务','按需打开，用完回到朋友身边')}<div class="disc-service-grid">${entries.map(([route,ico,title,copy,tone,tag])=>`<button type="button" class="disc-service-card" data-disc="${route}"><span class="disc-work-icon ${tone}">${icon(ico)}</span><strong>${title}</strong><p>${copy}</p><small>${tag}</small></button>`).join('')}</div><div class="disc-work-list disc-services-bottom"><button type="button" class="disc-work-row" data-disc="drafts"><span class="disc-work-icon mint">${icon('file')}</span><span><strong>我的草稿</strong><small>继续编辑、导出或归档</small></span>${icon('arrow')}</button></div><details class="disc-service-note"><summary>服务与结算说明</summary><p>服务商、赏金与发币目前仅保存本机草稿，不会提交或扣款。未来付费服务统一通过平台余额结算；当前云端 AI 使用免费验收额度。</p></details>`;
  }
  function renderMoments() { return moments.render({ownOnly:ownMoments}); }
  function rankRows(){
    const list=filterRankPeople(people(),{query:rankQuery,scope:rankFilter,sort});
    return list.map((p,i)=>`<button class="disc-rank-row" type="button" data-disc="profile" data-id="${esc(p.id)}"><span class="disc-rank-index">${String(i+1).padStart(2,'0')}</span>${avatar(p)}<span class="disc-rank-person"><strong>${esc(p.name)}</strong><small>${p.isFriend?'已是好友':p.requested?'等待通过':'查看资料 · 申请好友'}</small></span><b>${new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(p.amount)}<small>示例 USDT</small></b></button>`).join('')||'<div class="disc-empty"><h3>没有找到匹配的人</h3><p>试试其他昵称，或切换查看范围。</p></div>';
  }
  function renderRankResults(){const node=container.querySelector?.('[data-rank-results]');if(node)node.innerHTML=rankRows()}
  function renderRank(){
    return `${header('资产排行榜','陌生人的入口，从好友申请开始')}<section class="disc-rank-brief"><span>${icon('rank')}</span><div><h3>认识同路的人</h3><p>当前展示示例资产估值。资产金额不代表信用或认证。</p></div>${button('榜单说明','rank-rules','disc-text')}</section><div class="disc-filter-strip">${[['all','全部'],['friends','我的好友'],['new','待认识']].map(([id,label])=>button(label,'rank-filter',rankFilter===id?'active':'',`data-filter="${id}" aria-pressed="${rankFilter===id}"`)).join('')}${button(sort==='desc'?'金额 ↓':'金额 ↑','sort','disc-text')}</div><label class="disc-search-v5">${icon('rank')}<input type="search" data-rank-search aria-label="搜索榜单昵称" placeholder="搜索昵称或愚笨者号" value="${esc(rankQuery)}"></label><div class="disc-rank-list" data-rank-results>${rankRows()}</div><div class="disc-rank-consent"><div><strong>我的资产公开意向</strong><p>${data.rankConsent?'已保存本机意向，可随时取消。未读取或公开真实资产。':'默认不参与。正式上榜需另行验证钱包与授权。'}</p></div>${button(data.rankConsent?'取消意向':'了解并加入','rank-consent',data.rankConsent?'disc-soft':'disc-small')}</div>`;
  }
  function renderProvider(){return `${header('认证服务商')}${settlement()}${saved('provider')}${workbench.render('provider')}`}
  function renderAI(){return `${header('AI 工作台')}${saved('ai')}${workbench.render('ai')}`}
  function renderBounty(){return `${header('赏金任务')}${settlement()}${saved('bounty')}${workbench.render('bounty')}`}
  function renderToken(){return `${header('一键发币')}${settlement()}${saved('token')}${tokenStudio.render('token')}`}
  function renderIntegration(){return `${header('接入平台余额','300 USDT · 独立可选的接入服务')}${settlement()}${saved('integration')}${tokenStudio.render('integration')}`}
  function renderBusiness(){return `${header('商业项目需求','整理复杂业务与代币需求')}${settlement()}${saved('business')}${tokenStudio.render('business')}`}
  function renderTokenProjects(){return `${header('我的代币项目','只显示你实际保存过的发币草稿')}${tokenStudio.render('token-projects')}`}
  function draftRows(){
    const filtered=filterDrafts(data.drafts,{query:draftQuery,group:draftFilter,archived:draftArchive});
    return filtered.map(d=>`<button type="button" data-disc="draft" data-id="${esc(d.id)}"><span class="disc-draft-icon">${icon(d.type==='token'?'rocket':d.type==='ai'?'ai':'file')}</span><span><strong>${esc(draftTitle(d))}</strong><small>${names[d.type]} · ${d.archivedAt?'已归档':draftStatus(d.type)}</small></span><time>${relativeTime(draftTime(d))}</time></button>`).join('')||`<div class="disc-empty">${icon('file')}<h3>${draftQuery?'没有匹配的草稿':draftArchive?'归档箱是空的':'这里还没有草稿'}</h3><p>${draftArchive?'暂时不用的草稿可移到这里，随时恢复。':'保存的内容会在这里出现，修改不会重复创建。'}</p></div>`;
  }
  function renderDraftResults(){const node=container.querySelector?.('[data-draft-results]');if(node)node.innerHTML=draftRows()}
  function renderDrafts(){
    return `${header('我的草稿','继续、复制、导出，让想法有处安放')}<div class="disc-filter-strip">${button(`使用中 ${activeDrafts().length}`,'draft-scope',!draftArchive?'active':'','data-archived="false"')}${button(`归档箱 ${data.drafts.filter(d=>d.archivedAt).length}`,'draft-scope',draftArchive?'active':'','data-archived="true"')}</div><label class="disc-search-v5">${icon('file')}<input type="search" data-draft-search aria-label="搜索草稿" placeholder="搜索名称、内容或代币符号" value="${esc(draftQuery)}"></label><div class="disc-draft-filters" aria-label="草稿分类">${[['all','全部'],['work','工作需求'],['token','代币与接入']].map(([id,label])=>button(label,'draft-filter',draftFilter===id?'active':'',`data-filter="${id}" aria-pressed="${draftFilter===id}"`)).join('')}</div><div class="disc-draft-list" data-draft-results>${draftRows()}</div><p class="disc-note">仅保存在本机。草稿尚未提交，不会自动发布、部署或扣款；归档后可恢复。</p>`;
  }
  function render() {
    if (dead) return;
    container.classList.add('disc-root');
    workbench.routeChanged?.(view);
    moments.routeChanged?.(view,{ownOnly:ownMoments});
    me();
    const renderers={hub:renderHub,services:renderServices,moments:renderMoments,rank:renderRank,provider:renderProvider,ai:renderAI,bounty:renderBounty,token:renderToken,integration:renderIntegration,business:renderBusiness,drafts:renderDrafts,'token-projects':renderTokenProjects};
    const content=(renderers[view] || renderHub)();
    container.innerHTML = `${[storageError,profileError].filter(Boolean).map(message=>`<p class="disc-error" role="alert">${esc(message)}</p>`).join('')}${content}`;
  }
  function postById(id) { const post=posts().find(p=>p.id===id); if (!post) throw new Error('这条动态当前不可见。'); return post; }
  function compose(){moments.compose()}
  function share(id) {
    const sharing=postById(id);if(sharing.audience==='self'||sharing.archivedAt)throw new Error('仅自己可见或已归档的动态不能分享。');
    const targets=getSocialShareTargets();
    showDialog('分享给好友或群',`<p class="disc-note">分享文字卡片到本机聊天记录，不会发送给他人。</p><div class="disc-share-targets">${targets.map(target=>`<button type="button" data-disc="share-target" data-id="${esc(id)}" data-target="${esc(target.id)}">${avatar(target)}<span><strong>${esc(target.name)}</strong><small>${target.type==='group'?'群聊':'好友'}</small></span>${icon('arrow')}</button>`).join('') || '<p class="disc-empty">先添加好友或创建群聊。</p>'}</div><p class="disc-form-error" role="alert"></p>`);
  }
  function showDraft(id){
    const draft=data.drafts.find(d=>d.id===id);if(!draft)return;
    const labels={title:'名称',name:'代币名称',symbol:'代币符号',supply:'固定总量',address:'接收钱包',category:'服务类型',details:'需求说明',prompt:'提示词',budget:'预算（USDT）',reward:'赏金（USDT）',duration:'期限',date:'期望日期',status:'状态',network:'网络',serviceFee:'服务费',settlement:'结算方式',deliverables:'交付内容',acceptance:'验收标准',participants:'参与人数',contractAddress:'已部署合约',providerName:'意向服务商',audience:'目标对象',tone:'表达语气'};
    showDialog(names[draft.type],`<span class="disc-draft-badge">本机草稿 · ${draft.archivedAt?'已归档':draftStatus(draft.type)}</span><dl class="disc-draft-details">${Object.entries(draft.values).filter(([key,value])=>Object.hasOwn(labels,key)&&value).map(([key,value])=>`<div><dt>${labels[key]}</dt><dd>${esc(key==='status'?draftStatus(draft.type):value)}</dd></div>`).join('')}</dl><p class="disc-note">没有产生真实订单、合约或资金变动。</p><div class="disc-draft-detail-actions">${draft.archivedAt?button('恢复到草稿箱','restore-draft','disc-primary',`data-id="${esc(id)}"`):button('继续编辑','edit-draft','disc-primary',`data-id="${esc(id)}"`)}${button('复制为新草稿','duplicate-draft','disc-soft',`data-id="${esc(id)}"`)}${button('导出参数 JSON','export-draft','disc-soft',`data-id="${esc(id)}"`)}${!draft.archivedAt?button('移到归档箱','archive-draft','disc-text',`data-id="${esc(id)}"`):''}</div>`);
  }
  async function exportDraft(id){
    const draft=data.drafts.find(d=>d.id===id);if(!draft)throw new Error('这份草稿不存在。');
    const contents=JSON.stringify({format:'tongban.local-draft.v1',type:draft.type,title:draftTitle(draft),status:draftStatus(draft.type),chargeStatus:'未扣款',createdAt:draft.createdAt,values:{...draft.values,status:draftStatus(draft.type)},note:'本机草稿，不代表已提交、已部署、订单或付款。'},null,2);
    try {
      const result=await saveJsonFile({filename:`tongban-${draft.type}-draft.json`,content:contents});
      if(!dead)toast(result.saved?(result.method!=='browser-download'?'草稿参数已保存，不包含钱包密钥':'已请求下载草稿参数，不包含钱包密钥'):'已取消保存');
    } catch(error){if(!dead)toast(error.message||'草稿没有导出，请重试。')}
  }
  function handleClick(event) {
    const target=event.target.closest('[data-disc]');if(!target)return;
    const action=target.dataset.disc;
    if(savedType){savedType='';container.querySelector('.disc-saved')?.remove()}
    try {
      if(moments.handleAction(action,target)||workbench.handleAction(action,target)||tokenStudio.handleAction(action,target))return;
      if(routes.has(action)){go(action);return;}
      if(action==='my-moments'){go('moments',{ownOnly:true});return;}
      if(action==='moment-filter'){ownMoments=target.dataset.filter==='mine';render();return;}
      if(action==='draft-scope'){draftArchive=target.dataset.archived==='true';render();return;}
      if(action==='rank-filter'){rankFilter=['friends','new'].includes(target.dataset.filter)?target.dataset.filter:'all';render();return;}
      if(action==='draft-filter'){draftFilter=['work','token'].includes(target.dataset.filter)?target.dataset.filter:'all';render();return;}
      if(action==='new-draft'){go(view,{draftId:null});return;}
      if(action==='close'){closeDialog();return;}
      if(action==='balance'){onBalance();return;}
      if(action==='profile'){onProfile(target.dataset.id);return;}
      if(action==='sort'){sort=sort==='desc'?'asc':'desc';render();return;}
      if(action==='rank-rules'){showDialog('榜单说明',`<div class="disc-readme"><h3>先认识，再选择建立关系</h3><p>榜单展示本机示例资料与 USDT 估值；不是实时资产数据，不提供投资、收益或信用排序。</p><p>可以查看资料、发送好友申请。申请通过前不能私聊，同群也不会自动成为好友。</p><p>正式上榜需要验证钱包归属、明确公开范围和快照时间。本机意向不等于已授权读取或公开资产。</p></div>`);return;}
      if(action==='rank-consent'){if(data.rankConsent){commit(next=>{next.rankConsent=false});render();toast('已取消上榜意向')}else{showDialog('保存公开意向',`<div class="disc-readme"><h3>你可以随时改变主意</h3><p>这里只保存“愿意了解上榜”的本机意向，不会连接钱包、读取金额或公开资产。真实榜单开放后仍需要重新授权。</p></div>${button('保存本机意向','confirm-rank-consent','disc-primary')}`)}return;}
      if(action==='confirm-rank-consent'){commit(next=>{next.rankConsent=true});closeDialog();render();toast('已保存意向，未读取或公开资产');return;}
      if(action==='archive-draft'||action==='restore-draft'){commit(next=>setDraftArchived(next,target.dataset.id,action==='archive-draft'));closeDialog();go('drafts');toast(action==='archive-draft'?'草稿已归档，可在归档箱恢复':'草稿已恢复');return;}
      if(action==='duplicate-draft'){let id;commit(next=>{id=duplicateDraft(next,target.dataset.id)});closeDialog();go('drafts');showDraft(id);toast('已复制为独立草稿');return;}
      if(action==='export-draft'){exportDraft(target.dataset.id);return;}
      if(action==='compose'){compose();return;}
      
      if(action==='share'){share(target.dataset.id);return;}
      if(action==='like'){postById(target.dataset.id);commit(next=>{const p=next.posts.find(p=>p.id===target.dataset.id);p.likes=p.likes.includes('me')?p.likes.filter(id=>id!=='me'):[...p.likes,'me'];});render();return;}
      if(action==='share-target'){
        const post=postById(target.dataset.id);if(post.audience==='self'||post.archivedAt)throw new Error('这条动态不能分享。');const recipient=getSocialShareTargets().find(t=>t.id===target.dataset.target);
        if(!recipient)throw new Error('当前无法分享到该好友或群。');
        shareMomentToChat(recipient.id,{id:post.id,author:person(post.authorId)?.name || '好友',text:post.text});
        showDialog('本机分享已保存',`<div class="disc-share-success">${icon('check')}<h3>已添加到「${esc(recipient.name)}」的本机聊天</h3><p>尚未发送给他人，不包含图片。</p></div>${button('查看消息','messages','disc-primary')}`);return;
      }
      if(action==='messages'){closeDialog();onNavigate('messages');return;}
      if(action==='draft'){showDraft(target.dataset.id);return;}
      if(action==='edit-draft'){
        const draft=data.drafts.find(d=>d.id===target.dataset.id&&!d.archivedAt);if(!draft)return;
        closeDialog();go(draft.type,{draftId:draft.id});return;
      }
    } catch(error) { const errorBox=dialog?.querySelector('.disc-form-error') || container.querySelector('.disc-form-error');if(errorBox)errorBox.textContent=error.message;else toast(error.message); }
  }
  function handleSubmit(event) {
    if(workbench.handleSubmit(event)||tokenStudio.handleSubmit(event))return;
    const form=event.target.closest('[data-form]');if(!form)return;
    event.preventDefault();
    const type=form.dataset.form;
    try {
      let values=Object.fromEntries(new FormData(form));
      for(const key of Object.keys(values))if(typeof values[key]==='string')values[key]=values[key].trim();
      if(type==='token')values=validateTokenDraft({...values,ownsWallet:form.elements.ownsWallet.checked});
      else values=validateServiceDraft(type,values);
      saveDraft(type,values);
    } catch(error) { form.querySelector('.disc-form-error').textContent=error.message; }
  }
  function handleInput(event){if(savedType&&Object.hasOwn(names,view)){savedType='';container.querySelector('.disc-saved')?.remove()}moments.handleInput?.(event);workbench.handleInput?.(event);tokenStudio.handleInput?.(event);if(event.target.matches?.('[data-draft-search]')){draftQuery=event.target.value;renderDraftResults()}if(event.target.matches?.('[data-rank-search]')){rankQuery=event.target.value;renderRankResults()}}
  container.addEventListener('input',handleInput);container.addEventListener('change',handleInput);
  container.addEventListener('click',handleClick);
  container.addEventListener('submit',handleSubmit);
  render();
  onRouteChange(view);
  const cleanup = () => { dead=true;moments.cleanup?.();workbench.cleanup?.();tokenStudio.cleanup?.();closeDialog();container.removeEventListener('input',handleInput);container.removeEventListener('change',handleInput);container.removeEventListener('click',handleClick);container.removeEventListener('submit',handleSubmit);container.classList.remove('disc-root'); };
  cleanup.back = () => { if(dialog){closeDialog();return true} if(view!=='hub'){go('hub');return true} return false; };
  return cleanup;
}
