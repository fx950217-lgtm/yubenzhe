
export function localDeadline({expiresAt,serverTime,receivedAt,roundTrip}){
 if(![expiresAt,serverTime,receivedAt,roundTrip].every(Number.isFinite)||roundTrip<0)return 0;
 return receivedAt+Math.max(0,Math.min(600000,expiresAt-serverTime)-roundTrip);
}

// A device's wall clock is not the relay's clock. Use one authenticated HTTPS
// Date sample and monotonic elapsed time; never renew a cached provider scan.
export function createRelayScanClock({origin,fetchImpl=globalThis.fetch,clock=()=>performance.now()}={}){
 const invalid=()=>Object.assign(new Error('中转服务时间尚未核验。'),{code:'AI_RELAY_CLOCK_UNAVAILABLE'});
 let url;try{url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)throw Error();}catch{throw invalid();}
 let anchor=null,pending=null;
 return {
  async synchronize(){
   if(anchor)return;if(pending)return pending;
   pending=(async()=>{
    const before=clock(),target=origin+'/healthz';let response;
    try{
     response=await fetchImpl(target,{method:'GET',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',headers:{'Cache-Control':'no-store'},signal:AbortSignal.timeout(10000)});
     const after=clock(),raw=response.headers?.get('Date'),serverTime=Date.parse(raw||'');
     if(!response.ok||response.redirected||response.url&&response.url!==target||!Number.isFinite(before)||!Number.isFinite(after)||after<before||after-before>10000||!Number.isSafeInteger(serverTime)||serverTime<=0||new Date(serverTime).toUTCString()!==raw||Number(response.headers?.get('Age')||0)!==0)throw invalid();
     // Date has one-second precision. Anchoring its lower bound on receipt is
     // conservative: at most RTT + 1s old and never deliberately in the future.
     anchor={serverTime,monotonic:after};
    }catch(error){if(error.code==='AI_RELAY_CLOCK_UNAVAILABLE')throw error;throw Object.assign(invalid(),{cause:error});}
    finally{await response?.body?.cancel().catch(()=>{});}
   })().finally(()=>{pending=null;});return pending;
  },
  timestamp(){const now=clock();if(!anchor||!Number.isFinite(now)||now<anchor.monotonic)throw invalid();return Math.floor(anchor.serverTime+now-anchor.monotonic);}
 };
}
