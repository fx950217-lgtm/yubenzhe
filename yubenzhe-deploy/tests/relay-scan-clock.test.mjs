import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayScanClock} from '../device-bridge/protocol.mjs';

const epoch=Date.UTC(2026,9,13),date=new Date(epoch).toUTCString();
test('relay clock uses only exact HTTPS health endpoint without device or account credentials',async()=>{
 let monotonic=100,calls=0;const clock=createRelayScanClock({origin:'https://relay.test',clock:()=>monotonic,fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://relay.test/healthz');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');assert.equal(options.headers.Authorization,undefined);assert.equal(options.body,undefined);assert.equal(options.cache,'no-store');monotonic=300;return new Response('{}',{headers:{Date:date}});
 }});
 assert.throws(()=>clock.timestamp(),{code:'AI_RELAY_CLOCK_UNAVAILABLE'});await clock.synchronize();assert.equal(clock.timestamp(),epoch);
 monotonic+=17000;assert.equal(clock.timestamp(),epoch+17000);await clock.synchronize();assert.equal(calls,1,'one immutable anchor avoids HTTP-second rounding moving scans backwards');
 monotonic=99;assert.throws(()=>clock.timestamp(),{code:'AI_RELAY_CLOCK_UNAVAILABLE'});
});
test('relay clock fails closed for missing or untrusted date samples and can retry a later genuine sample',async()=>{
 const cases=[()=>new Response('{}'),()=>new Response('{}',{headers:{Date:'not a date'}}),()=>new Response('{}',{headers:{Date:date,Age:'1'}}),()=>new Response('{}',{status:503,headers:{Date:date}}),()=>({ok:true,redirected:true,headers:new Headers({Date:date})}),()=>({ok:true,url:'https://other.test/healthz',headers:new Headers({Date:date})}),()=>{throw Object.assign(Error('private networking error'),{code:'SECRET_DIAGNOSTIC'});}];
 for(const initial of cases){let bad=true;const clock=createRelayScanClock({origin:'https://relay.test',clock:()=>0,fetchImpl:async()=>bad?initial():new Response('{}',{headers:{Date:date}})});await assert.rejects(clock.synchronize(),{code:'AI_RELAY_CLOCK_UNAVAILABLE'});assert.throws(()=>clock.timestamp());bad=false;await clock.synchronize();assert.equal(clock.timestamp(),epoch);}
 for(const origin of ['http://relay.test','https://relay.test/','https://a:b@relay.test','https://relay.test?x=1'])assert.throws(()=>createRelayScanClock({origin}));
});
test('slow calibration is rejected and concurrent callers share a single bounded request',async()=>{
 let mono=0;const slow=createRelayScanClock({origin:'https://relay.test',clock:()=>mono,fetchImpl:async()=>{mono=10001;return new Response('{}',{headers:{Date:date}});}});await assert.rejects(slow.synchronize(),{code:'AI_RELAY_CLOCK_UNAVAILABLE'});
 let finish,calls=0;const clock=createRelayScanClock({origin:'https://relay.test',clock:()=>0,fetchImpl:()=>{calls++;return new Promise(resolve=>finish=resolve);}});
 const first=clock.synchronize(),second=clock.synchronize();finish(new Response('{}',{headers:{Date:date}}));await Promise.all([first,second]);assert.equal(calls,1);
});
