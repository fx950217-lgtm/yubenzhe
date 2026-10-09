export const PROFILE_PHOTO_LIMITS = Object.freeze({ maxInputBytes: 10 * 1024 * 1024, maxBytes: 256 * 1024, targetBytes: 64 * 1024, maxDimension: 10000, maxPixels: 40000000, outputSize: 512 });
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_DATA_LENGTH = Math.ceil(PROFILE_PHOTO_LIMITS.maxBytes / 3) * 4 + 40;
function validSize(width, height) { return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= PROFILE_PHOTO_LIMITS.maxDimension && height <= PROFILE_PHOTO_LIMITS.maxDimension && width * height <= PROFILE_PHOTO_LIMITS.maxPixels; }
function ascii(bytes, offset, count) { return String.fromCharCode(...bytes.subarray(offset, offset + count)); }
function big16(bytes, offset) { return bytes[offset] * 256 + bytes[offset + 1]; }
function big32(bytes, offset) { return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3]; }
function little32(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536 + bytes[offset + 3] * 16777216; }
function little24(bytes, offset) { return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536; }
function dimensions(bytes, type) {
  if (type === 'image/png') {
    if (bytes.length < 33 || ascii(bytes, 0, 8) !== '\x89PNG\r\n\x1a\n' || big32(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') return null;
    return { width: big32(bytes, 16), height: big32(bytes, 20) };
  }
  if (type === 'image/webp') {
    if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || little32(bytes, 4) + 8 !== bytes.length) return null;
    const kind = ascii(bytes, 12, 4), start = 20;
    if (kind === 'VP8X') return { width: little24(bytes, start + 4) + 1, height: little24(bytes, start + 7) + 1 };
    if (kind === 'VP8 ' && !(bytes[start] & 1) && ascii(bytes, start + 3, 3) === '\x9d\x01\x2a') return { width: (bytes[start + 6] + bytes[start + 7] * 256) & 16383, height: (bytes[start + 8] + bytes[start + 9] * 256) & 16383 };
    if (kind === 'VP8L' && bytes[start] === 47) return { width: 1 + bytes[start + 1] + ((bytes[start + 2] & 63) << 8), height: 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 15) << 10) };
    return null;
  }
  if (bytes.length < 15 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) return null;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = big16(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return length >= 8 ? { width: big16(bytes, offset + 5), height: big16(bytes, offset + 3) } : null;
    offset += length;
  }
  return null;
}
export function isSafeProfilePhoto(src) {
  if (src === '') return true;
  if (typeof src !== 'string' || src.length > MAX_DATA_LENGTH) return false;
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
  if (!match || match[1].length % 4 !== 0) return false;
  try {
    const binary = atob(match[1]);
    if (!binary.length || binary.length > PROFILE_PHOTO_LIMITS.maxBytes || btoa(binary) !== match[1]) return false;
    const bytes = Uint8Array.from(binary, value => value.charCodeAt(0)), size = dimensions(bytes, 'image/jpeg');
    return Boolean(size && [256, PROFILE_PHOTO_LIMITS.outputSize].includes(size.width) && size.height === size.width);
  } catch { return false; }
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'function') { reject(new Error('此设备暂不支持读取照片，请更新浏览器后重试。')); return; }
    const reader = new FileReader();
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); reader.onload = reader.onerror = reader.onabort = null; error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { finish(new Error('照片读取超时，请重新选择。')); try { reader.abort(); } catch {} }, 15000);
    reader.onload = () => finish(null, reader.result);
    reader.onerror = reader.onabort = () => finish(new Error('照片读取失败，请重新选择。'));
    try { reader.readAsArrayBuffer(file); } catch { finish(new Error('照片无法读取，请重新选择。')); }
  });
}
function decodeImage(bytes, type) {
  return new Promise((resolve, reject) => {
    if (typeof Image !== 'function' || typeof URL?.createObjectURL !== 'function') { reject(new Error('此设备暂不支持照片处理，请更新浏览器后重试。')); return; }
    const image = new Image(), url = URL.createObjectURL(new Blob([bytes], { type }));
    let settled = false;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); image.onload = image.onerror = null; URL.revokeObjectURL(url); error ? reject(error) : resolve(image); };
    const timer = setTimeout(() => finish(new Error('照片处理超时，请换一张较小的照片。')), 10000);
    image.onload = () => finish(); image.onerror = () => finish(new Error('照片已损坏或格式不受支持，请重新选择。'));
    image.src = url;
  });
}
/** Re-encode a centered square: strips EXIF/location metadata and bounds local storage. */
export async function prepareProfilePhoto(file) {
  if (!file || !TYPES.includes(file.type) || !Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('请选择 JPG、PNG 或 WebP 照片；HEIC 照片请先转为 JPG。');
  if (file.size > PROFILE_PHOTO_LIMITS.maxInputBytes) throw new Error('照片不能超过 10 MB，请先压缩或选择较小的照片。');
  const buffer = await readFile(file), bytes = new Uint8Array(buffer), size = dimensions(bytes, file.type);
  if (bytes.length !== file.size || !size || !validSize(size.width, size.height)) throw new Error('照片格式或尺寸不符合要求，请选择不超过 4000 万像素的照片。');
  const image = await decodeImage(bytes, file.type);
  if (!validSize(image.naturalWidth, image.naturalHeight) || !(image.naturalWidth === size.width && image.naturalHeight === size.height || file.type === 'image/jpeg' && image.naturalWidth === size.height && image.naturalHeight === size.width)) throw new Error('照片尺寸异常，未使用这张照片。');
  const canvas = globalThis.document?.createElement('canvas');
  if (!canvas) throw new Error('此设备暂不支持照片处理。');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('照片处理暂不可用，请重新打开页面。');
  const edge = Math.min(image.naturalWidth, image.naturalHeight);
  for (const outputSize of [PROFILE_PHOTO_LIMITS.outputSize, 256]) {
    canvas.width = canvas.height = outputSize;
    context.fillStyle = '#fcfaff'; context.fillRect(0, 0, outputSize, outputSize);
    context.drawImage(image, (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge, 0, 0, outputSize, outputSize);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      let photo;
      try { photo = canvas.toDataURL('image/jpeg', quality); } catch { throw new Error('照片压缩失败，请重新选择。'); }
      if (isSafeProfilePhoto(photo) && photo.length <= Math.ceil(PROFILE_PHOTO_LIMITS.targetBytes / 3) * 4 + 23) return photo;
    }
  }
  throw new Error('照片压缩后仍过大，请换一张照片。');
}
