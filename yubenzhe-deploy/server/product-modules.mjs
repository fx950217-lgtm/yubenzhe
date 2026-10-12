import {createGroupDeviceAI} from './group-device-ai.mjs';
import {createPersonalDevices} from './personal-devices.mjs';
import {createDesktopService} from './desktop-service.mjs';
import {createDesktopProvider} from './desktop-provider.mjs';
import {createSocialService} from './social-service.mjs';
import {createSimulationMailAdapter,createInternalPreviewMailAdapter,createMailAdapterFromEnvironment} from './account-mail.mjs';
import {requireInternalPreviewSession,validateInternalPreview} from './internal-preview.mjs';
import {createCommunityService} from './community-service.mjs';
import {createWorkbenchService} from './workbench-service.mjs';
import {fail} from './social-validation.mjs';
import {createProductAdmin} from './product-admin.mjs';
import {createGroupWorkflows} from './group-workflows.mjs';
import {createAIChannel} from './ai-channel.mjs';
import {createAIChannelFiles} from './ai-channel-files.mjs';
export function createProductModules({database,origin,simulation=false,internalPreview=false,now=Date.now,mailAdapter,otpSecret,mailEnv=process.env,desktopProvider,proposalService,paymentVerifier}={}){
 const url=new URL(origin);
 validateInternalPreview({internalPreview,role:'frontend',origin,simulation});
 const testServices=simulation||internalPreview;
 if(simulation&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('M0 simulation must use a loopback origin.');
 let community,workbench,desktop,devices,groupWorkflows,aiChannel,aiChannelFiles,groupDeviceAI;
 const mail=mailAdapter||(internalPreview?createInternalPreviewMailAdapter({origin}):simulation?createSimulationMailAdapter({origin}):createMailAdapterFromEnvironment({env:mailEnv}));
 const social=createSocialService({database,now,
  accessConfig:{origin,mailAdapter:mail,otpSecret:otpSecret??mailEnv.EMAIL_OTP_SECRET,hasFinancialExposure:()=>false},
  profileExtras:id=>community?.profileExtras(id)||{},
  deviceAIMessage:(id,options)=>groupDeviceAI?.describeMessage(id,options)||null,
  workflowMessage:id=>groupWorkflows?.describeMessage(id)||null,
  beforeDeleteAccount:account=>{
   if(groupWorkflows?.getPendingObligations?.(account.id).length)fail(409,'GROUP_WORKFLOWS_PENDING','请先处理群协作任务与待核验付款。');
   if(desktop?.pending(account.id).length)fail(409,'DESKTOPS_PENDING','请先注销已有云电脑并核实完成。');
   if(workbench.getPendingObligations(account.id).length)fail(409,'TASKS_PENDING','请先取消或完成文件任务。');
   if(community.getPendingObligations(account.id).bounties)fail(409,'COMMUNITY_PENDING','请先结束或取消赏金合作。');
  },
  deleteAccountData:account=>{groupDeviceAI?.cleanupOwner(account.id);groupWorkflows?.cleanupDeletedAccount?.(account.id);aiChannelFiles?.cleanupOwner(account.id);devices?.cleanup(account.id);desktop?.cleanup(account.id);community.deleteAccount(account.id);workbench.cleanupDeletedAccount(account.id,{withinTransaction:true});}
 });
 devices=createPersonalDevices({database,socialService:social,now,onDeviceRevoked:id=>aiChannel?.revokeDevice(id)});
 aiChannel=createAIChannel({database,socialService:social,devices,now});
 aiChannelFiles=createAIChannelFiles({authorizeOwner:aiChannel.authorizeOwner,authorizeAgent:aiChannel.authorizeAgent,now});
 aiChannel.setFilesService(aiChannelFiles);
 groupDeviceAI=createGroupDeviceAI({database,socialService:social,devices,aiChannel,now});
 community=createCommunityService({database,socialService:social,now});
 desktop=createDesktopService({database,socialService:social,provider:desktopProvider||createDesktopProvider({database}),now});
 workbench=createWorkbenchService({database,socialService:social,now,enabled:testServices,desktopCapabilities:desktop.capabilities});
 groupWorkflows=createGroupWorkflows({database,socialService:social,workbenchService:workbench,proposalService,paymentVerifier,enabled:testServices,now});
 function handle(request){
  if(internalPreview)requireInternalPreviewSession(request);
  const path=request.path;
  if(path==='group-device-ai'||path.startsWith('group-device-ai/'))return groupDeviceAI.handle(request);
  if(path==='ai-channel'||path.startsWith('ai-channel/'))return aiChannel.handle(request);
  if(path==='group-workflows'||path.startsWith('group-workflows/'))return groupWorkflows.handle(request);
  if(path==='devices'||path.startsWith('devices/'))return devices.handle(request);
  if(path==='assets'||path.startsWith('assets/')||path==='gifts'||path.startsWith('gifts/')||path==='access/funds/activate'){
   social.authenticate(request.token);fail(410,'PLATFORM_ASSETS_REMOVED','旧托管资产入口已移除。链上收付由你自己的钱包签名。');
  }
  if(path==='desktop'||path.startsWith('desktop/'))return desktop.handle(request);
  if(path==='chain-gifts/capabilities'){social.authenticate(request.token);return {custody:false,available:false,featureScope:'social-distribution',network:'BSC testnet',gasSponsorship:false,reason:'聊天分发入口尚未开放；不会签署链上交易。钱包内测合约状态由钱包页面独立查询。'};}
  if(path.startsWith('chain-gifts/')){social.authenticate(request.token);fail(503,'DISTRIBUTION_UNAVAILABLE','活动尚未开放；不会签署链上交易。');}
  if(path.startsWith('community/'))return community.handle(request);
  if(path.startsWith('workbench/'))return workbench.handle(request);
  return social.handle(request);
 }
 let tickInFlight;
 function tick(){if(tickInFlight)return tickInFlight;tickInFlight=Promise.resolve().then(async()=>{devices.maintain();aiChannel.maintain();groupDeviceAI.maintain();if(testServices)workbench.tick();await social.accountAccess.flushNotifications();}).finally(()=>{tickInFlight=null;});return tickInFlight;}
 return {groupDeviceAI,social,community,workbench,desktop,devices,groupWorkflows,aiChannel,aiChannelFiles,operations:createProductAdmin({database,community,now}),mail,handle,tick};
}
