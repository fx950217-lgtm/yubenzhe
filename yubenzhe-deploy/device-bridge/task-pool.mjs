import {mkdir,lstat,realpath} from 'node:fs/promises';
import {cpus,freemem,totalmem} from 'node:os';
import path from 'node:path';
const fail=(code,message)=>Object.assign(Error(message),{code});
export async function isolatedTaskDirectory(workspace,taskId){
 if(typeof taskId!=='string'||taskId.trim()!==taskId||!/^[A-Za-z0-9_-]{1,100}$/.test(taskId))throw fail('AI_TASK_INVALID','任务编号无效。');
 const base=await realpath(workspace);let current=base;
 for(const part of ['.ybz-ai-channel',taskId]){current=path.join(current,part);await mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});const s=await lstat(current),resolved=await realpath(current);if(s.isSymbolicLink()||!s.isDirectory()||resolved!==current)throw fail('AI_TASK_PATH','任务目录未经核验。');}
 return current;
}
export function createResourceGuard({readCPUs=cpus,free=freemem,total=totalmem}={}){
 const sample=()=>readCPUs().reduce((a,c)=>{a.idle+=c.times.idle;a.total+=Object.values(c.times).reduce((x,y)=>x+y,0);return a;},{idle:0,total:0});let before=sample();
 return ()=>{const next=sample(),delta=next.total-before.total,load=delta>0?1-(next.idle-before.idle)/delta:0;before=next;return free()>=Math.max(256*1024*1024,total()*.08)&&load<.92;};
}
// The pool owns task-local processes and directories. Queued work is not started
// until a slot and resources are available; cancellation cannot release a live
// child early. No prompt or event is written by this scheduler.
export function createTaskPool({workspace,factory,maxConcurrent=3,resourceReady=createResourceGuard(),isolated=true,maxQueued=32}={}){
 if(!Number.isInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>3)throw fail('AI_CAPACITY','并发上限必须为 1–3。');
 const active=new Map(),pending=[],jobs=new Map();let closed=false,pumping=false;
 const incomplete=()=>({kind:'failed',code:'AI_EXECUTION_FAILED',text:'任务执行或清理未完成，请核对电脑。'});
 const resources=()=>{try{return Boolean(resourceReady());}catch{return false;}};
 function notify(task,event){
  try{const delivery=task.input.onEvent?.(event);if(delivery&&typeof delivery.then==='function')Promise.resolve(delivery).catch(()=>{if(!task.finished)cancel(task,'AI_EXECUTION_FAILED');});}
  catch{if(!task.finished)cancel(task,'AI_EXECUTION_FAILED');}
 }
 async function execute(task){
  let runner;
  try{
   const cwd=isolated?await isolatedTaskDirectory(workspace,task.id):workspace;if(task.cancelled||closed)return;
   runner=await factory(cwd);task.runner=runner;if(task.cancelled||closed)return;
   task.child=runner.run({...task.input,timeoutMs:Math.max(1,task.until-Date.now()),onEvent:event=>{if(!task.finished&&!task.cancelled){if(['completed','failed'].includes(event.kind))task.terminal=event;else notify(task,event);}}});
   // run() may synchronously emit before returning its handle. Deliver any
   // cancellation requested by that callback once the child becomes available.
   if(task.cancelled)cancelChild(task);
   const result=await task.child.done;if(!task.terminal&&['completed','failed'].includes(result?.kind))task.terminal=result;
  }catch(e){task.terminal={...incomplete(),code:e.code||'AI_EXECUTION_FAILED'};}
  finally{
   try{await runner?.close();}catch{task.terminal=incomplete();}
   finally{
    finish(task,task.cancelled?{kind:'failed',code:task.cancelled,text:'已停止该任务，请核对已有成果。'}:task.terminal||{kind:'failed',code:'AI_INCOMPLETE',text:'未收到完整执行结果。'});
    active.delete(task.id);pump();
   }
  }
 }
 function pump(){if(pumping||closed)return;pumping=true;try{while(pending.length&&active.size<maxConcurrent&&resources()){
  const task=pending.shift();if(task.finished)continue;active.set(task.id,task);
  void execute(task);
 }}finally{pumping=false;}}
 function finish(task,event){if(task.finished)return;task.finished=true;clearTimeout(task.timer);task.input.signal?.removeEventListener('abort',task.abort);jobs.delete(task.id);notify(task,event);task.resolve(event);}
 function cancelChild(task){if(!task.child||task.childCancelSent)return;task.childCancelSent=true;try{const result=task.child.cancel(task.cancelled);if(result&&typeof result.then==='function')Promise.resolve(result).catch(()=>{});}catch{/* Still await child.done; a failed stop cannot free a live process slot. */}}
 function cancel(task,code='AI_CANCELLED'){if(task.finished||task.cancelled)return;task.cancelled=code;cancelChild(task);if(!active.has(task.id)){const index=pending.indexOf(task);if(index>=0)pending.splice(index,1);finish(task,{kind:'failed',code,text:'排队任务已取消，没有执行。'});}}
 function run(input={}){
  if(closed)throw fail('AI_REVOKED','连接器已停止。');if(typeof input.taskId!=='string'||input.taskId.trim()!==input.taskId||!/^[A-Za-z0-9_-]{1,100}$/.test(input.taskId)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>8000)throw fail('AI_TASK_INVALID','任务无效。');if(jobs.has(input.taskId))throw fail('AI_TASK_DUPLICATE','该任务已经排队或执行。');if(pending.filter(t=>!t.finished).length>=maxQueued)throw fail('AI_QUEUE_FULL','本机队列已满。');
  const timeout=input.timeoutMs??600000;if(!Number.isFinite(timeout)||timeout<=0||timeout>600000)throw fail('AI_TASK_INVALID','任务时限无效。');if(input.signal?.aborted)throw fail('AI_CANCELLED','任务已取消。');
  let resolve;const done=new Promise(r=>resolve=r),task={id:input.taskId,input,until:Date.now()+timeout,resolve,done};task.abort=()=>cancel(task);task.timer=setTimeout(()=>cancel(task,'AI_TIMEOUT'),timeout);task.timer.unref?.();input.signal?.addEventListener('abort',task.abort,{once:true});jobs.set(task.id,task);pending.push(task);pump();return {taskId:task.id,done,cancel:code=>cancel(task,code)};
 }
 const timer=setInterval(()=>void pump(),1000);timer.unref?.();
 return {run,get activeCount(){return active.size;},get busy(){return active.size>=maxConcurrent;},get size(){return jobs.size;},canDispatch:()=>!closed&&resources(),async close(){closed=true;clearInterval(timer);const rows=[...jobs.values()];for(const t of rows)cancel(t);await Promise.all(rows.map(t=>t.done));},maxConcurrent};
}
