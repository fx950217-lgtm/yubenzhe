export const AI_PROVIDER_DESCRIPTIONS=Object.freeze({codex:'电脑上的编码智能体',claude:'电脑上的对话智能体',workb:'电脑上的工作助手',ollama:'电脑上的本地模型'});
export const providerId=value=>typeof value==='string'&&value.trim()===value&&/^[a-z][a-z0-9-]{1,23}$/.test(value)?value:null;
export const providerName=id=>({codex:'Codex',claude:'Claude',workb:'WorkB',ollama:'Ollama'})[id]||'AI 工具';
export function deviceAIProviders(device,{hideMissing=false,descriptions=AI_PROVIDER_DESCRIPTIONS}={}){
 if(!Array.isArray(device?.providers))return [];
 const seen=new Set();return device.providers.slice(0,16).filter(row=>{const id=providerId(row?.id);if(!id||seen.has(id))return false;seen.add(id);return !hideMissing||row.installed===true;}).map(row=>({...row,name:providerName(row.id),description:String(descriptions[row.id]||'电脑上的 AI 工具').slice(0,160),available:!device.revoked&&(device.aiOnline??device.online)===true&&!device.providersStale&&row.installed===true&&row.executionSupported===true&&(row.id==='codex'&&row.loggedIn===true&&row.executionMode==='tools'||row.id==='ollama'&&row.loggedIn===null&&row.executionMode==='chat-only'),reason:!row.installed?'本机未检测到，请在电脑安装后刷新':device.providersStale?'探测结果已过期，请在电脑刷新':row.loggedIn===false?'需要登录，请在电脑上完成':String(row.reason||'').slice(0,240)}));
}
