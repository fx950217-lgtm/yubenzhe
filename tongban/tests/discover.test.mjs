import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise validation and storage boundaries without a browser or social writes.
const source=(await readFile(new URL('../src/discover.js',import.meta.url),'utf8'))
  .replace("import './discover.css';",'')
  .replace("import { getSocialPeople, getSocialShareTargets, shareMomentToChat } from './social.js';",`const getSocialPeople=()=>[{id:'lin',name:'林一',initial:'林',color:'mint',isFriend:true,amount:100},{id:'moon',name:'月亮',initial:'月',isFriend:false,amount:200}]; const getSocialShareTargets=()=>[]; const shareMomentToChat=()=>{throw new Error('No social writes in this harness');};`)
  + '\nexport { seedDiscover,readDiscover,persistDiscover,visiblePosts,validateUsd,validateTokenDraft,validateServiceDraft,safeImageData,readMomentImages,upsertDraft,filterRankPeople,filterDrafts,setDraftArchived,duplicateDraft,esc };';
const bundled=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('../src/',import.meta.url)),sourcefile:'discover-under-test.js'},bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const {seedDiscover,readDiscover,persistDiscover,visiblePosts,validateUsd,validateTokenDraft,validateServiceDraft,safeImageData,readMomentImages,upsertDraft,getDiscoverDrafts,mountDiscover,filterRankPeople,filterDrafts,setDraftArchived,duplicateDraft,esc}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const storage=()=>{const data=new Map();return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),data};};
const token=overrides=>({name:'Lime Club',symbol:'lime',supply:'1000000000',address:'0x1111111111111111111111111111111111111111',ownsWallet:true,...overrides});
const png=`data:image/png;base64,${Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]).toString('base64')}`;

test('privacy and archive metadata survive loading, and private friend posts never leak into the hub',()=>{
 const store=storage(),data=seedDiscover();data.savedPostIds=['own','own'];
 data.posts=[{id:'own',authorId:'me',text:'private',audience:'self',createdAt:1,updatedAt:3,archivedAt:5,comments:[{id:'c',authorId:'me',text:'comment',createdAt:2,archivedAt:4}]},{id:'friend',authorId:'lin',text:'private friend',audience:'self',createdAt:2},{id:'public-friend',authorId:'lin',text:'normal',createdAt:1}];
 persistDiscover(data,store);const loaded=readDiscover(store);
 assert.deepEqual(loaded.savedPostIds,['own']);assert.equal(loaded.posts[0].archivedAt,5);assert.equal(loaded.posts[0].comments[0].archivedAt,4);
 assert.deepEqual(visiblePosts(loaded,[{id:'lin',isFriend:true}]).map(p=>p.id),['public-friend']);
});

test('draft archiving preserves values and restoring does not create an order or duplicate',()=>{
 const data=seedDiscover(),store=storage();const id=upsertDraft(data,'ai',{title:'邀请',prompt:'给朋友写一个邀请'},null,100);
 const before={...data.drafts[0].values};setDraftArchived(data,id,true,200);persistDiscover(data,store);
 assert.equal(getDiscoverDrafts(store).length,0);assert.equal(readDiscover(store).drafts[0].archivedAt,200);
 assert.deepEqual(filterDrafts(data.drafts,{archived:true}).map(d=>d.id),[id]);
 assert.throws(()=>upsertDraft(data,'ai',before,id),/不存在/);
 setDraftArchived(data,id,false);persistDiscover(data,store);assert.equal(getDiscoverDrafts(store).length,1);assert.deepEqual(data.drafts[0].values,before);
 const copy=duplicateDraft(data,id,300);assert.notEqual(copy,id);assert.equal(data.drafts.length,2);assert.match(data.drafts[0].values.title,/副本/);assert.equal(data.drafts[0].values.status,'未提交');
});

test('ranking search and relationship filters never grant friend privileges',()=>{
 const list=[{id:'a',name:'可可',handle:'coco',amount:1,isFriend:true},{id:'b',name:'陌生人',handle:'moon',amount:20,isFriend:false},{id:'c',name:'无金额',amount:NaN}];
 assert.deepEqual(filterRankPeople(list,{scope:'friends'}).map(x=>x.id),['a']);
 assert.deepEqual(filterRankPeople(list,{scope:'new',query:'MOON'}).map(x=>x.id),['b']);
 assert.equal(list[1].isFriend,false);assert.deepEqual(filterRankPeople(list,{sort:'asc'}).map(x=>x.id),['a','b']);
});

test('new drafts never silently discard earlier saved work at capacity',()=>{
 const data=seedDiscover();data.drafts=Array.from({length:100},(_,i)=>({id:`d${i}`,type:'ai',values:{title:'旧草稿',prompt:'已有工作内容'},createdAt:i}));
 const before=JSON.stringify(data);assert.throws(()=>upsertDraft(data,'ai',{title:'新草稿',prompt:'新工作内容'},null),/100/);assert.equal(JSON.stringify(data),before);
 upsertDraft(data,'ai',{title:'编辑',prompt:'仍然允许修改已有工作'},'d0');assert.equal(data.drafts.length,100);
});

test('moments show only self and current friends, never ranking strangers',()=>{
  const data=seedDiscover();
  data.posts.push({id:'self',authorId:'me',text:'my post',createdAt:Date.now()});
  data.posts.push({id:'stranger',authorId:'moon',text:'not a friend',createdAt:Date.now()});
  const people=[{id:'lin',isFriend:true},{id:'ke',isFriend:false},{id:'moon',isFriend:false}];
  assert.deepEqual(new Set(visiblePosts(data,people).map(p=>p.authorId)),new Set(['lin','me']));
  assert.equal(visiblePosts(data,people.map(p=>({...p,isFriend:false}))).length,1);
});

test('legacy own moments migrate with deterministic IDs without modifying the social record',()=>{
  const store=storage();
  const original=JSON.stringify({posts:[{text:'我的旧动态 <b>保留原文</b>',time:'09:30'},{text:'另一条',time:'昨天'}],friends:['lin']});
  store.setItem('tongban.social.demo.v1',original);
  const one=readDiscover(store),two=readDiscover(store);
  const migrated=one.posts.filter(p=>p.migrated);
  assert.equal(migrated.length,2);
  assert.ok(migrated.every(p=>p.authorId==='me'));
  assert.deepEqual(migrated.map(p=>p.id),two.posts.filter(p=>p.migrated).map(p=>p.id));
  assert.equal(store.getItem('tongban.social.demo.v1'),original);
  persistDiscover(one,store);
  assert.equal(readDiscover(store).posts.filter(p=>p.migrated).length,2);
  assert.equal(store.getItem('tongban.social.demo.v1'),original);
});

test('malformed storage fails explicitly and quota failures do not pretend to save',()=>{
  const store=storage();store.setItem('tongban.discover.v1','{broken');
  assert.throws(()=>readDiscover(store),/无法读取/);
  store.setItem('tongban.discover.v1',JSON.stringify({version:99,posts:[],drafts:[]}));
  assert.throws(()=>readDiscover(store),/格式异常/);
  assert.throws(()=>persistDiscover(seedDiscover(),{setItem(){throw new Error('QuotaExceeded');}}),/没有保存/);
});

test('token drafts validate fixed supply, checksum address and ownership without creating a contract',()=>{
  const draft=validateTokenDraft(token());
  assert.equal(draft.symbol,'LIME');assert.equal(draft.status,'未部署');
  assert.equal(draft.network,'BSC 测试网');assert.equal(draft.serviceFee,'0 USDT');assert.equal(draft.settlement,'平台余额');
  assert.equal(draft.contractAddress,undefined);
  for(const supply of ['0','-1','1.1','1e9','1000000000000001'])assert.throws(()=>validateTokenDraft(token({supply})),/固定总量/);
  for(const address of ['0x1234','0x0000000000000000000000000000000000000000','not-a-wallet'])assert.throws(()=>validateTokenDraft(token({address})));
  assert.throws(()=>validateTokenDraft(token({symbol:'$TEST'})),/代币符号/);
  assert.throws(()=>validateTokenDraft(token({name:'a'})),/代币名称/);
  assert.throws(()=>validateTokenDraft(token({ownsWallet:false})),/自己控制/);
  assert.throws(()=>validateTokenDraft(token({ownsWallet:'true'})),/自己控制/);
});

test('service drafts preserve balance-only settlement and 300 USDT integration price without charge',()=>{
  const integration=validateServiceDraft('integration',{title:'Lime Club',details:'希望让社区成员通过平台余额使用此代币'});
  assert.equal(integration.serviceFee,'300 USDT');assert.equal(integration.status,'未提交');assert.equal(integration.settlement,'平台余额');
  assert.equal(integration.paid,undefined);
  const bounty=validateServiceDraft('bounty',{title:'设计任务',details:'设计一套包含六个图案的社区表情包',reward:'100.25'});
  assert.equal(bounty.status,'未发布');assert.equal(bounty.reward,'100.25');
  assert.throws(()=>validateServiceDraft('bounty',{title:' ',details:'这里已经超过十个字的有效内容',reward:'1'}),/名称/);
  assert.throws(()=>validateServiceDraft('provider',{title:'设计',details:'短'}),/10/);
  assert.throws(()=>validateServiceDraft('ai',{title:'研究',prompt:' '}),/提示词/);
  assert.equal(validateUsd('0.01'),'0.01');
  for(const input of ['0','-10','100.001','1e3','9999999','NaN'])assert.throws(()=>validateUsd(input),/金额/);
});

test('local images allow only bounded raster data with matching headers',()=>{
  assert.equal(safeImageData(png),true);
  assert.equal(safeImageData('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),false);
  assert.equal(safeImageData('data:image/png;base64,PHN2Zz48L3N2Zz4='),false);
  assert.equal(safeImageData('javascript:alert(1)'),false);
  assert.equal(safeImageData(`${png}" onerror="alert(1)`),false);
  assert.equal(safeImageData(`data:image/png;base64,${'A'.repeat(3*1024*1024)}`),false);
});

test('image selection rejects unsupported or oversized files before reading',async()=>{
  await assert.rejects(readMomentImages([{type:'image/svg+xml',size:10}]),/仅支持/);
  await assert.rejects(readMomentImages([{type:'image/png',size:2*1024*1024+1}]),/2 MB/);
  await assert.rejects(readMomentImages([{type:'image/png',size:1500000},{type:'image/png',size:1000000}]),/2 MB/);
  await assert.rejects(readMomentImages(Array(4).fill({type:'image/png',size:10})),/最多/);
});

test('persisted content is bounded, raster-filtered and escaped for HTML',()=>{
  const store=storage(),data=seedDiscover();
  data.posts[0].text='<img src=x onerror=alert(1)>';
  data.posts[0].images=[png,'data:image/svg+xml;base64,PHN2Zz4='];
  data.posts[0].comments=[{id:'c',authorId:'me',text:'<script>alert(1)</script>'}];
  persistDiscover(data,store);
  const loaded=readDiscover(store);
  assert.equal(loaded.posts[0].images.length,1);
  assert.equal(esc(loaded.posts[0].text),'&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(loaded.posts[0].comments[0].text),'&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('public draft reader returns only saved local drafts, never writes, and detaches returned values',()=>{
  const store=storage(),data=seedDiscover();
  assert.deepEqual(getDiscoverDrafts(store),[]);
  assert.equal(store.data.size,0,'reading an empty draft list must not seed storage');
  data.drafts=[
    {id:'ai-one',type:'ai',createdAt:1,updatedAt:5,values:{title:'写邀请函',prompt:'写一份给朋友的活动邀请',status:'已付款'}},
    {id:'token-one',type:'token',createdAt:3,values:{name:'Lime',status:'已部署'}},
  ];
  persistDiscover(data,store);
  const before=store.getItem('tongban.discover.v1'),drafts=getDiscoverDrafts(store);
  assert.deepEqual(drafts.map(d=>d.id),['ai-one','token-one']);
  assert.equal(drafts[0].title,'写邀请函');assert.equal(drafts[0].status,'未提交');
  assert.equal(drafts[1].status,'未部署');assert.equal(drafts[1].route,'token');
  assert.ok(drafts.every(d=>d.isDraft&&d.isLocal&&d.chargeStatus==='未扣款'));
  drafts[0].values.title='修改返回对象';drafts.push({id:'invented'});
  assert.equal(getDiscoverDrafts(store)[0].values.title,'写邀请函');
  assert.equal(store.getItem('tongban.discover.v1'),before,'read API must not mutate storage');
  store.setItem('tongban.discover.v1','{bad');
  assert.throws(()=>getDiscoverDrafts(store),/无法读取/);
});

test('editing a saved draft keeps its ID and creation time instead of creating duplicate orders',()=>{
  const data=seedDiscover();
  const first=upsertDraft(data,'ai',{title:'第一次',prompt:'第一份工作提示词'},null,100);
  const second=upsertDraft(data,'ai',{title:'继续写',prompt:'已修改的工作提示词'},first,200);
  assert.equal(second,first);assert.equal(data.drafts.length,1);
  assert.equal(data.drafts[0].createdAt,100);assert.equal(data.drafts[0].updatedAt,200);
  assert.equal(data.drafts[0].values.title,'继续写');assert.equal(data.drafts[0].values.status,'未提交');
  const before=structuredClone(data);
  assert.throws(()=>upsertDraft(data,'token',{name:'Token'},first,300),/不存在/);
  assert.deepEqual(data,before);
  assert.notEqual(upsertDraft(data,'ai',{title:'另一份',prompt:'另一份独立草稿'},null,400),first);
  assert.equal(data.drafts.length,2);
});

function mountHarness(t,{route='hub',own=false,data=seedDiscover(),profile}={}) {
  const store=storage(),previous=globalThis.localStorage;
  persistDiscover(data,store);
  if(profile!==undefined)store.setItem('tongban.profile.v1',typeof profile==='string'?profile:JSON.stringify(profile));
  globalThis.localStorage=store;
  const handlers=new Map(),seen=[];
  const container={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],classList:{add(){},remove(){}},addEventListener:(name,handler)=>handlers.set(name,handler),removeEventListener:name=>handlers.delete(name),scrollIntoView(){}};
  const cleanup=mountDiscover(container,{initialRoute:route,initialOwnMoments:own,onRouteChange:value=>seen.push(value)});
  t.after(()=>{cleanup();if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
  return {container,store,seen,click:(action,extra={})=>handlers.get('click')({target:{closest:()=>({dataset:{disc:action,...extra}})}})};
}

test('own moments entry shows only my posts and renders the local nickname and emoji safely',t=>{
  const data=seedDiscover();
  data.posts[0].text='FRIEND_ONLY_MARKER';
  data.posts.unshift({id:'mine',authorId:'me',text:'OWN_POST_MARKER',images:[],likes:[],comments:[],createdAt:Date.now()});
  const app=mountHarness(t,{route:'moments',own:true,data,profile:{version:1,nickname:'<b>小鹿</b>',bio:'<i>今天很好</i>',avatar:'🌊'}});
  assert.match(app.container.innerHTML,/OWN_POST_MARKER/);
  assert.doesNotMatch(app.container.innerHTML,/FRIEND_ONLY_MARKER/);
  assert.match(app.container.innerHTML,/&lt;b&gt;小鹿&lt;\/b&gt;/);
  assert.doesNotMatch(app.container.innerHTML,/<b>小鹿<\/b>/);
  assert.match(app.container.innerHTML,/🌊/);
  assert.deepEqual(app.seen,['moments']);
  app.click('moment-filter',{filter:'all'});
  assert.match(app.container.innerHTML,/FRIEND_ONLY_MARKER/);
});

test('draft navigation and filters use actual entries and notify route changes',t=>{
  const data=seedDiscover();
  data.drafts=[{id:'work-id',type:'ai',createdAt:1,values:{title:'WORK_MARKER',prompt:'给朋友写一封邀请信'}},{id:'token-id',type:'token',createdAt:2,values:{name:'TOKEN_MARKER'}}];
  const app=mountHarness(t,{route:'drafts',data});
  assert.match(app.container.innerHTML,/WORK_MARKER/);assert.match(app.container.innerHTML,/TOKEN_MARKER/);
  app.click('draft-filter',{filter:'work'});
  assert.match(app.container.innerHTML,/WORK_MARKER/);assert.doesNotMatch(app.container.innerHTML,/TOKEN_MARKER/);
  app.click('edit-draft',{id:'work-id'});
  assert.deepEqual(app.seen,['drafts','ai']);
  assert.match(app.container.innerHTML,/value="WORK_MARKER"/);
  assert.match(app.container.innerHTML,/正在编辑已保存的草稿/);
  app.click('new-draft');
  assert.doesNotMatch(app.container.innerHTML,/value="WORK_MARKER"/);
  assert.equal(getDiscoverDrafts(app.store).length,2,'opening a new form does not create or delete a draft');
  app.click('integration');
  app.click('new-draft');
  app.click('ai');
  assert.doesNotMatch(app.container.innerHTML,/value="WORK_MARKER"/,'returning to AI keeps the new form selected instead of loading an old draft');
  assert.doesNotMatch(app.container.innerHTML,/正在编辑已保存的草稿/);
  app.click('edit-draft',{id:'work-id'});
  app.click('integration');
  app.click('ai');
  assert.match(app.container.innerHTML,/value="WORK_MARKER"/,'explicit saved selection is remembered per type');
});

test('discovery keeps three primary destinations and moves secondary services to a reachable page',t=>{
  const app=mountHarness(t),markup=app.container.innerHTML;
  assert.match(markup,/data-disc="moments"/);assert.match(markup,/data-disc="ai"/);assert.match(markup,/data-disc="services"/);
  assert.doesNotMatch(markup,/data-disc="(?:bounty|provider|rank|token)"|disc-resume-section/);
  app.click('services');
  for(const destination of ['bounty','provider','rank','token'])assert.ok(app.container.innerHTML.includes(`data-disc="${destination}"`));
  assert.match(app.container.innerHTML,/不扣款|不会提交或扣款/);
  app.click('rank');assert.deepEqual(app.seen,['hub','services','rank']);
  assert.match(app.container.innerHTML,/申请好友/);
});

test('discovery offers a resume card only for a real saved draft',t=>{
  const data=seedDiscover();upsertDraft(data,'ai',{title:'我的工作',prompt:'写一封邀请信'},null);
  const app=mountHarness(t,{data});assert.match(app.container.innerHTML,/我的工作/);assert.match(app.container.innerHTML,/disc-resume-section/);
  app.click('edit-draft',{id:data.drafts[0].id});assert.match(app.container.innerHTML,/value="我的工作"/);
});

test('a stale page refuses to overwrite discovery records saved in another tab',t=>{
  const data=seedDiscover();data.rankConsent=true;
  const app=mountHarness(t,{route:'rank',data});
  const fresh=readDiscover(app.store);upsertDraft(fresh,'ai',{title:'另一页已保存',prompt:'不要被旧页面覆盖'},null);
  persistDiscover(fresh,app.store);const expected=app.store.getItem('tongban.discover.v1');
  app.click('rank-consent');
  assert.equal(app.store.getItem('tongban.discover.v1'),expected);
  assert.equal(readDiscover(app.store).rankConsent,true);
});

test('invalid profile remains intact and is explicitly reported while moments can still render',t=>{
  const original='{"version":1,"nickname":"名字","bio":"","avatar":"<svg>"}';
  const app=mountHarness(t,{route:'moments',profile:original});
  assert.match(app.container.innerHTML,/本机资料无法读取/);
  assert.match(app.container.innerHTML,/role="alert"/);
  assert.equal(app.store.getItem('tongban.profile.v1'),original);
  assert.doesNotMatch(app.container.innerHTML,/<svg>/);
});
