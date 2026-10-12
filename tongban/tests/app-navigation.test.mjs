import test from 'node:test';
import assert from 'node:assert/strict';
import {MAIN_NAV,WORKBENCH_FEATURES,viewFromHash,hashForView,navigationFromHash,normalizeNavigation,activeNavView,isAppView} from '../src/app-navigation.js';
test('five tabs follow the signed-off design with a central workbench and legacy bookmarks',()=>{
 assert.deepEqual(MAIN_NAV.map(x=>x[2]),['消息','发现','工作台','钱包','我的']);
 assert.equal(viewFromHash('#mine/assets'),'wallet');assert.equal(viewFromHash('#wallet'),'wallet');
 assert.equal(hashForView('wallet'),'#wallet');assert.equal(activeNavView('wallet'),'wallet');assert.equal(viewFromHash('#contacts'),'contacts');assert.equal(activeNavView('contacts'),'messages');
 assert.equal(isAppView('wallet'),true);
});
test('bill return keeps the correct parent tab and unknown routes stay safe',()=>{
 assert.equal(activeNavView('bills','wallet'),'wallet');assert.equal(activeNavView('bills','messages'),'messages');
 assert.equal(viewFromHash('#bogus'),'messages');assert.equal(hashForView('bogus'),'#messages');
 for(const [id] of MAIN_NAV)assert.equal(viewFromHash(hashForView(id)),id);
});

test('removed service-credit bookmarks fall back safely and cannot expose a retired page',()=>{assert.equal(viewFromHash(''),'messages');assert.equal(viewFromHash('#mine/points'),'messages');assert.equal(viewFromHash('#workbench/points'),'workbench');assert.equal(hashForView('points'),'#messages');assert.equal(isAppView('points'),false);});
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
 for(const origin of ['mine','discover'])for(const route of ['favorites','drafts','moments']){
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
test('group tasks and group chats survive refresh without granting arbitrary nested routes',()=>{
 const group='11111111-1111-1111-1111-111111111111',task='22222222-2222-2222-2222-222222222222';
 assert.deepEqual(navigationFromHash('#messages/'+group),{view:'messages',options:{conversationId:group}});
 assert.equal(hashForView('messages',{conversationId:group}),'#messages/'+group);
 const options={route:'cooperation',conversationId:group,workflowId:task};assert.deepEqual(navigationFromHash(hashForView('workbench',options)),{view:'workbench',options});
 assert.equal(normalizeNavigation('workbench',{route:'cooperation',conversationId:'../admin',workflowId:'<script>'}).options.workflowId,null);
});
test('computer Codex chat has a refreshable device route and preserves the existing device home',()=>{
 const deviceId='11111111-1111-4111-8111-111111111111',options={route:'ai-channel',deviceId};
 assert.equal(hashForView('workbench',options),'#workbench/devices/'+deviceId+'/chat');
 assert.deepEqual(navigationFromHash(hashForView('workbench',options)),{view:'workbench',options});
 assert.equal(navigationFromHash('#workbench/devices').options.hub.screen,'devices');
 assert.notEqual(navigationFromHash('#workbench/devices/../chat').options.route,'ai-channel');
 assert.notEqual(navigationFromHash('#workbench/devices/'+deviceId+'/chat/unexpected').options.route,'ai-channel');
});

test('private AI chat has its own message route while regular conversation bookmarks remain unchanged',()=>{
 const deviceId='11111111-1111-4111-8111-111111111111';
 for(const provider of [undefined,'codex','ollama']){const options={route:'ai-channel',deviceId,...(provider?{provider}:{})};assert.deepEqual(navigationFromHash(hashForView('messages',options)),{view:'messages',options});assert.equal(activeNavView('messages'),'messages');}
 assert.notEqual(navigationFromHash('#messages/devices/../chat').options.route,'ai-channel');
 assert.equal(navigationFromHash('#messages/'+deviceId).options.conversationId,deviceId);
});
