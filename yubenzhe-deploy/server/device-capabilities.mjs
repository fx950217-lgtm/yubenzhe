import {fields,fail,text} from './social-validation.mjs';

const names=['screen','ai','files','autoStart'];
const states=new Set(['supported','partial','unsupported','unknown']);
export function deviceSource(value){if(!['local','cloud','server'].includes(value))fail(400,'INVALID_DEVICE_SOURCE','设备来源无效。');return value;}
export function validateDeviceCapabilities(input){
 fields(input,[...names,'headless']);const result={};
 for(const name of names)if(input[name]!==undefined){const item=input[name];fields(item,['state','reason']);if(!states.has(item.state))fail(400,'INVALID_DEVICE_CAPABILITY','设备能力状态无效。');result[name]={state:item.state,reason:text(item.reason??'',160,'能力说明')};}
 if(input.headless!==undefined){if(input.headless!==null&&typeof input.headless!=='boolean')fail(400,'INVALID_DEVICE_CAPABILITY','桌面检测结果无效。');result.headless=input.headless;}
 return result;
}
export function readDeviceCapabilities(device){
 let stored={};try{stored=validateDeviceCapabilities(JSON.parse(device.capabilities||'{}'));}catch{}
 return Object.fromEntries([...names.map(name=>[name,stored[name]||{state:'unknown',reason:'连接器尚未报告此项能力。'}]),['headless',stored.headless??null]]);
}
export function updateDeviceMetadata(db,device,input,now){
 const source=input.source===undefined?device.source:deviceSource(input.source);
 const capabilities=input.capabilities===undefined?null:validateDeviceCapabilities(input.capabilities);
 if(source!==device.source||capabilities!==null)db.prepare('UPDATE personal_devices SET source=?,capabilities=?,capabilities_at=? WHERE id=?').run(source,capabilities===null?device.capabilities:JSON.stringify({...readDeviceCapabilities(device),...capabilities}),now,device.id);
}
