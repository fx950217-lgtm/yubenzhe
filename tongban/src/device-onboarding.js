import {normalizeMachineCode} from './device-capabilities.js';

export const DEVICE_ONBOARDING_SEEN_KEY='ybz.device-onboarding.seen.v1';
export const DEVICE_INSTALL_URL='https://66.42.56.29/install.html';
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const localStorageOrNull=()=>{try{return globalThis.localStorage;}catch{return null;}};

/** The seen flag belongs to this installation, never to an account or its devices. */
export function createDeviceOnboarding({client,storage=localStorageOrNull(),mount=mountDeviceOnboarding,onPaired=()=>{}}){
 let owner=null,revision=0,attempted=false,seen=false,disposed=false,closeGuide=null,claiming=false;
 const hasSeen=()=>{try{return seen||storage?.getItem(DEVICE_ONBOARDING_SEEN_KEY)==='1';}catch{return seen;}};
 const close=()=>{const cleanup=closeGuide;closeGuide=null;cleanup?.();};
 function syncOwner(profile){
  const next=profile?.userId||null;
  if(next===owner)return;
  revision++;owner=next;attempted=false;claiming=false;close();
 }
 async function check(){
  if(disposed)return false;
  syncOwner(client.getProfile());
  if(!owner||attempted||hasSeen())return false;
  attempted=true;
  const account=owner,run=revision;
  const valid=()=>!disposed&&run===revision&&owner===account&&client.getProfile()?.userId===account;
  try{
   // A separate read key avoids invalidating a device page's concurrent GET in social-client.
   const result=await client.authenticatedRequest('devices?view=onboarding',{method:'GET'});
   // Failure, missing payloads and responses from an old session are not empty lists.
   if(!valid()||!Array.isArray(result?.devices)||result.devices.length!==0||hasSeen())return false;
   closeGuide=mount({
    claim:async value=>{
     if(!valid()||!closeGuide)throw Error('账号已变化，请在当前账号的“我的设备”中配对。');
     if(claiming)throw Error('正在配对，请稍候。');
     const code=normalizeMachineCode(value);claiming=true;
     try{
      const response=await client.authenticatedRequest('devices/claim',{method:'POST',input:{code}});
      if(!valid()||!closeGuide)return null;
      if(!response?.device?.id)throw Error('配对结果尚未确认，请到“我的设备”核对。');
      return response.device;
     }finally{if(valid())claiming=false;}
    },
    onSkip:()=>{if(valid())close();},
    onPaired:device=>{if(!valid()||!closeGuide)return;close();onPaired(device);}
   });
   seen=true;
   try{storage?.setItem(DEVICE_ONBOARDING_SEEN_KEY,'1');}catch{/* The current page still remembers dismissal when storage is unavailable. */}
   return true;
  }catch{return false;}
 }
 return {check,syncOwner,dismiss:()=>{if(!closeGuide)return false;close();return true;},dispose:()=>{disposed=true;revision++;close();}};
}

/** A native dialog keeps focus in the guide, with Skip and Escape always available. */
export function mountDeviceOnboarding({claim,onSkip,onPaired,document=globalThis.document}){
 const dialog=document.createElement('dialog'),previousFocus=document.activeElement;
 dialog.className='device-onboarding';dialog.setAttribute('aria-labelledby','device-onboarding-title');
 let active=true,step=0,busy=false,error='',code='';
 const titles=['人做决策，机器干活','去电脑装 YBZ','找到电脑上的机器码','输入机器码，连接电脑'];
 const symbol=()=>'<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="8" width="34" height="24" rx="3"/><path d="M17 40h14M24 32v8M18 19l4 4 8-8"/></svg>';
 function render(){
  if(!active)return;
  const contents=[
   '<p>你决定目标，授权后让电脑上的 AI 帮你落实。</p>',
   '<p>在你的电脑上打开下载页，安装并启动 YBZ 电脑版。</p><a class="device-onboarding-primary" href="'+DEVICE_INSTALL_URL+'">打开电脑版下载页</a><small>手机和电脑使用同一个下载地址。</small>',
   '<p>启动电脑版后，找到它显示的 8 位机器码。</p><div class="device-onboarding-code" aria-label="机器码格式示例">YBZ-7K2M-9QX4</div><small>这是格式示例，请使用你自己电脑上当前显示的代码。</small>',
   '<p>输入你自己电脑上显示的机器码，点击后才会配对。</p><form data-onboarding-form><label for="device-onboarding-code">8 位机器码</label><input id="device-onboarding-code" name="machineCode" value="'+escapeHTML(code)+'" placeholder="YBZ-7K2M-9QX4" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" required '+(busy?'disabled':'')+' aria-describedby="device-onboarding-error"><p id="device-onboarding-error" class="device-onboarding-error" role="alert">'+escapeHTML(error)+'</p><button class="device-onboarding-primary" type="submit" '+(busy?'disabled':'')+'>'+(busy?'正在配对…':'连接我的电脑')+'</button></form><small>连接后，设备会加入你的设备列表和消息列表，仅你可见。</small>'
  ];
  dialog.innerHTML='<header><span class="device-onboarding-progress" aria-label="第 '+(step+1)+' 步，共 4 步">'+(step+1)+' / 4</span><button type="button" data-onboarding="skip">跳过</button></header><div class="device-onboarding-body">'+symbol()+'<h2 id="device-onboarding-title" tabindex="-1">'+titles[step]+'</h2>'+contents[step]+'</div><footer>'+(step>0?'<button type="button" data-onboarding="back" '+(busy?'disabled':'')+'>上一步</button>':'')+(step<3?'<button type="button" data-onboarding="next" class="'+(step===1?'device-onboarding-next':'device-onboarding-primary')+'">'+(step===0?'开始连接':step===1?'已安装，下一步':'输入机器码')+'</button>':'')+'</footer>';
 }
 const focusStep=()=>dialog.querySelector(step===3?'input':'h2')?.focus();
 const click=event=>{
  const action=event.target.closest('[data-onboarding]')?.dataset.onboarding;
  if(!active||!action)return;
  if(action==='skip'){onSkip();return;}
  if(busy)return;
  if(action==='next'&&step<3)step++;
  else if(action==='back'&&step>0)step--;
  else return;
  error='';render();focusStep();
 };
 const input=event=>{if(active&&event.target.name==='machineCode')code=event.target.value;};
 const submit=async event=>{
  if(!event.target.matches('[data-onboarding-form]'))return;
  event.preventDefault();
  if(!active||step!==3||busy)return;
  busy=true;error='';render();
  try{const device=await claim(code);if(active&&device)onPaired(device);}
  catch(reason){if(active)error=reason?.message||'连接暂未确认，请到“我的设备”核对后再试。';}
  finally{if(active){busy=false;render();focusStep();}}
 };
 const cancel=event=>{event.preventDefault();if(active)onSkip();};
 dialog.addEventListener('click',click);dialog.addEventListener('input',input);dialog.addEventListener('submit',submit);dialog.addEventListener('cancel',cancel);
 try{render();document.body.append(dialog);dialog.showModal();focusStep();}
 catch(reason){active=false;dialog.remove();throw reason;}
 return ()=>{if(!active)return;active=false;code='';dialog.removeEventListener('click',click);dialog.removeEventListener('input',input);dialog.removeEventListener('submit',submit);dialog.removeEventListener('cancel',cancel);dialog.close();dialog.remove();if(previousFocus?.isConnected)previousFocus.focus();};
}
