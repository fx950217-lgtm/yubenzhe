import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../App/bridge.js', import.meta.url), 'utf8');
function setup(respond) {
  const context = vm.createContext({ window: { webkit: { messageHandlers: { exportJSON: { postMessage: respond } } } } });
  vm.runInContext(source, context); return context.window;
}
test('native export preserves cancellation and validates responses', async () => {
  const cancelled = setup(async () => ({ saved: false }));
  assert.equal((await cancelled.YubenzheNative.saveJsonFile({})).saved, false);
  assert.equal((await cancelled.YubenzheNative.saveJsonFile({})).method, 'ios');
  const invalid = setup(async () => ({ saved: 'yes' }));
  await assert.rejects(invalid.YubenzheNative.saveJsonFile({}));
  const failed = setup(async () => { throw Error('disk failure'); });
  await assert.rejects(failed.YubenzheNative.saveJsonFile({}), /disk failure/);
});
test('background event has agreed payload, fails closed without listeners, supports removal', () => {
  const win = setup(async () => ({ saved: true }));
  assert.equal(win.__ybAppState(false), false);
  const events = []; const remove = win.YubenzheNative.onAppStateChange(event => events.push(event.isActive));
  assert.equal(win.__ybAppState(false), true);
  assert.equal(win.__ybAppState(true), true);
  assert.deepEqual(events, [false, true]);
  remove(); assert.equal(win.__ybAppState(false), false);
});
test('bridge identity and lifecycle dispatcher cannot be replaced by app code', () => {
  const win = setup(async () => ({ saved: true }));
  assert.equal(win.YubenzheNative.platform, 'ios');
  assert.equal(Object.isFrozen(win.YubenzheNative), true);
  assert.throws(() => Object.defineProperty(win, 'YubenzheNative', { value: {} }));
  assert.throws(() => Object.defineProperty(win, '__ybAppState', { value() {} }));
});
test('background listener failure prevents a successful lock acknowledgement', () => {
  const win = setup(async () => ({ saved: true }));
  win.YubenzheNative.onAppStateChange(() => { throw Error('lock failed'); });
  assert.throws(() => win.__ybAppState(false), /lock failed/);
});
