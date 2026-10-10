import test from 'node:test';
import assert from 'node:assert/strict';
import {MAIN_NAV,viewFromHash,hashForView,activeNavView,isAppView} from '../src/app-navigation.js';
test('assets is a child of Mine and existing wallet bookmarks remain usable',()=>{
 assert.deepEqual(MAIN_NAV.map(x=>x[2]),['AI 工作台','消息','通讯录','发现','我']);
 assert.equal(viewFromHash('#mine/assets'),'wallet');assert.equal(viewFromHash('#wallet'),'wallet');
 assert.equal(hashForView('wallet'),'#mine/assets');assert.equal(activeNavView('wallet'),'mine');
 assert.equal(isAppView('wallet'),true);
});
test('bill return keeps the correct parent tab and unknown routes stay safe',()=>{
 assert.equal(activeNavView('bills','wallet'),'mine');assert.equal(activeNavView('bills','messages'),'messages');
 assert.equal(viewFromHash('#bogus'),'workbench');assert.equal(hashForView('bogus'),'#workbench');
 for(const [id] of MAIN_NAV)assert.equal(viewFromHash(hashForView(id)),id);
});

test('workbench is the default and points is a Mine child independent of wallet',()=>{assert.equal(viewFromHash(''),'workbench');assert.equal(viewFromHash('#mine/points'),'points');assert.equal(hashForView('points'),'#mine/points');assert.equal(activeNavView('points'),'mine');});
