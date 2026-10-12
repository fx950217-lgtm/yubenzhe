
import test from 'node:test';import assert from 'node:assert/strict';import {localDeadline} from '../device-bridge/protocol.mjs';
test('device deadline uses remaining server duration and monotonic RTT, independent of either wall clock',()=>{
 for(const serverTime of [100,1791698830253,9999999999999]){
 const deadline=localDeadline({serverTime,expiresAt:serverTime+15000,receivedAt:5000,roundTrip:120});
 assert.equal(deadline,19880);
 }
 assert.equal(localDeadline({serverTime:10000,expiresAt:9000,receivedAt:5000,roundTrip:20}),5000);
 assert.equal(localDeadline({serverTime:10000,expiresAt:20000,receivedAt:5000,roundTrip:12000}),5000);
 assert.equal(localDeadline({serverTime:10000,expiresAt:NaN,receivedAt:5000,roundTrip:0}),0);
});
