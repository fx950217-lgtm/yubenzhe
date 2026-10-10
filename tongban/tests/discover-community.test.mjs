import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/discover-community.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {createCommunityFeature,formatCommunityUnits}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const {createCommunityClient,createActivityTracker}=await import('../src/community-client.js');
const tick=()=>new Promise(r=>setTimeout(r,0));
const profile={userId:'sample_user',nickname:'合成用户'};
const person={...profile,level:1,official:false};
const task=(extra={})=>({id:'a31ae77b-b6f0-45a0-8a09-4ac2651859a2',title:'SERVER_TASK',description:'真实任务描述',category:'development',tags:[],reward:{assetId:'USDT-BSC',amountUnits:'10250000',decimals:6,mode:'noncustodial'},deadline:1791638400000,deliverables:'源文件',acceptance:'测试通过',status:'recruiting',author:person,own:true,partner:null,partnerConfirmed:false,applications:[],deliveries:[],comments:[],reviews:[],payment:{status:'unpaid',verifiedUnits:'0',records:[]},...extra});
function harness(t,{request,loggedIn=true,onBountyPayment}={}){
 let current=loggedIn?profile:null,route='',markup='',lastDialog=null,closed=0,logins=0;
 const calls=[],toasts=[],nav=[];
 const defaultRequest=async path=>path==='community/capabilities'?{assets:[{id:'USDT-BSC',symbol:'USDT',mode:'noncustodial'}]}:path.startsWith('community/bounties?')?{items:[task()],nextBefore:null}:path.startsWith('community/bounties/')?{bounty:task()}:path.startsWith('community/providers?')?{items:[]}:path==='community/identity'?{assetPublic:false,activityPublic:false,level:1}:path.startsWith('community/rankings?')?{rows:[],note:'未配置可靠价格'}:{items:[]};
 const service={getProfile:()=>current,authenticatedRequest:async(path,options)=>{calls.push({path,options});return (request||defaultRequest)(path,options,defaultRequest);}};
 let feature;const ctx={socialClient:service,onAccount(){logins++},onNavigate(...args){nav.push(args)},onBountyPayment,container:{querySelector:()=>({value:''})},render(){markup=feature.render(route)},closeDialog(){closed++},toast:message=>toasts.push(message),showDialog(title,html,setup){const errors={textContent:''},submit={disabled:false,textContent:'提交'},listeners=new Map(),elements=new Proxy({}, {get(target,key){return target[key]||= {value:'',disabled:false}}});const form={elements,querySelector:selector=>selector==='.community-error'?errors:submit,querySelectorAll:()=>Object.values(elements),addEventListener:(name,fn)=>listeners.set(name,fn)};lastDialog={title,html,errors,submit,form,async send(values={}){for(const [key,value] of Object.entries(values))elements[key].value=value;await listeners.get('submit')?.({preventDefault(){}})}};setup?.({querySelector:()=>form})}};
 feature=createCommunityFeature(ctx);t.after(()=>feature.cleanup());
 return {feature,service,calls,toasts,nav,get markup(){return markup},get dialog(){return lastDialog},get closed(){return closed},get logins(){return logins},async open(value){route=value;feature.routeChanged(value);markup=feature.render(route);await tick()},action:(key,dataset={})=>feature.handleAction('community-'+key,{dataset}),account(value){current=value;feature.routeChanged(route)}};
}

test('community amount presentation preserves decimal precision without artificial zeros',()=>{
 assert.equal(formatCommunityUnits('10250000',6),'10.25');assert.equal(formatCommunityUnits('10000000',6),'10');assert.equal(formatCommunityUnits('1',18),'0.000000000000000001');assert.equal(formatCommunityUnits('0',6),'0');assert.equal(formatCommunityUnits('120',0),'120');
});

test('all community calls share the account authenticated transport and preserve request IDs',async()=>{
 const calls=[],client=createCommunityClient({authenticatedRequest:async(path,options)=>{calls.push({path,options});return {ok:true}}}),input={requestId:crypto.randomUUID(),body:'交付'};
 await client.bountyAction('task/id','deliver',input);await client.rankings('activity');await client.preferences({requestId:input.requestId,activityPublic:false});
 assert.equal(calls[0].path,'community/bounties/task%2Fid/deliver');assert.equal(calls[0].options.input,input);assert.equal(calls[1].path,'community/rankings?kind=activity');assert.equal(calls[2].options.method,'POST');
});

test('guests get a login entry without fetching or publishing community data',async t=>{
 const h=harness(t,{loggedIn:false});await h.open('bounty');assert.match(h.markup,/登录后使用/);assert.equal(h.calls.length,0);h.action('login');assert.equal(h.logins,1);
});

test('task UI uses server data, escapes content and separates cooperation from payment',async t=>{
 const h=harness(t,{request:async(path,o,fallback)=>path.includes('bounties/')?{bounty:task({title:'<script>alert(1)</script>',status:'ended',payment:{status:'unpaid',verifiedUnits:'0',records:[]}})}:fallback(path,o)});await h.open('bounty');assert.match(h.markup,/SERVER_TASK/);assert.match(h.markup,/赏金未托管/);assert.match(h.markup,/意向报价/);h.action('detail',{id:task().id});await tick();assert.match(h.markup,/&lt;script&gt;/);assert.doesNotMatch(h.markup,/<script>/);assert.match(h.markup,/已结束/);assert.match(h.markup,/链上付款核验与托管尚未部署/);assert.doesNotMatch(h.markup,/已核验 10.25/);
});

test('publish retry freezes the original input and reuses one idempotency ID',async t=>{
 let posts=0;const h=harness(t,{request:async(path,o,fallback)=>{if(path==='community/bounties'&&o?.method==='POST'){posts++;if(posts===1)throw Error('网络中断');return {bounty:task()}}return fallback(path,o)}});await h.open('bounty');h.action('publish');const dialog=h.dialog;await dialog.send({title:'原任务',description:'完整任务描述',category:'development',tags:'设计,测试',assetId:'USDT-BSC',rewardAmount:'10.25',deadline:'2027-01-01T12:00',deliverables:'源文件',acceptance:'测试通过'});assert.match(dialog.errors.textContent,/可直接重试/);assert.equal(dialog.form.elements.title.disabled,true);await dialog.send({title:'意外变更'});
 const requests=h.calls.filter(c=>c.path==='community/bounties'&&c.options?.method==='POST');assert.equal(requests.length,2);assert.deepEqual(requests[0].options.input,requests[1].options.input);assert.equal(requests[1].options.input.title,'原任务');assert.equal(typeof requests[0].options.input.requestId,'string');assert.equal(h.closed,1);
});

test('definite field validation errors allow correction with a fresh request ID',async t=>{
 let posts=0;const h=harness(t,{request:async(path,o,fallback)=>{if(path==='community/bounties'&&o?.method==='POST'){if(++posts===1)throw Object.assign(Error('标题过短'),{status:400});return {bounty:task()}}return fallback(path,o)}});await h.open('bounty');h.action('publish');const d=h.dialog;await d.send({title:'短',description:'完整任务描述',category:'development',tags:'测试',assetId:'USDT-BSC',rewardAmount:'1',deadline:'2027-01-01T12:00',deliverables:'源文件',acceptance:'测试通过'});assert.equal(d.form.elements.title.disabled,false);assert.match(d.errors.textContent,/请修改/);await d.send({title:'修正后的标题'});const calls=h.calls.filter(c=>c.path==='community/bounties'&&c.options?.method==='POST');assert.notEqual(calls[0].options.input.requestId,calls[1].options.input.requestId);assert.equal(calls[1].options.input.title,'修正后的标题');
});

test('apply, partner choice, delivery and comment forms submit explicit matching actions',async t=>{
 const current=task({own:false,isPartner:true,status:'active',partnerConfirmed:true});const h=harness(t,{request:async(path,o,fallback)=>path.includes('bounties/')?{bounty:current}:fallback(path,o)});await h.open('bounty');h.action('detail',{id:current.id});await tick();for(const [action,fields,path] of [['apply',{message:'参与说明'},'apply'],['select',{},'select'],['deliver',{body:'交付文件说明'},'deliver'],['comment',{body:'评论内容'},'comments']]){h.action(action,{id:'application-id'});await h.dialog.send(fields);const sent=h.calls.findLast(c=>c.options?.method==='POST');assert.equal(sent.path,'community/bounties/'+current.id+'/'+path);if(action==='select')assert.equal(sent.options.input.applicationId,'application-id');else assert.equal(sent.options.input[Object.keys(fields)[0]],Object.values(fields)[0]);}
});

test('provider updates fetch the users own current revision and retain business/cloud distinction',async t=>{
 const p={id:'provider',kind:'cloud',revision:4,name:'合成云',category:'云服务',description:'合成云服务介绍',pricing:'按小时',languages:['中文'],regions:['测试地区']};const h=harness(t,{request:async(path,o,fallback)=>path.startsWith('community/providers?')&&path.includes('mine=true')?{items:[p]}:path==='community/providers'&&o?.method==='POST'?{provider:{...p,status:'pending'}}:fallback(path,o)});await h.open('provider');h.action('provider-kind',{kind:'cloud'});await tick();h.action('provider-apply');await tick();assert.match(h.dialog.title,/云基础设施/);assert.match(h.dialog.html,/重新进入审核/);await h.dialog.send({name:p.name,category:p.category,description:p.description,pricing:p.pricing,languages:'中文',regions:'测试地区'});const sent=h.calls.findLast(c=>c.options?.method==='POST');assert.equal(sent.options.input.kind,'cloud');assert.equal(sent.options.input.revision,4);assert.equal('official' in sent.options.input,false);
});

test('privacy toggles do not double-post on input/change or imply a fabricated asset ranking',async t=>{
 const h=harness(t);await h.open('rank');assert.match(h.markup,/暂无自愿展示/);assert.doesNotMatch(h.markup,/示例 USDT/);const target={dataset:{communityPreference:'activityPublic'},checked:true,disabled:false};h.feature.handleInput({target});h.feature.handleInput({target});await tick();assert.equal(h.calls.filter(c=>c.path==='community/preferences').length,1);assert.equal(h.calls.find(c=>c.path==='community/preferences').options.input.activityPublic,true);
});

test('late route and account responses cannot overwrite current data or publish stale forms',async t=>{
 let resolve;const h=harness(t,{request:async(path,o,fallback)=>path.startsWith('community/bounties?')?new Promise(r=>resolve=r):fallback(path,o)});await h.open('bounty');await h.open('provider');resolve({items:[task({title:'LATE_PRIVATE_CONTENT'})],nextBefore:null});await tick();assert.doesNotMatch(h.markup,/LATE_PRIVATE_CONTENT/);h.action('provider-apply');await tick();const dialog=h.dialog;h.account({...profile,userId:'another_user'});await dialog.send({name:'旧账号资料'});assert.equal(h.calls.filter(c=>c.path==='community/providers'&&c.options?.method==='POST').length,0);
});

test('payment and contact actions use explicit parent hooks instead of marking a task paid',async t=>{
 const payments=[],r=task({status:'active',partner:{...person,userId:'worker'},partnerConfirmed:true});const h=harness(t,{onBountyPayment:value=>payments.push(value),request:async(path,o,fallback)=>path.includes('bounties/')?{bounty:r}:fallback(path,o)});await h.open('bounty');h.action('detail',{id:r.id});await tick();h.action('pay');assert.deepEqual(payments,[]);assert.doesNotMatch(h.markup,/data-disc="community-pay"/);h.action('contact',{user:'worker'});assert.deepEqual(h.nav,[['contacts',{profileId:'worker'}]]);assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);
});

test('activity tracker sends foreground trusted input hints but never client time or duration',async t=>{
 const listeners=new Map(),calls=[],doc={visibilityState:'visible',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)},service={getProfile:()=>profile,authenticatedRequest:async(path,options)=>{calls.push(options.input);return {level:1}}};const tracker=createActivityTracker({socialClient:service,document:doc,intervalMs:999999});t.after(()=>tracker.cleanup());await tracker.tick();assert.equal(calls.at(-1).active,false);listeners.get('pointerdown')({isTrusted:false});await tracker.tick();assert.equal(calls.at(-1).active,false);listeners.get('keydown')({isTrusted:true});await tracker.tick();assert.equal(calls.at(-1).active,true);await tracker.tick();assert.equal(calls.at(-1).active,false);doc.visibilityState='hidden';listeners.get('visibilitychange')();await tick();assert.equal(calls.at(-1).visible,false);const count=calls.length;await tracker.tick();assert.equal(calls.length,count);assert.deepEqual(Object.keys(calls[0]).sort(),['active','requestId','visible']);tracker.cleanup();assert.equal(listeners.size,0);
});

test('legacy simulation quotes cannot expose a spendable balance or publish path',async t=>{const h=harness(t,{request:async(path,o,fallback)=>path==='community/capabilities'?{assets:[{id:'SIM-USD',symbol:'SIM',mode:'simulation'}]}:path.startsWith('community/bounties?')?{items:[task({reward:{assetId:'SIM-USD',amountUnits:'9999999999',decimals:6,mode:'simulation'}})],nextBefore:null}:fallback(path,o)});await h.open('bounty');assert.match(h.markup,/历史模拟报价已停用/);assert.doesNotMatch(h.markup,/9,999/);h.action('publish');assert.equal(h.calls.some(c=>c.options?.method==='POST'),false);});
