import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ganache from 'ganache';
import {BrowserProvider,Contract,Wallet,id} from 'ethers';
import {assertTestnet,normalizePlan,compiledArtifacts,offlinePreparation,readTestKey,checkPlan,deployPlan,verifyJournal,verifyRecord,publicConfiguration} from '../scripts/testnet.mjs';
const artifacts=await compiledArtifacts();
async function fixture(t){
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId:97,hardfork:'shanghai'},miner:{timestampIncrement:0},wallet:{totalAccounts:4}}),provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 const accounts=Object.values(rpc.getInitialAccounts()),wallet=new Wallet(accounts[0].secretKey),recipients=accounts.slice(1,3).map(a=>new Wallet(a.secretKey).address);
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'ybz-contract-test-'));
 t.after(async()=>{provider.destroy();await rpc.disconnect();await fs.rm(temp,{recursive:true,force:true});});
 const original=provider.broadcastTransaction.bind(provider);provider.broadcastTransaction=async signed=>{const transaction=await original(signed);await rpc.request({method:'evm_mine',params:[]});await rpc.request({method:'evm_mine',params:[]});return transaction;};
 const block=await provider.getBlock('latest');
 const plan=normalizePlan({schemaVersion:1,chainId:97,mode:'equal',sender:wallet.address,campaignId:id('LOCAL SCRIPT PLAN'),amount:'10003',recipients,claimStart:block.timestamp+10000,expiresAt:block.timestamp+20000,maxFeePerTxWei:'1000000000000000000',confirmations:3});
 return {rpc,provider,wallet,recipients,temp,plan};
}
test('testnet plan validation refuses mainnet, random mode, private data and invalid recipients',async t=>{
 const f=await fixture(t);
 for(const changes of [{chainId:56},{mode:'commit-reveal'},{privateKey:'must-not-be-accepted'},{recipients:[f.wallet.address]},{recipients:[f.recipients[0],f.recipients[0]]},{amount:'0'},{amount:100},{confirmations:1},{maxFeePerTxWei:'1000000000000000001'},{expiresAt:f.plan.claimStart+59}])assert.throws(()=>normalizePlan({...f.plan,...changes}));
 const prepared=offlinePreparation(f.plan,artifacts);assert.equal(prepared.status,'prepared-not-deployed');assert.equal(prepared.chainId,97);assert.equal('address' in prepared,false);assert.equal('privateKey' in prepared,false);
 assert.ok(prepared.contracts.EqualDistribution.abi.some(x=>x.name==='recipientIndex'));
 assert.match(prepared.sourceVerification.compilerVersion,/0\.8\.20/);assert.ok(prepared.sourceVerification.standardInput.sources['src/EqualDistribution.sol']);
});
test('RPC chain guard fails closed before signing or creating a deployment journal',async t=>{
 const f=await fixture(t);let called=0;const wrong={send:async()=>{called++;return '0x38';}};
 await assert.rejects(assertTestnet(wrong),e=>e.code==='TESTNET_ONLY');
 await assert.rejects(deployPlan({provider:wrong,plan:f.plan,artifacts,wallet:{address:f.wallet.address,signTransaction:()=>assert.fail('must never sign')},outDir:path.join(f.temp,'no-mainnet')}),e=>e.code==='TESTNET_ONLY');
 assert.equal(called,2);await assert.rejects(fs.stat(path.join(f.temp,'no-mainnet')));
});
test('dedicated key file checks purpose, chain and expected address without exposing its key',async t=>{
 const f=await fixture(t),filename=path.join(f.temp,'dedicated-test-key.json');
 const data={purpose:'ybz-bsc-testnet-only',chainId:97,privateKey:f.wallet.privateKey,expectedAddress:f.wallet.address};
 await fs.writeFile(filename,JSON.stringify(data),{mode:0o600});assert.equal((await readTestKey(filename,f.wallet.address)).address,f.wallet.address);
 for(const changes of [{chainId:56},{purpose:'production'},{expectedAddress:f.recipients[0]}]){
  await fs.writeFile(filename,JSON.stringify({...data,...changes}));await assert.rejects(readTestKey(filename,f.wallet.address),e=>{assert.ok(!e.message.includes(f.wallet.privateKey));return true;});
 }
 await assert.rejects(readTestKey('relative-key.json',f.wallet.address));
});
test('complete local-EVM deployment produces verified public config without approving or funding',async t=>{
 const f=await fixture(t),outDir=path.join(f.temp,'deployment');const check=await checkPlan(f.provider,f.plan,artifacts);assert.equal(check.chainId,97);
 const journal=await deployPlan({...f,artifacts,outDir});assert.equal(journal.status,'confirmed');assert.equal(journal.transactions.length,2);assert.ok(journal.transactions.every(r=>r.status==='confirmed'&&r.confirmations>=3));
 const config=publicConfiguration(journal);assert.equal(config.enabled,true);assert.equal(config.chainId,97);assert.equal(config.mode,'equal');assert.equal(config.noEconomicValue,true);assert.match(config.runtimeHash,/^0x[0-9a-f]{64}$/);assert.match(config.tokenRuntimeHash,/^0x[0-9a-f]{64}$/);
 const token=new Contract(config.tokenAddress,artifacts.InternalTestToken.abi,f.provider),distribution=new Contract(config.distributionAddress,artifacts.EqualDistribution.abi,f.provider);
 assert.equal(await distribution.funded(),false);assert.equal(await token.allowance(f.wallet.address,config.distributionAddress),0n);assert.equal(await distribution.sender(),f.wallet.address);
 assert.equal(await distribution.recipientIndex(f.recipients[1]),2n);
 const saved=await fs.readFile(path.join(outDir,'deployment.json'),'utf8');assert.ok(!saved.includes(f.wallet.privateKey));
 const verification=JSON.parse(await fs.readFile(path.join(outDir,'verification-input.json'),'utf8'));assert.equal(verification.standardInput.settings.evmVersion,'paris');
 await assert.rejects(deployPlan({...f,artifacts,outDir}),e=>e.code==='OUTPUT_EXISTS');
 const verified=await verifyJournal({provider:f.provider,journalFile:path.join(outDir,'deployment.json'),artifacts});assert.equal(verified.status,'confirmed');assert.equal(publicConfiguration(verified).enabled,true);
 const forged={...journal.transactions[1],data:journal.transactions[1].data.slice(0,-2)+'00'};await assert.rejects(verifyRecord(f.provider,forged,f.plan,artifacts),e=>e.code==='DEPLOYMENT_MISMATCH');
});
test('token-only deployment stays disabled for activity writes and chain receipt can recover an unknown broadcast',async t=>{
 const f=await fixture(t),plan=normalizePlan({schemaVersion:1,chainId:97,mode:'token-only',sender:f.wallet.address,maxFeePerTxWei:f.plan.maxFeePerTxWei});
 const outDir=path.join(f.temp,'unknown'),original=f.provider.broadcastTransaction.bind(f.provider);
 f.provider.broadcastTransaction=async signed=>{await original(signed);throw Error('Simulated transport loss after broadcasting');};
 await assert.rejects(deployPlan({...f,plan,artifacts,outDir}),e=>e.code==='VERIFY_EXISTING_TRANSACTION');
 const saved=JSON.parse(await fs.readFile(path.join(outDir,'deployment.json'),'utf8'));assert.equal(saved.transactions.length,1);assert.equal(saved.transactions[0].status,'broadcast-result-unknown');assert.match(saved.transactions[0].transactionHash,/^0x[0-9a-f]{64}$/);
 const verified=await verifyJournal({provider:f.provider,journalFile:path.join(outDir,'deployment.json'),artifacts});assert.equal(verified.status,'confirmed');assert.equal(publicConfiguration(verified).enabled,false);assert.ok(publicConfiguration(verified).tokenAddress);
});
test('insufficient gas and fee cap failures do not broadcast and remain visibly undeployed',async t=>{
 const f=await fixture(t),plan={...f.plan,mode:'token-only',maxFeePerTxWei:'1'};let broadcast=0;f.provider.broadcastTransaction=async()=>{broadcast++;assert.fail('cannot broadcast');};
 await assert.rejects(deployPlan({...f,plan,artifacts,outDir:path.join(f.temp,'fee-limit')}),e=>e.code==='FEE_LIMIT');assert.equal(broadcast,0);
 const emptyWallet=Wallet.createRandom(),emptyPlan={...plan,sender:emptyWallet.address,maxFeePerTxWei:'1000000000000000000'};
 const checked=await checkPlan(f.provider,emptyPlan,artifacts);assert.equal(checked.status,'needs-testnet-gas');assert.equal(checked.testBNBWei,'0');
 await assert.rejects(deployPlan({...f,wallet:emptyWallet,plan:emptyPlan,artifacts,outDir:path.join(f.temp,'no-gas')}));assert.equal(broadcast,0);
});
