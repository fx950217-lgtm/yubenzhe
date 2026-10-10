/* Included only in isolated local QA packages, before app.js. */
(()=>{
 'use strict';
 const original=window.fetch.bind(window),pending=new Map();
 const syncShell=event=>{const theme=event?.detail?.theme;if(!['light','dark','eyecare'].includes(theme))return;window.YBZLocalQATheme?.setTheme(theme);window.YBZLocalAndroidQA?.setTheme?.(theme);window.webkit?.messageHandlers?.localQATheme?.postMessage({theme})?.catch?.(()=>{});};
 window.addEventListener('ybz:theme-changed',syncShell);
 const desktop=location.protocol==='yubenzhe:'&&location.host==='app';
 const android=location.origin==='https://localhost'&&typeof window.YBZLocalAndroidQA?.request==='function';
 const ios=location.origin==='http://127.0.0.1:45932'&&typeof window.webkit?.messageHandlers?.localQA?.postMessage==='function';
 const known=['http://127.0.0.1:45932','https://66.42.56.29','yubenzhe://app','https://localhost'];
 function socialPath(value){if(typeof value!=='string'||value.length>2048||/[\\\s#]/.test(value))return null;const origin=known.find(x=>value.startsWith(x+'/api/social/'));if(!origin)return null;const path=value.slice(origin.length),pathname=path.split('?')[0];return /^\/api\/social\/[A-Za-z0-9_/-]*$/.test(pathname)&&!pathname.includes('//')&&!pathname.includes('..')&&(!path.slice(pathname.length)||/^\?[A-Za-z0-9_%=&.+-]{0,512}$/.test(path.slice(pathname.length)))?path:null;}
 Object.defineProperty(window,'__ybzQaReply',{value:(id,result)=>{const task=pending.get(id);if(!task)return;pending.delete(id);clearTimeout(task.timeout);task.cleanup();if(result.error){task.reject(new Error('本机验收服务未连接，请检查本机服务和 USB 通道。'));return;}try{const binary=atob(result.bodyBase64||''),body=Uint8Array.from(binary,c=>c.charCodeAt(0));task.resolve(new Response([204,205,304].includes(result.status)?null:body,{status:result.status,headers:result.headers||{}}));}catch(error){task.reject(error);}},writable:false,configurable:false});
 window.fetch=async(input,init)=>{
  const request=new Request(input,init),path=socialPath(request.url);
  if(!path){if(request.url.startsWith('https://66.42.56.29/'))throw new Error('Local QA cannot access the production service');return original(input,init);}
  if(!['GET','POST'].includes(request.method))throw new Error('QA API method denied');
  if(desktop)return original(new Request('yubenzhe://app'+path,request));
  if(!android&&!ios)throw new Error('Local QA native bridge unavailable');
  if(request.signal.aborted)throw new DOMException('Aborted','AbortError');
  const body=request.method==='POST'?await request.text():'',headers={};request.headers.forEach((value,name)=>{if(['authorization','content-type','if-none-match'].includes(name))headers[name]=value;});
  return new Promise((resolve,reject)=>{const id=crypto.randomUUID(),abort=()=>{const task=pending.get(id);if(!task)return;pending.delete(id);clearTimeout(task.timeout);task.cleanup();reject(new DOMException('Aborted','AbortError'));};const cleanup=()=>request.signal.removeEventListener('abort',abort);const timeout=setTimeout(()=>{pending.delete(id);cleanup();reject(new Error('Local QA API timed out'));},18000);pending.set(id,{resolve,reject,timeout,cleanup});request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted){abort();return;}try{const payload={path,method:request.method,headers,body};if(ios)Promise.resolve(window.webkit.messageHandlers.localQA.postMessage(payload)).then(result=>window.__ybzQaReply(id,result),()=>window.__ybzQaReply(id,{error:'LOCAL_QA_UNAVAILABLE'}));else window.YBZLocalAndroidQA.request(id,JSON.stringify(payload));}catch(error){pending.delete(id);clearTimeout(timeout);cleanup();reject(error);}});
 };
})();
