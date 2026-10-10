import { createPeopleFeature } from './live-people.js';
import { createFavoritesFeature } from './favorites.js';
import './favorites.css';
import './discover.css';
import { saveJsonFile } from './native-runtime.js';
import './discover-v5.css';
import { createCommunityFeature } from './discover-community.js';
import { createLiveMomentsFeature } from './live-moments.js';
import { createDiscoveryWorkbench } from './discover-workbench.js';
import { createTokenStudio } from './discover-token.js';
import { getAddress } from 'ethers';
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
const names = { provider:'服务预约意向', ai:'AI 工作草稿', bounty:'悬赏任务草稿', token:'发币草稿', business:'商务需求' };
const routes = new Set(['people','hub','services','moments','rank','provider','ai','bounty','token','business','favorites','drafts','token-projects']);
const draftStatus = type => type === 'token' ? '未部署' : type === 'bounty' ? '未发布' : '未提交';
const draftTime = draft => draft.updatedAt || draft.createdAt;
const draftTitle = draft => draft.values.title || draft.values.name || names[draft.type];
const draftGroup = draft => draft.type==='token' ? 'token' : 'work';
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
  return { name,symbol,supply,address,ownsWallet:true,status:'未部署',network:'BSC 测试网',feeStatus:'未接通' };
}

function validateServiceDraft(type, input) {
  if(!['provider','ai','bounty','business'].includes(type))throw new Error('草稿类型无效。');
  const values=Object.fromEntries(Object.entries(input).map(([key,value])=>[key,typeof value==='string'?value.trim():value]));
  if (!values.title || values.title.length>80) throw new Error('请填写 1–80 个字符的名称。');
  if(type==='ai') {
    if(!values.prompt || values.prompt.length<5 || values.prompt.length>2000) throw new Error('提示词需为 5–2000 个字符。');
  } else if(!values.details || values.details.length<10 || values.details.length>2000) throw new Error('请用至少 10 个字符说明需求。');
  if(type==='provider'&&values.budget)values.budget=validateUsd(values.budget);
  if(type==='bounty')values.reward=validateUsd(values.reward);
  return {...values,status:type==='bounty'?'未发布':'未提交',settlement:'合作双方另行约定，平台不托管'};
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
  const { toast = () => {}, onNavigate = () => {}, onProfile = () => {},
    initialRoute = 'hub',backLabel = '返回发现',onExit,initialOwnMoments = false,onRouteChange = () => {},getWalletAddress=()=>'' } = options;
  let view = normalizedRoute(initialRoute),ownMoments = initialOwnMoments === true,data,storageError = '',profileError = '',
    dialog = null,dead = false,editingLocalDraft=false,sort = 'desc',savedType = '',draftFilter = 'all',editingDraftId = null,
    draftQuery='',draftArchive=false,rankFilter='all',rankQuery='',newDraftRevisions={},draftSelections={},storageSnapshot=null;
  try { data = readDiscover();storageSnapshot=localStorage.getItem(STORE); } catch (error) { storageError = error.message; data = seedDiscover(); }
  data.drafts.sort((a,b) => draftTime(b)-draftTime(a));
  if (Object.hasOwn(names,view)) editingDraftId = data.drafts.find(d => d.type === view&&!d.archivedAt)?.id || null;
  if (Object.hasOwn(names,view)) draftSelections[view]=editingDraftId;
  const people = () => [];
  const me = () => {
    try { const profile=getLocalProfile();profileError='';return ownPerson(profile); }
    catch(error) { profileError=error.message;return ownPerson({nickname:'我',avatar:'🌱'}); }
  };
  const person = id => id === 'me' ? me() : people().find(p => p.id === id);
  const posts = (ownOnly = false) => visiblePosts(data,people(),ownOnly);
  const button = (label,action,cls='disc-primary',extra='') => `<button type="button" class="${cls}" data-disc="${action}" ${extra}>${label}</button>`;
  const status = '';
  const header = (title,subtitle='') => `<header class="disc-subhead">${button(icon('back'),'back','disc-round',`aria-label="${esc(view==='drafts'?'返回收藏':editingLocalDraft?'返回历史草稿':backLabel)}"`)}<div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${status}</header>`;
  const saved = type => `${savedType === type ? `<p class="disc-saved" role="status">${icon('check')}草稿已保存，${type==='token'?'未部署':type==='bounty'?'未发布':'未提交'}、未扣款。</p>` : ''}${editingDraftId ? `<div class="disc-draft-context"><span>${icon('file')}正在编辑已保存的草稿</span>${button('另建一份','new-draft','disc-text')}</div>` : ''}`;
  const getDraftMeta = type => data.drafts.find(d => d.id === editingDraftId && d.type === type&&!d.archivedAt)||null;
  const latestDraft = type => getDraftMeta(type)?.values || {};
  const activeDrafts = () => data.drafts.filter(d=>!d.archivedAt);
  const field = (label,name,value='',placeholder='',extra='') => `<label class="disc-field">${label}<input name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${extra}></label>`;
  const textarea = (label,name,value='',placeholder='',extra='') => `<label class="disc-field">${label}<textarea name="${name}" placeholder="${esc(placeholder)}" ${extra}>${esc(value)}</textarea></label>`;
  const panelNote = copy => `<p class="disc-note">${copy}</p>`;

  const moments=createLiveMomentsFeature({service:options.socialClient||options.service,onAccount:options.onAccount,getLegacyDrafts:()=>data.posts.filter(post=>post.authorId==='me'),showDialog,closeDialog,toast,render,onSaved:()=>go('moments')});
  const shared={socialClient:options.socialClient||options.service,onAccount:options.onAccount,getDraft:latestDraft,getDraftMeta,getDraftKey:type=>getDraftMeta(type)?.id||`new:${type}:${newDraftRevisions[type]||0}`,getDrafts:activeDrafts,saveDraft,showDialog,closeDialog,toast,go,render,backLabel};
  const favorites=createFavoritesFeature({storage:options.storage,getLegacySaved:()=>data.posts.filter(post=>data.savedPostIds.includes(post.id)),removeLegacySaved:id=>commit(next=>{if(!next.savedPostIds.includes(id))throw new Error('这条收藏已不存在，请刷新后重试。');next.savedPostIds=next.savedPostIds.filter(savedId=>savedId!==id)}),showDialog,closeDialog,toast,render});
  const newPeople=createPeopleFeature({service:options.socialClient||options.service,onAccount:options.onAccount,render,toast});
  const community=createCommunityFeature({...shared,container,onNavigate});
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
  function notifyRouteChange() {
    onRouteChange(view,{localDraft:editingLocalDraft,canonicalRoute:editingLocalDraft?'drafts':view});
  }
  function go(route,config = {}) {
    const {draftId,ownOnly=false}=config;if(Object.hasOwn(config,'draftId')&&draftId===null)newDraftRevisions[route]=(newDraftRevisions[route]||0)+1;
    view=normalizedRoute(route);editingLocalDraft=typeof draftId==='string'||(Object.hasOwn(config,'draftId')&&draftId===null&&editingLocalDraft);
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
    notifyRouteChange();
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
    return '<header class="disc-brand-heading"><h1>发现</h1></header><section class="disc-brand-hero" aria-label="发现内容与灵感"><span lang="en">YBZ</span><h2>把不相干的东西连起来</h2><p>从交流与收藏中，找到新的思路。</p></section><h2 class="disc-home-group-title">内容与功能</h2><section class="disc-home-entries" aria-label="发现">'+[
      ['moments','moment','朋友圈'],['people','chat','认识新朋友'],['favorites','heart','收藏'],
    ].map(([route,ico,label])=>'<button type="button" class="disc-home-entry" data-disc="'+route+'"><span class="disc-home-entry-icon">'+icon(ico)+'</span><span>'+label+'</span>'+icon('arrow')+'</button>').join('')+'</section>';
  }
  function goBack() {
    if(view==='drafts'){go('favorites');return true;}
    if(editingLocalDraft){go('drafts');return true;}
    if(view!=='hub'){
      if(typeof onExit==='function'&&view===normalizedRoute(initialRoute==='drafts'?'favorites':initialRoute)){onExit();return true;}
      go('hub');return true;
    }
    if(typeof onExit==='function'){onExit();return true;}
    return false;
  }
  function renderServices() { return renderHub(); }
  function renderMoments() { return moments.render({ownOnly:ownMoments}); }
  function renderProvider(){return `${header('认证服务商')}${saved('provider')}${workbench.render('provider')}`}
  function renderAI(){return `${header('AI 工作台')}${saved('ai')}${workbench.render('ai')}`}
  function renderBounty(){return `${header('赏金任务')}${saved('bounty')}${workbench.render('bounty')}`}
  function renderToken(){return `${header('一键发币')}${saved('token')}${tokenStudio.render('token')}`}
  function renderBusiness(){return `${header('商业项目需求','整理复杂业务与代币需求')}${saved('business')}${tokenStudio.render('business')}`}
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
    community.routeChanged?.(editingLocalDraft?'drafts':view);
    newPeople.routeChanged(view);
    workbench.routeChanged?.(view);
    moments.routeChanged?.(view,{ownOnly:ownMoments});
    me();
    const renderers={people:()=>header('认识新朋友')+newPeople.render(),hub:renderHub,services:renderServices,moments:renderMoments,rank:()=>community.render('rank'),provider:()=>editingLocalDraft?renderProvider():community.render('provider'),ai:renderAI,bounty:()=>editingLocalDraft?renderBounty():community.render('bounty'),token:()=>editingLocalDraft?renderToken():community.render('token'),business:renderBusiness,favorites:()=>header('收藏')+favorites.render(),drafts:renderDrafts,'token-projects':renderTokenProjects};
    const content=(renderers[view] || renderHub)();
    container.innerHTML = `${[storageError,profileError].filter(Boolean).map(message=>`<p class="disc-error" role="alert">${esc(message)}</p>`).join('')}${content}`;
  }
  function postById(id) { const post=posts().find(p=>p.id===id); if (!post) throw new Error('这条动态当前不可见。'); return post; }
  function compose(){moments.compose()}
  function share(){toast('旧本机动态不能直接转发；可在朋友圈重新发布后分享。')}
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
      if(action==='back'||(action==='hub'&&typeof onExit==='function')){goBack();return;}
      if(action==='open-workbench'){onNavigate('workbench');return;}
      if(favorites.handleAction(action,target))return;
      if(newPeople.handleAction(action,target)||community.handleAction(action,target)||moments.handleAction(action,target)||workbench.handleAction(action,target)||tokenStudio.handleAction(action,target))return;
      if(routes.has(action)){go(action);return;}
      if(action==='my-moments'){go('moments',{ownOnly:true});return;}
      if(action==='moment-filter'){ownMoments=target.dataset.filter==='mine';render();return;}
      if(action==='draft-scope'){draftArchive=target.dataset.archived==='true';render();return;}
      if(action==='draft-filter'){draftFilter=['work','token'].includes(target.dataset.filter)?target.dataset.filter:'all';render();return;}
      if(action==='new-draft'){go(view,{draftId:null});return;}
      if(action==='close'){closeDialog();return;}
      if(action==='profile'){onProfile(target.dataset.id);return;}
      if(action==='archive-draft'||action==='restore-draft'){commit(next=>setDraftArchived(next,target.dataset.id,action==='archive-draft'));closeDialog();go('drafts');toast(action==='archive-draft'?'草稿已归档，可在归档箱恢复':'草稿已恢复');return;}
      if(action==='duplicate-draft'){let id;commit(next=>{id=duplicateDraft(next,target.dataset.id)});closeDialog();go('drafts');showDraft(id);toast('已复制为独立草稿');return;}
      if(action==='export-draft'){exportDraft(target.dataset.id);return;}
      if(action==='compose'){compose();return;}
      
      if(action==='share'){share(target.dataset.id);return;}
      if(action==='like'){postById(target.dataset.id);commit(next=>{const p=next.posts.find(p=>p.id===target.dataset.id);p.likes=p.likes.includes('me')?p.likes.filter(id=>id!=='me'):[...p.likes,'me'];});render();return;}
      if(action==='share-target'){throw new Error('旧本机分享入口已关闭，请使用在线朋友圈。');}
      if(action==='messages'){closeDialog();onNavigate('messages');return;}
      if(action==='draft'){showDraft(target.dataset.id);return;}
      if(action==='edit-draft'){
        const draft=data.drafts.find(d=>d.id===target.dataset.id&&!d.archivedAt);if(!draft)return;
        closeDialog();go(draft.type,{draftId:draft.id});return;
      }
    } catch(error) { const errorBox=dialog?.querySelector('.disc-form-error') || container.querySelector('.disc-form-error');if(errorBox)errorBox.textContent=error.message;else toast(error.message); }
  }
  function handleSubmit(event) {
    if(newPeople.handleSubmit(event)||workbench.handleSubmit(event)||tokenStudio.handleSubmit(event))return;
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
  function handleInput(event){newPeople.handleInput(event);if(community.handleInput(event))return;if(savedType&&Object.hasOwn(names,view)){savedType='';container.querySelector('.disc-saved')?.remove()}moments.handleInput?.(event);workbench.handleInput?.(event);tokenStudio.handleInput?.(event);if(event.target.matches?.('[data-draft-search]')){draftQuery=event.target.value;renderDraftResults()}}
  container.addEventListener('input',handleInput);container.addEventListener('change',handleInput);
  container.addEventListener('click',handleClick);
  container.addEventListener('submit',handleSubmit);
  render();
  notifyRouteChange();
  const cleanup = () => { dead=true;newPeople.cleanup();community.cleanup();moments.cleanup?.();workbench.cleanup?.();tokenStudio.cleanup?.();closeDialog();container.removeEventListener('input',handleInput);container.removeEventListener('change',handleInput);container.removeEventListener('click',handleClick);container.removeEventListener('submit',handleSubmit);container.classList.remove('disc-root'); };
  cleanup.back = () => { if(dialog){closeDialog();return true} return goBack(); };
  return cleanup;
}
