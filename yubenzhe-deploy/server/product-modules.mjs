import {getAddress,verifyMessage} from 'ethers';
import {createSocialService} from './social-service.mjs';
import {createSimulationMailAdapter} from './account-mail.mjs';
import {createPlatformAssets} from './platform-assets.mjs';
import {createCommunityService} from './community-service.mjs';
import {createWorkbenchService} from './workbench-service.mjs';
import {fail} from './social-validation.mjs';
export function createProductModules({database,origin,simulation=false,now=Date.now,mailAdapter,otpSecret}={}){
 const url=new URL(origin);
 if(simulation&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('M0 simulation must use a loopback origin.');
 let assets,community,workbench;
 const mail=mailAdapter||(simulation?createSimulationMailAdapter({origin}):undefined);
 const social=createSocialService({database,now,
  accessConfig:{origin,mailAdapter:mail,otpSecret,hasFinancialExposure:id=>assets.hasFinancialExposure(id)},
  profileExtras:id=>community?.profileExtras(id)||{},
  assetMessage:id=>assets?.messageReference?.(id)||null,
  beforeDeleteAccount:account=>{
   if(assets.hasFinancialExposure(account.id))fail(409,'ASSETS_PENDING','请先处理平台余额、红包或未完成的资金订单。');
   if(workbench.getPendingObligations(account.id).length)fail(409,'TASKS_PENDING','请先取消或完成文件任务。');
   if(community.getPendingObligations(account.id).bounties)fail(409,'COMMUNITY_PENDING','请先结束或取消赏金合作。');
  },
  deleteAccountData:account=>{community.deleteAccount(account.id);workbench.cleanupDeletedAccount(account.id,{withinTransaction:true});}
 });
 assets=createPlatformAssets({database,socialService:social,clock:now,origin,enabled:simulation,localOnly:simulation,walletVerifier:{getAddress,verifyMessage},developmentAdapter:simulation?{mode:'simulation',async broadcast(){throw Error('No automatic settlement; use explicit local reconciliation.');}}:null,community:{assertBountyPayment:input=>community.assertBountyPayment(input)}});
 community=createCommunityService({database,socialService:social,now,getBountyPayments:input=>assets.getBountyPayments(input),getRankBalances:input=>assets.getRankBalances(input)});
 workbench=createWorkbenchService({database,socialService:social,now,enabled:simulation});
 if(simulation){assets.development.registerAsset({id:'SIM-USD',kind:'stable',decimals:6});assets.development.registerAsset({id:'SIM-FUN',kind:'fun',decimals:6});}
 function handle(request){if(request.path.startsWith('assets/')||request.path==='gifts'||request.path.startsWith('gifts/'))return assets.handle(request);if(request.path.startsWith('community/'))return community.handle(request);if(request.path.startsWith('workbench/'))return workbench.handle(request);return social.handle(request);}
 let tickInFlight;
 function tick(){
  if(tickInFlight)return tickInFlight;
  tickInFlight=Promise.resolve().then(async()=>{
   if(simulation){assets.expire();assets.flushOutbox();workbench.tick();}
   await social.accountAccess.flushNotifications();
  }).finally(()=>{tickInFlight=null;});
  return tickInFlight;
 }
 return {social,assets,community,workbench,mail,handle,tick};
}
