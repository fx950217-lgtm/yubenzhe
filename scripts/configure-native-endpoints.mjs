import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function renderNativeDeployment(input,target){
 const config={...input,accessMode:input?.accessMode??'internal-preview'};
 if(!['internal-preview','public'].includes(config.accessMode))throw Error('Native access mode must explicitly be public or internal-preview.');
 const origin=new URL(config.previewOrigin);
 if(origin.protocol!=='https:'||origin.origin!==config.previewOrigin||origin.username||origin.password)throw Error('Native deployment requires an explicit HTTPS origin.');
 if(target==='windows')return "'use strict';\n// Generated from the verified web build. Configure build environment, not this file.\nmodule.exports = Object.freeze("+JSON.stringify(config,null,2)+");\n";
 if(target==='android')return 'package app.tongban.wallet.demo;\n\n// Generated from the verified web build; no secrets.\npublic final class DeploymentConfig {\n    private DeploymentConfig() {}\n    public static final String PREVIEW_ORIGIN = '+JSON.stringify(config.previewOrigin)+';\n    public static final String ACCESS_MODE = '+JSON.stringify(config.accessMode)+';\n    public static final String DOWNLOAD_URL = '+JSON.stringify(config.ollamaDownloadUrl)+';\n    public static final String PREVIEW_HOST = '+JSON.stringify(origin.hostname)+';\n    public static final String[] RPC_URLS = {'+config.rpcUrls.map(v=>JSON.stringify(v.replace(/\/$/,''))).join(', ')+'};\n    public static final String[] EXTERNAL_HOSTS = {'+[config.explorerUrl,config.faucetUrl,'https://docs.ethers.org','https://docs.ollama.com'].map(v=>JSON.stringify(new URL(v).hostname)).join(', ')+'};\n}\n';
 throw Error('Expected windows or android');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const config=JSON.parse(await readFile(resolve(root,'tongban/dist/public-deployment.json'),'utf8'));
 const target=process.argv[2],content=renderNativeDeployment(config,target);
 const file=target==='windows'?'yubenzhe-desktop/src/deployment.cjs':'tongban-android/android/app/src/main/java/app/tongban/wallet/demo/DeploymentConfig.java';
 await writeFile(resolve(root,file),content);
 console.log('Synchronized '+target+' network policy with web deployment configuration.');
}
