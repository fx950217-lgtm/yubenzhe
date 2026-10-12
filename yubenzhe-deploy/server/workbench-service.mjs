import { randomUUID,createHash } from 'node:crypto';
import {currentTaskView} from './retired-task-view.mjs';
import { fail,fields,text } from './social-validation.mjs';
import { validateFile,processLocalFiles,planLocalGoal,localServiceCatalog,RETENTION_MS } from './workbench-adapters.mjs';
const FINAL=new Set(['succeeded','failed','cancelled']);
const ALLOWED=new Set(['analyze','deduplicate']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const digest=value=>createHash('sha256').update(value).digest('hex');
export function createWorkbenchService({database,socialService,enabled=false,simulation=true,now=Date.now,processor=processLocalFiles,desktopCapabilities=null}={}){
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function enabledOrFail(){if(!enabled)fail(503,'WORKBENCH_UNCONFIGURED','文件工作台未配置，请先由管理员启用规则式文件工具。');}
 function ownTask(owner,id){const task=one('SELECT id,owner_id,workspace_id,title,operation,input_ids,status,step,version,quote_expires_at,error_code,created_at,updated_at,goal,locale,plan_json,plan_version FROM workbench_tasks WHERE id=? AND owner_id=?',id,owner);if(!task)fail(404,'TASK_NOT_FOUND','任务不存在。');return task;}
 function event(task,eventName,payload={}){run('INSERT INTO workbench_events VALUES(?,?,?,?,?)',randomUUID(),task.id,eventName,JSON.stringify(payload),now());}
 const cleanPlan=currentTaskView;
 function view(task){return {id:task.id,title:task.title,goal:task.goal,locale:task.locale,planVersion:task.plan_version,plan:task.plan_version?cleanPlan(JSON.parse(task.plan_json)):null,remainingSteps:Math.max(0,3-task.step),instructions:all('SELECT id,instruction,plan_version AS planVersion,created_at AS createdAt FROM workbench_instructions WHERE task_id=? ORDER BY created_at,rowid',task.id),operation:task.operation,status:task.status,step:task.step,version:task.version,workspaceId:task.workspace_id,workspace:one('SELECT id,state,controller,controller_task_id AS controllerTaskId,version FROM workbench_workspaces WHERE id=?',task.workspace_id),confirmationExpiresAt:task.quote_expires_at,simulation,error:task.error_code,createdAt:task.created_at,updatedAt:task.updated_at,outputs:all('SELECT id,name,mime,size,expires_at AS expiresAt FROM workbench_files WHERE task_id=? AND kind=? AND expires_at>?',task.id,'output',now()),events:all('SELECT event,payload,created_at AS createdAt FROM workbench_events WHERE task_id=? ORDER BY created_at,rowid',task.id).map(row=>({...row,payload:cleanPlan(JSON.parse(row.payload))}))};}
 function selectedFiles(owner,ids){if(!Array.isArray(ids)||ids.length>5||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)fail(400,'FILE_REQUIRED','请选择最多 5 个不同文件。');return ids.map(id=>{const file=one("SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND kind='input' AND expires_at>?",id,owner,now()+60000);if(!file)fail(404,'FILE_NOT_FOUND','文件不存在或即将过期。');return file;});}
 function workspace(owner){let ws=one('SELECT * FROM workbench_workspaces WHERE owner_id=?',owner);if(!ws){const id=randomUUID();run('INSERT INTO workbench_workspaces(id,owner_id,state,controller,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,owner,'ready','ai',1,now(),now());ws={id};}return ws;}
 function planGoal(goal,files,locale){try{return cleanPlan(planLocalGoal({goal,files,locale}));}catch(error){fail(400,'PLAN_INVALID',error.message);}}
 function newPlan(owner,input){const files=selectedFiles(owner,input.fileIds??[]),goal=text(input.goal,4000,'任务目标',2),locale=input.locale||'zh-CN',plan=planGoal(goal,files,locale);if(plan.status!=='ready')return {plan,task:null};
  if(one("SELECT count(*) n FROM workbench_tasks WHERE owner_id=? AND status NOT IN ('succeeded','failed','cancelled')",owner).n>=20)fail(409,'TASK_QUOTA','请先完成或取消已有任务。');
  // Required legacy columns receive inert compatibility values only; historical rows are never rewritten.
  const ws=workspace(owner),id=randomUUID();run('INSERT INTO workbench_tasks(id,owner_id,workspace_id,title,operation,input_ids,status,quote_expires_at,estimated_micro,budget_micro,price_version,created_at,updated_at,goal,locale,plan_json,plan_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner,ws.id,goal.slice(0,200),plan.operation,JSON.stringify(files.map(f=>f.id)),'awaiting-confirmation',now()+60000,'0','0','retired',now(),now(),goal,locale,JSON.stringify(plan),1);event({id},'planned',{planner:plan.planner,planVersion:1,steps:plan.steps,estimatedSeconds:plan.estimatedSeconds});return {plan,task:view(ownTask(owner,id))};
 }
 function command(owner,path,input,fn){if(!uuid(input.requestId))fail(400,'REQUEST_ID_REQUIRED','请保留同一个操作标识重试。');const signature=digest(JSON.stringify({path,input:{...input,requestId:undefined}}));return transaction(()=>{const old=one('SELECT * FROM workbench_commands WHERE owner_id=? AND request_id=?',owner,input.requestId);if(old){if(old.signature!==signature)fail(409,'IDEMPOTENCY_CONFLICT','同一操作标识的内容不能改变。');return currentTaskView(JSON.parse(old.response));}const result=fn();run('INSERT INTO workbench_commands VALUES(?,?,?,?,?)',owner,input.requestId,signature,JSON.stringify(result),now());return result;});}
 function update(task,status,extras={}){run('UPDATE workbench_tasks SET status=?,version=version+1,updated_at=? WHERE id=?',status,now(),task.id);event(task,status,extras);}
 function finish(task,status,error=null){
  if(FINAL.has(task.status))return;
  run('UPDATE workbench_tasks SET status=?,error_code=?,version=version+1,updated_at=? WHERE id=?',status,error,now(),task.id);
  event(task,status,{});
  run("UPDATE workbench_workspaces SET controller='ai',controller_task_id=NULL,version=version+1,updated_at=? WHERE id=? AND controller_task_id=?",now(),task.workspace_id,task.id);
  const other=one("SELECT 1 FROM workbench_tasks WHERE workspace_id=? AND id<>? AND status IN ('running','queued')",task.workspace_id,task.id);
  if(!other)run("UPDATE workbench_workspaces SET state='suspended',version=version+1,updated_at=? WHERE id=?",now(),task.workspace_id);
 }
 function validateVersion(task,input){if(!Number.isInteger(input.version)||task.version!==input.version)fail(409,'TASK_CHANGED','任务已在另一设备更新，请刷新后重试。');}
 function pending(owner){return all("SELECT id,status FROM workbench_tasks WHERE owner_id=? AND status NOT IN ('succeeded','failed','cancelled')",owner).map(row=>({type:'file-task',id:row.id,status:row.status}));}
 function recordStep(task,eventKey){
  if(task.status!=='running')return false;
  if(all("SELECT payload FROM workbench_events WHERE task_id=? AND event='step-completed'",task.id).some(row=>JSON.parse(row.payload).eventKey===eventKey))return false;
  run('UPDATE workbench_tasks SET step=step+1,version=version+1,updated_at=? WHERE id=?',now(),task.id);
  event(task,'step-completed',{step:task.step+1,eventKey});return true;
 }
 function tick(){if(!enabled)return;
  transaction(()=>{
   run('DELETE FROM workbench_files WHERE expires_at<=?',now());
   const stale=all("SELECT id,owner_id,workspace_id,title,operation,input_ids,status,step,version,quote_expires_at,error_code,created_at,updated_at,goal,locale,plan_json,plan_version FROM workbench_tasks WHERE status='awaiting-confirmation' AND quote_expires_at<=?",now());
   for(const task of stale){finish(task,'cancelled');event(task,'confirmation-expired');}
   // Restrictions cancel work without changing historical accounting data.
   const restricted=all("SELECT t.id,t.owner_id,t.workspace_id,t.title,t.operation,t.input_ids,t.status,t.step,t.version,t.quote_expires_at,t.error_code,t.created_at,t.updated_at,t.goal,t.locale,t.plan_json,t.plan_version FROM workbench_tasks t JOIN account_restrictions r ON r.account_id=t.owner_id WHERE r.state<>'active' AND t.status NOT IN ('succeeded','failed','cancelled')");
   for(const task of restricted)finish(task,'cancelled','ACCOUNT_RESTRICTED');
   const owners=all("SELECT DISTINCT owner_id FROM workbench_tasks WHERE status IN ('queued','running')");
   for(const {owner_id:owner} of owners){
    let task=one("SELECT id,owner_id,workspace_id,title,operation,input_ids,status,step,version,quote_expires_at,error_code,created_at,updated_at,goal,locale,plan_json,plan_version FROM workbench_tasks WHERE owner_id=? AND status='running'",owner);
    const ws=one('SELECT * FROM workbench_workspaces WHERE owner_id=?',owner);
    if(ws.controller==='user')continue;
    if(!task){task=one("SELECT id,owner_id,workspace_id,title,operation,input_ids,status,step,version,quote_expires_at,error_code,created_at,updated_at,goal,locale,plan_json,plan_version FROM workbench_tasks WHERE owner_id=? AND status='queued' ORDER BY created_at,id LIMIT 1",owner);if(!task)continue;update(task,'running');run("UPDATE workbench_workspaces SET state='running',version=version+1,updated_at=? WHERE id=?",now(),task.workspace_id);continue;}
    const account=one('SELECT deleted_at FROM accounts WHERE id=?',owner);
    if(!account||account.deleted_at){finish(task,'cancelled');continue;}
    try{
     if(task.step===2){
      const ids=JSON.parse(task.input_ids);const files=ids.map(id=>one("SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND kind='input' AND expires_at>?",id,owner,now()));
      if(files.some(file=>!file))throw new Error('Input expired');
      const outputs=processor(files,task.operation,{goal:task.goal,locale:task.locale,plan:task.plan_version?JSON.parse(task.plan_json):null});
      if(!Array.isArray(outputs)||!outputs.length)throw new Error('No artifact');
      const quota=one('SELECT count(*) n,coalesce(sum(size),0) bytes FROM workbench_files WHERE owner_id=? AND expires_at>?',owner,now());if(quota.n+outputs.length>200||quota.bytes+outputs.reduce((n,f)=>n+(f.content?.length||0),0)>10*1024*1024)throw new Error('Output quota');
      for(const output of outputs){if(!Buffer.isBuffer(output.content)||!output.content.length||output.content.length>1024*1024||typeof output.name!=='string'||output.name.length>150||/[\\/\x00-\x1f]/.test(output.name)||!['text/plain; charset=utf-8','text/csv; charset=utf-8','text/markdown; charset=utf-8','application/json; charset=utf-8'].includes(output.mime))throw new Error('Output invalid');run('INSERT INTO workbench_files VALUES(?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),owner,task.id,output.name,output.mime,output.content,digest(output.content),output.content.length,'output',now(),now()+RETENTION_MS);}
     }
     recordStep(task,(task.plan_version?'plan-'+task.plan_version+'-':'')+'local-step-'+task.step);
     const fresh=ownTask(owner,task.id);if(fresh.step>=3)finish(fresh,'succeeded');
    }catch(error){
     run("DELETE FROM workbench_files WHERE task_id=? AND kind='output'",task.id);finish(ownTask(owner,task.id),'failed','FILE_PROCESSING_FAILED');
    }
   }
   // Only local workspaces exist in M0; suspending them never bills compute.
   run("UPDATE workbench_workspaces SET state='suspended',version=version+1 WHERE state='ready' AND updated_at<?",now()-600000);
  });
 }
 async function handle({method,path,input={},token}){
  if(!path.startsWith('workbench/'))return undefined;
  const account=socialService.assertAIAccess(token,{write:method==='POST'}),owner=account.id;
  const route=path.slice('workbench/'.length);
  if(method==='GET'&&route==='capabilities')return {enabled,simulation,executor:'local-file-parser',planner:'local-rules',goalPlanning:enabled,models:[],desktop:desktopCapabilities?desktopCapabilities():{available:false,reason:'尚未配置真实云桌面服务商'},operations:[{id:'task-draft',label:'任务草稿'},{id:'checklist',label:'待办清单'},{id:'outline',label:'文章大纲'},{id:'analyze',label:'文件统计与格式整理'},{id:'deduplicate',label:'去重并生成报告'},{id:'format-json',label:'JSON 格式化'}],fileLimit:262144,retentionDays:30,retentionReminderDays:[7,1],notice:simulation?'本地规则式计划与文件工具；未连接语言模型或云桌面。':'由当前服务执行规则式文件工具并保存成果；AI 方案及设备任务使用各自独立通道。'};
  if(method==='GET'&&route==='catalog')return localServiceCatalog(enabled);
  enabledOrFail();
  if(method==='POST'&&route==='plan'){fields(input,['requestId','goal','fileIds' ,'locale']);return command(owner,route,input,()=>newPlan(owner,input));}
  if(method==='GET'&&route==='retention'){const checkedAt=now();return {checkedAt,reminders:all("SELECT id,name,task_id,expires_at FROM workbench_files WHERE owner_id=? AND kind='output' AND expires_at>? AND expires_at<=? ORDER BY expires_at,id LIMIT 200",owner,checkedAt,checkedAt+7*86400000).map(f=>{const thresholdDays=f.expires_at-checkedAt<=86400000?1:7;return {id:f.id+':'+thresholdDays,fileId:f.id,taskId:f.task_id,name:f.name,expiresAt:f.expires_at,thresholdDays,remainingDays:Math.ceil((f.expires_at-checkedAt)/86400000)}})};}
  if(method==='GET'&&route==='files')return {files:all("SELECT id,name,size,expires_at AS expiresAt FROM workbench_files WHERE owner_id=? AND kind='input' AND expires_at>? ORDER BY created_at DESC LIMIT 100",owner,now())};
  const fileDetails=/^files\/([a-f0-9-]{36})\/details$/.exec(route);
  if(method==='GET'&&fileDetails){const f=one('SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND expires_at>?',fileDetails[1],owner,now());if(!f)fail(404,'FILE_NOT_FOUND','文件不存在或已过期。');const content=new TextDecoder('utf-8',{fatal:true}).decode(f.content),limit=16000;return {file:{id:f.id,taskId:f.task_id,name:f.name,mime:f.mime,size:f.size,sha256:f.sha256,kind:f.kind,createdAt:f.created_at,expiresAt:f.expires_at},preview:{type:'text',text:content.slice(0,limit),truncated:content.length>limit}};}
  const download=/^files\/([a-f0-9-]{36})$/.exec(route);
  if(method==='GET'&&download){const file=one('SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND expires_at>?',download[1],owner,now());if(!file)fail(404,'FILE_NOT_FOUND','文件不存在或已过期。');return {binary:Buffer.from(file.content),mime:file.mime,downloadName:file.name};}
  if(method==='GET'&&route==='tasks')return {tasks:all('SELECT id,owner_id,workspace_id,title,operation,input_ids,status,step,version,quote_expires_at,error_code,created_at,updated_at,goal,locale,plan_json,plan_version FROM workbench_tasks WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',owner).map(view)};
  const detail=/^tasks\/([a-f0-9-]{36})$/.exec(route);
  if(method==='GET'&&detail)return {task:view(ownTask(owner,detail[1]))};
  if(method==='POST'&&route==='files')return command(owner,route,input,()=>{
   const n=one('SELECT count(*) AS n,coalesce(sum(size),0) AS bytes FROM workbench_files WHERE owner_id=? AND expires_at>?',owner,now());if(n.n>=200)fail(409,'FILE_QUOTA','文件测试额度已用完。');
   if(typeof input.base64!=='string'||input.base64.length>350000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))fail(400,'FILE_INVALID','文件内容无效。');
   const bytes=Buffer.from(input.base64,'base64');let checked;try{checked=validateFile(input.name,bytes);}catch(error){fail(400,'FILE_INVALID',error.message);}
   if(n.bytes+bytes.length>10*1024*1024)fail(409,'FILE_QUOTA','文件测试额度已用完。');
   const id=randomUUID();run('INSERT INTO workbench_files VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,owner,null,input.name,'text/plain; charset=utf-8',bytes,checked.sha256,bytes.length,'input',now(),now()+RETENTION_MS);return {file:{id,name:input.name,size:bytes.length,expiresAt:now()+RETENTION_MS}};
  });
  if(method==='POST'&&route==='estimate')return command(owner,route,input,()=>{
   fields(input,['requestId','title','operation','fileIds']);
   if(!ALLOWED.has(input.operation))fail(400,'OPERATION_INVALID','请选择文件操作。');
   if(!Array.isArray(input.fileIds)||!input.fileIds.length)fail(400,'FILE_REQUIRED','请选择文件。');
   const files=selectedFiles(owner,input.fileIds),title=text(input.title||'整理文件',200,'任务说明',1);
   if(one("SELECT count(*) n FROM workbench_tasks WHERE owner_id=? AND status NOT IN ('succeeded','failed','cancelled')",owner).n>=20)fail(409,'TASK_QUOTA','请先完成或取消已有任务。');
   const ws=workspace(owner),id=randomUUID();run('INSERT INTO workbench_tasks(id,owner_id,workspace_id,title,operation,input_ids,status,quote_expires_at,estimated_micro,budget_micro,price_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner,ws.id,title,input.operation,JSON.stringify(files.map(f=>f.id)),'awaiting-confirmation',now()+60000,'0','0','retired',now(),now());
   event({id},'planned',{steps:['读取与校验文件','统计或去重','生成可下载文件'],estimatedSeconds:5});return {task:view(ownTask(owner,id))};
  });
  const instructions=/^tasks\/([a-f0-9-]{36})\/instructions$/.exec(route);
  if(method==='POST'&&instructions){fields(input,['requestId','version','instruction','fileIds']);return command(owner,route,input,()=>{
   const task=ownTask(owner,instructions[1]);validateVersion(task,input);
   if(!['awaiting-confirmation','paused','budget-paused','awaiting-user'].includes(task.status))fail(409,'STATE_INVALID','请先暂停任务，再补充要求。');
   if(task.status==='awaiting-confirmation'&&task.quote_expires_at<=now())fail(409,'CONFIRMATION_EXPIRED','确认已过期，请重新创建任务。');
   const instruction=text(input.instruction,2000,'补充要求',2),goal=(task.goal||task.title)+'\n'+(task.locale==='en-US'?'Additional instruction: ':'补充要求：')+instruction;
   if(goal.length>4000||one('SELECT count(*) n FROM workbench_instructions WHERE task_id=?',task.id).n>=20)fail(400,'INSTRUCTION_LIMIT','当前任务的补充要求已达上限，请另建任务。');
   const files=selectedFiles(owner,input.fileIds??JSON.parse(task.input_ids)),plan=planGoal(goal,files,task.locale);
   if(plan.status!=='ready')return {applied:false,plan,task:view(task)};
   const planVersion=task.plan_version+1;
   run("UPDATE workbench_tasks SET goal=?,operation=?,input_ids=?,plan_json=?,plan_version=?,step=0,status='awaiting-confirmation',quote_expires_at=?,version=version+1,updated_at=? WHERE id=?",goal,plan.operation,JSON.stringify(files.map(f=>f.id)),JSON.stringify(plan),planVersion,now()+60000,now(),task.id);
   run('INSERT INTO workbench_instructions VALUES(?,?,?,?,?)',randomUUID(),task.id,instruction,planVersion,now());
   event(task,'scope-updated',{planVersion});
   return {applied:true,plan,task:view(ownTask(owner,task.id))};
  });}
  const action=/^tasks\/([a-f0-9-]{36})\/(confirm|pause|resume|cancel|takeover)$/.exec(route);
  if(method==='POST'&&action)return command(owner,route,input,()=>{
   const task=ownTask(owner,action[1]),name=action[2];validateVersion(task,input);
   if(FINAL.has(task.status))fail(409,'TASK_FINISHED','任务已结束。');
   if(name==='confirm'){
    if(!['awaiting-confirmation','budget-paused'].includes(task.status)||task.status==='awaiting-confirmation'&&task.quote_expires_at<=now())fail(409,'CONFIRMATION_EXPIRED','确认已过期，请重新创建任务。');
    fields(input,['requestId','version','planVersion','acceptExecution']);
    if(input.acceptExecution!==true)fail(400,'EXECUTION_NOT_CONFIRMED','请核对计划并明确批准执行。');
    if(input.planVersion!==task.plan_version)fail(409,'PLAN_CHANGED','计划已更新，请重新核对。');
    selectedFiles(owner,JSON.parse(task.input_ids));
    run("UPDATE workbench_workspaces SET controller='ai',controller_task_id=NULL,state='ready',version=version+1,updated_at=? WHERE id=? AND controller_task_id=?",now(),task.workspace_id,task.id);update(task,'queued');
   }else if(name==='cancel'){
    finish(task,'cancelled');
   }else if(name==='pause'||name==='takeover'){
    if(!['queued','running','paused','awaiting-user'].includes(task.status))fail(409,'STATE_INVALID','当前任务不能暂停。');
    const ws=one('SELECT * FROM workbench_workspaces WHERE id=?',task.workspace_id);
    if(name==='takeover'){
     if(ws.controller==='user'&&ws.controller_task_id!==task.id)fail(409,'CONTROL_BUSY','另一任务已被接管，请先恢复或取消该任务。');
     run("UPDATE workbench_workspaces SET controller='user',controller_task_id=?,state='suspended',version=version+1,updated_at=? WHERE id=?",task.id,now(),task.workspace_id);
    }
    update(task,name==='takeover'?'awaiting-user':'paused');
   }else if(name==='resume'){
    if(!['paused','awaiting-user'].includes(task.status))fail(409,'STATE_INVALID','当前任务不能恢复。');
    const ws=one('SELECT * FROM workbench_workspaces WHERE id=?',task.workspace_id);
    if(ws.controller==='user'&&ws.controller_task_id!==task.id)fail(409,'CONTROL_BUSY','另一任务已被接管，请先恢复或取消该任务。');
    run("UPDATE workbench_workspaces SET controller='ai',controller_task_id=NULL,state='ready',version=version+1,updated_at=? WHERE id=?",now(),task.workspace_id);update(task,'queued');
   }
   return {task:view(ownTask(owner,task.id))};
  });
  if(method==='POST'&&route==='desktop')fail(503,'DESKTOP_UNCONFIGURED','尚未配置真实云桌面。当前文件执行器没有远程屏幕。');
  fail(404,'WORKBENCH_ROUTE','工作台操作不存在。');
 }
 function cleanupDeletedAccount(owner,{withinTransaction=false}={}){if(pending(owner).length)fail(409,'TASKS_PENDING','请先取消或完成文件任务。');const clean=()=>{run('DELETE FROM workbench_files WHERE owner_id=?',owner);run('DELETE FROM workbench_commands WHERE owner_id=?',owner);run('DELETE FROM workbench_instructions WHERE task_id IN (SELECT id FROM workbench_tasks WHERE owner_id=?)',owner);run("UPDATE workbench_tasks SET title='已注销账户任务',goal='',plan_json='{}',plan_version=0,input_ids='[]' WHERE owner_id=?",owner);run("UPDATE workbench_workspaces SET state='released',controller='ai',controller_task_id=NULL,version=version+1 WHERE owner_id=?",owner);};if(withinTransaction)clean();else transaction(clean);}
 return {handle,tick,getPendingObligations:pending,cleanupDeletedAccount};
}
