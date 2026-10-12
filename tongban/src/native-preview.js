import {PUBLIC_DEPLOYMENT} from './deployment-config.js';
export const PREVIEW_ORIGIN=PUBLIC_DEPLOYMENT.previewOrigin;
export function nativePreviewBridge(env=globalThis){
 if(env.YubenzheDesktop?.platform==='windows')return env.YubenzheDesktop.internalPreview||null;
 if(env.Capacitor?.getPlatform?.()==='android')return env.Capacitor.Plugins?.InternalPreview||null;
 return null;
}
export function nativePreviewPath(input,base='https://localhost'){
 const value=typeof input==='string'?input:input?.url;
 if(typeof value!=='string')return null;
 let raw=value;
 if(value.startsWith(PREVIEW_ORIGIN+'/'))raw=value.slice(PREVIEW_ORIGIN.length);
 else if(!value.startsWith('/api/'))return null;
 if(raw==='/api/chain-preview/config')return raw;
 if(!/^\/api\/social\/[A-Za-z0-9_/-]+(?:\?[^#\s]*)?$/.test(raw)||raw.split('?')[0].includes('//'))return null;
 const u=new URL(raw,PREVIEW_ORIGIN);return u.origin===PREVIEW_ORIGIN?raw:null;
}
function abortError(){return new DOMException('请求已取消','AbortError');}
export function createNativePreviewFetch({bridge,fetcher=globalThis.fetch.bind(globalThis),onRequired=()=>{}}){
 return async function(input,init={}){
  const path=nativePreviewPath(input);
  if(!path)return fetcher(input,init);
  const method=String(init.method||input?.method||'GET').toUpperCase(),signal=init.signal||input?.signal;
  if(signal?.aborted)throw abortError();
  if(!['GET','POST'].includes(method)||path==='/api/chain-preview/config'&&method!=='GET')throw Error('客户端不支持此请求。');
  const headers=Object.fromEntries(new Headers(init.headers||input?.headers||{}));
  const body=init.body;
  if(body!==undefined&&typeof body!=='string')throw Error('客户端仅支持文本请求。');
  let result,abort;
  const request=Promise.resolve().then(()=>bridge.request({path,method,headers,...(body!==undefined?{body}:{})}));
  try{result=await(signal?Promise.race([request,new Promise((_,reject)=>{abort=()=>reject(abortError());signal.addEventListener('abort',abort,{once:true});})]):request);}finally{if(abort)signal.removeEventListener('abort',abort);}
  if(signal?.aborted)throw abortError();
  if(!result||!Number.isInteger(result.status)||result.status<200||result.status>599||typeof result.bodyBase64!=='string'||result.bodyBase64.length>23*1024*1024)throw Error('客户端返回内容无效。');
  const bytes=Uint8Array.from(atob(result.bodyBase64),c=>c.charCodeAt(0));
  const response=new Response([204,205,304].includes(result.status)?null:bytes,{status:result.status,headers:result.headers||{}});
  if(result.status===401){try{const value=JSON.parse(new TextDecoder().decode(bytes));if(value.code==='INTERNAL_PREVIEW_REQUIRED')onRequired();}catch{}}
  return response;
 };
}
export function installNativeAvatars({fetcher=globalThis.fetch,root=document.body}={}){
 const entries=new Map();let stopped=false;
 const avatarPath=value=>{const path=nativePreviewPath(value);return path&&/^\/api\/social\/avatars\/[a-f0-9-]{36}$/.test(path)?path:null;};
 function prune(){for(const [key,entry]of entries){for(const img of entry.images)if(!img.isConnected)entry.images.delete(img);if(!entry.images.size&&entry.src){URL.revokeObjectURL(entry.src);entries.delete(key);}}}
 function hydrate(img){
  const original=img.getAttribute('src'),path=avatarPath(original);if(!path||img.dataset.previewAvatarLoading===path)return;
  img.dataset.previewAvatarLoading=path;
  let entry=entries.get(path);
  if(!entry){entry={images:new Set(),src:null};entries.set(path,entry);entry.promise=(async()=>{const r=await fetcher(PREVIEW_ORIGIN+path,{method:'GET'});if(!r.ok)throw Error('头像不可用');const blob=await r.blob();if(blob.size>512*1024||!['image/png','image/jpeg','image/webp'].includes(blob.type))throw Error('头像格式无效');if(stopped)throw Error('页面已关闭');entry.src=URL.createObjectURL(blob);return entry.src;})().catch(()=>{entries.delete(path);return null;});}
  entry.images.add(img);entry.promise.then(src=>{delete img.dataset.previewAvatarLoading;if(stopped||!img.isConnected||img.getAttribute('src')!==original)return;if(src)img.src=src;});
 }
 function scan(node){if(node.nodeType!==1)return;if(node.tagName==='IMG')hydrate(node);for(const img of node.querySelectorAll('img[src]'))hydrate(img);}
 const observer=new MutationObserver(records=>{prune();for(const r of records){if(r.type==='attributes')hydrate(r.target);else for(const node of r.addedNodes)scan(node);}});
 observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});scan(root);
 return()=>{stopped=true;observer.disconnect();for(const e of entries.values())if(e.src)URL.revokeObjectURL(e.src);entries.clear();};
}
export function mountNativePreviewGate(root,{bridge,loading=false,error='',onReady=()=>{}}){
 let alive=true;
 root.innerHTML='<main class="native-preview-gate"><div class="native-preview-card"><span class="native-preview-brand">YBZ · 愚笨者</span><h1>内部体验</h1><p>输入内部访问凭证后，使用自己的产品账号。钱包密钥继续保存在本机。</p><form><label class="field">内部账号<input name="username" autocomplete="username" maxlength="40" required></label><label class="field">访问密码<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label><p class="form-error" role="alert"></p><button type="submit" class="primary">进入内部预览</button></form><small>仅供内部体验 · BSC 测试网</small></div></main>';
 const form=root.querySelector('form'),message=form.querySelector('[role="alert"]'),button=form.querySelector('button');message.textContent=error;button.disabled=loading;button.textContent=loading?'正在检查访问状态…':'进入内部预览';
 form.onsubmit=async event=>{event.preventDefault();if(button.disabled)return;button.disabled=true;message.textContent='';let password=form.elements.password.value;form.elements.password.value='';try{const result=await bridge.login({username:form.elements.username.value.trim(),password});if(result?.authenticated!==true)throw Error('无法确认内部访问权限。');if(alive)await onReady();}catch(e){if(alive)message.textContent=e.message||'验证未完成，请重试。';}finally{password='';if(alive)button.disabled=false;}};
 return()=>{alive=false;};
}
