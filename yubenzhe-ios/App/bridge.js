(() => {
  'use strict';
  const listeners = new Set();
  const bridge = Object.freeze({
    platform: 'ios',
    saveJsonFile(input) {
      return window.webkit.messageHandlers.exportJSON.postMessage(input).then(result => {
        if (!result || typeof result.saved !== 'boolean') throw new Error('未能确认文件保存结果。');
        return { saved: result.saved, method: 'ios' };
      });
    },
    onAppStateChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener required');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
  Object.defineProperty(window, 'YubenzheNative', { value: bridge, writable: false, configurable: false });
  Object.defineProperty(window, '__ybAppState', { value(active) {
    if (!listeners.size) return false;
    for (const callback of listeners) callback({ isActive: !!active });
    return true;
  }, writable: false, configurable: false });
})();
