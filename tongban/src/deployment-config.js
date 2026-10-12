const defaults=Object.freeze({previewOrigin:'https://66.42.56.29',rpcUrls:['https://bsc-testnet-dataseed.bnbchain.org','https://bsc-testnet.bnbchain.org'],explorerUrl:'https://testnet.bscscan.com',faucetUrl:'https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/',ollamaDownloadUrl:'https://ollama.com/download'});
function httpsURL(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.port||url.hostname.endsWith('.cn'))throw Error('Invalid public deployment URL.');return url.href.replace(/\/$/,'');}
export function publicDeploymentFromEnvironment(env={}){
 const accessMode=env.YBZ_ACCESS_MODE||'internal-preview';
 if(!['internal-preview','public'].includes(accessMode))throw Error('Invalid YBZ_ACCESS_MODE.');
 const rpcUrls=env.BSC_TESTNET_RPC_URLS?JSON.parse(env.BSC_TESTNET_RPC_URLS):defaults.rpcUrls;
 if(!Array.isArray(rpcUrls)||!rpcUrls.length||rpcUrls.length>4)throw Error('Expected 1–4 public testnet RPC URLs.');
 const previewOrigin=httpsURL(env.YBZ_PREVIEW_ORIGIN||defaults.previewOrigin);if(new URL(previewOrigin).pathname!=='/')throw Error('YBZ_PREVIEW_ORIGIN must be an origin.');
 return {accessMode,previewOrigin,rpcUrls:rpcUrls.map(httpsURL),explorerUrl:httpsURL(env.BSC_TESTNET_EXPLORER_URL||defaults.explorerUrl),faucetUrl:httpsURL(env.BSC_TESTNET_FAUCET_URL||defaults.faucetUrl),ollamaDownloadUrl:httpsURL(env.OLLAMA_DOWNLOAD_URL||defaults.ollamaDownloadUrl)};
}
// Only the build process supplies this value; never accept endpoint configuration
// from query strings, local storage, a prompt or remote task output.
export const PUBLIC_DEPLOYMENT=Object.freeze(typeof __YBZ_PUBLIC_CONFIG__==='undefined'?publicDeploymentFromEnvironment():__YBZ_PUBLIC_CONFIG__);
