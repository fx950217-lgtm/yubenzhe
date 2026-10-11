import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Interface,keccak256} from 'ethers';
import {validateChainPreviewConfig,loadChainPreviewConfig,loadDistributionSnapshot,buildEqualAction,equalInterface,tokenInterface} from '../src/chain-preview-config.js';
import {distributionHTML} from '../src/distribution-preview.js';
const distributionAddress='0x1111111111111111111111111111111111111111',tokenAddress='0x2222222222222222222222222222222222222222',sender='0x3333333333333333333333333333333333333333',viewer='0x4444444444444444444444444444444444444444';
const campaignId='0x'+'1'.repeat(64),code='0x6001600055';
const config={enabled:true,mode:'equal',chainId:97,distributionAddress,tokenAddress,campaignId,runtimeHash:keccak256(code),tokenRuntimeHash:keccak256(code)};
const base={token:tokenAddress,sender,campaignId,totalAmount:100n,recipientCount:2n,claimStart:200n,expiresAt:500n,funded:true,refunded:false,remaining:100n,totalPaid:0n,totalRefunded:0n};
const fetcher=async()=>({ok:true,status:200,json:async()=>config});
function requestWith(overrides={}){return async(method,args)=>{if(method==='eth_getCode')return overrides.code??code;if(method==='eth_getBlockByNumber')return {number:'0x64',timestamp:'0xfa'};assert.equal(method,'eth_call');const iface=args[0].to===distributionAddress?equalInterface:tokenInterface;const tx=iface.parseTransaction({data:args[0].data});let result;if(tx.name==='participants')result=[viewer,false,50n,0n];else if(tx.name==='recipientIndex')result=[2n];else if(tx.name==='claimable')result=[50n];else if(tx.name==='decimals')result=[2];else if(tx.name==='symbol')result=['TST'];else if(tx.name==='balanceOf')result=[100n];else if(tx.name==='allowance')result=[100n];else result=[overrides[tx.name]??base[tx.name]];return iface.encodeFunctionResult(tx.name,result);};}

test('configuration accepts only explicit chain97 equal mode and ignores foreign/secret fields',()=>{
 const checked=validateChainPreviewConfig({...config,privateKey:'must-not-return',rpcUrl:'https://evil.invalid'});assert.equal(checked.privateKey,undefined);assert.equal(checked.rpcUrl,undefined);
 for(const patch of [{chainId:56},{chainId:'97'},{mode:'commit-reveal'},{enabled:1},{distributionAddress:'0x0'},{tokenAddress:distributionAddress},{campaignId:'0x'+'0'.repeat(64)},{runtimeHash:'bad'}])assert.throws(()=>validateChainPreviewConfig({...config,...patch}),{code:'CHAIN_PREVIEW_INVALID'});
 assert.equal(validateChainPreviewConfig({enabled:false,chainId:97,mode:'equal'}).enabled,false);
});
test('config is read from same origin without redirects, and internal login is explicit',async()=>{
 let request;await loadChainPreviewConfig({fetcher:async(url,options)=>{request={url,...options};return fetcher();}});assert.equal(request.url,'/api/chain-preview/config');assert.equal(request.credentials,'same-origin');assert.equal(request.redirect,'error');assert.equal(request.method,'GET');
 await assert.rejects(loadChainPreviewConfig({fetcher:async()=>({status:401})}),{code:'INTERNAL_PREVIEW_REQUIRED'});
 assert.equal((await loadChainPreviewConfig({fetcher:async()=>({status:404})})).enabled,false);
});
test('every frontend contract signature matches compiled EqualDistribution ABI',async()=>{
 const compiled=JSON.parse(await readFile(new URL('../../contracts/exports/EqualDistribution.json',import.meta.url),'utf8'));const actual=new Interface(compiled.abi);
 for(const fragment of equalInterface.fragments){assert.equal(actual.getFunction(fragment.format('sighash')).selector,fragment.selector);assert.equal(actual.getFunction(fragment.format('sighash')).outputs.map(x=>x.type).join(','),fragment.outputs.map(x=>x.type).join(','));}
});
test('snapshot verifies deployed bytecode, exact published hashes, token and campaign',async()=>{
 const state=await loadDistributionSnapshot({address:viewer,fetcher,request:requestWith()});assert.equal(state.participant.index,1);assert.equal(state.formattedTokenAmount,'1.0');assert.equal(state.formattedClaimable,'0.5');assert.equal(state.now,250);
 await assert.rejects(loadDistributionSnapshot({fetcher,request:requestWith({code:'0x'})}),{code:'CONTRACT_NOT_DEPLOYED'});
 await assert.rejects(loadDistributionSnapshot({fetcher,request:requestWith({code:'0x6002600055'})}),{code:'CONTRACT_CODE_MISMATCH'});
 await assert.rejects(loadDistributionSnapshot({fetcher,request:requestWith({token:sender})}),{code:'CHAIN_PREVIEW_INVALID'});
 await assert.rejects(loadDistributionSnapshot({fetcher,request:requestWith({campaignId:'0x'+'2'.repeat(64)})}),{code:'CHAIN_PREVIEW_INVALID'});
});
test('equal actions enforce participant, time, amount and immutable refund destination',async()=>{
 const state=await loadDistributionSnapshot({address:viewer,fetcher,request:requestWith()});const claim=buildEqualAction(state,'claim',viewer);assert.equal(claim.to,distributionAddress);assert.equal(equalInterface.parseTransaction({data:claim.data}).args[0],1n);assert.equal(claim.amount,'0.5');
 assert.throws(()=>buildEqualAction(state,'claim',sender),{code:'ACTION_UNAVAILABLE'});assert.throws(()=>buildEqualAction({...state,participant:{...state.participant,claimed:true}},'claim',viewer),{code:'ACTION_UNAVAILABLE'});
 assert.throws(()=>buildEqualAction({...state,mode:'commit-reveal'},'claim',viewer),{code:'DISTRIBUTION_DISABLED'});
 const expired={...state,now:501};const refund=buildEqualAction(expired,'refund',viewer);assert.equal(refund.recipient,sender);assert.equal(refund.amount,'1.0');assert.throws(()=>buildEqualAction(state,'refund',viewer),{code:'ACTION_UNAVAILABLE'});
 const unfunded={...state,now:100,funded:false,allowance:0n};const approve=buildEqualAction(unfunded,'approve',sender);const tx=tokenInterface.parseTransaction({data:approve.data});assert.equal(tx.args[0],distributionAddress);assert.equal(tx.args[1],100n);assert.throws(()=>buildEqualAction({...unfunded,now:141},'approve',sender),{code:'ACTION_UNAVAILABLE'});assert.throws(()=>buildEqualAction({...unfunded,allowance:1n},'approve',sender),{code:'ALLOWANCE_EXISTS'});
 assert.equal(buildEqualAction({...unfunded,allowance:100n},'fund',sender).to,distributionAddress);
});
test('unconfigured view cannot manufacture actions, while ready view has one primary action',async()=>{
 const disabled=distributionHTML({enabled:false});assert.doesNotMatch(disabled,/data-distribution-action/);assert.match(disabled,/尚未部署/);
 const state=await loadDistributionSnapshot({address:viewer,fetcher,request:requestWith()});const html=distributionHTML(state,viewer);assert.equal((html.match(/class="primary"/g)||[]).length,1);assert.match(html,/内部测试 · BSC 测试网/);assert.match(html,/0\.5 TST/);assert.doesNotMatch(html,/余额|提现|无限额度.*class="primary"/);
});
