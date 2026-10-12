import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
import {SERVICE_DEFAULTS,validateDesktopRegion} from './desktop-config.mjs';
import {createAiProvider,readAiProviderConfiguration} from './ai-provider.mjs';
const list=(value,fallback)=>value?String(value).split(',').map(v=>v.trim()).filter(Boolean):[...fallback];
export function validateServiceURL(value,{allowedHosts=[],internal=false}={}){
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash||/[\s\\]/.test(value)||url.hostname.endsWith('.cn')||url.port&&url.port!=='443'&&!internal)throw Error('Invalid configured service URL.');
 if(internal){if(!allowedHosts.includes(url.hostname)||!['http:','https:'].includes(url.protocol))throw Error('Internal model host is not allowed.');}
 else if(url.protocol!=='https:'||isIP(url.hostname)||url.hostname==='localhost'||!url.hostname.includes('.')||url.hostname.endsWith('.local')||url.hostname.endsWith('.internal')||!allowedHosts.includes(url.hostname))throw Error('External service host is not allowed.');
 if(value.includes('%')||url.pathname.includes('//'))throw Error('Invalid service path.');
 return url.href.replace(/\/$/,'');
}
export function readDeploymentConfiguration(env=process.env){
 const aiHosts=list(env.AI_ALLOWED_HOSTS,SERVICE_DEFAULTS.aiAllowedHosts),ollamaHosts=list(env.OLLAMA_ALLOWED_HOSTS,SERVICE_DEFAULTS.ollamaAllowedHosts);
 const aiBaseUrl=validateServiceURL(env.AI_BASE_URL||SERVICE_DEFAULTS.aiBaseUrl,{allowedHosts:aiHosts});
 const ollamaBaseUrl=validateServiceURL(env.OLLAMA_BASE_URL||SERVICE_DEFAULTS.ollamaBaseUrl,{allowedHosts:ollamaHosts,internal:true});
 const rpcValues=env.BSC_TESTNET_RPC_URLS?JSON.parse(env.BSC_TESTNET_RPC_URLS):SERVICE_DEFAULTS.rpcUrls;
 if(!Array.isArray(rpcValues)||!rpcValues.length||rpcValues.length>4)throw Error('BSC_TESTNET_RPC_URLS must contain 1–4 public testnet endpoints.');
 const rpcUrls=rpcValues.map(value=>validateServiceURL(value,{allowedHosts:[new URL(value).hostname]}));
 return {region:validateDesktopRegion(env.DEPLOY_REGION||env.AWS_REGION||SERVICE_DEFAULTS.region),aiBaseUrl,ollamaBaseUrl,rpcUrls};
}
// Keep provider business behavior untouched. The process-owned transport maps only
// known adapter origins and paths; prompts, HTTP input and redirects cannot pick a host.
export function createConfiguredAiProvider({env=process.env,fetchImpl=fetch,timeoutMs}={}){
 const deployment=readDeploymentConfiguration(env),configuration=readAiProviderConfiguration(env);
 const original=new URL(configuration.type==='ollama'?SERVICE_DEFAULTS.ollamaBaseUrl:SERVICE_DEFAULTS.aiBaseUrl);
 const base=configuration.type==='ollama'?deployment.ollamaBaseUrl:deployment.aiBaseUrl;
 const paths=configuration.type==='ollama'?['/api/tags','/api/chat']:['/models','/responses'];
 const mappedFetch=(input,options)=>{const url=new URL(input),path=url.pathname.slice(original.pathname.replace(/\/$/,'').length);if(url.origin!==original.origin||url.search||url.hash||!paths.includes(path))throw Error('Unexpected provider request.');return fetchImpl(base+path,{...options,redirect:'error'});};
 const fingerprint=createHash('sha256').update(configuration.fingerprint+'\0'+base).digest('hex');
 return createAiProvider({configuration:{...configuration,fingerprint},fetchImpl:mappedFetch,timeoutMs});
}
