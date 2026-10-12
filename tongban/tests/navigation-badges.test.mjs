import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationBadges,navigationBadgeHTML,unreadBadgeText} from '../src/navigation-badges.js';
const state=(unread=0,latest='0',owner='alice')=>({profile:{userId:owner},conversations:[{id:'chat',type:'group',unread}],moments:{latestVisibleId:latest}});
test('zero, 1, 99 and 100 render real unread totals and cap only the visible text',()=>{
 const badges=createNavigationBadges();badges.setOwner('alice');
 for(const n of [0,1,99,100,203]){badges.updateState(state(n));assert.equal(badges.getSnapshot().unread,n);assert.equal(unreadBadgeText(n),n>99?'99+':n?String(n):'');}
 assert.match(navigationBadgeHTML('messages',badges.getSnapshot()),/>99\+</);
 badges.updateState(state());assert.equal(navigationBadgeHTML('messages',badges.getSnapshot()),'');
});
test('sum counts once per human conversation and ignores invalid/device/AI entries',()=>{
 const badges=createNavigationBadges();badges.setOwner('alice');const value=state(3);value.conversations.push({id:'direct',type:'direct',unread:4},{id:'chat',type:'group',unread:999},{id:'device:x',type:'device',unread:9},{id:'bad',type:'group',unread:-1},{id:'nan',type:'group',unread:NaN});badges.updateState(value);assert.equal(badges.getSnapshot().unread,7);
});
test('account change clears badges and old-account results cannot repopulate them',()=>{
 const badges=createNavigationBadges();badges.setOwner('alice');badges.updateState(state(5,'10'));badges.updateState(state(6,'11'));assert.equal(badges.getSnapshot().discoveryUnread,true);badges.setOwner('bob');badges.updateState(state(8,'12'));assert.deepEqual(badges.getSnapshot(),{unread:0,unreadLabel:'',discoveryUnread:false});badges.updateState(state(2,'13','bob'));assert.equal(badges.getSnapshot().unread,2);badges.setOwner(null);assert.equal(badges.getSnapshot().unread,0);
});
test('new moments are relative to the first successful visible waterline',()=>{
 const badges=createNavigationBadges();badges.setOwner('alice');badges.updateState(state(0,'15'));assert.equal(badges.getSnapshot().discoveryUnread,false);badges.updateState(state(0,'16'));assert.equal(badges.getSnapshot().discoveryUnread,true);assert.match(navigationBadgeHTML('discover',badges.getSnapshot()),/is-dot/);badges.markMomentsSeen('16','alice');assert.equal(badges.getSnapshot().discoveryUnread,false);
});
test('only posts actually displayed by the same account clear the matching waterline',()=>{
 const badges=createNavigationBadges();badges.setOwner('alice');badges.updateState(state(0,'1'));badges.updateState(state(0,'4'));badges.markMomentsSeen('4','bob');badges.markMomentsSeen('2','alice');assert.equal(badges.getSnapshot().discoveryUnread,true);badges.markMomentsSeen('4','alice');badges.updateState(state(0,'5'));assert.equal(badges.getSnapshot().discoveryUnread,true);
});
test('deleting or hiding a newest post removes a stale dot without advancing seen',()=>{
 const badges=createNavigationBadges();badges.setOwner('alice');badges.updateState(state(0,'5'));badges.updateState(state(0,'6'));badges.updateState(state(0,'4'));assert.equal(badges.getSnapshot().discoveryUnread,false);badges.updateState(state(0,'7'));assert.equal(badges.getSnapshot().discoveryUnread,true);
});
test('malformed counters or markup cannot inject badge HTML',()=>{
 assert.equal(navigationBadgeHTML('messages',{unread:'<img src=x onerror=x>'}),'');assert.equal(navigationBadgeHTML('wallet',{discoveryUnread:true}),'');
 const badges=createNavigationBadges();badges.setOwner('alice');badges.updateState(state(0,'<script>'));assert.equal(badges.getSnapshot().discoveryUnread,false);
});
test('snapshots are detached and only contain notification metadata',()=>{
 const changes=[],badges=createNavigationBadges({onChange:s=>changes.push(s)});badges.setOwner('alice');const value=state(2);value.conversations[0].lastMessage={text:'do not retain'};badges.updateState(value);changes.at(-1).unread=999;assert.equal(badges.getSnapshot().unread,2);assert.deepEqual(Object.keys(badges.getSnapshot()),['unread','unreadLabel','discoveryUnread']);
});
