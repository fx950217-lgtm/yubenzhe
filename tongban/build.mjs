import { build } from 'esbuild';
import { mkdir, copyFile, writeFile, readFile, rm, rename, realpath, lstat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
const {version}=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
const stage=resolve(root,'.web-staging'),dist=resolve(root,'dist');
async function removeGenerated(path){
 const parent=await realpath(root);
 try{const info=await lstat(path);if(info.isSymbolicLink())throw Error('Refusing linked build output');
 const actual=await realpath(path);if(!actual.startsWith(parent+sep))throw Error('Output is outside project');
 await rm(actual,{recursive:true,force:true});}catch(error){if(error.code!=='ENOENT')throw error;}
}
await removeGenerated(stage);await mkdir(stage,{recursive:true});
try{
 await build({absWorkingDir:root,entryPoints:['src/app.js'],bundle:true,minify:true,outdir:stage,entryNames:'app',target:['es2022','safari15.4'],format:'esm',legalComments:'eof'});
 for(const name of ['sw.js','privacy.html','terms.html','icon.png','icon.svg','apple-touch-icon.png','manifest.webmanifest','install.html'])await copyFile(resolve(root,'src',name),resolve(stage,name));
 const index=(await readFile(resolve(root,'src/index.html'),'utf8')).replace('./app.js','./app.js?v='+version).replace('./app.css','./app.css?v='+version);
 await writeFile(resolve(stage,'index.html'),index);
 await writeFile(resolve(stage,'build-info.json'),JSON.stringify({version,builtAt:new Date().toISOString(),requirements:'V0.2',channel:'local-development'},null,2)+'\n');
 await writeFile(resolve(stage,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  Permissions-Policy: camera=(self), microphone=(), geolocation=()\n  Cache-Control: no-store\n');
 await removeGenerated(dist);await rename(stage,dist);
 console.log('Built Yubenzhe '+version);
}catch(error){await removeGenerated(stage);throw error;}
