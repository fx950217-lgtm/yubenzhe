import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProviderRunner} from '../device-bridge/provider-runner.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));const until=async fn=>{for(let i=0;i<100&&!fn();i++)await tick();assert.ok(fn());};
const provider=(id,ready=true)=>({id,name:id,installed:true,loggedIn:id==='ollama'?null:true,version:'1.2.3',reason:'fixture',executionSupported:ready,executionMode:ready?(id==='ollama'?'chat-only':'tools'):'disabled'});
async function fixture(t,extra={}){
 const workspace=await mkdtemp(path.join(os.tmpdir(),'ybz-provider-runner-'));t.after(()=>rm(workspace,{recursive:true,force:true}));const calls=[],factories=[];
 const factory=id=>async config=>{factories.push({id,config});let own;return {run(input){let finish;const done=new Promise(resolve=>finish=resolve);const job={done,cancel:()=>finish({kind:'failed'})};own={id,input,finish};calls.push(own);return job;},close:async()=>{own?.finish({kind:'failed'});}};};
 const runner=await createProviderRunner({workspace,resourceReady:()=>true,ollamaModel:'fixture:1',registryProbe:async()=>({providers:[provider('codex'),provider('claude',false),provider('workb',false),provider('ollama')],scannedAt:123,executables:{codex:process.execPath}}),codexFactory:factory('codex'),ollamaFactory:factory('ollama'),...extra});t.after(()=>runner.close());return {runner,calls,factories,workspace};
}
test('dispatcher routes exact provider concurrently into distinct fixed task directories',async t=>{
 const f=await fixture(t);assert.equal((await f.runner.loginStatus()).code,'ready');
 assert.throws(()=>f.runner.run({provider:'claude',taskId:'x',prompt:'x'}),{code:'AI_PROVIDER_UNAVAILABLE'});
 assert.throws(()=>f.runner.run({provider:'workb',taskId:'x',prompt:'x'}),{code:'AI_PROVIDER_UNAVAILABLE'});
 assert.throws(()=>f.runner.run({provider:'codex\n',taskId:'x',prompt:'x'}),{code:'AI_PROVIDER_UNAVAILABLE'});
 const local=f.runner.run({provider:'ollama',taskId:'local',prompt:'hello'}),coding=f.runner.run({provider:'codex',taskId:'coding',prompt:'x'});await until(()=>f.calls.length===2);assert.deepEqual(new Set(f.calls.map(c=>c.id)),new Set(['ollama','codex']));assert.ok(f.factories.slice(2).every(f=>f.config.workspace.includes('.ybz-ai-channel')));for(const c of f.calls)c.finish({kind:'completed'});await Promise.all([local.done,coding.done]);
 assert.equal(f.factories[0].config.workspace,await realpath(f.workspace));assert.equal(f.factories[1].config.model,'fixture:1');
});
test('installed Claude/WorkB with forged executable flags never gain an adapter or fall back to Codex',async t=>{
 const f=await fixture(t,{registryProbe:async()=>({providers:[provider('claude'),provider('workb')],scannedAt:123,executables:{codex:process.execPath,claude:process.execPath}})});
 const status=await f.runner.loginStatus();assert.equal(status.code,'error');assert.ok(status.providers.every(value=>!value.executionSupported&&value.executionMode==='disabled'));assert.equal(f.factories.length,0);
 assert.throws(()=>f.runner.run({provider:'claude',taskId:'no',prompt:'x'}),{code:'AI_PROVIDER_UNAVAILABLE'});assert.equal(f.calls.length,0);
});
test('failed Codex safety boundary does not block an available local chat provider',async t=>{
 const f=await fixture(t,{codexFactory:async()=>{throw Error('private diagnostic');}});const result=await f.runner.loginStatus();assert.equal(result.code,'ready');assert.equal(result.providers[0].executionSupported,false);assert.equal(result.providers[3].executionSupported,true);assert.doesNotMatch(JSON.stringify(result),/private diagnostic/);
 assert.throws(()=>f.runner.run({provider:'ollama',taskId:'attachment',prompt:'x',promptSuffix:'file instructions'}),{code:'AI_PROVIDER_FILES_UNSUPPORTED'});
 f.runner.run({provider:'ollama',taskId:'local',prompt:'x'});await until(()=>f.calls.length===1);assert.equal(f.calls[0].id,'ollama');
});
test('logged-out Codex is not executable even with an inconsistent reported flag',async t=>{
 const f=await fixture(t,{registryProbe:async()=>({providers:[{...provider('codex'),loggedIn:false}],scannedAt:123,executables:{codex:process.execPath}})});
 const status=await f.runner.loginStatus();assert.equal(status.code,'login-required');assert.equal(status.providers[0].executionSupported,false);assert.equal(f.factories.length,0);
});
test('long tasks re-probe real registry facts without replacing their running adapter',async t=>{
 let scans=0;const f=await fixture(t,{registryProbe:async()=>({providers:[provider('codex'),provider('ollama')],scannedAt:++scans,executables:{codex:process.execPath}})});
 await f.runner.loginStatus();const job=f.runner.run({provider:'codex',taskId:'long',prompt:'x'});await until(()=>f.calls.length===1);const count=f.factories.length;assert.equal(f.runner.busy,false);
 const next=await f.runner.loginStatus();assert.equal(next.scannedAt,2);assert.equal(scans,2);assert.equal(f.factories.length,count);assert.equal(f.runner.busy,false);
 f.calls[0].finish({kind:'completed'});await job.done;assert.equal(f.runner.busy,false);
});
