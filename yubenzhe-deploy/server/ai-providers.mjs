import {fail,fields} from './social-validation.mjs';

// Extend this catalog together with an audited device-side adapter. Database
// columns deliberately have no enum CHECK that would force another migration.
export const AI_PROVIDER_CATALOG=Object.freeze({codex:Object.freeze({name:'Codex',mode:'tools'}),claude:Object.freeze({name:'Claude',mode:'disabled'}),workb:Object.freeze({name:'WorkB',mode:'disabled'}),ollama:Object.freeze({name:'Ollama',mode:'chat-only'})});
export const AI_PROVIDER_SCAN_MAX_MS=5*60*1000;
const invalid=()=>fail(400,'INVALID_AI_PROVIDERS','AI 工具清单格式或能力组合无效。');
export function checkedProviderId(value){if(typeof value!=='string'||value.trim()!==value||!/^[a-z][a-z0-9-]{1,23}$/.test(value)||!Object.hasOwn(AI_PROVIDER_CATALOG,value))fail(400,'AI_PROVIDER_INVALID','AI 工具标识无效或尚未支持。');return value;}
export function validateAIProviders(input){
 if(!Array.isArray(input)||input.length>8)invalid();const seen=new Set();
 return input.map(item=>{
  fields(item,['id','name','installed','loggedIn','version','reason','executionSupported','executionMode']);
  const id=checkedProviderId(item.id),catalog=AI_PROVIDER_CATALOG[id];
  if(seen.has(id)||typeof item.name!=='string'||item.name.length>60||typeof item.reason!=='string'||item.reason.length>240||/[\x00-\x1f\x7f]/.test(item.name+item.reason)||typeof item.installed!=='boolean'||![true,false,null].includes(item.loggedIn)||typeof item.executionSupported!=='boolean'||!['tools','chat-only','disabled'].includes(item.executionMode))invalid();seen.add(id);
  if(item.version!==null&&(typeof item.version!=='string'||item.version.trim()!==item.version||!/^v?\d{1,4}(?:\.\d{1,4}){1,3}(?:[-+][A-Za-z0-9.-]{1,20})?$/.test(item.version)))invalid();
  if(!item.installed&&(item.loggedIn!==null||item.executionSupported)||item.executionSupported&&(!item.installed||catalog.mode==='disabled'||item.executionMode!==catalog.mode)||!item.executionSupported&&item.executionMode!=='disabled')invalid();
  if(id==='codex'&&item.executionSupported&&item.loggedIn!==true||id==='ollama'&&item.loggedIn!==null)invalid();
  // Never persist CLI output, names, paths, email addresses, tokens or exception
  // text supplied in diagnostic fields. Reconstruct a bounded public diagnosis.
  const reason=!item.installed?'本机未检测到，请在电脑安装后刷新。':item.loggedIn===false?'请在电脑上完成登录。':catalog.mode==='disabled'?'已检测到，执行适配尚未接通。':id==='codex'&&item.loggedIn!==true?'登录状态尚未确认，请在电脑核对。':!item.executionSupported?(id==='ollama'?'请在电脑选择可用的本地模型后刷新。':'电脑上的 AI 暂未就绪，请在电脑核对。'):'';
  return {id,name:catalog.name,installed:item.installed,loggedIn:item.loggedIn,version:item.version,reason,executionSupported:item.executionSupported,executionMode:item.executionMode};
 });
}
export function checkedProvidersReport(status,now){
 if(status.providers===undefined){
  if(status.provider!=='Codex'||status.scannedAt!==undefined)fail(400,'INVALID_AI_STATUS','旧连接器只允许既有 Codex 状态格式。');
  return {providers:[],scannedAt:0};
 }
 if(status.provider!==undefined&&status.provider!=='Codex')checkedProviderId(status.provider);
 if(!Number.isSafeInteger(status.scannedAt)||status.scannedAt<=0||status.scannedAt>now+60000)fail(400,'INVALID_AI_SCAN_TIME','AI 探测时间无效，请在电脑刷新。');
 return {providers:validateAIProviders(status.providers),scannedAt:status.scannedAt};
}
function legacyProvider(current){
 const ready=current.status_code==='ready',installed=['ready','login-required','quota'].includes(current.status_code);
 return {id:'codex',name:'Codex',installed,loggedIn:installed?current.status_code!=='login-required':null,version:null,executionSupported:ready,executionMode:ready?'tools':'disabled',reason:ready?'':current.status_code==='login-required'?'请在电脑上登录 Codex 后重试。':current.status_code==='quota'?'电脑上的 Codex 额度不足，请稍后重试。':'电脑上的 AI 暂未就绪。'};
}
export function readAIProviders(current,now){
 if(!current)return {providers:[],scannedAt:0,legacy:false,stale:false,status:'error'};
 if(current.scanned_at===0&&current.providers==='[]')return {providers:[legacyProvider(current)],scannedAt:0,legacy:true,stale:false,status:current.status_code};
 let providers=[];try{providers=validateAIProviders(JSON.parse(current.providers));}catch{/* Malformed metadata must not reactivate legacy Codex. */}
 const stale=!Number.isSafeInteger(current.scanned_at)||current.scanned_at<=0||current.scanned_at>now+60000||current.scanned_at<=now-AI_PROVIDER_SCAN_MAX_MS;
 const reportedProviders=providers;
 if(stale)providers=providers.map(item=>({...item,executionSupported:false,executionMode:'disabled',reason:'设备探测结果已过期，请在电脑刷新。'}));
 return {providers,reportedProviders,scannedAt:current.scanned_at||0,legacy:false,stale,status:providers.some(item=>item.executionSupported)?'ready':current.status_code==='ready'?'error':current.status_code};
}
export function providerProblem(provider,view,{activeLease=false}={}){
 // A task already admitted while fresh can finish within its original hard
 // deadline while a busy worker probes again. This opt-in is used only after
 // authenticating its exact live connector and lease; it cannot admit new work.
 if(view.stale&&!activeLease)return {code:'AI_PROVIDER_STALE',message:'设备探测结果已过期，请在电脑刷新。'};
 const row=(activeLease?view.reportedProviders||view.providers:view.providers).find(item=>item.id===provider);
 if(!row)return {code:'AI_PROVIDER_UNAVAILABLE',message:'这台电脑未上报所选 AI 工具。'};
 if(view.legacy&&provider==='codex'&&view.status==='quota')return {code:'AI_QUOTA',message:row.reason};
 if(row.installed&&provider==='codex'&&row.loggedIn!==true)return {code:'AI_LOGIN_REQUIRED',message:row.reason};
 if(!row.executionSupported)return {code:AI_PROVIDER_CATALOG[provider]?.mode==='disabled'?'AI_PROVIDER_UNSUPPORTED':provider==='codex'?'AI_NOT_READY':'AI_PROVIDER_UNAVAILABLE',message:row.reason||'所选 AI 工具暂不可用。'};
 return null;
}
