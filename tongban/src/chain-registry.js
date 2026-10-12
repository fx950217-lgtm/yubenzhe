import {PUBLIC_DEPLOYMENT} from './deployment-config.js';

export const DEFAULT_CHAIN_ID = 97;
const disabledReason = '主网尚未授权，当前不可连接或签名。';
const entry = value => Object.freeze({...value,rpcUrls:Object.freeze([...value.rpcUrls])});
// Mainnet metadata is intentionally inert: no endpoint, remote flag, local-storage
// preference or DApp request can enable a network. Activation requires a reviewed build.
export const CHAIN_REGISTRY = Object.freeze([
  entry({chainId:97,name:'BSC 测试网',symbol:'tBNB',explorer:PUBLIC_DEPLOYMENT.explorerUrl,rpcUrls:PUBLIC_DEPLOYMENT.rpcUrls,testnet:true,enabled:true,reason:'',feeModel:'legacy'}),
  entry({chainId:56,name:'BNB Chain',symbol:'BNB',explorer:'https://bscscan.com',rpcUrls:[],testnet:false,enabled:false,reason:disabledReason,feeModel:'legacy'}),
  entry({chainId:1,name:'Ethereum',symbol:'ETH',explorer:'https://etherscan.io',rpcUrls:[],testnet:false,enabled:false,reason:disabledReason,feeModel:'eip1559'}),
  entry({chainId:137,name:'Polygon',symbol:'POL',explorer:'https://polygonscan.com',rpcUrls:[],testnet:false,enabled:false,reason:disabledReason,feeModel:'eip1559'}),
  entry({chainId:42161,name:'Arbitrum One',symbol:'ETH',explorer:'https://arbiscan.io',rpcUrls:[],testnet:false,enabled:false,reason:disabledReason,feeModel:'eip1559'}),
]);
export function getChain(chainId) {
  return Number.isSafeInteger(chainId)?CHAIN_REGISTRY.find(chain=>chain.chainId===chainId)||null:null;
}
export function getEnabledChain(chainId) {
  const chain=getChain(chainId);
  if(!chain)throw Object.assign(new Error('不支持这个网络。'),{code:'NETWORK_UNSUPPORTED'});
  if(!chain.enabled||!chain.rpcUrls.length)throw Object.assign(new Error(chain.reason||'网络尚未启用。'),{code:'NETWORK_DISABLED'});
  return chain;
}
