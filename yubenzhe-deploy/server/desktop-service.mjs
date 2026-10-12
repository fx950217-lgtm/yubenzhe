import {createHash} from 'node:crypto';
import {createDesktopProvider} from './desktop-provider.mjs';
import {fail,fields} from './social-validation.mjs';
export function desktopProofPurpose(action,desktopId,payload={}){
 const normalized=Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='proof').sort(([a],[b])=>a.localeCompare(b)));
 return 'desktop:'+action+':'+createHash('sha256').update(JSON.stringify({desktopId,payload:normalized})).digest('hex');
}
export function createDesktopService({database,socialService,provider=createDesktopProvider({database}),now=Date.now}={}){
 const store=provider.store;
 function configured(){if(!provider.configured)fail(503,'DESKTOP_UNCONFIGURED','尚未配置真实云电脑服务商');}
 function protectedState(account){const s=socialService.accountAccess.getSecurityState(account.id);if(s.protectedUntil>now()||s.riskReviewRequired)fail(403,'DESKTOP_RECOVERY_PROTECTED','账号恢复保护期间不能授权或查看云电脑凭据。');return s;}
 function proof(account,token,purpose,value){protectedState(account);const result=socialService.accountAccess.requireStrongProof(account.id,token,purpose,value);const changed=database.raw.prepare('UPDATE account_strong_proofs SET consumed_at=? WHERE token_hash=? AND consumed_at=0').run(now(),result.id);if(changed.changes!==1)fail(403,'STRONG_PROOF_REQUIRED','验证已使用，请重新确认。');return result;}
 async function handle({method,path,token,input={},proof:headerProof}){
  const account=socialService.assertAIAccess(token,{write:method==='POST'}),route=path.replace(/^desktop\/?/,'');
  if(method==='GET'&&route==='capabilities')return {value:provider.capabilities(),status:200};
  configured();
  if(method==='GET'&&!route)return {value:{desktops:store.list(account.id)},status:200};
  if(method==='POST'&&route==='provision'){
   fields(input,['plan','region','requestId','proof']);const selected={plan:input.plan,region:input.region||provider.capabilities().region,requestId:input.requestId};
   proof(account,token,desktopProofPurpose('provision','new',selected),input.proof);const value=await provider.provision({userId:account.id,...selected});socialService.authenticate(token);return {value,status:202};
  }
  const match=/^([a-f0-9-]{36})(?:\/(credentials|reset-password|terminate))?$/.exec(route);if(!match)fail(404,'DESKTOP_NOT_FOUND','云电脑入口不存在。');
  const [,id,action]=match,row=store.owned(id,account.id);
  if(method==='GET'&&!action)return {value:store.view(row),status:200};
  if(method==='GET'&&action==='credentials'){
   store.active(row);proof(account,token,desktopProofPurpose('credentials',id,{version:row.version}),headerProof||input.proof);const value=store.credentials(id,account.id);store.audit(row,'credentials-revealed');return {value:{...value,clientDownloadUrls:provider.clientDownloadUrls,clientModes:provider.capabilities().clientModes,mobileVerified:false},status:200};
  }
  if(method==='POST'&&['reset-password','terminate'].includes(action)){
   fields(input,action==='reset-password'?['newPassword','proof','version']:['proof','version']);
   if(!Number.isSafeInteger(input.version)||input.version!==row.version)fail(409,'DESKTOP_CHANGED','请刷新云电脑状态后重新确认。');
   const authorization=proof(account,token,desktopProofPurpose(action,id,action==='reset-password'?{newPassword:input.newPassword,version:input.version}:{version:input.version}),input.proof);
   const value=action==='reset-password'?await provider.resetPassword(id,input.newPassword):await provider.destroy(id);
   const current=socialService.authenticate(token),security=protectedState(current);if(security.credentialVersion!==authorization.credentialVersion)fail(403,'DESKTOP_RECOVERY_PROTECTED','账号安全状态已改变，请重新验证操作结果。');return {value,status:200};
  }
  fail(405,'METHOD_NOT_ALLOWED','不支持此请求方式。');
 }
 return {handle,provider,capabilities:provider.capabilities,pending:userId=>store.pending(userId),cleanup:userId=>store.cleanup(userId)};
}
