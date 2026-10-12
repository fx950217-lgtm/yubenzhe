'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {reviewProfilePath}=require('../src/review-profile.cjs');
test('normal launches ignore review ID and never select a QA wallet profile',()=>{assert.equal(reviewProfilePath(['app','--device-review-id=release15'],'/profiles'),null);});
test('review runs can use a new confined profile without reusing earlier review wallets',()=>{
 assert.equal(reviewProfilePath(['--device-review'],'/profiles'),path.join('/profiles','YBZ Device Installer Review'));
 assert.equal(reviewProfilePath(['--device-review','--device-review-id=release15'],'/profiles'),path.join('/profiles','YBZ Device Installer Review release15'));
});
test('review profile rejects traversal, absolute paths, empty and ambiguous IDs',()=>{
 for(const id of ['','../real','C:/Users/test','a/b','a\\b','a'.repeat(49),'UPPER'])assert.throws(()=>reviewProfilePath(['--device-review','--device-review-id='+id],'/profiles'));
 assert.throws(()=>reviewProfilePath(['--device-review','--device-review-id=a','--device-review-id=b'],'/profiles'));
});
