const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {publicProviders,normalizeOllamaModel}=require('../src/device-provider-state.cjs');
const {publicState}=require('../src/device-manager.cjs');
test('setup renderer only receives bounded public provider metadata, never executable paths or probe output',()=>{
 const state=publicState({executables:{codex:'C:\\secret.exe'},providers:[{id:'codex',name:'Codex',installed:true,loggedIn:true,executionSupported:true,executionMode:'tools',version:'1.2.3',reason:'ready',executable:'C:\\secret.exe',loginOutput:'private-token'},{id:'bad/id',name:'unknown'},{id:'claude',installed:false,executionSupported:true,executionMode:'tools'}],scannedAt:42});
 assert.equal(state.providers.length,2);assert.equal(state.providers[0].executionMode,'tools');assert.equal(state.providers[1].executionSupported,false);assert.equal(state.providers[1].executionMode,'disabled');assert.equal(state.scannedAt,42);
 assert.doesNotMatch(JSON.stringify(state),/secret\.exe|private-token|executables|loginOutput/);
 assert.equal(publicProviders(Array.from({length:100},(_,i)=>({id:'ai-'+i}))).length,16);
});
test('local model setting rejects network endpoints cloud references shell syntax and filesystem paths',()=>{
 for(const input of ['https://host/model','C:\\models\\model','../model','/tmp/model','model:cloud','qwen-cloud','model;echo','model\nrun','-bad',[],{},'a'.repeat(129)])assert.throws(()=>normalizeOllamaModel(input));
 for(const value of ['qwen3:0.6b','library/local-model:latest','local_model-v1'])assert.equal(normalizeOllamaModel(value),value);
 assert.equal(normalizeOllamaModel(''),null);assert.equal(normalizeOllamaModel(null),null);
});
test('packaged connector includes every provider runtime import alongside the existing transport',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
 const filter=pkg.build.extraResources.find(x=>x.to==='device-bridge').filter;
 for(const file of ['ai-registry.mjs','probe-process.mjs','provider-runner.mjs','ollama-runner.mjs','ai-channel.mjs','codex-runner.mjs','ai-channel-files.mjs'])assert.ok(filter.includes(file),file);
});
