import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
function block(start,end){const at=source.indexOf(start),last=source.indexOf(end,at+start.length);assert.ok(at>=0&&last>at,'application function boundaries remain available');return source.slice(at,last)}
const escapeSource=source.split('\n').find(line=>line.startsWith('const esc='));
const shortSource=source.split('\n').find(line=>line.startsWith('const short='));
const walletSource=block('function displayedBalance()','function showModal(');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
function walletHarness({exists=true,initialBalance='12.5',hidden=false,section='assets',records=[],getBalance=async()=> '24.75'}={}){
 const page={innerHTML:''},toasts=[];let reads=0,disposals=0;
 const walletState={exists,address:exists?'0x1111111111111111111111111111111111111111':null,unlocked:false};
 const context=vm.createContext({chainSection:section,currentView:'wallet',balance:initialBalance,balanceError:'',hideBalance:hidden,loadingBalance:false,state:()=>walletState,document:{querySelector:selector=>selector==='#page'?page:null},wallet:{getRecords:()=>records,getBalance:()=>{reads++;return getBalance()}},walletProblem:()=>{},icon:name=>'<svg data-icon="'+name+'"></svg>',toast:message=>toasts.push(message)});
 new vm.Script(escapeSource+'\n'+shortSource+'\n'+walletSource).runInContext(context);
 return{context,page,toasts,get reads(){return reads},get disposals(){return disposals},render:()=>context.renderWallet(page),refresh:(show=false)=>context.refreshBalance(show)};
}

test('chain assets show only chain balances, circular action hooks and underlined section choices',()=>{
 const h=walletHarness();h.render();assert.match(h.page.innerHTML,/<strong class="asset-total-number" id="balance-number">12\.5<\/strong>/);assert.match(h.page.innerHTML,/测试资产 · 涨幅不适用/);assert.doesNotMatch(h.page.innerHTML,/balance-card|总资产估值|USDT|\$12/);
 const quick=h.page.innerHTML.match(/<nav class="asset-quick-actions"[\s\S]+?<\/nav>/)[0];
 assert.deepEqual([...quick.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]),['send','receive','asset-scan','asset-gift']);assert.equal([...quick.matchAll(/class="asset-quick-icon"/g)].length,4);
 assert.match(h.page.innerHTML,/class="asset-segment active" aria-current="page" data-action="chain-assets"/);assert.doesNotMatch(h.page.innerHTML,/id="recent-records"/);assert.match(h.page.innerHTML,/钱包资产/);
});

test('missing and unreadable chain balance are placeholders, real zero stays zero, and visibility hides both numbers',()=>{
 for(const [options,expected] of [[{exists:false,initialBalance:'100'},'—'],[{initialBalance:null},'—'],[{initialBalance:'0'},'0'],[{hidden:true},'••••••']]){
  const h=walletHarness(options);h.render();assert.ok(h.page.innerHTML.includes('<strong class="asset-total-number" id="balance-number">'+expected+'</strong>'));
  if(options.hidden)assert.doesNotMatch(h.page.innerHTML,/>12\.5</);
 }
});

test('bills use real local records and refreshing chain balances preserves the selected bills section',async()=>{
 const wait=deferred(),records=[{hash:'0x123',to:'0x1111111111111111111111111111111111111111',amount:'1.125',status:'confirmed'}];
 const h=walletHarness({section:'bills',records,getBalance:()=>wait.promise});h.render();
 assert.match(h.page.innerHTML,/class="asset-segment active" aria-current="page" data-action="chain-bills"/);assert.match(h.page.innerHTML,/id="recent-records"/);assert.match(h.page.innerHTML,/1\.125 tBNB/);assert.doesNotMatch(h.page.innerHTML,/id="token-balance"/);
 const pending=h.refresh(true);assert.equal(h.reads,1);assert.equal(h.context.chainSection,'bills');assert.match(h.page.innerHTML,/data-action="chain-bills"/);wait.resolve('24.75');await pending;
 assert.equal(h.context.chainSection,'bills');assert.match(h.page.innerHTML,/class="asset-segment active" aria-current="page" data-action="chain-bills"/);assert.match(h.page.innerHTML,/id="balance-number">24\.75/);assert.deepEqual(h.toasts,['链上余额已更新']);
});

test('switching section during an in-flight refresh keeps the latest selection after success or failure',async()=>{
 for(const failure of [false,true]){
  const wait=deferred(),h=walletHarness({getBalance:()=>wait.promise});h.render();const pending=h.refresh();h.context.chainSection='bills';h.render();
  if(failure)wait.reject(Error('RPC unavailable'));else wait.resolve('7.25');await pending;
  assert.equal(h.context.chainSection,'bills');assert.match(h.page.innerHTML,/class="asset-segment active" aria-current="page" data-action="chain-bills"/);assert.match(h.page.innerHTML,/id="recent-records"/);
  if(failure)assert.match(h.page.innerHTML,/id="balance-number">—/);
 }
});


test('red-packet entry is an explanation only and never reads or moves any funds',()=>{const dialogs=[];const fail=()=>{throw Error('No wallet, points or platform mutation allowed')};const context=vm.createContext({showModal:(title,html)=>dialogs.push({title,html}),socialClient:new Proxy({},{get:()=>fail}),wallet:new Proxy({},{get:()=>fail})});vm.runInContext(block('function openDistributionInfo()','function openWalletManagement()'),context);context.openDistributionInfo();assert.match(dialogs[0].html,/尚未部署/);assert.match(dialogs[0].html,/不能转赠/);assert.doesNotMatch(dialogs[0].html,/<form|<input|data-gift-composer/);assert.doesNotMatch(source,/mountPlatformAssets|mountGiftComposer|assets\/|gifts\/|autoBindCreatedWallet/);});
