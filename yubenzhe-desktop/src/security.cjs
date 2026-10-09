'use strict';

const LOCAL_ORIGIN = 'yubenzhe://app';
const LOCAL_FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/privacy.html': ['privacy.html', 'text/html; charset=utf-8'],
  '/terms.html': ['terms.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icon.png': ['icon.png', 'image/png'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
});
const RPC_HOSTS = new Set(['bsc-testnet-dataseed.bnbchain.org', 'bsc-testnet.bnbchain.org']);
const EXTERNAL_HOSTS = new Set(['testnet.bscscan.com', 'docs.bnbchain.org', 'docs.ethers.org', 'docs.ollama.com']);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://66.42.56.29/api/social/avatars/; media-src 'self' blob:; connect-src 'self' https://bsc-testnet-dataseed.bnbchain.org https://bsc-testnet.bnbchain.org https://66.42.56.29/api/social/; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'";

function parsed(value) { try { return new URL(value); } catch { return null; } }
function isLocalUrl(value) {
  const url = parsed(value);
  return !!url && url.protocol === 'yubenzhe:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
}
function localAsset(value) {
  if (!isLocalUrl(value)) return null;
  const url = parsed(value);
  if (url.search) return null;
  return Object.hasOwn(LOCAL_FILES, url.pathname) ? LOCAL_FILES[url.pathname] : null;
}
function isExternalUrl(value) {
  const url = parsed(value);
  return !!url && url.protocol === 'https:' && (EXTERNAL_HOSTS.has(url.hostname) || url.hostname === 'ollama.com' && /^\/download(?:\/|$)/.test(url.pathname)) && !url.port && !url.username && !url.password;
}
function isSocialApiUrl(value) {
  const url = parsed(value);
  // Inspect both the original path and parsed authority. URL normalization alone
  // would silently accept dot-segment and backslash aliases.
  return typeof value === 'string' && /^https:\/\/66\.42\.56\.29(?::443)?\/api\/social\/[A-Za-z0-9_/-]*(?:\?[^\s#]*)?$/.test(value) &&
    !!url && !url.port && !url.username && !url.password && !url.hash && !url.pathname.includes('//') && !url.pathname.startsWith('/api/social/avatars/');
}
function isSocialAvatarUrl(value) {
  return typeof value === 'string' && /^https:\/\/66\.42\.56\.29(?::443)?\/api\/social\/avatars\/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(value);
}
function isAllowedRequest(value, resourceType) {
  if (localAsset(value)) return true;
  const url = parsed(value);
  if (!url) return false;
  if (url.protocol === 'data:' || url.protocol === 'blob:') return ['image', 'media'].includes(resourceType);
  if (isSocialAvatarUrl(value)) return resourceType === 'image';
  if (isSocialApiUrl(value)) return ['xhr', 'fetch'].includes(resourceType);
  return url.protocol === 'https:' && RPC_HOSTS.has(url.hostname) && !url.port && !url.username && !url.password && ['xhr', 'fetch'].includes(resourceType);
}
function validCameraRequest(permission, details = {}) {
  const mediaTypes = details.mediaTypes;
  return permission === 'media' && Array.isArray(mediaTypes) && mediaTypes.length === 1 && mediaTypes[0] === 'video';
}
function validateJsonExport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('导出文件格式无效。');
  const { filename, content, mimeType = 'application/json' } = value;
  if (typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.json$/.test(filename)) throw new Error('导出文件名无效。');
  if (mimeType !== 'application/json' || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 256 * 1024) throw new Error('导出内容无效或过大。');
  const data = JSON.parse(content);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('导出文件必须为 JSON 对象。');
  return { filename, content };
}

module.exports = { LOCAL_ORIGIN, CSP, isLocalUrl, localAsset, isExternalUrl, isSocialApiUrl, isSocialAvatarUrl, isAllowedRequest, validCameraRequest, validateJsonExport };
