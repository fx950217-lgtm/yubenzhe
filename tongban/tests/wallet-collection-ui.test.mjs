import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {walletHomeHTML} from '../src/wallet-home.js';
import {walletManagementHTML} from '../src/wallet-management-ui.js';
import {mountNetworkPicker} from '../src/wallet-tools-ui.js';

const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
function part(start,end){
 const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
 assert.ok(from>=0&&to>from,'the exercised application function must exist');
 return source.slice(from,to);
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
const addressA='0x'+'1'.repeat(40),addressB='0x'+'2'.repeat(40);

test('wallet collection storage failure keeps rendering the unavailable wallet without crashing the page',()=>{
 const page={innerHTML:''};
 const scope={walletHomeHTML,state:()=>({exists:true,unavailable:true,address:null}),wallet:{NETWORK:{name:'BSC 测试网',symbol:'tBNB'},listLocalWallets(){throw Error('storage blocked');}},displayedBalance:()=>'—',hideBalance:true,balance:null,balanceError:'钱包暂不可用',loadingBalance:false,chainSection:'assets',recordsHtml:()=>'',icon:()=>''};
 vm.createContext(scope);vm.runInContext(part('function localWalletName(','\nfunction recordsHtml('),scope);
 assert.doesNotThrow(()=>scope.renderWallet(page));
 assert.match(page.innerHTML,/我的钱包/);assert.match(page.innerHTML,/资产暂不可用/);
 assert.doesNotMatch(page.innerHTML,/storage blocked|undefined/);
});

test('local wallet names are escaped in both the picker and active card, and unavailable classifications have no controls',()=>{
 const name='<img src=x onerror=alert(1)>',wallets=[{id:'one',address:addressA,name,selected:true},{id:'two',address:addressB,name:'第二个钱包',selected:false}];
 const list=walletManagementHTML(wallets);
 assert.match(list,/&lt;img/);assert.doesNotMatch(list,/<img/);
 assert.match(list,/data-select-wallet="one" aria-current="true" disabled/);
 assert.match(list,/data-select-wallet="two"/);
 const home=walletHomeHTML({state:{exists:true,address:addressA},network:{name:'BSC 测试网',symbol:'tBNB'},amount:'—',walletName:name});
 assert.match(home,/&lt;img/);assert.doesNotMatch(home,/<img|data-action="chain-(?:defi|nft|authorizations)"|data-action="exchange"/);
 assert.match(home,/data-action="chain-assets"/);assert.match(home,/data-action="chain-bills"/);
});

function backupHarness(){
 const pending=deferred(),originalSetup={additional:true},cleanup=()=>{},phrase='one two three four five six seven eight nine ten eleven twelve';
 const form={isConnected:true,elements:{word3:{value:'three'},word7:{value:'seven'},word11:{value:'eleven'}}};
 let run,finished=0,committed=0;
 const scope={backupPhrase:phrase,walletSetupContext:originalSetup,dialog:{open:true},modalCleanup:cleanup,icon:()=>'',wallet:{commitWallet(){committed++;return pending.promise;}},showModal(_title,_html,setup){setup({querySelector:()=>form});},formError(message){throw Error(String(message));},cancelWalletSetup(){},busyForm(_form,job){run=job();},finishWalletSetup(){finished++;}};
 vm.createContext(scope);vm.runInContext(part('function verifyBackup(','\nfunction restoreModal('),scope);scope.verifyBackup();
 return {scope,form,pending,cleanup,submit(){form.onsubmit({preventDefault(){},target:form});return run;},counts:()=>({finished,committed})};
}

test('backup verification waits for asynchronous encrypted commit before announcing success',async()=>{
 const app=backupHarness(),done=app.submit();
 assert.deepEqual(app.counts(),{finished:0,committed:1});
 app.pending.resolve();await done;
 assert.deepEqual(app.counts(),{finished:1,committed:1});assert.equal(app.scope.backupPhrase,'');assert.equal(app.scope.modalCleanup,null);
});

test('late commit after a closed backup dialog cannot finish setup or close the next dialog',async()=>{
 const app=backupHarness(),done=app.submit();
 app.form.isConnected=false;app.scope.dialog.open=false;app.scope.backupPhrase='another pending setup';
 app.pending.resolve();await done;
 assert.equal(app.counts().finished,0);assert.equal(app.scope.backupPhrase,'another pending setup');assert.equal(app.scope.modalCleanup,app.cleanup);
});

test('late commit from a replaced setup cannot consume its successor context or clear successor backup words',async()=>{
 const app=backupHarness(),done=app.submit(),replacement={additional:false};
 app.scope.walletSetupContext=replacement;app.scope.backupPhrase='successor words';
 app.pending.resolve();await done;
 assert.equal(app.counts().finished,0);assert.equal(app.scope.walletSetupContext,replacement);assert.equal(app.scope.backupPhrase,'successor words');assert.equal(app.scope.modalCleanup,app.cleanup);
});

test('a rejected encrypted commit does not report wallet creation success',async()=>{
 const app=backupHarness(),done=app.submit();app.pending.reject(Error('encrypted storage failed'));
 await assert.rejects(done,/encrypted storage failed/);assert.equal(app.counts().finished,0);assert.notEqual(app.scope.backupPhrase,'');assert.equal(app.scope.modalCleanup,app.cleanup);
});

function pickerHarness(){
 const pending=deferred(),error={textContent:''},button={disabled:false,dataset:{walletChain:'97'}};
 let handler,calls=0,changed=0;
 const root={innerHTML:'',querySelector:()=>error,addEventListener(_name,fn){handler=fn;},removeEventListener(_name,fn){if(handler===fn)handler=null;}};
 const cleanup=mountNetworkPicker(root,{wallet:{NETWORK:{chainId:1},getNetworks:()=>[{chainId:97,name:'BSC 测试网',symbol:'tBNB',enabled:true}],setNetwork(id){assert.equal(id,97);calls++;return pending.promise;}},onChanged:()=>changed++});
 return {pending,button,error,cleanup,click:()=>handler({target:{closest:()=>button}}),counts:()=>({calls,changed}),currentHandler:()=>handler};
}

test('network picker waits for a successful async selection and rejects duplicate clicks while pending',async()=>{
 const picker=pickerHarness(),done=picker.click();await picker.click();
 assert.deepEqual(picker.counts(),{calls:1,changed:0});assert.equal(picker.button.disabled,true);
 picker.pending.resolve();await done;assert.deepEqual(picker.counts(),{calls:1,changed:1});picker.cleanup();
});

test('unmounted network picker ignores a late successful selection callback',async()=>{
 const picker=pickerHarness(),done=picker.click();picker.cleanup();picker.pending.resolve();await done;
 assert.deepEqual(picker.counts(),{calls:1,changed:0});assert.equal(picker.currentHandler(),null);
});

test('unmounted network picker does not overwrite a newer dialog with a late error',async()=>{
 const picker=pickerHarness(),done=picker.click();picker.cleanup();picker.error.textContent='successor dialog';picker.pending.reject(Error('selection failed'));await done;
 assert.equal(picker.error.textContent,'successor dialog');assert.equal(picker.counts().changed,0);
});

test('active network picker shows an async failure and allows a manual retry',async()=>{
 const picker=pickerHarness(),done=picker.click();picker.pending.reject(Error('selection failed'));await done;
 assert.equal(picker.error.textContent,'selection failed');assert.equal(picker.button.disabled,false);assert.equal(picker.counts().changed,0);picker.cleanup();
});

test('late asset read from wallet A cannot replace B values or clear B in-flight loading state',async()=>{
 const first=deferred(),second=deferred(),promises=[first.promise,second.promise];let selected=addressA,recordRefreshes=0,rendered=0;
 const scope={walletRefreshRun:0,balance:null,balanceError:'',loadingBalance:false,hideBalance:false,currentView:'wallet',document:{querySelector:()=>({})},state:()=>({exists:true,address:selected}),wallet:{NETWORK:{chainId:97},getBalance:()=>promises.shift(),refreshRecords:async()=>recordRefreshes++},walletProblem:()=>{},toast:()=>{},renderWallet:()=>rendered++};
 vm.createContext(scope);
 vm.runInContext(part('function resetWalletDisplay(','\nfunction localWalletName(')+part('async function refreshBalance(','\nfunction showModal('),scope);
 const old=scope.refreshBalance();selected=addressB;scope.resetWalletDisplay();const current=scope.refreshBalance();
 first.resolve('99');await old;assert.equal(scope.balance,null);assert.equal(scope.loadingBalance,true);assert.equal(recordRefreshes,0);
 second.resolve('3');await current;assert.equal(scope.balance,'3');assert.equal(scope.loadingBalance,false);assert.equal(recordRefreshes,1);assert.equal(scope.hideBalance,true);assert.ok(rendered>=2);
});

test('late failed asset read from A cannot replace B successful state with an error',async()=>{
 const first=deferred(),second=deferred(),promises=[first.promise,second.promise];let selected=addressA;
 const scope={walletRefreshRun:0,balance:null,balanceError:'',loadingBalance:false,hideBalance:false,currentView:'wallet',document:{querySelector:()=>({})},state:()=>({exists:true,address:selected}),wallet:{NETWORK:{chainId:97},getBalance:()=>promises.shift(),refreshRecords:async()=>{}},walletProblem:()=>{},toast:()=>{},renderWallet:()=>{}};
 vm.createContext(scope);
 vm.runInContext(part('function resetWalletDisplay(','\nfunction localWalletName(')+part('async function refreshBalance(','\nfunction showModal('),scope);
 const old=scope.refreshBalance();selected=addressB;scope.resetWalletDisplay();const current=scope.refreshBalance();
 second.resolve('7');await current;first.reject(Error('old wallet network failed'));await old;
 assert.equal(scope.balance,'7');assert.equal(scope.balanceError,'');assert.equal(scope.loadingBalance,false);
});
