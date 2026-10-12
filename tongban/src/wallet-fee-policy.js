const MAX_WEI_PER_GAS=10n**12n;
const feeError=()=>Object.assign(new Error('网络手续费数据异常，已阻止交易。'),{code:'FEE_INVALID'});
function positive(value){if(typeof value!=='bigint'||value<=0n||value>MAX_WEI_PER_GAS)throw feeError();return value;}
// EIP-1559: maximum fee is a cap, not a promise of the eventual receipt fee.
// Mainnet networks remain disabled; this policy is exercised with local fixtures.
export function transactionFeeFields(model,{gasPrice,baseFeePerGas,maxPriorityFeePerGas}={}){
  if(model==='legacy')return {type:0,gasPrice:positive(gasPrice)};
  if(model!=='eip1559'||typeof baseFeePerGas!=='bigint'||baseFeePerGas<0n||baseFeePerGas>MAX_WEI_PER_GAS)throw feeError();
  const priority=positive(maxPriorityFeePerGas),maximum=baseFeePerGas*2n+priority;
  return {type:2,maxFeePerGas:positive(maximum),maxPriorityFeePerGas:priority};
}
export const feeCap=fields=>fields.type===2?fields.maxFeePerGas:fields.gasPrice;
export function sameFeeFields(a,b){return a.type===b.type&&(a.type===2?a.maxFeePerGas===b.maxFeePerGas&&a.maxPriorityFeePerGas===b.maxPriorityFeePerGas:a.gasPrice===b.gasPrice);}
