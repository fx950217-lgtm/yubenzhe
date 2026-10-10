import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/discover-workbench.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node',loader:{'.css':'empty'},logLevel:'silent'});
const source=bundle.outputFiles[0].text;
const {escapeWorkText,PROVIDER_EXAMPLES,PROMPT_TEMPLATES,BOUNTY_TEMPLATES,parseWorkUsd,formatWorkUsd,buildStructuredPrompt,bountySettlement,validateWorkbenchDraft,workbenchDraftStats,createDiscoveryWorkbench}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const bounty=overrides=>({title:'一次产品体验',details:'按指定任务走完主要流程并记录问题和截图',acceptance:'交付完整的问题复现步骤与预期结果，不含个人敏感资料',reward:'100.00',count:'3',duration:'7 天',deadline:'2030-01-09',...overrides});
const provider=overrides=>({title:'社区品牌设计',details:'希望为我们的社区整理一份清楚的品牌视觉规范',category:'品牌与设计',budget:'120.50',date:'2030-01-08',...overrides});
const today={today:'2030-01-01'};

function harness(initial={},initialDrafts=[]) {
  const current=structuredClone(initial),keys={},calls={saved:[],render:0,toast:[],dialogs:[],closed:0,go:[],balance:0};
  let drafts=structuredClone(initialDrafts),failure=null,afterSave=null;
  const ctx={getDraft:type=>current[type]||{},getDraftKey:type=>keys[type]||`new:${type}`,getDrafts:()=>drafts,
    saveDraft(type,values){if(failure)throw new Error(failure);calls.saved.push({type,values});current[type]={...values};afterSave?.(type,values);},
    validateDraft(type,values){assert.equal(values.settlement,'独立服务协议');return {...values};},
    showDialog:(title,html)=>calls.dialogs.push({title,html}),closeDialog:()=>calls.closed++,toast:value=>calls.toast.push(value),
    go:(route,options)=>calls.go.push({route,options}),onBalance:()=>calls.balance++,render:()=>calls.render++};
  const wb=createDiscoveryWorkbench(ctx);
  return {wb,calls,current,keys,setDrafts:value=>{drafts=value;},failSave:message=>{failure=message;},onSave:callback=>{afterSave=callback;},click:(action,dataset={},form=null)=>wb.handleAction(action,{dataset,closest:selector=>selector==='[data-work-form]'?form:null})};
}
function installFormData(t) {
  const original=globalThis.FormData;
  globalThis.FormData=class {constructor(form){this.values=form.values;}[Symbol.iterator](){return Object.entries(this.values)[Symbol.iterator]();}};
  t.after(()=>{globalThis.FormData=original;});
}
function formFor(type,values) {
  const error={textContent:''},count={textContent:''},budget={textContent:''},deadline={value:values.deadline||''};
  const form={dataset:{workForm:type},values:{...values},closest:selector=>selector==='[data-work-form]'?form:null,querySelector:selector=>({'.work-error':error,'[data-work-char]':count,'[data-work-budget]':budget,'[name=deadline]':deadline}[selector]||null)};
  return {form,error,count,budget,deadline,event:()=>{const event={target:form,prevented:false,preventDefault(){this.prevented=true;}};return event;}};
}

test('budget parsing uses exact cents and rejects exponents, unsafe amounts and fractional cents',()=>{
  assert.equal(parseWorkUsd('0.01'),1n);assert.equal(parseWorkUsd('999999.99'),99999999n);
  assert.equal(formatWorkUsd(parseWorkUsd('100.1')),'100.10');
  for(const input of ['0','-1','1e3','1.001','1000000','01','NaN','Infinity','',null,1])assert.throws(()=>parseWorkUsd(input));
  const p=bountySettlement({reward:'100',count:'3'});
  assert.deepEqual(p,{total:'100.00',count:3,base:'33.33',higher:'33.34',higherCount:1,baseCount:2,settlement:'独立服务协议',frozen:false,paid:false});
  assert.equal(parseWorkUsd(p.base)*BigInt(p.baseCount)+parseWorkUsd(p.higher)*BigInt(p.higherCount),parseWorkUsd(p.total));
  assert.equal(bountySettlement({reward:'0.03',count:'3'}).base,'0.01');
  for(const count of ['0','-1','1.5','101','1e2','01',''])assert.throws(()=>bountySettlement({reward:'100',count}));
  assert.throws(()=>bountySettlement({reward:'0.02',count:'3'}),/每人/);
});

test('structured prompt templates remain editable instructions, require a useful brief and preserve literal text',()=>{
  for(const template of PROMPT_TEMPLATES){const result=buildStructuredPrompt(template);assert.ok(result.length<=2000);assert.ok(result.includes(template.goal));assert.match(result,/任务目标：/);assert.match(result,/不要虚构事实/);}
  const t=PROMPT_TEMPLATES[0];assert.match(buildStructuredPrompt({...t,goal:'<script>原文只是内容</script>'}),/<script>/);
  for(const key of ['goal','audience','deliverable'])assert.throws(()=>buildStructuredPrompt({...t,[key]:'  '}));
  assert.throws(()=>buildStructuredPrompt({...t,tone:'声称已验证所有事实'}),/语气/);
  assert.throws(()=>buildStructuredPrompt({...t,goal:'a'.repeat(401)}),/目标/);
});

test('provider drafts verify example/package pairing and cannot claim certification or a paid appointment',()=>{
  const d=validateWorkbenchDraft('provider',provider({providerId:'leaf',packageId:'identity',verification:'已认证',paid:true,status:'已预约'}),today);
  assert.equal(d.providerName,'青叶设计小组');assert.equal(d.packageName,'轻量品牌视觉');
  assert.equal(d.verification,'示例团队 · 未认证');assert.equal(d.status,'未提交');assert.equal(d.paid,undefined);assert.equal(d.budget,'120.50');
  assert.throws(()=>validateWorkbenchDraft('provider',provider({providerId:'leaf',packageId:'event'}),today),/失效/);
  assert.throws(()=>validateWorkbenchDraft('provider',provider({providerId:'bridge',packageId:'event'}),today),/类别不一致/);
  assert.throws(()=>validateWorkbenchDraft('provider',provider({category:'保证收益'}),today),/类别/);
  assert.throws(()=>validateWorkbenchDraft('provider',provider({date:'2030-02-30'}),today),/有效/);
  assert.throws(()=>validateWorkbenchDraft('provider',provider({date:'2029-12-31'}),today),/早于/);
  assert.equal(validateWorkbenchDraft('provider',provider({budget:'',date:''}),today).budget,'');
});

test('bounty validates delivery, acceptance, count and real dates while overriding forged settlement state',()=>{
  const d=validateWorkbenchDraft('bounty',bounty({status:'已发布',paid:true,settlement:'链上钱包',contractAddress:'0xFAKE'}),today);
  assert.equal(d.status,'未发布');assert.equal(d.settlement,'独立服务协议');assert.equal(d.reward,'100.00');assert.equal(d.count,'3');
  assert.equal(d.paid,undefined);assert.equal(d.contractAddress,undefined);
  for(const bad of [{title:' '},{details:'短'},{acceptance:'满意为止'},{count:'101'},{reward:'1e2'},{deadline:'2030-13-01'},{deadline:'2029-12-31'},{deadline:''}])assert.throws(()=>validateWorkbenchDraft('bounty',bounty(bad),today));
  assert.equal(validateWorkbenchDraft('bounty',bounty({deadline:'2032-02-29'}),today).deadline,'2032-02-29');
  assert.throws(()=>validateWorkbenchDraft('bounty',bounty({deadline:'2031-02-29'}),today),/有效/);
  for(const template of BOUNTY_TEMPLATES)assert.equal(validateWorkbenchDraft('bounty',bounty({...template}),today).status,'未发布');
});

test('legacy prompt-only AI draft stays usable and new fields are bounded without pretending to generate',()=>{
  const d=validateWorkbenchDraft('ai',{title:'旧工作草稿',prompt:'请根据这段背景整理需要确认的问题',result:'伪造生成正文',status:'已生成'});
  assert.equal(d.prompt,'请根据这段背景整理需要确认的问题');assert.equal(d.mode,'本机模板整理，未调用AI');assert.equal(d.status,'未提交');
  assert.equal(d.result,undefined);assert.equal(d.tone,'自然友好');
  assert.throws(()=>validateWorkbenchDraft('ai',{title:'提示词',prompt:'1234'}),/提示词/);
  assert.throws(()=>validateWorkbenchDraft('ai',{title:'提示词',prompt:'a'.repeat(2001)}),/提示词/);
  assert.throws(()=>validateWorkbenchDraft('ai',{title:'提示词',prompt:'有效提示词内容',context:'a'.repeat(501)}),/背景/);
  assert.throws(()=>validateWorkbenchDraft('token',{}),/类型/);
});

test('statistics count only real active saved drafts, exclude templates and preserve input',()=>{
  const drafts=[{id:'one',type:'bounty',values:{title:'A',reward:'100.10'}},{id:'two',type:'bounty',values:{title:'B',reward:'0.20'}},{id:'bad-budget',type:'bounty',values:{reward:'invalid'}},{id:'ai',type:'ai',values:{title:'C'}},{id:'provider',type:'provider',values:{}},{id:'one',type:'bounty',values:{reward:'900'}},{id:'token',type:'token',values:{reward:'999'}},{id:'archived',type:'bounty',values:{reward:'900'},archivedAt:1},{id:'array',type:'bounty',values:[]}];
  const before=structuredClone(drafts),result=workbenchDraftStats(drafts);
  assert.equal(result.total,5);assert.equal(result.bounty,3);assert.equal(result.ai,1);assert.equal(result.provider,1);assert.equal(result.bountyBudget,'100.30');
  result.lists.bounty[0].values.title='changed';assert.deepEqual(drafts,before);
  assert.equal(workbenchDraftStats([]).total,0);assert.equal(workbenchDraftStats(null).bountyBudget,'0.00');
});

test('renderer safely displays saved text and shows honest empty states with no invented jobs',()=>{
  const h=harness({ai:{title:'"><img src=x onerror=alert(1)>',prompt:'</textarea><script>alert(1)</script>'}},[{id:'d',type:'bounty',values:{title:'<script>fake</script>',reward:'100'}}]);
  const ai=h.wb.render('ai');assert.doesNotMatch(ai,/<script>|<img src=x/);assert.match(ai,/&lt;script&gt;/);assert.match(ai,/未调用 AI/);
  const b=h.wb.render('bounty');assert.match(b,/1<span> 份/);assert.match(b,/&lt;script&gt;fake/);assert.doesNotMatch(b,/<script>/);assert.match(b,/未发布 · 未冻结/);
  const empty=harness().wb.render('bounty');assert.match(empty,/还没有任务草稿/);assert.match(empty,/0\.00/);
  assert.equal(h.wb.render('unknown'),null);assert.equal(escapeWorkText('<>&"\''),'&lt;&gt;&amp;&quot;&#39;');
});

test('service category filter and package selection are useful actions that do not create an appointment',()=>{
  const h=harness();h.wb.render('provider');
  assert.equal(h.click('w-provider-filter',{category:'社区与运营'}),true);
  let html=h.wb.render('provider');assert.match(html,/小桥共创小组/);assert.doesNotMatch(html,/青叶设计小组/);
  h.click('w-provider-detail',{id:'bridge'});assert.match(h.calls.dialogs[0].html,/活动流程/);assert.match(h.calls.dialogs[0].html,/示例团队 · 未认证/);
  h.click('w-provider-pick',{id:'bridge',package:'event'});html=h.wb.render('provider');
  assert.match(html,/value="bridge"/);assert.match(html,/社区活动方案/);assert.match(html,/活动流程、报名信息清单/);assert.equal(h.calls.saved.length,0);
  h.click('w-provider-clear');assert.match(h.wb.render('provider'),/name="providerId" value=""/);
  assert.equal(h.click('w-not-a-real-action'),false);assert.equal(h.click('balance'),false);
});

test('AI template preview requires a separate apply action and composing never writes a draft',()=>{
  const h=harness({ai:{title:'原草稿',prompt:'原来已经写好的提示词内容'}});h.wb.render('ai');
  h.click('w-ai-template',{id:'meeting'});assert.match(h.calls.dialogs[0].html,/应用后会替换/);assert.match(h.wb.render('ai'),/原来已经写好的提示词内容/);
  h.click('w-ai-apply',{id:'meeting'});assert.match(h.wb.render('ai'),/会议记录整理提示词/);assert.match(h.wb.render('ai'),/未提及的信息标记待确认/);
  h.click('w-ai-compose');assert.match(h.wb.render('ai'),/不要虚构事实/);assert.equal(h.calls.saved.length,0);
  h.keys.ai='different-draft';h.current.ai={title:'其他草稿',prompt:'这是另外一份独立提示词'};
  assert.match(h.wb.render('ai'),/另外一份独立提示词/);
});

test('draft identity change resets unsaved local editing even when persisted values are identical',()=>{
  const h=harness({ai:{}});h.wb.render('ai');h.click('w-ai-apply',{id:'invite'});assert.match(h.wb.render('ai'),/朋友见面会邀请/);
  h.keys.ai='another-empty-draft';assert.doesNotMatch(h.wb.render('ai'),/value="朋友见面会邀请"/);
  h.setDrafts([{id:'real',type:'ai',values:{title:'存在的草稿'}}]);h.click('w-edit',{id:'real',type:'ai'});
  assert.deepEqual(h.calls.go,[{route:'ai',options:{draftId:'real'}}]);h.click('w-edit',{id:'removed',type:'ai'});assert.match(h.calls.toast.at(-1),/不存在/);
});

test('switching A and B preserves each unsaved buffer and first save migrates only the new draft',t=>{
  installFormData(t);
  const a={id:'A',type:'ai',values:{title:'A 持久化名称',prompt:'A 原始提示词内容'}},b={id:'B',type:'ai',values:{title:'B 持久化名称',prompt:'B 原始提示词内容'}};
  const h=harness({ai:a.values},[a,b]);
  const open=draft=>{h.click('w-edit',{id:draft.id,type:'ai'});h.keys.ai=draft.id;h.current.ai={...draft.values};return h.wb.render('ai');};
  open(a);
  const fa=formFor('ai',{...a.values,title:'A 未保存修改',prompt:'A 未保存的独立提示词'});
  h.wb.handleInput({target:{name:'prompt',closest:()=>fa.form}});
  open(b);
  const fb=formFor('ai',{...b.values,title:'B 未保存修改',prompt:'B 未保存的独立提示词'});
  h.wb.handleInput({target:{name:'prompt',closest:()=>fb.form}});
  assert.match(open(a),/A 未保存的独立提示词/);assert.doesNotMatch(h.wb.render('ai'),/B 未保存的独立提示词/);
  assert.match(open(b),/B 未保存的独立提示词/);assert.equal(h.calls.saved.length,0);
  h.keys.ai='new:ai';h.current.ai={};h.wb.render('ai');
  const fresh=formFor('ai',{title:'新草稿 C',prompt:'C 新建且准备保存的提示词'});
  h.wb.handleInput({target:{name:'prompt',closest:()=>fresh.form}});
  h.onSave(()=>{h.keys.ai='C';h.wb.render('ai');});
  assert.equal(h.wb.handleSubmit(fresh.event()),true);assert.equal(h.calls.saved.length,1);
  const savedC={...h.current.ai};assert.match(h.wb.render('ai'),/C 新建且准备保存的提示词/);
  assert.match(open(a),/A 未保存的独立提示词/);assert.match(open(b),/B 未保存的独立提示词/);
  h.keys.ai='new:ai';h.current.ai={};assert.doesNotMatch(h.wb.render('ai'),/C 新建且准备保存的提示词/);
  h.keys.ai='C';h.current.ai=savedC;assert.match(h.wb.render('ai'),/C 新建且准备保存的提示词/);
  assert.equal(a.values.title,'A 持久化名称');assert.equal(b.values.title,'B 持久化名称');
});

test('form submission returns a synchronous handled flag, validates before saving and exposes save failure',t=>{
  installFormData(t);const h=harness();h.wb.render('ai');
  const f=formFor('ai',{title:'工作草稿',prompt:'一份有效的工作提示词，请先说明需要补充什么'}),event=f.event();
  assert.equal(h.wb.handleSubmit(event),true);assert.equal(event.prevented,true);assert.equal(h.calls.saved.length,1);assert.equal(h.calls.saved[0].values.mode,'本机模板整理，未调用AI');
  f.form.values.prompt='短';assert.equal(h.wb.handleSubmit(f.event()),true);assert.match(f.error.textContent,/提示词/);assert.equal(h.calls.saved.length,1);
  f.form.values.prompt='重新修改后的有效提示词';h.failSave('存储空间不足，本次未保存');h.wb.handleSubmit(f.event());assert.match(f.error.textContent,/未保存/);assert.equal(h.calls.saved.length,1);
  assert.equal(h.wb.handleSubmit({target:{closest:()=>null}}),false);
});

test('task preview conserves total and requires an explicit save without publishing or freezing',()=>{
  const h=harness({bounty:bounty({deadline:'2099-01-09'})});h.wb.render('bounty');
  assert.equal(h.click('w-bounty-preview'),true);const dialog=h.calls.dialogs[0];
  assert.match(dialog.html,/33\.34 USDT × 1 人，33\.33 USDT × 2 人/);assert.match(dialog.html,/未发布 · 未冻结 · 未扣款/);
  assert.equal(h.calls.saved.length,0);h.click('w-bounty-save-preview');assert.equal(h.calls.saved.length,1);assert.equal(h.calls.saved[0].type,'bounty');assert.equal(h.calls.saved[0].values.status,'未发布');assert.equal(h.calls.closed,1);
});

test('live input previews update locally and never persist or invoke a payment callback',t=>{
  installFormData(t);const h=harness(),f=formFor('bounty',bounty({reward:'50.25',count:'5'}));h.wb.render('bounty');
  h.wb.handleInput({target:{name:'reward',closest:()=>f.form}});assert.equal(f.budget.textContent,'5 人 · 总计 50.25 USDT');assert.equal(h.calls.saved.length,0);assert.equal(h.calls.balance,0);
  f.form.values.reward='NaN';h.wb.handleInput({target:{name:'reward',closest:()=>f.form}});assert.equal(f.budget.textContent,'填写预算和人数后预览');
  const a=formFor('ai',{title:'稿',prompt:'12345'});h.wb.handleInput({target:{name:'prompt',closest:()=>a.form}});assert.equal(a.count.textContent,'5 / 2000');
});

test('cleanup makes all workbench handlers inert and leaves saved records untouched',()=>{
  const h=harness({ai:{title:'保留',prompt:'保持这份本机草稿不受清理影响'}});h.wb.render('ai');const before=structuredClone(h.current);h.wb.cleanup();
  assert.equal(h.wb.render('ai'),null);assert.equal(h.click('w-ai-apply',{id:'invite'}),false);assert.equal(h.wb.handleSubmit({target:{closest:()=>null}}),false);assert.deepEqual(h.current,before);
});
