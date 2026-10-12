import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile,readFile,mkdir,symlink,realpath} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createTaskPool,createResourceGuard,isolatedTaskDirectory} from '../device-bridge/task-pool.mjs';
const until=async fn=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert.ok(fn());};
async function removeWorkspace(workspace){const actual=await realpath(workspace),parent=await realpath(os.tmpdir());assert.equal(path.dirname(actual).toLowerCase(),parent.toLowerCase());assert.ok(path.basename(actual).startsWith('ybz-task-pool-'));await rm(actual,{recursive:true,force:true});}
async function fixture(t,extra={}){const workspace=await mkdtemp(path.join(os.tmpdir(),'ybz-task-pool-')),started=[],pool=createTaskPool({workspace,resourceReady:()=>true,factory:async cwd=>({run(input){let finish;const done=new Promise(r=>finish=r);const item={cwd,input,finish,cancelled:0};started.push(item);return {done,cancel(){item.cancelled++;finish({kind:'failed',code:'AI_CANCELLED'});}};},close:async()=>{}}),...extra});t.after(async()=>{await pool.close();await removeWorkspace(workspace);});return {pool,started,workspace};}
test('three concurrent jobs have isolated writable directories; fourth queues and cancellation only frees its own slot',async t=>{const f=await fixture(t),jobs=Array.from({length:4},(_,i)=>f.pool.run({taskId:'job-'+i,prompt:'fixture'}));await until(()=>f.started.length===3);assert.equal(f.pool.activeCount,3);assert.equal(new Set(f.started.map(s=>s.cwd)).size,3);for(const s of f.started)await writeFile(path.join(s.cwd,'same.txt'),s.input.taskId);assert.equal(await readFile(path.join(f.started[0].cwd,'same.txt'),'utf8'),f.started[0].input.taskId);jobs[1].cancel();await jobs[1].done;await until(()=>f.started.length===4);assert.equal(f.started.filter(s=>s.cancelled).length,1);for(const s of f.started)s.finish({kind:'completed'});await Promise.all(jobs.map(j=>j.done));assert.equal(f.pool.size,0);});
test('resource pressure keeps jobs pending without AI_BUSY and resumes only after pressure clears',async t=>{let ready=false;const f=await fixture(t,{resourceReady:()=>ready}),job=f.pool.run({taskId:'held',prompt:'fixture'});await new Promise(r=>setTimeout(r,20));assert.equal(f.started.length,0);assert.equal(f.pool.canDispatch(),false);ready=true;const next=f.pool.run({taskId:'wake',prompt:'fixture'});await until(()=>f.started.length===2);for(const s of f.started)s.finish({kind:'completed'});await Promise.all([job.done,next.done]);});
test('queued cancellation and deadline never start a process later; duplicate IDs cannot run twice',async t=>{const f=await fixture(t,{maxConcurrent:1}),a=f.pool.run({taskId:'a',prompt:'a'}),b=f.pool.run({taskId:'b',prompt:'b'});assert.throws(()=>f.pool.run({taskId:'a',prompt:'duplicate'}),{code:'AI_TASK_DUPLICATE'});b.cancel();assert.equal((await b.done).code,'AI_CANCELLED');const c=f.pool.run({taskId:'c',prompt:'c',timeoutMs:10});await new Promise(r=>setTimeout(r,25));assert.equal((await c.done).code,'AI_TIMEOUT');assert.equal(f.started.length,1);f.started[0].finish({kind:'completed'});await a.done;assert.equal(f.started.length,1);});
test('CPU and free-memory guard uses actual bounded ratios and fails low memory closed',()=>{let n=0,free=1024*1024*1024;const guard=createResourceGuard({readCPUs:()=>[{times:{idle:100+(n++?0:0),user:n*1000}}],free:()=>free,total:()=>8*1024*1024*1024});assert.equal(guard(),false);free=1;assert.equal(guard(),false);const healthy=createResourceGuard({readCPUs:()=>[{times:{idle:n++*1000,user:0}}],free:()=>2**30,total:()=>2**33});assert.equal(healthy(),true);});

async function controlled(t,{closeError=false,cancelError=false,syncEvent=false}={}){
 const workspace=await mkdtemp(path.join(os.tmpdir(),'ybz-task-pool-')),started=[];
 const pool=createTaskPool({workspace,maxConcurrent:1,resourceReady:()=>true,factory:async cwd=>({run(input){let finish;const done=new Promise(resolve=>finish=resolve),item={cwd,input,finish,cancelled:0,closed:0};started.push(item);if(syncEvent)input.onEvent({kind:'progress',code:'AI_RUNNING'});return {done,cancel(){item.cancelled++;if(cancelError)throw Error('synthetic cancel failure');}};},async close(){const item=started.find(item=>item.cwd===cwd);if(item)item.closed++;if(closeError)throw Error('synthetic cleanup failure');}})});
 t.after(async()=>{for(const item of started)item.finish({kind:'completed'});await pool.close();await removeWorkspace(workspace);});return {pool,started};
}

test('runner.close rejection settles done and frees its own slot without an unhandled rejection',async t=>{
 const f=await controlled(t,{closeError:true}),first=f.pool.run({taskId:'cleanup-a',prompt:'a'}),next=f.pool.run({taskId:'cleanup-b',prompt:'b'});
 await until(()=>f.started.length===1);f.started[0].finish({kind:'completed'});assert.equal((await first.done).code,'AI_EXECUTION_FAILED');await until(()=>f.started.length===2);assert.equal(f.started[0].closed,1);
 f.started[1].finish({kind:'completed'});assert.equal((await next.done).code,'AI_EXECUTION_FAILED');assert.equal(f.pool.activeCount,0);assert.equal(f.pool.size,0);await f.pool.close();
});

test('throwing terminal event callback cannot prevent done settlement or subsequent dispatch',async t=>{
 const f=await fixture(t,{maxConcurrent:1}),first=f.pool.run({taskId:'event-a',prompt:'a',onEvent(){throw Error('synthetic observer failure');}}),next=f.pool.run({taskId:'event-b',prompt:'b'});
 await until(()=>f.started.length===1);f.started[0].finish({kind:'completed'});assert.equal((await first.done).kind,'completed');await until(()=>f.started.length===2);f.started[1].finish({kind:'completed'});await next.done;assert.equal(f.pool.size,0);
});

test('throwing progress callback requests cancellation but retains the slot until the child actually exits',async t=>{
 const f=await controlled(t,{syncEvent:true}),first=f.pool.run({taskId:'progress-a',prompt:'a',onEvent(){throw Error('synthetic progress observer failure');}}),next=f.pool.run({taskId:'progress-b',prompt:'b'});
 await until(()=>f.started.length===1);assert.equal(f.started[0].cancelled,1);assert.equal(f.pool.activeCount,1);assert.equal(f.pool.size,2);assert.equal(f.started.length,1);
 let settled=false;first.done.then(()=>{settled=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 f.started[0].finish({kind:'failed',code:'AI_CANCELLED'});assert.equal((await first.done).code,'AI_EXECUTION_FAILED');await until(()=>f.started.length===2);f.started[1].finish({kind:'completed'});await next.done;
});

test('async event observer rejection is contained for both progress and terminal deliveries',async t=>{
 const f=await controlled(t),first=f.pool.run({taskId:'async-observer',prompt:'a',onEvent:async()=>{throw Error('synthetic rejected observer');}});await until(()=>f.started.length===1);
 f.started[0].input.onEvent({kind:'progress',code:'AI_RUNNING'});await until(()=>f.started[0].cancelled===1);assert.equal(f.pool.activeCount,1);f.started[0].finish({kind:'completed'});assert.equal((await first.done).code,'AI_EXECUTION_FAILED');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.pool.activeCount,0);assert.equal(f.pool.size,0);
});

test('cancel and repeated close race waits for live child exit even when cancel and cleanup throw',async t=>{
 const f=await controlled(t,{cancelError:true,closeError:true}),first=f.pool.run({taskId:'race-running',prompt:'a'}),queued=f.pool.run({taskId:'race-queued',prompt:'b',onEvent(){throw Error('queued observer');}});await until(()=>f.started.length===1);
 assert.doesNotThrow(()=>first.cancel());let closed=0;const a=f.pool.close().then(()=>closed++),b=f.pool.close().then(()=>closed++);assert.equal((await queued.done).code,'AI_CANCELLED');await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,0);assert.equal(f.pool.activeCount,1);assert.equal(f.started[0].cancelled,1);assert.equal(f.started.length,1);
 f.started[0].finish({kind:'failed',code:'AI_CANCELLED'});await Promise.all([first.done,a,b]);assert.equal(closed,2);assert.equal(f.pool.size,0);assert.equal(f.pool.activeCount,0);assert.equal(f.started[0].closed,1);assert.throws(()=>f.pool.run({taskId:'late',prompt:'c'}),{code:'AI_REVOKED'});
});

test('close during async runner construction never starts a child and still tolerates failing cleanup',async t=>{
 let release,constructing=false,runs=0,closes=0;const ready=new Promise(resolve=>release=resolve),f=await fixture(t,{factory:async()=>{constructing=true;await ready;return {run(){runs++;throw Error('must not start');},async close(){closes++;throw Error('cleanup');}};}});
 const job=f.pool.run({taskId:'constructing',prompt:'a'});await until(()=>constructing);let stopped=false;const stopping=f.pool.close().then(()=>{stopped=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);release();await stopping;assert.equal((await job.done).code,'AI_CANCELLED');assert.equal(runs,0);assert.equal(closes,1);assert.equal(f.pool.activeCount,0);
});

test('isolated task path rejects a symlinked channel directory before starting a process',async t=>{
 const f=await fixture(t),target=path.join(f.workspace,'outside');await mkdir(target);await writeFile(path.join(target,'sentinel.txt'),'untouched');await symlink(target,path.join(f.workspace,'.ybz-ai-channel'),process.platform==='win32'?'junction':'dir');
 const job=f.pool.run({taskId:'parent-link',prompt:'a'});assert.equal((await job.done).code,'AI_TASK_PATH');assert.equal(f.started.length,0);assert.equal(await readFile(path.join(target,'sentinel.txt'),'utf8'),'untouched');assert.equal(f.pool.activeCount,0);
});

test('isolated task path rejects a symlinked task directory and malformed IDs without escaping the workspace',async t=>{
 const f=await fixture(t),target=path.join(f.workspace,'outside'),base=path.join(f.workspace,'.ybz-ai-channel');await mkdir(target);await mkdir(base);await symlink(target,path.join(base,'task-link'),process.platform==='win32'?'junction':'dir');
 const job=f.pool.run({taskId:'task-link',prompt:'a'});assert.equal((await job.done).code,'AI_TASK_PATH');assert.equal(f.started.length,0);assert.equal(f.pool.size,0);
 for(const taskId of ['../escape','valid\n','valid\r','valid/child']){assert.throws(()=>f.pool.run({taskId,prompt:'a'}),{code:'AI_TASK_INVALID'});await assert.rejects(isolatedTaskDirectory(f.workspace,taskId),{code:'AI_TASK_INVALID'});}
});

test('resource probe exceptions fail closed without losing queued work or creating a rejected pump promise',async t=>{
 let broken=true;const f=await fixture(t,{resourceReady(){if(broken)throw Error('synthetic resource probe');return true;}}),first=f.pool.run({taskId:'guard-held',prompt:'a'});assert.equal(f.pool.canDispatch(),false);assert.equal(f.started.length,0);broken=false;
 const second=f.pool.run({taskId:'guard-wake',prompt:'b'});await until(()=>f.started.length===2);for(const item of f.started)item.finish({kind:'completed'});await Promise.all([first.done,second.done]);assert.equal(f.pool.size,0);
});
