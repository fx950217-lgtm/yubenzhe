import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,createPublicKey,publicEncrypt,privateDecrypt,randomBytes,randomUUID,createCipheriv,createDecipheriv,constants} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync,symlinkSync,linkSync,statSync,openSync,ftruncateSync,closeSync,renameSync} from 'node:fs';
import {resolve,join,relative,isAbsolute,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createAIChannelFiles as createRelay,AI_FILE_LIMIT,AI_FILE_CHUNK,safeAIFileName} from '../server/ai-channel-files.mjs';
import {createAIChannelFiles as createBridge} from '../device-bridge/ai-channel-files.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),pub=pair.publicKey.export({type:'spki',format:'der'});
const bad=code=>e=>e.code===code;
function encrypted(plain,recipient=pub,name='资料.txt'){
 const der=Buffer.isBuffer(recipient)?recipient:Buffer.from(recipient,'base64'),key=createPublicKey({key:der,type:'spki',format:'der'}),aes=randomBytes(32),iv=randomBytes(12),c=createCipheriv('aes-256-gcm',aes,iv),cipher=Buffer.concat([c.update(plain),c.final(),c.getAuthTag()]);
 return {cipher,envelope:{version:1,algorithm:'RSA-OAEP-256+A256GCM',name,size:plain.length,iv:iv.toString('base64'),wrappedKey:publicEncrypt({key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},aes).toString('base64'),keyId:sha(der),cipherSha256:sha(cipher)}};
}
function decrypt(envelope,cipher){const aes=privateDecrypt({key:pair.privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.wrappedKey,'base64')),d=createDecipheriv('aes-256-gcm',aes,Buffer.from(envelope.iv,'base64'));d.setAuthTag(cipher.subarray(-16));return Buffer.concat([d.update(cipher.subarray(0,-16)),d.final()]);}
function relayFixture(){
 let time=Date.UTC(2026,9,12),revoked=false,leaseUntil=time+15000,authorizations=0;
 const ownerId=randomUUID(),otherOwnerId=randomUUID(),deviceId=randomUUID(),otherDeviceId=randomUUID(),taskId=randomUUID(),leaseId=randomUUID(),ownerToken=randomUUID(),otherToken=randomUUID(),agentToken=randomUUID(),calls=[];
 const ownerAuth=(token,id)=>{const who=token===ownerToken?ownerId:token===otherToken?otherOwnerId:null;if(!who||revoked||id!==(who===ownerId?deviceId:otherDeviceId))throw Object.assign(Error('Owner denied'),{code:'OWNER_DENIED'});return {ownerId:who,deviceId:id};};
 const relay=createRelay({now:()=>time,authorizeOwner:ownerAuth,authorizeAgent:(token,input)=>{authorizations++;if(revoked||token!==agentToken||input.taskId!==taskId||input.leaseId!==leaseId||time>=leaseUntil)throw Object.assign(Error('Lease denied'),{code:'LEASE_DENIED'});return {ownerId,deviceId,taskId};}});
 const owner=(path,input={},method='POST',token=ownerToken)=>{calls.push({path,input,method});return relay.handleOwner({method,token,input},path);};
 const agent=(path,input={})=>{calls.push({path,input});return relay.handleAgent(agentToken,path,{taskId,leaseId,...input});};
 const init=(envelope,extra={})=>owner('init',{deviceId,requestId:randomUUID(),envelope,...extra}).file;
 const upload=pack=>{const f=init(pack.envelope);for(let n=0;n<f.chunkCount;n++)owner(f.id+'/chunks/'+n,{data:pack.cipher.subarray(n*AI_FILE_CHUNK,(n+1)*AI_FILE_CHUNK).toString('base64')});return owner(f.id+'/finish').file;};
 const bind=ids=>relay.bindTask({ownerId,deviceId,taskId,fileIds:ids});
 return {relay,owner,agent,init,upload,bind,ownerId,otherOwnerId,deviceId,otherDeviceId,taskId,leaseId,ownerToken,otherToken,agentToken,calls,advance(ms){time+=ms;},revoke(){revoked=true;},authorizationCount:()=>authorizations};
}
function fixture(t){
 const parent=resolve(tmpdir()),base=mkdtempSync(join(parent,'ybz-ai-files-test-')),workspace=join(base,'workspace'),runtimeDir=join(base,'runtime');mkdirSync(workspace);mkdirSync(runtimeDir);
 t.after(()=>{const actual=resolve(base),rel=relative(parent,actual);assert.ok(basename(actual).startsWith('ybz-ai-files-test-')&&rel&&!rel.startsWith('..')&&!isAbsolute(rel));rmSync(actual,{recursive:true,force:true});});
 const f=relayFixture();let hook;
 const bridge=createBridge({workspace,runtimeDir,call:async(path,input)=>{hook?.(path,input);return f.agent(path.replace(/^files\//,''),input);}});
 const task={id:f.taskId,leaseId:f.leaseId,replyPublicKey:pub.toString('base64'),attachments:[]};
 return {...f,workspace,runtimeDir,base,bridge,task,hook(value){hook=value;}};
}

test('real RSA-OAEP + AES-GCM ciphertext makes owner → relay → workspace → relay → owner round trip',async t=>{
 const f=fixture(t),secret='UNIQUE-PLAINTEXT-MARKER-NEVER-IN-RELAY',input=Buffer.from(secret.repeat(12000)),pack=encrypted(input,f.bridge.publicKey,'../../用户资料.txt'),ready=f.upload(pack);
 f.task.attachments=f.bind([ready.id]);const prepared=await f.bridge.prepareTask(f.task);assert.equal(prepared.inbox.length,1);const received=resolve(f.workspace,prepared.inbox[0]);assert.ok(relative(f.workspace,received)&&!relative(f.workspace,received).startsWith('..'));assert.deepEqual(readFileSync(received),input);
 const output=Buffer.from('PRIVATE-DELIVERABLE-ONLY-RECIPIENT-CAN-READ'.repeat(11000));writeFileSync(resolve(f.workspace,prepared.outbox,'成果.txt'),output);
 const sent=await f.bridge.collectTask(f.task);assert.equal(sent.length,1);assert.equal(sent[0].direction,'outbox');assert.equal(sent[0].envelope.keyId,sha(pub));
 const cipher=Buffer.concat(Array.from({length:sent[0].chunkCount},(_,n)=>Buffer.from(f.owner(sent[0].id+'/chunks/'+n,{},'GET').data,'base64')));assert.deepEqual(decrypt(sent[0].envelope,cipher),output);
 const recorded=JSON.stringify(f.calls);assert.equal(recorded.includes(secret),false);assert.equal(recorded.includes(output.subarray(0,50).toString()),false);assert.equal(recorded.includes('PRIVATE KEY'),false);
 assert.deepEqual(f.relay.listForTask({ownerId:f.ownerId,deviceId:f.deviceId,taskId:f.taskId}).outputFiles.map(x=>x.id),sent.map(x=>x.id));
 assert.equal(readdirSync(f.runtimeDir).includes('ai-files-key.pem'),true);assert.equal(existsSync(join(f.workspace,'ai-files-key.pem')),false);
});

test('file envelope, chunk boundaries, hash, immutable chunks and idempotency reject malformed delivery',()=>{
 const f=relayFixture(),pack=encrypted(Buffer.alloc(AI_FILE_CHUNK+8,7)),requestId=randomUUID(),file=f.init(pack.envelope,{requestId});
 assert.equal(f.init(pack.envelope,{requestId}).id,file.id);assert.throws(()=>f.init({...pack.envelope,name:'changed'},{requestId}),bad('IDEMPOTENCY_CONFLICT'));
 assert.throws(()=>f.owner(file.id+'/finish'),bad('FILE_INCOMPLETE'));assert.throws(()=>f.owner(file.id+'/chunks/0',{data:'AAAA'}),bad('FILE_CHUNK_INVALID'));
 const first=pack.cipher.subarray(0,AI_FILE_CHUNK).toString('base64');f.owner(file.id+'/chunks/0',{data:first});assert.equal(f.owner(file.id+'/chunks/0',{data:first}).accepted,true);
 const altered=Buffer.from(pack.cipher.subarray(0,AI_FILE_CHUNK));altered[0]^=1;assert.throws(()=>f.owner(file.id+'/chunks/0',{data:altered.toString('base64')}),bad('FILE_CHUNK_CONFLICT'));
 assert.throws(()=>f.owner(file.id+'/chunks/2',{data:''}),bad('FILE_CHUNK_INVALID'));
 const last=Buffer.from(pack.cipher.subarray(AI_FILE_CHUNK));last[0]^=1;f.owner(file.id+'/chunks/1',{data:last.toString('base64')});assert.throws(()=>f.owner(file.id+'/finish'),bad('FILE_DIGEST_MISMATCH'));
 assert.throws(()=>f.owner(file.id,{},'GET'),bad('OWNER_DENIED'));
 for(const change of [{size:0},{size:AI_FILE_LIMIT+1},{iv:'AA=='},{wrappedKey:'AA=='},{cipherSha256:'no'},{algorithm:'none'}])assert.throws(()=>f.init({...pack.envelope,...change}));
});

test('three ready inbox files bind once; another task cannot read them and owners cannot overwrite bound files',()=>{
 const f=relayFixture(),files=Array.from({length:3},()=>f.upload(encrypted(Buffer.from('input'))));assert.equal(f.relay.validateAttachments(f.ownerId,f.deviceId,files.map(x=>x.id)).length,3);
 assert.throws(()=>f.relay.validateAttachments(f.ownerId,f.deviceId,[...files.map(x=>x.id),randomUUID()]),bad('FILE_ATTACHMENTS_INVALID'));
 assert.throws(()=>f.relay.validateAttachments(f.ownerId,f.deviceId,[files[0].id,files[0].id]),bad('FILE_ATTACHMENTS_INVALID'));
 const bound=f.bind(files.map(x=>x.id));assert.equal(bound[0].taskId,f.taskId);assert.throws(()=>f.bind([files[0].id]),bad('FILE_NOT_READY'));
 assert.throws(()=>f.owner(files[0].id+'/chunks/0',{data:'AAAA'}),bad('FILE_WRITE_DENIED'));
 assert.throws(()=>f.agent(files[0].id+'/chunks/0/read',{taskId:randomUUID()}),bad('LEASE_DENIED'));
 assert.throws(()=>f.owner(files[0].id+'/chunks/0',{},'GET',f.otherToken),bad('OWNER_DENIED'));
 assert.throws(()=>f.relay.validateAttachments(f.otherOwnerId,f.otherDeviceId,[files[0].id]),bad('FILE_EXPIRED'));
});

test('single file 20 MB accepted, owner/global bytes and maximum file count reserved before upload',()=>{
 const f=relayFixture(),meta=encrypted(Buffer.from('x')).envelope;
 const first=f.init({...meta,size:AI_FILE_LIMIT});assert.equal(first.size,AI_FILE_LIMIT);assert.throws(()=>f.init({...meta,size:AI_FILE_LIMIT}),bad('FILE_RELAY_FULL'));
 f.relay.cleanupOwner(f.ownerId);assert.equal(f.init({...meta,size:AI_FILE_LIMIT}).size,AI_FILE_LIMIT);
 const many=createRelay({authorizeOwner:(_token,deviceId)=>({ownerId:deviceId,deviceId}),authorizeAgent(){throw Error('unused');}});
 const add=(who,size)=>many.handleOwner({method:'POST',token:who,input:{deviceId:who,requestId:randomUUID(),envelope:{...meta,size}}},'init');
 for(let n=0;n<5;n++)add('owner-'+n,AI_FILE_LIMIT-16);assert.throws(()=>add('owner-6',1),bad('FILE_RELAY_FULL'));
 const count=createRelay({authorizeOwner:()=>({ownerId:'owner',deviceId:'device'}),authorizeAgent(){throw Error('unused');}});
 for(let n=0;n<32;n++)count.handleOwner({method:'POST',token:'t',input:{deviceId:'device',requestId:randomUUID(),envelope:meta}},'init');
 assert.throws(()=>count.handleOwner({method:'POST',token:'t',input:{deviceId:'device',requestId:randomUUID(),envelope:meta}},'init'),bad('FILE_RELAY_FULL'));
});

test('24 hour expiry, account cleanup and service restart discard ciphertext and attachment readiness',()=>{
 const f=relayFixture(),file=f.upload(encrypted(Buffer.from('ephemeral')));f.bind([file.id]);f.advance(86400000);f.relay.maintain();assert.deepEqual(f.relay.listForTask({ownerId:f.ownerId,deviceId:f.deviceId,taskId:f.taskId}),{attachments:[],outputFiles:[]});
 assert.throws(()=>f.relay.validateAttachments(f.ownerId,f.deviceId,[file.id]),bad('FILE_EXPIRED'));
 const next=f.upload(encrypted(Buffer.from('cleanup')));f.relay.cleanupOwner(f.ownerId);assert.throws(()=>f.relay.validateAttachments(f.ownerId,f.deviceId,[next.id]),bad('FILE_EXPIRED'));
 const replacement=relayFixture();assert.throws(()=>replacement.relay.validateAttachments(f.ownerId,f.deviceId,[next.id]),bad('FILE_EXPIRED'));
});

test('each incoming chunk rechecks lease expiry or revocation and never writes partial plaintext',async t=>{
 for(const reason of ['expired','revoked']){const f=fixture(t),file=f.upload(encrypted(Buffer.alloc(AI_FILE_CHUNK*2,3),f.bridge.publicKey));f.task.attachments=f.bind([file.id]);let reads=0;
  f.hook(path=>{if(path.endsWith('/read')&&++reads===2){if(reason==='expired')f.advance(15000);else f.revoke();}});
  await assert.rejects(f.bridge.prepareTask(f.task),bad('LEASE_DENIED'));assert.equal(reads,2);assert.equal(f.authorizationCount(),2);assert.deepEqual(readdirSync(join(f.workspace,'.ybz-ai-channel',f.taskId,'inbox')),[]);
 }
});

test('each outgoing chunk and finish require the same live task lease; revoked output never becomes ready',async t=>{
 const f=fixture(t),prepared=await f.bridge.prepareTask(f.task);writeFileSync(resolve(f.workspace,prepared.outbox,'result.bin'),Buffer.alloc(AI_FILE_CHUNK*2,4));let chunks=0;
 f.hook(path=>{if(/\/chunks\//.test(path)&&++chunks===2)f.revoke();});await assert.rejects(f.bridge.collectTask(f.task),bad('LEASE_DENIED'));assert.equal(chunks,2);
 assert.deepEqual(f.relay.listForTask({ownerId:f.ownerId,deviceId:f.deviceId,taskId:f.taskId}).outputFiles,[]);
});

test('wrong recipient, corrupt wrapped key and authenticated ciphertext tampering cannot produce plaintext',async t=>{
 for(const variant of ['wrong-recipient','wrapped-key','auth-tag']){const f=fixture(t),pack=encrypted(Buffer.from('secret content'),variant==='wrong-recipient'?pub:f.bridge.publicKey);
  if(variant==='wrapped-key')pack.envelope.wrappedKey=Buffer.alloc(256,1).toString('base64');
  if(variant==='auth-tag'){pack.cipher[0]^=1;pack.envelope.cipherSha256=sha(pack.cipher);}
  const file=f.upload(pack);f.task.attachments=f.bind([file.id]);await assert.rejects(f.bridge.prepareTask(f.task));assert.deepEqual(readdirSync(join(f.workspace,'.ybz-ai-channel',f.taskId,'inbox')),[]);
 }
});

test('file names neutralize traversal and reserved names; input targets cannot overwrite symlinks or hard links',async t=>{
 for(const n of ['../../outside.txt','..\\..\\outside.txt','CON','LPT1.txt','nul.','/absolute:secret','\u0000hidden']){const safe=safeAIFileName(n);assert.equal(/[\\/:\x00]/.test(safe),false);assert.equal(safe.startsWith('..'),false);assert.equal(/^(con|nul|lpt1)(\.|$)/i.test(safe),false);}
 for(const kind of ['symlink','hardlink']){const f=fixture(t),file=f.upload(encrypted(Buffer.from('would overwrite'),f.bridge.publicKey,'target.txt'));await f.bridge.prepareTask(f.task);
  const outside=join(f.base,'outside.txt'),target=join(f.workspace,'.ybz-ai-channel',f.taskId,'inbox','1-target.txt');writeFileSync(outside,'DO NOT CHANGE');if(kind==='symlink')symlinkSync(outside,target);else linkSync(outside,target);
  f.task.attachments=f.bind([file.id]);await assert.rejects(f.bridge.prepareTask(f.task));assert.equal(readFileSync(outside,'utf8'),'DO NOT CHANGE');
 }
});

test('task paths reject traversal and symlink directories, and result links or non-files are never uploaded',async t=>{
 const traversal=fixture(t);await assert.rejects(traversal.bridge.prepareTask({...traversal.task,id:'../escape'}),/Invalid task id/);
 const directory=fixture(t),outside=join(directory.base,'outside-dir');mkdirSync(outside);symlinkSync(outside,join(directory.workspace,'.ybz-ai-channel'),'junction');await assert.rejects(directory.bridge.prepareTask(directory.task),/Unsafe task directory/);
 for(const kind of ['symlink','hardlink','directory']){const f=fixture(t),prepared=await f.bridge.prepareTask(f.task),target=resolve(f.workspace,prepared.outbox,'unsafe'),outsideFile=join(f.base,'secret');writeFileSync(outsideFile,'PRIVATE');if(kind==='symlink')symlinkSync(outsideFile,target);else if(kind==='hardlink')linkSync(outsideFile,target);else mkdirSync(target);
  await assert.rejects(f.bridge.collectTask(f.task),/Unsafe output file/);assert.equal(f.calls.length,0);
 }
});

test('four outputs, oversized output and cancelled transfers fail before any upload',async t=>{
 for(const variant of ['four','oversized','cancelled']){const f=fixture(t),prepared=await f.bridge.prepareTask(f.task),out=resolve(f.workspace,prepared.outbox);
  if(variant==='four')for(let n=0;n<4;n++)writeFileSync(join(out,n+'.txt'),'x');
  if(variant==='oversized'){const fd=openSync(join(out,'large.bin'),'w');try{ftruncateSync(fd,AI_FILE_LIMIT+1);}finally{closeSync(fd);}}
  const abort=new AbortController();if(variant==='cancelled')abort.abort();await assert.rejects(f.bridge.collectTask(f.task,{signal:abort.signal}));assert.equal(f.calls.length,0);
 }
});

test('private decryption key stays outside workspace, persists locally and rejects symbolic/hard links',async t=>{
 const f=fixture(t),reloaded=createBridge({workspace:f.workspace,runtimeDir:f.runtimeDir,call:()=>{throw Error('unused');}});assert.equal(reloaded.publicKey,f.bridge.publicKey);
 assert.throws(()=>createBridge({workspace:f.workspace,runtimeDir:join(f.workspace,'keys'),call(){}}),/outside/);
 for(const kind of ['symlink','hardlink']){const state=join(f.base,'unsafe-key-'+kind);mkdirSync(state);const target=join(state,'ai-files-key.pem'),source=join(f.runtimeDir,'ai-files-key.pem');if(kind==='symlink')symlinkSync(source,target);else linkSync(source,target);
  assert.throws(()=>createBridge({workspace:f.workspace,runtimeDir:state,call(){}}),/Invalid local key path/);
 }
 assert.ok(statSync(join(f.runtimeDir,'ai-files-key.pem')).size>0);
});

test('inbox directory replaced during encrypted download is rejected before plaintext writes',async t=>{
 const f=fixture(t),file=f.upload(encrypted(Buffer.alloc(AI_FILE_CHUNK*2,9),f.bridge.publicKey,'race.txt'));f.task.attachments=f.bind([file.id]);
 const inbox=join(f.workspace,'.ybz-ai-channel',f.taskId,'inbox'),saved=inbox+'-original',outside=join(f.base,'outside-inbox');mkdirSync(outside);writeFileSync(join(outside,'keep.txt'),'UNCHANGED');let changed=false;
 f.hook(path=>{if(!changed&&path.endsWith('/chunks/1/read')){changed=true;renameSync(inbox,saved);symlinkSync(outside,inbox,'junction');}});
 await assert.rejects(f.bridge.prepareTask(f.task),/Unsafe inbox directory|Inbox changed/);assert.equal(changed,true);assert.deepEqual(readdirSync(outside),['keep.txt']);assert.equal(readFileSync(join(outside,'keep.txt'),'utf8'),'UNCHANGED');assert.deepEqual(readdirSync(saved),[]);
});

test('inbox file replaced with a link during encrypted download cannot overwrite an outside file',async t=>{
 for(const kind of ['symlink','hardlink']){const f=fixture(t),file=f.upload(encrypted(Buffer.alloc(AI_FILE_CHUNK+2,8),f.bridge.publicKey,'race.txt'));f.task.attachments=f.bind([file.id]);const outside=join(f.base,'outside-secret');writeFileSync(outside,'KEEP');let changed=false;
  f.hook(path=>{if(!changed&&path.endsWith('/chunks/1/read')){changed=true;const target=join(f.workspace,'.ybz-ai-channel',f.taskId,'inbox','1-race.txt');if(kind==='symlink')symlinkSync(outside,target);else linkSync(outside,target);}});
  await assert.rejects(f.bridge.prepareTask(f.task));assert.equal(changed,true);assert.equal(readFileSync(outside,'utf8'),'KEEP');
 }
});
