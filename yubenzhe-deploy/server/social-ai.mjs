import { AdminError } from '../upstream/admin/core.mjs';
const fail=(status,code,message)=>{throw new AdminError(status,code,message);};
// Deleted-account tombstones are the durable source of cleanup work. A failed
// sweep retries the same bounded page, including after process restart.
export function createSocialAI({socialService,aiService,maintenanceMs=60000,onCleanupError=()=>{}}={}){
 if(!socialService?.authenticate||!aiService?.handle)throw new Error('Social and AI services are required.');
 let stopped=false,cursor='',flight=null;
 function maintain(){if(stopped)return Promise.resolve();if(flight)return flight;flight=Promise.resolve().then(async()=>{try{const ids=socialService.getDeletedAccountIds({after:cursor,limit:100});for(const id of ids){if(stopped)break;await aiService.purgeOwner('social:'+id);cursor=id;}if(ids.length<100)cursor='';}catch{try{onCleanupError('AI_ACCOUNT_CLEANUP_PENDING');}catch{}}finally{flight=null;}});return flight;}
 const timer=setInterval(()=>{void maintain();},maintenanceMs);timer.unref?.();void maintain();
 return {
  async handle(request){
   if(!request.path?.startsWith('ai/'))return undefined;
   if(stopped)fail(503,'AI_UNAVAILABLE','工作台暂不可用，请稍后重试。');
   const path=request.path.slice(3);if(!/^[a-z0-9/_-]+$/.test(path))fail(404,'NOT_FOUND','工作台入口不存在。');
   const write=request.method==='POST'&&!/\/cancel$/.test(path)&&!/^workspaces\/[^/]+\/actions$/.test(path);
   const account=socialService.assertAIAccess(request.token,{write});
   const assertAuthorized=()=>{const current=socialService.assertAIAccess(request.token,{write});if(current.id!==account.id)fail(401,'ACCOUNT_REQUIRED','账号已切换，请重新登录。');};
   const result=await aiService.handle({role:'frontend',user:{userId:'social:'+account.id},method:request.method,path,input:request.input||{},query:request.query||{},assertAuthorized});
   assertAuthorized();const value=result.value;if(path==='capabilities'&&value)value.identityType='product_account';return value;
  },
  maintain,
  async close(){stopped=true;clearInterval(timer);await flight;},
 };
}
