import {createHash} from 'node:crypto';
// This is a pause proposal, never an executable command or automatic approval.
export const DECISION_GUIDANCE='需要用户决定方向、授权或验收时，先把可预览成果放入 outbox（仅文件执行工具适用），停止后续工作，仅输出一个 JSON：{"ybzDecision":{"question":"需要拍板的问题","options":[{"label":"方案一","instruction":"选择后下一段要做的工作"},{"label":"方案二","instruction":"选择后下一段要做的工作"}]}}。2–4个选项，问题最多300字、按钮40字、下一段要求2000字，总JSON最多6000字。不要替用户选择，不要在提问后继续调用工具；连接器将结束本段，只有用户明确点击才会发起下一段。这里不授权转账、主网、付费或访问密钥。';
const bad=()=>Object.assign(Error('决策卡格式无效，本段已停止。'),{code:'AI_DECISION_INVALID'});
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw bad();return value.trim();};
export function decisionProposal(value,{redact=v=>v}={}){
 if(!value||!Array.isArray(value.options)||value.options.length<2||value.options.length>4)throw bad();
 const question=text(redact(text(value.question,300)),300),options=value.options.map((item,i)=>({id:'option-'+(i+1),label:text(redact(text(item?.label,40)),40),instruction:text(redact(text(item?.instruction,2000)),2000)}));
 const canonical=JSON.stringify({question,options});if(canonical.length>6000)throw bad();
 return {question,options,decisionDigest:createHash('sha256').update(canonical).digest('hex')};
}
export function parseDecisionMessage(textValue,options){
 if(typeof textValue!=='string')return null;
 let value;try{value=JSON.parse(textValue);}catch{if(/^\s*\{\s*"ybzDecision"\s*:/.test(textValue))throw bad();return null;}
 if(!value||!Object.hasOwn(value,'ybzDecision'))return null;
 if(Object.keys(value).length!==1||textValue.length>6000)throw bad();
 return decisionProposal(value.ybzDecision,options);
}
