import jsQR from 'jsqr';
import { getAddress } from 'ethers';
import './qr-scanner.css';

export const QR_IMAGE_LIMITS = Object.freeze({ maxBytes: 5 * 1024 * 1024, maxDimension: 8192, maxPixels: 24000000 });
const MODES = ['all', 'transfer', 'friend'];
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const scanError = (message, code = 'SCAN_INVALID') => Object.assign(new Error(message), { code });

/** Only these two payload types can leave this component; amounts and URLs never do. */
export function parseScanPayload(text, mode = 'all') {
  if (!MODES.includes(mode)) throw scanError('扫码模式暂不可用。');
  if (typeof text !== 'string' || !text.trim() || text.length > 2048) throw scanError('内容为空或过长，请使用钱包收款码或愚笨者好友码。');
  const value = text.trim();
  const friend = /^tongban:\/\/friend\/([a-zA-Z0-9_-]{1,64})$/.exec(value);
  if (friend) {
    if (mode === 'transfer') throw scanError('这是好友码，请使用 BSC 测试网收款地址。');
    return { kind: 'friend', id: friend[1] };
  }
  let address = value, networkExplicit = false;
  if (/^ethereum:/i.test(value)) {
    const uri = /^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})@([0-9]+)(?:\?value=([0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?))?$/i.exec(value);
    if (!uri || uri[3]?.length > 256) throw scanError('仅支持 BSC 测试网地址二维码，不能识别合约操作或付款指令。');
    if (uri[2] !== '97') throw scanError('二维码网络不受支持，目前只支持 BSC 测试网（97）。');
    address = uri[1];
    networkExplicit = true;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw scanError('未识别到支持的地址或好友码。请勿输入私钥、助记词或密码。');
  let normalized;
  try { normalized = getAddress(address); }
  catch { throw scanError('地址校验未通过，请向收款方重新确认。'); }
  if (/^0x0{40}$/i.test(normalized)) throw scanError('不能使用零地址，请重新确认收款地址。');
  if (mode === 'friend') throw scanError('这是钱包地址，请使用愚笨者好友码。');
  return { kind: 'address', address: normalized, chainId: 97, networkExplicit };
}

export function validateQrImageFile(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) throw scanError('请选择 JPG、PNG 或 WebP 格式的二维码图片。', 'SCAN_IMAGE_TYPE');
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > QR_IMAGE_LIMITS.maxBytes) throw scanError('图片不能超过 5 MB，请选择清晰的二维码小图。', 'SCAN_IMAGE_SIZE');
}

export function validateQrImageDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      width > QR_IMAGE_LIMITS.maxDimension || height > QR_IMAGE_LIMITS.maxDimension || width * height > QR_IMAGE_LIMITS.maxPixels) {
    throw scanError('图片尺寸过大或无法读取，请裁剪二维码后重试。', 'SCAN_IMAGE_DIMENSIONS');
  }
}

// Check dimensions before handing compressed image data to the browser decoder.
export function inspectQrImage(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > QR_IMAGE_LIMITS.maxBytes) throw scanError('无法读取图片文件。', 'SCAN_IMAGE_INVALID');
  const ascii = (at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
  const big16 = at => bytes[at] * 256 + bytes[at + 1];
  const big32 = at => bytes[at] * 16777216 + bytes[at + 1] * 65536 + bytes[at + 2] * 256 + bytes[at + 3];
  const little32 = at => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536 + bytes[at + 3] * 16777216;
  const little24 = at => bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
  let dimensions = null;
  if (mime === 'image/png' && bytes.length >= 33 && ascii(0, 8) === '\x89PNG\r\n\x1a\n' && big32(8) === 13 && ascii(12, 4) === 'IHDR') {
    dimensions = { width: big32(16), height: big32(20) };
  } else if (mime === 'image/jpeg' && bytes.length >= 15 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = big16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length >= 8) dimensions = { width: big16(offset + 5), height: big16(offset + 3) };
        break;
      }
      offset += length;
    }
  } else if (mime === 'image/webp' && bytes.length >= 26 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && little32(4) + 8 === bytes.length) {
    const kind = ascii(12, 4), size = little32(16);
    if (size <= bytes.length - 20) {
      if (kind === 'VP8X' && size === 10 && bytes.length >= 30) dimensions = { width: little24(24) + 1, height: little24(27) + 1 };
      else if (kind === 'VP8 ' && size >= 10 && !(bytes[20] & 1) && ascii(23, 3) === '\x9d\x01\x2a') dimensions = { width: (bytes[26] + bytes[27] * 256) & 16383, height: (bytes[28] + bytes[29] * 256) & 16383 };
      else if (kind === 'VP8L' && size >= 5 && bytes[20] === 47) dimensions = { width: 1 + bytes[21] + ((bytes[22] & 63) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10) };
    }
  }
  if (!dimensions) throw scanError('图片格式不匹配或文件已损坏，请重新选择。', 'SCAN_IMAGE_INVALID');
  validateQrImageDimensions(dimensions.width, dimensions.height);
  return dimensions;
}

export function stopMediaTracks(stream) {
  if (!stream) return;
  try { for (const track of stream.getTracks()) { try { track.stop(); } catch {} } } catch {}
}

export function mountQrScanner(container, { mode = 'all', onResult, toast = () => {} } = {}) {
  if (!MODES.includes(mode) || !container || typeof onResult !== 'function') throw scanError('扫码组件暂不可用。');
  let disposed = false, epoch = 0, stream = null, timer = null, cancelImage = null, result = null, confirming = false;
  const prompt = mode === 'friend' ? '将愚笨者好友码放入框内' : mode === 'transfer' ? '将 BSC 测试网收款码放入框内' : '扫描收款地址或愚笨者好友码';
  container.innerHTML = `<section class="qr-scanner" aria-label="本机扫码"><div class="qr-viewfinder" data-qr-stage><video data-qr-video muted playsinline aria-label="相机画面" hidden></video><div class="qr-viewfinder-idle" data-qr-idle><span class="qr-camera-symbol" aria-hidden="true">⌗</span><strong>${prompt}</strong><span>相机将在你点击后打开</span></div><i class="qr-corner a"></i><i class="qr-corner b"></i><i class="qr-corner c"></i><i class="qr-corner d"></i></div><p class="qr-status" data-qr-status role="status" aria-live="polite">图片仅在本机识别，不上传。</p><div class="qr-result" data-qr-result hidden></div><div class="qr-source-actions"><button type="button" class="qr-primary" data-qr-action="camera">打开相机</button><button type="button" class="qr-secondary" data-qr-action="album">从相册选择</button><input data-qr-file type="file" accept="image/png,image/jpeg,image/webp" hidden></div><details class="qr-manual"><summary>手动输入</summary><form data-qr-manual><label>粘贴${mode === 'friend' ? '愚笨者好友码' : mode === 'transfer' ? '收款地址' : '地址或愚笨者好友码'}<textarea name="payload" maxlength="2048" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${mode === 'friend' ? 'tongban://friend/好友ID' : '0x…'}" required></textarea></label><small>请勿输入私钥、助记词或密码。</small><button type="submit" class="qr-secondary">识别内容</button></form></details><p class="qr-footnote">只识别地址或好友身份；转账仍需再次核对并确认。</p></section>`;
  const video = container.querySelector('[data-qr-video]');
  const stage = container.querySelector('[data-qr-stage]');
  const idle = container.querySelector('[data-qr-idle]');
  const status = container.querySelector('[data-qr-status]');
  const resultBox = container.querySelector('[data-qr-result]');
  const cameraButton = container.querySelector('[data-qr-action="camera"]');
  const fileInput = container.querySelector('[data-qr-file]');
  const isCurrent = token => !disposed && epoch === token;
  const setStatus = (message, error = false) => { if (!disposed) { status.textContent = message; status.classList.toggle('is-error', error); } };

  function stopCamera() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    stopMediaTracks(stream); stream = null;
    try { video.pause(); } catch {}
    video.srcObject = null; video.hidden = true; idle.hidden = false;
    cameraButton.disabled = false; cameraButton.textContent = '打开相机';
  }
  function cancelOperations() {
    epoch++;
    stopCamera();
    cancelImage?.(); cancelImage = null;
  }
  function resetResult() {
    result = null; confirming = false; resultBox.hidden = true; resultBox.innerHTML = ''; stage.hidden = false;
  }
  function showResult(payload) {
    cancelOperations(); result = payload; confirming = false;
    stage.hidden = true; resultBox.hidden = false;
    const isAddress = payload.kind === 'address';
    resultBox.innerHTML = `<span class="qr-result-symbol" aria-hidden="true">${isAddress ? '↗' : '☺'}</span><span class="qr-result-kind">已识别${isAddress ? '收款地址' : '愚笨者好友码'}</span><h3>${isAddress ? '核对完整地址' : '核对好友 ID'}</h3><code>${esc(isAddress ? payload.address : payload.id)}</code>${isAddress ? `<span class="qr-network">BSC 测试网 · Chain ID 97</span><p>${payload.networkExplicit ? '二维码标注了 BSC 测试网，请仍向收款方确认。' : '裸地址无法证明所属网络，请向收款方确认使用 BSC 测试网。'}</p><p class="qr-result-note">仅识别地址，二维码中的金额不会填入转账。</p>` : '<p>下一步只查看好友资料，不会直接添加好友。</p>'}<button type="button" class="qr-primary" data-qr-action="confirm">${isAddress ? '使用此地址' : '查看好友'}</button><button type="button" class="qr-text-button" data-qr-action="again">重新识别</button>`;
    setStatus('识别完成，请核对后继续。');
  }
  function consume(text, token) {
    if (!isCurrent(token)) return;
    try { showResult(parseScanPayload(text, mode)); }
    catch (error) { cancelOperations(); resetResult(); setStatus(error.message, true); }
  }
  function decode(source, width, height, maxSide) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw scanError('当前浏览器无法识别图像，请手动输入。', 'SCAN_UNSUPPORTED');
    try {
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    } finally { canvas.width = 0; canvas.height = 0; }
  }
  async function openCamera() {
    cancelOperations(); resetResult();
    const token = epoch;
    if (document.hidden) { setStatus('返回此页面后再打开相机。'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('当前环境不能使用相机，可从相册选择或手动输入。', true); return; }
    cameraButton.disabled = true; cameraButton.textContent = '等待相机授权…';
    setStatus('请允许使用相机；也可以从相册选择。');
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } });
      if (!isCurrent(token) || document.hidden) { stopMediaTracks(acquired); return; }
      stream = acquired; video.srcObject = acquired;
      video.hidden = false; idle.hidden = true;
      await video.play();
      if (!isCurrent(token)) return;
      cameraButton.disabled = false; cameraButton.textContent = '关闭相机';
      setStatus('对准二维码并保持稳定。');
      const scanFrame = () => {
        if (!isCurrent(token)) return;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
            const text = decode(video, video.videoWidth, video.videoHeight, 1000);
            if (text !== null) { consume(text, token); return; }
          }
          timer = setTimeout(scanFrame, 180);
        } catch { cancelOperations(); setStatus('相机画面无法识别，可从相册选择或手动输入。', true); }
      };
      scanFrame();
    } catch (error) {
      if (!isCurrent(token)) return;
      cancelOperations();
      setStatus(error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ? '未获得相机权限，可从相册选择或手动输入。' : '相机暂时无法打开，可从相册选择或手动输入。', true);
    }
  }
  async function loadImage(file, token) {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      if (!isCurrent(token)) { bitmap.close(); throw scanError('识别已取消。', 'SCAN_CANCELLED'); }
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      let settled = false;
      const release = () => { image.onload = null; image.onerror = null; URL.revokeObjectURL(url); image.removeAttribute('src'); };
      const abort = () => { if (settled) return; settled = true; release(); reject(scanError('识别已取消。', 'SCAN_CANCELLED')); };
      cancelImage = abort;
      image.onload = () => {
        if (settled) return;
        settled = true; cancelImage = null;
        if (!isCurrent(token)) { release(); reject(scanError('识别已取消。', 'SCAN_CANCELLED')); return; }
        resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, release });
      };
      image.onerror = () => { if (settled) return; settled = true; cancelImage = null; release(); reject(scanError('图片无法解码，请换一张清晰图片。', 'SCAN_IMAGE_INVALID')); };
      image.src = url;
    });
  }
  async function readImage(file) {
    cancelOperations(); resetResult();
    const token = epoch;
    let loaded = null;
    if (document.hidden) { setStatus('返回此页面后再选择图片。'); return; }
    setStatus('正在本机识别图片…');
    try {
      validateQrImageFile(file);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent(token)) return;
      inspectQrImage(bytes, file.type);
      loaded = await loadImage(file, token);
      if (!isCurrent(token)) return;
      validateQrImageDimensions(loaded.width, loaded.height);
      for (const maxSide of [1600, 1000, 600]) {
        if (!isCurrent(token)) return;
        const text = decode(loaded.source, loaded.width, loaded.height, maxSide);
        if (text !== null) { consume(text, token); return; }
        // Give close/background actions a chance to cancel before another pass.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (isCurrent(token)) setStatus('没有识别到二维码，请裁剪二维码区域后重试，或手动输入。', true);
    } catch (error) {
      if (isCurrent(token)) setStatus(error?.code?.startsWith('SCAN_') ? error.message : '图片无法读取，请重新选择或手动输入。', true);
    } finally { loaded?.release(); }
  }
  async function confirm(button) {
    if (!result || disposed || confirming) return;
    confirming = true; button.disabled = true;
    const token = epoch, selected = { ...result };
    try { await onResult(selected); }
    catch (error) {
      if (isCurrent(token)) {
        confirming = false; button.disabled = false;
        const message = typeof error?.message === 'string' && error.message.trim() ? error.message.slice(0, 300) : '暂时无法继续，请重试。';
        setStatus(message, true); toast(message);
      }
    }
  }
  function onClick(event) {
    const button = event.target.closest('[data-qr-action]');
    if (!button || !container.contains(button) || button.disabled || disposed) return;
    const action = button.dataset.qrAction;
    if (action === 'camera') {
      if (stream) { cancelOperations(); setStatus('相机已关闭，可重新打开或选择图片。'); }
      else void openCamera();
    } else if (action === 'album') {
      cancelOperations(); resetResult(); setStatus('请选择一张二维码图片。'); fileInput.value = ''; fileInput.click();
    } else if (action === 'again') { cancelOperations(); resetResult(); setStatus('请选择相机、相册或手动输入。'); }
    else if (action === 'confirm') void confirm(button);
  }
  function onChange(event) {
    if (disposed || event.target !== fileInput) return;
    const file = fileInput.files?.[0]; fileInput.value = '';
    if (file) void readImage(file);
  }
  function onSubmit(event) {
    if (!event.target.matches('[data-qr-manual]')) return;
    event.preventDefault(); if (disposed) return;
    cancelOperations(); resetResult();
    const text = event.target.elements.payload.value;
    event.target.elements.payload.value = '';
    consume(text, epoch);
  }
  function background() {
    if (disposed) return;
    cancelOperations();
    if (!result) setStatus('扫码已暂停。返回后可重新打开相机或选择图片。');
  }
  const onVisibility = () => { if (document.hidden) background(); };
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  container.addEventListener('submit', onSubmit);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', background);
  return () => {
    if (disposed) return;
    disposed = true; cancelOperations(); result = null;
    const manual = container.querySelector('[data-qr-manual]');
    if (manual?.elements?.payload) manual.elements.payload.value = '';
    fileInput.value = '';
    container.removeEventListener('click', onClick);
    container.removeEventListener('change', onChange);
    container.removeEventListener('submit', onSubmit);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', background);
  };
}
