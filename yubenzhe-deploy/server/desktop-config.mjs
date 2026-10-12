import {readFileSync,statSync} from 'node:fs';
import {decodeDesktopCredentialKey} from './desktop-store.mjs';
export const SERVICE_DEFAULTS=Object.freeze(JSON.parse(readFileSync(new URL('./service-defaults.json',import.meta.url),'utf8')));
export const DESKTOP_REGIONS=Object.freeze([...SERVICE_DEFAULTS.regions]);
export function validateDesktopRegion(region){if(!DESKTOP_REGIONS.includes(region))throw Error('DESKTOP_REGION must be an approved overseas region.');return region;}
export function readDesktopConfiguration(env=process.env){
 const provider=env.DESKTOP_PROVIDER||'disabled';let region=SERVICE_DEFAULTS.region,credentials=null,credentialKey=null,valid=true;
 try{
  region=validateDesktopRegion(env.DESKTOP_REGION||env.AWS_REGION||region);
  if(!['disabled','aws-workspaces'].includes(provider))throw Error();
  if(env.DESKTOP_CREDENTIALS_FILE){const info=statSync(env.DESKTOP_CREDENTIALS_FILE);if(!info.isFile()||info.size>16384||(process.platform!=='win32'&&(info.mode&0o077)))throw Error();credentials=JSON.parse(readFileSync(env.DESKTOP_CREDENTIALS_FILE,'utf8'));if(!credentials||typeof credentials!=='object'||Array.isArray(credentials))throw Error();}
  if(env.DESKTOP_CRED_KEY)credentialKey=decodeDesktopCredentialKey(env.DESKTOP_CRED_KEY);
 }catch{valid=false;credentials=null;credentialKey=null;}
 let clientDownloadUrls={...SERVICE_DEFAULTS.desktopClients};
 try{if(env.DESKTOP_CLIENT_URLS_JSON){const value=JSON.parse(env.DESKTOP_CLIENT_URLS_JSON);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!Object.hasOwn(clientDownloadUrls,key)))throw Error();for(const [key,url]of Object.entries(value)){const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash||!SERVICE_DEFAULTS.desktopClientHosts.includes(parsed.hostname)||parsed.port)throw Error();clientDownloadUrls[key]=parsed.href;}}}catch{valid=false;}
 return {provider,region,credentials,credentialKey,valid,clientDownloadUrls};
}
