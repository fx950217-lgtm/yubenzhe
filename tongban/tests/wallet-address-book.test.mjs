import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletAddressBook,ADDRESS_BOOK_KEY,ADDRESS_BOOK_LOCK} from '../src/wallet-address-book.js';
import {mountWalletAddressBook} from '../src/wallet-address-book-ui.js';
import {AccountElement} from './helpers/account-dom.mjs';
const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40);
function lockManager(){
 const queues=new Map(),calls=[];
 return {calls,async request(name,options,run){
  calls.push({name,...options});const previous=queues.get(name)||Promise.resolve();let release;
  const done=new Promise(resolve=>{release=resolve});queues.set(name,done);await previous;
  try{return await run({name,mode:options.mode});}finally{release();if(queues.get(name)===done)queues.delete(name);}
 }};
}
function fixture(){
 const map=new Map(),locks=lockManager();let next=0;
 const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)},book=createWalletAddressBook({storage,locks,makeId:()=>String(++next)});
 return {map,storage,locks,book};
}
test('address book persists only public fields locally, edits and deletes with revision checks',async()=>{
 const f=fixture();assert.deepEqual(f.book.list(),[]);const first=await f.book.save({name:' 客户 ',address:a,note:'收款用途'});assert.equal(first.name,'客户');
 assert.deepEqual(createWalletAddressBook({storage:f.storage,locks:f.locks}).list(),[first]);
 const second=await f.book.save({name:'新名',address:b},{id:first.id,revision:first.revision});assert.equal(second.revision,2);assert.equal(second.note,'');
 await assert.rejects(()=>f.book.remove(first.id,first.revision),{code:'ADDRESS_BOOK_CHANGED'});await f.book.remove(second.id,second.revision);assert.deepEqual(f.book.list(),[]);
 assert.ok(f.locks.calls.every(call=>call.name===ADDRESS_BOOK_LOCK&&call.mode==='exclusive'));
});
test('rejects malformed, zero, duplicate and mixed-case bad checksum addresses and unexpected private fields',async()=>{
 const {book}=fixture();for(const address of ['hello','0x0','0x'+'0'.repeat(40),'0x52908400098527886E0F7030069857D2E4169Ee7'])await assert.rejects(()=>book.save({name:'地址',address}));
 await book.save({name:'first',address:a});await assert.rejects(()=>book.save({name:'second',address:a}),{code:'ADDRESS_BOOK_DUPLICATE'});
 await assert.rejects(()=>book.save({name:'x',address:b,privateKey:'never store'}),{code:'ADDRESS_BOOK_FIELD'});
 await assert.rejects(()=>book.save({name:' ',address:b}),{code:'ADDRESS_BOOK_FIELD'});await assert.rejects(()=>book.save({name:'x',address:b,note:'bad\nline'}),{code:'ADDRESS_BOOK_FIELD'});
});
test('corrupt stored content is retained and blocks all overwriting operations',async()=>{
 const f=fixture();for(const raw of ['broken','{}',JSON.stringify({version:1,entries:[{id:'1',name:'x',address:a,note:'',revision:1,seed:'secret'}]})]){
  f.map.set(ADDRESS_BOOK_KEY,raw);assert.throws(()=>f.book.list(),{code:'ADDRESS_BOOK_CORRUPT'});await assert.rejects(()=>f.book.save({name:'x',address:b}),{code:'ADDRESS_BOOK_CORRUPT'});assert.equal(f.map.get(ADDRESS_BOOK_KEY),raw);
 }
});
test('failed persistent writes do not announce a saved entry or overwrite an existing one',async()=>{
 const f=fixture(),row=await f.book.save({name:'first',address:a});f.storage.setItem=()=>{throw Error('full');};
 await assert.rejects(()=>f.book.save({name:'second',address:b}),{code:'ADDRESS_BOOK_STORAGE'});assert.deepEqual(f.book.list(),[row]);
});
test('stale edits cannot overwrite an entry changed in another window',async()=>{
 const {book}=fixture(),row=await book.save({name:'first',address:a});await book.save({name:'new',address:a},{id:row.id,revision:row.revision});
 await assert.rejects(()=>book.save({name:'old',address:b},{id:row.id,revision:row.revision}),{code:'ADDRESS_BOOK_CHANGED'});assert.equal(book.list()[0].name,'new');
});
test('every mutation preserves corrupt raw data including duplicate identities, invalid revisions and unknown public schema',async()=>{
 const f=fixture(),valid={id:'one',name:'公开地址',address:a,note:'',revision:1};
 for(const data of [
  {version:1,entries:[valid,valid]},
  {version:1,entries:[valid,{...valid,id:'two'}]},
  {version:1,entries:[{...valid,revision:Number.MAX_SAFE_INTEGER+1}]},
  {version:1,entries:[{...valid,address:'not an address'}]},
  {version:1,entries:[valid],password:'never accept'},
  {version:2,entries:[valid]},
 ]){
  const raw=JSON.stringify(data);f.map.set(ADDRESS_BOOK_KEY,raw);
  await assert.rejects(()=>f.book.remove('one',1),{code:'ADDRESS_BOOK_CORRUPT'});
  await assert.rejects(()=>f.book.save({name:'更新',address:b},{id:'one',revision:1}),{code:'ADDRESS_BOOK_CORRUPT'});
  assert.equal(f.map.get(ADDRESS_BOOK_KEY),raw);
 }
});
test('maximum safe revision cannot overflow into unreadable persistent data',async()=>{
 const f=fixture(),entry={id:'one',name:'公开地址',address:a,note:'',revision:Number.MAX_SAFE_INTEGER},raw=JSON.stringify({version:1,entries:[entry]});f.map.set(ADDRESS_BOOK_KEY,raw);
 await assert.rejects(()=>f.book.save({name:'修改',address:b},{id:entry.id,revision:entry.revision}),{code:'ADDRESS_BOOK_LIMIT'});
 assert.equal(f.map.get(ADDRESS_BOOK_KEY),raw);assert.deepEqual(f.book.list(),[entry]);
});
test('failed storage reads never initialize an empty book or invoke persistence',async()=>{
 let writes=0;const book=createWalletAddressBook({locks:lockManager(),storage:{getItem(){throw Error('denied')},setItem(){writes++}}});
 assert.throws(()=>book.list(),{code:'ADDRESS_BOOK_STORAGE'});await assert.rejects(()=>book.save({name:'新地址',address:a}),{code:'ADDRESS_BOOK_STORAGE'});await assert.rejects(()=>book.remove('one',1),{code:'ADDRESS_BOOK_STORAGE'});assert.equal(writes,0);
});
test('two instances sharing storage serialize entire mutations and retain simultaneous additions',async()=>{
 const f=fixture(),second=createWalletAddressBook({storage:f.storage,locks:f.locks,makeId:()=> 'second-tab'});
 const rows=await Promise.all([f.book.save({name:'first',address:a}),second.save({name:'second',address:b})]);
 assert.equal(rows.length,2);assert.deepEqual(f.book.list().map(row=>row.address).sort(),[a,b]);assert.deepEqual(second.list(),f.book.list());
});
test('competing edit/delete operations revalidate inside the lock and never silently overwrite each other',async()=>{
 const f=fixture(),row=await f.book.save({name:'first',address:a}),second=createWalletAddressBook({storage:f.storage,locks:f.locks});
 const results=await Promise.allSettled([f.book.save({name:'new',address:b},{id:row.id,revision:1}),second.remove(row.id,1)]);
 assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);assert.equal(results[1].reason.code,'ADDRESS_BOOK_CHANGED');assert.equal(f.book.list()[0].address,b);
});
test('a lock request failure cannot mutate storage, and unsupported environments are explicitly read only',async()=>{
 const f=fixture(),row=await f.book.save({name:'first',address:a}),raw=f.map.get(ADDRESS_BOOK_KEY);
 for(const locks of [null,{}, {request:async()=>{throw Error('lock unavailable')}}]){
  const book=createWalletAddressBook({storage:f.storage,locks});assert.deepEqual(book.list(),[row]);
  await assert.rejects(()=>book.save({name:'new',address:b}));await assert.rejects(()=>book.remove(row.id,1));assert.equal(f.map.get(ADDRESS_BOOK_KEY),raw);
  assert.equal(book.isWritable(),typeof locks?.request==='function');
 }
});
AccountElement.prototype.addEventListener=function(type,handler){(this.handlers??={})[type]=handler;};
AccountElement.prototype.emit=function(type,event={}){return this.handlers?.[type]?.({preventDefault(){},target:this,...event});};
function ui(book,onSelect){const root=new AccountElement(),listeners=new Map(),events={addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:(k,v)=>{if(listeners.get(k)===v)listeners.delete(k);}},cleanup=mountWalletAddressBook(root,{book,onSelect,events});return {root,listeners,cleanup};}
test('UI escapes saved names/notes and selection only supplies a public address; cleanup disables selection',async()=>{
 const {book}=fixture();await book.save({name:'<img src=x>',address:a,note:'<script>x</script>'});let selected=[];
 const {root,cleanup}=ui(book,address=>selected.push(address));assert.match(root.html,/&lt;img/);assert.doesNotMatch(root.html,/<img|<script/);
 const button=root.querySelector('[data-ab-select]');button.emit('click');assert.deepEqual(selected,[a]);cleanup();button.emit('click');assert.equal(selected.length,1);
});
test('UI creates, edits and explicitly confirms removal without any network operation',async()=>{
 const {book}=fixture(),{root,cleanup}=ui(book);root.querySelector('[data-ab-add]').emit('click');let form=root.querySelector('form');form.elements.name.value='朋友';form.elements.address.value=a;await form.emit('submit');assert.equal(book.list().length,1);
 root.querySelector('[data-ab-edit]').emit('click');form=root.querySelector('form');form.elements.name.value='同事';await form.emit('submit');assert.equal(book.list()[0].name,'同事');
 root.querySelector('[data-ab-confirm]').emit('click');assert.equal(book.list().length,1);await root.querySelector('[data-ab-delete]').emit('click');assert.equal(book.list().length,0);cleanup();
});
test('UI storage errors preserve entries and edited input; cross-window changes require re-selection',async()=>{
 const f=fixture(),row=await f.book.save({name:'朋友',address:a});const {root,listeners,cleanup}=ui(f.book);
 root.querySelector('[data-ab-edit]').emit('click');await f.book.save({name:'changed',address:b},{id:row.id,revision:row.revision});const form=root.querySelector('form');form.elements.name.value='draft';await form.emit('submit');assert.match(root.html,/记录已改变/);assert.equal(root.querySelector('form').elements.name.value,'draft');
 listeners.get('storage')({key:ADDRESS_BOOK_KEY});assert.equal(root.querySelector('form'),null);assert.match(root.html,/其他窗口更新/);cleanup();assert.equal(listeners.size,0);
});
test('a stale selected address changed or deleted in another tab is never passed to the transfer form',async()=>{
 for(const mutation of ['change','delete']){
  const {book}=fixture(),row=await book.save({name:'收款人',address:a}),selected=[],{root,cleanup}=ui(book,value=>selected.push(value)),oldButton=root.querySelector('[data-ab-select]');
  if(mutation==='delete')await book.remove(row.id,row.revision);else await book.save({name:'收款人',address:b},{id:row.id,revision:row.revision});
  oldButton.emit('click');assert.deepEqual(selected,[]);assert.match(root.html,/地址记录已改变，请重新选择/);cleanup();
 }
});
test('delete requires the originally displayed revision and cannot remove a concurrently edited record',async()=>{
 const {book}=fixture(),row=await book.save({name:'收款人',address:a}),{root,cleanup}=ui(book);root.querySelector('[data-ab-confirm]').emit('click');const button=root.querySelector('[data-ab-delete]');
 await book.save({name:'新的收款人',address:b},{id:row.id,revision:row.revision});await button.emit('click');assert.equal(book.list().length,1);assert.equal(book.list()[0].address,b);assert.match(root.html,/记录已改变/);cleanup();
});
test('an unreadable book has no add, edit, delete or select action and leaves raw data intact',()=>{
 const f=fixture();f.map.set(ADDRESS_BOOK_KEY,'malformed');const {root,cleanup}=ui(f.book);assert.match(root.html,/原有记录已保留，未覆盖/);
 for(const selector of ['[data-ab-add]','[data-ab-edit]','[data-ab-select]','[data-ab-delete]'])assert.equal(root.querySelector(selector),null);
 assert.equal(f.map.get(ADDRESS_BOOK_KEY),'malformed');cleanup();
});
test('editing escapes quotes in input values and a rejected write retains the user draft',async()=>{
 const f=fixture();await f.book.save({name:'x" onfocus="alert(1)',address:a,note:"<img src=x onerror='alert(1)'>"});const {root,cleanup}=ui(f.book);root.querySelector('[data-ab-edit]').emit('click');
 assert.match(root.html,/x&quot;/);assert.doesNotMatch(root.html,/value="x" onfocus|<img/);
 const form=root.querySelector('form');form.elements.name.value='未保存的修改';f.storage.setItem=()=>{throw Error('full')};await form.emit('submit');assert.match(root.html,/地址簿未保存/);assert.equal(root.querySelector('form').elements.name.value,'未保存的修改');assert.equal(f.book.list()[0].name,'x" onfocus="alert(1)');cleanup();
});
test('readonly UI permits selection but never exposes mutation buttons and explains manual transfer fallback',async()=>{
 const f=fixture();await f.book.save({name:'收款人',address:a});const book=createWalletAddressBook({storage:f.storage,locks:null}),selected=[],{root,cleanup}=ui(book,address=>selected.push(address));
 assert.match(root.html,/当前设备暂不支持安全保存地址簿/);assert.match(root.html,/手动填写收款地址/);
 for(const selector of ['[data-ab-add]','[data-ab-edit]','[data-ab-confirm]','[data-ab-delete]','form'])assert.equal(root.querySelector(selector),null);
 root.querySelector('[data-ab-select]').emit('click');assert.deepEqual(selected,[a]);cleanup();
});
test('pending save rejects duplicate submits, retains inputs, and a closed view never renders a late result',async()=>{
 const f=fixture();let release;const held=f.locks.request(ADDRESS_BOOK_LOCK,{mode:'exclusive'},()=>new Promise(resolve=>{release=resolve}));await Promise.resolve();
 const {root,cleanup}=ui(f.book);root.querySelector('[data-ab-add]').emit('click');const form=root.querySelector('form');form.elements.name.value='朋友';form.elements.address.value=a;
 const pending=form.emit('submit');assert.match(root.html,/aria-busy="true"/);assert.match(root.html,/正在保存/);assert.equal(root.querySelector('form').elements.name.value,'朋友');
 await form.emit('submit');assert.equal(f.locks.calls.length,2);assert.equal(f.book.list().length,0);
 cleanup();const detached=root.html;release();await held;await pending;assert.equal(f.book.list().length,1);assert.equal(root.html,detached);
});
test('pending deletion is serialized, cannot be double submitted, and does not reopen a detached view',async()=>{
 const f=fixture();await f.book.save({name:'朋友',address:a});let release;const held=f.locks.request(ADDRESS_BOOK_LOCK,{mode:'exclusive'},()=>new Promise(resolve=>{release=resolve}));await Promise.resolve();
 const {root,cleanup}=ui(f.book);root.querySelector('[data-ab-confirm]').emit('click');const button=root.querySelector('[data-ab-delete]'),pending=button.emit('click');
 assert.match(root.html,/aria-busy="true"/);await button.emit('click');assert.equal(f.locks.calls.length,3);assert.equal(f.book.list().length,1);
 cleanup();const detached=root.html;release();await held;await pending;assert.equal(f.book.list().length,0);assert.equal(root.html,detached);
});
