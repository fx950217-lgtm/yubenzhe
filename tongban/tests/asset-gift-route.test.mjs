import {walletHomeHTML} from '../src/wallet-home.js';
import {walletManagementHTML} from '../src/wallet-management-ui.js';
import {PUBLIC_DEPLOYMENT} from '../src/deployment-config.js';
import {getChain} from '../src/chain-registry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {walletFeeText} from '../src/wallet-fees.js';
import {mountDistributionPreview} from '../src/distribution-preview.js';

const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
function block(start,end){const at=source.indexOf(start),last=source.indexOf(end,at+start.length);assert.ok(at>=0&&last>at,'application function boundaries remain available');return source.slice(at,last)}
const escapeSource=source.split('\n').find(line=>line.startsWith('const esc='));
const shortSource=source.split('\n').find(line=>line.startsWith('const short='));
const walletSource=block('function displayedBalance()','function showModal(');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}};
function walletHarness({exists=true,initialBalance='12.5',hidden=false,section='assets',records=[],getBalance=async()=> '24.75'}={}){
 const page={innerHTML:''},toasts=[];let reads=0,disposals=0,recordRefreshes=0;
 const walletState={exists,address:exists?'0x1111111111111111111111111111111111111111':null,unlocked:false};
 const context=vm.createContext({PUBLIC_DEPLOYMENT,walletFeeText,walletHomeHTML,chainSection:section,currentView:'wallet',balance:initialBalance,balanceError:'',hideBalance:hidden,loadingBalance:false,state:()=>walletState,document:{querySelector:selector=>selector==='#page'?page:null},wallet:{NETWORK:getChain(97),getRecords:()=>records,getBalance:()=>{reads++;return getBalance()},refreshRecords:async()=>{recordRefreshes++;return []}},walletProblem:()=>{},icon:name=>'<svg data-icon="'+name+'"></svg>',toast:message=>toasts.push(message)});
 new vm.Script(escapeSource+'\n'+shortSource+'\n'+walletSource).runInContext(context);
 return{context,page,toasts,get reads(){return reads},get recordRefreshes(){return recordRefreshes},get disposals(){return disposals},render:()=>context.renderWallet(page),refresh:(show=false)=>context.refreshBalance(show)};
}

test('wallet home preserves real chain amounts and has one primary action',()=>{
 const h=walletHarness();h.render();assert.match(h.page.innerHTML,/<strong class="asset-total-number" id="balance-number">12\.5<\/strong>/);assert.match(h.page.innerHTML,/测试资产无实际价值/);assert.doesNotMatch(h.page.innerHTML,/balance-card|总资产估值|USDT|\$12/);
 assert.match(h.page.innerHTML,/密钥保存在你自己的设备上，平台不托管、不接触你的资金。/);
 assert.ok((h.page.innerHTML.match(/class="primary"/g)||[]).length<=1);
 for(const name of ["send","receive","wallet-more"])assert.ok(h.page.innerHTML.includes('data-action="'+name+'"'));
 assert.doesNotMatch(h.page.innerHTML,/手续费 \$0\.01|设计示例/);assert.match(h.page.innerHTML,/行情与涨跌幅未接入/);
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
 assert.match(h.page.innerHTML,/data-wallet-section="bills"/);assert.match(h.page.innerHTML,/id="recent-records"/);assert.match(h.page.innerHTML,/1\.125 tBNB/);assert.doesNotMatch(h.page.innerHTML,/id="token-balance"/);
 const pending=h.refresh(true);assert.equal(h.reads,1);assert.equal(h.context.chainSection,'bills');assert.match(h.page.innerHTML,/data-wallet-section="bills"/);wait.resolve('24.75');await pending;
 assert.equal(h.context.chainSection,'bills');assert.match(h.page.innerHTML,/data-wallet-section="bills"/);assert.match(h.page.innerHTML,/id="balance-number">24\.75/);assert.deepEqual(h.toasts,['链上资产与交易状态已更新']);assert.equal(h.recordRefreshes,1);
});

test('switching section during an in-flight refresh keeps the latest selection after success or failure',async()=>{
 for(const failure of [false,true]){
  const wait=deferred(),h=walletHarness({getBalance:()=>wait.promise});h.render();const pending=h.refresh();h.context.chainSection='bills';h.render();
  if(failure)wait.reject(Error('RPC unavailable'));else wait.resolve('7.25');await pending;
  assert.equal(h.context.chainSection,'bills');assert.match(h.page.innerHTML,/data-wallet-section="bills"/);assert.match(h.page.innerHTML,/id="recent-records"/);
  if(failure)assert.match(h.page.innerHTML,/id="balance-number">—/);
 }
});


test('distribution entry mounts the real preview and an unconfigured deployment cannot transact',async()=>{
 const dialogs=[],refreshButton={onclick:null};let configurationReads=0,localCancellations=0;
 const root={innerHTML:'',querySelector:selector=>selector==='[data-distribution-refresh]'?refreshButton:null};
 const forbidden=()=>{throw Error('Unconfigured deployment must not sign, broadcast, charge or query assets');};
 const localWallet={getWalletState:()=>({exists:false,address:null,unlocked:false}),cancelCreation:()=>localCancellations++,prepareDistributionAction:forbidden,confirmDistributionAction:forbidden,prepareTransfer:forbidden,confirmTransfer:forbidden,getBalance:forbidden};
 let cleanup;
 const context=vm.createContext({showModal:(title,html,setup,dispose)=>{dialogs.push({title,html});setup({querySelector:selector=>{assert.equal(selector,'[data-distribution-root]');return root;}});cleanup=dispose;},mountDistributionPreview:(node,options)=>mountDistributionPreview(node,{...options,load:async()=>{configurationReads++;return {enabled:false,chainId:97,mode:'equal',reason:'链上内测活动尚未部署或未启用。'};}}),wallet:localWallet,beginWalletSetup:forbidden,unlockModal:forbidden,refreshBalance:forbidden});
 vm.runInContext(block('function openDistributionInfo()','function openWalletManagement()'),context);context.openDistributionInfo();await Promise.resolve();await Promise.resolve();
 assert.equal(dialogs[0].title,'链上等额内测');assert.match(dialogs[0].html,/data-distribution-root/);assert.match(root.innerHTML,/尚未部署/);assert.match(root.innerHTML,/不会签名或增加链上资产/);assert.doesNotMatch(root.innerHTML,/<form|<input|data-distribution-action|data-gift-composer/);assert.equal(configurationReads,1);
 await refreshButton.onclick();assert.equal(configurationReads,2);assert.doesNotMatch(root.innerHTML,/data-distribution-action/);cleanup();assert.equal(localCancellations,1);
 assert.doesNotMatch(source,/mountPlatformAssets|mountGiftComposer|assets\/|gifts\/|autoBindCreatedWallet/);
});

test('wallet exposes only supported actions and implemented asset categories',()=>{
 const h=walletHarness();h.render();
 const nav=h.page.innerHTML.match(/<nav class="mobile-wallet-actions"[\s\S]*?<\/nav>/)[0];
 assert.deepEqual([...nav.matchAll(/data-action="([^"]+)"/g)].map(x=>x[1]),['send','receive','wallet-more']);
 const tabs=h.page.innerHTML.match(/<nav class="mobile-wallet-tabs"[\s\S]*?<\/nav>/)[0];assert.deepEqual([...tabs.matchAll(/data-action="([^"]+)"/g)].map(x=>x[1]),['chain-assets','chain-bills']);
 assert.doesNotMatch(source,/['"]chain-(?:defi|nft|authorizations)['"]:/);
 for(const section of ['defi','nft','authorizations']){h.context.chainSection=section;h.render();assert.match(h.page.innerHTML,/尚未接入/);assert.doesNotMatch(h.page.innerHTML,/id="token-balance"/);}
});

test('switching wallets discards a late asset response without clearing the new wallet request',async()=>{
 const old=deferred(),next=deferred();let count=0;
 const h=walletHarness({getBalance:()=>++count===1?old.promise:next.promise});
 const first=h.refresh();h.context.state().address='0x2222222222222222222222222222222222222222';h.context.resetWalletDisplay();
 const second=h.refresh();old.resolve('111');await first;
 assert.equal(h.context.balance,null);assert.equal(h.context.loadingBalance,true);
 next.resolve('222');await second;assert.equal(h.context.balance,'222');assert.equal(h.context.loadingBalance,false);assert.equal(h.recordRefreshes,1);
});

test('local management escapes names and shows a single create action and selected-wallet controls',()=>{
 const html=walletManagementHTML([{id:'a',address:'0x1111',name:'<img src=x>',selected:true},{id:'b',address:'0x2222',name:'钱包 2',selected:false}]);
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/data-select-wallet="a" aria-current="true" disabled/);assert.match(html,/data-select-wallet="b"/);
 assert.equal((html.match(/class="primary"/g)||[]).length,1);assert.match(html,/不影响其他钱包、链上资产/);
 const card=walletHomeHTML({state:{exists:true,address:'0x1111111111111111111111111111111111111111'},network:getChain(97),amount:'—',walletName:'<私有备注>'});
 assert.match(card,/aria-label="切换或管理本机钱包"/);assert.match(card,/&lt;私有备注&gt;/);assert.doesNotMatch(card,/chain-defi|chain-nft|chain-authorizations|data-action="exchange"/);
});
