import {spawn} from 'node:child_process';
import {access,realpath,stat,mkdir,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const item=(state,reason)=>({state,reason});
export function captureCommand(executable,args,{timeout=12000,spawnImpl=spawn}={}){
 return new Promise(resolve=>{let child,output='',settled=false;const finish=(code,error)=>{if(settled)return;settled=true;clearTimeout(timer);resolve({code,output,error});};
 const timer=setTimeout(()=>{child?.kill();finish(null,'timeout');},timeout);timer.unref?.();
 try{child=spawnImpl(executable,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}catch{finish(null,'unavailable');return;}
 for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{output=(output+chunk).slice(0,8192);});
 child.once('error',()=>finish(null,'unavailable'));child.once('close',code=>finish(code));
 });
}
export async function findCodex({home=os.homedir(),env=process.env,platform=process.platform}={}){
 if(platform!=='win32')return null;
 const candidates=[path.join(home,'.codex','.sandbox-bin','codex.exe'),path.join(env.APPDATA||path.join(home,'AppData','Roaming'),'npm','node_modules','@openai','codex','node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin','codex.exe')];
 const located=await captureCommand(path.join(env.SystemRoot||'C:\\Windows','System32','where.exe'),['codex.exe']);
 if(located.code===0)candidates.push(...located.output.split(/\r?\n/).filter(x=>path.isAbsolute(x)&&/\\codex\.exe$/i.test(x)));
 for(const candidate of candidates)try{const full=await realpath(candidate);if((await stat(full)).isFile())return full;}catch{}
 return null;
}
export async function probeWritable(directory){let filename;try{await mkdir(directory,{recursive:true,mode:0o700});filename=path.join(directory,'.ybz-probe-'+randomUUID());await writeFile(filename,'probe',{flag:'wx',mode:0o600});await unlink(filename);return true;}catch{if(filename)await unlink(filename).catch(()=>{});return false;}}
export async function probeCapabilities({runtimeDir,workspace,autoStart=false,platform=process.platform,run=captureCommand,codex=findCodex}={}){
 const executable=await codex();
 const login=executable?await run(executable,['login','status']):null;
 const ai=!executable?item('unsupported','未安装 Codex，请从官方来源安装并由本人登录。'):login.code===0?item('partial','Codex 已登录；实际工具执行仍须由任务验证。'):login.error?item('unknown','无法核验 Codex 登录状态，请在本机检查。'):item('unsupported','Codex 尚未登录，请由本人完成登录。');
 let screen=item('unknown','尚未检测到可用交互桌面。'),headless=null;
 if(platform==='win32'){
  const probe=await run(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-File',path.join(here,'capability-probe.ps1')]);
  if(probe.code===0)try{const value=JSON.parse(probe.output.trim());headless=value.interactive===false;if(value.capture===true)screen=item('partial','屏幕采集可用；键鼠控制受当前桌面权限限制。');else if(value.interactive===false)screen=item('unsupported','没有可用的交互桌面，屏幕远控不可用。');else screen=item('unknown','检测到桌面，但无法核验屏幕采集。');}catch{}
  else screen=item('unknown','桌面检测未能运行，暂不开放远控；不按系统名称推断。');
 }else screen=item('unsupported','当前连接器仅支持 Windows 屏幕远控。');
 const writable=await probeWritable(runtimeDir)&&await probeWritable(workspace);
 return {executable,capabilities:{screen,ai,files:writable?item('partial','目录可读写；加密通道启动后可传输，成果生成与下载需单独核对。'):item('unsupported','运行目录不可写，文件通道未启动。'),autoStart:platform==='win32'?item('supported',autoStart?'已开启登录后自启。':'可选；目前需手动启动。'):item('unsupported','需手动启动。'),headless}};
}
