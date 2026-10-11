import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {Transaction,Wallet,keccak256} from 'ethers';
import {equalInterface,tokenInterface} from '../src/chain-preview-config.js';
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};if(!globalThis.crypto)globalThis.crypto=webcrypto;
const wallet=await import('../src/wallet.js');
const address='0x1111111111111111111111111111111111111111',token='0x2222222222222222222222222222222222222222',recipient='0x3333333333333333333333333333333333333333',code='0x6001600055',campaign='0x'+'1'.repeat(64),blockHash='0x'+'b'.repeat(64);
let config={enabled:true,chainId:97,mode:'equal',distributionAddress:address,tokenAddress:token,campaignId:campaign,runtimeHash:keccak256(code),tokenRuntimeHash:keccak256(code)};
let created,gasPrice='0x3b9aca00',allowance=0n,funded=false,nonce=0,receipt=null,rejectBroadcast=false,currentCode=code;
const sent=[],requests=[];
globalThis.fetch=async(url,options)=>{
 if(url==='/api/chain-preview/config')return {ok:true,status:200,json:async()=>({...config})};
 const req=JSON.parse(options.body);requests.push(req);let result;
 switch(req.method){
 case 'eth_chainId':result='0x61';break;
 case 'eth_getCode':result=currentCode;break;
 case 'eth_getBlockByNumber':result={number:'0x64',timestamp:'0x64',hash:blockHash};break;
 case 'eth_blockNumber':result='0x65';break;
 case 'eth_gasPrice':result=gasPrice;break;
 case 'eth_getBalance':result='0x8ac7230489e80000';break;
 case 'eth_getTransactionCount':result='0x'+nonce.toString(16);break;
 case 'eth_estimateGas':result='0x186a0';break;
 case 'eth_getTransactionReceipt':result=receipt;break;
 case 'eth_getTransactionByHash':result=null;break;
 case 'eth_call':{
 const input=req.params[0],iface=input.to===token?tokenInterface:equalInterface,tx=iface.parseTransaction({data:input.data});
 const fields={token,sender:created.address,campaignId:campaign,totalAmount:100n,recipientCount:1n,claimStart:200n,expiresAt:500n,funded,refunded:false,remaining:funded?100n:0n,totalPaid:0n,totalRefunded:0n,recipientIndex:0n,decimals:2,symbol:'TST',balanceOf:100n,allowance};
 const values=tx.name==='approve'?[true]:['fund','refundExpired','claim'].includes(tx.name)?[]:[fields[tx.name]];
 result=iface.encodeFunctionResult(tx.name,values);break;
 }
 case 'eth_sendRawTransaction':{
 const signed=Transaction.from(req.params[0]);sent.push(signed);nonce++;result=keccak256(req.params[0]);const iface=signed.to===token?tokenInterface:equalInterface;const tx=iface.parseTransaction({data:signed.data});if(tx.name==='approve')allowance=tx.args[1];if(tx.name==='fund')funded=true;if(rejectBroadcast)throw Error('response lost');break;
 }
 default:throw Error('Unexpected '+req.method);
 }
 return {ok:true,json:async()=>({jsonrpc:'2.0',id:req.id,result})};
};
const password='local-test-password-2026';
async function resolve(hash){receipt={transactionHash:hash,status:'0x1',blockNumber:'0x64',blockHash,gasUsed:'0x10000',effectiveGasPrice:gasPrice};const state=await wallet.getTransactionStatus(hash);receipt=null;return state;}
test('equal distribution uses reviewed local signatures and survives uncertain submission',async t=>{
 created=await wallet.createWallet(password);wallet.commitWallet();
 await t.test('changed deployed code blocks before signing',async()=>{const preview=await wallet.prepareDistributionAction('approve');currentCode='0x6002600055';await assert.rejects(wallet.confirmDistributionAction(preview.id,password),{code:'CONTRACT_CODE_MISMATCH'});currentCode=code;assert.equal(sent.length,0);});
 await t.test('a changed fee requires a new preview',async()=>{const preview=await wallet.prepareDistributionAction('approve');gasPrice='0x77359400';await assert.rejects(wallet.confirmDistributionAction(preview.id,password),{code:'QUOTE_CHANGED'});gasPrice='0x3b9aca00';assert.equal(sent.length,0);});
 await t.test('approve signs exact testnet amount, not unlimited authority',async()=>{const preview=await wallet.prepareDistributionAction('approve');const result=await wallet.confirmDistributionAction(preview.id,password);const signed=sent[0],tx=tokenInterface.parseTransaction({data:signed.data});assert.equal(signed.chainId,97n);assert.equal(signed.from,created.address);assert.equal(signed.to,token);assert.equal(signed.value,0n);assert.equal(tx.name,'approve');assert.equal(tx.args[0],address);assert.equal(tx.args[1],100n);assert.equal(result.kind,'distribution');await assert.rejects(wallet.prepareDistributionAction('fund'),{code:'TRANSACTION_PENDING'});const actual=await resolve(result.hash);assert.equal(actual.actualGasFee,'0.000065536');});
 await t.test('fund sends no native value and retains hash after timeout',async()=>{const preview=await wallet.prepareDistributionAction('fund');rejectBroadcast=true;const result=await wallet.confirmDistributionAction(preview.id,password);rejectBroadcast=false;assert.equal(sent.length,2);const signed=sent[1];assert.equal(signed.to,address);assert.equal(signed.value,0n);assert.equal(equalInterface.parseTransaction({data:signed.data}).name,'fund');assert.equal(result.broadcastUncertain,true);assert.equal((await wallet.getTransactionStatus(result.hash)).status,'unknown');await assert.rejects(wallet.prepareTransfer(recipient,'0.01'),{code:'TRANSACTION_PENDING'});await resolve(result.hash);assert.equal(wallet.getRecords()[0].status,'confirmed');});
 await t.test('no secret or signed transaction is written to local records or API requests',async()=>{const key=Wallet.fromPhrase(created.phrase).privateKey;const local=[...storage.values()].join('');assert.equal(local.includes(key),false);assert.equal(local.includes(created.phrase),false);const rpc=JSON.stringify(requests);assert.equal(rpc.includes(key),false);assert.equal(rpc.includes(created.phrase),false);assert.equal(rpc.includes(password),false);assert.equal(requests.filter(x=>x.method==='eth_sendRawTransaction').length,2);for(const record of wallet.getRecords()){assert.equal(record.signed,undefined);assert.equal(record.data,undefined);}});
 wallet.lock();
});
