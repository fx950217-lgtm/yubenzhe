import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureCommand} from './probe-process.mjs';
import {probeAIRegistry,findProviderExecutable} from './ai-registry.mjs';
export {captureCommand} from './probe-process.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const item=(state,reason)=>({state,reason});
export const findCodex=options=>findProviderExecutable('codex',options);
export async function probeWritable(directory){let filename;try{await mkdir(directory,{recursive:true,mode:0o700});filename=path.join(directory,'.ybz-probe-'+randomUUID());await writeFile(filename,'probe',{flag:'wx',mode:0o600});await unlink(filename);return true;}catch{if(filename)await unlink(filename).catch(()=>{});return false;}}
export async function probeCapabilities({runtimeDir,workspace,autoStart=false,platform=process.platform,run=captureCommand,registryProbe=probeAIRegistry,ollamaModel=null}={}){
 const registry=await registryProbe({platform,run,ollamaModel});
 const ai=registry.providers.some(provider=>provider.executionSupported)?item('partial','有可用 AI；工具执行与文字对话能力请查看各 AI 标注。'):item('unsupported','当前没有通过检查的可执行 AI，请在本机查看安装、登录或模型设置。');
 let screen=item('unknown','尚未检测到可用交互桌面。'),headless=null;
 if(platform==='win32'){
  const probe=await run(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-File',path.join(here,'capability-probe.ps1')]);
  if(probe.code===0)try{const value=JSON.parse(probe.output.trim());headless=value.interactive===false;if(value.capture===true)screen=item('partial','屏幕采集可用；键鼠控制受当前桌面权限限制。');else if(value.interactive===false)screen=item('unsupported','没有可用的交互桌面，屏幕远控不可用。');else screen=item('unknown','检测到桌面，但无法核验屏幕采集。');}catch{}
  else screen=item('unknown','桌面检测未能运行，暂不开放远控；不按系统名称推断。');
 }else screen=item('unsupported','当前连接器仅支持 Windows 屏幕远控。');
 const writable=await probeWritable(runtimeDir)&&await probeWritable(workspace);
 return {executable:registry.executables?.codex||null,executables:registry.executables||{},providers:registry.providers,scannedAt:registry.scannedAt,capabilities:{screen,ai,files:writable?item('partial','目录可读写；加密通道启动后可传输，成果生成与下载需单独核对。'):item('unsupported','运行目录不可写，文件通道未启动。'),autoStart:platform==='win32'?item('supported',autoStart?'已开启登录后自启。':'可选；目前需手动启动。'):item('unsupported','需手动启动。'),headless}};
}
