import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../src/theme-skins.js',import.meta.url),'utf8')).replace(/^export \{[^\n]+\};?$/m,'');
const script=new vm.Script(source,{filename:'theme-skins.js'});
const clone=value=>JSON.parse(JSON.stringify(value));
function environment({saved,readFails=false,writeFails=false,withMeta=true,withComputedStyle=true,systemDark=false,mediaMode='modern'}={}){
 const storage=new Map(saved===undefined?[]:[['ybz-theme',saved]]),writes=[],events=[],listeners=new Map(),root={dataset:{}},meta={attributes:{},setAttribute(name,value){this.attributes[name]=value}};
 let failRead=readFails,failWrite=writeFails;
 const localStorage={getItem:key=>{if(failRead)throw Error('storage unavailable');return storage.get(key)??null},setItem:(key,value)=>{if(failWrite)throw Error('quota exceeded');storage.set(key,value);writes.push([key,value])}};
 const window={dispatchEvent:event=>{events.push({type:event.type,detail:clone(event.detail),dataset:root.dataset.theme,meta:meta.attributes.content});for(const callback of listeners.get(event.type)||[])callback(event);return true},addEventListener:(name,callback)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback)},removeEventListener:(name,callback)=>listeners.set(name,(listeners.get(name)||[]).filter(fn=>fn!==callback))};
 const mediaListeners=new Set(),mediaQuery={matches:systemDark};
 if(mediaMode==='modern'||mediaMode==='modern-fails'){
  mediaQuery.addEventListener=(type,listener)=>{assert.equal(type,'change');if(mediaMode==='modern-fails')throw Error('unsupported');mediaListeners.add(listener)};
  mediaQuery.removeEventListener=(type,listener)=>{assert.equal(type,'change');mediaListeners.delete(listener)};
 }
 if(mediaMode==='legacy'||mediaMode==='modern-fails'){
  mediaQuery.addListener=listener=>mediaListeners.add(listener);mediaQuery.removeListener=listener=>mediaListeners.delete(listener);
 }
 if(mediaMode!=='none')window.matchMedia=query=>{assert.equal(query,'(prefers-color-scheme: dark)');if(mediaMode==='throws')throw Error('unsupported');return mediaQuery};
 const document={documentElement:root,querySelector:selector=>withMeta&&selector==='meta[name="theme-color"]'?meta:null};
 const globals={window,document,localStorage,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},...(withComputedStyle?{getComputedStyle:()=>({getPropertyValue:()=>({light:'  light-background  ',dark:' dark-background ',eyecare:' eyecare-background '})[root.dataset.theme]})}:{})};
 const initialize=()=>script.runInContext(vm.createContext({...globals}));initialize();
 return{get api(){return window.YBZTheme},storage,localStorage,writes,events,listeners,mediaListeners,root,meta,initialize,availability(read,write){failRead=read;failWrite=write},storageEvent(event){for(const listener of listeners.get('storage')||[])listener(event)},systemChange(dark){mediaQuery.matches=dark;for(const listener of [...mediaListeners])listener({matches:dark})}};
}

test('default and invalid stored skins fall back to light without rewriting storage during initialization',()=>{
 for(const saved of [undefined,'unknown','',null,'DARK']){
  const env=environment({saved});assert.equal(env.api.getTheme(),'light');assert.equal(env.root.dataset.theme,'light');assert.equal(env.api.isPersistent(),true);assert.equal(env.writes.length,0);
  assert.equal(env.api.getPreference(),'light');assert.equal(env.meta.attributes.content,'light-background');assert.deepEqual(env.events,[{type:'ybz:theme-changed',detail:{theme:'light',preference:'light',persistent:true},dataset:'light',meta:'light-background'}]);
 }
});

test('switch applies dataset and theme-color before the immediate change event and publishes only the three immutable choices',()=>{
 const env=environment();assert.deepEqual(clone(env.api.THEMES),[{id:'light',label:'白天'},{id:'dark',label:'黑天'},{id:'eyecare',label:'护眼'}]);
 assert.ok(Object.isFrozen(env.api));assert.ok(Object.isFrozen(env.api.THEMES));assert.ok(env.api.THEMES.every(Object.isFrozen));
 for(const id of ['dark','eyecare','light']){
  const before=env.events.length;assert.equal(env.api.setTheme(id),id);assert.equal(env.events.length,before+1);assert.equal(env.api.getTheme(),id);assert.equal(env.root.dataset.theme,id);assert.equal(env.storage.get('ybz-theme'),id);
   assert.deepEqual(env.events.at(-1),{type:'ybz:theme-changed',detail:{theme:id,preference:id,persistent:true},dataset:id,meta:id+'-background'});
 }
 assert.deepEqual(env.writes,[['ybz-theme','dark'],['ybz-theme','eyecare'],['ybz-theme','light']]);
});

test('persisted selection is restored by a new document initialization without requiring a second selection',()=>{
 const first=environment();first.api.setTheme('eyecare');const reopened=environment({saved:first.storage.get('ybz-theme')});
 assert.equal(reopened.api.getTheme(),'eyecare');assert.equal(reopened.root.dataset.theme,'eyecare');assert.equal(reopened.meta.attributes.content,'eyecare-background');assert.equal(reopened.api.isPersistent(),true);assert.deepEqual(reopened.writes,[]);
});

test('storage read failure defaults accurately and a subsequent successful save restores persistent status',()=>{
 const env=environment({saved:'dark',readFails:true});assert.equal(env.api.getTheme(),'light');assert.equal(env.api.isPersistent(),false);assert.equal(env.events.at(-1).detail.persistent,false);
 env.availability(false,false);env.api.setTheme('dark');assert.equal(env.api.getTheme(),'dark');assert.equal(env.api.isPersistent(),true);assert.equal(env.storage.get('ybz-theme'),'dark');assert.equal(env.events.at(-1).detail.persistent,true);
});

test('failed save still switches the live view, reports nonpersistence, and never changes the previous saved value',()=>{
 const env=environment({saved:'light',writeFails:true});assert.equal(env.api.setTheme('dark'),'dark');assert.equal(env.api.getTheme(),'dark');assert.equal(env.root.dataset.theme,'dark');assert.equal(env.meta.attributes.content,'dark-background');assert.equal(env.api.isPersistent(),false);assert.equal(env.storage.get('ybz-theme'),'light');
 assert.deepEqual(env.events.at(-1).detail,{theme:'dark',preference:'dark',persistent:false});assert.deepEqual(env.writes,[]);
 const reopened=environment({saved:env.storage.get('ybz-theme')});assert.equal(reopened.api.getTheme(),'light');
 env.availability(false,false);env.api.setTheme('eyecare');assert.equal(env.api.isPersistent(),true);assert.equal(env.storage.get('ybz-theme'),'eyecare');
});

test('another document storage change syncs theme without writing back or creating an event loop',()=>{
 const env=environment({saved:'light'});const initialEvents=env.events.length;
 env.storageEvent({key:'another-preference',newValue:'dark'});assert.equal(env.events.length,initialEvents);assert.equal(env.api.getTheme(),'light');
 env.storageEvent({key:'ybz-theme',newValue:'dark'});assert.equal(env.api.getTheme(),'dark');assert.equal(env.root.dataset.theme,'dark');assert.equal(env.api.isPersistent(),true);assert.equal(env.events.length,initialEvents+1);
 env.storageEvent({key:'ybz-theme',newValue:'unsupported'});assert.equal(env.api.getTheme(),'light');
 env.storageEvent({key:'ybz-theme',newValue:null});assert.equal(env.api.getTheme(),'light');
 env.api.setTheme('eyecare');const beforeClearWrites=env.writes.length;env.storageEvent({key:null,newValue:null});assert.equal(env.api.getTheme(),'light');assert.equal(env.writes.length,beforeClearWrites);
 assert.equal(env.writes.length,1);
});

test('cycle wraps through all three skins and invalid direct values normalize to the supported default',()=>{
 const env=environment();assert.deepEqual([env.api.cycleTheme(),env.api.cycleTheme(),env.api.cycleTheme()],['dark','eyecare','light']);
 for(const invalid of ['unknown',undefined,{},'']){env.api.setTheme('dark');assert.equal(env.api.setTheme(invalid),'light');assert.equal(env.root.dataset.theme,'light');assert.equal(env.storage.get('ybz-theme'),'light');}
});

test('missing theme-color meta or style inspection does not prevent applying a skin',()=>{
 for(const options of [{withMeta:false},{withComputedStyle:false}]){const env=environment(options);env.api.setTheme('dark');assert.equal(env.api.getTheme(),'dark');assert.equal(env.root.dataset.theme,'dark');assert.deepEqual(env.events.at(-1).detail,{theme:'dark',preference:'dark',persistent:true});}
});

test('document-lifetime storage subscription is registered once and never multiplied by switches',()=>{
 const env=environment();assert.equal(env.listeners.get('storage').length,1);const listener=env.listeners.get('storage')[0];
 for(let i=0;i<12;i++)env.api.cycleTheme();assert.deepEqual(env.listeners.get('storage'),[listener]);
 const before=env.events.length;env.storageEvent({key:'ybz-theme',newValue:'dark'});assert.equal(env.events.length,before+1);
});

test('saved system preference resolves to an actual skin and responds immediately without persisting the resolved color',()=>{
 for(const systemDark of [false,true]){
  const env=environment({saved:'system',systemDark});
  assert.equal(env.api.getPreference(),'system');assert.equal(env.api.getTheme(),systemDark?'dark':'light');assert.equal(env.mediaListeners.size,1);
  env.systemChange(!systemDark);
  const expected=systemDark?'light':'dark';assert.equal(env.api.getTheme(),expected);assert.equal(env.root.dataset.theme,expected);assert.equal(env.meta.attributes.content,expected+'-background');
  assert.deepEqual(env.events.at(-1).detail,{theme:expected,preference:'system',persistent:true});
  assert.equal(env.storage.get('ybz-theme'),'system');assert.deepEqual(env.writes,[]);
 }
});

test('all explicit skins leave system following and ignore even a queued media callback',()=>{
 for(const selected of ['light','dark','eyecare']){
  const env=environment({saved:'system',systemDark:true}),stale=[...env.mediaListeners][0];
  env.api.setTheme(selected);assert.equal(env.api.getPreference(),selected);assert.equal(env.api.getTheme(),selected);assert.equal(env.mediaListeners.size,0);
  const eventCount=env.events.length;env.systemChange(false);stale({matches:true});assert.equal(env.events.length,eventCount);assert.equal(env.api.getTheme(),selected);
  env.api.setTheme('system');assert.equal(env.api.getTheme(),'light');assert.equal(env.api.getPreference(),'system');assert.equal(env.mediaListeners.size,1);
  env.api.setTheme('system');assert.equal(env.mediaListeners.size,1);
 }
});

test('legacy media listeners and modern API failures both retain live follow and cleanly detach',()=>{
 for(const mediaMode of ['legacy','modern-fails']){
  const env=environment({saved:'system',mediaMode});env.systemChange(true);assert.equal(env.api.getTheme(),'dark');assert.equal(env.mediaListeners.size,1);
  env.api.setTheme('eyecare');assert.equal(env.mediaListeners.size,0);env.systemChange(false);assert.equal(env.api.getTheme(),'eyecare');
  env.api.setTheme('system');env.api.cleanup();assert.equal(env.mediaListeners.size,0);assert.equal(env.listeners.get('storage').length,0);
 }
});

test('missing or throwing matchMedia safely falls back to light while retaining the user preference',()=>{
 for(const mediaMode of ['none','throws']){
  const env=environment({saved:'system',mediaMode});assert.equal(env.api.getTheme(),'light');assert.equal(env.api.getPreference(),'system');assert.equal(env.mediaListeners.size,0);
  env.api.setTheme('dark');assert.equal(env.api.getTheme(),'dark');assert.equal(env.api.setTheme('system'),'light');assert.equal(env.storage.get('ybz-theme'),'system');
 }
});

test('failed system save follows live, reports failure after media changes, and leaves the stored manual preference untouched',()=>{
 const env=environment({saved:'eyecare',writeFails:true,systemDark:true});env.api.setTheme('system');
 assert.equal(env.api.getTheme(),'dark');assert.equal(env.api.getPreference(),'system');assert.equal(env.api.isPersistent(),false);assert.equal(env.storage.get('ybz-theme'),'eyecare');
 env.systemChange(false);assert.deepEqual(env.events.at(-1).detail,{theme:'light',preference:'system',persistent:false});
 env.availability(false,false);env.api.setTheme('system');assert.equal(env.api.isPersistent(),true);assert.equal(env.storage.get('ybz-theme'),'system');
 const reopened=environment({saved:env.storage.get('ybz-theme'),systemDark:true});assert.equal(reopened.api.getPreference(),'system');assert.equal(reopened.api.getTheme(),'dark');
});

test('cross-tab system selection resolves locally, clear leaves follow, and sessionStorage events are ignored',()=>{
 const env=environment({saved:'eyecare',systemDark:true});
 env.storageEvent({key:'ybz-theme',newValue:'system',storageArea:{}});assert.equal(env.api.getTheme(),'eyecare');
 env.storageEvent({key:'ybz-theme',newValue:'system',storageArea:env.localStorage});assert.equal(env.api.getPreference(),'system');assert.equal(env.api.getTheme(),'dark');assert.equal(env.mediaListeners.size,1);
 env.systemChange(false);assert.equal(env.api.getTheme(),'light');
 env.storageEvent({key:'ybz-theme',newValue:'eyecare'});assert.equal(env.api.getPreference(),'eyecare');assert.equal(env.mediaListeners.size,0);
 env.storageEvent({key:'ybz-theme',newValue:'system'});env.storageEvent({key:null,newValue:null,storageArea:env.localStorage});assert.equal(env.api.getPreference(),'light');assert.equal(env.mediaListeners.size,0);
 assert.deepEqual(env.writes,[]);
});

test('cleanup removes subscriptions and makes old API and queued events inert; reinitialization retains exactly one controller',()=>{
 const env=environment({saved:'system',systemDark:true}),old=env.api,staleMedia=[...env.mediaListeners][0],staleStorage=env.listeners.get('storage')[0];
 env.initialize();assert.notEqual(env.api,old);assert.equal(env.mediaListeners.size,1);assert.equal(env.listeners.get('storage').length,1);
 const events=env.events.length;old.setTheme('eyecare');old.cycleTheme();staleMedia();staleStorage({key:'ybz-theme',newValue:'eyecare'});assert.equal(env.events.length,events);assert.deepEqual(env.writes,[]);
 env.api.cleanup();env.api.cleanup();assert.equal(env.mediaListeners.size,0);assert.equal(env.listeners.get('storage').length,0);
 env.systemChange(false);env.storageEvent({key:'ybz-theme',newValue:'light'});assert.equal(env.events.length,events);assert.equal(env.root.dataset.theme,'dark');
});

test('legacy cycle selects the next actual skin and explicitly exits system following',()=>{
 const env=environment({saved:'system',systemDark:true});assert.equal(env.api.cycleTheme(),'eyecare');assert.equal(env.api.getPreference(),'eyecare');assert.equal(env.storage.get('ybz-theme'),'eyecare');assert.equal(env.mediaListeners.size,0);
});
