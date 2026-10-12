import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {AccountElement} from './helpers/account-dom.mjs';
import {createWalletAddressBook} from '../src/wallet-address-book.js';
import {mountWalletAddressBook} from '../src/wallet-address-book-ui.js';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const transferSource=source.slice(source.indexOf('function openTransfer('),source.indexOf('\nfunction ',source.indexOf('function openTransfer(')+1));
const address='0x1111111111111111111111111111111111111111';
const otherAddress='0x2222222222222222222222222222222222222222';
// Exercise the actual modal and address-book components against parsed form
// controls. Only wallet side effects are substituted by observable test doubles.
AccountElement.prototype.addEventListener=function(type,handler){(this.handlers??={})[type]=handler;};
AccountElement.prototype.emit=function(type,event={}){return this.handlers?.[type]?.({preventDefault(){},target:this,...event});};
AccountElement.prototype.focus=function(){this.focusCount=(this.focusCount||0)+1;};
function transferFixture({status={exists:true,unlocked:true},prepare}={}){
 const dialog=new AccountElement('dialog'),stored=new Map(),listeners=new Map(),prepared=[],signed=[],confirmed=[],mounts=[];
 let resume,pending,disposed=0,canceled=0,nextId=0;
 const book=createWalletAddressBook({storage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)},makeId:()=>String(++nextId),locks:{request:async(_name,_options,job)=>job()}});
 const query=dialog.querySelector.bind(dialog);dialog.querySelector=selector=>query(selector.startsWith('#')?'[id="'+selector.slice(1)+'"]':selector);
 dialog.open=false;dialog.showModal=()=>{dialog.open=true};dialog.close=()=>{dialog.open=false};
 const ctx={dialog,modalCleanup:null,backupPhrase:'',walletProblem:()=>false,state:()=>status,beginWalletSetup:fn=>{resume=fn},unlockModal:fn=>{resume=fn},icon:()=>'',esc:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  wallet:{prepareTransfer:async(to,amount)=>{prepared.push({to,amount});return prepare?prepare(to,amount):{id:'prepared-only',to,amount,symbol:'tBNB'}},confirmTransfer:async(...args)=>{signed.push(args)},cancelCreation:()=>{canceled++}},
  mountWalletAddressBook:(root,options)=>{
   mounts.push({root,options});const cleanup=mountWalletAddressBook(root,{...options,book,events:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name)}}});
   return()=>{disposed++;cleanup()};
  },confirmTransferModal:tx=>{confirmed.push(tx);ctx.showModal('核对转账','<p>等待用户核对和输入钱包密码</p>')},
 };
 vm.createContext(ctx);
 // showModal/closeModal/clearModal are each one-line functions; include the real
 // busyForm error/finally behavior without app-wide event wiring.
 const modalSource=['showModal','closeModal','clearModal','formError','busyForm'].map(name=>source.split('\n').find(line=>line.startsWith('function '+name+'(')||line.startsWith('async function '+name+'('))).join('\n');
 vm.runInContext(modalSource+'\n'+transferSource,ctx);
 const busy=ctx.busyForm;ctx.busyForm=(...args)=>{pending=busy(...args);return pending};
 return {ctx,dialog,book,prepared,signed,confirmed,mounts,listeners,status,get pending(){return pending},get disposed(){return disposed},get canceled(){return canceled},resume:()=>resume?.(),form:()=>dialog.querySelector('#transfer-form')};
}
test('scanned recipient survives creation then unlock and only prefills the normal form',()=>{
 const f=transferFixture({status:{exists:false,unlocked:false}});
 f.ctx.openTransfer(address);assert.equal(f.form(),null);assert.equal(f.prepared.length,0);assert.equal(f.mounts.length,0);
 f.status.exists=true;f.resume();assert.equal(f.form(),null);
 f.status.unlocked=true;f.resume();assert.equal(f.form().elements.to.value,address);assert.equal(f.form().elements.amount.value,'');
 assert.equal(f.prepared.length,0);assert.equal(f.signed.length,0);assert.equal(f.mounts.length,1);f.ctx.closeModal();
});
test('a plain transfer action never fills its DOM event object as an address',()=>{
 const f=transferFixture();f.ctx.openTransfer({type:'click'});
 assert.equal(f.form().elements.to.value,'');assert.doesNotMatch(f.dialog.html,/object Object/);f.ctx.closeModal();
});
test('choosing a saved public address only fills the recipient, preserves amount and does not prepare or sign',async()=>{
 const f=transferFixture();await f.book.save({name:'收款人',address:otherAddress});f.ctx.openTransfer(address);
 const form=f.form(),picker=f.dialog.querySelector('.wallet-address-picker');form.elements.amount.value='0.012345';picker.open=true;form.querySelector('.form-error').textContent='旧错误';
 f.dialog.querySelector('[data-ab-select]').emit('click');
 assert.equal(form.elements.to.value,otherAddress);assert.equal(form.elements.amount.value,'0.012345');assert.equal(picker.open,false);assert.equal(form.querySelector('.form-error').textContent,'');assert.equal(form.elements.to.focusCount,1);
 assert.deepEqual(f.prepared,[]);assert.deepEqual(f.signed,[]);assert.deepEqual(f.confirmed,[]);assert.equal(f.disposed,0);assert.equal(f.dialog.open,true);f.ctx.closeModal();
});
test('transfer preview requires explicit form submission and cleans the address book without authorizing payment',async()=>{
 const f=transferFixture();await f.book.save({name:'收款人',address:otherAddress});f.ctx.openTransfer();const form=f.form();form.elements.amount.value='0.025';f.dialog.querySelector('[data-ab-select]').emit('click');
 assert.equal(f.prepared.length,0);form.onsubmit({preventDefault(){},target:form});await f.pending;
 assert.deepEqual(f.prepared,[{to:otherAddress,amount:'0.025'}]);assert.equal(f.confirmed.length,1);assert.equal(f.confirmed[0].to,otherAddress);assert.equal(f.confirmed[0].amount,'0.025');assert.deepEqual(f.signed,[]);
 assert.equal(f.disposed,1);assert.equal(f.listeners.size,0);assert.equal(f.canceled,0);assert.equal(form.isConnected,false);assert.match(f.dialog.html,/等待用户核对和输入钱包密码/);
 f.ctx.closeModal();assert.equal(f.disposed,1);
});
test('closing or replacing the transfer modal releases address-book listeners and ignores old selection callbacks',async()=>{
 for(const replace of [false,true]){
  const f=transferFixture();await f.book.save({name:'收款人',address:otherAddress});f.ctx.openTransfer(address);const form=f.form(),button=f.dialog.querySelector('[data-ab-select]'),onSelect=f.mounts[0].options.onSelect;form.elements.amount.value='0.03';
  assert.equal(f.listeners.size,1);if(replace)f.ctx.showModal('另一个窗口','<p>其他内容</p>');else f.dialog.querySelector('#modal-close').onclick();
  assert.equal(f.disposed,1);assert.equal(f.listeners.size,0);assert.equal(f.canceled,1);assert.equal(form.isConnected,false);
  const after=f.dialog.html;button.emit('click');onSelect(otherAddress);assert.equal(form.elements.to.value,address);assert.equal(form.elements.amount.value,'0.03');assert.equal(f.dialog.html,after);assert.deepEqual(f.prepared,[]);assert.deepEqual(f.signed,[]);
 }
});
test('a preview resolving after the modal closes cannot reopen a confirmation or sign a transaction',async()=>{
 let resolve;const f=transferFixture({prepare:()=>new Promise(done=>{resolve=done})});f.ctx.openTransfer(address);const form=f.form();form.elements.amount.value='0.04';form.onsubmit({preventDefault(){},target:form});
 assert.equal(f.prepared.length,1);f.ctx.closeModal();resolve({id:'late-preview',to:address,amount:'0.04'});await f.pending;
 assert.equal(f.dialog.open,false);assert.equal(f.dialog.html,'');assert.equal(f.disposed,1);assert.equal(f.listeners.size,0);assert.deepEqual(f.confirmed,[]);assert.deepEqual(f.signed,[]);
});
test('scan results look up a valid public account without creating a friendship',async()=>{
 const calls=[];let scanner;
 const ctx={dialog:{open:true},mountQrScanner:(_el,opts)=>{scanner=opts;return()=>{}},showModal:(_t,_h,setup)=>setup({querySelector:()=>({})}),toast:x=>calls.push(['toast',x]),closeModal:()=>calls.push(['close']),openTransfer:to=>calls.push(['transfer',to]),socialClient:{getProfile:()=>({userId:'736281'}),lookup:async id=>{if(id==='827364')return {profile:{userId:id}};throw new Error('没有找到这个 ID');}},navigate:(view,options)=>calls.push(['navigate',view,options])};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function openScan('),source.indexOf('\nfunction mineAction')),ctx);
 ctx.openScan('all');assert.equal(calls.length,0);
 await assert.rejects(scanner.onResult({kind:'friend',id:'lin'}),/无效/);
 await assert.rejects(scanner.onResult({kind:'friend',id:'924681'}),/没有找到/);assert.equal(calls.length,0);
 await scanner.onResult({kind:'friend',id:'827364'});assert.equal(calls.at(-1)[1],'contacts');assert.equal(calls.at(-1)[2].profileId,'827364');
 await scanner.onResult({kind:'address',address});assert.deepEqual(calls.at(-1),['transfer',address]);
 let finish;ctx.socialClient.lookup=()=>new Promise(resolve=>{finish=resolve});const pending=scanner.onResult({kind:'friend',id:'827364'});
 ctx.dialog.open=false;const length=calls.length;finish({profile:{userId:'827364'}});await pending;await scanner.onResult({kind:'address',address});assert.equal(calls.length,length);
});

test('wallet unlock refreshes the visible wallet before continuing a transfer or export',async()=>{
 const events=[];let pending;const form={elements:{password:{value:'synthetic-wallet-password-011'}},reset(){events.push('reset')}};
 const ctx={esc:String,short:String,currentView:'wallet',walletProblem:()=>false,state:()=>({exists:true,unlocked:false}),showModal:(_title,_html,setup)=>setup({querySelector:()=>form}),busyForm:(_form,job)=>{pending=job()},wallet:{unlock:async()=>events.push('unlock')},closeModal:()=>events.push('close'),layout:()=>events.push('layout')};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function unlockModal('),source.indexOf('\nasync function copyAddress')),ctx);
 ctx.unlockModal(()=>events.push('continue'));form.onsubmit({preventDefault(){},target:form});await pending;
 assert.deepEqual(events,['reset','unlock','close','layout','continue']);
});
