// Synthetic local process/protocol fixtures; not a real model or physical device acceptance.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {createHash} from 'node:crypto';
import {decisionProposal,parseDecisionMessage,DECISION_GUIDANCE} from '../device-bridge/decision-protocol.mjs';
import {createCodexRunner,createCodexJsonlParser} from '../device-bridge/codex-runner.mjs';
import {createAIChannel,openAIChannelJournal} from '../device-bridge/ai-channel.mjs';
import {createTaskPool} from '../device-bridge/task-pool.mjs';
const parent='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222',third='33333333-3333-4333-8333-333333333333';
const proposal=decisionProposal({question:'样张已就绪，选择下一步',options:[{label:'再改一下',instruction:'仅调整样张颜色，完成后再问'},{label:'导出',instruction:'将已经确认的样张导出到 outbox'}]});const pause={kind:'decision',...proposal};
const sha=s=>createHash('sha256').update(s).digest('hex'),tick=()=>new Promise(r=>setImmediate(r));
const until=async fn=>{const deadline=performance.now()+5000;while(!await fn()){assert.ok(performance.now()<deadline,'fixture reached expected state before deadline');await new Promise(r=>setTimeout(r,5));}};
async function fixture(t){const base=await mkdtemp(path.join(tmpdir(),'ybz-decision-bridge-')),workspace=path.join(base,'work'),runtimeDir=path.join(base,'private'),statePath=path.join(base,'pair.json');await mkdir(workspace);await mkdir(runtimeDir);await writeFile(statePath,JSON.stringify({origin:'https://relay.example',token:'a'.repeat(43)}));t.after(()=>rm(base,{recursive:true,force:true}));return {base,workspace,runtimeDir,statePath};}
function child(){const p=new EventEmitter();p.pid=741;p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.input='';p.stdin.on('data',c=>p.input+=c);return p;}
const proposalMessage=JSON.stringify({ybzDecision:{question:proposal.question,options:proposal.options.map(({label,instruction})=>({label,instruction}))}});
test('strict decision schema has canonical fixed IDs and rejects malformed/oversized proposals',()=>{
 assert.deepEqual(parseDecisionMessage(proposalMessage),proposal);assert.equal(proposal.decisionDigest,sha(JSON.stringify({question:proposal.question,options:proposal.options})));assert.equal(parseDecisionMessage('一般文字建议'),null);assert.equal(parseDecisionMessage('{"answer":1}'),null);
 for(const value of ['{"ybzDecision":',JSON.stringify({ybzDecision:{question:'',options:[]}}),JSON.stringify({ybzDecision:JSON.parse(proposalMessage).ybzDecision,extra:1})])assert.throws(()=>parseDecisionMessage(value),{code:'AI_DECISION_INVALID'});
 assert.throws(()=>decisionProposal({question:'x'.repeat(301),options:proposal.options}),{code:'AI_DECISION_INVALID'});assert.throws(()=>decisionProposal({question:'q',options:[proposal.options[0]]}),{code:'AI_DECISION_INVALID'});
});
test('structured pause is recognized before chunking; proposal contents are not emitted as plain messages',()=>{
 const events=[],parser=createCodexJsonlParser({onEvent:e=>events.push(e)});parser.push(JSON.stringify({type:'item.completed',item:{id:'decision',type:'agent_message',text:proposalMessage}})+'\n');assert.equal(events.length,1);assert.equal(events[0].kind,'decision-proposal');assert.equal(events[0].decisionDigest,proposal.decisionDigest);
});
test('Codex decision kills the execution segment and is delivered only after process-tree shutdown',async t=>{
 const f=await fixture(t);let p,kills=0,finishKill;const killed=new Promise(r=>finishKill=r),events=[];
 const runner=await createCodexRunner({workspace:f.workspace,executable:process.execPath,spawnImpl:()=>p=child(),killTree:async()=>{kills++;await killed;}});t.after(()=>runner.close());
 const job=runner.run({taskId:parent,prompt:'制作样张',onEvent:e=>events.push(e)});assert.ok(p.input.endsWith(DECISION_GUIDANCE+'\n'));
 p.stdout.write(JSON.stringify({type:'item.completed',item:{id:'question',type:'agent_message',text:proposalMessage}})+'\n');await tick();assert.equal(kills,1);assert.equal(events.length,0);
 p.emit('close',1);await tick();assert.equal(events.length,0);finishKill();assert.equal((await job.done).kind,'decision');assert.equal(events.length,1);assert.equal(runner.busy,false);
});
test('a human cancel during decision pause takes precedence and never offers a continuation',async t=>{
 const f=await fixture(t);let p;const runner=await createCodexRunner({workspace:f.workspace,executable:process.execPath,spawnImpl:()=>p=child(),killTree:async()=>{}});t.after(()=>runner.close());const job=runner.run({taskId:parent,prompt:'fixture'});p.stdout.write(JSON.stringify({type:'item.completed',item:{id:'question',type:'agent_message',text:proposalMessage}})+'\n');await tick();job.cancel('AI_LEASE_EXPIRED');p.emit('close',0);assert.equal((await job.done).code,'AI_LEASE_EXPIRED');
});
test('kill or IPC error cannot release a live process; cancellation during shutdown overrides a proposal',async t=>{
 const f=await fixture(t);let p,finishKill;const killed=new Promise(r=>finishKill=r),events=[];const runner=await createCodexRunner({workspace:f.workspace,executable:process.execPath,spawnImpl:()=>p=child(),killTree:()=>killed});t.after(()=>runner.close());const job=runner.run({taskId:parent,prompt:'fixture',onEvent:e=>events.push(e)});
 p.stdout.write(JSON.stringify({type:'item.completed',item:{id:'question',type:'agent_message',text:proposalMessage}})+'\n');await tick();p.emit('error',Error('synthetic kill failure'));finishKill();await tick();assert.equal(events.length,0);assert.equal(runner.busy,true);p.emit('close',1);assert.equal((await job.done).kind,'failed');
 let release;const pending=new Promise(r=>release=r),other=await createCodexRunner({workspace:f.workspace,executable:process.execPath,spawnImpl:()=>p=child(),killTree:()=>pending});t.after(()=>other.close());const second=other.run({taskId:next,prompt:'fixture'});p.stdout.write(JSON.stringify({type:'item.completed',item:{id:'question',type:'agent_message',text:proposalMessage}})+'\n');await tick();p.emit('close',1);second.cancel('AI_REVOKED');release();assert.equal((await second.done).code,'AI_REVOKED');
});
test('malformed decision marker stops rather than reporting successful completion',async t=>{
 const f=await fixture(t);let p;const runner=await createCodexRunner({workspace:f.workspace,executable:process.execPath,spawnImpl:()=>p=child(),killTree:async()=>p.emit('close',1)});t.after(()=>runner.close());const job=runner.run({taskId:parent,prompt:'fixture'});p.stdout.write(JSON.stringify({type:'item.completed',item:{id:'question',type:'agent_message',text:'{"ybzDecision":{"question":"q","options":[]}}'}})+'\n');assert.equal((await job.done).code,'AI_DECISION_INVALID');
});
test('journal keeps no proposal body and authorizes one matching continuation, including after restart',async t=>{
 const f=await fixture(t),scope=sha('paired-device');let j=await openAIChannelJournal(f);await j.markStarted(parent);await j.markPaused({taskId:parent,root:parent,provider:'codex',digest:proposal.decisionDigest,scope});await j.close();j=await openAIChannelJournal(f);
 const continuation={id:next,parentTaskId:parent,workspaceTaskId:parent,provider:'codex',decisionDigest:proposal.decisionDigest};
 for(const wrong of [{...continuation,workspaceTaskId:third},{...continuation,provider:'ollama'},{...continuation,decisionDigest:sha('wrong')}])await assert.rejects(j.reserveContinuation(wrong,scope),{code:'AI_CONTINUATION_INVALID'});
 await assert.rejects(j.reserveContinuation(continuation,sha('other-device')),{code:'AI_CONTINUATION_INVALID'});await j.reserveContinuation(continuation,scope);assert.equal(j.has(next),true);await assert.rejects(j.reserveContinuation({...continuation,id:third},scope),{code:'AI_CONTINUATION_INVALID'});
 const raw=await readFile(path.join(f.runtimeDir,'ai-channel-state.json'),'utf8');assert.doesNotMatch(raw,/样张|导出|instruction|paired-device/);await j.close();
});
test('same root tasks serialize but unrelated tasks run while a continuation waits',async t=>{
 const f=await fixture(t),runs=[],pool=createTaskPool({workspace:f.workspace,resourceReady:()=>true,factory:async cwd=>({run(input){let done;const promise=new Promise(r=>done=r);runs.push({cwd,input,done});return {done:promise,cancel:()=>done({kind:'failed'})};},close:async()=>{}})});t.after(()=>pool.close());
 const a=pool.run({taskId:parent,prompt:'fixture'}),b=pool.run({taskId:next,workspaceTaskId:parent,prompt:'continuation'}),c=pool.run({taskId:third,prompt:'independent'});await until(()=>runs.length===2);assert.deepEqual(runs.map(r=>r.input.taskId).sort(),[parent,third]);const original=runs.find(r=>r.input.taskId===parent),independent=runs.find(r=>r.input.taskId===third);await writeFile(path.join(original.cwd,'sample.txt'),'real local sample');original.done(pause);assert.equal((await a.done).kind,'decision');await until(()=>runs.length===3);const continued=runs.find(r=>r.input.taskId===next);assert.equal(continued.cwd,original.cwd);assert.equal(await readFile(path.join(continued.cwd,'sample.txt'),'utf8'),'real local sample');independent.done({kind:'completed'});continued.done({kind:'completed'});await Promise.all([b.done,c.done]);
});
test('connector collects sample before pause, waits for user dispatch, preserves root and rejects second continuation',async t=>{
 const f=await fixture(t),runs=[],sent=[],queue=[{id:parent,prompt:'sample',leaseId:'lease',expiresAt:610000}],runner={configuration:{workspace:f.workspace,isolatedTasks:true},loginStatus:async()=>({code:'ready'}),run(input){runs.push(input);let end;const done=new Promise(r=>end=r);input.finish=event=>{input.onEvent(event);end(event);};return {done,cancel:()=>input.finish({kind:'failed'})};},close:async()=>{}};
 let collected=0;const channel=await createAIChannel({...f,runner,clock:()=>0,fileHooks:{collectTask:async()=>{await tick();collected++;}},fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);sent.push(input);return new Response(JSON.stringify({serverNow:10000,expiresAt:25000,ack:input.events.at(-1)?.seq||0,task:input.taskId?null:queue.shift()||null}));}});t.after(()=>channel.close());
  await channel.pollOnce();await until(()=>runs.length===1);runs[0].finish(pause);await until(()=>collected===1);await until(async()=>{await channel.pollOnce();return sent.some(s=>s.events.some(e=>e.kind==='decision'));});assert.equal(runs.length,1);assert.equal(channel.activeTaskId,null);
  const continuation={id:next,prompt:'export approved',leaseId:'lease2',expiresAt:610000,parentTaskId:parent,workspaceTaskId:parent,decisionDigest:proposal.decisionDigest};queue.push(continuation);await channel.pollOnce();await until(()=>runs.length===2);assert.equal(runs[1].workspaceTaskId,parent);runs[1].finish({kind:'completed'});await until(()=>collected===2);await until(async()=>{await channel.pollOnce();return channel.activeTaskId===null;});queue.push({...continuation,id:third});await until(async()=>{await channel.pollOnce();return sent.some(s=>s.events.some(e=>e.code==='AI_CONTINUATION_INVALID'));});assert.equal(runs.length,2);
});
