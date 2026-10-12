import {providerId} from './device-ai-providers.js';
export const MAIN_NAV = Object.freeze([
  ['messages','message','消息'],['discover','discover','发现'],['workbench','spark','工作台'],['wallet','wallet','钱包'],['mine','user','我的'],
]);
export const WORKBENCH_FEATURES = Object.freeze(['bounty','provider','rank','token','ai','business','token-projects']);
const routeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:null;
const discoveryRoutes = new Set(['hub','moments','people','favorites','drafts',...WORKBENCH_FEATURES]);
const hubScreens = new Set(['home','workflows','detail','devices','connections','creator','tasks','chat-cloud','chat-local']);
export const isAppView = view => MAIN_NAV.some(item=>item[0]===view)||view==='contacts'||view==='bills';
export function normalizedHubState(value={}) {
 const mode=value?.mode==='chat'?'chat':'work';
 const candidate=hubScreens.has(value?.screen)?value.screen:'home';
 const screen=mode==='chat'?(['chat-cloud','chat-local'].includes(candidate)?candidate:'home'):(candidate.startsWith('chat-')?'home':candidate);
 const selected=screen==='detail'&&['orders','meeting','launch','research'].includes(value?.selected)?value.selected:null;
 return {mode,screen:screen==='detail'&&!selected?'workflows':screen,selected};
}
export function normalizeNavigation(view,options={}) {
 const safe=options&&typeof options==='object'?{...options}:{};
 if(view==='discover'&&WORKBENCH_FEATURES.includes(safe.route))return {view:'workbench',options:{route:safe.route}};
  if(['workbench','messages'].includes(view)&&safe.route==='ai-channel'&&routeId(safe.deviceId))return {view,options:{route:'ai-channel',deviceId:routeId(safe.deviceId),...(providerId(safe.provider)?{provider:safe.provider}:{}),...(view==='messages'&&routeId(safe.returnConversationId)?{returnConversationId:safe.returnConversationId}:{})}};
  if(view==='messages'&&safe.route==='ai-channel')return {view,options:{}};
 if(view==='messages'&&safe.route==='device-ai'&&routeId(safe.conversationId))return {view,options:{route:'device-ai',conversationId:safe.conversationId}};
 if(view==='workbench'&&safe.route==='cooperation')return {view,options:{route:'cooperation',conversationId:routeId(safe.conversationId),workflowId:routeId(safe.workflowId)}};
 if(view==='workbench'&&!WORKBENCH_FEATURES.includes(safe.route))return {view,options:{hub:normalizedHubState(safe.hub)}};
 if(view==='discover')return {view,options:{...safe,route:discoveryRoutes.has(safe.route)?safe.route:'hub',origin:safe.origin==='mine'?'mine':'discover'}};
 return {view:isAppView(view)?view:'messages',options:safe};
}
export function hashForView(view,options={}) {
 if(['workbench','messages'].includes(view)&&options.route==='ai-channel'&&routeId(options.deviceId))return '#'+view+'/devices/'+options.deviceId+'/chat'+(providerId(options.provider)?'/ai/'+options.provider:'')+(view==='messages'&&routeId(options.returnConversationId)?'/from/'+options.returnConversationId:'');
 if(view==='messages'&&options.route==='device-ai'&&routeId(options.conversationId))return '#messages/'+options.conversationId+'/device-ai';
 if(view==='messages'&&routeId(options.conversationId))return '#messages/'+options.conversationId;
 if(view==='workbench'&&options.route==='cooperation')return '#workbench/cooperation'+(routeId(options.conversationId)?'/'+options.conversationId:'')+(routeId(options.workflowId)?'/'+options.workflowId:'');
 if(view==='wallet')return '#wallet';
 if(view==='discover') {
  if(WORKBENCH_FEATURES.includes(options.route))return '#workbench/'+options.route;
  const route=discoveryRoutes.has(options.route)?options.route:'hub';
  if(options.origin==='mine'&&['favorites','drafts','moments'].includes(route))return '#mine/'+route;
  return route==='hub'?'#discover':'#discover/'+route;
 }
 if(view==='workbench') {
  if(WORKBENCH_FEATURES.includes(options.route))return '#workbench/'+options.route;
  const hub=normalizedHubState(options.hub),prefix=hub.mode==='chat'?'#workbench/chat':'#workbench';
  return prefix+(hub.screen==='home'?'':'/'+hub.screen)+(hub.selected?'/'+hub.selected:'');
 }
 return '#'+(isAppView(view)?view:'messages');
}
export function navigationFromHash(hash) {
 const value=String(hash||'').replace(/^#/,'');
 if(value==='mine/assets')return {view:'wallet',options:{}};
 if(['mine/favorites','mine/drafts','mine/moments'].includes(value))return {view:'discover',options:{route:value.split('/')[1],origin:'mine'}};
 const parts=value.split('/');
  if(['workbench','messages'].includes(parts[0])&&parts[1]==='devices'&&parts[3]==='chat'){
   const tail=parts.slice(4);let provider,returnConversationId;
   if(tail[0]==='ai'&&providerId(tail[1])){provider=tail[1];tail.splice(0,2);}
   if(parts[0]==='messages'&&tail[0]==='from'&&routeId(tail[1])){returnConversationId=tail[1];tail.splice(0,2);}
   if(!tail.length&&routeId(parts[2]))return normalizeNavigation(parts[0],{route:'ai-channel',deviceId:parts[2],provider,returnConversationId});
   return normalizeNavigation(parts[0],{});
  }
 if(parts.length===3&&parts[0]==='messages'&&parts[2]==='device-ai'&&routeId(parts[1]))return normalizeNavigation('messages',{route:'device-ai',conversationId:parts[1]});
 if(parts[0]==='messages'&&routeId(parts[1]))return {view:'messages',options:{conversationId:parts[1]}};
 if(parts[0]==='workbench'&&parts[1]==='cooperation')return normalizeNavigation('workbench',{route:'cooperation',conversationId:parts[2],workflowId:parts[3]});
 if(parts[0]==='discover')return normalizeNavigation('discover',{route:parts[1]||'hub'});
 if(parts[0]==='workbench') {
  if(WORKBENCH_FEATURES.includes(parts[1]))return {view:'workbench',options:{route:parts[1]}};
  const chat=parts[1]==='chat';
  return normalizeNavigation('workbench',{hub:{mode:chat?'chat':'work',screen:parts[chat?2:1]||'home',selected:parts[chat?3:2]}});
 }
 return {view:isAppView(value)?value:'messages',options:{}};
}
export const viewFromHash=hash=>navigationFromHash(hash).view;
export function activeNavView(view,billOrigin='mine',options={}) {
 const parent=view==='bills'?billOrigin:view;
 if(parent==='contacts')return 'messages';
 if(parent==='discover'&&options.origin==='mine')return 'mine';
 return MAIN_NAV.some(item=>item[0]===parent)?parent:'mine';
}
