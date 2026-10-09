import { resolve } from 'node:path';
import { writeFile,readFile,chmod } from 'node:fs/promises';
import webpush from 'web-push';
const [file,subject]=process.argv.slice(2);
if(!file||!subject||!/^https:\/\//.test(subject))throw Error('Usage: create-push-config.mjs <new-or-existing-key-file> <public-https-origin>');
const target=resolve(file);let config;
try{config=JSON.parse(await readFile(target,'utf8'));webpush.setVapidDetails(config.subject,config.publicKey,config.privateKey);console.log('Existing push identity verified; keys unchanged.');}
catch(error){if(error.code!=='ENOENT')throw error;config={subject,...webpush.generateVAPIDKeys()};await writeFile(target,JSON.stringify(config),{flag:'wx',mode:0o600});await chmod(target,0o600);console.log('Push identity created. Private key was not printed.');}
