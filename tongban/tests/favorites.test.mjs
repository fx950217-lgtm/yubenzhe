import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavoritesStore, createFavoritesFeature, validateFavoriteInput } from '../src/favorites.js';
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),data};};
const key='tongban.favorites.v1';

test('favorites save actual text and links, survive reopening, and never change legacy drafts',()=>{
  const local=storage();local.setItem('tongban.discover.v1','original drafts');
  const store=createFavoritesStore(local);assert.deepEqual(store.list(),[]);assert.equal(local.getItem(key),null);
  const text=store.add({kind:'text',title:'  会议  ',content:'保存会议笔记'});
  const link=store.add({kind:'link',content:'https://example.test/a?q=1'});
  assert.equal(text.title,'会议');assert.equal(createFavoritesStore(local).list().length,2);
  store.list()[0].content='changed detached result';assert.notEqual(store.list()[0].content,'changed detached result');
  store.remove(text.id);assert.deepEqual(createFavoritesStore(local).list().map(row=>row.id),[link.id]);
  assert.equal(local.getItem('tongban.discover.v1'),'original drafts');
});

test('favorite links reject script schemes, credentials, malformed addresses and controls',()=>{
  for(const content of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','file:///c:/secret','//example.test','https://user:password@example.test/','https://example.test/\nsecret'])assert.throws(()=>validateFavoriteInput({kind:'link',content}));
  assert.equal(validateFavoriteInput({kind:'link',content:'http://example.test'}).content,'http://example.test/');
  assert.throws(()=>validateFavoriteInput({kind:'text',content:''}));
  assert.throws(()=>validateFavoriteInput({kind:'text',content:'x'.repeat(4001)}));
});

test('stale tabs and quota failures cannot erase another page or report a saved change',()=>{
  const local=storage(),first=createFavoritesStore(local),stale=createFavoritesStore(local);
  first.add({kind:'text',content:'第一个页面'});const before=local.getItem(key);
  assert.throws(()=>stale.add({kind:'text',content:'第二个页面'}),/另一个页面/);assert.equal(local.getItem(key),before);assert.deepEqual(stale.list(),[]);
  const blocked=createFavoritesStore({getItem:()=>null,setItem(){throw new Error('quota')}});
  assert.throws(()=>blocked.add({kind:'text',content:'不能丢失'}),/没有保存/);assert.deepEqual(blocked.list(),[]);
});

test('corrupt and oversized storage is preserved rather than silently overwritten',()=>{
  const local=storage();for(const value of ['{bad',JSON.stringify({version:2,entries:[]}),JSON.stringify({version:1,entries:[{id:'x',kind:'link',content:'javascript:alert(1)',createdAt:1}]})]){
    local.setItem(key,value);assert.throws(()=>createFavoritesStore(local));assert.equal(local.getItem(key),value);
  }
  local.setItem(key,JSON.stringify({version:1,entries:Array.from({length:200},(_,i)=>({id:String(i),kind:'text',title:'',content:'已保存',createdAt:i}))}));
  const full=createFavoritesStore(local),before=local.getItem(key);assert.throws(()=>full.add({kind:'text',content:'更多'}),/200/);assert.equal(local.getItem(key),before);
});

test('favorites markup escapes all user content and external links are isolated',()=>{
  const local=storage(),store=createFavoritesStore(local);
  store.add({kind:'text',title:'<img src=x onerror=alert(1)>',content:'<script>alert(1)</script>'});
  store.add({kind:'link',content:'https://example.test/?q="<&'});
  const feature=createFavoritesFeature({storage:local,getLegacySaved:()=>[],render(){}}),html=feature.render();
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/target="_blank" rel="noopener noreferrer"/);
  assert.match(html,/历史草稿/);assert.match(html,/本机/);
});

test('save failures leave entered form data visible with an actionable error',()=>{
  const local=storage();let listener,closed=false,message='',rerenders=0;
  const form={elements:{kind:{value:'text'},title:{value:'继续保留'},content:{value:'未保存的输入'}},addEventListener(name,cb){listener=cb},querySelector(){return {set textContent(value){message=value}}}};
  const feature=createFavoritesFeature({storage:local,showDialog(title,html,setup){setup({querySelector:()=>form})},closeDialog(){closed=true},render(){rerenders++},toast(){}});
  feature.handleAction('favorite-add',{});
  createFavoritesStore(local).add({kind:'text',content:'另一个页面'});
  listener({preventDefault(){}});
  assert.equal(closed,false);assert.match(message,/另一个页面/);assert.equal(form.elements.content.value,'未保存的输入');assert.equal(rerenders,0);
});
