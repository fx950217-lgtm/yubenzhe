import { createHash } from 'node:crypto';

export const FILE_LIMIT=256*1024;
export const RETENTION_MS=30*24*60*60*1000;
export const PLANNER_VERSION='local-rules-2026-10-10-v1';
const LOCAL_OPERATIONS=new Set(['analyze','deduplicate','format-json','task-draft','checklist','outline']);
const EN=locale=>locale==='en-US';
const bilingual=(locale,zh,en)=>EN(locale)?en:zh;
const safeBase=value=>String(value).replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').trim().slice(0,65)||'task';
export function localServiceCatalog(enabled=false){return {services:[
 {id:'local-rules',kind:'planner',label:'本地规则式计划器',status:enabled?'available':'unconfigured',version:PLANNER_VERSION,capabilities:['goal-classification','plan','estimate'],reason:enabled?'规则识别与模板，不是语言模型。':'本地执行模式未开启。'},
 {id:'local-documents',kind:'tool',label:'本地文档与文件工具',status:enabled?'available':'unconfigured',capabilities:[...LOCAL_OPERATIONS],reason:enabled?'在当前隔离服务处理选中的内容，不联网。':'本地执行模式未开启。'},
 {id:'cloud-model',kind:'model',label:'云端语言模型',status:'unconfigured',capabilities:[],reason:'尚未为本地 M0 配置供应商、模型或调用凭据。'},
 {id:'cloud-desktop',kind:'workspace',label:'云端桌面',status:'unconfigured',capabilities:[],reason:'尚未配置云设备、桌面网关与工具执行权限。'}
]};}

// Classification is intentionally conservative. Files are inert data, and no
// text can grant networking, shell execution, payment or message permissions.
export function planLocalGoal({goal,files=[],locale='zh-CN'}={}){
 if(typeof goal!=='string'||goal.trim().length<2||goal.length>4000)throw new Error('请用 2–4000 字说明任务目标。');
 if(!['zh-CN','en-US'].includes(locale))throw new Error('暂时支持简体中文和英语计划。');
 goal=goal.trim();
 const plan={status:'needs_information',planner:'local-rules',plannerVersion:PLANNER_VERSION,locale,goal,operation:null,summary:'',steps:[],artifacts:[],missingInformation:[],limitations:[bilingual(locale,'由本地规则生成计划与模板，未调用语言模型、联网服务或远程桌面。','A local rules engine creates this plan and templates. No language model, network service or remote desktop is used.')],estimatedSeconds:0,externalActions:[]};
 // A specific prohibition does not itself request the prohibited operation.
 const intent=goal.replace(/(?:不|不要|无需|禁止)(?:实际|自动)?(?:发送邮件|发送消息|发送|联网|购买|下单|支付|发布|运行代码)[^，。；;\n]*/g,'').replace(/(?:do not|don't|without)\s+(?:send(?:ing)?|buy(?:ing)?|publish(?:ing)?|execut(?:e|ing))[^,;.\n]*/gi,'');
 if(/助记词|私钥|api[_ -]?key|密钥密码|(?:账号|账户|登录|邮箱|钱包)(?:的)?密码|password\s*[:=]|mnemonic|private[ _-]?key|-----BEGIN .*PRIVATE KEY/i.test(goal)){
  // The request cache stores this response for safe retries. Never echo a
  // refused credential into that cache or into a task's planning metadata.
  plan.goal='';plan.status='unsupported';plan.summary=bilingual(locale,'工作台不处理钱包密钥或账号凭据。','The workbench does not process wallet secrets or account credentials.');plan.missingInformation=[bilingual(locale,'删除敏感凭据，只提供不含秘密的任务说明。','Remove secret credentials and provide a non-sensitive task description.')];return plan;
 }
 const external=/(?:发送|发给|群发|投递)(?:邮件|消息|短信|给)|(?:发送邮件|send\s+(?:an?\s+)?(?:email|message)|email\s+it|publish|发布到|自动发布|替我发布|帮我发布)|(?:购买|下单|付款|支付|转账|buy\b|purchase\b|transfer\s+money)|(?:联网|上网|浏览网页|搜索网页|查找网站|抓取|爬取|打开网站|打开浏览器|操作桌面|操控桌面|远程桌面|browse\b|search\s+(?:the\s+)?web|open\s+(?:a\s+)?browser)|(?:运行(?:代码|脚本|命令)|执行(?:代码|脚本|命令)|shell\b|execute\b|run\s+(?:code|script|command))|(?:生成(?:图片|视频)|翻译全文|实时(?:行情|天气)|image\s+generation)/i;
 if(external.test(intent)){
  plan.status='needs_configuration';plan.summary=bilingual(locale,'该目标需要尚未接通的模型、联网工具或云端设备。','This goal needs an unconfigured model, network tool or cloud workspace.');plan.missingInformation=[bilingual(locale,'真实服务商和工具权限尚未配置；当前不会执行。可改为先整理清单或草稿。','The provider and tool permissions are not configured. Nothing will run. You can request a checklist or draft instead.')];return plan;
 }
 let operation;
 if(/清单|待办|检查表|checklist|to[ -]?do/i.test(intent))operation='checklist';
 else if(/大纲|提纲|outline/i.test(intent))operation='outline';
 else if(/草稿|起草|任务说明|项目计划|工作计划|行动计划|draft|task brief|project plan/i.test(intent))operation='task-draft';
 else if(/json/i.test(intent)&&/格式|整理|美化|format|pretty/i.test(intent))operation='format-json';
 else if(/去重|重复|dedup|unique/i.test(intent))operation='deduplicate';
 else if(/统计|分析|汇总|整理|报表|analy|summari|report/i.test(intent))operation='analyze';
 if(!operation){plan.summary=bilingual(locale,'需要再说明希望得到的成果。','Please specify the result you want.');plan.missingInformation=[bilingual(locale,'可以要求任务草稿、待办清单、文章大纲，或对附件去重、统计、格式化 JSON。','Ask for a task draft, checklist, article outline, or file deduplication, statistics, or JSON formatting.')];return plan;}
 const isDocument=['task-draft','checklist','outline'].includes(operation);
 if(!isDocument&&!files.length){plan.summary=bilingual(locale,'先添加需要处理的文件。','Add the files to process first.');plan.missingInformation=[bilingual(locale,'上传 CSV、TXT、MD 或 JSON，再生成计划。','Upload CSV, TXT, MD or JSON files, then request a plan.')];return plan;}
 if(operation==='format-json'&&files.some(f=>!f.name.toLowerCase().endsWith('.json'))){plan.summary=bilingual(locale,'JSON 格式化只接受 JSON 附件。','JSON formatting accepts only JSON attachments.');plan.missingInformation=[bilingual(locale,'请仅选择 JSON 文件，其他文件可另建统计任务。','Select only JSON files; create a separate statistics task for other files.')];return plan;}
 if(operation==='deduplicate'&&files.some(f=>f.name.toLowerCase().endsWith('.json'))){plan.summary=bilingual(locale,'JSON 去重需要明确对象键和保留规则。','JSON deduplication needs explicit object keys and retention rules.');plan.missingInformation=[bilingual(locale,'当前规则式去重支持 CSV、TXT、MD；JSON 可先格式化，不会猜测删除对象。','Rule-based deduplication supports CSV, TXT and MD. JSON can be formatted without guessing which objects to remove.')];return plan;}
 const labels={'task-draft':['任务草稿','task draft'],checklist:['待办清单','checklist'],outline:['文章大纲','article outline'],analyze:['文件统计与整理','file statistics and cleanup'],deduplicate:['文件去重与报告','file deduplication and report'],'format-json':['JSON 格式化','JSON formatting']},label=labels[operation][EN(locale)?1:0];
 plan.status='ready';plan.operation=operation;plan.summary=bilingual(locale,`把你的目标整理为${label}${files.length?`，仅使用选中的 ${files.length} 个附件`:''}。`,`Prepare a ${label} from your goal${files.length?`, using only the ${files.length} selected attachment(s)`:''}.`);
 const steps=isDocument?[['read','核对目标与要点','Review goal and requested points'],['draft','按目标形成可编辑结构','Build an editable structure around the goal'],['save','保存草稿与说明文件','Save the draft and processing notes']]:[['read','读取并校验选中附件','Read and validate selected attachments'],['process',label,label],['save','保存真实成果与处理报告','Save actual outputs and a processing report']];
 plan.steps=steps.map(([id,zh,en],index)=>({id,title:bilingual(locale,zh,en),description:index===0?bilingual(locale,'只读取本次选择的文件和目标，不访问聊天、其他文件或外部账号。','Read only the selected files and goal, never chats, other files or external accounts.'):index===1?bilingual(locale,'执行已说明的确定性本地规则，不运行文件中的指令。','Apply the stated deterministic local rules; do not execute instructions found inside files.'):bilingual(locale,'生成可预览、下载的文件，保留 30 天。','Create files for preview and download, retained for 30 days.') }));
 plan.artifacts=isDocument?[{name:safeBase(goal.split(/[，,。\n]/)[0])+'-'+(EN(locale)?operation:labels[operation][0])+'.md',mime:'text/markdown; charset=utf-8',description:bilingual(locale,'包含原目标、明确要点与待补充项的可编辑模板；不是模型生成的事实结论。','Editable template with the original goal, specified points and open questions; not model-generated factual conclusions.')}]:files.map(f=>({name:f.name.replace(/\.[^.]+$/,'')+(operation==='format-json'?'-格式化.json':/\.csv$/i.test(f.name)?'-整理.csv':/\.json$/i.test(f.name)?'-格式化.json':'-整理.txt'),mime:/\.json$/i.test(f.name)?'application/json; charset=utf-8':/\.csv$/i.test(f.name)?'text/csv; charset=utf-8':'text/plain; charset=utf-8',description:bilingual(locale,'实际处理后的文件副本，原附件保留。','A processed copy; the original attachment is retained.')}));
 plan.artifacts.push({name:EN(locale)?'processing-notes.txt':'处理说明.txt',mime:'text/plain; charset=utf-8',description:bilingual(locale,'列出已完成内容和当前能力限制。','Lists completed work and capability limits.')});
 if(isDocument)plan.limitations.push(bilingual(locale,'草稿不是已完成外部工作；其中待补充项和事实需由你核对。','A draft is not completed external work; verify open items and factual claims yourself.'));
 plan.estimatedSeconds=5;
 return plan;
}

function markdownText(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\\`*_{}\[\]()#+.!|~-]/g,'\\$&');}
function goalItems(goal,locale){
 const items=[];
 for(const [index,part] of goal.split(/[，,；;。\n]/).entries()){
  let clause=part.trim();if(!clause)continue;
  const marker=/(?:包含|包括|要点(?:是|为)?|\bincluding\b|\bincludes?\b|\bkey points\b)\s*[:：]?\s*/i.exec(clause);
  if(marker)clause=clause.slice(marker.index+marker[0].length);
  else if(/[:：]/.test(clause))clause=clause.slice(clause.search(/[:：]/)+1);
  else if(index===0)continue;
  if(!clause||/^(?:请|帮我|给我|为我|麻烦|please|help me|create|make|write|draft).*(?:清单|待办|草稿|大纲|checklist|outline|draft)/i.test(clause))continue;
  for(let item of clause.split(/、|以及|和(?!平|谐|睦|解|尚|弦|蔼)|\s+(?:and|plus)\s+/i)){
   item=item.trim().replace(/^(?:[-*]\s+|\d+[.)、]\s*|\[(?: |x|X)\]\s*)/,'').trim();
   if(item&&!items.includes(item))items.push(item);
  }
 }
 const placeholders=EN(locale)?['To add: specific item and expected result','To add: materials and dependencies','To add: owner, deadline and completion evidence']:['待补充：具体事项与预期结果','待补充：所需材料与依赖','待补充：负责人、时间与完成依据'];
 return {points:(items.length?items:placeholders).slice(0,20),explicit:items.length>0,truncated:items.length>20};
}

function processGoalDocument(files,operation,{goal,locale='zh-CN',plan}={}){
 const text=String(goal||'').trim();if(text.length<2)throw new Error('任务目标缺失。');
 const extracted=goalItems(text,locale),points=extracted.points.map(markdownText);
 const label={checklist:'待办清单',outline:'文章大纲','task-draft':'任务草稿'}[operation];
 const body=['# '+markdownText(text.split(/[，,。\n]/)[0].slice(0,180)),'',bilingual(locale,'> 本地规则式模板，未调用语言模型或联网核验；请按实际情况编辑。','> Local rules-based template. No language model or online verification was used; edit for your actual situation.'),'',bilingual(locale,'## 原始目标','## Original goal'),markdownText(text),''];
 if(!extracted.explicit)body.push(bilingual(locale,'未识别到明确列出的事项，以下为待补充的编辑框架，不代表已经完成任务。','No explicit items were identified. The following is an editable framework to complete, not completed work.'),'');
 if(extracted.truncated)body.push(bilingual(locale,'明确事项较多，以下最多列出 20 项；完整要求保留在原始目标中。','At most 20 explicit items are listed below; the complete request is preserved in the original goal.'),'');
 if(operation==='checklist'){body.push(bilingual(locale,extracted.explicit?'## 按你的要求整理':'## 待补充的事项','## '+(extracted.explicit?'Items from your request':'Items to add')),...points.map(p=>'- [ ] '+p),'',bilingual(locale,'## 完成前核对','## Before finishing'),...[(EN(locale)?'Confirm who owns each item and the deadline':'确认每项负责人和完成时间'),(EN(locale)?'Add required materials and dependencies':'补齐所需材料与依赖'),(EN(locale)?'Record completion evidence; unchecked items are not done':'记录完成依据；未勾选不代表已经完成')].map(p=>'- '+p));}
 else if(operation==='outline'){body.push(bilingual(locale,'## 可编辑文章结构','## Editable article structure'),bilingual(locale,'### 1. 引言：目标与背景','### 1. Introduction: goal and context'),bilingual(locale,'围绕原始目标说明写作目的；补充读者和使用场景。','Explain the writing purpose from the goal; add the audience and context.'),'',...points.flatMap((p,i)=>['### '+(i+2)+'. '+p,bilingual(locale,'- 核心观点：待补充','- Main point: to add'),bilingual(locale,'- 例子、数据或来源：待核对','- Examples, data or sources: to verify'),bilingual(locale,'- 与目标的关系：待说明','- Relevance to the goal: to explain'), '']),bilingual(locale,'### 结尾：总结与下一步','### Closing: summary and next steps'));}
 else {body.push(bilingual(locale,'## 需求与交付草稿','## Requirements and deliverables draft'),...points.map((p,i)=>`${i+1}. ${p}`),'',bilingual(locale,'## 执行前需要补齐','## Information to add before execution'),bilingual(locale,'- 负责人、目标读者 / 使用者、截止时间','- Owner, audience / users, deadline'),bilingual(locale,'- 可用资料、依赖和限制','- Available materials, dependencies and constraints'),bilingual(locale,'- 验收标准与交付格式','- Acceptance criteria and delivery format'),' ',bilingual(locale,'## 下一步清单','## Next steps'),...points.map(p=>'- [ ] '+p));}
 if(files.length){body.push('',bilingual(locale,'## 已选参考附件（节选）','## Selected reference attachments (excerpts)'));for(const file of files){const checked=validateFile(file.name,Buffer.from(file.content));body.push('### '+markdownText(file.name),markdownText(checked.text.slice(0,2000)),checked.text.length>2000?bilingual(locale,'（仅摘录前 2000 字，原附件未修改）','(First 2000 characters only; the original is unchanged.)'):'');}}
 const name=plan?.artifacts?.[0]?.name||safeBase(text)+'-'+label+'.md';
 const report=[bilingual(locale,'已完成：读取目标和选择的附件，按明确规则生成可编辑模板。','Completed: read the goal and selected files and generated an editable template using explicit rules.'),bilingual(locale,'未完成：事实研究、外部执行、发送、发布、付款与远程桌面操作。','Not performed: factual research, external execution, sending, publishing, payments or remote desktop actions.'),bilingual(locale,'原始目标：','Original goal: ')+text,...(plan?.limitations||[])].join('\n');
 return [{name,mime:'text/markdown; charset=utf-8',content:Buffer.from(body.join('\n')+'\n')},{name:EN(locale)?'processing-notes.txt':'处理说明.txt',mime:'text/plain; charset=utf-8',content:Buffer.from(report)}];
}
export function parseCSV(text) {
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c==='"'){if(field||closed)throw new Error('CSV 引号位置不正确。');quoted=true;continue;}
  if(c===','||c==='\n'||c==='\r'){
   row.push(field);field='';closed=false;
   if(c!==','){rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++;}continue;
  }
  if(closed&&c!==' '&&c!=='\t')throw new Error('CSV 引号后的内容无效。');
  if(!closed)field+=c;
 }
 if(quoted)throw new Error('CSV 存在未闭合引号。');
 if(field||row.length||closed)rows.push([...row,field]);
 if(rows.length>10000)throw new Error('本地测试每个文件最多 10000 行。');
 return rows;
}
function csvCell(value){const t=String(value),safe=/^[\s]*[=+@-]/.test(t)?"'"+t:t;return '"'+safe.replaceAll('"','""')+'"';}
function csv(rows){return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
export function validateFile(name,bytes){
 if(typeof name!=='string'||name.length<1||name.length>100||/[\\/\x00-\x1f]/.test(name)||! /\.(csv|txt|md|json)$/i.test(name))throw new Error('仅支持 CSV、TXT、Markdown、JSON 文本文件。');
 if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>FILE_LIMIT)throw new Error('文件必须为 1 字节至 256 KiB。');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');
 if(/-----BEGIN .*PRIVATE KEY-----|"(?:privateKey|private_key|mnemonic|encryptedJson)"\s*:|(?:^|\n)(?:[A-Z_]*API_KEY|PRIVATE_KEY|MNEMONIC)\s*=/i.test(text)||/^(?:wallet|keystore|\.env)(?:[.-]|$)/i.test(name))throw new Error('请勿上传钱包密钥、助记词、凭证或配置文件。');
 return {text,sha256:createHash('sha256').update(bytes).digest('hex')};
}
// This adapter parses files deterministically. It never executes instructions,
// launches a shell/browser, contacts a provider, or pretends to be a model.
export function processLocalFiles(files,operation='analyze',context={}){
 if(!LOCAL_OPERATIONS.has(operation))throw new Error('不支持的文件操作。');
 if(['task-draft','checklist','outline'].includes(operation))return processGoalDocument(files,operation,context);
 if(!files.length||operation==='format-json'&&files.some(f=>!f.name.toLowerCase().endsWith('.json')))throw new Error('缺少正确格式的附件。');
 const outputs=[],report=['本地文件测试成果','执行器：确定性文件解析（非语言模型）','没有调用云模型或远程桌面；没有对外发送文件。',''];
 for(const file of files){const {text}=validateFile(file.name,Buffer.from(file.content));
  const lines=text.split(/\r?\n/),base=file.name.replace(/\.[^.]+$/,'');
  report.push('文件：'+file.name,'大小：'+file.content.length+' 字节','行数：'+lines.length);
  if(/\.csv$/i.test(file.name)){
   const rows=parseCSV(text);const header=rows[0]||[];let body=rows.slice(1).filter(row=>row.some(v=>v.trim()));
   const original=body.length;
   if(operation==='deduplicate'){const seen=new Set();body=body.filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true;});}
   report.push('列数：'+header.length,'数据行：'+original,'空值：'+body.reduce((s,r)=>s+r.filter(x=>!x.trim()).length,0),'宽度不一致行：'+body.filter(row=>row.length!==header.length).length,'移除重复行：'+(original-body.length));
   header.forEach((column,index)=>{const values=body.map(row=>row[index]??'').filter(v=>v.trim());if(values.length&&values.every(v=>/^-?\d+(\.\d+)?$/.test(v)&&Number.isFinite(Number(v)))){const sum=values.reduce((s,v)=>s+Number(v),0);if(Number.isFinite(sum))report.push(column+'：数值合计 '+sum+'（文件统计，不用于资产记账）');}});
   outputs.push({name:base+'-整理.csv',mime:'text/csv; charset=utf-8',content:Buffer.from(csv([header,...body]))});
  }else if(/\.json$/i.test(file.name)){
   const parsed=JSON.parse(text);report.push('JSON 类型：'+(Array.isArray(parsed)?'数组 ('+parsed.length+' 项)':typeof parsed));
   outputs.push({name:base+'-格式化.json',mime:'application/json; charset=utf-8',content:Buffer.from(JSON.stringify(parsed,null,2)+'\n')});
  }else{
   const cleaned=operation==='deduplicate'?[...new Set(lines)]:lines;
   report.push('字符数：'+text.length,'移除重复行：'+(lines.length-cleaned.length));
   outputs.push({name:base+'-整理.txt',mime:'text/plain; charset=utf-8',content:Buffer.from(cleaned.join('\n'))});
  }
  report.push('');
 }
 if(context.goal)report.push('原始目标：'+context.goal,...(context.plan?.limitations||[]));
 outputs.push({name:context.goal?(EN(context.locale)?'processing-notes.txt':'处理说明.txt'):'文件整理报告.txt',mime:'text/plain; charset=utf-8',content:Buffer.from(report.join('\n'))});
 return outputs;
}
