import {createSocialService} from './social-service.mjs';
import {createSimulationMailAdapter,createInternalPreviewMailAdapter} from './account-mail.mjs';
import {requireInternalPreviewSession,validateInternalPreview} from './internal-preview.mjs';
import {createPointsService} from './points-service.mjs';
import {createCommunityService} from './community-service.mjs';
import {createWorkbenchService} from './workbench-service.mjs';
import {fail} from './social-validation.mjs';
import {createProductAdmin} from './product-admin.mjs';
export function createProductModules({database,origin,simulation=false,internalPreview=false,now=Date.now,mailAdapter,otpSecret}={}){
 const url=new URL(origin);
 validateInternalPreview({internalPreview,role:'frontend',origin,simulation});
 const testServices=simulation||internalPreview;
 if(simulation&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('M0 simulation must use a loopback origin.');
 let points,community,workbench;
 const mail=mailAdapter||(internalPreview?createInternalPreviewMailAdapter({origin}):simulation?createSimulationMailAdapter({origin}):undefined);
 const social=createSocialService({database,now,
  accessConfig:{origin,mailAdapter:mail,otpSecret,hasFinancialExposure:()=>false},
  profileExtras:id=>community?.profileExtras(id)||{},
  beforeDeleteAccount:account=>{
   if(workbench.getPendingObligations(account.id).length)fail(409,'TASKS_PENDING','请先取消或完成文件任务。');
   if(points.hasReservations?.(account.id))fail(409,'POINTS_PENDING','请先结束仍占用积分的服务订单。');
   if(community.getPendingObligations(account.id).bounties)fail(409,'COMMUNITY_PENDING','请先结束或取消赏金合作。');
  },
  deleteAccountData:account=>{community.deleteAccount(account.id);workbench.cleanupDeletedAccount(account.id,{withinTransaction:true});points.closeAccount?.(account.id,{withinTransaction:true});}
 });
 points=createPointsService({database,socialService:social,enabled:testServices,now});
 community=createCommunityService({database,socialService:social,now});
 workbench=createWorkbenchService({database,socialService:social,now,enabled:testServices,pointsService:points});
 function handle(request){
  if(internalPreview)requireInternalPreviewSession(request);
  const path=request.path;
  if(path==='assets'||path.startsWith('assets/')||path==='gifts'||path.startsWith('gifts/')||path==='access/funds/activate'){
   social.authenticate(request.token);fail(410,'PLATFORM_ASSETS_REMOVED','平台托管余额与内部红包已移除。链上收付由你自己的钱包签名；积分仅用于平台服务。');
  }
  if(path.startsWith('points/'))return points.handle(request);
  if(path==='chain-gifts/capabilities'){social.authenticate(request.token);return {custody:false,available:false,featureScope:'social-distribution-and-point-campaigns',network:'BSC testnet',gasSponsorship:false,pointsRedemption:false,reason:'聊天分发与积分活动入口尚未开放；不会扣积分或签署链上交易。钱包内测合约状态由钱包页面独立查询。'};}
  if(path.startsWith('chain-gifts/')||path.startsWith('point-campaigns/')){social.authenticate(request.token);fail(503,'DISTRIBUTION_UNAVAILABLE','活动尚未开放；不会扣积分或签署链上交易。');}
  if(path.startsWith('community/'))return community.handle(request);
  if(path.startsWith('workbench/'))return workbench.handle(request);
  return social.handle(request);
 }
 let tickInFlight;
 function tick(){if(tickInFlight)return tickInFlight;tickInFlight=Promise.resolve().then(async()=>{if(testServices)workbench.tick();await social.accountAccess.flushNotifications();}).finally(()=>{tickInFlight=null;});return tickInFlight;}
 return {social,points,community,workbench,operations:createProductAdmin({database,community,now}),mail,handle,tick};
}
