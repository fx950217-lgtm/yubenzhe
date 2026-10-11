import { Interface, getAddress, keccak256, formatUnits } from 'ethers';
import { createChainReader } from './wallet.js';

export const CHAIN_PREVIEW_PATH = '/api/chain-preview/config';
export const EQUAL_ABI = [
 'function token() view returns (address)', 'function sender() view returns (address)',
 'function campaignId() view returns (bytes32)', 'function totalAmount() view returns (uint256)',
 'function recipientCount() view returns (uint256)', 'function claimStart() view returns (uint256)',
 'function expiresAt() view returns (uint256)', 'function funded() view returns (bool)',
 'function refunded() view returns (bool)', 'function remaining() view returns (uint256)',
 'function totalPaid() view returns (uint256)', 'function totalRefunded() view returns (uint256)',
 'function participants(uint256) view returns (address account,bool claimed,uint256 allocation,uint256 received)',
 'function claimable(uint256) view returns (uint256)', 'function recipientIndex(address) view returns (uint256)',
 'function fund()', 'function claim(uint256)', 'function refundExpired()'
];
export const TOKEN_ABI = ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
export const equalInterface = new Interface(EQUAL_ABI);
export const tokenInterface = new Interface(TOKEN_ABI);
const ZERO = '0x0000000000000000000000000000000000000000';
const HASH = /^0x[0-9a-f]{64}$/i;
const fail = (message, code='CHAIN_PREVIEW_INVALID') => Object.assign(new Error(message), {code});
function address(value) { try { const v=getAddress(value);if(v===ZERO)throw Error();return v; } catch { throw fail('链上内测配置地址无效，已停止操作。'); } }
export function validateChainPreviewConfig(input) {
 if (!input || input.chainId !== 97 || input.mode !== 'equal' || typeof input.enabled !== 'boolean') throw fail('链上内测配置不匹配，仅支持 BSC 测试网等额分发。');
 if (!input.enabled) return Object.freeze({enabled:false,chainId:97,mode:'equal',reason:'链上内测活动尚未部署或未启用。'});
 const out={enabled:true,chainId:97,mode:'equal',distributionAddress:address(input.distributionAddress),tokenAddress:address(input.tokenAddress),campaignId:input.campaignId};
 if (!HASH.test(out.campaignId || '') || /^0x0{64}$/i.test(out.campaignId) || out.tokenAddress===out.distributionAddress) throw fail('链上内测活动标识无效。');
 for (const field of ['runtimeHash','tokenRuntimeHash']) if (input[field]!==undefined) { if(!HASH.test(input[field]) || /^0x0{64}$/i.test(input[field]))throw fail('合约代码校验值无效。');out[field]=input[field].toLowerCase(); }
 return Object.freeze(out);
}
export async function loadChainPreviewConfig({fetcher=globalThis.fetch}={}) {
 let response;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);timer?.unref?.();
 try { response=await fetcher(CHAIN_PREVIEW_PATH,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},redirect:'error',signal:controller.signal}); }
 catch {throw fail('暂时无法读取链上内测配置。','CHAIN_PREVIEW_UNAVAILABLE');}finally{clearTimeout(timer);}
 if(response.status===401)throw fail('请先登录内部预览，再查看链上内测。','INTERNAL_PREVIEW_REQUIRED');
 if(response.status===404)return {enabled:false,chainId:97,mode:'equal',reason:'此环境尚未启用链上内测。'};
 if(!response.ok)throw fail('链上内测配置暂不可用。','CHAIN_PREVIEW_UNAVAILABLE');
 let input;try {input=await response.json();}catch{throw fail('链上内测配置格式无效。');}
 return validateChainPreviewConfig(input);
}
async function contractCode(request, target, expected) {
 const code=await request('eth_getCode',[target,'latest']);
 if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||/^0x0*$/i.test(code))throw fail('配置的合约尚未部署，操作已停用。','CONTRACT_NOT_DEPLOYED');
 const hash=keccak256(code);if(expected&&hash!==expected)throw fail('合约代码与发布配置不一致，操作已停用。','CONTRACT_CODE_MISMATCH');return hash;
}
async function call(request, iface, target, method, args=[]) {
 const result=await request('eth_call',[{to:target,data:iface.encodeFunctionData(method,args)},'latest']);
 try{return iface.decodeFunctionResult(method,result);}catch{throw fail('合约读取结果无法验证，操作已停用。','CONTRACT_DATA_INVALID');}
}
export async function loadDistributionSnapshot({address:viewer,fetcher=globalThis.fetch,request}={}) {
 const config=await loadChainPreviewConfig({fetcher});if(!config.enabled)return config;
 if(!request)request=await createChainReader();
 const block=await request('eth_getBlockByNumber',['latest',false]);
 if(!/^0x[0-9a-f]+$/i.test(block?.number||'')||!/^0x[0-9a-f]+$/i.test(block?.timestamp||''))throw fail('区块状态无法验证。');
 const underlying=request;request=(method,args=[])=>underlying(method,['eth_call','eth_getCode'].includes(method)?[args[0],block.number]:args);
 const [runtimeHash,tokenRuntimeHash]=await Promise.all([contractCode(request,config.distributionAddress,config.runtimeHash),contractCode(request,config.tokenAddress,config.tokenRuntimeHash)]);
 const fields=['token','sender','campaignId','totalAmount','recipientCount','claimStart','expiresAt','funded','refunded','remaining','totalPaid','totalRefunded'];
 const values=await Promise.all(fields.map(method=>call(request,equalInterface,config.distributionAddress,method)));
 const state=Object.fromEntries(fields.map((key,i)=>[key,values[i][0]]));
 if(address(state.token)!==config.tokenAddress||state.campaignId.toLowerCase()!==config.campaignId.toLowerCase())throw fail('链上活动与配置不一致，操作已停用。');
 if(state.recipientCount<1n||state.recipientCount>200n||state.totalAmount<state.recipientCount||state.claimStart>=state.expiresAt||state.expiresAt>BigInt(Number.MAX_SAFE_INTEGER))throw fail('链上活动参数无效。');
 const [decimalsResult,symbolResult]=await Promise.all([call(request,tokenInterface,config.tokenAddress,'decimals'),call(request,tokenInterface,config.tokenAddress,'symbol')]);
 const decimals=Number(decimalsResult[0]),symbol=symbolResult[0];
 if(!Number.isInteger(decimals)||decimals<0||decimals>18||typeof symbol!=='string'||!symbol.trim()||symbol.length>24||/[\x00-\x1f<>]/.test(symbol)||!/^0x[0-9a-f]+$/i.test(block?.timestamp||''))throw fail('测试代币或区块信息无法验证。');
 const now=Number(BigInt(block.timestamp));if(!Number.isSafeInteger(now))throw fail('区块时间无效。');
 let participant;
 if(viewer){const checked=address(viewer);const found=(await call(request,equalInterface,config.distributionAddress,'recipientIndex',[checked]))[0];if(found<0n||found>state.recipientCount)throw fail('参与资格数据无效。');if(found>0n){const index=Number(found-1n),p=await call(request,equalInterface,config.distributionAddress,'participants',[index]);participant={index,account:address(p.account),claimed:p.claimed,allocation:p.allocation,received:p.received};if(participant.account!==checked)throw fail('参与地址与固定名单不一致。');}}

 let tokenAmount=null,allowance=null,claimable=0n;
 if(viewer){const checked=address(viewer);const result=await Promise.all([call(request,tokenInterface,config.tokenAddress,'balanceOf',[checked]),call(request,tokenInterface,config.tokenAddress,'allowance',[checked,config.distributionAddress]),participant?call(request,equalInterface,config.distributionAddress,'claimable',[participant.index]):Promise.resolve([0n])]);tokenAmount=result[0][0];allowance=result[1][0];claimable=result[2][0];}
 return {...config,...state,runtimeHash,tokenRuntimeHash,decimals,symbol,now,participant,tokenAmount,allowance,claimable,formattedTotal:formatUnits(state.totalAmount,decimals),formattedRemaining:formatUnits(state.remaining,decimals),formattedTokenAmount:tokenAmount===null?null:formatUnits(tokenAmount,decimals),formattedClaimable:formatUnits(claimable,decimals)};
}
export function buildEqualAction(snapshot, action, from) {
 if(!snapshot.enabled||snapshot.mode!=='equal'||snapshot.chainId!==97)throw fail('等额链上内测未开放。','DISTRIBUTION_DISABLED');
 from=address(from);let to=snapshot.distributionAddress,data,title;
 if(action==='approve'){
  if(from!==snapshot.sender||snapshot.funded||snapshot.refunded||snapshot.now+60>Number(snapshot.claimStart))throw fail('当前账户或活动阶段不允许授权。','ACTION_UNAVAILABLE');
  if(snapshot.tokenAmount<snapshot.totalAmount)throw fail('测试代币数量不足。','TOKEN_INSUFFICIENT');
  if(snapshot.allowance!==0n)throw fail('已有授权，请刷新后使用；本入口不覆盖已有授权额度。','ALLOWANCE_EXISTS');
  to=snapshot.tokenAddress;data=tokenInterface.encodeFunctionData('approve',[snapshot.distributionAddress,snapshot.totalAmount]);title='授权本次测试代币';
 }else if(action==='fund'){
  if(from!==snapshot.sender||snapshot.funded||snapshot.refunded||snapshot.now+60>Number(snapshot.claimStart))throw fail('当前账户或活动阶段不允许供资。','ACTION_UNAVAILABLE');
  if(snapshot.tokenAmount<snapshot.totalAmount||snapshot.allowance<snapshot.totalAmount)throw fail('测试代币或授权额度不足，请刷新后核对。','TOKEN_INSUFFICIENT');
  data=equalInterface.encodeFunctionData('fund');title='为等额内测活动供资';
 }else if(action==='claim'){
  if(!snapshot.funded||snapshot.refunded||snapshot.now<Number(snapshot.claimStart)||snapshot.now>=Number(snapshot.expiresAt)||!snapshot.participant||snapshot.participant.account!==from||snapshot.participant.claimed||snapshot.claimable<=0n)throw fail('当前账户或活动阶段不能领取。','ACTION_UNAVAILABLE');
  data=equalInterface.encodeFunctionData('claim',[snapshot.participant.index]);title='领取等额测试代币';
 }else if(action==='refund'){
  if(!snapshot.funded||snapshot.refunded||snapshot.now<Number(snapshot.expiresAt))throw fail('尚未到可退回阶段。','ACTION_UNAVAILABLE');
  data=equalInterface.encodeFunctionData('refundExpired');title='触发到期退回原发送者';
 }else throw fail('不支持此链上操作。','ACTION_UNAVAILABLE');
 return {to,data,title,action,distributionAddress:snapshot.distributionAddress,tokenAddress:snapshot.tokenAddress,campaignId:snapshot.campaignId,runtimeHash:snapshot.runtimeHash,tokenRuntimeHash:snapshot.tokenRuntimeHash,symbol:snapshot.symbol,amount:action==='claim'?snapshot.formattedClaimable:action==='refund'?snapshot.formattedRemaining:snapshot.formattedTotal,recipient:action==='refund'?snapshot.sender:action==='claim'?from:snapshot.distributionAddress};
}
