const count=value=>Number.isSafeInteger(value)&&value>0?value:0;
const momentId=value=>typeof value==='string'&&/^(?:0|[1-9]\d{0,14})$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
export const unreadBadgeText=value=>count(value)>99?'99+':count(value)?String(value):'';
export function navigationBadgeHTML(view,snapshot={}){
 const label=view==='messages'?unreadBadgeText(snapshot.unread):'';
 if(label)return '<b class="navigation-badge" aria-label="'+label+' 条未读消息">'+label+'</b>';
 return view==='discover'&&snapshot.discoveryUnread===true?'<b class="navigation-badge is-dot" aria-label="朋友圈有新动态"></b>':'';
}
// Only notification counters/watermarks live here; no chat or AI content is retained.
// The first successful state establishes a baseline rather than calling old posts new.
export function createNavigationBadges({onChange=()=>{}}={}){
 let owner=null,unread=0,latest=null,seen=null;
 const snapshot=()=>({unread,unreadLabel:unreadBadgeText(unread),discoveryUnread:latest!==null&&seen!==null&&latest>seen});
 function emit(){onChange(snapshot());return snapshot();}
 return {
  setOwner(value){const next=typeof value==='string'&&value?value:null;if(next===owner)return snapshot();owner=next;unread=0;latest=null;seen=null;return emit();},
  updateState(result){if(!owner||result?.profile?.userId!==owner)return snapshot();
   const ids=new Set();unread=(Array.isArray(result.conversations)?result.conversations:[]).reduce((total,row)=>{if(!row||!['direct','group'].includes(row.type)||typeof row.id!=='string'||ids.has(row.id))return total;ids.add(row.id);return Math.min(Number.MAX_SAFE_INTEGER,total+count(row.unread));},0);
   const next=momentId(result.moments?.latestVisibleId);if(next!==null){latest=next;if(seen===null)seen=next;}return emit();},
  markMomentsSeen(value,expectedOwner){const id=momentId(value);if(!owner||owner!==expectedOwner||id===null)return snapshot();seen=Math.max(seen??0,id);return emit();},
  getSnapshot:snapshot,
 };
}
