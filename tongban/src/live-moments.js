import './live-moments.css';
import { safeProfilePhoto } from './live-social.js';
import { renderMomentArtifact } from './discover-moments.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID();
const artifactId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const bytesOf=src=>{const b=String(src).split(',')[1]||'';return Math.floor(b.length*3/4)-(b.endsWith('==')?2:b.endsWith('=')?1:0);};
const button=(action,label,extra='',cls='lm-text')=>`<button type="button" class="${cls}" data-disc="lm-${action}" ${extra}>${label}</button>`;
const time=value=>new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const portrait=user=>`<span class="lm-avatar">${safeProfilePhoto(user)?`<img src="${esc(safeProfilePhoto(user))}" alt="" loading="lazy">`:esc(user?.avatar||'友')}</span>`;
const errorText=error=>error?.message||'操作未完成，请重试。';

export function validateLiveMoment(input){
 const text=String(input?.text??'').trim(),images=input?.images??[],audience=input?.audience??'friends';
 if(text.length>2000)throw new Error('动态文字最多 2,000 个字符。');
 if(!['friends','self'].includes(audience))throw new Error('请选择好友可见或仅自己可见。');
 if(!Array.isArray(images)||images.length>3||images.some(i=>!i||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(i.src)||typeof i.name!=='string'||i.name.length>80))throw new Error('最多选择 3 张 JPG、PNG 或 WebP 照片。');
 if(images.reduce((n,i)=>n+bytesOf(i.src),0)>512*1024)throw new Error('照片总大小不能超过 512 KB，请重新选择压缩后的照片。');
 if(Object.hasOwn(input||{},'workbenchFileId')&&!artifactId(input.workbenchFileId))throw new Error('成果标识无效，请重新选择。');
 if(!text&&!images.length&&!input?.workbenchFileId)throw new Error('写点什么，或选择一张照片。');
 return {text,audience,images:images.map(i=>({src:i.src,name:i.name})),...(input?.workbenchFileId?{workbenchFileId:input.workbenchFileId.toLowerCase()}:{})};
}

export async function prepareMomentImages(files){
 if(!files.length||files.length>3)throw new Error('每条动态可选择 1–3 张照片。');
 const result=[];
 for(const file of files){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>20*1024*1024)throw new Error('请选择 20 MB 以内的 JPG、PNG 或 WebP 照片。');
  const url=URL.createObjectURL(file);
  try{
   const image=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('照片无法读取，请换一张。'));image.src=url;});
   if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>80000000)throw new Error('照片尺寸过大，请先裁剪。');
   let src='';const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw new Error('当前设备无法处理照片。');
   for(const side of [1280,960,640]){const scale=Math.min(1,side/Math.max(image.naturalWidth,image.naturalHeight));canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);for(const quality of [.84,.65,.45]){src=canvas.toDataURL('image/jpeg',quality);if(bytesOf(src)<=170*1024)break;}if(bytesOf(src)<=170*1024)break;}
   if(!src.startsWith('data:image/jpeg;base64,')||bytesOf(src)>170*1024)throw new Error('照片压缩后仍过大，请裁剪或换一张。');
   result.push({src,name:String(file.name||'照片').replace(/\.[^.]+$/,'').slice(0,70)+'.jpg'});
  }finally{URL.revokeObjectURL(url);}
 }
 return result;
}

// All pictures pass through the same authenticated request path as social data.
// Blob URLs are short-lived presentation state, never stored with local drafts.
export function createMomentsAPI(service){
 let disposed=false,revision=0;const urls=new Set();
 function clear(){revision++;for(const url of urls)URL.revokeObjectURL(url);urls.clear();}
 const request=(path,options)=>{if(disposed)throw new Error('页面已关闭。');if(typeof service?.authenticatedRequest!=='function')throw new Error('请先登录后查看朋友圈。');return service.authenticatedRequest(path,options);};
 const post=(path,input={})=>request(path,{method:'POST',input});
 async function hydrate(posts){const epoch=revision,userId=service?.getProfile?.()?.userId;return Promise.all(posts.map(async p=>({...p,images:await Promise.all((p.images||[]).map(async image=>{
  try{if(!/^[a-f0-9-]{36}$/.test(image.id))throw new Error('照片标识无效。');const blob=await request('moments/media/'+image.id,{raw:true});if(disposed||epoch!==revision||service?.getProfile?.()?.userId!==userId)throw new Error('账号或页面已变化。');if(blob.size>512*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('照片格式无效。');const src=URL.createObjectURL(blob);urls.add(src);return {...image,src};}catch(error){return {...image,src:'',error:errorText(error)};}
 }))})));}
 return {request,list:query=>request('moments'+query),get:id=>request('moments/'+id),publish:input=>post('moments',input),like:(id,liked)=>post('moments/'+id+'/like',{liked}),comment:(id,input)=>post('moments/'+id+'/comments',input),remove:id=>post('moments/'+id+'/delete'),removeComment:(id,cid)=>post(`moments/${id}/comments/${cid}/delete`),hydrate,clear,dispose(){disposed=true;clear();}};
}

export function createLiveMomentsFeature(ctx){
 const service=ctx.service,api=createMomentsAPI(service);let active=false,dead=false,loading=false,loaded=false,more=null,posts=[],error='',scope='all',generation=0,editor=null,dialog=null,timer=null,lastOwnOnly,opening=false;
 const me=()=>service?.getProfile?.(),storage=()=>ctx.storage||globalThis.localStorage;
 // Per-account/per-file draft keys preserve an ordinary draft when sharing a file.
 const draftKey=(value=editor)=>me()?.userId?'yubenzhe.moments.draft.v1:'+me().userId+(value?.workbenchFileId?':artifact:'+value.workbenchFileId:''):'';
 const refreshRender=()=>{if(!dead&&active)ctx.render();};
 function saveDraft(value){const key=draftKey();if(!key)return;try{if(value)storage().setItem(key,JSON.stringify(value));else storage().removeItem(key);}catch{ctx.toast('草稿暂时只保留在当前页面，请勿关闭。');}}
 function readDraft(artifact=null){try{const raw=storage().getItem(draftKey(artifact))||'null';if(raw.length>750000)return null;const value=JSON.parse(raw);if(value&&typeof value.text==='string'&&value.text.length<=2000&&['friends','self'].includes(value.audience)&&Array.isArray(value.images)&&value.images.length<=3&&value.images.every(i=>i&&typeof i.name==='string'&&i.name.length<=80&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(i.src))&&value.images.reduce((n,i)=>n+bytesOf(i.src),0)<=512*1024)return {text:value.text,audience:value.audience,images:value.images,clientId:/^[a-f0-9-]{36}$/i.test(value.clientId)?value.clientId:uid(),attempted:value.attempted===true,...(artifact?{workbenchFileId:artifact.workbenchFileId,fileName:artifact.fileName}:{})};}catch{}return null;}
 const ownDrafts=()=>ctx.getLegacyDrafts?.()||[];
 async function requireAccount(){if(me())return true;await ctx.onAccount?.();return Boolean(me());}
 async function load(older=false){
  if(dead||loading||!active||!me())return;loading=true;const epoch=++generation,account=me().userId;error='';if(!older){posts=[];api.clear();}refreshRender();
   try{const data=await api.list('?scope='+scope+(older&&more?'&before='+encodeURIComponent(more):''));if(dead||epoch!==generation||me()?.userId!==account)return;const hydrated=await api.hydrate(data.posts);if(dead||epoch!==generation||me()?.userId!==account)return;posts=older?[...posts,...hydrated]:hydrated;more=data.nextBefore;loaded=true;
    refreshRender();
    if(!older&&scope==='all'&&active&&globalThis.document?.visibilityState!=='hidden'){
     const ids=hydrated.filter(p=>p.own===false&&p.author?.userId!==account&&/^[1-9]\d{0,14}$/.test(p.id)&&Number.isSafeInteger(Number(p.id))).map(p=>Number(p.id));
     if(ids.length)service.markMomentsSeen?.(String(Math.max(...ids)),account);
    }
   }
  catch(e){if(!dead&&epoch===generation){error=errorText(e);if(!older){posts=[];api.clear();}loaded=true;}}
  finally{if(!dead&&epoch===generation){loading=false;refreshRender();}}
 }
 function modal(title,html,setup){ctx.showDialog(title,html,element=>{dialog=element;setup?.(element);element.addEventListener('close',()=>{if(dialog===element)dialog=null;},{once:true});});}
 function postHTML(p){return `<article class="lm-post" data-live-moment="${esc(p.id)}"><div class="lm-post-avatar">${portrait(p.author)}</div><div class="lm-post-body"><header><strong>${esc(p.author?.nickname||'好友')}</strong>${p.author?.official?'<small class="lm-official">官方</small>':''}</header>${p.text?`<p class="lm-content">${esc(p.text)}</p>`:''}${renderMomentArtifact(p.artifact)}${p.images?.length?`<div class="lm-images count-${p.images.length}">${p.images.map((i,n)=>i.src?button('image',`<img loading="lazy" src="${esc(i.src)}" alt="动态照片 ${n+1}">`,`data-id="${esc(p.id)}" data-index="${n}"`,'lm-photo'):button('retry-image','照片加载失败，点击重试',`data-id="${esc(p.id)}"`,'lm-photo lm-photo-error')).join('')}</div>`:''}<div class="lm-meta"><time>${time(p.createdAt)}</time>${p.audience==='self'?'<span>仅自己可见</span>':''}${p.own?button('delete','删除',`data-id="${esc(p.id)}"`):button('report','举报',`data-id="${esc(p.id)}"`)}<span class="lm-actions">${button('like',p.liked?'取消赞':'赞',`data-id="${esc(p.id)}" aria-pressed="${p.liked}"`)}${button('comment','评论',`data-id="${esc(p.id)}"`)}</span></div>${p.likes?.length||p.comments?.length?`<div class="lm-replies">${p.likes?.length?`<p class="lm-likes">♡ ${p.likes.map(user=>esc(user.nickname)).join('、')}</p>`:''}${(p.comments||[]).map(c=>`<div class="lm-comment"><span><strong>${esc(c.author?.nickname||'好友')}：</strong>${esc(c.text)}</span>${c.own?button('delete-comment','删除',`data-id="${esc(p.id)}" data-comment-id="${esc(c.id)}"`):button('report-comment','举报',`data-id="${esc(p.id)}" data-comment-id="${esc(c.id)}"`)}</div>`).join('')}</div>`:''}</div></article>`;}
 function render({ownOnly=false,backLabel='返回发现'}={}){
  if(lastOwnOnly===undefined){scope=ownOnly?'mine':'all';lastOwnOnly=ownOnly;}
  const controls=`<header class="lm-header"><button type="button" data-disc="hub" class="disc-round" aria-label="${esc(backLabel)}">‹</button><h2>朋友圈</h2>${button('compose','＋','aria-label="发布动态"','lm-compose-button')}</header>`;
  if(!me())return `<section class="live-moments">${controls}<div class="lm-empty"><p>登录后，和好友分享生活。</p>${button('login','登录账号','','disc-primary')}${ownDrafts().length?button('local','查看本机旧内容'):''}</div></section>`;
  return `<section class="live-moments">${controls}<div class="lm-toolbar">${button('scope','朋友圈','data-scope="all" aria-pressed="'+(scope==='all')+'"')}${button('scope','我','data-scope="mine" aria-pressed="'+(scope==='mine')+'"')}${button('refresh','刷新',loading?'disabled':'')}${ownDrafts().length?button('local','本机旧内容'):''}</div>${error?`<div class="lm-error" role="alert">${esc(error)} ${button('refresh','重试')}</div>`:''}<div class="lm-feed">${posts.map(postHTML).join('')}${loading?'<p class="lm-loading" role="status">正在加载…</p>':!posts.length?`<div class="lm-empty"><p>${loaded?'还没有动态':'正在连接朋友圈…'}</p>${loaded?button('compose','分享第一条动态'):''}</div>`:''}</div>${more&&!loading?button('older','加载更多','','lm-older'):''}</section>`;
 }
 function editorMarkup(){return `<form data-live-moment-form>${editor.workbenchFileId?`<div class="lm-share-file"><small>分享成果</small><strong>${esc(editor.fileName)}</strong><p class="lm-note">展示文件名、任务标题、大小和生成时间。文件内容由你另行决定是否发送。</p></div>`:''}<textarea name="text" maxlength="2000" placeholder="${editor.workbenchFileId?'补充说明（选填）…':'这一刻的想法…'}" aria-label="动态内容">${esc(editor.text)}</textarea>${editor.workbenchFileId?'':`<div class="lm-editor-images">${editor.images.map((i,n)=>`<div><img src="${esc(i.src)}" alt="待发布照片 ${n+1}">${button('remove-image','×',`data-index="${n}" aria-label="移除照片 ${n+1}"`)}</div>`).join('')}</div><label class="lm-pick-photo">添加照片<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-live-moment-files></label>`}<label class="lm-audience">谁可以看<select name="audience"><option value="friends" ${editor.audience==='friends'?'selected':''}>好友可见</option><option value="self" ${editor.audience==='self'?'selected':''}>仅自己可见</option></select></label><p class="lm-note">${editor.workbenchFileId?'说明可空，最多 2,000 个字符。只有点击发布才会发送。':'最多 3 张照片，会在本机压缩。只有点击发布才会发送。'}</p><p class="lm-editor-error" role="alert"></p><button type="submit" class="disc-primary lm-publish">${editor.attempted?'重试发布':'发布'}</button>${editor.attempted?button('new-draft','放弃重试，另写一条'):''}</form>`;}
 function showEditor(){
  modal(editor.workbenchFileId?'分享到发现':'发布动态',editorMarkup(),element=>{
   const form=element.querySelector('[data-live-moment-form]'),target=editor,account=me()?.userId,errorBox=form.querySelector('.lm-editor-error');
   const freeze=value=>{for(const input of form.querySelectorAll('textarea,select,input,[data-disc="lm-remove-image"]'))input.disabled=value;};freeze(Boolean(target.attempted));
   const remember=()=>{if(dead||editor!==target||dialog!==element||me()?.userId!==account)return;target.text=form.elements.text.value;target.audience=form.elements.audience.value;saveDraft(target);};
   form.addEventListener('input',remember);form.addEventListener('change',async event=>{
    if(!event.target.matches('[data-live-moment-files]'))return;const files=Array.from(event.target.files||[]);if(!files.length)return;target.reading=true;freeze(true);form.querySelector('.lm-publish').disabled=true;errorBox.textContent='正在压缩照片…';
    try{const images=await (ctx.prepareImages||prepareMomentImages)(files);if(dead||editor!==target||me()?.userId!==account||dialog!==element)return;target.images=images;remember();showEditor();}catch(e){if(editor===target&&dialog===element)errorBox.textContent=errorText(e);}finally{target.reading=false;if(editor===target&&dialog===element){freeze(false);form.querySelector('.lm-publish').disabled=false;}}
   });
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(dead||editor!==target||dialog!==element||me()?.userId!==account||target.busy||target.reading)return;remember();let input;try{input=validateLiveMoment(target);}catch(e){errorBox.textContent=errorText(e);return;}
    target.attempted=true;target.busy=true;saveDraft({...target,busy:false});freeze(true);form.querySelector('.lm-publish').disabled=true;errorBox.textContent='正在发布…';
    try{await api.publish({...input,clientId:target.clientId});if(dead||editor!==target||me()?.userId!==account)return;saveDraft(null);editor=null;ctx.closeDialog();ctx.toast(target.workbenchFileId?'已分享到发现':'已发布');if(target.workbenchFileId){modal('已分享到发现','<p class="lm-note">'+(target.audience==='self'?'这条成果动态仅自己可见。':'好友现在可以看到这条成果动态。')+'</p>'+button('shared-view','去看看','','disc-primary'));if(active)await load();}else if(!active)ctx.onSaved?.();else await load();}
    catch(e){if(!dead&&editor===target){errorBox.textContent=errorText(e)+' 内容已保留，点击重试不会重复发布。';form.querySelector('.lm-publish').textContent='重试发布';}}
    finally{target.busy=false;if(editor===target&&dialog===element)form.querySelector('.lm-publish').disabled=false;}
   });
  });
 }
 async function compose(initial,artifact=null){
  if(dead||opening||editor?.busy||editor?.reading)return;opening=true;const account=me()?.userId;
  try{
   if(!await requireAccount()||dead||(account&&me()?.userId!==account))return;
   const same=editor?.workbenchFileId===(artifact?.workbenchFileId);
   const draft=initial?{text:initial,audience:'friends',images:[]}:(same&&editor)||readDraft(artifact)||{text:'',audience:'friends',images:[],...(artifact||{})};
   editor={...draft,clientId:draft.clientId||uid(),busy:false,reading:false};showEditor();
  }catch(e){if(!dead)ctx.toast(errorText(e));}finally{opening=false;}
 }
 async function composeArtifact(file){
  if(!artifactId(file?.id)||typeof file.name!=='string'||!file.name||file.name.length>255){ctx.toast('成果信息无效，请重新打开任务。');return;}
  return compose(undefined,{workbenchFileId:file.id.toLowerCase(),fileName:file.name});
 }

 function confirm(title,copy,operation){modal(title,`<p class="lm-note">${copy}</p><p class="lm-editor-error" role="alert"></p><button class="disc-primary" type="button" data-lm-confirm>确认删除</button>`,element=>{element.querySelector('[data-lm-confirm]').addEventListener('click',async event=>{event.target.disabled=true;try{await operation();if(dead)return;ctx.closeDialog();await load();}catch(e){element.querySelector('.lm-editor-error').textContent=errorText(e);event.target.disabled=false;}});});}
 function comment(post){const pending={clientId:uid(),text:'',attempted:false,busy:false};modal('评论',`<form data-lm-comment><textarea name="text" maxlength="300" placeholder="写评论…" aria-label="评论内容" required></textarea><p class="lm-editor-error" role="alert"></p><button type="submit" class="disc-primary">发送</button></form>`,element=>{element.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=event.target;if(pending.busy)return;pending.text=form.elements.text.value.trim();if(!pending.text)return;pending.busy=true;form.elements.text.disabled=true;form.querySelector('button').disabled=true;try{await api.comment(post.id,{clientId:pending.clientId,text:pending.text});if(dead)return;ctx.closeDialog();await load();}catch(e){form.querySelector('.lm-editor-error').textContent=errorText(e)+' 可直接重试，评论不会重复发送。';form.querySelector('button').textContent='重试';}finally{pending.busy=false;form.querySelector('button').disabled=false;}});});}
 function localDrafts(){modal('本机旧内容',`<p class="lm-note">这些内容来自旧版本，只保存在本机，没有自动发布或上传。可使用文字另写一条，原内容和照片会保留。</p><div class="lm-local-list">${ownDrafts().map((p,index)=>`<article><p>${esc(p.text)}</p>${p.images?.length?`<div class="lm-editor-images">${p.images.filter(src=>/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)).slice(0,3).map(src=>`<div><img src="${esc(src)}" alt="仅保存在本机的旧照片"></div>`).join('')}</div>`:''}${button('use-local','使用文字',`data-index="${index}"`)}</article>`).join('')||'<p>没有本机旧内容。</p>'}</div>`);}
 function report(post,commentId){
  const requestId=uid();modal('举报内容',`<form data-lm-report><label class="lm-audience">举报原因<select name="reason"><option value="spam">垃圾信息</option><option value="harassment">骚扰</option><option value="fraud">诈骗</option><option value="illegal">违法内容</option><option value="other">其他</option></select></label><textarea name="detail" maxlength="1000" aria-label="补充说明" placeholder="补充说明（选填）"></textarea><p class="lm-note">举报会连同当前可见的内容记录提交给平台处理。</p><p class="lm-editor-error" role="alert"></p><button class="disc-primary" type="submit">提交举报</button></form>`,element=>{let busy=false;const form=element.querySelector('form');form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;for(const input of form.querySelectorAll('button,input,textarea,select'))input.disabled=true;try{await service.submitReport({targetType:commentId?'comment':'moment',targetId:commentId||post.id,reason:form.elements.reason.value,detail:form.elements.detail.value.trim(),requestId});if(dead)return;ctx.closeDialog();ctx.toast('举报已提交，可在帮助与反馈查看处理结果。');}catch(e){form.querySelector('.lm-editor-error').textContent=errorText(e);form.querySelector('button').disabled=false;}finally{busy=false;}});});
 }
 function handleAction(action,target){
  if(!action?.startsWith('lm-'))return false;const kind=action.slice(3),id=target.dataset.id,p=posts.find(p=>p.id===id);
  if(kind==='compose')void compose();
  else if(kind==='login')void requireAccount().then(()=>load());
  else if(kind==='refresh'||kind==='retry-image')void load();
  else if(kind==='older')void load(true);
  else if(kind==='scope'){scope=target.dataset.scope==='mine'?'mine':'all';generation++;loading=false;more=null;void load();}
  else if(kind==='local')localDrafts();
  else if(kind==='use-local'){const draft=ownDrafts()[Number(target.dataset.index)];if(draft)void compose(draft.text);}
  else if(kind==='remove-image'&&editor&&!editor.busy&&!editor.attempted){editor.images.splice(Number(target.dataset.index),1);saveDraft(editor);showEditor();}
  else if(kind==='new-draft'&&editor&&!editor.busy){const artifact=editor.workbenchFileId?{workbenchFileId:editor.workbenchFileId,fileName:editor.fileName}:null;saveDraft(null);editor=null;void compose(undefined,artifact);}
  else if(kind==='shared-view'){ctx.closeDialog();ctx.onSaved?.();if(active)void load();}
  else if(kind==='comment'&&p)comment(p);
  else if(kind==='delete'&&p?.own)confirm('删除动态','删除后，好友将无法再查看这条动态和照片。',()=>api.remove(id));
  else if(kind==='delete-comment'&&p)confirm('删除评论','这条评论将从朋友圈中移除。',()=>api.removeComment(id,target.dataset.commentId));
  else if(kind==='like'&&p){target.disabled=true;void api.like(id,!p.liked).then(()=>load()).catch(e=>{ctx.toast(errorText(e));target.disabled=false;});}
  else if(kind==='image'&&p){const image=p.images[Number(target.dataset.index)];if(image?.src)modal('动态照片',`<img class="lm-gallery" src="${esc(image.src)}" alt="动态照片">`);}
  else if((kind==='report'||kind==='report-comment')&&p)report(p,target.dataset.commentId);
  return true;
 }
 function routeChanged(route,{ownOnly=false}={}){const next=route==='moments';if(next===active)return;active=next;if(active){scope=ownOnly?'mine':'all';lastOwnOnly=ownOnly;loaded=false;void load();timer=setInterval(()=>{if(!loading&&!dialog&&globalThis.document?.visibilityState!=='hidden')void load();},30000);timer.unref?.();}else{generation++;loading=false;posts=[];api.clear();clearInterval(timer);timer=null;}}
 function visibility(){if(globalThis.document?.visibilityState==='hidden'){generation++;loading=false;posts=[];api.clear();loaded=false;refreshRender();}else if(active&&!dialog)void load();}
 globalThis.document?.addEventListener?.('visibilitychange',visibility);
 return {render,compose,composeArtifact,handleAction,routeChanged,refresh:load,cleanup(){dead=true;generation++;clearInterval(timer);api.dispose();globalThis.document?.removeEventListener?.('visibilitychange',visibility);editor=null;posts=[];}};
}
