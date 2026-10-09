export const MAIN_NAV = Object.freeze([
  ['messages','message','消息'],['contacts','users','通讯录'],['discover','discover','发现'],['mine','user','我'],
]);
export const isAppView = view => MAIN_NAV.some(item=>item[0]===view)||view==='wallet'||view==='bills';
export const hashForView = view => view==='wallet'?'#mine/assets':`#${isAppView(view)?view:'messages'}`;
export function viewFromHash(hash){const value=String(hash||'').replace(/^#/,'');return value==='mine/assets'?'wallet':isAppView(value)?value:'messages'}
export function activeNavView(view,billOrigin='mine'){const parent=view==='bills'?billOrigin:view;return parent==='wallet'?'mine':MAIN_NAV.some(item=>item[0]===parent)?parent:'mine'}
