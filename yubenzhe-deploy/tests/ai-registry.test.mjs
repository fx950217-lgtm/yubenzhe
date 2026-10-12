import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {probeAIRegistry,AI_PROVIDER_RULES,findProviderExecutable} from '../device-bridge/ai-registry.mjs';
import {captureCommand} from '../device-bridge/probe-process.mjs';

const paths=Object.fromEntries(AI_PROVIDER_RULES.map(rule=>[rule.id,path.resolve('fixture-ai',rule.id+'.exe')]));
const metadata={isFile:()=>true,isSymbolicLink:()=>false};
function fixture({missing=[],linked=[]}={}){
 const reads=[],calls=[];
 const fsImpl={async lstat(file){reads.push(file);if(missing.some(id=>file===paths[id]))throw Object.assign(Error(),{code:'ENOENT'});return {...metadata,isSymbolicLink:()=>linked.some(id=>file===paths[id])};},async realpath(file){return file;},async stat(){return metadata;}};
 const run=async(file,args,options)=>{calls.push({file,args,options});return {code:0,output:args.includes('--version')?'tool 1.2.3':'{"email":"private@example.test","token":"secret-status-output"}'};};
 return {reads,calls,options:{platform:'win32',executableOverrides:paths,fsImpl,run,providerTimeoutMs:5000,now:()=>123456}};
}
const json=value=>new Response(JSON.stringify(value),{status:200});
const model='fixture-local:1';
function ollamaFixture(){const urls=[];return {urls,fetchImpl:async(url,options)=>{urls.push({url,options});return json(url.endsWith('/api/tags')?{models:[{name:model,model,size:1000,digest:'a'.repeat(64),details:{format:'gguf'}}]}:{details:{format:'gguf'},model_info:{'general.architecture':'fixture','general.parameter_count':100},capabilities:['completion']});}};}

test('four data-driven providers distinguish installed/logged-in from available execution, and expose no diagnostics or paths',async()=>{
 const f=fixture(),result=await probeAIRegistry(f.options);
 assert.deepEqual(result.providers.map(p=>p.id),['codex','claude','workb','ollama']);assert.equal(result.scannedAt,123456);
 assert.deepEqual(result.providers.filter(p=>p.executionSupported).map(p=>p.id),['codex']);
 assert.equal(result.providers[1].loggedIn,true);assert.equal(result.providers[1].executionMode,'disabled');
 assert.equal(result.providers[2].installed,true);assert.equal(result.providers[2].version,null);assert.equal(result.providers[2].loggedIn,null);
 assert.equal(result.providers[3].installed,true);assert.equal(result.providers[3].executionSupported,false);assert.match(result.providers[3].reason,/选择/);
 assert.deepEqual(result.executables,paths);assert.doesNotMatch(JSON.stringify(result.providers),/private@example|secret-status|fixture-ai|executable/);
 assert.equal(f.calls.some(call=>call.file===paths.workb),false,'GUI existence does not launch the app');
 assert.ok(f.calls.every(call=>call.options.timeout<=5000));
 assert.deepEqual(f.calls.filter(call=>call.file===paths.claude).map(call=>call.args),[['--version'],['auth','status']]);
});
test('login exit 1 is a reminder only; unknown status is not guessed and no login command runs',async()=>{
 const f=fixture();f.options.run=async(file,args)=>({code:args.includes('--version')?0:file===paths.codex?1:2,output:'tool 1.2.3'});
 const {providers}=await probeAIRegistry(f.options);assert.equal(providers[0].loggedIn,false);assert.equal(providers[0].executionSupported,false);assert.equal(providers[1].loggedIn,null);assert.equal(providers[1].executionSupported,false);
});
test('explicit Claude loggedIn false narrows a successful status exit without exposing account metadata',async()=>{
 const f=fixture();f.options.run=async(_file,args)=>({code:0,output:args.includes('--version')?'tool 1.2.3':'{"loggedIn":false,"email":"hidden@example.test"}'});
 const {providers}=await probeAIRegistry(f.options);assert.equal(providers[1].loggedIn,false);assert.equal(providers[1].executionSupported,false);assert.doesNotMatch(JSON.stringify(providers),/hidden@example/);
});
test('private worker handoff retains Claude desktop detection and never executes the GUI as a CLI',async()=>{
 const f=fixture(),home=path.resolve('fixture-home'),desktop=path.join(home,'AppData','Local','AnthropicClaude','claude.exe');
 const result=await probeAIRegistry({...f.options,home,executableOverrides:{...paths,claude:desktop}});
 assert.equal(result.providers[1].installed,true);assert.equal(result.providers[1].loggedIn,null);assert.equal(result.providers[1].version,null);assert.equal(f.calls.some(call=>call.file===desktop),false);
});
test('failed version and missing/linked executables report unverified installation and do not execute wrappers',async()=>{
 const f=fixture({missing:['codex'],linked:['claude']});f.options.executableOverrides={...paths,workb:path.resolve('unsafe.cmd')};f.options.run=async()=>({code:1,output:'not installed'});
 const result=await probeAIRegistry(f.options);assert.ok(result.providers.every(p=>p.installed===false));assert.deepEqual(result.executables,{});
});
test('a hanging provider has one total deadline and cannot block successful peers or start commands after timeout',async()=>{
 const f=fixture(),seen=[];let release;
 const blocked=new Promise(resolve=>release=resolve);f.options.providerTimeoutMs=45;
 f.options.run=async(file,args,options)=>{seen.push({file,args,signal:options.signal});if(file===paths.codex)return blocked;return {code:0,output:'tool 1.2.3'};};
 const start=performance.now(),result=await probeAIRegistry(f.options);assert.ok(performance.now()-start<500);assert.equal(result.providers[0].installed,false);assert.equal(result.providers[1].installed,true);
 assert.equal(seen.filter(x=>x.file===paths.codex).length,1);assert.equal(seen.find(x=>x.file===paths.codex).signal.aborted,true);
 release({code:0,output:'tool 1.2.3'});await new Promise(resolve=>setImmediate(resolve));assert.equal(seen.filter(x=>x.file===paths.codex).length,1,'late version cannot launch auth status');
});
test('file detection is bounded and never reads credentials, scans directories or searches PATH',async()=>{
 const reads=[];const fsImpl={async lstat(file){reads.push(file);throw Error('absent');},realpath:()=>assert.fail(),stat:()=>assert.fail()};
 const result=await probeAIRegistry({platform:'win32',home:path.resolve('fixture-home'),fsImpl,run:()=>assert.fail('no executables'),env:{PATH:'arbitrary-path',ProgramFiles:path.resolve('fixture-programs')}});
 assert.equal(result.providers.length,4);assert.ok(reads.length<=12);assert.ok(reads.every(file=>file.endsWith('.exe')));assert.doesNotMatch(reads.join('\n'),/auth\.json|config\.toml|credentials|token/);
 assert.equal(await findProviderExecutable('not-registered',{fsImpl}),null);
});
test('configured Ollama checks loopback model metadata, ignores remote environment and reports chat-only',async()=>{
 const f=fixture(),local=ollamaFixture();const result=await probeAIRegistry({...f.options,env:{OLLAMA_HOST:'https://remote.example',HTTP_PROXY:'http://remote.example'},ollamaModel:model,fetchImpl:local.fetchImpl});
 assert.equal(result.providers[3].executionSupported,true);assert.equal(result.providers[3].executionMode,'chat-only');assert.equal(result.providers[3].loggedIn,null);
 assert.ok(local.urls.every(item=>item.url.startsWith('http://127.0.0.1:11434/api/')));
 assert.ok(f.calls.every(call=>call.options.env.OLLAMA_HOST==='127.0.0.1:11434'&&call.options.env.OLLAMA_NO_CLOUD==='1'));
 assert.equal(f.calls.some(call=>call.args.includes('list')||call.args.includes('run')||call.args.includes('pull')),false);
});
test('cloud metadata or unavailable local model never enables Ollama',async()=>{
 const f=fixture();const result=await probeAIRegistry({...f.options,ollamaModel:model,fetchImpl:async()=>json({models:[{name:model,size:10,digest:'a'.repeat(64),details:{format:'gguf',remote_host:'https://remote.example'}}]})});
 assert.equal(result.providers[3].installed,true);assert.equal(result.providers[3].executionSupported,false);assert.equal(result.providers[3].executionMode,'disabled');
});
test('probe command uses shell:false, suppresses windows, rejects scripts and kills timeout/oversize output',async()=>{
 const calls=[];const child=()=>{const p=new EventEmitter();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{p.killed=true;p.emit('close',1);};return p;};
 const spawnImpl=(...args)=>{const p=child();calls.push({args,p});return p;};
 const normal=captureCommand(paths.codex,['--version'],{spawnImpl,timeout:100});calls[0].p.stdout.write('codex 1.2.3');calls[0].p.emit('close',0);assert.equal((await normal).code,0);assert.equal(calls[0].args[2].shell,false);assert.equal(calls[0].args[2].windowsHide,true);
 for(const ext of ['.cmd','.bat','.ps1','.js','.exe\n'])assert.equal((await captureCommand(path.resolve('unsafe'+ext),[],{spawnImpl})).error,'unavailable');assert.equal(calls.length,1);
 const timed=captureCommand(paths.codex,[],{spawnImpl,timeout:10});await new Promise(resolve=>setTimeout(resolve,25));assert.equal((await timed).error,'timeout');assert.equal(calls[1].p.killed,true);
 const large=captureCommand(paths.codex,[],{spawnImpl});calls[2].p.stdout.write('x'.repeat(9000));const output=await large;assert.equal(calls[2].p.killed,true);assert.ok(output.output.length<=8192);
});
