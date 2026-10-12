// Isolated shared by a worker test and service-worker test. No networking.
export const CRITICAL_PUSH_KINDS=Object.freeze(['task-completed','decision-required','task-failed']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function criticalPushPayload(event){
 if(!CRITICAL_PUSH_KINDS.includes(event?.kind)||!uuid(event?.id))throw new Error('Invalid critical notification metadata');
 return {version:1,kind:event.kind,eventId:event.id};
}
export function criticalPushDisplay(payload){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(key=>!['version','kind','eventId'].includes(key))||payload.version!==1||!CRITICAL_PUSH_KINDS.includes(payload.kind)||!uuid(payload.eventId))return null;
 const body={'task-completed':'本次执行已结束，请查看成果并验收。','decision-required':'有一项任务需要你决策。','task-failed':'有一项任务执行未完成，请查看。'}[payload.kind];
 return {title:'YBZ 愚笨者',options:{body,icon:'/icon.png',badge:'/icon.png',tag:'ybz-critical-'+payload.eventId,renotify:false,data:{kind:payload.kind,eventId:payload.eventId}}};
}
export function criticalPushClickPath(data){
 return data&&CRITICAL_PUSH_KINDS.includes(data.kind)&&uuid(data.eventId)?'/#workbench':null;
}
