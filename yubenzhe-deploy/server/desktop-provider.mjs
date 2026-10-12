import {createDesktopStore,decodeDesktopCredentialKey} from './desktop-store.mjs';
import {readDesktopConfiguration,DESKTOP_REGIONS,SERVICE_DEFAULTS} from './desktop-config.mjs';
import {fail} from './social-validation.mjs';
const unavailable=()=>({ok:false,code:'DESKTOP_UNCONFIGURED',message:'尚未配置真实云电脑服务商'});
export function createDesktopProvider({database,configuration=readDesktopConfiguration(),transport=null,now=Date.now}={}){
 // A credential file alone cannot activate an unfinished cloud adapter. The
 // injectable transport is an in-process testing / future-adapter seam, never an HTTP option.
 const ready=configuration.valid!==false&&['aws-workspaces','other'].includes(configuration.provider)&&transport&&['provision','getStatus','resetPassword','destroy'].every(method=>typeof transport[method]==='function');
 const region=configuration.region||SERVICE_DEFAULTS.region;
 const store=database?createDesktopStore({database,credentialKey:configuration.credentialKey,now}):null;
 const clients={...SERVICE_DEFAULTS.desktopClients,...configuration.clientDownloadUrls};
 const capabilities=()=>({available:!!ready,provider:configuration.provider||'disabled',protocol:'DCV',region,code:ready?null:'DESKTOP_UNCONFIGURED',reason:ready?'设备需经过服务商确认后交付。':'尚未配置真实云电脑服务商',adapterStage:ready?'injected-transport':'skeleton',billingEnabled:false,independentAccess:!!ready,clientModes:{windows:'native',macos:'native',ios:'web-pwa-unverified',android:'web-pwa-unverified',web:'web-access'},mobileVerified:false});
 if(!ready)return {configured:false,store,capabilities,clientDownloadUrls:clients,provision:unavailable,getStatus:unavailable,resetPassword:unavailable,destroy:unavailable,processNext:async()=>false};
 if(!store)throw Error('Desktop adapter requires persistent storage.');
 const locks=new Set();
 function ensureRegion(value){if(!DESKTOP_REGIONS.includes(value))fail(400,'DESKTOP_INVALID_REGION','请选择已支持的海外区域。');return value;}
 function provision(input){decodeDesktopCredentialKey(configuration.credentialKey);return store.enqueue({...input,provider:configuration.provider,region:ensureRegion(input.region||region)});}
 async function processNext(){
  const job=store.claimJob();if(!job)return false;const desktop=store.find(job.desktop_id);
  try{
   const result=await transport.provision({userId:desktop.user_id,plan:desktop.plan,region:desktop.region,requestId:job.request_id,desktopId:desktop.id,protocol:'DCV',autoStopMinutes:desktop.auto_stop_minutes});
   if(!result||result.state!=='available'||typeof result.providerDesktopId!=='string'||!result.credentials)throw Error('Not confirmed');
   store.transaction(()=>{store.updateState(desktop.id,'available',{expectedVersion:desktop.version,providerDesktopId:result.providerDesktopId,costCents:result.costCents,priceCents:result.priceCents});store.saveCredentials(desktop.id,result.credentials);store.finishJob(job.id,'succeeded');});
  }catch{
   // Network failure may follow successful allocation. Retain the original job
   // and request ID for reconciliation; never buy another machine on a retry.
   store.finishJob(job.id,'unknown','DESKTOP_PROVISION_UNKNOWN');
  }
  return true;
 }
 function getStatus(id){const row=store.find(id);if(!row)fail(404,'DESKTOP_NOT_FOUND','云电脑不存在。');return {state:row.state,raw:store.view(row)};}
 async function exclusive(id,operation){if(locks.has(id))fail(409,'DESKTOP_BUSY','这台云电脑正在处理上一项操作。');locks.add(id);try{return await operation();}finally{locks.delete(id);}}
 async function resetPassword(id,newPassword){
  if(typeof newPassword!=='string'||newPassword.length<8||newPassword.length>64||!/[a-z]/.test(newPassword)||!/[A-Z]/.test(newPassword)||!/[0-9]/.test(newPassword)||!/[~!@#$%^&*_=+.,?-]/.test(newPassword)||/[\s\x00-\x1f\x7f]/.test(newPassword))fail(400,'DESKTOP_INVALID_PASSWORD','密码需 8–64 位并包含大小写字母、数字和符号。');
  return exclusive(id,async()=>{const row=store.find(id);if(!row)fail(404,'DESKTOP_NOT_FOUND','云电脑不存在。');store.active(row);if(!row.provider_desktop_id)fail(409,'DESKTOP_NOT_READY','云电脑尚未交付。');const current=store.credentials(id,row.user_id);
   // Revoke cached credentials before a remote update: an ambiguous result must
   // never present the old password as current. No password is put into jobs/audit.
   store.clearCredentials(id);store.audit(row,'password-reset-requested');
   try{const result=await transport.resetPassword(row.provider_desktop_id,newPassword);if(result?.ok!==true)throw Error();store.saveCredentials(id,{...current,password:newPassword});return {ok:true};}
   catch{fail(503,'DESKTOP_PASSWORD_UNKNOWN','改密结果待核实，请通过官方入口恢复或联系支持。');}
  });
 }
 async function destroy(id){return exclusive(id,async()=>{let row=store.find(id);if(!row)fail(404,'DESKTOP_NOT_FOUND','云电脑不存在。');if(row.state==='terminated')return {ok:true};if(row.state==='terminating')fail(409,'DESKTOP_TERMINATION_PENDING','正在核实注销结果，请勿重复提交。');
  if(!row.provider_desktop_id)fail(409,'DESKTOP_PROVISION_PENDING','请先核实原开通请求，避免遗留云资源。');
  row=store.transaction(()=>store.updateState(id,'terminating',{expectedVersion:row.version}));
  try{const result=await transport.destroy(row.provider_desktop_id);if(result?.ok!==true||result.state!=='terminated')throw Error();store.transaction(()=>store.updateState(id,'terminated',{expectedVersion:row.version}));return {ok:true};}
  catch{fail(503,'DESKTOP_TERMINATION_UNKNOWN','注销结果待核实，尚不能确认云端资源已释放。');}
 });}
 return {configured:true,store,capabilities,clientDownloadUrls:clients,provision,getStatus,resetPassword,destroy,processNext};
}
