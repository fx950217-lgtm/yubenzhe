export const MAIN_NAV = Object.freeze([
  ['workbench','spark','工作台'],['messages','message','消息'],['wallet','wallet','钱包'],['discover','discover','发现'],['mine','user','我的'],
]);
export const WORKBENCH_FEATURES = Object.freeze(['bounty','provider','rank','token','ai','business','token-projects']);
const routeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)?value:null;
const discoveryRoutes = new Set(['hub','moments','people','favorites','drafts',...WORKBENCH_FEATURES]);
const hubScreens = new Set(['home','workflows','detail','devices','connections','creator','tasks','chat-cloud','chat-local']);
export const isAppView = view => MAIN_NAV.some(item=>item[0]===view)||view==='contacts'||view==='bills'||view==='points';
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
 if(view==='workbench'&&safe.route==='ai-channel'&&routeId(safe.deviceId))return {view,options:{route:'ai-channel',deviceId:routeId(safe.deviceId)}};
 if(view==='workbench'&&safe.route==='cooperation')return {view,options:{route:'cooperation',conversationId:routeId(safe.conversationId),workflowId:routeId(safe.workflowId)}};
 if(view==='workbench'&&!WORKBENCH_FEATURES.includes(safe.route))return {view,options:{hub:normalizedHubState(safe.hub)}};
 if(view==='discover')return {view,options:{...safe,route:discoveryRoutes.has(safe.route)?safe.route:'hub',origin:safe.origin==='mine'?'mine':'discover'}};
 return {view:isAppView(view)?view:'workbench',options:safe};
}
export function hashForView(view,options={}) {
 if(view==='workbench'&&options.route==='ai-channel'&&routeId(options.deviceId))return '#workbench/devices/'+options.deviceId+'/chat';
 if(view==='messages'&&routeId(options.conversationId))return '#messages/'+options.conversationId;
 if(view==='workbench'&&options.route==='cooperation')return '#workbench/cooperation'+(routeId(options.conversationId)?'/'+options.conversationId:'')+(routeId(options.workflowId)?'/'+options.workflowId:'');
 if(view==='wallet')return '#wallet';
 if(view==='points')return '#workbench/points';
 if(view==='discover') {
  if(WORKBENCH_FEATURES.includes(options.route))return '#workbench/'+options.route;
  const route=discoveryRoutes.has(options.route)?options.route:'hub';
  if(options.origin==='mine'&&['favorites','drafts'].includes(route))return '#mine/'+route;
  return route==='hub'?'#discover':'#discover/'+route;
 }
 if(view==='workbench') {
  if(WORKBENCH_FEATURES.includes(options.route))return '#workbench/'+options.route;
  const hub=normalizedHubState(options.hub),prefix=hub.mode==='chat'?'#workbench/chat':'#workbench';
  return prefix+(hub.screen==='home'?'':'/'+hub.screen)+(hub.selected?'/'+hub.selected:'');
 }
 return '#'+(isAppView(view)?view:'workbench');
}
export function navigationFromHash(hash) {
 const value=String(hash||'').replace(/^#/,'');
 if(value==='mine/assets')return {view:'wallet',options:{}};
 if(['mine/points','workbench/points'].includes(value))return {view:'points',options:{}};
 if(['mine/favorites','mine/drafts'].includes(value))return {view:'discover',options:{route:value.split('/')[1],origin:'mine'}};
 const parts=value.split('/');
 if(parts.length===4&&parts[0]==='workbench'&&parts[1]==='devices'&&parts[3]==='chat')return normalizeNavigation('workbench',{route:'ai-channel',deviceId:parts[2]});
 if(parts[0]==='messages'&&routeId(parts[1]))return {view:'messages',options:{conversationId:parts[1]}};
 if(parts[0]==='workbench'&&parts[1]==='cooperation')return normalizeNavigation('workbench',{route:'cooperation',conversationId:parts[2],workflowId:parts[3]});
 if(parts[0]==='discover')return normalizeNavigation('discover',{route:parts[1]||'hub'});
 if(parts[0]==='workbench') {
  if(WORKBENCH_FEATURES.includes(parts[1]))return {view:'workbench',options:{route:parts[1]}};
  const chat=parts[1]==='chat';
  return normalizeNavigation('workbench',{hub:{mode:chat?'chat':'work',screen:parts[chat?2:1]||'home',selected:parts[chat?3:2]}});
 }
 return {view:isAppView(value)?value:'workbench',options:{}};
}
export const viewFromHash=hash=>navigationFromHash(hash).view;
export function activeNavView(view,billOrigin='mine',options={}) {
 const parent=view==='bills'?billOrigin:view;
 if(parent==='contacts')return 'messages';
 if(parent==='points')return 'workbench';
 if(parent==='discover'&&options.origin==='mine')return 'mine';
 return MAIN_NAV.some(item=>item[0]===parent)?parent:'mine';
}
