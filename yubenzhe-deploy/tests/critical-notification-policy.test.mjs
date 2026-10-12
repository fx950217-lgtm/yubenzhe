import test from 'node:test';
import assert from 'node:assert/strict';
import {criticalPushPayload,criticalPushDisplay,criticalPushClickPath,CRITICAL_PUSH_KINDS} from '../server/critical-notification-policy.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('emits only three fixed kinds and excludes all user content',()=>{
 for(const kind of CRITICAL_PUSH_KINDS){const payload=criticalPushPayload({id,kind,prompt:'PRIVATE_SYNTHETIC',deviceName:'PRIVATE_SYNTHETIC',title:'PRIVATE_SYNTHETIC',url:'https://evil.invalid'});assert.deepEqual(Object.keys(payload),['version','kind','eventId']);assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_SYNTHETIC/);assert.ok(criticalPushDisplay(payload));}
});
test('silently rejects old ordinary chat pushes and untrusted content',()=>{
 for(const payload of [null,{},[],{title:'愚笨者',body:'你有新的消息',url:'/#messages'},{version:1,kind:'progress',eventId:id},{version:1,kind:'task-completed',eventId:id,body:'PRIVATE_SYNTHETIC'},{version:1,kind:'task-completed',eventId:id+'\n'}])assert.equal(criticalPushDisplay(payload),null);
});
test('retry has one stable browser tag and no repeat alert',()=>{
 const payload=criticalPushPayload({id,kind:'decision-required'}),one=criticalPushDisplay(payload),two=criticalPushDisplay(payload);assert.deepEqual(one,two);assert.equal(one.options.tag,'ybz-critical-'+id);assert.equal(one.options.renotify,false);
});
test('fixed click path cannot be replaced by a payload URL',()=>{
 assert.equal(criticalPushClickPath({kind:'task-failed',eventId:id,url:'https://evil.invalid'}),'/#workbench');assert.equal(criticalPushClickPath({kind:'message',eventId:id}),null);
});
