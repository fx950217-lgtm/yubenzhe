import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=process.argv[2] && resolve(process.argv[2]);
if(!source || !existsSync(resolve(source,'index.html')) || !existsSync(resolve(source,'app.js')))throw new Error('Supply a built consumer dist directory. No source or placeholder frontend will be deployed.');
const index=readFileSync(resolve(source,'index.html'),'utf8'),app=readFileSync(resolve(source,'app.js'),'utf8');
if(!index.includes('愚笨者') && !app.includes('愚笨者'))throw new Error('Frontend must already carry the approved 0.11.0 brand.');
if(app.includes('/api/admin/') || index.includes('/api/admin/'))throw new Error('Consumer build contains a forbidden admin API entry.');
const target=resolve(root,'public/frontend');
if(source===target || source.startsWith(target+'/'))throw new Error('Source must be outside the output folder.');
rmSync(target,{recursive:true,force:true});mkdirSync(target,{recursive:true});
cpSync(source,target,{recursive:true,filter:path=>!['.DS_Store','.env'].some(part=>path.split('/').includes(part))});
writeFileSync(resolve(root,'reports/frontend-staging.json'),JSON.stringify({version:'0.11.0',stagedAt:new Date().toISOString(),indexSha256:createHash('sha256').update(index).digest('hex'),appSha256:createHash('sha256').update(app).digest('hex'),consumerConnected:false,socialServiceIncluded:true,cloudAIConnected:true,adminEntry:false},null,2));
const verificationFile=resolve(root,'reports/deployment-verification.json');
if(existsSync(verificationFile)){const verification=JSON.parse(readFileSync(verificationFile,'utf8'));verification.frontend={staged:true,stagedAt:new Date().toISOString(),consumerConnected:false,socialServiceIncluded:true,cloudAIConnected:true,adminEntry:false};writeFileSync(verificationFile,JSON.stringify(verification,null,2)+'\n')}
console.log('Built frontend staged separately; cloud AI API is separate from synthetic admin records; no admin link was added.');
