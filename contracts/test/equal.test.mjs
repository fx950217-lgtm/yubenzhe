import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,id,ZeroAddress,ZeroHash} from 'ethers';
import {compile} from '../scripts/compile.mjs';
const compiled=(await compile()).contracts;
const artifact=compiled['src/EqualDistribution.sol'].EqualDistribution;
const tokenArtifact=compiled['test/MockToken.sol'].MockToken;
const testTokenArtifact=compiled['src/InternalTestToken.sol'].InternalTestToken;

async function fixture(t,{count=3,amount=100003n,chainId=97,skipCampaign=false}={}){
 const rpc=ganache.provider({logging:{quiet:true},chain:{chainId,hardfork:'shanghai'},wallet:{totalAccounts:count+2},miner:{timestampIncrement:0}});
 const provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
 t.after(async()=>{provider.destroy();await rpc.disconnect();});
 const signers=await Promise.all(Array.from({length:count+2},(_,i)=>provider.getSigner(i)));
 const [sender,stranger,...members]=signers,recipients=await Promise.all(members.map(m=>m.getAddress()));
 const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.evm.bytecode.object,sender).deploy();await token.waitForDeployment();
 const now=Number((await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);
 const config={token:await token.getAddress(),campaignId:id('LOCAL EQUAL TEST'),amount,claimStart:now+120,expiresAt:now+360};
 const deploy=async(overrides={},addresses=recipients)=>{const c=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,sender).deploy({...config,...overrides},addresses);await c.waitForDeployment();return c;};
 const campaign=skipCampaign?null:await deploy(),tx=async p=>(await p).wait();
 const at=async ts=>{await rpc.request({method:'evm_setTime',params:[ts*1000]});await rpc.request({method:'evm_mine',params:[]});};
 const fund=async()=>{await tx(token.mint(await sender.getAddress(),amount));await tx(token.approve(await campaign.getAddress(),amount));await tx(campaign.fund());};
 const conserved=async()=>{assert.equal(await campaign.totalPaid()+await campaign.remaining()+await campaign.totalRefunded(),amount);assert.equal(await token.balanceOf(await campaign.getAddress()),await campaign.remaining());};
 return {rpc,provider,sender,stranger,members,recipients,token,config,campaign,deploy,tx,at,fund,conserved,amount};
}
test('equal distribution fixes recipients, excludes sender, checks time/amount and conserves integer dust',async t=>{
 const f=await fixture(t);const sender=await f.sender.getAddress();
 for(const config of [{token:ZeroAddress},{campaignId:ZeroHash},{amount:2},{claimStart:f.config.claimStart-61},{expiresAt:f.config.claimStart+59}])await assert.rejects(f.deploy(config));
 for(const addresses of [[],[ZeroAddress],[sender],[f.recipients[0],f.recipients[0]],Array(201).fill(f.recipients[0])])await assert.rejects(f.deploy({},addresses));
 assert.equal(await f.campaign.recipientIndex(sender),0n);assert.equal(await f.campaign.recipientIndex(f.recipients[1]),2n);
 assert.deepEqual(await Promise.all(f.members.map(async(_,i)=>(await f.campaign.participants(i)).allocation)),[33335n,33334n,33334n]);
 await f.fund();await f.conserved();await f.at(f.config.claimStart);
 for(const [i,member] of f.members.entries()){await f.tx(f.campaign.connect(member).claim(i));await f.conserved();}
 assert.equal(await f.campaign.phase(),2n);assert.equal(await f.campaign.totalPaid(),f.amount);
});
test('equal funding is exact, sender-only and once; claim cannot be copied or redirected',async t=>{
 const f=await fixture(t);await assert.rejects(f.campaign.connect(f.stranger).fund.staticCall());await assert.rejects(f.campaign.fund.staticCall());
 assert.equal(await f.campaign.funded(),false);await f.fund();await assert.rejects(f.campaign.fund.staticCall());
 assert.equal(await f.campaign.phase(),0n);assert.equal(await f.campaign.claimable(0),0n);await assert.rejects(f.campaign.connect(f.members[0]).claim.staticCall(0));
 await f.at(f.config.claimStart);assert.equal(await f.campaign.phase(),1n);
 await assert.rejects(f.campaign.connect(f.stranger).claim.staticCall(0));await assert.rejects(f.campaign.connect(f.members[1]).claim.staticCall(0));
 await f.tx(f.campaign.connect(f.members[0]).claim(0));assert.equal(await f.token.balanceOf(f.recipients[0]),33335n);
 await assert.rejects(f.campaign.connect(f.members[0]).claim.staticCall(0));assert.equal(await f.campaign.claimable(0),0n);await f.conserved();
});
test('fixed expiry closes claims and only refunds unclaimed value to the original sender',async t=>{
 const f=await fixture(t);await f.fund();await assert.rejects(f.campaign.refundExpired.staticCall());await f.at(f.config.claimStart);await f.tx(f.campaign.connect(f.members[0]).claim(0));
 await f.at(f.config.expiresAt);assert.equal(await f.campaign.phase(),2n);assert.equal(await f.campaign.refunded(),false);assert.equal(await f.campaign.claimable(1),0n);
 await assert.rejects(f.campaign.connect(f.members[1]).claim.staticCall(1));await f.tx(f.campaign.connect(f.stranger).refundExpired());
 assert.equal(await f.token.balanceOf(await f.sender.getAddress()),66668n);assert.equal(await f.token.balanceOf(await f.stranger.getAddress()),0n);await assert.rejects(f.campaign.refundExpired.staticCall());await f.conserved();
});
test('failed or fee-charging transfers roll back claims and refunds without blocking another recipient',async t=>{
 const f=await fixture(t);await f.tx(f.token.setChargeFee(true));await assert.rejects(f.fund());assert.equal(await f.campaign.funded(),false);
 await f.tx(f.token.setChargeFee(false));await f.tx(f.campaign.fund());await f.at(f.config.claimStart);
 await f.tx(f.token.setBlocked(f.recipients[0],true));await assert.rejects(f.tx(f.campaign.connect(f.members[0]).claim(0,{gasLimit:600000})));assert.equal((await f.campaign.participants(0)).claimed,false);await f.conserved();
 await f.tx(f.campaign.connect(f.members[1]).claim(1));await f.tx(f.token.setBlocked(f.recipients[0],false));await f.tx(f.token.setChargeFee(true));await assert.rejects(f.campaign.connect(f.members[0]).claim.staticCall(0));await f.conserved();
 await f.tx(f.token.setChargeFee(false));await f.tx(f.campaign.connect(f.members[0]).claim(0));await f.at(f.config.expiresAt);
 await f.tx(f.token.setBlocked(await f.sender.getAddress(),true));await assert.rejects(f.tx(f.campaign.refundExpired({gasLimit:600000})));assert.equal(await f.campaign.refunded(),false);await f.conserved();
 await f.tx(f.token.setBlocked(await f.sender.getAddress(),false));await f.tx(f.campaign.refundExpired());await f.conserved();
});
test('token callback cannot reenter and equal ABI provides no platform withdrawal or mutable recipient',async t=>{
 const f=await fixture(t);await f.fund();await f.at(f.config.claimStart);await f.tx(f.token.setCallback(await f.campaign.getAddress(),f.campaign.interface.encodeFunctionData('refundExpired')));
 await f.tx(f.campaign.connect(f.members[0]).claim(0));assert.equal(await f.token.callbackError(),id('ReentrancyGuardReentrantCall()').slice(0,10));await f.conserved();
 const writes=artifact.abi.filter(x=>x.type==='function'&&!['view','pure'].includes(x.stateMutability)).map(x=>x.name).sort();assert.deepEqual(writes,['claim','fund','refundExpired']);
});
test('200 recipients fit an explicit test block gas budget and all allocations sum to the original amount',async t=>{
 const f=await fixture(t,{count:200,amount:100003n});const receipt=await f.campaign.deploymentTransaction().wait();assert.ok(receipt.gasUsed<20000000n);
 const allocations=await Promise.all(f.recipients.map(async(_,i)=>(await f.campaign.participants(i)).allocation));assert.equal(allocations.reduce((a,b)=>a+b,0n),f.amount);assert.equal(await f.campaign.recipientIndex(f.recipients[199]),200n);
 t.diagnostic('200-recipient local deployment gas: '+receipt.gasUsed.toString());await f.fund();await f.at(f.config.expiresAt);await f.tx(f.campaign.refundExpired());await f.conserved();
});
test('internal test token has fixed supply and refuses non-97 chains',async t=>{
 const f=await fixture(t);const token=await new ContractFactory(testTokenArtifact.abi,testTokenArtifact.evm.bytecode.object,f.sender).deploy();await token.waitForDeployment();
 assert.equal(await token.totalSupply(),1000000n*10n**18n);assert.equal(await token.balanceOf(await f.sender.getAddress()),await token.totalSupply());assert.equal(await token.symbol(),'YBZt');
 assert.equal(testTokenArtifact.abi.some(x=>['mint','owner','pause','upgradeTo'].includes(x.name)),false);
 const mainnet=await fixture(t,{chainId:56,skipCampaign:true});await assert.rejects(new ContractFactory(testTokenArtifact.abi,testTokenArtifact.evm.bytecode.object,mainnet.sender).deploy());await assert.rejects(mainnet.deploy());
});
