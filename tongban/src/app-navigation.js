export const MAIN_NAV = Object.freeze([
  ['workbench','spark','AI 工作台'],['messages','message','消息'],['contacts','users','通讯录'],['discover','discover','发现'],['mine','user','我'],
]);
export const isAppView = view => MAIN_NAV.some(item=>item[0]===view)||view==='wallet'||view==='bills'||view==='points';
export const hashForView = view => view==='wallet'?'#mine/assets':view==='points'?'#mine/points':`#${isAppView(view)?view:'workbench'}`;
export function viewFromHash(hash){const value=String(hash||'').replace(/^#/,'');return value==='mine/assets'?'wallet':value==='mine/points'?'points':isAppView(value)?value:'workbench'}
export function activeNavView(view,billOrigin='mine'){const parent=view==='bills'?billOrigin:view;return ['wallet','points'].includes(parent)?'mine':MAIN_NAV.some(item=>item[0]===parent)?parent:'mine'}
