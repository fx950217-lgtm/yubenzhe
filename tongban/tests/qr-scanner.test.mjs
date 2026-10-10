import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { getAddress } from 'ethers';

const source = (await readFile(new URL('../src/qr-scanner.js', import.meta.url), 'utf8'))
  .replace("import './qr-scanner.css';", '')
  .replace("from 'jsqr'", `from '${import.meta.resolve('jsqr')}'`)
  .replace("from 'ethers'", `from '${import.meta.resolve('ethers')}'`);
const { parseScanPayload, mountQrScanner, validateQrImageFile, validateQrImageDimensions, inspectQrImage, stopMediaTracks } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const address = '0x52908400098527886E0F7030069857D2E4169EE7';
const otherAddress = '0xde709f2102306220921060314715629080e2fb77';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('address parser canonicalizes bare and explicit BSC testnet addresses and discards every amount', () => {
  assert.deepEqual(parseScanPayload(`  ${address.toLowerCase()} \n`), { kind: 'address', address, chainId: 97, networkExplicit: false });
  for (const payload of [`ethereum:${address}@97`, `ethereum:pay-${address}@97?value=1e18`, `ethereum:${address}@97?value=0.123456`]) {
    assert.deepEqual(parseScanPayload(payload), { kind: 'address', address, chainId: 97, networkExplicit: true });
  }
  assert.equal(parseScanPayload(otherAddress, 'transfer').address, getAddress(otherAddress));
});

test('parser rejects zero/checksum errors, unsupported chains, contract functions, URLs and secret-like content', () => {
  const invalid = [
    `0x${'0'.repeat(40)}`, address.replace('E0F', 'E0f'), `ethereum:${address}@56`, `ethereum:${address}@1`, `ethereum:${address}@097`,
    `ethereum:${address}`, `ethereum:${address}@97/transfer?address=${otherAddress}`, `ethereum:${address}@97?value=1&value=2`,
    `ethereum:${address}@97?value=1&gas=21000`, `ethereum:${address}@97?foo=bar`, `ethereum:${address}@97?value=-1`,
    `https://example.com/${address}`, `javascript:alert(1)`, `{"address":"${address}"}`, `0x${'1'.repeat(64)}`,
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'x'.repeat(2049), '', null,
  ];
  for (const payload of invalid) assert.throws(() => parseScanPayload(payload), undefined, String(payload));
});

test('friend IDs use an exact allowlist and the two destination modes cannot be confused', () => {
  assert.deepEqual(parseScanPayload('tongban://friend/Lime_123_abc'), { kind: 'friend', id: 'lime_123_abc' });
  assert.deepEqual(parseScanPayload('tongban://friend/alice', 'friend'), { kind: 'friend', id: 'alice' });
  assert.throws(() => parseScanPayload('tongban://friend/alice', 'transfer'));
  assert.throws(() => parseScanPayload(address, 'friend'));
  for (const payload of ['tongban://friend/', `tongban://friend/${'x'.repeat(25)}`, 'tongban://friend/a/b', 'tongban://friend/a?admin=1', 'tongban://friend/%61', 'tongban://friend/中文', 'tongban://friend/a#b']) assert.throws(() => parseScanPayload(payload));
  assert.throws(() => parseScanPayload(address, 'unknown'));
});

test('image limits reject unsupported media, empty or oversized files and decompression dimensions before decoding', async () => {
  assert.doesNotThrow(() => validateQrImageFile({ size: 5 * 1024 * 1024, type: 'image/png' }));
  for (const file of [{ size: 1, type: 'image/svg+xml' }, { size: 1, type: 'image/gif' }, { size: 0, type: 'image/png' }, { size: 5242881, type: 'image/png' }, null]) assert.throws(() => validateQrImageFile(file));
  assert.doesNotThrow(() => validateQrImageDimensions(6000, 4000));
  for (const dimensions of [[8193, 1], [6000, 4001], [0, 500], [NaN, 300], [1.5, 5]]) assert.throws(() => validateQrImageDimensions(...dimensions));
  const png = new Uint8Array(await QRCode.toBuffer(address, { width: 400 }));
  assert.deepEqual(inspectQrImage(png, 'image/png'), { width: 400, height: 400 });
  assert.throws(() => inspectQrImage(png, 'image/jpeg'));
  assert.throws(() => inspectQrImage(new TextEncoder().encode('<svg><script/></svg>'), 'image/png'));
  const bomb = new Uint8Array(png); bomb.set([0, 0, 32, 1], 16);
  assert.throws(() => inspectQrImage(bomb, 'image/png'));
});

function raster(text, width, height) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  if (!text) return pixels;
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const column = Math.floor(x / width * (qr.size + 8)) - 4;
    const row = Math.floor(y / height * (qr.size + 8)) - 4;
    if (column >= 0 && row >= 0 && column < qr.size && row < qr.size && qr.get(row, column)) {
      const offset = (y * width + x) * 4; pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  return pixels;
}

function harness({ mode = 'all', media, bitmap, qrText = null, onResult } = {}) {
  const events = new Map(), documentEvents = new Map(), windowEvents = new Map(), results = [], mediaCalls = [], toasts = [];
  const node = extra => ({ hidden: false, disabled: false, textContent: '', innerHTML: '', value: '', dataset: {}, classList: { toggle() {} }, ...extra });
  const video = node({ readyState: 2, videoWidth: 400, videoHeight: 400, qrText, pause() {}, play: async () => {} });
  const stage = node(), idle = node(), status = node(), resultBox = node(), camera = node({ dataset: { qrAction: 'camera' } });
  const fileInput = node({ files: [], clicks: 0, click() { this.clicks++; } });
  const manual = { elements: { payload: { value: '' } }, matches: selector => selector === '[data-qr-manual]' };
  const nodes = new Map([['[data-qr-video]', video], ['[data-qr-stage]', stage], ['[data-qr-idle]', idle], ['[data-qr-status]', status], ['[data-qr-result]', resultBox], ['[data-qr-action="camera"]', camera], ['[data-qr-file]', fileInput], ['[data-qr-manual]', manual]]);
  globalThis.document = {
    hidden: false,
    addEventListener: (name, handler) => documentEvents.set(name, handler),
    removeEventListener: (name, handler) => { if (documentEvents.get(name) === handler) documentEvents.delete(name); },
    createElement(tag) {
      assert.equal(tag, 'canvas');
      let drawn;
      const canvas = { width: 0, height: 0, getContext() { return { drawImage(source) { drawn = source; }, getImageData() { return { data: raster(drawn.qrText, canvas.width, canvas.height) }; } }; } };
      return canvas;
    },
  };
  globalThis.window = {
    addEventListener: (name, handler) => windowEvents.set(name, handler),
    removeEventListener: (name, handler) => { if (windowEvents.get(name) === handler) windowEvents.delete(name); },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: args => { mediaCalls.push(args); return media ? media(args) : Promise.reject(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })); } } } });
  globalThis.createImageBitmap = bitmap || (async () => ({ width: 400, height: 400, qrText, close() {} }));
  const container = {
    innerHTML: '', contains: target => target.owner === container, querySelector: selector => nodes.get(selector) ?? null,
    addEventListener: (name, handler) => events.set(name, handler),
    removeEventListener: (name, handler) => { if (events.get(name) === handler) events.delete(name); },
  };
  const cleanup = mountQrScanner(container, { mode, toast: message => toasts.push(message), onResult: payload => { results.push(payload); return onResult?.(payload); } });
  function click(action, sameButton) {
    const button = sameButton || (action === 'camera' ? camera : node({ dataset: { qrAction: action } }));
    button.owner = container;
    events.get('click')?.({ target: { closest: () => button } });
    return button;
  }
  function submit(payload) { manual.elements.payload.value = payload; events.get('submit')?.({ target: manual, preventDefault() {} }); }
  async function upload(payload = address) {
    const png = await QRCode.toBuffer(payload, { width: 400 });
    fileInput.files = [{ type: 'image/png', size: png.length, arrayBuffer: async () => png }];
    events.get('change')?.({ target: fileInput });
  }
  return { container, events, documentEvents, windowEvents, video, stage, idle, status, resultBox, camera, fileInput, manual, results, mediaCalls, toasts, cleanup, click, submit, upload };
}

test('mount is passive; manual recognition shows full network review and only explicit confirmation returns a result once', async () => {
  const app = harness();
  assert.equal(app.mediaCalls.length, 0);
  app.submit(address);
  assert.equal(app.manual.elements.payload.value, '');
  assert.equal(app.results.length, 0);
  assert.match(app.resultBox.innerHTML, new RegExp(address));
  assert.match(app.resultBox.innerHTML, /裸地址无法证明所属网络/);
  assert.match(app.resultBox.innerHTML, /金额不会填入转账/);
  assert.equal(app.camera.className, 'qr-secondary', 'a recognized result becomes the only primary action');
  const button = app.click('confirm'); app.click('confirm', button);
  await tick();
  assert.deepEqual(app.results, [{ kind: 'address', address, chainId: 97, networkExplicit: false }]);
  app.cleanup();
  assert.equal(app.events.size, 0); assert.equal(app.documentEvents.size, 0); assert.equal(app.windowEvents.size, 0);
});

test('recognition review keeps camera available as secondary and restores its priority when starting again',()=>{
  const app=harness();
  app.submit(address);
  assert.equal(app.camera.className,'qr-secondary');
  assert.equal(app.camera.disabled,false);
  assert.match(app.resultBox.innerHTML,/class="qr-primary" data-qr-action="confirm"/);
  app.click('again');
  assert.equal(app.camera.className,'qr-primary');
  assert.equal(app.resultBox.hidden,true);
  assert.equal(app.stage.hidden,false);
  assert.equal(app.results.length,0);
  app.cleanup();
});

test('invalid and wrong-mode manual payloads cannot produce a confirmable result', () => {
  const app = harness({ mode: 'friend' });
  app.submit(address); app.click('confirm');
  assert.match(app.status.textContent, /请使用愚笨者好友码/);
  assert.equal(app.results.length, 0); assert.equal(app.resultBox.hidden, true);
  app.submit('tongban://friend/Alice_7');
  assert.match(app.resultBox.innerHTML, /查看好友/); assert.match(app.resultBox.innerHTML, /不会直接添加好友/);
  app.click('confirm'); assert.deepEqual(app.results, [{ kind: 'friend', id: 'alice_7' }]);
  app.cleanup();
});

test('a parent rejecting an unknown friend keeps the result and shows its explanation with a retryable button', async () => {
  const message = '没有找到这个好友。当前只能识别本机示例目录中的好友码。';
  const app = harness({ mode: 'friend', onResult: () => { throw new Error(message); } });
  app.submit('tongban://friend/Unknown_7');
  const button = app.click('confirm'); await tick();
  assert.equal(app.status.textContent, message); assert.equal(button.disabled, false);
  assert.equal(app.resultBox.hidden, false); assert.match(app.resultBox.innerHTML, /unknown_7/);
  app.click('confirm', button); await tick(); assert.equal(app.results.length, 2);
  app.cleanup();
});

test('camera decoding uses real jsQR pixels, stops every track on recognition, and waits for confirmation', async () => {
  const stops = [0, 0];
  const tracks = stops.map((_, index) => ({ stop() { stops[index]++; } }));
  const app = harness({ qrText: `ethereum:pay-${address}@97?value=1e18`, media: async () => ({ getTracks: () => tracks }) });
  app.click('camera'); await tick();
  assert.deepEqual(app.mediaCalls, [{ audio: false, video: { facingMode: { ideal: 'environment' } } }]);
  assert.deepEqual(stops, [1, 1]); assert.equal(app.video.srcObject, null); assert.equal(app.results.length, 0);
  assert.match(app.resultBox.innerHTML, /二维码标注了 BSC 测试网/);
  app.click('confirm'); assert.equal(app.results[0].networkExplicit, true); assert.equal('amount' in app.results[0], false);
  app.cleanup(); assert.deepEqual(stops, [1, 1]);
});

test('late camera permission after cleanup is stopped immediately and cannot fill a result', async () => {
  const pending = deferred(); let stops = 0;
  const app = harness({ qrText: address, media: () => pending.promise });
  app.click('camera'); app.cleanup();
  pending.resolve({ getTracks: () => [{ stop() { stops++; } }] }); await tick();
  assert.equal(stops, 1); assert.equal(app.video.srcObject, null); assert.equal(app.results.length, 0); assert.equal(app.resultBox.innerHTML, '');
});

test('switching to another input cancels a pending camera, including late permission results', async () => {
  const pending = deferred(); let stops = 0;
  const app = harness({ qrText: otherAddress, media: () => pending.promise });
  app.click('camera'); app.submit(address);
  pending.resolve({ getTracks: () => [{ stop() { stops++; } }] }); await tick();
  assert.equal(stops, 1); assert.match(app.resultBox.innerHTML, new RegExp(address)); assert.doesNotMatch(app.resultBox.innerHTML, new RegExp(otherAddress));
  app.cleanup();
});

test('camera denial keeps album/manual alternatives usable and shows no raw error details', async () => {
  const app = harness(); app.click('camera'); await tick();
  assert.equal(app.camera.disabled, false); assert.match(app.status.textContent, /未获得相机权限/); assert.doesNotMatch(app.status.textContent, /Denied/);
  app.click('album'); assert.equal(app.fileInput.clicks, 1);
  app.submit(address); assert.equal(app.resultBox.hidden, false); app.cleanup();
});

test('hidden and pagehide both stop camera resources and pending callbacks', async () => {
  for (const trigger of ['hidden', 'pagehide']) {
    let stops = 0;
    const app = harness({ media: async () => ({ getTracks: () => [{ stop() { stops++; } }] }) });
    app.click('camera'); await tick();
    if (trigger === 'hidden') { document.hidden = true; app.documentEvents.get('visibilitychange')(); }
    else app.windowEvents.get('pagehide')();
    assert.equal(stops, 1); assert.equal(app.video.srcObject, null); assert.match(app.status.textContent, /已暂停/);
    app.cleanup(); assert.equal(stops, 1);
  }
});

test('album bitmap late completion is closed after cancellation and cannot overwrite the newer manual result', async () => {
  const pending = deferred(); let closed = 0;
  const app = harness({ bitmap: () => pending.promise });
  await app.upload(); await tick();
  app.submit(otherAddress);
  pending.resolve({ width: 400, height: 400, qrText: address, close() { closed++; } }); await tick();
  assert.equal(closed, 1); assert.match(app.resultBox.innerHTML, new RegExp(getAddress(otherAddress))); assert.doesNotMatch(app.resultBox.innerHTML, new RegExp(address));
  assert.equal(app.results.length, 0); app.cleanup();
});

test('album recognition releases the decoded bitmap and never consumes URI amounts', async () => {
  let closed = 0;
  const app = harness({ bitmap: async () => ({ width: 400, height: 400, qrText: `ethereum:${address}@97?value=100`, close() { closed++; } }) });
  await app.upload(); await tick();
  assert.equal(closed, 1); assert.equal(app.resultBox.hidden, false); assert.equal(app.results.length, 0);
  app.click('confirm'); assert.deepEqual(Object.keys(app.results[0]).sort(), ['address', 'chainId', 'kind', 'networkExplicit']);
  app.cleanup();
});

test('a broken media track cannot prevent the remaining tracks from being stopped', () => {
  let stopped = 0;
  stopMediaTracks({ getTracks: () => [{ stop() { throw new Error('track ended'); } }, { stop() { stopped++; } }] });
  assert.equal(stopped, 1);
  assert.doesNotThrow(() => stopMediaTracks(null));
});
