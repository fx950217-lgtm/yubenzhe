import test from 'node:test';
import assert from 'node:assert/strict';
import { mountWalletImport, mountWatchWallets } from '../src/wallet-import-ui.js';
import * as realWallet from '../src/wallet.js';

const PHRASE='test test test test test test test test test test test junk';
const ADDRESS='0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const KEY='0x'+'0'.repeat(63)+'1';
const KEY_ADDRESS='0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
const PASSWORD='synthetic-wallet-ui-84269';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const unescape=value=>String(value??'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function attrs(source){return Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match=>[match[1],unescape(match[2]??'')]));}
function node(properties={}){return {isConnected:true,disabled:false,textContent:'',hidden:false,checked:false,value:'',files:[],...properties};}
// Minimal DOM event surface like the existing mine tests. Nodes are created from
// the rendered HTML rather than predicting which mode or lifecycle the UI uses.
function containerDOM(){
 const root={nodes:[],rows:[],tabs:[],form:null,html:'',replaceChildren(){this.innerHTML='';},querySelector(selector){if(selector==='form')return this.form;return null;},querySelectorAll(selector){if(selector==='[data-import-mode]')return this.tabs;if(selector==='[data-watch-address]')return this.rows;return [];}};
 Object.defineProperty(root,'innerHTML',{get(){return this.html;},set(html){
  for(const old of this.nodes)old.isConnected=false;
  this.html=html;this.nodes=[];this.rows=[];this.tabs=[];this.form=null;
  const add=properties=>{const value=node(properties);this.nodes.push(value);return value;};
  for(const match of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)){const a=attrs(match[1]);if(a['data-import-mode'])this.tabs.push(add({dataset:{importMode:a['data-import-mode']},textContent:unescape(match[2])}));}
  const formMatch=/<form([^>]*)>([\s\S]*?)<\/form>/.exec(html);
  if(formMatch){
   const controls=[],elements={},listeners=new Map(),form=add({elements,controls,listeners,attributes:{},setAttribute(key,value){this.attributes[key]=value;},addEventListener(type,handler){listeners.set(type,handler);},reset(){for(const control of controls){control.value=control.defaultValue??'';control.checked=false;control.files=[];}},querySelectorAll(selector){return selector==='input,textarea,button'?controls:[];}});
   const body=formMatch[2];
   for(const match of body.matchAll(/<(input|textarea)([^>]*)>/g)){const a=attrs(match[2]);if(!a.name)continue;const control=add({name:a.name,type:a.type??'text',value:a.value??'',defaultValue:a.value??'',tagName:match[1].toUpperCase()});elements[a.name]=control;controls.push(control);}
   const error=add(),box=add({hidden:/data-import-preview hidden/.test(body)}),address=add(),preview=add({textContent:'核对导入地址'}),submit=add({type:'submit'});controls.push(preview,submit);
   form.error=error;form.box=box;form.derived=address;form.preview=preview;form.submit=submit;
   form.querySelector=selector=>({'.form-error':error,'[data-import-preview]':box,'[data-derived-address]':address,'[data-preview-import]':preview,'[type=submit]':submit}[selector]??null);
   this.form=form;
  }
  for(const match of html.matchAll(/<article[^>]*data-watch-address="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)){
   const status=add({textContent:'余额尚未读取'}),remove=add(),refresh=add(),row=add({dataset:{watchAddress:unescape(match[1])},status,remove,refresh});
   row.querySelector=selector=>({'[role=status]':status,'[data-watch-remove]':remove,'[data-watch-refresh]':refresh}[selector]??null);this.rows.push(row);
  }
 }});
 return root;
}
function mockWallet(overrides={}){
 const calls=[];let cancelled=0,watched=[];
 const base={DEFAULT_DERIVATION_PATH:realWallet.DEFAULT_DERIVATION_PATH,MAX_KEYSTORE_BYTES:realWallet.MAX_KEYSTORE_BYTES,
  previewMnemonic:(...args)=>{calls.push(['previewMnemonic',...args]);return realWallet.previewMnemonic(...args);},
  previewPrivateKey:(...args)=>{calls.push(['previewPrivateKey',...args]);return realWallet.previewPrivateKey(...args);},
  previewKeystore:async(...args)=>{calls.push(['previewKeystore',...args]);return {address:ADDRESS};},
  restoreWallet:async(...args)=>{calls.push(['restoreWallet',...args]);},
  importPrivateKey:async(...args)=>{calls.push(['importPrivateKey',...args]);},
  importKeystore:async(...args)=>{calls.push(['importKeystore',...args]);},
  cancelCreation:()=>{cancelled++;},
  listWatchWallets:()=>watched.map(item=>({...item})),
  addWatchWallet:(address,label)=>{if(address!==ADDRESS)throw new Error('地址无效');watched=[{address,label}];},
  removeWatchWallet:address=>{watched=watched.filter(row=>row.address!==address);},
  getWatchBalance:async()=>'2.5',...overrides};
 return {wallet:base,calls,cancelled:()=>cancelled};
}
function importHarness(overrides={},options={}){
 const root=containerDOM(),mock=mockWallet(overrides);let succeeded=0,cleanup;
 cleanup=mountWalletImport(root,{wallet:mock.wallet,onSuccess(){succeeded++;if(options.cleanupOnSuccess)cleanup();}});
 return {root,...mock,cleanup,succeeded:()=>succeeded,
  mode(name){return root.tabs.find(tab=>tab.dataset.importMode===name).onclick();},
  input(name,value){const form=root.form;form.elements[name].value=value;form.listeners.get('input')?.({target:form.elements[name]});},
  file(file){const form=root.form;form.elements.file.files=file?[file]:[];return form.elements.file.onchange();},
  preview(){return root.form.preview.onclick();},
  submit(){return root.form.onsubmit({preventDefault(){}});},
  confirm(){root.form.elements.confirmed.checked=true;},
 };
}
function fillPassword(h){h.input('password',PASSWORD);h.input('repeat',PASSWORD);}

 test('three import modes call the matching API and retain the exact passphrase/path',async()=>{
  for(const mode of ['mnemonic','private','keystore']){
   const h=importHarness();if(mode!=='mnemonic')h.mode(mode);
   if(mode==='mnemonic'){h.input('phrase',PHRASE);h.input('passphrase',' Exact Case ');h.input('path',"m/44'/60'/0'/0/1");}
   else if(mode==='private')h.input('privateKey',KEY);
   else{await h.file({size:2,text:async()=>'{}'});h.input('sourcePassword','original-file-password');}
   fillPassword(h);await h.preview();assert.equal(h.root.form.box.hidden,false);h.confirm();await h.submit();assert.equal(h.succeeded(),1);
   const call=h.calls.find(row=>row[0]==={mnemonic:'restoreWallet',private:'importPrivateKey',keystore:'importKeystore'}[mode]);assert.ok(call);
   assert.equal(call[mode==='keystore'?3:2],PASSWORD);
   if(mode==='mnemonic'){assert.equal(call[3].passphrase,' Exact Case ');assert.equal(call[3].path,"m/44'/60'/0'/0/1");}
   h.cleanup();
  }
 });

 test('address confirmation, mismatches and password mismatches prevent an import',async()=>{
  const h=importHarness();h.input('phrase',PHRASE);fillPassword(h);await h.submit();assert.match(h.root.form.error.textContent,/核对地址/);
  h.input('expectedAddress',KEY_ADDRESS);await h.preview();assert.equal(h.root.form.box.hidden,true);assert.match(h.root.form.error.textContent,/地址不一致/);
  h.input('expectedAddress',ADDRESS);await h.preview();await h.submit();assert.match(h.root.form.error.textContent,/确认/);
  h.confirm();h.input('repeat','different-password');await h.submit();assert.match(h.root.form.error.textContent,/密码不一致/);
  assert.equal(h.calls.some(row=>row[0]==='restoreWallet'),false);assert.equal(h.root.form.submit.disabled,false);
  h.input('repeat',PASSWORD);assert.equal(h.root.form.box.hidden,false);await h.submit();assert.equal(h.succeeded(),1);h.cleanup();
 });

 test('large, malformed and unreadable keystore files never reach the preview API',async()=>{
  const h=importHarness();h.mode('keystore');let read=0;
  await h.file({size:1024*1024+1,text:async()=>{read++;return '{}';}});assert.match(h.root.form.error.textContent,/1 MB/);assert.equal(read,0);
  for(const file of [{size:2,text:async()=>{throw new Error('disk error');}},{size:1,text:async()=>'{'}]){await h.file(file);assert.match(h.root.form.error.textContent,/无法读取/);await h.preview();assert.match(h.root.form.error.textContent,/有效的 JSON/);}
  assert.equal(h.calls.some(row=>row[0]==='previewKeystore'),false);assert.equal(h.root.form.preview.disabled,false);h.cleanup();
 });

 test('changing address-related input invalidates an in-flight preview without displaying its old result',async()=>{
  const slow=deferred(),h=importHarness({previewKeystore:()=>slow.promise});h.mode('keystore');await h.file({size:2,text:async()=>'{}'});h.input('sourcePassword','old');
  const pending=h.preview();assert.equal(h.root.form.preview.disabled,true);h.input('sourcePassword','changed');slow.resolve({address:ADDRESS});await pending;
  assert.equal(h.root.form.box.hidden,true);assert.equal(h.root.form.preview.disabled,false);assert.equal(h.root.form.derived.textContent,'');
  h.cleanup();
 });

 test('changing expected address, switching tabs and closing suppress stale preview completions',async()=>{
  for(const action of ['address','tab','close']){
   const slow=deferred(),h=importHarness({previewMnemonic:()=>slow.promise});h.input('phrase',PHRASE);const old=h.root.form,pending=h.preview();
   if(action==='address')h.input('expectedAddress',KEY_ADDRESS);else if(action==='tab')h.mode('private');else h.cleanup();
   slow.resolve({address:ADDRESS});await pending;assert.equal(old.box.hidden,true);assert.equal(old.derived.textContent,'');assert.equal(h.succeeded(),0);h.cleanup();
  }
 });

 test('file read completion is tied to the selected file but not to password edits',async()=>{
  const oldRead=deferred(),h=importHarness();h.mode('keystore');const old=h.file({size:2,text:()=>oldRead.promise});
  await h.file({size:7,text:async()=>'{"b":2}'});oldRead.resolve('{"a":1}');await old;
  h.input('sourcePassword','original');await h.preview();assert.equal(h.calls.find(row=>row[0]==='previewKeystore')[1],'{"b":2}');h.cleanup();
  const read=deferred(),other=importHarness();other.mode('keystore');const pending=other.file({size:2,text:()=>read.promise});other.input('sourcePassword','typed while reading');
  read.resolve('{}');await pending;await other.preview();assert.equal(other.calls.find(row=>row[0]==='previewKeystore')[2],'typed while reading');other.cleanup();
 });

 test('import freezes controls and modes, rejects duplicate submit, and successful cleanup does not cancel',async()=>{
  const slow=deferred();let count=0;const h=importHarness({restoreWallet:()=>{count++;return slow.promise;}},{cleanupOnSuccess:true});h.input('phrase',PHRASE);fillPassword(h);await h.preview();h.confirm();
  const pending=h.submit();assert.equal(h.root.form.controls.every(control=>control.disabled),true);assert.equal(h.root.tabs.every(tab=>tab.disabled),true);
  const form=h.root.form;h.mode('private');assert.equal(h.root.form,form);await h.submit();assert.equal(count,1);
  slow.resolve();await pending;assert.equal(h.succeeded(),1);assert.equal(h.cancelled(),0);assert.equal(h.root.form,null);h.cleanup();assert.equal(h.cancelled(),0);
 });

 test('failed import re-enables editing, while closing cancels once and never calls success late',async()=>{
  const failed=importHarness({restoreWallet:async()=>{throw new Error('密码或存储错误');}});failed.input('phrase',PHRASE);fillPassword(failed);await failed.preview();failed.confirm();await failed.submit();
  assert.match(failed.root.form.error.textContent,/存储错误/);assert.equal(failed.root.form.controls.some(control=>control.disabled),false);assert.equal(failed.succeeded(),0);failed.cleanup();
  for(const lateFailure of [false,true]){
   const slow=deferred(),h=importHarness({restoreWallet:()=>slow.promise});h.input('phrase',PHRASE);fillPassword(h);await h.preview();h.confirm();const pending=h.submit();h.cleanup();h.cleanup();
   if(lateFailure)slow.reject(new Error('取消'));else slow.resolve();await pending;assert.equal(h.succeeded(),0);assert.equal(h.cancelled(),1);assert.equal(h.root.form,null);
  }
 });

 test('real wallet import remains unlocked when its success callback cleans up the component',async()=>{
  const data=new Map();globalThis.localStorage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)};realWallet.lock();
  const root=containerDOM();let success=0,cancelled=0,cleanup;
  cleanup=mountWalletImport(root,{wallet:{...realWallet,cancelCreation(){cancelled++;realWallet.cancelCreation();}},onSuccess(){success++;cleanup();}});
  root.form.elements.phrase.value=PHRASE;root.form.elements.password.value=PASSWORD;root.form.elements.repeat.value=PASSWORD;
  await root.form.preview.onclick();root.form.elements.confirmed.checked=true;await root.form.onsubmit({preventDefault(){}});
  assert.equal(success,1);assert.equal(cancelled,0);assert.equal(realWallet.getWalletState().address,ADDRESS);assert.equal(realWallet.getWalletState().unlocked,true);
  assert.equal([...data.values()].join('').includes(PHRASE),false);realWallet.lock();data.clear();
 });

 test('watch address add/remove/refresh handles errors and never provides signing controls',async()=>{
  const root=containerDOM(),mock=mockWallet(),toasts=[];const cleanup=mountWatchWallets(root,{wallet:mock.wallet,toast:value=>toasts.push(value)});
  root.form.elements.address.value='bad';root.form.elements.label.value='冷钱包';root.form.onsubmit({preventDefault(){}});assert.match(root.form.error.textContent,/地址无效/);
  root.form.elements.address.value=ADDRESS;root.form.onsubmit({preventDefault(){}});assert.equal(root.rows.length,1);assert.match(root.innerHTML,/只读/);assert.deepEqual(Object.keys(root.form.elements).sort(),['address','label']);
  let row=root.rows[0];await row.refresh.onclick({currentTarget:row.refresh});assert.equal(row.status.textContent,'2.5 tBNB');assert.equal(row.refresh.disabled,false);
  mock.wallet.getWatchBalance=async()=>{throw new Error('网络不可用');};await row.refresh.onclick({currentTarget:row.refresh});assert.equal(row.status.textContent,'网络不可用');assert.equal(row.refresh.disabled,false);
  row.remove.onclick();assert.equal(root.rows.length,0);assert.equal(toasts.length,2);cleanup();
 });

 test('watch refresh cannot duplicate or repopulate removed/closed rows',async()=>{
  for(const action of ['remove','close']){
   let reads=0;const slow=deferred(),root=containerDOM(),mock=mockWallet({getWatchBalance:()=>{reads++;return slow.promise;}});mock.wallet.addWatchWallet(ADDRESS,'冷钱包');const cleanup=mountWatchWallets(root,{wallet:mock.wallet});
   const row=root.rows[0],pending=row.refresh.onclick({currentTarget:row.refresh});await row.refresh.onclick({currentTarget:row.refresh});assert.equal(reads,1);
   if(action==='remove')row.remove.onclick();else cleanup();slow.resolve('8.0');await pending;assert.equal(row.status.textContent,'正在读取…');assert.equal(root.rows.length,0);cleanup();
  }
 });

 test('watch storage failures remain explicit and preserve the rendered address',()=>{
  const root=containerDOM(),mock=mockWallet();mock.wallet.addWatchWallet(ADDRESS,'冷钱包');mock.wallet.removeWatchWallet=()=>{throw new Error('存储失败');};const toasts=[];
  const cleanup=mountWatchWallets(root,{wallet:mock.wallet,toast:value=>toasts.push(value)});root.rows[0].remove.onclick();assert.equal(root.rows.length,1);assert.deepEqual(toasts,['存储失败']);cleanup();
  const bad=containerDOM();mountWatchWallets(bad,{wallet:mockWallet({listWatchWallets:()=>{throw new Error('观察列表损坏');}}).wallet});assert.match(bad.innerHTML,/观察列表损坏/);
 });
