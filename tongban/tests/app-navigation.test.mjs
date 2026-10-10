import test from 'node:test';
import assert from 'node:assert/strict';
import {MAIN_NAV,viewFromHash,hashForView,activeNavView,isAppView} from '../src/app-navigation.js';
test('assets is a child of Mine and existing wallet bookmarks remain usable',()=>{
 assert.deepEqual(MAIN_NAV.map(x=>x[2]),['消息','通讯录','AI 工作台','发现','我']);
 assert.equal(viewFromHash('#mine/assets'),'wallet');assert.equal(viewFromHash('#wallet'),'wallet');
 assert.equal(hashForView('wallet'),'#mine/assets');assert.equal(activeNavView('wallet'),'mine');
 assert.equal(isAppView('wallet'),true);
});
test('bill return keeps the correct parent tab and unknown routes stay safe',()=>{
 assert.equal(activeNavView('bills','wallet'),'mine');assert.equal(activeNavView('bills','messages'),'messages');
 assert.equal(viewFromHash('#bogus'),'messages');assert.equal(hashForView('bogus'),'#messages');
 for(const [id] of MAIN_NAV)assert.equal(viewFromHash(hashForView(id)),id);
});
