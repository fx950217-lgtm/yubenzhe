import { writeFileSync } from 'node:fs';
import { passwordRecord } from '../server/auth.mjs';
const [username,file,identity='acceptance-owner']=process.argv.slice(2);
if(!username || !file || process.stdin.isTTY){console.error('Usage: supply a 16–256 character password via stdin: node scripts/create-auth.mjs <username> <new-output-file> [stable-owner-id]');process.exit(1)}
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>1024)throw new Error('Password input too long')}
const record=await passwordRecord(username,input.replace(/\r?\n$/,''),identity);input='';
writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log('Authentication hash file created. Existing files are never overwritten; password was not printed.');
