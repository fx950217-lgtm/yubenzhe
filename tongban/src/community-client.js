export function createCommunityClient(socialClient){
 const request=(path,options)=>{if(!socialClient?.authenticatedRequest)throw Error('请先登录账号。');return socialClient.authenticatedRequest('community/'+path,options)};
 const send=(path,input)=>request(path,{method:'POST',input});
 return {request,capabilities:()=>request('capabilities'),identity:()=>request('identity'),rankings:kind=>request('rankings?kind='+encodeURIComponent(kind)),preferences:input=>send('preferences',input),activity:input=>send('activity',input),bounties:query=>request('bounties?'+new URLSearchParams(query)),bounty:id=>request('bounties/'+encodeURIComponent(id)),publish:input=>send('bounties',input),bountyAction:(id,action,input)=>send('bounties/'+encodeURIComponent(id)+'/'+action,input),providers:query=>request('providers?'+new URLSearchParams(query)),applyProvider:input=>send('providers',input),tokens:()=>request('tokens'),applyToken:input=>send('tokens',input),report:input=>send('reports',input),reports:()=>request('reports')};
}

// Foreground input is only a hint; credited intervals, deduplication, idle timeout
// and the UTC daily cap are controlled by the server. No client duration is sent.
export function createActivityTracker({socialClient,document:doc=globalThis.document,intervalMs=30000,onUpdate=()=>{}}={}){
 const api=createCommunityClient(socialClient);let disposed=false,busy=false,activity=false,lastAccount='',lastVisible=false;
 const visible=()=>doc?.visibilityState!=='hidden';
 function input(event){if(event.isTrusted&&visible())activity=true;}
 async function tick(){if(disposed||busy)return;const account=socialClient?.getProfile?.()?.userId;if(!account){activity=false;lastAccount='';return}if(lastAccount!==account){lastAccount=account;lastVisible=false;}const isVisible=visible();if(!isVisible&&!lastVisible){activity=false;return}lastVisible=isVisible;const active=activity&&isVisible;activity=false;busy=true;try{const result=await api.activity({requestId:crypto.randomUUID(),active,visible:isVisible});if(!disposed&&socialClient.getProfile()?.userId===account)onUpdate(result)}catch{/* Activity never interrupts account or chat use. */}finally{busy=false;}}
 function visibility(){if(!visible())activity=false;void tick();}
 for(const name of ['pointerdown','keydown','wheel'])doc?.addEventListener(name,input,{passive:true});doc?.addEventListener('visibilitychange',visibility);
 const timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();
 return {tick,cleanup(){disposed=true;clearInterval(timer);for(const name of ['pointerdown','keydown','wheel'])doc?.removeEventListener(name,input);doc?.removeEventListener('visibilitychange',visibility)}};
}
