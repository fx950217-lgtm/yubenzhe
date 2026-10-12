import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {openSocialDatabase} from '../server/social-database.mjs';
import {createProductModules} from '../server/product-modules.mjs';

const errorIs=(status,code)=>error=>error.status===status&&(!code||error.code===code);
async function fixture(t){
 const database=openSocialDatabase(':memory:');t.after(()=>database.close());let time=Date.UTC(2026,9,11);
 const modules=createProductModules({database,origin:'http://127.0.0.1:58419',simulation:true,now:()=>time});
 const call=(a,method,path,input={},query={})=>Promise.resolve().then(()=>modules.handle({method,path,input,query,token:a?.token||'',ip:'127.0.0.1',userAgent:'Synthetic artifact test'}));
 const command=(a,path,input={})=>call(a,'POST',path,{requestId:randomUUID(),...input});
 const register=async()=>{const value=await command(null,'register',{password:'482715'});return {...value,id:modules.social.authenticate(value.token).id};};
 const a=await register(),b=await register();
 const friendship=await call(a,'POST','friends/request',{userId:b.profile.userId});await call(b,'POST','friends/respond',{requestId:friendship.requestId,accept:true});
 const planned=(await command(a,'workbench/plan',{goal:'为合成测试活动制作工作清单，包含准备事项和成果验收',fileIds:[]})).task;
 await command(a,'workbench/tasks/'+planned.id+'/confirm',{version:planned.version,planVersion:planned.planVersion,acceptExecution:true});
 for(let i=0;i<4;i++){time+=1000;await modules.tick();}
 const task=(await call(a,'GET','workbench/tasks/'+planned.id)).task;assert.equal(task.status,'succeeded');
 const one=(sql,...args)=>database.raw.prepare(sql).get(...args),run=(sql,...args)=>database.raw.prepare(sql).run(...args);
 const file=one('SELECT * FROM workbench_files WHERE id=?',task.outputs[0].id);
 const publish=(overrides={},user=a)=>call(user,'POST','moments',{clientId:randomUUID(),text:'',audience:'friends',images:[],workbenchFileId:file.id,...overrides});
 return {database,modules,a,b,call,command,publish,one,run,file,task,time:()=>time,async advance(ms){time+=ms;},async cleanup(){await modules.tick();}};
}

test('ordinary posts keep the existing digest and return artifact null',async t=>{
 const f=await fixture(t),input={clientId:randomUUID(),text:'普通动态',audience:'friends',images:[]};
 const p=(await f.call(f.a,'POST','moments',input)).post;assert.equal(p.artifact,null);
 assert.equal((await f.call(f.b,'GET','moments')).posts[0].artifact,null);
 const row=f.one('SELECT * FROM moments WHERE id=?',p.id);assert.equal(row.workbench_file_id,null);assert.equal(row.share_snapshot,null);
 const expected=createHash('sha256').update(JSON.stringify({text:input.text,audience:input.audience,images:[]})).digest('hex');
 assert.equal(f.one('SELECT digest FROM moment_requests WHERE client_id=?',input.clientId).digest,expected);
 assert.equal((await f.call(f.a,'POST','moments',input)).post.id,p.id);
});
test('own output can be shared with empty text and exact metadata only',async t=>{
 const f=await fixture(t),p=(await f.publish()).post;
 assert.deepEqual(p.artifact,{fileId:f.file.id,fileName:f.file.name,size:f.file.size,sha256:f.file.sha256,mime:f.file.mime,taskTitle:f.task.title,operation:f.task.operation,createdAt:f.file.created_at,available:true});
 const snapshot=JSON.parse(f.one('SELECT share_snapshot FROM moments WHERE id=?',p.id).share_snapshot);
 assert.deepEqual(Object.keys(snapshot).sort(),['fileId','fileName','size','sha256','mime','taskTitle','operation','createdAt'].sort());
 assert.equal(JSON.stringify(p).includes(Buffer.from(f.file.content).toString()),false);
 f.run('UPDATE workbench_files SET name=? WHERE id=?','之后改名.txt',f.file.id);
 assert.equal((await f.call(f.b,'GET','moments/'+p.id)).post.artifact.fileName,f.file.name);
});
test('another owner and a nonexistent output produce identical 404 ARTIFACT_NOT_FOUND',async t=>{
 const f=await fixture(t);let ownError,missingError;
 try{await f.publish({},f.b);}catch(e){ownError=e;}
 try{await f.publish({workbenchFileId:randomUUID()},f.b);}catch(e){missingError=e;}
 assert.ok(errorIs(404,'ARTIFACT_NOT_FOUND')(ownError));assert.ok(errorIs(404,'ARTIFACT_NOT_FOUND')(missingError));assert.equal(ownError.message,missingError.message);
 assert.equal(f.one('SELECT count(*) n FROM moments').n,0);assert.equal(f.one('SELECT count(*) n FROM moment_requests').n,0);
});
test('input files cannot be published as workbench outputs',async t=>{
 const f=await fixture(t),input=(await f.command(f.a,'workbench/files',{name:'input.txt',base64:Buffer.from('synthetic input').toString('base64')})).file;
 await assert.rejects(f.publish({workbenchFileId:input.id}),errorIs(404,'ARTIFACT_NOT_FOUND'));
});
test('expired outputs cannot be newly shared even before physical cleanup',async t=>{
 const f=await fixture(t);f.run('UPDATE workbench_files SET expires_at=? WHERE id=?',f.time(),f.file.id);
 await assert.rejects(f.publish(),errorIs(404,'ARTIFACT_NOT_FOUND'));assert.ok(f.one('SELECT id FROM workbench_files WHERE id=?',f.file.id));
});
test('non UUID workbenchFileId is rejected as 400 INVALID_ARTIFACT',async t=>{
 const f=await fixture(t);for(const id of ['bad','',null,13,{},'../../files',f.file.id+'x'])await assert.rejects(f.publish({workbenchFileId:id}),errorIs(400,'INVALID_ARTIFACT'));
 assert.equal(f.one('SELECT count(*) n FROM moments').n,0);
});
test('same clientId and payload including output reuse one existing moment request',async t=>{
 const f=await fixture(t),input={clientId:randomUUID(),text:'一次分享'};
 const results=await Promise.all([f.publish(input),f.publish(input),f.publish(input)]);assert.equal(new Set(results.map(r=>r.post.id)).size,1);
 assert.equal(f.one('SELECT count(*) n FROM moments').n,1);assert.equal(f.one('SELECT count(*) n FROM moment_requests').n,1);
});
test('changing the output or adding an output to the same clientId returns 409',async t=>{
 const f=await fixture(t),input={clientId:randomUUID(),text:'相同文字'};await f.publish(input);
 for(const id of [f.task.outputs[1].id,randomUUID()])await assert.rejects(f.publish({...input,workbenchFileId:id}),errorIs(409,'MOMENT_REQUEST_CONFLICT'));
 const plain={clientId:randomUUID(),text:'普通动态',audience:'friends',images:[]};await f.call(f.a,'POST','moments',plain);
 await assert.rejects(f.publish(plain),errorIs(409,'MOMENT_REQUEST_CONFLICT'));
});
test('existing 30-day cleanup keeps the moment snapshot and retry identity',async t=>{
 const f=await fixture(t),input={clientId:randomUUID()},before=(await f.publish(input)).post;
 f.run('UPDATE social_sessions SET expires_at=?',f.time()+60*86400000);await f.advance(30*86400000);
 assert.equal((await f.call(f.b,'GET','moments/'+before.id)).post.artifact.available,false);
 await f.cleanup();assert.equal(f.one('SELECT id FROM workbench_files WHERE id=?',f.file.id),undefined);
 assert.equal(f.one('SELECT workbench_file_id FROM moments WHERE id=?',before.id).workbench_file_id,null);
 const after=(await f.call(f.b,'GET','moments')).posts[0];assert.equal(after.id,before.id);assert.deepEqual(after.artifact,{...before.artifact,available:false});
 const retry=(await f.publish(input)).post;assert.equal(retry.id,before.id);assert.deepEqual(retry.artifact,after.artifact);
 assert.equal(f.one('SELECT count(*) n FROM moments').n,1);assert.deepEqual(f.database.raw.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('self-only artifact posts are absent from a friend feed and direct lookup',async t=>{
 const f=await fixture(t),p=(await f.publish({audience:'self'})).post;assert.equal(p.audience,'self');
 assert.equal((await f.call(f.b,'GET','moments')).posts.length,0);await assert.rejects(f.call(f.b,'GET','moments/'+p.id),errorIs(404,'MOMENT_NOT_FOUND'));
 assert.equal((await f.call(f.a,'GET','moments')).posts[0].id,p.id);
});
test('friend can read metadata but no existing route yields output bytes or preview',async t=>{
 const f=await fixture(t),p=(await f.publish()).post;
 assert.equal((await f.call(f.b,'GET','moments/'+p.id)).post.artifact.available,true);
 for(const path of ['workbench/files/'+f.file.id,'workbench/files/'+f.file.id+'/details','workbench/tasks/'+f.task.id,'moments/'+p.id+'/artifact','moments/media/'+f.file.id])await assert.rejects(f.call(f.b,'GET',path),errorIs(404));
 assert.equal((await f.call(f.b,'GET','workbench/files')).files.length,0);assert.equal((await f.call(f.b,'GET','workbench/tasks')).tasks.length,0);
 assert.deepEqual((await f.call(f.a,'GET','workbench/files/'+f.file.id)).binary,Buffer.from(f.file.content));
 assert.equal((await f.call(f.a,'GET','workbench/files/'+f.file.id+'/details')).file.kind,'output');
});
test('unfriend, block and suspended author revoke artifact moment visibility',async t=>{
 const f=await fixture(t),p=(await f.publish()).post;
 f.run('INSERT INTO social_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)',f.b.id,f.a.id,f.time());
 await assert.rejects(f.call(f.b,'GET','moments/'+p.id),errorIs(404));assert.equal((await f.call(f.b,'GET','moments')).posts.length,0);f.run('DELETE FROM social_blocks');
 f.run("INSERT INTO account_restrictions(account_id,state,reason,updated_at) VALUES(?,'suspended','test',?)",f.a.id,f.time());
 assert.equal((await f.call(f.b,'GET','moments')).posts.length,0);await assert.rejects(f.call(f.b,'GET','moments/'+p.id),errorIs(404));f.run('DELETE FROM account_restrictions');
 await f.call(f.a,'POST','friends/remove',{userId:f.b.profile.userId});assert.equal((await f.call(f.b,'GET','moments')).posts.length,0);
});
test('muted publication remains denied and removal cannot be undone by retry',async t=>{
 const f=await fixture(t),input={clientId:randomUUID()},p=(await f.publish(input)).post;
 f.run("INSERT INTO account_restrictions(account_id,state,reason,updated_at) VALUES(?,'muted','test',?)",f.a.id,f.time());
 await assert.rejects(f.publish(),errorIs(403,'ACCOUNT_RESTRICTED'));
 await f.call(f.a,'POST','moments/'+p.id+'/delete');await assert.rejects(f.publish(input),errorIs(410,'MOMENT_REMOVED'));
 assert.ok(f.one('SELECT id FROM workbench_files WHERE id=?',f.file.id));assert.equal(f.one('SELECT count(*) n FROM moments').n,0);
});
