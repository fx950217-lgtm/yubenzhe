import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderNativeDeployment} from './configure-native-endpoints.mjs';

const config={previewOrigin:'https://66.42.56.29',rpcUrls:['https://rpc.example.test'],explorerUrl:'https://explorer.example.test',faucetUrl:'https://faucet.example.test',ollamaDownloadUrl:'https://ollama.com/download'};
test('omitted access mode keeps native clients gated; public mode requires explicit build configuration',()=>{
 for(const mode of [undefined,'internal-preview','public']){
  const input={...config,...(mode?{accessMode:mode}:{})},expected=mode||'internal-preview';
  const context=vm.createContext({module:{exports:null}});vm.runInContext(renderNativeDeployment(input,'windows'),context);
  assert.equal(context.module.exports.accessMode,expected);assert.equal(context.module.exports.previewOrigin,config.previewOrigin);
  assert.match(renderNativeDeployment(input,'android'),new RegExp('ACCESS_MODE = "'+expected+'";'));
 }
});
test('native deployment generation rejects ambiguous modes and host-changing or insecure origins',()=>{
 for(const target of ['windows','android']){
  for(const accessMode of [true,false,'PUBLIC','public-test','',{},1])assert.throws(()=>renderNativeDeployment({...config,accessMode},target),/access mode/);
  for(const previewOrigin of ['http://66.42.56.29','https://66.42.56.29/','https://66.42.56.29/api','https://66.42.56.29?redirect=evil','https://user:secret@66.42.56.29','https://66.42.56.29#x'])assert.throws(()=>renderNativeDeployment({...config,accessMode:'public',previewOrigin},target),/HTTPS origin/);
 }
});
