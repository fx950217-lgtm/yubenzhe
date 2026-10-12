import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const config=JSON.parse(await readFile(resolve(root,'tongban/dist/public-deployment.json'),'utf8'));
const target=process.argv[2];
if(target==='windows')await writeFile(resolve(root,'yubenzhe-desktop/src/deployment.cjs'),"'use strict';\n// Generated from the verified web build. Configure build environment, not this file.\nmodule.exports = Object.freeze("+JSON.stringify(config,null,2)+");\n");
else if(target==='android')await writeFile(resolve(root,'tongban-android/android/app/src/main/java/app/tongban/wallet/demo/DeploymentConfig.java'),
'package app.tongban.wallet.demo;\n\n// Generated from the verified web build; no secrets.\npublic final class DeploymentConfig {\n    private DeploymentConfig() {}\n    public static final String PREVIEW_ORIGIN = '+JSON.stringify(config.previewOrigin)+';\n    public static final String DOWNLOAD_URL = '+JSON.stringify(config.ollamaDownloadUrl)+';\n    public static final String PREVIEW_HOST = '+JSON.stringify(new URL(config.previewOrigin).hostname)+';\n    public static final String[] RPC_URLS = {'+config.rpcUrls.map(v=>JSON.stringify(v.replace(/\/$/,''))).join(', ')+'};\n    public static final String[] EXTERNAL_HOSTS = {'+[config.explorerUrl,config.faucetUrl,'https://docs.ethers.org','https://docs.ollama.com'].map(v=>JSON.stringify(new URL(v).hostname)).join(', ')+'};\n}\n');
else throw Error('Expected windows or android');
console.log('Synchronized '+target+' network policy with web deployment configuration.');
