import './chat-media.css';

export const CHAT_MEDIA_LIMITS = Object.freeze({ maxImages: 3, maxBytes: 2 * 1024 * 1024, maxDimension: 8192, maxPixels: 16000000 });
const TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DATA_URL = Math.ceil(CHAT_MEDIA_LIMITS.maxBytes / 3) * 4 + 40;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export const EMOJI_GROUPS = Object.freeze([
  { id: 'common', label: '常用', emojis: ['😊', '😂', '🥰', '👍', '❤️', '🎉', '🙏', '🤝', '✨', '🌷'] },
  { id: 'mood', label: '心情', emojis: ['😄', '🤣', '🥹', '🥳', '🤔', '😎', '😴', '😭', '😮', '😌'] },
  { id: 'gestures', label: '手势', emojis: ['👋', '👌', '✌️', '🤞', '🫶', '👏', '🙌', '💪', '🫡', '🤗'] },
  { id: 'life', label: '生活', emojis: ['☀️', '🌙', '☕', '🍰', '🍜', '🎂', '🎁', '🌿', '🐱', '🏡'] },
].map(group => Object.freeze({ ...group, emojis: Object.freeze(group.emojis) })));

export const STICKERS = Object.freeze([
  { id: 'hug', emoji: '🤗', label: '抱抱你', color: 'peach' },
  { id: 'yay', emoji: '🥳', label: '好耶！', color: 'butter' },
  { id: 'got-it', emoji: '🫡', label: '收到啦', color: 'mint' },
  { id: 'cheer', emoji: '💪', label: '给你加油', color: 'sky' },
  { id: 'goodnight', emoji: '😴', label: '晚安好梦', color: 'lavender' },
  { id: 'thanks', emoji: '🥰', label: '谢谢你呀', color: 'rose' },
  { id: 'coffee', emoji: '☕', label: '一起歇会儿', color: 'butter' },
  { id: 'happy', emoji: '😄', label: '开心加倍', color: 'mint' },
].map(sticker => Object.freeze(sticker)));

export function getSticker(id) { return typeof id === 'string' ? STICKERS.find(sticker => sticker.id === id) ?? null : null; }

function mediaError(message, code = 'MEDIA_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validDimensions(width, height) {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 &&
    width <= CHAT_MEDIA_LIMITS.maxDimension && height <= CHAT_MEDIA_LIMITS.maxDimension && width * height <= CHAT_MEDIA_LIMITS.maxPixels;
}

function ascii(bytes, offset, count) { return String.fromCharCode(...bytes.subarray(offset, offset + count)); }
function u16(bytes, offset) { return bytes[offset] * 256 + bytes[offset + 1]; }
function u32(bytes, offset) { return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3]; }
function little32(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536 + bytes[offset + 3] * 16777216; }
function little24(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536; }

function pngDimensions(bytes) {
  if (bytes.length < 57 || ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n' || u32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') return null;
  const width = u32(bytes, 16), height = u32(bytes, 20);
  let offset = 8, hasData = false, hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset), type = ascii(bytes, offset + 4, 4);
    if (length > bytes.length - offset - 12 || type === 'acTL') return null; // Static images only.
    if (type === 'IDAT' && length > 0) hasData = true;
    offset += length + 12;
    if (type === 'IEND') { if (length !== 0 || offset !== bytes.length) return null; hasEnd = true; break; }
  }
  return hasData && hasEnd ? { width, height } : null;
}

function jpegDimensions(bytes) {
  if (bytes.length < 15 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return null;
  const frameMarkers = [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207];
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) return null;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = u16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (frameMarkers.includes(marker)) {
      if (length < 8) return null;
      return { width: u16(bytes, offset + 5), height: u16(bytes, offset + 3) };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 26 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || little32(bytes, 4) + 8 !== bytes.length) return null;
  let offset = 12, canvas = null, frame = null;
  while (offset + 8 <= bytes.length) {
    const kind = ascii(bytes, offset, 4), size = little32(bytes, offset + 4), start = offset + 8;
    if (size > bytes.length - start || kind === 'ANIM' || kind === 'ANMF') return null;
    if (kind === 'VP8X') {
      if (size !== 10 || bytes[start] & 2) return null;
      canvas = { width: little24(bytes, start + 4) + 1, height: little24(bytes, start + 7) + 1 };
    } else if (kind === 'VP8 ') {
      if (size < 10 || bytes[start] & 1 || ascii(bytes, start + 3, 3) !== '\x9d\x01\x2a') return null;
      frame = { width: (bytes[start + 6] + bytes[start + 7] * 256) & 16383, height: (bytes[start + 8] + bytes[start + 9] * 256) & 16383 };
    } else if (kind === 'VP8L') {
      if (size < 5 || bytes[start] !== 47 || bytes[start + 4] >> 5 !== 0) return null;
      frame = { width: 1 + bytes[start + 1] + ((bytes[start + 2] & 63) << 8), height: 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 15) << 10) };
    }
    offset = start + size + size % 2;
  }
  if (offset !== bytes.length || !frame || canvas && (canvas.width !== frame.width || canvas.height !== frame.height)) return null;
  return frame;
}

function inspectDataUrl(src) {
  if (typeof src !== 'string' || src.length > MAX_DATA_URL) return null;
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || match[2].length % 4 !== 0) return null;
  let binary;
  try { binary = atob(match[2]); if (btoa(binary) !== match[2]) return null; }
  catch { return null; }
  if (!binary.length || binary.length > CHAT_MEDIA_LIMITS.maxBytes) return null;
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  const dimensions = match[1] === 'image/png' ? pngDimensions(bytes) : match[1] === 'image/jpeg' ? jpegDimensions(bytes) : webpDimensions(bytes);
  if (!dimensions || !validDimensions(dimensions.width, dimensions.height)) return null;
  return { mime: match[1], bytes, size: bytes.length, ...dimensions };
}

function dimensionsMatch(image, info) {
  // JPEG EXIF orientation can transpose natural image dimensions in a decoder.
  return image.width === info.width && image.height === info.height ||
    info.mime === 'image/jpeg' && image.width === info.height && image.height === info.width;
}

function safeName(name) {
  return String(name || '聊天图片').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 100) || '聊天图片';
}

function inspectChatImage(image) {
  // Synchronous persistence guard. New uploads additionally pass a real browser
  // decoder below; stored data is never interpreted as HTML or an external URL.
  if (!image || typeof image !== 'object' || Array.isArray(image) || typeof image.name !== 'string' || image.name.length > 100 ||
      safeName(image.name) !== image.name || !validDimensions(image.width, image.height)) return null;
  const info = inspectDataUrl(image.src);
  return info && dimensionsMatch(image, info) ? info : null;
}

export function isSafeChatImage(image) { return Boolean(inspectChatImage(image)); }

export function isValidMediaMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.id !== 'string' || !message.id || message.id.length > 100) return false;
  if (message.type === 'sticker') return Boolean(getSticker(message.stickerId));
  if (message.type !== 'image' || !Array.isArray(message.images) || message.images.length < 1 || message.images.length > CHAT_MEDIA_LIMITS.maxImages) return false;
  let total = 0;
  for (const image of message.images) {
    const info = inspectChatImage(image);
    if (!info) return false;
    total += info.size;
  }
  return total <= CHAT_MEDIA_LIMITS.maxBytes;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'function') { reject(mediaError('当前浏览器不支持读取图片，请更换现代浏览器。', 'MEDIA_UNSUPPORTED')); return; }
    let reader;
    try { reader = new FileReader(); }
    catch { reject(mediaError('无法启动图片读取，请重试。', 'MEDIA_READ_FAILED')); return; }
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reader.onload = reader.onerror = reader.onabort = null;
      if (error) reject(error); else resolve(value);
    };
    const timeout = setTimeout(() => { finish(mediaError('图片读取超时，请重新选择。', 'MEDIA_READ_FAILED')); try { reader.abort(); } catch {} }, 15000);
    reader.onerror = () => finish(mediaError('图片读取失败，请重新选择。', 'MEDIA_READ_FAILED'));
    reader.onabort = () => finish(mediaError('图片读取已取消。', 'MEDIA_READ_FAILED'));
    reader.onload = () => finish(null, reader.result);
    try { reader.readAsDataURL(file); }
    catch { finish(mediaError('无法读取这张图片，请重新选择。', 'MEDIA_READ_FAILED')); }
  });
}

function decodeImage(src, info) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, dimensions) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(dimensions);
    };
    const timeout = setTimeout(() => finish(mediaError('图片解码超时，请换一张较小的图片。', 'MEDIA_DECODE_FAILED')), 10000);
    const failed = () => finish(mediaError('图片无法解码或已损坏，请重新选择。', 'MEDIA_DECODE_FAILED'));
    if (typeof globalThis.createImageBitmap === 'function') {
      try {
        Promise.resolve(globalThis.createImageBitmap(new Blob([info.bytes], { type: info.mime }), { imageOrientation: 'none' })).then(bitmap => {
          const dimensions = { width: bitmap.width, height: bitmap.height };
          bitmap.close?.();
          finish(null, dimensions);
        }, failed).catch(failed);
      } catch { failed(); }
    } else if (typeof globalThis.Image === 'function') {
      const image = new Image();
      image.onload = () => { const dimensions = { width: image.naturalWidth, height: image.naturalHeight }; image.onload = image.onerror = null; finish(null, dimensions); };
      image.onerror = () => { image.onload = image.onerror = null; failed(); };
      image.src = src;
    } else {
      finish(mediaError('当前浏览器不支持图片解码，请更换现代浏览器。', 'MEDIA_UNSUPPORTED'));
    }
  });
}

export async function readChatImages(files) {
  const selected = Array.from(files || []);
  if (selected.length === 0) return [];
  if (selected.length > CHAT_MEDIA_LIMITS.maxImages) throw mediaError('一次最多发送 3 张图片。', 'MEDIA_COUNT_EXCEEDED');
  let total = 0;
  for (const file of selected) {
    if (!file || !TYPES.includes(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0) {
      throw mediaError('仅支持静态 JPG、PNG、WebP 图片。', 'MEDIA_TYPE_INVALID');
    }
    total += file.size;
  }
  if (total > CHAT_MEDIA_LIMITS.maxBytes) throw mediaError('图片总大小不能超过 2 MB，请压缩后重试。', 'MEDIA_SIZE_EXCEEDED');
  const images = [];
  // Sequential decoding keeps peak memory bounded for multiple high-resolution files.
  for (const file of selected) {
    const src = await readFile(file), info = inspectDataUrl(src);
    if (!info || info.mime !== file.type || info.size !== file.size) {
      throw mediaError('图片格式、尺寸或内容不符合要求。请使用单边不超过 8192 像素、总像素不超过 1600 万的静态图片。', 'MEDIA_CONTENT_INVALID');
    }
    const dimensions = await decodeImage(src, info);
    if (!validDimensions(dimensions.width, dimensions.height) || !dimensionsMatch(dimensions, info)) {
      throw mediaError('图片解码尺寸异常，未添加到聊天。', 'MEDIA_DIMENSIONS_INVALID');
    }
    images.push({ src, name: safeName(file.name), width: dimensions.width, height: dimensions.height });
  }
  return images;
}

function stickerArt(sticker) {
  return `<span class="cm-sticker-art cm-tone-${sticker.color}" aria-hidden="true"><i class="cm-sticker-spark cm-spark-one">✦</i><i class="cm-sticker-spark cm-spark-two">✧</i><span class="cm-sticker-emoji">${esc(sticker.emoji)}</span><span class="cm-sticker-caption">${esc(sticker.label)}</span></span>`;
}

export function renderEmojiPanel(category = 'common') {
  const current = EMOJI_GROUPS.find(group => group.id === category || group.label === category) || EMOJI_GROUPS[0];
  return `<section class="cm-emoji-panel" aria-label="选择表情"><div class="cm-emoji-tabs" role="tablist">${EMOJI_GROUPS.map(group => `<button type="button" role="tab" class="${group.id === current.id ? 'active' : ''}" aria-selected="${group.id === current.id}" data-action="emoji-category" data-category="${group.id}">${group.label}</button>`).join('')}</div><div class="cm-emoji-grid" role="group" aria-label="${current.label}表情">${current.emojis.map(emoji => `<button type="button" class="cm-emoji-pick" data-action="emoji-pick" data-emoji="${esc(emoji)}" aria-label="插入 ${esc(emoji)}">${esc(emoji)}</button>`).join('')}</div></section>`;
}

export function renderStickerPanel() {
  return `<section class="cm-sticker-panel" aria-label="选择大表情"><p class="cm-panel-note">愚笨者心情 · 点击发送大表情</p><div class="cm-sticker-grid">${STICKERS.map(sticker => `<button type="button" class="cm-sticker-pick" data-action="sticker-send" data-id="${sticker.id}" aria-label="发送大表情：${esc(sticker.label)}">${stickerArt(sticker)}</button>`).join('')}</div></section>`;
}

export function renderMediaMessage(message) {
  if (!isValidMediaMessage(message)) return '<span class="cm-media-unavailable">图片或表情暂不可用</span>';
  if (message.type === 'sticker') {
    const sticker = getSticker(message.stickerId);
    return `<div class="cm-sticker-message" role="img" aria-label="${esc(sticker.label)}">${stickerArt(sticker)}</div>`;
  }
  return `<div class="cm-message-images cm-image-count-${message.images.length}">${message.images.map((image, index) => `<button type="button" class="cm-message-image" data-action="image-view" data-id="${esc(message.id)}" data-index="${index}" aria-label="查看图片 ${index + 1}：${esc(image.name)}"><img src="${esc(image.src)}" alt="${esc(image.name)}" width="${image.width}" height="${image.height}" loading="lazy" decoding="async" draggable="false"></button>`).join('')}</div>`;
}
