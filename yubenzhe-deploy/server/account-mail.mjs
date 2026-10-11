import {randomUUID} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
export function createDisabledMailAdapter(){return {mode:'disabled',async send(){throw new Error('Email delivery is not configured.')}};}
export function createSimulationMailAdapter({origin}={}){
 const url=new URL(origin);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Simulation mail requires an explicit loopback origin.');
 return simulationMail(url.origin,'loopback');
}
export function createInternalPreviewMailAdapter({origin}={}){
 const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw Error('Internal preview mail requires an explicit HTTPS origin.');
 return simulationMail(url.origin,'internal-preview');
}
function simulationMail(origin,scope){const outbox=[];return {mode:'simulation',scope,origin,async send(message){outbox.push({...message,id:randomUUID()});if(outbox.length>100)outbox.shift();},readOutbox:()=>outbox.map(m=>({...m})),clear:()=>{outbox.length=0}};}
// A delivery provider implements {mode:'provider',send({to,kind,code,expiresAt,locale})}.
// A production provider and OTP HMAC secret must be explicitly injected; no network is used by default.

// These plain-text payloads are a neutral HTTP gateway contract, not a vendor SDK.
const mailConfigurationError=()=>new Error('Invalid HTTP email configuration.');
function mailAddress(value){
 if(typeof value!=='string'||value.length>254)throw new Error('Invalid email address.');
 const address=value.trim().toLowerCase();
 if(!/^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(address)||address.split('@')[0].length>64)throw new Error('Invalid email address.');
 return address;
}
function mailText({kind,code,expiresAt,locale}){
 const english=locale==='en';
 if(kind==='otp'){
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!Number.isSafeInteger(expiresAt)||expiresAt<=0||expiresAt>8640000000000000)throw new Error('Invalid email message.');
  const expiry=new Date(expiresAt).toISOString();
  return english?{subject:'YBZ verification code',text:'Your YBZ verification code: '+code+'\nValid until: '+expiry+' (UTC)\nIf you did not request this code, please ignore this email.'}:{subject:'愚笨者验证码',text:'你的愚笨者验证码：'+code+'\n有效期至：'+expiry+'（UTC）\n如果不是你本人操作，请忽略此邮件。'};
 }
 if(kind==='security-notice')return english?{subject:'YBZ account security notice',text:'Your YBZ account security settings have changed. If you did not make this change, open YBZ directly and review your account security.'}:{subject:'愚笨者账号安全提醒',text:'你的愚笨者账号安全设置已发生变更。如果不是你本人操作，请直接打开愚笨者，检查账号安全设置。'};
 throw new Error('Invalid email message.');
}
export function createHttpMailAdapter({endpoint,apiKey,from,timeoutMs=10000,fetchImpl=fetch}={}){
 let url;try{url=new URL(endpoint);}catch{throw mailConfigurationError();}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||typeof apiKey!=='string'||apiKey.length<16||apiKey.length>8192||!/^[\x21-\x7e]+$/.test(apiKey)||!Number.isFinite(timeoutMs)||timeoutMs<=0||typeof fetchImpl!=='function')throw mailConfigurationError();
 const sender=mailAddress(from),target=url.href,timeout=Math.min(timeoutMs,10000);
 return {mode:'provider',async send(message={}){
  const recipient=mailAddress(message.to),content=mailText(message),controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);timer.unref?.();
  try{
   const response=await fetchImpl(target,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({from:sender,to:recipient,...content}),signal:controller.signal});
   // Never consume or log a provider body: it may echo credentials or the OTP.
   await response.body?.cancel();
   if(!response.ok)throw new Error('Email delivery was not accepted.');
   return {accepted:true};
  }catch{
   throw new Error(controller.signal.aborted?'Email delivery timed out.':'Email delivery failed.');
  }finally{clearTimeout(timer);}
 }};
}
export function createMailAdapterFromEnvironment({env=process.env,fetchImpl=fetch,fileSystem={readFileSync,statSync}}={}){
 const selected=env.EMAIL_PROVIDER||'disabled';
 if(selected==='disabled')return undefined;
 if(selected!=='http')throw new Error('Unsupported EMAIL_PROVIDER.');
 if(typeof env.EMAIL_OTP_SECRET!=='string'||env.EMAIL_OTP_SECRET.length<32)throw new Error('Provider mail requires a persistent EMAIL_OTP_SECRET of at least 32 characters.');
 let apiKey=typeof env.EMAIL_API_KEY==='string'?env.EMAIL_API_KEY.trim():'';
 if(env.EMAIL_API_KEY_FILE){
  try{
   const info=fileSystem.statSync(env.EMAIL_API_KEY_FILE);
   if(!info.isFile()||info.size>8192||(info.mode&0o077))throw new Error();
   apiKey=fileSystem.readFileSync(env.EMAIL_API_KEY_FILE,'utf8').trim();
  }catch{throw new Error('Invalid EMAIL_API_KEY_FILE; require a private regular file.');}
 }
 return createHttpMailAdapter({endpoint:env.EMAIL_ENDPOINT,apiKey,from:env.EMAIL_FROM,fetchImpl});
}
