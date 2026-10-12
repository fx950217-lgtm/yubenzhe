// Transport-only fixtures: real registry, dispatcher, chat runner, connector,
// identity and relay persistence; no provider executable or socket is opened.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createSocialService} from '../server/social-service.mjs';
import {createPersonalDevices} from '../server/personal-devices.mjs';
import {createAIChannel as createRelay} from '../server/ai-channel.mjs';
import {createAIChannel} from '../device-bridge/ai-channel.mjs';
import {createProviderRunner} from '../device-bridge/provider-runner.mjs';
import {probeAIRegistry} from '../device-bridge/ai-registry.mjs';
const json=value=>new Response(JSON.stringify(value),{status:200});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('real registry through connector and relay preserves selected local model, metadata privacy, ownership and durable no-content storage',async t=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'ybz-registry-integration-')),workspace=path.join(base,'workspace'),runtimeDir=path.join(base,'private'),statePath=path.join(base,'pair.json');await mkdir(workspace);
 const database=openSocialDatabase(':memory:');let channel;
 t.after(async()=>{await channel?.close();database.close();await rm(base,{recursive:true,force:true});});
 const social=createSocialService({database}),register=ip=>social.handle({method:'POST',path:'register',input:{password:'482193',requestId:randomUUID()},ip});
 const owner=await register('127.0.0.1'),other=await register('127.0.0.2'),devices=createPersonalDevices({database,socialService:social});
 const pair=devices.handle({method:'POST',path:'devices/pair',token:owner.token,input:{name:'Fixture computer'}}),device=devices.enroll({pairToken:pair.pairToken});
 await writeFile(statePath,JSON.stringify({origin:'https://relay.example',token:device.token,deviceId:device.deviceId}));
 const relay=createRelay({database,socialService:social,devices}),call=(method,route,input={},user=owner)=>relay.handle({method,path:'ai-channel/'+route,input,token:user.token});
 const model='fixture:1',localRequests=[],polls=[];
 const fetchImpl=async(url,options)=>{
  localRequests.push({url,body:options.body?JSON.parse(options.body):null});assert.ok(url.startsWith('http://127.0.0.1:11434/api/'));
  if(url.endsWith('/api/tags'))return json({models:[{name:model,model,size:1000,digest:'a'.repeat(64),details:{format:'gguf'}}]});
  if(url.endsWith('/api/show'))return json({details:{format:'gguf'},model_info:{'general.architecture':'fixture','general.parameter_count':100},capabilities:['completion']});
  assert.ok(url.endsWith('/api/generate'));return json({model,done:true,response:'INTEGRATION-OUTPUT-PRIVATE'});
 };
 const fsImpl={lstat:async()=>({isFile:()=>true,isSymbolicLink:()=>false}),realpath:async file=>file,stat:async()=>({isFile:()=>true})};
 const runner=await createProviderRunner({workspace,ollamaModel:model,fetchImpl,codexFactory:()=>assert.fail('logged-out Codex never receives another model prompt'),registryProbe:options=>probeAIRegistry({...options,platform:'win32',home:base,fsImpl,run:async(_file,args)=>({code:args.includes('--version')?0:1,output:args.includes('--version')?'tool 1.2.3':'not logged in private@example.test'})})});
 channel=await createAIChannel({statePath,runtimeDir,runner,fetchImpl:async(url,options)=>{
  assert.equal(url,'https://relay.example/api/device-bridge/ai/poll');assert.equal(options.headers.Authorization,'Bearer '+device.token);const input=JSON.parse(options.body);polls.push(input);return json(relay.poll(device.token,input));
 }});
 await channel.pollOnce();const deviceView=call('GET','devices/'+device.deviceId).device;
 assert.deepEqual(deviceView.providers.filter(p=>p.executionSupported).map(p=>p.id),['ollama']);assert.equal(deviceView.providers[0].loggedIn,false);
 const created=call('POST','send',{deviceId:device.deviceId,provider:'ollama',prompt:'INTEGRATION-PROMPT-PRIVATE',requestId:randomUUID()}).task;
 await channel.pollOnce();for(let n=0;n<10&&call('GET','tasks/'+created.id).task.status!=='succeeded';n++){await tick();await channel.pollOnce();}
 const result=call('GET','tasks/'+created.id);assert.equal(result.task.status,'succeeded');assert.equal(result.task.provider,'ollama');assert.equal(result.events.some(event=>event.text==='INTEGRATION-OUTPUT-PRIVATE'),true);
 assert.equal(localRequests.filter(item=>item.url.endsWith('/api/generate')).length,1);const generated=localRequests.find(item=>item.url.endsWith('/api/generate')).body;assert.equal(generated.model,model);assert.equal(generated.prompt,'INTEGRATION-PROMPT-PRIVATE');assert.equal(generated.tools,undefined);
 assert.throws(()=>call('GET','tasks/'+created.id,{},other),error=>error.code==='AI_TASK_NOT_FOUND');
 assert.doesNotMatch(JSON.stringify(polls),/private@example|\.exe|executables|authOutput/);
 for(const name of ['ai_channel_devices','ai_channel_tasks','ai_channel_event_hashes']){const stored=JSON.stringify(database.raw.prepare('SELECT * FROM '+name).all());assert.doesNotMatch(stored,/INTEGRATION-PROMPT-PRIVATE|INTEGRATION-OUTPUT-PRIVATE|private@example|\.exe/);}
});
