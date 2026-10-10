import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {passwordRecord} from '../server/auth.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.M0_PORT||18914);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('M0_PORT must be 1024–65535');
const state=resolve(process.env.M0_STATE_DIR||resolve(root,'../../yubenzhe-m0-state'));
await mkdir(state,{recursive:true,mode:0o700});
const authFile=resolve(state,'access-hash.json'),otpFile=resolve(state,'otp-secret');
try{await stat(authFile);}catch{await writeFile(authFile,JSON.stringify(await passwordRecord('local-m0',randomBytes(32).toString('base64url'),'local-m0-private')),{flag:'wx',mode:0o600});}
try{await stat(otpFile);}catch{await writeFile(otpFile,randomBytes(48).toString('base64url'),{flag:'wx',mode:0o600});}
Object.assign(process.env,{ROLE:'frontend',PORT:String(port),BIND_HOST:'127.0.0.1',PUBLIC_ORIGIN:'http://localhost:'+port,PUBLIC_FRONTEND:'true',M0_SIMULATION:'true',AUTH_CONFIG_FILE:authFile,EMAIL_OTP_SECRET:(await readFile(otpFile,'utf8')).trim(),SOCIAL_DATABASE_PATH:resolve(state,'social.sqlite'),AI_DATABASE_PATH:resolve(state,'ai.sqlite'),STATIC_ROOT:resolve(root,'../tongban/dist')});
delete process.env.PUSH_CONFIG_FILE;
// M0 never inherits configured production model keys into its optional old text
// workspace. It is a file parser trial, not a billable provider connection.
delete process.env.OPENAI_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.AI_API_KEY_FILE;
process.env.AI_PROVIDER='disabled';
console.log('本地 M0：http://localhost:'+port+' · 模拟邮件 / 模拟资产 / 文件解析测试；没有公开部署。');
await import('../server/start.mjs');
