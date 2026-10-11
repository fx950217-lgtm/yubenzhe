import {readFile,stat} from 'node:fs/promises';
const address=value=>typeof value==='string'&&/^0x[a-fA-F0-9]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const bytes32=value=>typeof value==='string'&&/^0x[a-fA-F0-9]{64}$/.test(value)&&!/^0x0{64}$/.test(value);
const disabled=()=>({enabled:false,chainId:97,mode:'equal',reason:'测试网分发合约尚未配置。'});
export async function readChainPreviewConfig(filename){
 if(!filename)return disabled();
 const info=await stat(filename);if(!info.isFile()||info.size>16384)throw Error('Invalid chain preview configuration.');
 const value=JSON.parse(await readFile(filename,'utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||value.chainId!==97||value.mode!=='equal')throw Error('Invalid chain preview configuration.');
 if(!value.enabled)return disabled();
 if(!address(value.distributionAddress)||!address(value.tokenAddress)||!bytes32(value.campaignId))throw Error('Invalid chain preview configuration.');
 const result={enabled:true,chainId:97,mode:'equal',distributionAddress:value.distributionAddress,tokenAddress:value.tokenAddress,campaignId:value.campaignId};
 for(const key of ['runtimeHash','tokenRuntimeHash'])if(value[key]!==undefined){if(!bytes32(value[key]))throw Error('Invalid chain preview configuration.');result[key]=value[key];}
 return Object.freeze(result);
}
