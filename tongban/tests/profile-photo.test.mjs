import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProfilePhoto, isSafeProfilePhoto, PROFILE_PHOTO_LIMITS } from '../src/profile-photo.js';
import { PHOTO_512, PHOTO_256, INPUT_JPEG } from './helpers/profile-fixtures.mjs';
const inputBytes = Buffer.from(INPUT_JPEG, 'base64');
const file = { type: 'image/jpeg', size: inputBytes.length };
function runtime(options = {}) {
  const originals = Object.fromEntries(['FileReader', 'Image', 'document'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const calls = [], urls = [];
  const canvas = { width: 0, height: 0, getContext: () => options.noContext ? null : { fillRect() {}, drawImage(...args) { calls.push(['draw', ...args.slice(1)]); } }, toDataURL(type, quality) { calls.push(['encode', canvas.width, quality]); return options.encode?.(canvas.width, quality) ?? PHOTO_512; } };
  globalThis.FileReader = class { readAsArrayBuffer() { queueMicrotask(() => { if (options.readError) return this.onerror(); const buffer = options.bytes || inputBytes; this.result = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); this.onload(); }); } };
  globalThis.Image = class { naturalWidth = 1200; naturalHeight = 800; set src(value) { queueMicrotask(() => options.decodeError ? this.onerror() : this.onload()); } };
  globalThis.document = { createElement: name => { assert.equal(name, 'canvas'); return canvas; } };
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:test-profile'; URL.revokeObjectURL = value => urls.push(value);
  return { calls, urls, restore() { URL.createObjectURL = create; URL.revokeObjectURL = revoke; for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } } };
}
test('avatar persistence accepts only bounded square JPEGs and rejects executable/external sources', () => {
  assert.equal(isSafeProfilePhoto(PHOTO_512), true); assert.equal(isSafeProfilePhoto(PHOTO_256), true); assert.equal(isSafeProfilePhoto(''), true);
  for (const value of ['https://example.test/avatar.jpg', 'data:image/svg+xml,<svg/>', 'data:image/jpeg;base64,PHNjcmlwdD4=', 'data:image/jpeg;base64,' + INPUT_JPEG, PHOTO_512 + 'garbage']) assert.equal(isSafeProfilePhoto(value), false);
});
test('photo preparation center-crops, strips source bytes and returns a small JPEG', async () => {
  const fake = runtime();
  try { const photo = await prepareProfilePhoto(file); assert.equal(photo, PHOTO_512); assert.deepEqual(fake.calls[0], ['draw', 200, 0, 800, 800, 0, 0, 512, 512]); assert.ok(photo.length < PROFILE_PHOTO_LIMITS.targetBytes); assert.deepEqual(fake.urls, ['blob:test-profile']); }
  finally { fake.restore(); }
});
test('large encoded photos lower quality then fall back to 256px before exceeding the target', async () => {
  const jpeg = Buffer.from(PHOTO_512.split(',')[1], 'base64'), padded = 'data:image/jpeg;base64,' + Buffer.concat([jpeg.subarray(0, -2), Buffer.alloc(90000), jpeg.subarray(-2)]).toString('base64');
  const fake = runtime({ encode: width => width === 512 ? padded : PHOTO_256 });
  try { assert.equal(await prepareProfilePhoto(file), PHOTO_256); assert.equal(fake.calls.filter(row => row[0] === 'encode' && row[1] === 512).length, 4); }
  finally { fake.restore(); }
});
test('invalid types, excessive size, decode and storage preparation errors never produce a photo', async () => {
  await assert.rejects(prepareProfilePhoto({ ...file, type: 'image/svg+xml' }), /JPG/);
  await assert.rejects(prepareProfilePhoto({ ...file, size: PROFILE_PHOTO_LIMITS.maxInputBytes + 1 }), /10 MB/);
  for (const [options, expected] of [[{ readError: true }, /读取失败/], [{ bytes: Buffer.from('<svg/>') }, /格式或尺寸/], [{ decodeError: true }, /已损坏/], [{ noContext: true }, /暂不可用/]]) {
    const fake = runtime(options); try { await assert.rejects(prepareProfilePhoto(file), expected); } finally { fake.restore(); }
  }
});
