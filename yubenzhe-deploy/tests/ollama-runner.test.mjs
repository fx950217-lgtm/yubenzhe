import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createOllamaRunner,inspectOllama,loopbackOllamaFetch,validLocalModel,OLLAMA_ORIGIN} from '../device-bridge/ollama-runner.mjs';
const model='fixture/local:1',response=value=>new Response(JSON.stringify(value),{status:200});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const localTags=()=>({models:[{name:model,model,size:123456,digest:'a'.repeat(64),details:{format:'gguf'}}]});
const localInfo=()=>({details:{format:'gguf'},model_info:{'general.architecture':'fixture','general.parameter_count':100},capabilities:['completion']});
async function fixture(t,extra={}){
 const workspace=await mkdtemp(path.join(os.tmpdir(),'ybz-local-model-'));t.after(()=>rm(workspace,{recursive:true,force:true}));const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,options});return response(url.endsWith('/api/tags')?localTags():url.endsWith('/api/show')?localInfo():{model,done:true,response:'文字建议\nAPI_KEY=private-output\n完成'});};
 const runner=await createOllamaRunner({workspace,model,fetchImpl,...extra});t.after(()=>runner.close());return {workspace,calls,runner,fetchImpl};
}
test('local model names match desktop boundaries and never accept a host, cloud model or path traversal',()=>{
 for(const value of ['qwen2.5:3b','team/model-name:v1',model])assert.equal(validLocalModel(value),true);
 for(const value of [null,'',' model','model\n','http://host/model','host:123/model','../model','a/b/c','model:cloud','model-cloud','C:\\model','/model','a'.repeat(129)] )assert.equal(validLocalModel(value),false,String(value));
});
test('local HTTP transport refuses all endpoints except its fixed loopback routes without contacting them',async()=>{
 for(const url of ['https://remote.example/api/generate','http://localhost:11434/api/generate','http://127.0.0.1:11434/api/pull',OLLAMA_ORIGIN+'/api/generate?redirect=1','http://127.0.0.1:11434.evil/api/tags'])await assert.rejects(loopbackOllamaFetch(url));
});
test('chat-only generation rechecks installed model, sends no tools or command and masks returned credentials',async t=>{
 const f=await fixture(t),events=[];const job=f.runner.run({taskId:'local_task',prompt:'给我文字建议',onEvent:event=>events.push(event)});assert.throws(()=>f.runner.run({taskId:'second',prompt:'x'}),{code:'AI_BUSY'});
 assert.equal((await job.done).kind,'completed');assert.equal(f.runner.busy,false);
 assert.deepEqual(f.calls.map(call=>call.url),['/api/tags','/api/show','/api/generate'].map(route=>OLLAMA_ORIGIN+route));
 const sent=JSON.parse(f.calls[2].options.body);assert.equal(sent.model,model);assert.equal(sent.prompt,'给我文字建议');assert.equal(sent.stream,false);assert.equal(sent.tools,undefined);assert.equal(sent.messages,undefined);
 assert.ok(f.calls.every(call=>call.options.redirect==='error'&&call.options.credentials==='omit'));
 assert.doesNotMatch(JSON.stringify(events),/private-output|API_KEY/);assert.match(events.at(-1).text,/未执行文件或命令/);
 assert.throws(()=>f.runner.run({taskId:'file',prompt:'x',promptSuffix:'read inbox'}),{code:'AI_PROVIDER_FILES_UNSUPPORTED'});
});
test('unknown or cloud-backed metadata, missing model and oversized responses never generate',async t=>{
 const variants=[()=>({models:[]}),()=>{const tags=localTags();tags.models[0].remote_host='https://remote.example';return tags;},()=>{const tags=localTags();tags.models[0].size=0;return tags;},()=>{const tags=localTags();tags.models[0].digest='invalid';return tags;},()=>{const tags=localTags();tags.models.push(tags.models[0]);return tags;}];
 for(const tags of variants){let generated=false;await assert.rejects(inspectOllama({model,fetchImpl:async(url)=>{if(url.endsWith('/api/generate'))generated=true;return response(tags());}}));assert.equal(generated,false);}
 for(const info of [{...localInfo(),remote_model:'cloud-name'}, {...localInfo(),details:{format:'remote'}},{...localInfo(),capabilities:['embedding']},{details:{format:'gguf'}}]){
  const f=await fixture(t,{fetchImpl:async url=>{assert.ok(!url.endsWith('/api/generate'));return response(url.endsWith('/api/tags')?localTags():info);}});assert.equal((await f.runner.run({taskId:'blocked',prompt:'x'}).done).kind,'failed');
 }
 const f=await fixture(t,{fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))});assert.equal((await f.runner.run({taskId:'too_large',prompt:'x'}).done).code,'AI_OUTPUT_LIMIT');
});
test('incomplete or wrong-model response cannot report completed',async t=>{
 for(const result of [{model,done:false,response:'text'},{model:'other',done:true,response:'text'},{model,done:true,response:''},{model,done:true,response:'x'.repeat(48001)}]){
  const f=await fixture(t,{fetchImpl:async url=>response(url.endsWith('/api/tags')?localTags():url.endsWith('/api/show')?localInfo():result)});
  assert.equal((await f.runner.run({taskId:'bad_result',prompt:'x'}).done).kind,'failed');
 }
});
test('cancel, revocation and deadline abort waiting and prevent late successful model output',async t=>{
 for(const reason of ['AI_CANCELLED','AI_REVOKED','AI_LEASE_EXPIRED','AI_TIMEOUT']){
  let release,signal;const pending=new Promise(resolve=>release=resolve),events=[];
  const f=await fixture(t,{maxTaskMs:reason==='AI_TIMEOUT'?20:120000,fetchImpl:async(url,options)=>{if(url.endsWith('/api/generate')){signal=options.signal;return pending;}return response(url.endsWith('/api/tags')?localTags():localInfo());}});
  const job=f.runner.run({taskId:'cancel_'+reason,prompt:'x',onEvent:e=>events.push(e)});await tick();
  if(reason==='AI_TIMEOUT')await new Promise(resolve=>setTimeout(resolve,30));else job.cancel(reason);
  assert.equal((await job.done).code,reason);assert.equal(signal.aborted,true);
  release(response({model,done:true,response:'must not deliver'}));await tick();assert.equal(events.some(event=>event.kind==='message'||event.kind==='completed'),false);
 }
});
