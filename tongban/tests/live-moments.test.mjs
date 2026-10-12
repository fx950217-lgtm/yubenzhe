import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/live-moments.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {createMomentsAPI,createLiveMomentsFeature,validateLiveMoment,prepareMomentImages}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const IMAGE='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const id='571b47f7-1307-4d3f-b5e4-cc2807483969';
const profile={userId:'7281940031',nickname:'合成账号',avatar:'🌱'};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const store=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};};
const post=(overrides={})=>({id:'1',text:'SERVER_CONTENT',author:profile,audience:'friends',createdAt:1700000000000,own:true,images:[],comments:[],likes:[],liked:false,...overrides});

test('live moment validation permits photo-only posts and rejects public scope or oversized data',()=>{
 assert.deepEqual(validateLiveMoment({text:'  hello  ',audience:'self',images:[]}),{text:'hello',audience:'self',images:[]});
 assert.equal(validateLiveMoment({text:'',images:[{src:IMAGE,name:'x.png'}]}).images.length,1);
 for(const input of [{text:'',images:[]},{text:'x'.repeat(2001)},{text:'x',audience:'public'},{text:'x',images:[{src:'https://evil.test/a.png',name:'x'}]},{text:'x',images:Array(4).fill({src:IMAGE,name:'x'})},{text:'x',images:[{src:'data:image/png;base64,'+'A'.repeat(800000),name:'x'}]}])assert.throws(()=>validateLiveMoment(input));
});

test('original photo admission rejects unsupported files before any decode or upload',async()=>{
 await assert.rejects(prepareMomentImages([]),/1–3/);await assert.rejects(prepareMomentImages(Array(4).fill({type:'image/png',size:1})),/1–3/);
 await assert.rejects(prepareMomentImages([{type:'image/svg+xml',size:30}]),/JPG/);await assert.rejects(prepareMomentImages([{type:'image/jpeg',size:21*1024*1024}]),/20 MB/);
});

test('moment API uses the authenticated social request for JSON and private pictures',async t=>{
 const calls=[],service={getProfile:()=>profile,authenticatedRequest:async(path,options)=>{calls.push({path,options});if(options?.raw)return new Blob(['test'],{type:'image/png'});return {ok:true};}},api=createMomentsAPI(service);t.after(()=>api.dispose());
 await api.publish({clientId:id,text:'x',images:[],audience:'friends'});await api.comment('1',{clientId:id,text:'comment'});await api.like('1',true);await api.removeComment('1','2');
 const [hydrated]=await api.hydrate([post({images:[{id,src:'https://ignored.invalid/photo',name:'x'}]})]);assert.match(hydrated.images[0].src,/^blob:/);
 assert.equal(calls[0].path,'moments');assert.equal(calls[0].options.method,'POST');assert.equal(calls.at(-1).path,'moments/media/'+id);assert.equal(calls.at(-1).options.raw,true);assert.equal(calls.some(c=>c.path.includes('ignored.invalid')),false);
 const imageURL=hydrated.images[0].src;api.clear();await assert.rejects(fetch(imageURL));
});

test('late or invalid picture responses never create usable URLs after account changes or disposal',async()=>{
 let resolve,current=profile;const service={getProfile:()=>current,authenticatedRequest:()=>new Promise(r=>resolve=r)},api=createMomentsAPI(service);
 const pending=api.hydrate([post({images:[{id,name:'x'}]})]);current={...profile,userId:'8194720013'};resolve(new Blob(['x'],{type:'image/png'}));const [result]=await pending;assert.equal(result.images[0].src,'');
 const pending2=api.hydrate([post({images:[{id,name:'x'}]})]);api.dispose();resolve(new Blob(['x'],{type:'image/png'}));assert.equal((await pending2)[0].images[0].src,'');
 const bad=createMomentsAPI({getProfile:()=>profile,authenticatedRequest:async()=>new Blob(['x'],{type:'image/svg+xml'})});assert.equal((await bad.hydrate([post({images:[{id}]})]))[0].images[0].src,'');bad.dispose();
});

function featureHarness(t,{request=async()=>({posts:[post()],nextBefore:null}),loggedIn=true,storage:providedStorage}={}){
  let current=loggedIn?profile:null,markup='',closed=0,saved=0,lastDialog=null,dialogCount=0;const calls=[],seen=[],storage=providedStorage||store();
  const service={getProfile:()=>current,markMomentsSeen:(id,owner)=>seen.push({id,owner,markup}),authenticatedRequest:async(path,options)=>{calls.push({path,options});return request(path,options);},submitReport:async()=>({ok:true})};
 let feature;const ctx={service,storage,getLegacyDrafts:()=>[{id:'legacy',text:'LOCAL_ONLY_TEXT',images:[],authorId:'me'}],toast(){},render(){markup=feature.render();},onSaved(){saved++;},closeDialog(){closed++;},showDialog(title,html,setup){dialogCount++;const errors={textContent:''},publish={disabled:false,textContent:'发布'},listeners=new Map(),fields={text:{value:''},audience:{value:'friends'}};const form={elements:fields,querySelector:selector=>selector==='.lm-editor-error'?errors:publish,querySelectorAll:()=>[fields.text,fields.audience],addEventListener:(name,handler)=>listeners.set(name,handler)};const element={querySelector:()=>form,addEventListener(){}};lastDialog={title,html,form,errors,publish,listeners};setup?.(element);}};
  feature=createLiveMomentsFeature(ctx);t.after(()=>feature.cleanup());return {feature,storage,calls,seen,get markup(){return markup||feature.render();},get dialog(){return lastDialog;},get dialogCount(){return dialogCount;},get closed(){return closed;},get saved(){return saved;},setAccount:value=>current=value};
}

test('discovery badge acknowledges only the successfully rendered friends first page',async t=>{
 const h=featureHarness(t,{request:async()=>({posts:[post({id:'11',own:false,author:{...profile,userId:'other'}}),post({id:'12',own:true})],nextBefore:'10'})});h.feature.routeChanged('moments');await tick();assert.equal(h.seen.length,1);assert.equal(h.seen[0].id,'11');assert.match(h.seen[0].markup,/SERVER_CONTENT/);h.feature.handleAction('lm-older',{dataset:{}});await tick();assert.equal(h.seen.length,1);h.feature.handleAction('lm-scope',{dataset:{scope:'mine'}});await tick();assert.equal(h.seen.length,1);
});
test('failed, late or closed moment reads do not clear discovery reminders',async t=>{
 const failed=featureHarness(t,{request:async()=>{throw Error('offline');}});failed.feature.routeChanged('moments');await tick();assert.equal(failed.seen.length,0);
 let resolve;const late=featureHarness(t,{request:()=>new Promise(r=>resolve=r)});late.feature.routeChanged('moments');late.feature.routeChanged('hub');resolve({posts:[post({id:'11',own:false,author:{...profile,userId:'other'}})],nextBefore:null});await tick();assert.equal(late.seen.length,0);
});

test('loading real feed does not merge legacy local posts or write them to the service',async t=>{
 const h=featureHarness(t);h.feature.routeChanged('moments');await tick();assert.match(h.markup,/SERVER_CONTENT/);assert.doesNotMatch(h.markup,/LOCAL_ONLY_TEXT/);assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);assert.match(h.markup,/本机旧内容/);
 h.feature.handleAction('lm-local',{dataset:{}});assert.match(h.dialog.html,/LOCAL_ONLY_TEXT/);assert.match(h.dialog.html,/没有自动发布或上传/);assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);
});

test('unauthenticated moments show an account entry without treating cached local profile as login',t=>{
 const h=featureHarness(t,{loggedIn:false});h.feature.routeChanged('moments');assert.match(h.markup,/登录账号/);assert.equal(h.calls.length,0);assert.doesNotMatch(h.markup,/SERVER_CONTENT|LOCAL_ONLY_TEXT/);
});

test('personal moments preserve their return label and escape the supplied label',t=>{
 const h=featureHarness(t);assert.match(h.feature.render(),/aria-label="返回发现"/);
 assert.match(h.feature.render({ownOnly:true,backLabel:'返回我的'}),/aria-label="返回我的"/);
 assert.match(h.feature.render({backLabel:'"<test>'}),/aria-label="&quot;&lt;test&gt;"/);
});

test('feed failures clear former content and offer explicit retry',async t=>{
 let fail=false;const h=featureHarness(t,{request:async()=>{if(fail)throw new Error('好友关系已更新');return {posts:[post()],nextBefore:null};}});h.feature.routeChanged('moments');await tick();assert.match(h.markup,/SERVER_CONTENT/);fail=true;await h.feature.refresh();assert.doesNotMatch(h.markup,/SERVER_CONTENT/);assert.match(h.markup,/好友关系已更新/);assert.match(h.markup,/重试/);
});

test('a late feed cannot populate a new scope or a different account',async t=>{
 let resolve;const h=featureHarness(t,{request:path=>path.includes('scope=mine')?Promise.resolve({posts:[post({text:'MINE_NEW'})],nextBefore:null}):new Promise(r=>resolve=r)});h.feature.routeChanged('moments');h.feature.handleAction('lm-scope',{dataset:{scope:'mine'}});await tick();resolve({posts:[post({text:'OLD_ALL'})],nextBefore:null});await tick();assert.match(h.markup,/MINE_NEW/);assert.doesNotMatch(h.markup,/OLD_ALL/);
 h.feature.handleAction('lm-scope',{dataset:{scope:'all'}});h.setAccount(null);resolve({posts:[post({text:'OTHER_ACCOUNT'})],nextBefore:null});await tick();assert.match(h.markup,/登录账号/);assert.doesNotMatch(h.markup,/OTHER_ACCOUNT/);
});

test('failed publication preserves content and idempotency key for a safe retry',async t=>{
 let attempts=0;const inputs=[];const h=featureHarness(t,{request:async(path,options)=>{if(options?.method==='POST'){inputs.push(options.input);if(++attempts===1)throw new Error('请求超时');return {post:post()};}return {posts:[],nextBefore:null};}});
 await h.feature.compose();let d=h.dialog;d.form.elements.text.value='保留这段文字';d.listeners.get('input')();await d.listeners.get('submit')({preventDefault(){}});
 assert.match(d.errors.textContent,/内容已保留/);assert.equal(d.form.elements.text.disabled,true);assert.equal(d.publish.disabled,false);
 const persisted=JSON.parse(h.storage.values.values().next().value);assert.equal(persisted.text,'保留这段文字');assert.equal(persisted.attempted,true);
 await d.listeners.get('submit')({preventDefault(){}});assert.equal(inputs.length,2);assert.equal(inputs[0].clientId,inputs[1].clientId);assert.equal(inputs[0].text,inputs[1].text);assert.equal(h.storage.values.size,0);assert.equal(h.saved,1);
});

test('cached editor drafts reject external pictures and never submit automatically',async t=>{
 const h=featureHarness(t);h.storage.setItem('yubenzhe.moments.draft.v1:'+profile.userId,JSON.stringify({text:'unsafe',audience:'friends',images:[{src:'https://example.invalid/track',name:'x'}],clientId:id}));await h.feature.compose();assert.doesNotMatch(h.dialog.html,/example.invalid|unsafe/);assert.equal(h.calls.length,0);
});

test('post text, nickname and comment markup are escaped in the real feed',async t=>{
 const h=featureHarness(t,{request:async()=>({posts:[post({text:'<script>bad</script>',author:{...profile,nickname:'<b>name</b>'},comments:[{id:'2',author:profile,text:'<img onerror=bad>',own:false}]})],nextBefore:null})});h.feature.routeChanged('moments');await tick();assert.match(h.markup,/&lt;script&gt;/);assert.match(h.markup,/&lt;b&gt;name/);assert.doesNotMatch(h.markup,/<script>|<b>name|<img onerror/);
});

const artifact={fileId:id,fileName:'去重报告.csv',size:2048,sha256:'a'.repeat(64),mime:'text/csv',taskTitle:'订单去重',operation:'deduplicate',createdAt:1700000000000,available:true};
test('artifact-only drafts accept empty text and only valid file identity and audience',()=>{
 assert.deepEqual(validateLiveMoment({text:'',images:[],audience:'self',workbenchFileId:id}),{text:'',images:[],audience:'self',workbenchFileId:id});
 for(const input of [{workbenchFileId:'invalid'},{workbenchFileId:null},{workbenchFileId:id,audience:'public'},{workbenchFileId:id,text:'x'.repeat(2001)}])assert.throws(()=>validateLiveMoment(input));
});
for(const available of [true,false])test('artifact card renders '+(available?'available':'expired')+' metadata inline with no download or separate social actions',async t=>{
 const h=featureHarness(t,{request:async()=>({posts:[post({text:'',artifact:{...artifact,available}})],nextBefore:null})});h.feature.routeChanged('moments');await tick();
 assert.match(h.markup,/去重报告.csv/);assert.match(h.markup,/来自 AI 工作台/);assert.match(h.markup,/订单去重/);assert.match(h.markup,/2 KB/);
 assert.ok(h.markup.includes(available?'成果可查看':'文件已过期'));assert.ok(h.markup.includes(available?'作者可自行另行分享内容':'原文件已不可用'));
 const card=h.markup.slice(h.markup.indexOf('<div class="lm-artifact')).split('</div>')[0];for(const forbidden of ['<a ', '<button', 'href=', 'download', '/files/', '/artifact'])assert.equal(card.includes(forbidden),false);
 assert.equal((h.markup.match(/data-live-moment=/g)||[]).length,1);
});
test('artifact metadata escapes filenames and titles without embedding file content',async t=>{
 const h=featureHarness(t,{request:async()=>({posts:[post({artifact:{...artifact,fileName:'<img src=x onerror=bad>.csv',taskTitle:'<script>bad</script>',content:'PRIVATE_BYTES'}})],nextBefore:null})});h.feature.routeChanged('moments');await tick();
 assert.match(h.markup,/&lt;img/);assert.match(h.markup,/&lt;script&gt;/);assert.doesNotMatch(h.markup,/<img src=x|<script>|PRIVATE_BYTES/);
});
test('repeated share opening and submit clicks create one request and preserve an ordinary draft',async t=>{
 let resolve;const h=featureHarness(t,{request:()=>new Promise(r=>resolve=r)}),ordinary='ordinary draft preserved';
 h.storage.setItem('yubenzhe.moments.draft.v1:'+profile.userId,ordinary);
 const file={id,name:artifact.fileName};await Promise.all([h.feature.composeArtifact(file),h.feature.composeArtifact(file)]);
 assert.equal(h.dialogCount,1);assert.match(h.dialog.html,/去重报告.csv/);assert.match(h.dialog.html,/maxlength="2000"/);assert.match(h.dialog.html,/仅自己可见/);assert.doesNotMatch(h.dialog.html,/data-live-moment-files/);assert.equal(h.calls.length,0);
 const d=h.dialog;d.form.elements.audience.value='self';const pending=d.listeners.get('submit')({preventDefault(){}});
 await d.listeners.get('submit')({preventDefault(){}});await h.feature.composeArtifact(file);assert.equal(h.calls.length,1);assert.equal(h.dialogCount,1);assert.equal(h.calls[0].path,'moments');assert.equal(h.calls[0].options.input.workbenchFileId,id);assert.equal(h.calls[0].options.input.audience,'self');
 resolve({post:post({artifact})});await pending;assert.equal(h.dialog.title,'已分享到发现');assert.match(h.dialog.html,/去看看/);assert.match(h.dialog.html,/仅自己可见/);
 assert.equal(h.storage.getItem('yubenzhe.moments.draft.v1:'+profile.userId),ordinary);assert.equal(h.storage.values.size,1);
 h.feature.handleAction('lm-shared-view',{dataset:{}});assert.equal(h.saved,1);
});
test('lost share response keeps the same clientId and file across remount and retry',async t=>{
 const storage=store(),inputs=[];const first=featureHarness(t,{storage,request:async(path,options)=>{inputs.push(options.input);throw Error('请求超时');}});
 await first.feature.composeArtifact({id,name:artifact.fileName});const d=first.dialog;d.form.elements.text.value='成果说明';await d.listeners.get('submit')({preventDefault(){}});assert.match(d.errors.textContent,/不会重复发布/);first.feature.cleanup();
 const second=featureHarness(t,{storage,request:async(path,options)=>{inputs.push(options.input);return {post:post({artifact})};}});await second.feature.composeArtifact({id,name:artifact.fileName});
 assert.match(second.dialog.html,/成果说明/);assert.match(second.dialog.html,/重试发布/);assert.equal(second.dialog.form.elements.text.disabled,true);
 second.dialog.form.elements.text.value='成果说明';await second.dialog.listeners.get('submit')({preventDefault(){}});
 assert.equal(inputs.length,2);assert.deepEqual(inputs[1],inputs[0]);assert.equal(storage.values.size,0);
});
for(const leave of ['account-change','cleanup'])test('stale artifact form cannot submit after '+leave,async t=>{
 const h=featureHarness(t);await h.feature.composeArtifact({id,name:artifact.fileName});const submit=h.dialog.listeners.get('submit');
 if(leave==='cleanup')h.feature.cleanup();else h.setAccount({...profile,userId:'different'});
 h.dialog.listeners.get('input')();await submit({preventDefault(){}});assert.equal(h.calls.length,0);assert.equal(h.storage.values.size,0);
});
