import {startRegistration,startAuthentication,browserSupportsWebAuthn} from '@simplewebauthn/browser';
let ephemeralDevice='';
export function accountDeviceId(storage){try{storage??=globalThis.localStorage;let id=storage.getItem('yubenzhe.account.device.v1');if(!/^[a-zA-Z0-9_-]{16,100}$/.test(id||'')){id=crypto.randomUUID().replaceAll('-','');storage.setItem('yubenzhe.account.device.v1',id);}return id;}catch{ephemeralDevice||=crypto.randomUUID().replaceAll('-','');return ephemeralDevice;}}
const error=e=>new Error(e?.name==='NotAllowedError'?'验证已取消或设备未完成验证。':e?.message||'通行密钥操作失败，请重试。');
export function createAccountAccessClient(client,{register=startRegistration,authenticate=startAuthentication,supported=browserSupportsWebAuthn,deviceId=accountDeviceId(),isCurrent=()=>true}={}){
 const check=()=>{if(!isCurrent())throw Error('操作已取消。');};
 const post=async(path,input={})=>{check();const result=await client.authenticatedRequest('access/'+path,{method:'POST',input});check();return result;};
 async function strongProof(purpose){if(!supported())throw Error('此设备暂不支持通行密钥，请使用支持的 HTTPS 浏览器。');const challenge=await post('passkeys/options',{purpose});let response;try{response=await authenticate({optionsJSON:challenge.options});}catch(e){throw error(e);}return (await post('passkeys/verify',{challengeId:challenge.challengeId,response})).proof;}
  return {deviceId,capabilities:()=>client.getAccountCapabilities?.()??client.publicRequest('access/capabilities'),state:()=>client.authenticatedRequest('access/security-state'),strongProof,
 requestEmail:(email,requestId=crypto.randomUUID())=>client.publicRequest('access/email/request',{method:'POST',input:{email,requestId,deviceId,locale:globalThis.document?.documentElement?.lang?.startsWith('en')?'en':'zh-CN'}}),
 verifyEmail:(challengeId,code)=>client.verifyEmail({challengeId,code,deviceId}),
 async loginPasskey(){if(!supported())throw Error('此设备暂不支持通行密钥。');const c=await client.publicRequest('access/passkeys/login/options',{method:'POST',input:{deviceId}});let response;try{response=await authenticate({optionsJSON:c.options});}catch(e){throw error(e);}return client.verifyPasskeyLogin({challengeId:c.challengeId,response,deviceId});},
 async registerPasskey(name='我的设备'){if(!supported())throw Error('此设备暂不支持通行密钥。');const s=await client.authenticatedRequest('access/security-state'),input=s.everHadStrongCredential&&s.credentials.length?{proof:await strongProof('security-change')}:{recoveryToken:client.getAccessRecoveryToken?.()||undefined};const c=await post('passkeys/register/options',input);let response;try{response=await register({optionsJSON:c.options});}catch(e){throw error(e);}const result=await post('passkeys/register/verify',{challengeId:c.challengeId,response,name});client.setAccessRecoveryToken?.('');return result;},
 async generateRecovery(){return post('recovery-code',{proof:await strongProof('security-change')});},
 confirmRecovery:recoveryCode=>post('recovery-code/confirm',{recoveryCode}),
 async removePasskey(credentialId){const result=await post('passkeys/remove',{credentialId,proof:await strongProof('security-change')});if(result.accessRecoveryToken)client.setAccessRecoveryToken?.(result.accessRecoveryToken);return result;},
 async requestEmailChange(email){return post('email/change/request',{email,deviceId,requestId:crypto.randomUUID(),proof:await strongProof('security-change')});},
 verifyEmailChange:(challengeId,code)=>post('email/change/verify',{challengeId,code,deviceId}),
 async revokeSession(sessionId,others=false){const s=await client.authenticatedRequest('access/security-state');check();return post('sessions/revoke',{...(others?{others:true}:{sessionId}),...(s.authMode==='email'&&!s.everHadStrongCredential?{}:{proof:await strongProof('security-change')})});}
 };
}
export const getStrongProof=(client,purpose)=>createAccountAccessClient(client).strongProof(purpose);

export const requestStrongProof=getStrongProof;
