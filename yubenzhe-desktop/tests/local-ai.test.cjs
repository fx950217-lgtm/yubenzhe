'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {createLocalAI}=require('../src/local-ai.cjs');
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const tag={name:'qwen3:0.6b',size:500000000};
test('only installed local models are offered, never cloud proxies',async()=>{
 const ai=createLocalAI({fetchImpl:async(url,options)=>{assert.equal(url,'http://127.0.0.1:11434/api/tags');assert.equal(options.redirect,'error');return json({models:[tag,{name:'qwen3:cloud',size:50},{name:'alias',size:50,remote_host:'https://remote'},{name:'../bad',size:10}]});}});
 assert.deepEqual(await ai.status(),{available:true,models:[{name:tag.name,sizeBytes:tag.size}]});
});
test('generation targets loopback with constrained options and requires complete real response',async()=>{
 const requests=[];const ai=createLocalAI({fetchImpl:async(url,options)=>{requests.push({url,options});return json(url.endsWith('/tags')?{models:[tag]}:url.endsWith('/show')?{details:{format:'gguf'}}:{done:true,response:'实际模型输出'});}});
 assert.deepEqual(await ai.generate({model:tag.name,prompt:'hello',requestId:'request-0001'}),{text:'实际模型输出',model:tag.name,local:true});
 const body=JSON.parse(requests[2].options.body);assert.equal(requests[2].url,'http://127.0.0.1:11434/api/generate');assert.equal(body.stream,false);assert.equal(body.think,false);assert.equal(body.options.num_predict,512);
});
test('invalid, not installed and cloud alias models cannot reach generation',async()=>{
 let generated=0;const ai=createLocalAI({fetchImpl:async(url)=>{if(url.endsWith('/generate'))generated++;return json(url.endsWith('/tags')?{models:[tag]}:{remote_host:'https://remote'});}});
 for(const model of ['http://evil','absent','qwen3:0.6b'])await assert.rejects(ai.generate({model,prompt:'hello',requestId:'request-0002'}));
 await assert.rejects(ai.generate({model:tag.name,prompt:'x'.repeat(6001),requestId:'request-0002'}));assert.equal(generated,0);
});
test('cancel is scoped to current request, rejects late responses, and blocks concurrent work',async()=>{
 let ready,finish;const started=new Promise(r=>ready=r);const ai=createLocalAI({fetchImpl:async(url)=>{
 if(url.endsWith('/tags'))return json({models:[tag]});if(url.endsWith('/show'))return json({});ready();return new Promise(r=>finish=()=>r(json({done:true,response:'late'})));
 }});const run=ai.generate({model:tag.name,prompt:'hello',requestId:'request-0003'});await started;
 await assert.rejects(ai.generate({model:tag.name,prompt:'hello',requestId:'request-0004'}),/已有/);assert.equal(ai.cancel('old-request'),false);assert.equal(ai.cancel('request-0003'),true);finish();await assert.rejects(run,/已取消/);
});
test('timeout, network failure, redirected and oversized payloads fail without fabricated output',async()=>{
 const slow=createLocalAI({statusTimeout:5,fetchImpl:async(url,options)=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('secret detail'))))});
 const status=await slow.status();assert.equal(status.available,false);assert.doesNotMatch(status.error,/secret/);
 const large=createLocalAI({fetchImpl:async()=>json({models:[],noise:'x'.repeat(1024*1024)})});assert.equal((await large.status()).available,false);
 const incomplete=createLocalAI({fetchImpl:async url=>json(url.endsWith('/tags')?{models:[tag]}:url.endsWith('/show')?{}:{done:false,response:'partial'})});await assert.rejects(incomplete.generate({model:tag.name,prompt:'hello',requestId:'request-0005'}),/完整/);
});
