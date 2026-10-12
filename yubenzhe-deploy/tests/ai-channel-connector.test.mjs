// Synthetic protocol/process fixtures. These tests do not claim real Codex or relay acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createCodexJsonlParser,createCodexRunner,killCodexProcessTree,validateCodexPaths,codexExecutionArguments,assertCodexConfigBoundary} from '../device-bridge/codex-runner.mjs';
import {createAIChannel,openAIChannelJournal,parseAIChannelArguments,redactAIChannelText} from '../device-bridge/ai-channel.mjs';
import {generateKeyPairSync} from 'node:crypto';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){const base=await mkdtemp(path.join(tmpdir(),'ybz-ai-fixture-'));t.after(()=>rm(base,{recursive:true,force:true}));const workspace=path.join(base,'work'),runtimeDir=path.join(base,'private');await mkdir(workspace);await mkdir(runtimeDir);const statePath=path.join(base,'pair.json');await writeFile(statePath,JSON.stringify({origin:'https://relay.example',token:'a'.repeat(43)}));return {base,workspace,runtimeDir,statePath};}
function child(){const p=new EventEmitter();p.pid=741;p.stdout=new PassThrough();p.stderr=new PassThrough();p.stdin=new PassThrough();p.input='';p.stdin.on('data',chunk=>p.input+=chunk.toString());p.kill=()=>p.emit('close',1);return p;}
function fakeRunner(workspace){const runs=[],cancelled=[];return {configuration:{workspace},runs,cancelled,loginStatus:async()=>({code:'ready'}),run(input){runs.push(input);let finish;const done=new Promise(resolve=>finish=resolve);const job={done,cancel(code){cancelled.push(code);input.onEvent({kind:'failed',code,text:'已停止'});finish();}};input.complete=()=>{input.onEvent({kind:'completed',code:'AI_COMPLETED',text:'已完成'});finish();};return job;},async close(){}};}
const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const task={id:'task_01',prompt:'写一份本地说明',leaseId:'lease_01',expiresAt:610000};
function reply(input,extra={}){return {serverNow:10000,expiresAt:25000,task:null,ack:input.events?.at(-1)?.seq||0,...extra};}

test('observed JSONL agent text is parsed; tool commands, raw error and stderr payload are never emitted',()=>{
 const events=[];const parser=createCodexJsonlParser({onEvent:e=>events.push(e)});
 const records=[{type:'thread.started',thread_id:'local'},{type:'item.completed',item:{id:'item_0',type:'error',message:'Code Mode is unavailable because host executable was not found; secret-value'}},{type:'turn.started'},{type:'item.completed',item:{id:'command_1',type:'command_execution',command:'cat private-config',aggregated_output:'private-value'}},{type:'item.completed',item:{id:'item_1',type:'agent_message',text:'收到'}},{type:'item.completed',item:{id:'item_1',type:'agent_message',text:'重复'}},{type:'turn.completed',usage:{input_tokens:20167}}];
 const json=records.map(x=>JSON.stringify(x)).join('\n');parser.push(json.slice(0,51));parser.push(json.slice(51));parser.end();assert.equal(parser.completed,true);assert.deepEqual(events.filter(x=>x.kind==='message').map(x=>x.text),['收到']);assert.equal(parser.diagnostic,'AI_TOOL_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(events),/secret-value|private-config|private-value|input_tokens/);
});

test('parser enforces line and output limits and handles malformed events',()=>{
 let limits=0;const events=[];const parser=createCodexJsonlParser({onEvent:e=>events.push(e),onLimit:()=>limits++,maxOutputChars:5});parser.push('not json\n'+JSON.stringify({type:'item.completed',item:{id:'item_1',type:'agent_message',text:'123456'}})+'\n');assert.equal(limits,1);assert.equal(events.length,0);const p=createCodexJsonlParser({onLimit:()=>limits++,maxLineBytes:8});p.push('123456789');assert.equal(limits,2);
});

test('runner passes prompt on stdin with fixed workspace-write argv and rejects parallel execution',async t=>{
 const f=await fixture(t),calls=[];const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:(...args)=>{const p=child();calls.push({args,p});return p;}});const events=[];const job=runner.run({taskId:'task_a',prompt:'quote " & secret test',onEvent:e=>events.push(e)});assert.throws(()=>runner.run({taskId:'b',prompt:'b'}),{code:'AI_BUSY'});assert.deepEqual(calls[0].args[1],codexExecutionArguments(runner.configuration.workspace));assert.equal(calls[0].args[1].includes('--ignore-user-config'),true);assert.equal(calls[0].args[1].includes('--ignore-rules'),false);assert.equal(calls[0].args[1].includes('on-request'),true);assert.equal(calls[0].args[2].shell,false);assert.equal(calls[0].args[2].windowsHide,true);assert.equal(calls[0].p.input,'quote " & secret test\n');calls[0].p.stdout.write('{"type":"turn.completed"}\n');calls[0].p.emit('close',0);assert.equal((await job.done).kind,'completed');assert.equal(runner.busy,false);assert.doesNotMatch(JSON.stringify(calls[0].args),/secret test|danger-full|bypass|approveforme/);
});

test('runner cancelled or timed out process uses tree killer and never turns close 0 into success',async t=>{
 const f=await fixture(t);let p,kills=0;const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,maxTaskMs:20,spawnImpl:()=>p=child(),killTree:async proc=>{kills++;proc.emit('close',0);}});const first=runner.run({taskId:'first',prompt:'a'});first.cancel('AI_REVOKED');assert.equal((await first.done).code,'AI_REVOKED');assert.equal(kills,1);const second=runner.run({taskId:'second',prompt:'b'});await new Promise(resolve=>setTimeout(resolve,40));assert.equal((await second.done).code,'AI_TIMEOUT');assert.equal(kills,2);
});

test('runner login only queries status and raw authentication errors are not exposed',async t=>{
 const f=await fixture(t),calls=[];const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:(exe,args)=>{calls.push(args);const p=child();setImmediate(()=>{p.stderr.write('not logged in: local credential-secret');p.emit('close',1);});return p;}});assert.deepEqual(await runner.loginStatus(),{code:'login-required'});assert.deepEqual(calls,[['login','status']]);
});

test('missing turn.completed stays incomplete even if process exits successfully',async t=>{const f=await fixture(t);let p;const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:()=>p=child()});const job=runner.run({taskId:'task',prompt:'a'});p.emit('close',0);assert.equal((await job.done).code,'AI_INCOMPLETE');});

test('Windows process tree stop uses taskkill /T /F with no shell and fallback for failures',async()=>{let args,fallback=0;const target={pid:741,kill:()=>fallback++};await killCodexProcessTree(target,{platform:'win32',spawnImpl:(...input)=>{args=input;const p=new EventEmitter();setImmediate(()=>p.emit('close',1));return p;}});assert.match(args[0],/taskkill\.exe$/);assert.deepEqual(args[1],['/PID','741','/T','/F']);assert.equal(args[2].windowsHide,true);assert.equal(args[2].shell,false);assert.equal(fallback,1);});

test('startup refuses relative/root cwd and command override arguments',async t=>{const f=await fixture(t);await assert.rejects(validateCodexPaths({executable:'codex',workspace:f.workspace}),{code:'AI_STARTUP_PATH'});await assert.rejects(validateCodexPaths({executable:process.execPath,workspace:path.parse(f.workspace).root}),{code:'AI_STARTUP_PATH'});assert.throws(()=>parseAIChannelArguments(['--shell','cmd']),{code:'AI_ARGUMENTS'});assert.throws(()=>parseAIChannelArguments(['--codex','a','--codex','b']),{code:'AI_ARGUMENTS'});});

test('journal is outside workspace, exclusive, bounded, and preserves duplicate rejection after restart',async t=>{const f=await fixture(t);await assert.rejects(openAIChannelJournal({runtimeDir:path.join(f.workspace,'state'),workspace:f.workspace}),{code:'AI_STATE_PATH'});const j=await openAIChannelJournal({...f,maxStarted:1});await assert.rejects(openAIChannelJournal(f),{code:'AI_CONNECTOR_RUNNING'});assert.equal(await j.markStarted('task_secret_prompt_notstored'),true);assert.equal(j.full,true);await assert.rejects(j.markStarted('another'),{code:'AI_JOURNAL_FULL'});const text=await readFile(path.join(f.runtimeDir,'ai-channel-state.json'),'utf8');assert.doesNotMatch(text,/task_secret_prompt_notstored|token|prompt/);const connectorId=j.connectorId;await j.close();const again=await openAIChannelJournal({...f,maxStarted:1});assert.equal(again.connectorId,connectorId);assert.equal(again.has('task_secret_prompt_notstored'),true);await again.close();});

test('connector refuses HTTP and rejects pairing credentials inside AI workspace',async t=>{const f=await fixture(t),runner=fakeRunner(f.workspace);await writeFile(f.statePath,JSON.stringify({origin:'http://localhost:1234',token:'a'.repeat(43)}));await assert.rejects(createAIChannel({...f,runner}),{code:'AI_HTTPS_REQUIRED'});const state=path.join(f.workspace,'state.json');await writeFile(state,'{}');await assert.rejects(createAIChannel({...f,statePath:state,runner}),{code:'AI_STATE_PATH'});});

test('connector persists execution before running, sends only bounded public events, and acknowledges numeric seq',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let dispatched=false;const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(url,options)=>{assert.equal(url,'https://relay.example/api/device-bridge/ai/poll');assert.equal(options.redirect,'error');const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,dispatched?{}:(dispatched=true,{task})));}});t.after(()=>channel.close());await channel.pollOnce();await tick();assert.equal(runner.runs.length,1);const journal=await readFile(path.join(f.runtimeDir,'ai-channel-state.json'),'utf8');assert.doesNotMatch(journal,/写一份|task_01/);runner.runs[0].onEvent({kind:'message',itemId:'item_1',text:'API_KEY=example-secret\n这是结果'});runner.runs[0].complete();await channel.pollOnce();assert.equal(channel.activeTaskId,null);assert.deepEqual(inputs[1].events.map(e=>e.seq),[1,2]);assert.match(inputs[1].events[0].text,/已隐藏/);assert.doesNotMatch(JSON.stringify(inputs),/example-secret|写一份/);assert.equal(inputs[1].leaseId,task.leaseId);
});

test('same task returned after connector restart is never executed again',async t=>{const f=await fixture(t);const fetchImpl=async(_url,options)=>response(reply(JSON.parse(options.body),{task}));const a=fakeRunner(f.workspace),first=await createAIChannel({...f,runner:a,fetchImpl,clock:()=>0});await first.pollOnce();await tick();assert.equal(a.runs.length,1);await first.close();const b=fakeRunner(f.workspace),second=await createAIChannel({...f,runner:b,fetchImpl,clock:()=>0});t.after(()=>second.close());await second.pollOnce();await tick();assert.equal(b.runs.length,0);});

test('lease expiration on connection loss kills active job without re-executing',async t=>{const f=await fixture(t),runner=fakeRunner(f.workspace);let now=0,calls=0;const channel=await createAIChannel({...f,runner,clock:()=>now,fetchImpl:async(_url,options)=>{if(calls++)throw Error('network');return response(reply(JSON.parse(options.body),{task}));}});t.after(()=>channel.close());await channel.pollOnce();await tick();now=15001;await channel.pollOnce();assert.deepEqual(runner.cancelled,['AI_LEASE_EXPIRED']);assert.equal(runner.runs.length,1);});

test('server revocation and cancellation kill active execution',async t=>{for(const kind of ['revoke','cancel']){const f=await fixture(t),runner=fakeRunner(f.workspace);let calls=0;const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);if(!calls++)return response(reply(input,{task}));return kind==='revoke'?new Response('{}',{status:401}):response(reply(input,{cancelTaskId:task.id}));}});await channel.pollOnce();await tick();await channel.pollOnce();assert.deepEqual(runner.cancelled,[kind==='revoke'?'AI_REVOKED':'AI_CANCELLED']);if(kind==='revoke')assert.equal(channel.stopped,true);await channel.close();}});

test('preparing files does not block lease polls and cancelled preparation can never start Codex',async t=>{const f=await fixture(t),runner=fakeRunner(f.workspace);let release,signal,calls=0;const pending=new Promise(resolve=>release=resolve);const channel=await createAIChannel({...f,runner,clock:()=>0,fileHooks:{publicKey:'fixture-public-key',prepareTask:async(_task,options)=>{signal=options.signal;await pending;return {promptSuffix:'inbox/task'};}},fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);return response(reply(input,!calls++?{task}:{cancelTaskId:task.id}));}});t.after(()=>channel.close());await channel.pollOnce();assert.equal(runner.runs.length,0);await channel.pollOnce();assert.equal(signal.aborted,true);release();await tick();assert.equal(runner.runs.length,0);});

test('file collection cancellation cannot later emit a successful result',async t=>{const f=await fixture(t),runner=fakeRunner(f.workspace);let release,calls=0;const inputs=[],pending=new Promise(resolve=>release=resolve);const channel=await createAIChannel({...f,runner,clock:()=>0,fileHooks:{collectTask:async()=>pending},fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,!calls++?{task}:calls===2?{cancelTaskId:task.id}:{}));}});t.after(()=>channel.close());await channel.pollOnce();await tick();runner.runs[0].complete();await tick();await channel.pollOnce();release();await tick();await channel.pollOnce();assert.equal(inputs.flatMap(x=>x.events).some(x=>x.kind==='completed'),false);assert.equal(channel.activeTaskId,null);assert.deepEqual(inputs[2].events,[]);});

test('failed poll resends identical event sequence, invalid acknowledgement stops job',async t=>{const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let calls=0;const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);calls++;if(calls===1)return response(reply(input,{task}));if(calls===2)throw Error('network');return response(reply(input,{ack:999}));}});t.after(()=>channel.close());await channel.pollOnce();await tick();runner.runs[0].onEvent({kind:'message',itemId:'a',text:'结果'});await channel.pollOnce();await channel.pollOnce();assert.deepEqual(inputs[1].events,inputs[2].events);assert.deepEqual(runner.cancelled,['AI_LEASE_EXPIRED']);});

test('credential redaction removes common secrets while preserving useful prose',()=>{
 assert.equal(redactAIChannelText('文件已整理。'),'文件已整理。');
 // Generate a disposable test key in memory; no credential material belongs in source.
 const key=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});
 const result=redactAIChannelText('private_key: very-sensitive\nsk-abcdefghijklmnop\n'+key);
 assert.doesNotMatch(result,/very-sensitive|abcdefghijklmnop/);
 assert.equal(result.includes(key.trim().split('\n')[1]),false);
});

test('credential masking is applied before message chunk boundaries',()=>{const events=[],parser=createCodexJsonlParser({onEvent:e=>events.push(e)});parser.push(JSON.stringify({type:'item.completed',item:{id:'item_1',type:'agent_message',text:'x'.repeat(1995)+'\nAPI_KEY=boundary-secret\nfinished'}})+'\n');assert.doesNotMatch(JSON.stringify(events),/boundary-secret|API_KEY/);assert.match(events.map(e=>e.text).join(''),/finished/);});

test('file factory receives fixed routes and supports a complete encrypted chunk response',async t=>{const f=await fixture(t),runner=fakeRunner(f.workspace),seen=[];let rpc;const channel=await createAIChannel({...f,runner,fileHooksFactory:options=>{rpc=options.call;return {publicKey:'fixture-key'};},fetchImpl:async(url,options)=>{seen.push({url,options});return response({data:'A'.repeat(262144)});}});t.after(()=>channel.close());const controller=new AbortController();const value=await rpc('files/public-id/chunks/0/read',{taskId:'test'}, {signal:controller.signal});assert.equal(value.data.length,262144);assert.equal(seen[0].url,'https://relay.example/api/device-bridge/ai/files/public-id/chunks/0/read');assert.equal(seen[0].options.signal.aborted,false);controller.abort();assert.equal(seen[0].options.signal.aborted,true);});

test('actual observed code-mode error is failure even with turn.completed and exit 0',async t=>{const f=await fixture(t);let p;const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:()=>p=child()});const job=runner.run({taskId:'a',prompt:'a'});p.stdout.write(JSON.stringify({type:'item.completed',item:{id:'item_0',type:'error',message:'Code Mode is unavailable because host executable was not found.'}})+'\n{"type":"turn.completed"}\n');p.emit('close',0);assert.equal((await job.done).code,'AI_TOOL_UNAVAILABLE');});

test('explicit turn.failed and top-level errors cannot become successful results',async t=>{for(const event of [{type:'turn.failed',error:{message:'quota limit reached'}},{type:'error',message:'unclassified diagnostic'}]){const f=await fixture(t);let p;const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:()=>p=child()});const job=runner.run({taskId:'a',prompt:'a'});p.stdout.write(JSON.stringify(event)+'\n{"type":"turn.completed"}\n');p.emit('close',0);assert.equal((await job.done).kind,'failed');}});

test('valid 8000 character prompt has a separate bounded trusted suffix budget',async t=>{const f=await fixture(t);let p;const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:()=>p=child()});assert.throws(()=>runner.run({taskId:'a',prompt:'x'.repeat(8001)}),{code:'AI_TASK_INVALID'});assert.throws(()=>runner.run({taskId:'a',prompt:'x',promptSuffix:'f'.repeat(2001)}),{code:'AI_TASK_INVALID'});const job=runner.run({taskId:'a',prompt:'x'.repeat(8000),promptSuffix:'files: local-inbox'});assert.equal(p.input,'x'.repeat(8000)+'\nfiles: local-inbox\n');p.stdout.write('{"type":"turn.completed"}\n');p.emit('close',0);assert.equal((await job.done).kind,'completed');});

test('config boundary excludes exact ignored global config and fails closed for project or managed layers',async t=>{const f=await fixture(t),systemDir=path.join(f.base,'system');await mkdir(systemDir);assert.doesNotThrow(()=>assertCodexConfigBoundary(f.workspace,{systemDir}));await mkdir(path.join(f.workspace,'.codex'));await writeFile(path.join(f.workspace,'.codex','config.toml'),'{}');assert.throws(()=>assertCodexConfigBoundary(f.workspace,{systemDir}),{code:'AI_CONFIGURATION_UNVERIFIED'});await rm(path.join(f.workspace,'.codex','config.toml'));await writeFile(path.join(systemDir,'requirements.toml'),'');assert.throws(()=>assertCodexConfigBoundary(f.workspace,{systemDir}),{code:'AI_CONFIGURATION_UNVERIFIED'});});

test('creating project config after connector startup blocks next execution before spawn',async t=>{const f=await fixture(t);let calls=0;const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:()=>{calls++;return child();}});await mkdir(path.join(f.workspace,'.codex'));await writeFile(path.join(f.workspace,'.codex','config.toml'),'[mcp_servers.untrusted]');assert.throws(()=>runner.run({taskId:'a',prompt:'a'}),{code:'AI_CONFIGURATION_UNVERIFIED'});assert.equal(calls,0);});

test('authoritative server terminal clears locally completed unacknowledged events without replay',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let count=0;const next={...task,id:'task_02',leaseId:'lease_02'};
 const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);count++;return response(reply(input,count===1?{task}:count===2?{cancelTaskId:task.id,ack:0}:count===3?{task:next}:{}));}});t.after(()=>channel.close());
 await channel.pollOnce();await tick();runner.runs[0].onEvent({kind:'message',itemId:'answer',text:'结果'});runner.runs[0].complete();await channel.pollOnce();assert.equal(channel.activeTaskId,null);assert.deepEqual(inputs[1].events.map(e=>e.seq),[1,2]);await channel.pollOnce();await tick();assert.equal(runner.runs.length,2);assert.equal(runner.runs[1].taskId,next.id);assert.deepEqual(inputs[2].events,[]);assert.equal(inputs[2].taskId,undefined);
});

test('server terminal waits for real process exit before releasing active task or accepting another',async t=>{
 const f=await fixture(t);let release,cancelled=0,count=0;const runs=[],runner={configuration:{workspace:f.workspace},loginStatus:async()=>({code:'ready'}),run(input){runs.push(input);const done=new Promise(resolve=>release=resolve);return {done,cancel(){cancelled++;}};},async close(){release?.();}};
 const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);count++;return response(reply(input,count===1?{task}:count===2?{cancelTaskId:task.id,ack:0,task:{...task,id:'must_not_dispatch'}}:{}));}});t.after(()=>channel.close());await channel.pollOnce();await tick();const cancelling=channel.pollOnce();await tick();assert.equal(cancelled,1);assert.equal(channel.activeTaskId,task.id);await channel.pollOnce();assert.equal(count,2);assert.equal(runs.length,1);release();await cancelling;assert.equal(channel.activeTaskId,null);assert.equal(runs.length,1);
});

test('Windows restores elevated native isolation when ignoring global config without weakening other policies',()=>{
 const args=codexExecutionArguments('C:\\workspace',{platform:'win32'});assert.equal(args[args.indexOf('--sandbox')+1],'workspace-write');assert.equal(args[args.indexOf('-c')+1],'windows.sandbox="elevated"');assert.equal(args.includes('--ignore-user-config'),true);assert.equal(args.includes('--ignore-rules'),false);assert.equal(args.includes('--approve-for-me'),false);assert.doesNotMatch(args.join(' '),/unelevated|danger-full-access|bypass/);assert.equal(codexExecutionArguments('/workspace',{platform:'linux'}).some(x=>x.startsWith('windows.sandbox=')),false);
});

test('observed read-only sandbox rejection on stderr cannot report successful execution after exit 0',async t=>{
 const f=await fixture(t);let p;const runner=await createCodexRunner({executable:process.execPath,workspace:f.workspace,spawnImpl:()=>p=child()});const job=runner.run({taskId:'blocked',prompt:'create the approved local file'});p.stderr.write('ERROR codex_core::tools::router: error=patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings');p.stdout.write('{"type":"turn.completed"}\n');p.emit('close',0);assert.equal((await job.done).code,'AI_TOOL_UNAVAILABLE');
});

const registryProvider=(id,ready=true)=>({id,name:id,installed:true,loggedIn:id==='ollama'?null:true,version:'1.2.3',reason:'fixture metadata',executionSupported:ready,executionMode:ready?(id==='ollama'?'chat-only':'tools'):'disabled'});
test('modern connector dispatches the selected provider, projects public metadata and skips chat-only file hooks',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let sent=false;
 runner.loginStatus=async()=>({providers:[{...registryProvider('ollama'),executable:'private-path',authOutput:'private-output'}],scannedAt:123,executables:{ollama:'private-path'}});
 const channel=await createAIChannel({...f,runner,clock:()=>0,fileHooks:{prepareTask:()=>assert.fail('chat model cannot read files'),collectTask:()=>assert.fail('chat model cannot write files')},fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,sent?{}:(sent=true,{task:{...task,provider:'ollama',attachments:[]}})));}});t.after(()=>channel.close());
 await channel.pollOnce();await tick();assert.equal(runner.runs.length,1);assert.equal(runner.runs[0].provider,'ollama');runner.runs[0].complete();await channel.pollOnce();assert.equal(channel.activeTaskId,null);assert.equal(inputs[0].status.scannedAt,123);assert.doesNotMatch(JSON.stringify(inputs),/private-path|private-output|executables|authOutput/);assert.equal(inputs[1].events.at(-1).kind,'completed');
});
test('chat-only attachments are rejected before journal or execution, without a Codex fallback',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let sent=false;
 runner.loginStatus=async()=>({providers:[registryProvider('codex'),registryProvider('ollama')],scannedAt:123});
 const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,sent?{}:(sent=true,{task:{...task,provider:'ollama',attachments:[{id:'file_1'}]}})));}});t.after(()=>channel.close());
 await channel.pollOnce();await tick();await channel.pollOnce();assert.equal(runner.runs.length,0);assert.equal(inputs[1].events[0].code,'AI_PROVIDER_FILES_UNSUPPORTED');assert.deepEqual(JSON.parse(await readFile(path.join(f.runtimeDir,'ai-channel-state.json'),'utf8')).started,[]);
});
test('legacy runner readiness never implies another provider is available',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let sent=false;
 const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,sent?{}:(sent=true,{task:{...task,provider:'claude'}})));}});t.after(()=>channel.close());
 await channel.pollOnce();await tick();await channel.pollOnce();assert.equal(runner.runs.length,0);assert.equal(inputs[1].events[0].code,'AI_PROVIDER_UNAVAILABLE');assert.deepEqual(inputs[0].status.providers.map(p=>p.id),['codex']);
});
test('quota failure disables only its selected provider and leaves another provider available',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let sent=false;
 runner.loginStatus=async()=>({providers:[registryProvider('codex'),registryProvider('ollama')],scannedAt:123});
 const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,sent?{}:(sent=true,{task:{...task,provider:'codex'}})));}});t.after(()=>channel.close());
 await channel.pollOnce();await tick();runner.runs[0].onEvent({kind:'failed',code:'AI_QUOTA',text:'不可用'});await channel.pollOnce();assert.equal(inputs[1].status.code,'ready');assert.equal(inputs[1].status.providers[0].executionSupported,false);assert.equal(inputs[1].status.providers[1].executionSupported,true);assert.equal(inputs[1].events[0].code,'AI_QUOTA');
});
test('running tasks refresh real registry facts each minute and stop when their own provider disappears',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let now=0,scans=0,sent=false;
 runner.loginStatus=async()=>({providers:[registryProvider('codex',++scans<3),registryProvider('ollama')],scannedAt:10000+now});
 const channel=await createAIChannel({...f,runner,clock:()=>now,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,{serverNow:10000+now,expiresAt:25000+now,...(!sent?(sent=true,{task:{...task,provider:'codex'}}):{})}));}});t.after(()=>channel.close());
 await channel.pollOnce();await tick();for(now=10000;now<=110000;now+=10000)await channel.pollOnce();assert.equal(scans,2);assert.equal(runner.cancelled.length,0);assert.equal(inputs.at(-1).status.scannedAt,70000);
 await channel.pollOnce();assert.equal(scans,3);assert.deepEqual(runner.cancelled,['AI_PROVIDER_UNAVAILABLE']);await channel.pollOnce();assert.equal(inputs.at(-1).status.code,'ready');assert.equal(inputs.at(-1).events.at(-1).code,'AI_PROVIDER_UNAVAILABLE');assert.equal(runner.runs.length,1);
});
test('failed refresh disables the last ready snapshot instead of renewing cached login facts',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[];let now=0,scans=0;
 runner.loginStatus=async()=>{if(scans++)throw Error('secret local diagnostic');return {providers:[registryProvider('codex')],scannedAt:123};};
 const channel=await createAIChannel({...f,runner,clock:()=>now,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input));}});t.after(()=>channel.close());
 await channel.pollOnce();now=60000;await channel.pollOnce();assert.equal(inputs[1].status.code,'error');assert.equal(inputs[1].status.providers[0].executionSupported,false);assert.doesNotMatch(JSON.stringify(inputs),/secret local diagnostic/);
});

test('multi-task connector sends task-local sequence/lease/ack and queues the fourth without mixing events',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace),inputs=[],acks=new Map();runner.configuration.maxConcurrent=3;let issued=0;const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);if(input.taskId)acks.set(input.taskId,input.events.at(-1)?.seq??acks.get(input.taskId)??0);return response({...reply(input,!input.taskId&&issued<4?{task:{...task,id:'multi_'+(++issued),leaseId:'lease_'+issued}}:{}),ack:acks.get(input.taskId)||0});}});t.after(()=>channel.close());for(let i=0;i<3;i++)await channel.pollOnce();await tick();assert.equal(runner.runs.length,3);for(const r of runner.runs)r.onEvent({kind:'message',itemId:'same-item',text:r.taskId});await channel.pollOnce();assert.equal(runner.runs.length,3);const batches=inputs.filter(x=>x.events.length);assert.equal(batches.length,3);for(const b of batches){assert.equal(b.events[0].seq,1);assert.equal(b.events[0].text,b.taskId);assert.equal(b.leaseId,'lease_'+b.taskId.split('_')[1]);}runner.runs[1].complete();await channel.pollOnce();await channel.pollOnce();await tick();assert.equal(runner.runs.length,4);assert.equal(channel.activeTaskIds.length,3);
});
test('concurrent journal writes are durable and do not race a shared temporary filename',async t=>{const f=await fixture(t),j=await openAIChannelJournal(f);await Promise.all(Array.from({length:30},(_,i)=>j.markStarted('task_'+i)));await j.close();const r=await openAIChannelJournal(f);for(let i=0;i<30;i++)assert.equal(r.has('task_'+i),true);assert.equal(JSON.parse(await readFile(path.join(f.runtimeDir,'ai-channel-state.json'),'utf8')).started.length,30);await r.close();});

test('three slow heartbeat requests run concurrently so one request cannot consume sibling leases',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace);runner.configuration.maxConcurrent=3;let now=0,created=0,slow=false;const waiting=[];
 const channel=await createAIChannel({...f,runner,clock:()=>now,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body),body=()=>reply(input,{serverNow:10000+now,expiresAt:25000+now,...(!input.taskId&&created<3?{task:{...task,id:'task_'+created,leaseId:'lease_'+created++}}:{})});if(slow&&input.taskId)return new Promise(resolve=>waiting.push(()=>resolve(response(body()))));return response(body());}});t.after(()=>channel.close());
 for(let n=0;n<3;n++){await channel.pollOnce();await tick();}assert.equal(runner.runs.length,3);slow=true;const poll=channel.pollOnce();await tick();
 try{assert.equal(waiting.length,3,'all task requests must start before any slow response returns');now=10000;}finally{slow=false;for(const release of waiting)release();await poll;}
 now=14000;await channel.pollOnce();assert.equal(runner.cancelled.length,0);assert.equal(channel.activeTaskIds.length,3);
});

test('one task invalid ack, event conflict or denied lease cannot stop sibling tasks',async t=>{
 for(const failure of ['ack','conflict','lease']){
  const f=await fixture(t),runner=fakeRunner(f.workspace);runner.configuration.maxConcurrent=3;let created=0,armed=false;const inputs=[];
  const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);if(armed&&input.taskId==='task_0'){armed=false;return failure==='ack'?response(reply(input,{ack:999})):new Response(JSON.stringify({code:failure==='lease'?'AI_LEASE_DENIED':'AI_EVENT_CONFLICT'}),{status:failure==='lease'?403:409});}return response(reply(input,!input.taskId&&created<3?{task:{...task,id:'task_'+created,leaseId:'lease_'+created++}}:{}));}});t.after(()=>channel.close());
  for(let n=0;n<3;n++){await channel.pollOnce();await tick();}armed=true;await channel.pollOnce();await tick();assert.equal(channel.stopped,false);assert.deepEqual(runner.cancelled,['AI_LEASE_EXPIRED']);assert.deepEqual(channel.activeTaskIds,['task_1','task_2']);
  runner.runs[1].complete();runner.runs[2].complete();await channel.pollOnce();assert.equal(channel.activeTaskIds.length,0);assert.equal(inputs.filter(input=>['task_1','task_2'].includes(input.taskId)&&input.events.some(e=>e.kind==='completed')).length,2);
 }
});

test('a slow child shutdown holds only its own slot while sibling authorization continues',async t=>{
 const f=await fixture(t),runs=[],cancelled=[],releases=[];let created=0,cancelFirst=false;const seen=[];
 const runner={configuration:{workspace:f.workspace,maxConcurrent:3},loginStatus:async()=>({code:'ready'}),run(input){runs.push(input);let finish;const done=new Promise(resolve=>finish=resolve);releases.push(finish);return {done,cancel(code){cancelled.push({id:input.taskId,code});}};},close:async()=>releases.forEach(resolve=>resolve())};
 const channel=await createAIChannel({...f,runner,clock:()=>0,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);seen.push(input.taskId);return response(reply(input,cancelFirst&&input.taskId==='task_0'?{cancelTaskId:input.taskId}:!input.taskId&&created<3?{task:{...task,id:'task_'+created,leaseId:'lease_'+created++}}:{}));}});t.after(()=>channel.close());
 for(let n=0;n<3;n++){await channel.pollOnce();await tick();}cancelFirst=true;await channel.pollOnce();assert.deepEqual(cancelled,[{id:'task_0',code:'AI_CANCELLED'}]);assert.equal(channel.activeTaskIds.length,3,'shutdown still owns its slot');seen.length=0;await channel.pollOnce();assert.deepEqual(seen,['task_1','task_2']);releases[0]();await tick();assert.deepEqual(channel.activeTaskIds,['task_1','task_2']);
});

test('active registry refresh cannot delay task heartbeats and its failure still stops unavailable tasks',async t=>{
 const f=await fixture(t),runner=fakeRunner(f.workspace);let now=0,scans=0,created=false,release;const inputs=[];
 runner.loginStatus=async()=>{if(scans++)return new Promise(resolve=>release=resolve);return {providers:[registryProvider('codex')],scannedAt:123};};
 const channel=await createAIChannel({...f,runner,clock:()=>now,fetchImpl:async(_url,options)=>{const input=JSON.parse(options.body);inputs.push(input);return response(reply(input,{serverNow:10000+now,expiresAt:25000+now,...(!created?(created=true,{task}):{})}));}});t.after(()=>channel.close());
 await channel.pollOnce();await tick();for(now=10000;now<60000;now+=10000)await channel.pollOnce();const before=inputs.length,poll=channel.pollOnce();await tick();
 try{assert.equal(scans,2);assert.equal(inputs.length,before+1,'lease poll proceeds before scan resolves');assert.equal(runner.cancelled.length,0);}finally{release({providers:[registryProvider('codex',false)],scannedAt:60123});await poll;await tick();}
 assert.deepEqual(runner.cancelled,['AI_PROVIDER_UNAVAILABLE']);
});
