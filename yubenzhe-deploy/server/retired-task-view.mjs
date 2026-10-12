// Read-only compatibility for historical task JSON and idempotency responses.
// Historical database rows remain untouched; retired accounting fields are never exposed as active features.
const retired=/^(?:billing\w*|\w*Points|points\w*|\w*Micro|estimatedRange|payer|priceVersion|invoice|approvals)$/i;
export function currentTaskView(value){
 if(Array.isArray(value))return value.map(currentTaskView);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!retired.test(key)).map(([key,item])=>[key==='quoteExpiresAt'?'confirmationExpiresAt':key,currentTaskView(item)]));
}
