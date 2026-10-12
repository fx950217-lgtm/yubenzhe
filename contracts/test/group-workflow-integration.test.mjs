import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import ganache from 'ganache';
import {Wallet,formatEther} from 'ethers';
import {passwordRecord} from '../../yubenzhe-deploy/server/auth.mjs';
import {openSocialDatabase} from '../../yubenzhe-deploy/server/social-database.mjs';
import {openAiDatabase} from '../../yubenzhe-deploy/server/ai-database.mjs';
import {createAiService} from '../../yubenzhe-deploy/server/ai-service.mjs';
import {createProductModules} from '../../yubenzhe-deploy/server/product-modules.mjs';
import {createAcceptanceServer} from '../../yubenzhe-deploy/server/server.mjs';
import {createTaskPaymentVerifier} from '../../yubenzhe-deploy/server/task-payment-verifier.mjs';

// Real HTTP sessions, SQLite, file worker, encrypted consumer wallet and EVM.
// ONLY the model is a labeled fixture. Every RPC is intercepted locally; this
// is not a public BSC-testnet or real-model acceptance report.
test('two-account group to approved actual files to user-wallet signed payment and canonical receipt, over real HTTP',async t=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:2}});
 const accounts=Object.values(rpc.getInitialAccounts()),rpcCalls=[],requestBodies=[];
 const rpcFetch=async (url,options)=>{
  assert.ok(['bsc-testnet-dataseed.bnbchain.org','bsc-testnet.bnbchain.org'].includes(new URL(url).hostname),'External network is prohibited in this test');
  const body=JSON.parse(options.body);rpcCalls.push(body.method);
  try{return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:await rpc.request({method:body.method,params:body.params||[]})}));}
  catch(error){return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:error.code||-32000,message:'Local EVM fixture rejected request'}}));}
 };
 const socialDB=openSocialDatabase(':memory:'),aiDB=openAiDatabase(':memory:'),modelCalls=[];
 const ai=createAiService({database:aiDB,provider:{configured:true,fingerprint:'EXPLICIT-SYNTHETIC-MODEL',readiness:async()=>true,run:async input=>{modelCalls.push(input);return {output:'【模拟模型，仅用于自动测试】读取 CSV，保留唯一记录，交付去重文件和统计报告，由发起者验收。'};}}});
 const origin='http://localhost:18926';
 const modules=createProductModules({database:socialDB,origin,simulation:true,proposalService:ai.groupProposals,paymentVerifier:createTaskPaymentVerifier({rpcUrls:['https://bsc-testnet-dataseed.bnbchain.org'],fetchImpl:rpcFetch})});
 const server=createAcceptanceServer({role:'frontend',origin,publicFrontend:true,authConfig:await passwordRecord('fixture','synthetic-outer-password'),socialService:modules,staticRoot:fileURLToPath(new URL('../../tongban/dist',import.meta.url))});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=server.address().port;
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage,memory=new Map();
 globalThis.fetch=rpcFetch;globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
 const wallet=await import('../../tongban/src/wallet.js');
 t.after(async()=>{wallet.lock();globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage;server.closeAllConnections();await new Promise(done=>server.close(done));await ai.close();aiDB.close();socialDB.close();await rpc.disconnect();});
 function request(account,method,path,input){
  if(input)requestBodies.push(JSON.stringify(input));
  return new Promise((done,reject)=>{const req=httpRequest({host:'127.0.0.1',port,path:'/api/social/'+path,method,headers:{Host:'localhost:18926',Origin:origin,'Content-Type':'application/json',...(account?{Cookie:account.cookie}:{})}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const bytes=Buffer.concat(chunks);let json;try{json=JSON.parse(bytes.toString());}catch{}done({status:res.statusCode,json,bytes,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});});});req.on('error',reject);req.setTimeout(10000,()=>req.destroy(Error('HTTP timeout')));req.end(input?JSON.stringify(input):undefined);});
 }
 async function ok(account,method,path,input){const r=await request(account,method,path,input);assert.equal(r.status,200,JSON.stringify(r.json));return r.json;}
 async function register(){const r=await request(null,'POST','register',{password:'482615',requestId:randomUUID()});assert.equal(r.status,200);return {cookie:r.cookie,...r.json};}
 const a=await register(),b=await register();assert.notEqual(a.profile.userId,b.profile.userId);
 const friend=await ok(a,'POST','friends/request',{userId:b.profile.userId});await ok(b,'POST','friends/respond',{requestId:friend.requestId,accept:true});
 const {conversationId}=await ok(a,'POST','groups',{name:'真实双账号协作测试',memberIds:[b.profile.userId],requestId:randomUUID()});
 const message=await ok(b,'POST','conversations/'+conversationId+'/messages',{clientId:randomUUID(),type:'text',text:'请整理客户订单表，去掉重复记录，交付文件给我核对。'});
 assert.ok((await ok(a,'GET','conversations/'+conversationId+'/messages')).messages.some(m=>m.id===message.message.id));
 const file=await ok(a,'POST','workbench/files',{requestId:randomUUID(),name:'orders.csv',base64:Buffer.from('name,amount\nAlice,10\nAlice,10\nBob,20\n').toString('base64')});
 const create={requestId:randomUUID(),conversationId,goal:'订单表去重并交付文件与统计报告',fileIds:[file.file.id],sourceMessageIds:[message.message.id]};
 let {workflow:w}=await ok(a,'POST','group-workflows',create),path='group-workflows/'+w.id;
 for(let i=0;i<20&&w.status==='planning';i++){await new Promise(r=>setImmediate(r));w=(await ok(a,'GET',path)).workflow;}
 assert.equal(w.status,'proposal-ready');assert.match(w.proposal.output,/模拟模型/);assert.equal(modelCalls.length,1);assert.deepEqual(modelCalls[0].history,[]);
 assert.equal((await ok(a,'POST','group-workflows',create)).workflow.id,w.id);assert.equal(modelCalls.length,1);
 const approval={requestId:randomUUID(),version:w.version,proposalDigest:w.proposal.digest,budgetPoints:'100',acceptPoints:true};
 assert.equal((await request(b,'POST',path+'/approve',approval)).status,403);
 assert.equal(socialDB.raw.prepare('SELECT count(*) n FROM workbench_tasks').get().n,0);
 w=(await ok(a,'POST',path+'/approve',approval)).workflow;assert.equal(w.status,'executing');
 for(let i=0;i<5;i++)await modules.tick();w=(await ok(a,'GET',path)).workflow;
 assert.equal(w.status,'awaiting-acceptance');assert.ok(w.artifacts.length>=2);
 const csv=w.artifacts.find(f=>f.name.endsWith('.csv'));assert.ok(csv);
 const actual=await request(b,'GET',path+'/files/'+csv.id);assert.equal(actual.status,200);assert.equal(actual.bytes.toString().match(/Alice/g)?.length,1);assert.match(actual.bytes.toString(),/Bob/);
 assert.equal((await request(b,'POST',path+'/accept',{requestId:randomUUID(),version:w.version,artifactDigest:w.artifactDigest})).status,403);
 w=(await ok(a,'POST',path+'/accept',{requestId:randomUUID(),version:w.version,artifactDigest:w.artifactDigest})).workflow;assert.equal(w.status,'accepted');
 const password='synthetic-local-wallet-password-97';await wallet.importPrivateKey(accounts[0].secretKey,password);
 const recipient=new Wallet(accounts[1].secretKey).address;
 w=(await ok(a,'POST',path+'/payment',{requestId:randomUUID(),version:w.version,from:wallet.getWalletState().address,to:recipient,valueWei:'1000000000000'})).workflow;
 const intent=w.payment,preview=await wallet.prepareTransfer(intent.to,formatEther(intent.valueWei),{taskIntent:intent});
 const snapshot=await rpc.request({method:'evm_snapshot',params:[]});
 const signed=await wallet.confirmTransfer(preview.id,password,{beforeBroadcast:async facts=>{
  assert.equal(rpcCalls.filter(x=>x==='eth_sendRawTransaction').length,0);
  w=(await ok(a,'POST',path+'/signed',{requestId:randomUUID(),intentId:intent.id,txHash:facts.hash})).workflow;
  assert.equal(w.payment.txHash,facts.hash);assert.equal(w.status,'payment-pending');
 }});
 assert.equal(signed.broadcastUncertain,false);assert.equal(rpcCalls.filter(x=>x==='eth_sendRawTransaction').length,1);
 const verification={requestId:randomUUID(),intentId:intent.id};
 w=(await ok(a,'POST',path+'/verify',verification)).workflow;assert.equal(w.status,'payment-pending',JSON.stringify({receipt:w.payment.receipt,tx:await rpc.request({method:'eth_getTransactionByHash',params:[signed.hash]})}));assert.equal(w.payment.receipt.confirmations,1);
 await rpc.request({method:'evm_mine',params:[]});await rpc.request({method:'evm_mine',params:[]});
 w=(await ok(a,'POST',path+'/verify',verification)).workflow;assert.equal(w.status,'paid');assert.equal(w.payment.receipt.confirmations,3);assert.ok(BigInt(w.payment.receipt.feeWei)>0n);
 w=(await ok(a,'POST',path+'/verify',verification)).workflow;assert.equal(w.events.filter(e=>e.type==='payment-confirmed').length,1);
 const bView=(await ok(b,'GET',path)).workflow;assert.equal(bView.status,'paid');assert.equal(bView.isOwner,false);
 const chats=await ok(b,'GET','conversations/'+conversationId+'/messages');assert.ok(chats.messages.some(m=>m.groupWorkflow?.type==='payment-confirmed'&&m.groupWorkflow.serverVerified));
 assert.equal((await request(a,'POST',path+'/signed',{requestId:randomUUID(),intentId:intent.id,txHash:'0x'+'a'.repeat(64)})).status,409);
 await rpc.request({method:'evm_revert',params:[snapshot]});
 w=(await ok(a,'POST',path+'/verify',verification)).workflow;assert.equal(w.status,'payment-unknown');assert.ok(w.events.some(e=>e.type==='receipt-revoked'));assert.equal(rpcCalls.filter(x=>x==='eth_sendRawTransaction').length,1);
 const publicRows=JSON.stringify(socialDB.raw.prepare('SELECT * FROM group_workflow_payments').all())+JSON.stringify(requestBodies)+JSON.stringify(modelCalls);
 assert.ok(!publicRows.includes(accounts[0].secretKey));assert.ok(!publicRows.includes(password));
 assert.equal(socialDB.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(socialDB.raw.prepare('PRAGMA foreign_key_check').all().length,0);
 t.diagnostic('Two real HTTP accounts; real CSV artifact; actual consumer wallet encryption/signing; one locally mined chain-97 transfer; three confirmations and reorg revocation. Model fixture only. Zero public-network transactions.');
});
