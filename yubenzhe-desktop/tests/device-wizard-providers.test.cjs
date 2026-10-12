const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {SETUP_CATALOG}=require('../src/setup-catalog.cjs');
const script=fs.readFileSync(path.resolve(__dirname,'../src/device-wizard.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const readyCodex={id:'codex',name:'Codex',installed:true,loggedIn:true,executionSupported:true,executionMode:'tools',reason:'本机编码任务已就绪。'};

async function harness(initial={}){
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.disabled=false;this.hidden=false;this._text='';}
  append(...items){this.children.push(...items);}
  removeChild(item){const index=this.children.indexOf(item);assert.ok(index>=0);this.children.splice(index,1);}
  replaceChildren(...items){this.children=[...items];this._text='';}
  set textContent(value){this._text=String(value??'');this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set innerHTML(_value){assert.fail('provider or model content must never enter innerHTML');}
 }
 const names=['origin','name','source','code','expiry','generate','start','stop','import','reset','autoStart','workspace','message','capabilities','probe','setup-catalog','ollamaModel','saveOllamaModel'];
 const buttons=new Set(['generate','start','stop','import','reset','probe','saveOllamaModel']);
 const elements=Object.fromEntries(names.map(id=>[id,new Element(buttons.has(id)?'button':'div')]));
 const all=()=>{const result=[];const walk=node=>{result.push(node);node.children.forEach(walk);};Object.values(elements).forEach(walk);return result;};
 let state={setupCatalog:SETUP_CATALOG,ollamaModel:'',running:false,...initial},receive;const requests=[],hooks={};
 const document={activeElement:null,getElementById:id=>elements[id],createElement:tag=>new Element(tag),querySelectorAll:tag=>all().filter(node=>node.tagName===tag)};
 const api={onState:fn=>{receive=fn;},action:async input=>{requests.push(input);return hooks[input.action]?hooks[input.action](input):state;}};
 vm.runInNewContext(script,{document,window:{YbzDeviceSetup:api},Date});await new Promise(resolve=>setImmediate(resolve));
 const article=id=>all().find(node=>node.dataset.setupItem===id);
 const field=(id,name)=>article(id).children.find(node=>node.dataset.providerField===name).textContent;
 return {elements,document,requests,hooks,article,field,receive:patch=>{state={...state,...patch};receive(state);},text:()=>elements['setup-catalog'].textContent};
}

test('all five setup categories remain while providers without evidence display undetected',async()=>{
 const h=await harness();assert.deepEqual(h.elements['setup-catalog'].children.map(node=>node.dataset.setupCategory),['email','browser','social','ai','ybz']);
 for(const id of ['codex','claude','workb','ollama']){assert.equal(h.article(id).dataset.providerStatus,'unknown');assert.equal(h.field(id,'installed'),'安装：未检测');assert.match(h.field(id,'executionSupported'),/未检测/);assert.doesNotMatch(h.article(id).textContent,/执行：已就绪/);}
 assert.equal(h.elements.ollamaModel.value,'');assert.equal(h.requests.filter(input=>input.action==='setOllamaModel').length,0);
});
test('installation and login never imply execution support and absent AI remains visible in grey state',async()=>{
 const h=await harness({providers:[readyCodex,{id:'claude',installed:true,loggedIn:true,executionSupported:false,executionMode:'disabled',reason:'尚未接通任务执行。'},{id:'workb',installed:false,loggedIn:null,executionSupported:false,executionMode:'disabled',reason:'本机未检测到。'}]});
 assert.equal(h.article('codex').dataset.providerStatus,'ready');assert.equal(h.field('codex','executionMode'),'模式：工具任务');
 assert.equal(h.article('claude').dataset.providerStatus,'limited');assert.equal(h.field('claude','installed'),'安装：已安装');assert.equal(h.field('claude','executionSupported'),'执行：不支持');
 assert.equal(h.article('workb').dataset.providerStatus,'missing');assert.equal(h.article('workb').hidden,false);assert.match(h.field('workb','loggedIn'),/未检测/);
 h.receive({providers:[{...readyCodex,loggedIn:null}]});assert.equal(h.article('codex').dataset.providerStatus,'limited');assert.equal(h.field('codex','executionSupported'),'执行：已适配，尚未就绪');
});
test('Ollama local chat identifies no-login mode only after installation evidence',async()=>{
 const h=await harness({providers:[{id:'ollama',installed:true,loggedIn:null,executionSupported:true,executionMode:'chat-only',reason:'使用已安装本机模型，无工具对话。'}]});
 assert.equal(h.field('ollama','loggedIn'),'登录：本地模式，无需登录');assert.equal(h.field('ollama','executionMode'),'模式：无工具对话');assert.equal(h.article('ollama').dataset.providerStatus,'ready');
 h.receive({providers:[{id:'ollama',installed:false,loggedIn:null,executionSupported:false,executionMode:'disabled',reason:'本机未检测到。'}]});assert.match(h.field('ollama','loggedIn'),/未检测/);assert.equal(h.article('ollama').dataset.providerStatus,'missing');
});
test('state refresh updates existing status elements and preserves expanded categories and model edits',async()=>{
 const h=await harness(),category=h.elements['setup-catalog'].children[3],article=h.article('codex');category.open=true;
 h.document.activeElement=h.elements.ollamaModel;h.elements.ollamaModel.value='editing-local-model';h.receive({providers:[readyCodex],ollamaModel:'persisted-name'});
 assert.equal(h.article('codex'),article);assert.equal(category.open,true);assert.equal(h.elements.ollamaModel.value,'editing-local-model');assert.equal(h.field('codex','executionSupported'),'执行：已就绪');
 h.document.activeElement=null;h.receive({providers:[]});assert.equal(h.article('codex').dataset.providerStatus,'unknown');assert.equal(h.elements.ollamaModel.value,'persisted-name');
});
test('duplicate provider evidence fails closed and dynamic values are rendered as text without executable paths',async()=>{
 const reason='<img src=x onerror="fake()">';const h=await harness({providers:[{...readyCodex,reason,executable:'C:\\private-owner\\codex.exe'}]});
 assert.equal(h.field('codex','reason'),reason);assert.equal(h.article('codex').children.some(node=>node.tagName==='img'),false);assert.doesNotMatch(h.text(),/private-owner|codex\.exe/);
 h.receive({providers:[readyCodex,{...readyCodex,loggedIn:false}]});assert.equal(h.article('codex').dataset.providerStatus,'unknown');assert.match(h.field('codex','installed'),/未检测/);
});
test('additional registry providers gain text-only rows without arbitrary links and disappear without removing fixed installation entries',async()=>{
 const h=await harness({providers:[readyCodex]}),category=h.elements['setup-catalog'].children[3],fixed=h.article('codex');category.open=true;
 h.receive({providers:[readyCodex,{id:'gemini',name:'<img src=x> Gemini',installed:true,loggedIn:null,executionSupported:false,executionMode:'disabled',reason:'尚未适配。',url:'https://unreviewed.invalid',executable:'C:\\private\\gemini.exe'}]});
 const extra=h.article('gemini');assert.ok(extra);assert.equal(extra.children[0].textContent,'<img src=x> Gemini');assert.equal(extra.children.some(node=>node.tagName==='button'||node.tagName==='img'||node.tagName==='a'),false);assert.doesNotMatch(extra.textContent,/unreviewed|private\\gemini/);assert.equal(h.field('gemini','executionSupported'),'执行：不支持');assert.equal(category.open,true);
 h.receive({providers:[{id:'bad/id',name:'Not a provider'}]});assert.equal(h.article('gemini'),undefined);assert.equal(h.article('bad/id'),undefined);assert.equal(h.article('codex'),fixed);for(const id of ['codex','claude','workb','ollama'])assert.ok(h.article(id));assert.equal(category.open,true);
});
test('model save sends only a trimmed local model setting and can clear the selection without pulling a model',async()=>{
 const h=await harness();h.elements.ollamaModel.value='  existing-model:latest  ';await h.elements.saveOllamaModel.onclick();
 assert.deepEqual(JSON.parse(JSON.stringify(h.requests.at(-1))),{action:'setOllamaModel',model:'existing-model:latest'});
 h.elements.ollamaModel.value='  ';await h.elements.saveOllamaModel.onclick();assert.deepEqual(JSON.parse(JSON.stringify(h.requests.at(-1))),{action:'setOllamaModel',model:''});
 assert.equal(h.requests.some(input=>/download|pull|install|login/i.test(input.action)),false);
});
test('running state prevents model mutation even through a direct callback and survives the action finally block',async()=>{
 const h=await harness({running:true,ollamaModel:'installed:local'});assert.equal(h.elements.ollamaModel.disabled,true);assert.equal(h.elements.saveOllamaModel.disabled,true);
 const before=h.requests.length;await h.elements.saveOllamaModel.onclick();assert.equal(h.requests.length,before);
 await h.elements.probe.onclick();assert.equal(h.elements.saveOllamaModel.disabled,true);assert.equal(h.elements.ollamaModel.disabled,true);
 h.hooks.probe=()=>{throw Error('Synthetic failed probe');};await h.elements.probe.onclick();assert.match(h.elements.message.textContent,/Synthetic failed probe/);assert.equal(h.elements.saveOllamaModel.disabled,true);
 h.receive({running:false});assert.equal(h.elements.saveOllamaModel.disabled,false);assert.equal(h.elements.ollamaModel.disabled,false);
});
test('an in-flight action blocks duplicate model saves until the action completes',async()=>{
 const h=await harness(),wait=deferred();h.hooks.probe=()=>wait.promise;
 const pending=h.elements.probe.onclick();assert.equal(h.elements.saveOllamaModel.disabled,true);assert.equal(h.elements.ollamaModel.disabled,true);const before=h.requests.length;
 await h.elements.saveOllamaModel.onclick();assert.equal(h.requests.length,before);
 wait.resolve({setupCatalog:SETUP_CATALOG,running:false,ollamaModel:''});await pending;assert.equal(h.elements.saveOllamaModel.disabled,false);
});
test('model setup explains installed-only chat and no automatic download while keeping the sandbox boundary',()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../src/device-wizard.html'),'utf8');assert.match(html,/id="ollamaModel"/);assert.match(html,/仅填写已安装的本机模型/);assert.match(html,/无工具对话/);assert.match(html,/不会自动下载/);assert.match(html,/workspace-write/);assert.match(html,/不等于整个系统的读取隔离/);assert.doesNotMatch(html,/<iframe|<webview/);
});
