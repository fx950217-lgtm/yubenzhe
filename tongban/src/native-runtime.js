// Native bridges expose only document export and lifecycle events.
export function isAndroidApp() {
  return globalThis.Capacitor?.getPlatform?.() === 'android';
}

export function getNativePlatform() {
  if (isAndroidApp()) return 'android';
  if (globalThis.YubenzheDesktop?.platform === 'windows') return 'windows';
  if (globalThis.YubenzheNative?.platform === 'ios') return 'ios';
  return 'web';
}

export function isNativeApp() { return getNativePlatform() !== 'web'; }

function plugin(name) {
  const bridge = globalThis.Capacitor;
  if (!bridge?.isPluginAvailable?.(name) || !bridge.Plugins?.[name]) {
    throw new Error('安卓组件暂不可用，请保留本机数据并更新安装包。');
  }
  return bridge.Plugins[name];
}

export async function saveJsonFile({ filename, mimeType = 'application/json', content }) {
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.json$/.test(filename) ||
      mimeType.split(';')[0] !== 'application/json' || typeof content !== 'string') {
    throw new Error('导出文件格式无效。');
  }
  if (new TextEncoder().encode(content).length > 256 * 1024) throw new Error('导出文件过大，请缩减内容后重试。');
  JSON.parse(content);
  const platform = getNativePlatform();
  if (platform === 'windows' || platform === 'ios') {
    const bridge = platform === 'windows' ? globalThis.YubenzheDesktop : globalThis.YubenzheNative;
    const save = platform === 'windows' ? bridge.saveJson : bridge.saveJsonFile;
    if (typeof save !== 'function') throw new Error('文件保存组件暂不可用，请更新安装包。');
    const result = await save.call(bridge, { filename, mimeType: 'application/json', content });
    if (typeof result?.saved !== 'boolean') throw new Error('未能确认文件已保存，请重试。');
    return { saved: result.saved, method: platform };
  }
  if (isAndroidApp()) {
    const result = await plugin('SaveDocument').save({ filename, mimeType: 'application/json', content });
    if (typeof result?.saved !== 'boolean') throw new Error('未能确认文件已保存，请重试。');
    return { saved: result.saved, method: 'android' };
  }
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  try { document.body.append(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  // A browser only confirms that a download was requested, not written to disk.
  return { saved: true, method: 'browser-download' };
}

export async function installAndroidControls({ onBackground, onBack, onError = () => {} }) {
  const platform = getNativePlatform();
  if (platform === 'web') return;
  if (platform === 'windows' || platform === 'ios') {
    document.documentElement.classList.add(`native-${platform}`);
    try {
      const bridge = platform === 'windows' ? globalThis.YubenzheDesktop : globalThis.YubenzheNative;
      const listen = platform === 'windows' ? bridge.onBackground : bridge.onAppStateChange;
      if (typeof listen !== 'function') throw new Error('missing lifecycle');
      return await listen.call(bridge, platform === 'windows' ? onBackground : ({isActive}) => { if (!isActive) onBackground(); });
    } catch {
      onBackground();
      onError('应用控制组件暂不可用，钱包已锁定。请保留数据并更新安装包。');
      return;
    }
  }
  document.documentElement.classList.add('native-android');
  try {
    const app = plugin('App');
    await app.addListener('appStateChange', ({ isActive }) => { if (!isActive) onBackground(); });
    await app.addListener('backButton', async () => {
      try { if (!onBack()) await app.minimizeApp(); }
      catch { onError('返回操作暂未完成，请使用页面内的返回按钮。'); }
    });
  } catch {
    onBackground();
    onError('安卓控制组件暂不可用，钱包已锁定。请保留数据并更新安装包。');
  }
}
