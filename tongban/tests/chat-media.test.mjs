import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Load the browser helper without its build-time stylesheet import.
const source = (await readFile(new URL('../src/chat-media.js', import.meta.url), 'utf8')).replace(/^import '\.\/chat-media\.css';\s*/, '');
const media = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { CHAT_MEDIA_LIMITS, EMOJI_GROUPS, STICKERS, getSticker, isSafeChatImage, isValidMediaMessage,
  readChatImages, renderEmojiPanel, renderStickerPanel, renderMediaMessage } = media;

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlLsAAAAASUVORK5CYII=';
// Original 2×3 solid-colour fixtures generated locally; no external media.
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwBKKKK5D5s//9k=';
const webp = 'data:image/webp;base64,UklGRjQAAABXRUJQVlA4ICgAAABwAQCdASoCAAMAAUAmJaACdAGgAAD+Ex16pa5Sb/5gn/v9/3+8lwAA';
const image = (overrides = {}) => ({ src: png, name: '朋友.png', width: 1, height: 1, ...overrides });
const file = (overrides = {}) => ({ name: '朋友.png', type: 'image/png', size: Buffer.from(png.split(',')[1], 'base64').length, src: png, ...overrides });
let bitmapMode = 'valid';
let closedBitmaps = 0;
let reads = 0;
let storageWrites = 0;
globalThis.localStorage = { setItem() { storageWrites++; } };
globalThis.FileReader = class {
  readAsDataURL(input) {
    reads++;
    if (input.throwRead) throw new Error('raw file details must not escape');
    queueMicrotask(() => {
      if (input.abortRead) { this.onabort?.(); return; }
      if (input.failRead) { this.onerror?.(); return; }
      this.result = input.src;
      this.onload?.();
    });
  }
  abort() { this.onabort?.(); }
};
const bitmapDecoder = async blob => {
  assert.ok(blob instanceof Blob);
  if (bitmapMode === 'failure') throw new Error('raw decoder details');
  return { width: bitmapMode === 'mismatch' ? 2 : 1, height: 1, close() { closedBitmaps++; } };
};
globalThis.createImageBitmap = bitmapDecoder;

test('emoji and sticker catalogues use immutable allowlists', () => {
  assert.deepEqual(EMOJI_GROUPS.map(group => group.label), ['常用', '心情', '手势', '生活']);
  assert.ok(EMOJI_GROUPS.reduce((sum, group) => sum + group.emojis.length, 0) >= 30);
  assert.ok(EMOJI_GROUPS.reduce((sum, group) => sum + group.emojis.length, 0) <= 50);
  assert.ok(STICKERS.length >= 6 && STICKERS.length <= 8);
  assert.equal(new Set(STICKERS.map(sticker => sticker.id)).size, STICKERS.length);
  assert.ok(Object.isFrozen(STICKERS) && Object.isFrozen(STICKERS[0]));
  assert.equal(getSticker('arbitrary<script>'), null);
  assert.equal(getSticker({ id: 'hug' }), null);
  assert.equal(getSticker('hug').label, '抱抱你');
});

test('persistence validation accepts bounded PNG data and refuses active or external sources', () => {
  assert.equal(isSafeChatImage(image()), true);
  for (const src of ['https://example.com/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+',
    'data:text/html;base64,PGltZyBvbmVycm9yPWFsZXJ0KDEpPg==', 'data:image/png;base64,PHN2Zy8+',
    png.replace('image/png', 'image/jpeg'), png + 'junk', png.replace(';base64,', ';base64,\n')]) {
    assert.equal(isSafeChatImage(image({ src })), false);
  }
  for (const replacement of [null, {}, image({ name: '\u202eevil.png' }), image({ name: '' }), image({ width: 0 }),
    image({ width: 2 }), image({ height: NaN }), image({ width: 9000 })]) {
    assert.equal(isSafeChatImage(replacement), false);
  }
});

test('embedded image dimensions cannot be hidden behind small stored metadata', () => {
  const bytes = Buffer.from(png.split(',')[1], 'base64');
  bytes.writeUInt32BE(8193, 16);
  const oversized = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.equal(isSafeChatImage(image({ src: oversized })), false);
  bytes.writeUInt32BE(4001, 16);
  bytes.writeUInt32BE(4000, 20);
  const tooManyPixels = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.equal(isSafeChatImage(image({ src: tooManyPixels, width: 4001, height: 4000 })), false);
});

test('JPEG and WebP magic bytes and actual frame dimensions are validated', () => {
  assert.equal(isSafeChatImage(image({ src: jpeg, name: 'photo.jpg', width: 2, height: 3 })), true);
  assert.equal(isSafeChatImage(image({ src: jpeg, name: 'photo.jpg', width: 3, height: 2 })), true);
  assert.equal(isSafeChatImage(image({ src: webp, name: 'photo.webp', width: 2, height: 3 })), true);
  assert.equal(isSafeChatImage(image({ src: webp, name: 'photo.webp', width: 3, height: 2 })), false);
  assert.equal(isSafeChatImage(image({ src: jpeg.replace('image/jpeg', 'image/webp'), width: 2, height: 3 })), false);
});

test('message validation enforces media type, count, total encoded size and sticker allowlist', () => {
  assert.equal(isValidMediaMessage({ id: 'm1', type: 'image', images: [image()] }), true);
  assert.equal(isValidMediaMessage({ id: 'm2', type: 'sticker', stickerId: 'hug' }), true);
  assert.equal(isValidMediaMessage({ id: 'm2', type: 'sticker', stickerId: 'fake', emoji: '🤗' }), false);
  assert.equal(isValidMediaMessage({ id: 'm2', type: 'sticker', sticker: getSticker('hug') }), false);
  assert.equal(isValidMediaMessage({ id: 'm3', type: 'image', images: [] }), false);
  assert.equal(isValidMediaMessage({ id: 'm3', type: 'image', images: Array(4).fill(image()) }), false);
  assert.equal(isValidMediaMessage({ id: '', type: 'image', images: [image()] }), false);
  assert.equal(isValidMediaMessage({ id: 'm3', type: 'html', images: [image()] }), false);

  // Add a bounded inert PNG metadata chunk before IEND to exercise total size.
  const bytes = Buffer.from(png.split(',')[1], 'base64');
  const metadata = Buffer.alloc(750000);
  const chunk = Buffer.alloc(metadata.length + 12);
  chunk.writeUInt32BE(metadata.length, 0);
  chunk.write('tEXt', 4, 'ascii');
  metadata.copy(chunk, 8);
  const padded = `data:image/png;base64,${Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]).toString('base64')}`;
  assert.equal(isSafeChatImage(image({ src: padded })), true);
  assert.equal(isValidMediaMessage({ id: 'm4', type: 'image', images: Array(3).fill(image({ src: padded })) }), false);
});

test('rendered selectors follow the integration API and user text is escaped', () => {
  const emojis = renderEmojiPanel('心情');
  assert.match(emojis, /data-action="emoji-category" data-category="mood"/);
  assert.match(emojis, /data-action="emoji-pick" data-emoji=/);
  assert.equal(renderEmojiPanel('<script>'), renderEmojiPanel('common'));
  assert.match(renderStickerPanel(), /data-action="sticker-send" data-id="hug"/);
  const output = renderMediaMessage({ id: 'id" onclick="evil', type: 'image', images: [image({ name: '<img onerror=evil>.png' })] });
  assert.match(output, /data-action="image-view"/);
  assert.match(output, /data-index="0"/);
  assert.match(output, /data-id="id&quot; onclick=&quot;evil"/);
  assert.doesNotMatch(output, /data-id="id" onclick=/);
  assert.match(output, /alt="&lt;img onerror=evil&gt;\.png"/);
});

test('sticker rendering ignores untrusted stored emoji, colour and external image fields', () => {
  const output = renderMediaMessage({ id: 'm1', type: 'sticker', stickerId: 'hug', emoji: '<script>', color: 'url(evil)', src: 'https://evil.example' });
  assert.match(output, /抱抱你/);
  assert.doesNotMatch(output, /script|evil/);
  assert.equal(renderMediaMessage({ id: 'm2', type: 'image', images: [image({ src: 'https://evil.example' })] }), '<span class="cm-media-unavailable">图片或表情暂不可用</span>');
});

test('uploads decode fully before returning, sanitize names, and never persist or send messages', async () => {
  const before = closedBitmaps;
  assert.deepEqual(await readChatImages([]), []);
  const result = await readChatImages([file({ name: '\u202e朋友.png' }), file()]);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, '朋友.png');
  assert.ok(result.every(isSafeChatImage));
  assert.equal(closedBitmaps - before, 2);
  assert.equal(storageWrites, 0);
});

test('uploads reject count, MIME and total size before reading files', async () => {
  const before = reads;
  await assert.rejects(readChatImages(Array(4).fill(file())), { code: 'MEDIA_COUNT_EXCEEDED' });
  await assert.rejects(readChatImages([file({ type: 'image/svg+xml' })]), { code: 'MEDIA_TYPE_INVALID' });
  await assert.rejects(readChatImages([file({ size: 0 })]), { code: 'MEDIA_TYPE_INVALID' });
  await assert.rejects(readChatImages([file({ size: CHAT_MEDIA_LIMITS.maxBytes }), file()]), { code: 'MEDIA_SIZE_EXCEEDED' });
  assert.equal(reads, before);
});

test('uploads reject MIME spoofing and declared byte-size mismatches', async () => {
  await assert.rejects(readChatImages([file({ type: 'image/jpeg' })]), { code: 'MEDIA_CONTENT_INVALID' });
  await assert.rejects(readChatImages([file({ size: 1 })]), { code: 'MEDIA_CONTENT_INVALID' });
  await assert.rejects(readChatImages([file({ src: 'data:image/png;base64,PHN2Zy8+' })]), { code: 'MEDIA_CONTENT_INVALID' });
});

test('FileReader errors, aborts and synchronous failures become friendly failures', async () => {
  for (const mode of ['throwRead', 'failRead', 'abortRead']) {
    await assert.rejects(readChatImages([file({ [mode]: true })]), error => error.code === 'MEDIA_READ_FAILED' && !error.message.includes('raw'));
  }
});

test('decode failure or mismatching dimensions returns no partial image batch', async () => {
  bitmapMode = 'failure';
  await assert.rejects(readChatImages([file()]), { code: 'MEDIA_DECODE_FAILED' });
  bitmapMode = 'mismatch';
  await assert.rejects(readChatImages([file()]), { code: 'MEDIA_DIMENSIONS_INVALID' });
  bitmapMode = 'valid';
  await assert.rejects(readChatImages([file(), file({ failRead: true })]), { code: 'MEDIA_READ_FAILED' });
  assert.equal(storageWrites, 0);
});

test('Image fallback validates decoded dimensions when createImageBitmap is unavailable', async () => {
  delete globalThis.createImageBitmap;
  globalThis.Image = class {
    naturalWidth = 1;
    naturalHeight = 1;
    set src(_value) { queueMicrotask(() => this.onload?.()); }
  };
  try { assert.equal((await readChatImages([file()])).length, 1); }
  finally { globalThis.createImageBitmap = bitmapDecoder; delete globalThis.Image; }
});
