import {PUBLIC_DEPLOYMENT} from './deployment-config.js';
import { applyRemoteProfile } from './profile-store.js';
import { isNativeApp } from './native-runtime.js';
const TOKEN_KEY='yubenzhe.account.session.v1',PROFILE_KEY='tongban.profile.v1';
const copy=value=>value===null?null:JSON.parse(JSON.stringify(value));
const clientError=(message,code)=>Object.assign(new Error(message),{code});
export function createSocialClient({baseURL=isNativeApp()?PUBLIC_DEPLOYMENT.previewOrigin:location.origin,native=isNativeApp(),fetcher=globalThis.fetch.bind(globalThis),storage,onChange=()=>{}}={}){
 let accessRecoveryToken='';
 let current=null,token='',generation=0,cacheVersion=0,readSequence=0,storageWarning='',disposed=false;
 const cache=new Map(),media=new Map(),groupRequests=new Map(),pendingMedia=new Map(),reads=new Map(),controllers=new Set();
 try{storage??=globalThis.localStorage;}catch{}
 if(native){try{token=storage.getItem(TOKEN_KEY)||'';if(token&&!/^[-_A-Za-z0-9]{43}$/.test(token)){token='';storage.removeItem(TOKEN_KEY);}}catch{storageWarning='本机无法读取登录状态，请重新登录。';}}
 function assertCurrent(revision){if(disposed||revision!==generation)throw clientError('账号已切换，本次操作结果未应用。','SESSION_CHANGED');}
 function clearMedia(){for(const value of media.values())URL.revokeObjectURL(value);media.clear();pendingMedia.clear();}
 function invalidate(){generation++;cacheVersion++;cache.clear();reads.clear();clearMedia();groupRequests.clear();for(const controller of controllers)controller.abort();}
 function forget(){
  invalidate();token='';current=null;accessRecoveryToken='';
  for(const key of [TOKEN_KEY,PROFILE_KEY])try{storage.removeItem(key);}catch{storageWarning='登录已退出，但本机缓存未能清理，请检查存储权限。';}
  onChange(null);
 }
 function remember(profile){
  const snapshot=copy(profile);
  // Validate separately so a storage quota error does not conceal an invalid
  // server profile, while a valid online account remains usable without a cache.
  applyRemoteProfile(snapshot,{setItem(){}});
  try{applyRemoteProfile(snapshot,storage);}catch{storageWarning||='本机无法缓存个人资料；在线资料已保存在服务器。';}
  current=snapshot;onChange(copy(snapshot));return copy(snapshot);
 }
 function avatarURLs(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
   if(key==='avatarImage'&&typeof item==='string'&&/^\/api\/social\/avatars\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item))value[key]=baseURL+item;
   else if(item&&typeof item==='object')avatarURLs(item);
  }
 }
 async function request(path,{method='GET',input,raw=false}={}){
  const revision=generation;assertCurrent(revision);
  const headers={},url=baseURL+'/api/social/'+path,previous=cache.get(path),cacheRevision=cacheVersion;
  const readId=method==='GET'&&!raw?++readSequence:null;
  if(readId!==null)reads.set(path,readId);
  if(token)headers.Authorization='Bearer '+token;
  if(method==='POST')headers['Content-Type']='application/json';else if(previous?.etag&&!raw)headers['If-None-Match']=previous.etag;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);controllers.add(controller);
  const checkRead=()=>{if(readId!==null&&(cacheRevision!==cacheVersion||reads.get(path)!==readId))throw clientError('数据已更新，本次旧响应未应用，请重试。','STALE_RESPONSE');};
  try{
   let response;
   try{response=await fetcher(url,{method,headers,credentials:native?'omit':'same-origin',body:input===undefined?undefined:JSON.stringify(input),signal:controller.signal});}
   catch(error){assertCurrent(revision);throw clientError(error?.name==='AbortError'?'请求超时，请重试。发送消息时会保留原消息标识，避免重复发送。':'连接失败，请检查网络后重试。','NETWORK_ERROR');}
   assertCurrent(revision);
   if(response.status===304){checkRead();if(!previous||raw)throw clientError('服务器返回了无法复用的缓存结果，请重试。','CACHE_MISSING');return copy(previous.value);}
   if(!response.ok){
    let value;try{value=await response.json();}catch{}
    assertCurrent(revision);
    const error=new Error(value?.error||'服务暂不可用，请稍后重试。');error.code=value?.code;error.status=response.status;
    if(error.code==='ACCOUNT_REQUIRED')forget();
    throw error;
   }
   let value;
   try{value=raw?await response.blob():await response.json();}
   catch(error){assertCurrent(revision);throw clientError(error?.name==='AbortError'?'请求超时，请重试。':'服务器返回的数据无法读取，请稍后重试。','RESPONSE_INVALID');}
   assertCurrent(revision);checkRead();
   if(raw)return value;
   if(native)avatarURLs(value);
   if(method==='GET')cache.set(path,{etag:response.headers.get('etag'),value:copy(value)});
   else{cacheVersion++;cache.clear();reads.clear();}
   return value;
  }finally{clearTimeout(timeout);controllers.delete(controller);}
 }
 function acceptSession(value,revision){
  assertCurrent(revision);applyRemoteProfile(value.profile,{setItem(){}});
  if(native&&(typeof value.token!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(value.token)))throw new Error('服务器未返回有效的原生登录凭证。');
  invalidate();storageWarning='';
  if(native){token=value.token;try{storage.setItem(TOKEN_KEY,token);}catch{storageWarning='本机无法保留登录状态，请保存你的 ID 和密码，下次打开需重新登录。';}}
  return remember(value.profile);
 }
 const post=(path,input={})=>request(path,{method:'POST',input});
 async function hydrateMessage(message,revision){
  assertCurrent(revision);if(!message?.image)return message;
  const image=message.image,key=image.id;if(!/^[a-f0-9-]{36}$/.test(key))throw new Error('图片标识无效。');
  let src=media.get(key);
  if(!src){
   if(!pendingMedia.has(key)){
    const load=(async()=>{
     const blob=await request('media/'+key,{raw:true});assertCurrent(revision);
     if(blob.size>512*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw new Error('图片内容无效。');
     const source=URL.createObjectURL(blob);
     while(media.size>=64){const first=media.keys().next().value;URL.revokeObjectURL(media.get(first));media.delete(first);}
     media.set(key,source);return source;
    })().finally(()=>{if(pendingMedia.get(key)===load)pendingMedia.delete(key);});
    pendingMedia.set(key,load);
   }
   src=await pendingMedia.get(key);
  }
  assertCurrent(revision);return {...message,image:{...image,src}};
 }
 return {
  getProfile:()=>copy(current),
  getPointsAccount:()=>request('points/account'),
  getPointsLedger:({cursor}={})=>request('points/ledger'+(cursor?'?cursor='+encodeURIComponent(cursor):'')),
  authenticatedRequest:(path,options)=>request(path,options),
  publicRequest:(path,options)=>request(path,options),
  clearSession:()=>forget(),
  getAccessRecoveryToken:()=>accessRecoveryToken,
  setAccessRecoveryToken:value=>{accessRecoveryToken=typeof value==='string'?value:'';},
  async verifyEmail(input){const revision=generation;return acceptSession(await post('access/email/verify',{...input,native}),revision);},
  async verifyPasskeyLogin(input){const revision=generation;return acceptSession(await post('access/passkeys/login/verify',{...input,native}),revision);},
  getDiscoveryPreferences:()=>request('discovery/preferences'),
  setDiscoveryPreferences:discoverable=>post('discovery/preferences',{discoverable}),
  discoverPeople:before=>request('discovery/people'+(before?'?before='+encodeURIComponent(before):'')),
  dismissPerson:userId=>post('discovery/dismiss',{userId}),
  greetPerson:input=>post('discovery/greet',input),
  setGroupRole:(id,userId,role)=>post('conversations/'+encodeURIComponent(id)+'/role',{userId,role}),
  silenceMember:(id,userId,minutes)=>post('conversations/'+encodeURIComponent(id)+'/silence',{userId,minutes}),
  respondGroupJoin:(id,requestId,accept)=>post('conversations/'+encodeURIComponent(id)+'/join-respond',{requestId,accept}),
  getBlocks:()=>request('blocks'),
  blockUser:userId=>post('blocks',{userId}),
  unblockUser:userId=>post('blocks/remove',{userId}),
  getReports:()=>request('reports'),
  submitReport:input=>post('reports',input),
  getStorageWarning:()=>storageWarning,
  async initialize(){const revision=generation;try{const value=await request('me');assertCurrent(revision);return remember(value.profile);}catch(error){if(error.code==='ACCOUNT_REQUIRED')return null;throw error;}},
  async register(password,requestId){const revision=generation;return acceptSession(await post('register',{password,requestId,native}),revision);},
  async login(userId,password){const revision=generation;return acceptSession(await post('login',{userId,password,native}),revision);},
  async logout(){const revision=generation;try{await post('logout');}catch(error){if(error.code==='ACCOUNT_REQUIRED')return;throw error;}assertCurrent(revision);forget();},
  async changePassword(currentPassword,newPassword){const revision=generation;return acceptSession(await post('password',{currentPassword,newPassword}),revision);},
  async saveProfile(input){const initial=current,revision=generation;const result=await post('profile',input);assertCurrent(revision);if(current!==initial)throw new Error('账号资料已更新，请重新打开后修改。');return remember(result.profile);},
  async getState(){const revision=generation,result=await request('state');assertCurrent(revision);if(!current||current.userId!==result.profile.userId||current.revision!==result.profile.revision)remember(result.profile);return result;},
  lookup:userId=>request('lookup?userId='+encodeURIComponent(userId)),
  requestFriend:userId=>post('friends/request',{userId}),
  respondFriend:(requestId,accept)=>post('friends/respond',{requestId,accept}),
  async createGroup(input){const revision=generation,key=JSON.stringify({name:input.name.trim(),memberIds:[...new Set(input.memberIds.map(x=>x.trim()))].sort()});let requestId=groupRequests.get(key);if(!requestId){requestId=crypto.randomUUID();groupRequests.set(key,requestId);}const result=await post('groups',{...input,requestId});assertCurrent(revision);if(groupRequests.get(key)===requestId)groupRequests.delete(key);return result;},
  async getMessages(id,{before,after}={}){const revision=generation,result=await request('conversations/'+encodeURIComponent(id)+'/messages'+(before?'?before='+encodeURIComponent(before):after!==undefined?'?after='+encodeURIComponent(after):''));assertCurrent(revision);const messages=await Promise.all(result.messages.map(async message=>{try{return await hydrateMessage(message,revision);}catch(error){assertCurrent(revision);return {...message,image:null,mediaError:error.message};}}));assertCurrent(revision);return {...result,messages};},
  async sendMessage(id,input){const revision=generation,result=await post('conversations/'+encodeURIComponent(id)+'/messages',input);assertCurrent(revision);const message=await hydrateMessage(result.message,revision);assertCurrent(revision);return {message};},
  markRead:(id,input={})=>post('conversations/'+encodeURIComponent(id)+'/read',input),
  updateConversation:(id,input)=>post('conversations/'+encodeURIComponent(id)+'/settings',input),
  removeFriend:userId=>post('friends/remove',{userId}),
  leaveGroup:id=>post('conversations/'+encodeURIComponent(id)+'/leave'),
  inviteMembers:(id,input)=>post('conversations/'+encodeURIComponent(id)+'/invite',input),
  removeMember:(id,userId)=>post('conversations/'+encodeURIComponent(id)+'/remove-member',{userId}),
  transferOwnership:(id,userId)=>post('conversations/'+encodeURIComponent(id)+'/owner',{userId}),
  dispose(){if(disposed)return;disposed=true;invalidate();current=null;token='';}
 };
}
