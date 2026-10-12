import test from 'node:test';
import assert from 'node:assert/strict';
import {networkPickerHTML,mountNetworkPicker,walletToolsHTML,transferDetailsHTML} from '../src/wallet-tools-ui.js';

test('network picker labels disabled mainnets and does not enable them through a forged click',()=>{
 const networks=[{name:'BSC 测试网',chainId:97,symbol:'tBNB',enabled:true},{name:'Ethereum',chainId:1,symbol:'ETH',enabled:false,reason:'主网未开放'}];
 const html=networkPickerHTML(networks,97);assert.match(html,/data-wallet-chain="1" disabled/);assert.match(html,/当前网络/);
 const error={textContent:''};let handler,calls=0,changed=0;
 const root={innerHTML:'',querySelector:()=>error,addEventListener:(_name,fn)=>handler=fn,removeEventListener:()=>handler=null};
 const cleanup=mountNetworkPicker(root,{wallet:{NETWORK:{chainId:97},getNetworks:()=>networks,setNetwork:()=>{calls++;throw Error('主网未开放');}},onChanged:()=>changed++});
 handler({target:{closest:()=>({disabled:true,dataset:{walletChain:'1'}})}});assert.equal(calls,0);
 handler({target:{closest:()=>({disabled:false,dataset:{walletChain:'1'}})}});assert.equal(calls,1);assert.equal(changed,0);assert.equal(error.textContent,'主网未开放');cleanup();assert.equal(handler,null);
});

test('DApp tools expose only external links and honestly disabled wallet connection',()=>{
 const html=walletToolsHTML();assert.match(html,/https:\/\/testnet\.bscscan\.com\//);assert.match(html,/https:\/\/app\.remix\.live\//);assert.doesNotMatch(html,/<iframe|<webview|<input|data-.*connect/);assert.match(html,/尚未接通/);assert.match(html,/noopener noreferrer/);assert.doesNotMatch(html,/买币|充值|邀请.*奖励|完成任务.*送币/);
});

test('signing review includes full chain address value gas method and calldata without injecting HTML',()=>{
 const from='0x'+'a'.repeat(40),to='0x'+'b'.repeat(40),data='0x'+'ab'.repeat(80);
 const html=transferDetailsHTML({chainId:97,from,to,amount:'0.01',symbol:'tBNB',type:0,gasLimit:'21000',gasPrice:'1000000000',data,gasFee:'0.000021',total:'0.010021'},{name:'BSC <test>'});
 for(const value of [from,to,data,'21000','1000000000','97','0.010021','方法'])assert.ok(html.includes(value));assert.ok(!html.includes('<test>'));assert.ok(html.includes('&lt;test&gt;'));
 const typed=transferDetailsHTML({chainId:1,type:2,data:'0x',maxFeePerGas:'5',maxPriorityFeePerGas:'1'},{name:'Ethereum'});assert.match(typed,/EIP-1559/);assert.match(typed,/最高优先费/);
});
