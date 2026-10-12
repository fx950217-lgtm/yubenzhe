'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');

// A stop result is authoritative only after exit, not after sending a signal.
async function stopUtility(child,{softMs=8000,hardMs=5000,platform=process.platform,spawnImpl=spawn}={}){
 let exited=false;
 let exitResolve;
 const exit=new Promise(resolve=>{exitResolve=resolve;});
 const onExit=()=>{exited=true;exitResolve(true);};
 child.once('exit',onExit);
 const within=async(promise,ms)=>{let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}};
 try{
  try{child.postMessage({kind:'stop'});}catch{}
  if(await within(exit,softMs))return;
  if(exited)return;
  if(!Number.isInteger(child.pid)||child.pid<=0)throw Error('无法确认设备进程，未报告停止成功。');
  if(platform==='win32'){
   const killed=await within(new Promise(resolve=>{
    let killer;try{killer=spawnImpl(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});}catch{return resolve(false);}
    killer.once('error',()=>resolve(false));killer.once('exit',code=>resolve(code===0));
   }),hardMs);
   if(!killed)throw Error('结束设备进程树失败；请检查电脑，不能再次启动连接。');
  }else if(!child.kill())throw Error('结束设备进程失败。');
  if(!await within(exit,hardMs))throw Error('设备进程尚未确认退出；请检查电脑，不能再次启动连接。');
 }finally{child.removeListener('exit',onExit);}
}
module.exports={stopUtility};
