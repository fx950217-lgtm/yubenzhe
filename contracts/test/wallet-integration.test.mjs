import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,keccak256,id,Wallet} from 'ethers';
import {compile} from '../scripts/compile.mjs';

// This intentionally imports the actual consumer wallet, vault and distribution module.
// Its fetch transport is intercepted before use: NO request can reach an external RPC.
const artifacts=(await compile()).contracts;
test('real consumer wallet vault signs approve/fund/claim/refund against a real local chain-97 EVM',async t=>{
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},wallet:{totalAccounts:4},miner:{timestampIncrement:0}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const accounts=Object.values(rpc.getInitialAccounts()),sender=await provider.getSigner(0),recipients=accounts.slice(1,3).map(a=>new Wallet(a.secretKey).address);
 const tokenArtifact=artifacts['src/InternalTestToken.sol'].InternalTestToken,equalArtifact=artifacts['src/EqualDistribution.sol'].EqualDistribution;
 const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.evm.bytecode.object,sender).deploy();await token.waitForDeployment();
 const now=Number((await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp),campaignId=id('SYNTHETIC LOCAL FRONTEND INTEGRATION');
 const config={token:await token.getAddress(),campaignId,amount:10003n,claimStart:now+600,expiresAt:now+1200};
 const equal=await new ContractFactory(equalArtifact.abi,equalArtifact.evm.bytecode.object,sender).deploy(config,recipients);await equal.waitForDeployment();
 const publicConfig={enabled:true,mode:'equal',chainId:97,distributionAddress:await equal.getAddress(),tokenAddress:await token.getAddress(),campaignId,runtimeHash:keccak256(await provider.getCode(await equal.getAddress())),tokenRuntimeHash:keccak256(await provider.getCode(await token.getAddress()))};
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage,memory=new Map(),methods=[];
 globalThis.localStorage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)};
 globalThis.fetch=async(url,options={})=>{
  if(url==='/api/chain-preview/config')return new Response(JSON.stringify(publicConfig),{status:200,headers:{'content-type':'application/json'}});
  assert.ok(['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet.bnbchain.org'].includes(url),'Unexpected RPC URL; no real network fallback allowed');
  const request=JSON.parse(options.body);methods.push(request.method);
  try {const result=await rpc.request({method:request.method,params:request.params??[]});return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200});}
  catch(error){return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:error.code??-32000,message:'Local EVM rejected the request',data:error.data}}),{status:200});}
 };
 const wallet=await import('../../tongban/src/wallet.js'),password='synthetic-local-password-97';
 t.after(async()=>{wallet.lock();globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage;provider.destroy();await rpc.disconnect();});
 const switchWallet=async index=>{wallet.lock();memory.clear();await wallet.importPrivateKey(accounts[index].secretKey,password);assert.equal(wallet.getWalletState().unlocked,true);assert.ok(![...memory.values()].some(value=>value.includes(accounts[index].secretKey)));};
 const execute=async action=>{
  const preview=await wallet.prepareDistributionAction(action);assert.equal(preview.chainId,97);assert.ok(Number(preview.gasFee)>0);
  const sent=await wallet.confirmDistributionAction(preview.id,password);assert.equal(sent.broadcastUncertain,false);
  const result=await wallet.getTransactionStatus(sent.hash);assert.equal(result.status,'confirmed');assert.ok(result.confirmations>=1);assert.ok(Number(result.actualGasFee)>0);assert.ok(result.blockHash);
  return {preview,sent,result};
 };
 await switchWallet(0);await execute('approve');assert.equal(await token.allowance(await sender.getAddress(),await equal.getAddress()),10003n);assert.equal(await equal.funded(),false);
 await execute('fund');assert.equal(await equal.funded(),true);assert.equal(await token.balanceOf(await equal.getAddress()),10003n);assert.equal(await token.allowance(await sender.getAddress(),await equal.getAddress()),0n);
 await rpc.request({method:'evm_setTime',params:[config.claimStart*1000]});await rpc.request({method:'evm_mine',params:[]});
 await switchWallet(1);await execute('claim');assert.equal(await token.balanceOf(recipients[0]),5002n);assert.equal((await equal.participants(0)).claimed,true);assert.equal(await equal.remaining(),5001n);
 await assert.rejects(wallet.prepareDistributionAction('claim'),error=>error.code==='ACTION_UNAVAILABLE');
 await rpc.request({method:'evm_setTime',params:[config.expiresAt*1000]});await rpc.request({method:'evm_mine',params:[]});
 const before=await token.balanceOf(await sender.getAddress());const refund=await execute('refund');assert.equal(refund.preview.recipient,await sender.getAddress());assert.equal(await token.balanceOf(await sender.getAddress()),before+5001n);
 assert.equal(await equal.remaining(),0n);assert.equal(await equal.totalPaid()+await equal.totalRefunded(),10003n);assert.equal(await equal.refunded(),true);
 assert.equal(methods.filter(method=>method==='eth_sendRawTransaction').length,4);
 t.diagnostic('Four consumer-wallet signed transactions confirmed in the in-memory EVM; no external RPC request or transaction.');
});
