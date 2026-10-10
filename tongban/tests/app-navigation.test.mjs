import test from 'node:test';
import assert from 'node:assert/strict';
import {MAIN_NAV,WORKBENCH_FEATURES,viewFromHash,hashForView,navigationFromHash,normalizeNavigation,activeNavView,isAppView} from '../src/app-navigation.js';
test('five tabs keep Workspace first and Wallet third with legacy bookmarks',()=>{
 assert.deepEqual(MAIN_NAV.map(x=>x[2]),['工作台','消息','钱包','发现','我的']);
 assert.equal(viewFromHash('#mine/assets'),'wallet');assert.equal(viewFromHash('#wallet'),'wallet');
 assert.equal(hashForView('wallet'),'#wallet');assert.equal(activeNavView('wallet'),'wallet');assert.equal(viewFromHash('#contacts'),'contacts');assert.equal(activeNavView('contacts'),'messages');
 assert.equal(isAppView('wallet'),true);
});
test('bill return keeps the correct parent tab and unknown routes stay safe',()=>{
 assert.equal(activeNavView('bills','wallet'),'wallet');assert.equal(activeNavView('bills','messages'),'messages');
 assert.equal(viewFromHash('#bogus'),'workbench');assert.equal(hashForView('bogus'),'#workbench');
 for(const [id] of MAIN_NAV)assert.equal(viewFromHash(hashForView(id)),id);
});

test('points moves to workbench and existing Mine bookmarks remain usable',()=>{assert.equal(viewFromHash(''),'workbench');assert.equal(viewFromHash('#mine/points'),'points');assert.equal(viewFromHash('#workbench/points'),'points');assert.equal(hashForView('points'),'#workbench/points');assert.equal(activeNavView('points'),'workbench');});
test('business entry links and legacy discovery links resolve to the same workbench feature',()=>{
 for(const route of WORKBENCH_FEATURES){
  const target={view:'workbench',options:{route}};
  assert.deepEqual(normalizeNavigation('discover',{route}),target);
  assert.deepEqual(navigationFromHash('#discover/'+route),target);
  assert.deepEqual(navigationFromHash(hashForView(target.view,target.options)),target);
  assert.equal(activeNavView(target.view),'workbench');
 }
});
test('favorites bookmarks retain their Mine or Discover parent after refresh',()=>{
 for(const origin of ['mine','discover'])for(const route of ['favorites','drafts']){
  const target=normalizeNavigation('discover',{route,origin});
  assert.deepEqual(navigationFromHash(hashForView(target.view,target.options)),target);
  assert.equal(activeNavView(target.view,'mine',target.options),origin);
 }
});
test('workbench detail and chat pages restore from their own URL',()=>{
 for(const hub of [{mode:'work',screen:'home',selected:null},{mode:'work',screen:'workflows',selected:null},{mode:'work',screen:'detail',selected:'orders'},{mode:'work',screen:'tasks',selected:null},{mode:'chat',screen:'home',selected:null},{mode:'chat',screen:'chat-local',selected:null}]){
  const target={view:'workbench',options:{hub}};
  assert.deepEqual(navigationFromHash(hashForView(target.view,target.options)),target);
 }
});
test('untrusted subroutes cannot create arbitrary feature screens',()=>{
 for(const route of ['__proto__','constructor','<script>','http://other/'])assert.equal(hashForView('workbench',{route}),'#workbench');
 assert.equal(hashForView('workbench',{hub:{mode:'work',screen:'detail',selected:'<script>'}}),'#workbench/workflows');
 assert.equal(hashForView('workbench',{hub:{mode:'chat',screen:'creator'}}),'#workbench/chat');
});
