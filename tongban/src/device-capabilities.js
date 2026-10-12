const states = new Set(['supported', 'partial', 'unsupported', 'unknown']);
export const DEVICE_CAPABILITIES = Object.freeze([['screen', '屏幕远控'], ['ai', 'AI 任务'], ['files', '文件收发'], ['autoStart', '开机自启']]);
export function deviceSource(source) { return ({local:'本机',cloud:'云端',server:'服务器'})[source] || '来源未报告'; }
export function deviceCapability(device, key) {
  const value = device?.capabilities?.[key];
  const state = states.has(value?.state) ? value.state : 'unknown';
  return {state, label:({supported:'支持',partial:'部分支持',unsupported:'不支持',unknown:'未检测'})[state], reason:typeof value?.reason==='string'&&value.reason.trim()?value.reason.slice(0,160):state==='unknown'?'尚未收到设备检测结果，请在电脑端启动或更新连接器。':state==='unsupported'?'此设备当前不具备该能力。':state==='partial'?'存在使用条件，请在电脑端查看。':'电脑端已报告就绪。'};
}
export function deviceCanAttempt(device, key) { return deviceCapability(device,key).state!=='unsupported'; }
export function normalizeMachineCode(value) {
  const compact=String(value||'').toUpperCase().replace(/[\s-]/g,'').replace(/^YBZ/,'');
  if(!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(compact))throw Error('请输入电脑显示的 8 位机器码，例如 YBZ-7K2M-9QX4。');
  return 'YBZ-'+compact.slice(0,4)+'-'+compact.slice(4);
}
