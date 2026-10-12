import test from 'node:test';
import assert from 'node:assert/strict';
import {rosterCandidates,validateRosterSelection,rosterFields,createDiscussionDraft,saveRosterDraft} from '../src/group-ai-roster.js';
const did='11111111-1111-4111-8111-111111111111';
const device=extra=>({id:did,name:'自己的电脑',paired:true,online:true,providers:[{id:'codex',installed:true,loggedIn:true,executionSupported:true,executionMode:'tools'}],...extra});
const member={deviceId:did,provider:'codex',alias:'选品顾问'};
const draft=()=>({aiVersion:0,aiMembers:[{...member}],aiCandidates:rosterCandidates([device()])});
test('roster candidates must come from bound owned devices and detected installations; listing is not execution',()=>{
 assert.equal(rosterCandidates([device({paired:false}),device({revoked:true}),device({id:'foreign/path'})]).length,0);
 assert.equal(rosterCandidates([device({providers:[{id:'codex',installed:false}]})]).length,0);
 const rows=rosterCandidates([device({online:false}),device({online:false})]);assert.equal(rows.length,1);assert.equal(rows[0].available,false);
 assert.equal(rosterCandidates([device({providersStale:true})])[0].available,false);
 assert.equal(rosterCandidates([device({providers:[{id:'claude',installed:true,executionSupported:false}]})])[0].available,false);
});
test('roster selection validates max3, unique owned provider pairs and explicit safe aliases',()=>{
 const candidates=rosterCandidates([device()]);assert.deepEqual(validateRosterSelection([{...member,alias:'  顾问  '}],candidates),[{...member,alias:'顾问'}]);
 for(const rows of [[{...member,deviceId:'foreign'}],[member,member],[{...member,alias:''}],[{...member,alias:'x\ny'}],[{...member,alias:'x'.repeat(41)}],Array(4).fill(member)])assert.throws(()=>validateRosterSelection(rows,candidates));
});
test('roster fields escape aliases and readonly members never reveal device source identifiers',()=>{
 const html=rosterFields({aiCanManage:false,aiMembers:[{...member,alias:'<img src=x onerror=bad>'}],aiCandidates:rosterCandidates([device()])});
 assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|11111111|自己的电脑|rosterChoice/);assert.match(html,/只有群主/);
});
test('a failed second step retries the same roster command without creating another group',async()=>{
 const target=draft(),calls=[];let fail=true;
 const service={async createGroup(input){calls.push(['create',input]);return {conversationId:'group-1'};},async authenticatedRequest(path,options){calls.push(['roster',structuredClone(options.input)]);if(fail)throw Error('response lost');return {version:1,members:[{...member,id:'22222222-2222-4222-8222-222222222222'}]};}};
 await assert.rejects(createDiscussionDraft(service,target,{name:'群',memberIds:['friend']}),/讨论组已创建/);assert.equal(target.conversationId,'group-1');
 fail=false;await createDiscussionDraft(service,target,null);assert.equal(calls.filter(c=>c[0]==='create').length,1);assert.deepEqual(calls[1][1],calls[2][1]);assert.equal(target.aiVersion,1);
});
test('human-only creation does not configure or execute any AI',async()=>{
 let writes=0;const target={aiVersion:0,aiMembers:[],aiCandidates:[]};
 await createDiscussionDraft({createGroup:async()=>({conversationId:'group'}),authenticatedRequest:async()=>{writes++;}},target,{name:'群',memberIds:['friend']});assert.equal(writes,0);
});
test('late group creation after account/page change cannot save AI metadata through another session',async()=>{
 let current=true,writes=0;const target=draft();
 await assert.rejects(createDiscussionDraft({async createGroup(){current=false;return {conversationId:'old-account-group'};},authenticatedRequest:async()=>writes++},target,{},()=>current),{code:'STALE_RESPONSE'});assert.equal(writes,0);
});
test('roster conflict keeps the group checkpoint and never silently rebases or writes again',async()=>{
 const target={...draft(),conversationId:'already-created',groupCreated:true};let writes=0;
 await assert.rejects(createDiscussionDraft({authenticatedRequest:async()=>{writes++;throw Object.assign(Error('version conflict'),{status:409});}},target,null),{status:409});assert.equal(writes,1);assert.equal(target.conversationId,'already-created');assert.equal(target.aiVersion,0);
});
test('changed alias creates a different command while a same failed save retains its idempotency key',async()=>{
 const target={...draft(),conversationId:'group'},ids=[];const service={authenticatedRequest:async(path,{input})=>{ids.push(input.requestId);throw Error('lost');}};
 await assert.rejects(saveRosterDraft(service,target));await assert.rejects(saveRosterDraft(service,target));assert.equal(ids[0],ids[1]);
 target.aiMembers[0].alias='资料顾问';await assert.rejects(saveRosterDraft(service,target));assert.notEqual(ids[1],ids[2]);
});
