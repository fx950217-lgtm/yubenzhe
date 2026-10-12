import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const dataURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const stripCSS = source => source.replace(/import '\.\/[^']+\.css';\n/g, '');
const mediaURL = dataURL(stripCSS(await readFile(new URL('../src/chat-media.js', import.meta.url), 'utf8')));
const rosterURL=dataURL(await readFile(new URL('../src/group-ai-roster.js',import.meta.url),'utf8'));
const source = stripCSS(await readFile(new URL('../src/live-social.js', import.meta.url), 'utf8')).replace("'./chat-media.js'", JSON.stringify(mediaURL)).replace("'./group-ai-roster.js'",JSON.stringify(rosterURL));
const { mountLiveSocial, groupAIEntries, validateFriendId, validateGroup, mergeMessages, safeProfilePhoto, invalidatedConversationIds, catchUpMessages, trustedGroupWorkflow } = await import(dataURL(source));

test('copied success text cannot become a verified task event or wallet receipt',()=>{
 assert.equal(trustedGroupWorkflow({text:'[协作任务] 付款成功，回执已核验'}),null);
 assert.equal(trustedGroupWorkflow({groupWorkflow:{workflowId:'task',type:'payment-confirmed',serverVerified:false}}),null);
 assert.equal(trustedGroupWorkflow({groupWorkflow:{workflowId:'../secret',type:'payment-confirmed',serverVerified:true}}),null);
 const groupWorkflow={workflowId:'workflow-1',eventId:7,type:'payment-confirmed',serverVerified:true,currentStatus:'payment-unknown'};
 assert.equal(trustedGroupWorkflow({groupWorkflow}),groupWorkflow);
 assert.equal(trustedGroupWorkflow({groupWorkflow,removed:true}),null);
});

test('friend IDs use case-insensitive ASCII identifiers with the account length limits', () => {
  for (const input of ['000123', '123456789012345678901234', ' 73648291 ', ' Hello_User ']) assert.equal(validateFriendId(input), input.trim().toLowerCase());
  for (const input of ['', '1234', '1234567890123456789012345', '１２３４５６', 'user-name', '123 456', '123456\n7']) assert.throws(() => validateFriendId(input), /好友 ID/);
});

test('group creation supports a real two-account group and respects the two hundred member limit', () => {
  const a = '73648291', b = '42873615';
  assert.deepEqual(validateGroup(' 旅行群 ', [a, a, b], [a, b]), { name: '旅行群', memberIds: [a, b] });
  assert.deepEqual(validateGroup('群', [a, a], [a, b]), {name:'群',memberIds:[a]});
  assert.throws(() => validateGroup('群', [], [a, b]), /1–199/);
  assert.throws(() => validateGroup('群', [a, '999999'], [a, b]), /当前好友/);
  assert.throws(() => validateGroup(' '.repeat(2), [a, b], [a, b]), /群聊名称/);
  assert.throws(() => validateGroup('群'.repeat(25), [a, b], [a, b]), /群聊名称/);
  const large = Array.from({ length: 200 }, (_, n) => String(100000 + n));
  assert.throws(() => validateGroup('过大', large, large), /1–199/);
});

test('overlapping latest and historical pages preserve messages and deduplicate server acknowledgements', () => {
  const first = { id: 'm1', createdAt: 20, text: 'first' }, second = { id: 'm2', createdAt: 30, text: 'second' };
  const current = [first, second], old = { id: 'm0', createdAt: 10, text: 'older' }, updated = { ...second, text: 'confirmed' };
  const result = mergeMessages(current, [updated, old, updated, null]);
  assert.deepEqual(result.map(message => message.id), ['m0', 'm1', 'm2']);
  assert.equal(result.at(-1).text, 'confirmed');
  assert.equal(current[1].text, 'second');
  assert.deepEqual(mergeMessages(result, [second]).map(message => message.id), ['m0', 'm1', 'm2']);
});

test('profile photos accept only the exact app avatar route or constrained embedded image types', () => {
  const path = '/api/social/avatars/12345678-1234-1234-1234-123456789012';
  assert.equal(safeProfilePhoto({ avatarImage: path }), path);
  assert.equal(safeProfilePhoto({ avatarImage: 'https://66.42.56.29' + path }), 'https://66.42.56.29' + path);
  assert.equal(safeProfilePhoto({ avatarImage: 'data:image/jpeg;base64,YWJj' }), 'data:image/jpeg;base64,YWJj');
  for (const value of ['https://example.com' + path, 'http://66.42.56.29' + path, 'https://66.42.56.29:444' + path, 'https://user@66.42.56.29' + path, 'https://66.42.56.29' + path + '?redirect=evil', 'https://66.42.56.29' + path + '#x', '//66.42.56.29' + path, '/api/social/avatars/not-a-key', 'data:image/svg+xml;base64,YWJj', 'javascript:alert(1)']) assert.equal(safeProfilePhoto({ avatarImage: value }), '');
});


test('revoked or renewed memberships invalidate cached messages even with the same conversation ID', () => {
 const existing = [{ id: 'direct', membershipRevision: '100:0' }, { id: 'group', membershipRevision: '200:0' }];
 assert.deepEqual(invalidatedConversationIds(existing, existing.map(item => ({ ...item, unread: 2 }))), []);
 assert.deepEqual(invalidatedConversationIds(existing, [{ id: 'direct', membershipRevision: '100:0' }]), ['group']);
 assert.deepEqual(invalidatedConversationIds(existing, [{ id: 'direct', membershipRevision: '100:0' }, { id: 'group', membershipRevision: '200:23' }]), ['group']);
 assert.deepEqual(invalidatedConversationIds(existing, [{ id: 'direct', membershipRevision: '301:23' }, { id: 'group', membershipRevision: '200:0' }]), ['direct']);
 assert.deepEqual(invalidatedConversationIds([], [{ id: 'new', membershipRevision: '400:0' }]), []);
});


test('catch-up bridges more than fifty offline messages without relying on newest page or optimistic sends',async()=>{
 const rows=Array.from({length:127},(_,i)=>({id:String(i+11),createdAt:100,text:'消息'+i})),calls=[];const service={async getMessages(id,{after}){calls.push(after);const pending=rows.filter(x=>Number(x.id)>Number(after));return {messages:pending.slice(0,50),hasMore:pending.length>50,nextAfter:pending.length>50?pending[49].id:null};}};
 const result=await catchUpMessages(service,'chat','10');assert.equal(result.messages.length,127);assert.deepEqual(calls,['10','60','110']);assert.equal(result.cursor,'137');assert.equal(result.hasMore,false);assert.equal(mergeMessages([{id:'200',createdAt:100,text:'own confirmed'}],result.messages).length,128);assert.deepEqual(mergeMessages([], [{id:'10',createdAt:1},{id:'9',createdAt:1}]).map(m=>m.id),['9','10']);
});
test('catch-up stops obsolete membership responses and bounds long backlog work per poll',async()=>{
 let current=true;const aborted=await catchUpMessages({async getMessages(){current=false;return {messages:[{id:'7'}],hasMore:false};}},'chat','1',()=>current);assert.equal(aborted,null);
 let calls=0;const result=await catchUpMessages({async getMessages(id,{after}){calls++;const idNext=String(Number(after)+1);return {messages:[{id:idNext,createdAt:1}],nextAfter:idNext,hasMore:true};}},'chat','0');assert.equal(calls,10);assert.equal(result.cursor,'10');assert.equal(result.hasMore,true);
 await assert.rejects(catchUpMessages({async getMessages(){return {messages:[],hasMore:true,nextAfter:'1'};}},'chat','1'),/游标/);
});
test('content moderation revisions invalidate visible message caches and open media',()=>{
 assert.deepEqual(invalidatedConversationIds([{id:'c',membershipRevision:'1',contentRevision:'0'}],[{id:'c',membershipRevision:'1',contentRevision:'1'}]),['c']);
});

test('messages retain the three quick actions and open the address book through a refreshable route',async t=>{
  const previousDocument=globalThis.document,previousWindow=globalThis.window,roots=[],cleanups=[],destinations=[];
  const makeRoot=()=>{
    const handlers=new Map(),menu={innerHTML:''},modal={innerHTML:''};
    const root={innerHTML:'',classList:{toggle(){}},setAttribute(){},contains:()=>true,remove(){},querySelectorAll:()=>[],querySelector:selector=>selector==='[data-menu]'?menu:selector==='[data-modal-host]'?modal:null,addEventListener:(event,handler)=>handlers.set(event,handler),removeEventListener:event=>handlers.delete(event)};
    roots.push({root,menu,click:action=>handlers.get('click')({target:{matches:()=>false,closest:()=>({dataset:{action}})}})});
    return root;
  };
  globalThis.document={activeElement:null,createElement:makeRoot,addEventListener(){},removeEventListener(){}};
  globalThis.window={};
  t.after(()=>{for(const cleanup of cleanups)cleanup();if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;});
  const state={profile:{userId:'owner_1'},friends:[{userId:'friend_1',nickname:'好友'}],requests:[],outgoingRequests:[],conversations:[]};
  const service={async getState(){return state;}};
  const mount=view=>{cleanups.push(mountLiveSocial({append(){}},{service,view,onNavigate:route=>destinations.push(route)}));return roots.at(-1);};
  const messages=mount('messages');await new Promise(resolve=>setImmediate(resolve));
  assert.match(messages.root.innerHTML,/data-action="contacts"[^>]*>[\s\S]*?通讯录/);
  messages.click('menu');
  assert.deepEqual([...messages.menu.innerHTML.matchAll(/role="menuitem" data-action="([^"]+)"/g)].map(match=>match[1]),['scan','add-friend','create-group']);
  messages.click('contacts');assert.deepEqual(destinations,['contacts']);
  const contacts=mount('contacts');await new Promise(resolve=>setImmediate(resolve));
  assert.match(contacts.root.innerHTML,/aria-label="返回消息"/);
  assert.match(contacts.root.innerHTML,/friend_1/);
  contacts.click('messages');assert.deepEqual(destinations,['contacts','messages']);
  assert.equal(state.friends.length,1,'moving the address book keeps the existing friend data');
});

test('successful friend lookup moves the primary action to the matched person and typing restores search priority',async t=>{
 const previousDocument=globalThis.document,previousWindow=globalThis.window,previousFormData=globalThis.FormData;
 const handlers=new Map(),menu={innerHTML:''},modal={innerHTML:''};
 const root={innerHTML:'',classList:{toggle(){}},setAttribute(){},contains:()=>true,remove(){},querySelectorAll:()=>[],querySelector:selector=>selector==='[data-menu]'?menu:selector==='[data-modal-host]'?modal:null,addEventListener:(event,handler)=>handlers.set(event,handler),removeEventListener:event=>handlers.delete(event)};
 globalThis.document={activeElement:null,createElement:()=>root,addEventListener(){},removeEventListener(){}};
 globalThis.window={};
 globalThis.FormData=class{constructor(form){this.form=form;}get(name){return this.form.values[name];}};
 let relationship='none';
 const state={profile:{userId:'owner_1'},friends:[],requests:[],outgoingRequests:[],conversations:[]};
 const service={async getState(){return state;},async lookup(){return {profile:{userId:'friend_1',nickname:'测试好友'},relationship,requestId:'request_1'};}};
 const cleanup=mountLiveSocial({append(){}},{service});
 t.after(()=>{cleanup();globalThis.FormData=previousFormData;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;});
 await new Promise(resolve=>setImmediate(resolve));
 handlers.get('click')({target:{matches:()=>false,closest:()=>({dataset:{action:'add-friend'}})}});
 const primaryButtons=()=>[...root.innerHTML.matchAll(/<button\b[^>]*class="([^"]*)"[^>]*>(.*?)<\/button>/g)].filter(([,classes])=>classes.split(/\s+/).includes('live-primary')).map(([,classes,label])=>label);
 assert.deepEqual(primaryButtons(),['查找好友']);
 for(const [kind,label] of [['none','添加好友'],['friend','发消息'],['incoming','通过好友申请']]){
   relationship=kind;
   const form={dataset:{form:'lookup'},values:{friendId:'friend_1'},closest(){return this;}};
   handlers.get('submit')({target:form,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
   assert.deepEqual(primaryButtons(),[label]);
   assert.match(root.innerHTML,/class="secondary live-full" type="submit"/);
   handlers.get('input')({target:{name:'friendId',value:'other_1'}});
   assert.deepEqual(primaryButtons(),['查找好友']);
 }
});

function groupUIFixture(t,initialConversationId){
 const saved={document:globalThis.document,window:globalThis.window,FormData:globalThis.FormData},handlers=new Map(),menu={innerHTML:''},modal={innerHTML:''},calls=[],routes=[];
 const root={innerHTML:'',classList:{toggle(){}},setAttribute(){},contains:()=>true,remove(){},querySelectorAll:()=>[],querySelector:s=>s==='[data-menu]'?menu:s==='[data-modal-host]'?modal:null,addEventListener:(e,h)=>handlers.set(e,h),removeEventListener:e=>handlers.delete(e)};
 globalThis.document={activeElement:null,createElement:()=>root,addEventListener(){},removeEventListener(){}};globalThis.window={};globalThis.FormData=class{constructor(f){this.values=f.values;}get(n){return this.values[n];}};
 const owner={userId:'owner_1',nickname:'我'},friend={userId:'friend_1',nickname:'好友'},group={id:'group_1',type:'group',name:'讨论',ownerId:owner.userId,members:[owner,friend]},state={profile:owner,friends:[friend],requests:[],outgoingRequests:[],conversations:initialConversationId?[group]:[]};
 const service={async getState(){return state;},async createGroup(input){calls.push({kind:'group',input});state.conversations=[group];return {conversationId:group.id};},async getMessages(){return {messages:[{id:'1',type:'text',text:'AI-ONLY-MARKER <script>',senderId:owner.userId,createdAt:1,deviceAI:{alias:'<选品顾问>',provider:'codex',deviceName:'<电脑>',serverVerified:true}},{id:'2',type:'text',text:'人的判断',senderId:friend.userId,createdAt:2}]};},async markRead(){},async authenticatedRequest(){throw Error('Group creation cannot invoke device AI');}};
 const cleanup=mountLiveSocial({append(){}},{service,initialConversationId,onGroupAI:id=>routes.push(id),onNavigate:(view,options)=>routes.push({view,options})});t.after(()=>{cleanup();Object.assign(globalThis,saved);});
 const click=action=>handlers.get('click')({target:{matches:()=>false,closest:()=>({dataset:{action}})}});
 return {root,modal,handlers,calls,routes,click,group};
}
test('creating a group can continue to device/AI selection but never enables sharing or execution implicitly',async t=>{
 const f=groupUIFixture(t);await new Promise(setImmediate);f.click('create-group');assert.match(f.modal.innerHTML,/AI 名单/);
 f.handlers.get('change')({target:{name:'memberIds',value:'friend_1',checked:true,matches:()=>false}});f.handlers.get('change')({target:{name:'setupGroupAI',checked:true,matches:()=>false}});
 const form={dataset:{form:'group'},values:{groupName:'讨论'},closest(){return this;}};f.handlers.get('submit')({target:form,preventDefault(){}});await new Promise(setImmediate);
 assert.deepEqual(f.routes,[]);assert.deepEqual(f.calls,[{kind:'group',input:{name:'讨论',memberIds:['friend_1']}}]);
});
test('group AI attribution is escaped and its transient body is excluded from chat search',async t=>{
 const f=groupUIFixture(t,'group_1');await new Promise(setImmediate);assert.match(f.root.innerHTML,/&lt;选品顾问&gt; · AI/);assert.match(f.root.innerHTML,/AI-ONLY-MARKER &lt;script&gt;/);assert.doesNotMatch(f.root.innerHTML,/<script>/);
 f.click('group-ai');assert.deepEqual(f.routes,['group_1']);f.handlers.get('input')({target:{name:'chatQuery',value:'AI-ONLY-MARKER'}});assert.doesNotMatch(f.root.innerHTML,/AI-ONLY-MARKER &lt;script&gt;/);assert.match(f.root.innerHTML,/没有找到相关消息/);
});

test('discussion strips show people and escaped AI aliases without converting AI to social members',async t=>{
 const f=groupUIFixture(t,'group_1');f.group.aiMembers=[{id:'roster-1',kind:'ai',alias:'<选品>',provider:'codex',canChat:false}];await new Promise(setImmediate);
 assert.match(f.root.innerHTML,/2 人 · 1 个 AI/);assert.match(f.root.innerHTML,/&lt;选品&gt;/);assert.match(f.root.innerHTML,/data-action="group-ai-chat" data-id="roster-1" disabled/);assert.equal(f.group.members.length,2);
 assert.doesNotMatch(f.root.innerHTML,/<选品>/);assert.match(f.root.innerHTML,/class="live-ai-reply"/);
});
test('AI member routes are only offered for explicit owner capability and a valid device ID',()=>{
 const row={id:'ai1',kind:'ai',alias:'选品顾问',deviceId:'11111111-1111-4111-8111-111111111111'};
 assert.deepEqual(groupAIEntries({type:'direct',aiMembers:[row]}),[]);
 assert.equal(groupAIEntries({type:'group',aiMembers:[row]})[0].canChat,false);
 assert.equal(groupAIEntries({type:'group',aiMembers:[{...row,canChat:true}]})[0].canChat,true);
 assert.equal(groupAIEntries({type:'group',aiMembers:[{...row,canChat:true,deviceId:'../../other'}]})[0].canChat,false);
 assert.deepEqual(groupAIEntries({type:'group',aiMembers:[{...row,kind:'friend'},null]}),[]);
});

test('only an authorized roster avatar opens private chat and preserves the originating group',async t=>{
 const f=groupUIFixture(t,'group_1'),deviceId='11111111-1111-4111-8111-111111111111';
 f.group.aiMembers=[{id:'own-ai',kind:'ai',alias:'选品顾问',provider:'codex',canChat:true,deviceId},{id:'other-ai',kind:'ai',alias:'只读助手',provider:'codex',canChat:false}];await new Promise(setImmediate);
 const click=id=>f.handlers.get('click')({target:{matches:()=>false,closest:()=>({dataset:{action:'group-ai-chat',id}})}});
 click('other-ai');click('forged-id');assert.deepEqual(f.routes,[]);click('own-ai');assert.deepEqual(f.routes,[{view:'messages',options:{route:'ai-channel',deviceId,provider:'codex',returnConversationId:'group_1'}}]);
 f.group.aiMembers[0].canChat=false;click('own-ai');assert.equal(f.routes.length,1);
});
