import { randomUUID,createHash } from 'node:crypto';
import { fail,fields,text } from './social-validation.mjs';
import { validateFile,processLocalFiles,planLocalGoal,localServiceCatalog,priceMicro,STEP_COST,PRICE_VERSION,RETENTION_MS } from './workbench-adapters.mjs';
const POINT_STEP=10n,POINT_PRICE_VERSION='local-points-v1';
const pointAmount=value=>{if(typeof value!=='string'||!/^[1-9][0-9]{0,3}$/.test(value)||BigInt(value)>1000n)fail(400,'POINTS_BUDGET_INVALID','积分预算须为 1–1000 的整数。');return BigInt(value);};
const pointTask=task=>task.billing_unit==='POINT';
const FINAL=new Set(['succeeded','failed','cancelled']);
const ALLOWED=new Set(['analyze','deduplicate']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const amount=value=>{if(typeof value!=='string'||!/^\d{1,12}$/.test(value)||BigInt(value)>1000000n)fail(400,'BUDGET_INVALID','测试预算应为不超过 1 美元的整数微美元。');return BigInt(value);};
const digest=value=>createHash('sha256').update(value).digest('hex');
export function createWorkbenchService({database,socialService,enabled=false,now=Date.now,processor=processLocalFiles,pointsService=null,desktopCapabilities=null}={}){
 const db=database.raw,one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 function enabledOrFail(){if(!enabled)fail(503,'WORKBENCH_UNCONFIGURED','文件工作台未配置。当前只有明确启用的本机测试执行器可用。');}
 function ownTask(owner,id){const task=one('SELECT * FROM workbench_tasks WHERE id=? AND owner_id=?',id,owner);if(!task)fail(404,'TASK_NOT_FOUND','任务不存在。');return task;}
 function event(task,eventName,payload={}){run('INSERT INTO workbench_events VALUES(?,?,?,?,?)',randomUUID(),task.id,eventName,JSON.stringify(payload),now());}
 function view(task){return {billingUnit:task.billing_unit||'LEGACY_TRIAL',...(pointTask(task)?{estimatedPoints:task.estimated_points,budgetPoints:task.budget_points,reservedPoints:task.reserved_points,spentPoints:task.spent_points,releasedPoints:task.released_points,remainingPoints:(BigInt(task.budget_points)-BigInt(task.spent_points)).toString(),pointsPriceVersion:task.points_price_version}:{}),id:task.id,title:task.title,goal:task.goal,locale:task.locale,planVersion:task.plan_version,plan:task.plan_version?JSON.parse(task.plan_json):null,remainingSteps:Math.max(0,3-task.step),instructions:all('SELECT id,instruction,plan_version AS planVersion,created_at AS createdAt FROM workbench_instructions WHERE task_id=? ORDER BY created_at,rowid',task.id),operation:task.operation,status:task.status,step:task.step,version:task.version,workspaceId:task.workspace_id,workspace:one('SELECT id,state,controller,controller_task_id AS controllerTaskId,version FROM workbench_workspaces WHERE id=?',task.workspace_id),quoteExpiresAt:task.quote_expires_at,estimatedMicro:task.estimated_micro,budgetMicro:task.budget_micro,costMicro:task.cost_micro,reservedMicro:task.reserved_micro,settledMicro:task.settled_micro,releasedMicro:task.released_micro,billingState:task.billing_state,priceVersion:task.price_version,payer:pointTask(task)?'local-points':'platform-trial',userChargeMicro:'0',simulation:true,error:task.error_code,createdAt:task.created_at,updatedAt:task.updated_at,outputs:all('SELECT id,name,mime,size,expires_at AS expiresAt FROM workbench_files WHERE task_id=? AND kind=? AND expires_at>?',task.id,'output',now()),events:all('SELECT event,payload,created_at AS createdAt FROM workbench_events WHERE task_id=? ORDER BY created_at,rowid',task.id).map(row=>({...row,payload:JSON.parse(row.payload)})),approvals:all('SELECT id,action,parameters,status,expires_at AS expiresAt,version FROM workbench_approvals WHERE task_id=?',task.id).map(row=>({...row,parameters:JSON.parse(row.parameters)})),invoice:one('SELECT id,cost_micro AS costMicro,total_micro AS totalMicro,user_charge_micro AS userChargeMicro,payer,state FROM workbench_invoices WHERE task_id=?',task.id)||null};}
 function selectedFiles(owner,ids){if(!Array.isArray(ids)||ids.length>5||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)fail(400,'FILE_REQUIRED','请选择最多 5 个不同文件。');return ids.map(id=>{const file=one("SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND kind='input' AND expires_at>?",id,owner,now()+60000);if(!file)fail(404,'FILE_NOT_FOUND','文件不存在或即将过期。');return file;});}
 function workspace(owner){let ws=one('SELECT * FROM workbench_workspaces WHERE owner_id=?',owner);if(!ws){const id=randomUUID();run('INSERT INTO workbench_workspaces(id,owner_id,state,controller,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,owner,'ready','ai',1,now(),now());ws={id};}return ws;}
 function planGoal(goal,files,locale,priorCostMicro='0'){try{return planLocalGoal({goal,files,locale,priorCostMicro});}catch(error){fail(400,'PLAN_INVALID',error.message);}}
 function pointPlan(plan,spent='0'){if(pointsService&&plan.status==='ready'){const total=(BigInt(spent)+3n*POINT_STEP).toString();return {...plan,billingUnit:'POINT',estimatedPoints:total,estimatedPointsRange:{min:total,max:total},pointsPriceVersion:POINT_PRICE_VERSION};}return plan;}
 function newPlan(owner,input){const files=selectedFiles(owner,input.fileIds??[]),goal=text(input.goal,4000,'任务目标',2),locale=input.locale||'zh-CN',plan=pointPlan(planGoal(goal,files,locale));if(plan.status!=='ready')return {plan,task:null};
  const budget=pointsService?pointAmount(input.budgetPoints??'100'):amount(input.budgetMicro??'100000');if(!pointsService&&budget<10000n)fail(400,'BUDGET_TOO_SMALL','测试预算至少 0.01 美元。');
  if(one("SELECT count(*) n FROM workbench_tasks WHERE owner_id=? AND status NOT IN ('succeeded','failed','cancelled')",owner).n>=20)fail(409,'TASK_QUOTA','请先完成或取消已有任务。');
  const ws=workspace(owner),id=randomUUID();run('INSERT INTO workbench_tasks(id,owner_id,workspace_id,title,operation,input_ids,status,quote_expires_at,estimated_micro,budget_micro,price_version,created_at,updated_at,goal,locale,plan_json,plan_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner,ws.id,goal.slice(0,200),plan.operation,JSON.stringify(files.map(f=>f.id)),'awaiting-confirmation',now()+60000,plan.estimatedMicro,pointsService?'0':budget.toString(),PRICE_VERSION,now(),now(),goal,locale,JSON.stringify(plan),1);if(pointsService)run("UPDATE workbench_tasks SET billing_unit='POINT',estimated_points=?,budget_points=?,points_price_version=? WHERE id=?",plan.estimatedPoints,budget.toString(),POINT_PRICE_VERSION,id);event({id},'planned',{planner:plan.planner,planVersion:1,steps:plan.steps,estimatedSeconds:plan.estimatedSeconds});return {plan,task:view(ownTask(owner,id))};
 }
 function command(owner,path,input,fn){if(!uuid(input.requestId))fail(400,'REQUEST_ID_REQUIRED','请保留同一个操作标识重试。');const signature=digest(JSON.stringify({path,input:{...input,requestId:undefined}}));return transaction(()=>{const old=one('SELECT * FROM workbench_commands WHERE owner_id=? AND request_id=?',owner,input.requestId);if(old){if(old.signature!==signature)fail(409,'IDEMPOTENCY_CONFLICT','同一操作标识的内容不能改变。');return JSON.parse(old.response);}const result=fn();run('INSERT INTO workbench_commands VALUES(?,?,?,?,?)',owner,input.requestId,signature,JSON.stringify(result),now());return result;});}
 function update(task,status,extras={}){run('UPDATE workbench_tasks SET status=?,version=version+1,updated_at=? WHERE id=?',status,now(),task.id);event(task,status,extras);}
 function settle(task,status,error=null){
  if(FINAL.has(task.status))return;
  // Only completed, confirmed steps can consume points. Failed processing refunds all.
  let total=0n,released=0n;
  if(pointTask(task)){
   if(!pointsService)throw Error('Points service required for POINT task');
   total=status==='failed'?0n:BigInt(task.spent_points);
   const result=pointsService.settle({owner:task.owner_id,resourceId:task.id,spent:total.toString(),requestId:'workbench-settle:'+task.id});
   released=BigInt(result.released);
   run('UPDATE workbench_tasks SET reserved_points=?,spent_points=?,released_points=? WHERE id=?','0',total.toString(),released.toString(),task.id);
  }else{
   total=status==='failed'?0n:priceMicro(task.cost_micro,{roundCent:true});
   if(total>BigInt(task.budget_micro))throw new Error('Budget invariant violated');
   released=BigInt(task.reserved_micro)-total;if(released<0n)throw new Error('Reservation invariant violated');
  }
  run('INSERT INTO workbench_invoices VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),task.id,task.owner_id,task.cost_micro,pointTask(task)?'0':total.toString(),'0',pointTask(task)?'local-points':'platform-trial','settled',now());
  run('UPDATE workbench_tasks SET status=?,reserved_micro=?,settled_micro=?,released_micro=?,billing_state=?,authorized_micro=?,error_code=?,version=version+1,updated_at=? WHERE id=?',status,'0',pointTask(task)?'0':total.toString(),pointTask(task)?'0':released.toString(),'settled','0',error,now(),task.id);
  run('UPDATE workbench_approvals SET status=? WHERE task_id=? AND status=?','expired',task.id,'pending');
  event(task,status,pointTask(task)?{spentPoints:total.toString(),releasedPoints:released.toString()}:{settledMicro:total.toString(),releasedMicro:released.toString()});
  run("UPDATE workbench_workspaces SET controller='ai',controller_task_id=NULL,version=version+1,updated_at=? WHERE id=? AND controller_task_id=?",now(),task.workspace_id,task.id);
  const other=one("SELECT 1 FROM workbench_tasks WHERE workspace_id=? AND id<>? AND status IN ('running','queued')",task.workspace_id,task.id);
  if(!other)run("UPDATE workbench_workspaces SET state='suspended',version=version+1,updated_at=? WHERE id=?",now(),task.workspace_id);
 }
 function validateVersion(task,input){if(!Number.isInteger(input.version)||task.version!==input.version)fail(409,'TASK_CHANGED','任务已在另一设备更新，请刷新后重试。');}
 function pending(owner){return all("SELECT id,status,billing_state FROM workbench_tasks WHERE owner_id=? AND (status NOT IN ('succeeded','failed','cancelled','awaiting-confirmation') OR (status='awaiting-confirmation' AND (reserved_micro<>'0' OR reserved_points<>'0' OR cost_micro<>'0')))",owner).map(row=>({type:'file-task',id:row.id,status:row.status}));}
 function recordUsage(task,eventKey,cost){
  if(FINAL.has(task.status)||task.status!=='running')return false;
  const existing=one('SELECT cost_micro FROM workbench_usage WHERE task_id=? AND event_key=?',task.id,eventKey);
  if(existing){if(existing.cost_micro!==cost.toString())throw new Error('Usage conflict');return false;}
  if(pointTask(task)?BigInt(task.spent_points)+POINT_STEP>BigInt(task.budget_points):priceMicro(BigInt(task.cost_micro)+cost,{roundCent:true})>BigInt(task.budget_micro)){update(task,'budget-paused');return false;}
  run('INSERT INTO workbench_usage VALUES(?,?,?,?,?,?)',randomUUID(),task.id,eventKey,cost.toString(),task.step,now());
  run('UPDATE workbench_tasks SET cost_micro=?,authorized_micro=?,step=step+1,version=version+1,updated_at=? WHERE id=?',(BigInt(task.cost_micro)+cost).toString(),'0',now(),task.id);
  if(pointTask(task))run('UPDATE workbench_tasks SET spent_points=? WHERE id=?',(BigInt(task.spent_points)+POINT_STEP).toString(),task.id);
  event(task,'step-completed',{step:task.step+1,eventKey,...(pointTask(task)?{points:POINT_STEP.toString(),pointsPriceVersion:task.points_price_version}:{})});return true;
 }
 function tick(){if(!enabled)return;
  transaction(()=>{
   run('DELETE FROM workbench_files WHERE expires_at<=?',now());
   // A retired legacy runner must not keep the one-running-task slot or controller.
   if(pointsService)for(const task of all("SELECT * FROM workbench_tasks WHERE billing_unit='LEGACY_TRIAL' AND status NOT IN ('succeeded','failed','cancelled')"))settle(task,'cancelled','LEGACY_BILLING_RETIRED');
   const stale=all("SELECT * FROM workbench_tasks WHERE status='awaiting-confirmation' AND quote_expires_at<=?",now());
   for(const task of stale){if(BigInt(task.reserved_micro)>0n||BigInt(task.reserved_points)>0n||BigInt(task.cost_micro)>0n)settle(task,'cancelled');else run("UPDATE workbench_tasks SET status='cancelled',billing_state='settled',version=version+1,updated_at=? WHERE id=?",now(),task.id);event(task,'quote-expired');}
   run("UPDATE workbench_approvals SET status='expired' WHERE status='pending' AND expires_at<=?",now());
   // A restricted account cannot keep consuming service or strand a paused reservation.
   const restricted=all("SELECT t.* FROM workbench_tasks t JOIN account_restrictions r ON r.account_id=t.owner_id WHERE r.state<>'active' AND t.status NOT IN ('succeeded','failed','cancelled')");
   for(const task of restricted){
    if(BigInt(task.reserved_micro)>0n||BigInt(task.reserved_points)>0n||BigInt(task.cost_micro)>0n)settle(task,'cancelled','ACCOUNT_RESTRICTED');
    else{run("UPDATE workbench_tasks SET status='cancelled',billing_state='settled',error_code='ACCOUNT_RESTRICTED',version=version+1,updated_at=? WHERE id=?",now(),task.id);event(task,'cancelled',{reason:'ACCOUNT_RESTRICTED'});}
   }
   const owners=all("SELECT DISTINCT owner_id FROM workbench_tasks WHERE status IN ('queued','running')"+(pointsService?" AND billing_unit='POINT'":" AND billing_unit='LEGACY_TRIAL'"));
   for(const {owner_id:owner} of owners){
    let task=one("SELECT * FROM workbench_tasks WHERE owner_id=? AND status='running' AND billing_unit=?",owner,pointsService?'POINT':'LEGACY_TRIAL');
    const ws=one('SELECT * FROM workbench_workspaces WHERE owner_id=?',owner);
    if(ws.controller==='user')continue;
    if(!task){task=one("SELECT * FROM workbench_tasks WHERE owner_id=? AND status='queued' AND billing_unit=? ORDER BY created_at,id LIMIT 1",owner,pointsService?'POINT':'LEGACY_TRIAL');if(!task)continue;update(task,'running');run("UPDATE workbench_workspaces SET state='running',version=version+1,updated_at=? WHERE id=?",now(),task.workspace_id);continue;}
    const account=one('SELECT deleted_at FROM accounts WHERE id=?',owner);
    if(!account||account.deleted_at){settle(task,'cancelled');continue;}
    const before=pointTask(task)?BigInt(task.spent_points)+POINT_STEP:priceMicro(BigInt(task.cost_micro)+STEP_COST,{roundCent:true});
    if(before>BigInt(pointTask(task)?task.budget_points:task.budget_micro)){update(task,'budget-paused');continue;}
    try{
     if(task.step===2){
      const ids=JSON.parse(task.input_ids);const files=ids.map(id=>one("SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND kind='input' AND expires_at>?",id,owner,now()));
      if(files.some(file=>!file))throw new Error('Input expired');
      const outputs=processor(files,task.operation,{goal:task.goal,locale:task.locale,plan:task.plan_version?JSON.parse(task.plan_json):null});
      if(!Array.isArray(outputs)||!outputs.length)throw new Error('No artifact');
      const quota=one('SELECT count(*) n,coalesce(sum(size),0) bytes FROM workbench_files WHERE owner_id=? AND expires_at>?',owner,now());if(quota.n+outputs.length>200||quota.bytes+outputs.reduce((n,f)=>n+(f.content?.length||0),0)>10*1024*1024)throw new Error('Output quota');
      for(const output of outputs){if(!Buffer.isBuffer(output.content)||!output.content.length||output.content.length>1024*1024||typeof output.name!=='string'||output.name.length>150||/[\\/\x00-\x1f]/.test(output.name)||!['text/plain; charset=utf-8','text/csv; charset=utf-8','text/markdown; charset=utf-8','application/json; charset=utf-8'].includes(output.mime))throw new Error('Output invalid');run('INSERT INTO workbench_files VALUES(?,?,?,?,?,?,?,?,?,?,?)',randomUUID(),owner,task.id,output.name,output.mime,output.content,digest(output.content),output.content.length,'output',now(),now()+RETENTION_MS);}
     }
     recordUsage(task,(task.plan_version?'plan-'+task.plan_version+'-':'')+'local-step-'+task.step,STEP_COST);
     const fresh=ownTask(owner,task.id);if(fresh.step>=3)settle(fresh,'succeeded');
    }catch(error){
     run("DELETE FROM workbench_files WHERE task_id=? AND kind='output'",task.id);settle(ownTask(owner,task.id),'failed','FILE_PROCESSING_FAILED');
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
  if(method==='GET'&&route==='capabilities')return {enabled,simulation:true,executor:'local-file-parser',planner:'local-rules',goalPlanning:enabled,models:[],desktop:desktopCapabilities?desktopCapabilities():{available:false,reason:'尚未配置真实云桌面服务商'},operations:[{id:'task-draft',label:'任务草稿'},{id:'checklist',label:'待办清单'},{id:'outline',label:'文章大纲'},{id:'analyze',label:'文件统计与格式整理'},{id:'deduplicate',label:'去重并生成报告'},{id:'format-json',label:'JSON 格式化'}],priceVersion:PRICE_VERSION,...(pointsService?{billingUnit:'POINT',pointsPriceVersion:POINT_PRICE_VERSION,maxBudgetPoints:'1000',payer:'local-points'}:{billingUnit:'LEGACY_TRIAL',payer:'platform-trial',maxBudgetMicro:'1000000'}),fileLimit:262144,retentionDays:30,retentionReminderDays:[7,1],marginBasisPoints:3000,notice:'本地规则式计划与文件工具；未连接语言模型、云桌面或真实支付。'};
  if(method==='GET'&&route==='catalog')return localServiceCatalog(enabled);
  enabledOrFail();
  if(method==='POST'&&route==='plan'){fields(input,['requestId','goal','fileIds','locale',pointsService?'budgetPoints':'budgetMicro']);return command(owner,route,input,()=>newPlan(owner,input));}
  if(method==='GET'&&route==='retention'){const checkedAt=now();return {checkedAt,reminders:all("SELECT id,name,task_id,expires_at FROM workbench_files WHERE owner_id=? AND kind='output' AND expires_at>? AND expires_at<=? ORDER BY expires_at,id LIMIT 200",owner,checkedAt,checkedAt+7*86400000).map(f=>{const thresholdDays=f.expires_at-checkedAt<=86400000?1:7;return {id:f.id+':'+thresholdDays,fileId:f.id,taskId:f.task_id,name:f.name,expiresAt:f.expires_at,thresholdDays,remainingDays:Math.ceil((f.expires_at-checkedAt)/86400000)}})};}
  if(method==='GET'&&route==='files')return {files:all("SELECT id,name,size,expires_at AS expiresAt FROM workbench_files WHERE owner_id=? AND kind='input' AND expires_at>? ORDER BY created_at DESC LIMIT 100",owner,now())};
  const fileDetails=/^files\/([a-f0-9-]{36})\/details$/.exec(route);
  if(method==='GET'&&fileDetails){const f=one('SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND expires_at>?',fileDetails[1],owner,now());if(!f)fail(404,'FILE_NOT_FOUND','文件不存在或已过期。');const content=new TextDecoder('utf-8',{fatal:true}).decode(f.content),limit=16000;return {file:{id:f.id,taskId:f.task_id,name:f.name,mime:f.mime,size:f.size,sha256:f.sha256,kind:f.kind,createdAt:f.created_at,expiresAt:f.expires_at},preview:{type:'text',text:content.slice(0,limit),truncated:content.length>limit}};}
  const download=/^files\/([a-f0-9-]{36})$/.exec(route);
  if(method==='GET'&&download){const file=one('SELECT * FROM workbench_files WHERE id=? AND owner_id=? AND expires_at>?',download[1],owner,now());if(!file)fail(404,'FILE_NOT_FOUND','文件不存在或已过期。');return {binary:Buffer.from(file.content),mime:file.mime,downloadName:file.name};}
  if(method==='GET'&&route==='tasks')return {tasks:all('SELECT * FROM workbench_tasks WHERE owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50',owner).map(view)};
  const detail=/^tasks\/([a-f0-9-]{36})$/.exec(route);
  if(method==='GET'&&detail)return {task:view(ownTask(owner,detail[1]))};
  if(method==='POST'&&route==='files')return command(owner,route,input,()=>{
   const n=one('SELECT count(*) AS n,coalesce(sum(size),0) AS bytes FROM workbench_files WHERE owner_id=? AND expires_at>?',owner,now());if(n.n>=200)fail(409,'FILE_QUOTA','文件测试额度已用完。');
   if(typeof input.base64!=='string'||input.base64.length>350000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64))fail(400,'FILE_INVALID','文件内容无效。');
   const bytes=Buffer.from(input.base64,'base64');let checked;try{checked=validateFile(input.name,bytes);}catch(error){fail(400,'FILE_INVALID',error.message);}
   if(n.bytes+bytes.length>10*1024*1024)fail(409,'FILE_QUOTA','文件测试额度已用完。');
   const id=randomUUID();run('INSERT INTO workbench_files VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,owner,null,input.name,'text/plain; charset=utf-8',bytes,checked.sha256,bytes.length,'input',now(),now()+RETENTION_MS);return {file:{id,name:input.name,size:bytes.length,expiresAt:now()+RETENTION_MS}};
  });
  if(method==='POST'&&route==='estimate'&&pointsService)fail(410,'WORKBENCH_LEGACY_RETIRED','请使用积分任务计划入口。');
  if(method==='POST'&&route==='estimate')return command(owner,route,input,()=>{
   if(!ALLOWED.has(input.operation))fail(400,'OPERATION_INVALID','请选择文件操作。');
   if(!Array.isArray(input.fileIds)||input.fileIds.length<1||input.fileIds.length>5||new Set(input.fileIds).size!==input.fileIds.length)fail(400,'FILE_REQUIRED','请选择 1–5 个文件。');
   for(const id of input.fileIds)if(!one("SELECT 1 FROM workbench_files WHERE id=? AND owner_id=? AND kind='input' AND expires_at>?",id,owner,now()+60000))fail(404,'FILE_NOT_FOUND','文件不存在或即将过期。');
   const title=String(input.title||'整理文件').trim();if(title.length<1||title.length>200)fail(400,'TITLE_INVALID','任务说明限 200 字。');
   let ws=one('SELECT * FROM workbench_workspaces WHERE owner_id=?',owner);
   if(!ws){const id=randomUUID();run('INSERT INTO workbench_workspaces(id,owner_id,state,controller,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',id,owner,'ready','ai',1,now(),now());ws={id};}
   const unfinished=one("SELECT count(*) AS n FROM workbench_tasks WHERE owner_id=? AND status NOT IN ('succeeded','failed','cancelled')",owner).n;if(unfinished>=20)fail(409,'TASK_QUOTA','请先完成或取消已有任务。');
   const budget=amount(input.budgetMicro);if(budget<10000n)fail(400,'BUDGET_TOO_SMALL','测试预算至少 0.01 美元。');
   const id=randomUUID();run('INSERT INTO workbench_tasks(id,owner_id,workspace_id,title,operation,input_ids,status,quote_expires_at,estimated_micro,budget_micro,price_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner,ws.id,title,input.operation,JSON.stringify(input.fileIds),'awaiting-confirmation',now()+60000,priceMicro(STEP_COST*3n,{roundCent:true}).toString(),budget.toString(),PRICE_VERSION,now(),now());
   event({id},'estimated',{steps:['读取与校验文件','统计或去重','生成可下载文件'],estimatedSeconds:5});return {task:view(ownTask(owner,id))};
  });
  const instructions=/^tasks\/([a-f0-9-]{36})\/instructions$/.exec(route);
  if(method==='POST'&&instructions){fields(input,['requestId','version','instruction','fileIds']);return command(owner,route,input,()=>{
   const task=ownTask(owner,instructions[1]);validateVersion(task,input);if(pointsService&&!pointTask(task))fail(410,'WORKBENCH_LEGACY_RETIRED','历史试用任务只能查看或取消。');
   if(!['awaiting-confirmation','paused','budget-paused','awaiting-user'].includes(task.status))fail(409,'STATE_INVALID','请先暂停任务，再补充要求。');
   if(task.status==='awaiting-confirmation'&&task.quote_expires_at<=now())fail(409,'QUOTE_EXPIRED','报价已过期，请重新创建任务。');
   const instruction=text(input.instruction,2000,'补充要求',2),goal=(task.goal||task.title)+'\n'+(task.locale==='en-US'?'Additional instruction: ':'补充要求：')+instruction;
   if(goal.length>4000||one('SELECT count(*) n FROM workbench_instructions WHERE task_id=?',task.id).n>=20)fail(400,'INSTRUCTION_LIMIT','当前任务的补充要求已达上限，请另建任务。');
   const files=selectedFiles(owner,input.fileIds??JSON.parse(task.input_ids)),plan=pointPlan(planGoal(goal,files,task.locale,task.cost_micro),task.spent_points);
   if(plan.status!=='ready')return {applied:false,plan,task:view(task)};
   if(pointTask(task)?BigInt(plan.estimatedPoints)>1000n:BigInt(plan.estimatedMicro)>1000000n)fail(409,'BUDGET_LIMIT','新计划超过本地单任务预算上限，请结束当前任务后另建任务。');
   const planVersion=task.plan_version+1;
   run("UPDATE workbench_tasks SET goal=?,operation=?,input_ids=?,plan_json=?,plan_version=?,step=0,status='awaiting-confirmation',quote_expires_at=?,estimated_micro=?,billing_state='quoted',version=version+1,updated_at=? WHERE id=?",goal,plan.operation,JSON.stringify(files.map(f=>f.id)),JSON.stringify(plan),planVersion,now()+60000,plan.estimatedMicro,now(),task.id);
   if(pointTask(task))run('UPDATE workbench_tasks SET estimated_points=? WHERE id=?',plan.estimatedPoints,task.id);
   run('INSERT INTO workbench_instructions VALUES(?,?,?,?,?)',randomUUID(),task.id,instruction,planVersion,now());
   run("UPDATE workbench_approvals SET status='superseded' WHERE task_id=? AND status='pending'",task.id);
   event(task,'scope-updated',{planVersion,estimatedMicro:plan.estimatedMicro});
   return {applied:true,plan,task:view(ownTask(owner,task.id))};
  });}
  const action=/^tasks\/([a-f0-9-]{36})\/(confirm|pause|resume|cancel|takeover|budget-request|approve)$/.exec(route);
  if(method==='POST'&&action)return command(owner,route,input,()=>{
   const task=ownTask(owner,action[1]),name=action[2];validateVersion(task,input);
   if(pointsService&&!pointTask(task)&&name!=='cancel')fail(410,'WORKBENCH_LEGACY_RETIRED','历史试用任务只能查看或取消。');
   if(pointTask(task)&&('budgetMicro' in input||'acceptTrial' in input))fail(400,'POINTS_REQUIRED','此任务只能使用积分预算。');
   if(FINAL.has(task.status))fail(409,'TASK_FINISHED','任务已结束。');
   if(name==='confirm'){
    if(task.status!=='awaiting-confirmation'||task.quote_expires_at<=now())fail(409,'QUOTE_EXPIRED','报价已过期，请重新创建任务。');
    if(pointTask(task)){
     if(!pointsService||input.acceptPoints!==true||input.pointsPriceVersion!==task.points_price_version)fail(400,'QUOTE_NOT_CONFIRMED','请确认积分费率和预算。');
     if(input.planVersion!==task.plan_version)fail(409,'PLAN_CHANGED','计划已更新，请重新核对。');
     const budget=pointAmount(input.budgetPoints);if(budget<BigInt(task.spent_points))fail(400,'BUDGET_TOO_SMALL','预算不能低于已完成工作的积分。');
     selectedFiles(owner,JSON.parse(task.input_ids));pointsService.ensureTrial(owner);
     pointsService.reserve({owner,resourceId:task.id,amount:budget.toString(),requestId:'workbench-reserve:'+input.requestId});
     run("UPDATE workbench_tasks SET budget_points=?,reserved_points=?,billing_state='reserved' WHERE id=?",budget.toString(),budget.toString(),task.id);
    }else{
     if(input.priceVersion!==task.price_version||input.acceptTrial!==true)fail(400,'QUOTE_NOT_CONFIRMED','请确认本地测试执行器和预算上限。');
     let budget=BigInt(task.budget_micro);
     if(task.plan_version){
      if(input.planVersion!==task.plan_version)fail(409,'PLAN_CHANGED','计划已更新，请核对当前步骤和费用后确认。');
      budget=amount(input.budgetMicro);if(budget<10000n||budget<priceMicro(task.cost_micro,{roundCent:true}))fail(400,'BUDGET_TOO_SMALL','预算不能低于已完成工作的累计费用，且至少为 0.01 美元。');
      selectedFiles(owner,JSON.parse(task.input_ids));
     }else if(input.budgetMicro!==task.budget_micro)fail(400,'QUOTE_NOT_CONFIRMED','请确认原报价中的预算上限。');
     run("UPDATE workbench_tasks SET budget_micro=?,reserved_micro=?,billing_state='reserved' WHERE id=?",budget.toString(),budget.toString(),task.id);
    }
    run("UPDATE workbench_workspaces SET controller='ai',controller_task_id=NULL,state='ready',version=version+1,updated_at=? WHERE id=? AND controller_task_id=?",now(),task.workspace_id,task.id);update(task,'queued');
   }else if(name==='cancel'){
    if(task.status==='awaiting-confirmation'&&BigInt(task.reserved_micro)===0n&&BigInt(task.reserved_points)===0n&&BigInt(task.cost_micro)===0n){update(task,'cancelled');run("UPDATE workbench_tasks SET billing_state='settled' WHERE id=?",task.id);}else settle(task,'cancelled');
   }else if(name==='pause'||name==='takeover'){
    if(!['queued','running','paused','budget-paused','awaiting-user'].includes(task.status))fail(409,'STATE_INVALID','当前任务不能暂停。');
    const ws=one('SELECT * FROM workbench_workspaces WHERE id=?',task.workspace_id);
    if(name==='takeover'){
     if(ws.controller==='user'&&ws.controller_task_id!==task.id)fail(409,'CONTROL_BUSY','另一任务已被接管，请先恢复或取消该任务。');
     run("UPDATE workbench_workspaces SET controller='user',controller_task_id=?,state='suspended',version=version+1,updated_at=? WHERE id=?",task.id,now(),task.workspace_id);
    }
    update(task,name==='takeover'?'awaiting-user':'paused');
   }else if(name==='resume'){
    if(!['paused','budget-paused','awaiting-user'].includes(task.status))fail(409,'STATE_INVALID','当前任务不能恢复。');
    if(pointTask(task)?BigInt(task.spent_points)+POINT_STEP>BigInt(task.budget_points):priceMicro(BigInt(task.cost_micro)+STEP_COST,{roundCent:true})>BigInt(task.budget_micro))fail(409,'BUDGET_EXHAUSTED','剩余预算不足，请先批准新的预算。');
    const ws=one('SELECT * FROM workbench_workspaces WHERE id=?',task.workspace_id);
    if(ws.controller==='user'&&ws.controller_task_id!==task.id)fail(409,'CONTROL_BUSY','另一任务已被接管，请先恢复或取消该任务。');
    run("UPDATE workbench_workspaces SET controller='ai',controller_task_id=NULL,state='ready',version=version+1,updated_at=? WHERE id=?",now(),task.workspace_id);update(task,'queued');
   }else if(name==='budget-request'){
    if(!['paused','budget-paused','awaiting-user'].includes(task.status))fail(409,'STATE_INVALID','请先暂停任务。');
    if(pointTask(task)&&input.acceptPoints!==true)fail(400,'QUOTE_NOT_CONFIRMED','请确认追加积分预算。');
    const budget=pointTask(task)?pointAmount(input.budgetPoints):amount(input.budgetMicro);if(budget<=BigInt(pointTask(task)?task.budget_points:task.budget_micro))fail(400,'BUDGET_INVALID','新预算应大于当前上限。');
    run("UPDATE workbench_approvals SET status='superseded' WHERE task_id=? AND status='pending'",task.id);
    const id=randomUUID();run('INSERT INTO workbench_approvals VALUES(?,?,?,?,?,?,?,?,?)',id,task.id,owner,'increase-budget',JSON.stringify(pointTask(task)?{oldBudgetPoints:task.budget_points,newBudgetPoints:budget.toString(),payer:'local-points'}:{oldBudgetMicro:task.budget_micro,newBudgetMicro:budget.toString(),payer:'platform-trial'}),'pending',task.version,now(),now()+60000);event(task,'approval-requested',{id});
   }else if(name==='approve'){
    const approval=one('SELECT * FROM workbench_approvals WHERE id=? AND task_id=? AND owner_id=?',input.approvalId,task.id,owner);
    if(!approval||approval.status!=='pending'||approval.expires_at<=now()||approval.version!==task.version||input.approvalAction!=='increase-budget')fail(409,'APPROVAL_INVALID','审批已失效，请重新核对。');
    const parameters=JSON.parse(approval.parameters);if(pointTask(task)?(input.acceptPoints!==true||input.budgetPoints!==parameters.newBudgetPoints):input.budgetMicro!==parameters.newBudgetMicro)fail(400,'APPROVAL_SCOPE','批准内容必须与审批卡一致。');
    run("UPDATE workbench_approvals SET status='approved' WHERE id=?",approval.id);if(pointTask(task)){pointsService.reserve({owner,resourceId:task.id,amount:parameters.newBudgetPoints,requestId:'workbench-reserve:'+input.requestId});run('UPDATE workbench_tasks SET budget_points=?,reserved_points=? WHERE id=?',parameters.newBudgetPoints,parameters.newBudgetPoints,task.id);}else run('UPDATE workbench_tasks SET budget_micro=?,reserved_micro=? WHERE id=?',parameters.newBudgetMicro,parameters.newBudgetMicro,task.id);event(task,'budget-approved',parameters);update(task,task.status);
   }
   return {task:view(ownTask(owner,task.id))};
  });
  if(method==='POST'&&route==='desktop')fail(503,'DESKTOP_UNCONFIGURED','尚未配置真实云桌面。当前文件执行器没有远程屏幕。');
  fail(404,'WORKBENCH_ROUTE','工作台操作不存在。');
 }
 function cleanupDeletedAccount(owner,{withinTransaction=false}={}){if(pending(owner).length)fail(409,'TASKS_PENDING','请先取消或完成文件任务。');const clean=()=>{run('DELETE FROM workbench_files WHERE owner_id=?',owner);run('DELETE FROM workbench_commands WHERE owner_id=?',owner);run('DELETE FROM workbench_instructions WHERE task_id IN (SELECT id FROM workbench_tasks WHERE owner_id=?)',owner);run("UPDATE workbench_tasks SET title='已注销账户任务',goal='',plan_json='{}',plan_version=0,input_ids='[]' WHERE owner_id=?",owner);run("UPDATE workbench_workspaces SET state='released',controller='ai',controller_task_id=NULL,version=version+1 WHERE owner_id=?",owner);};if(withinTransaction)clean();else transaction(clean);}
 return {handle,tick,getPendingObligations:pending,cleanupDeletedAccount};
}
