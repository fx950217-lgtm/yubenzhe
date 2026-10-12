'use strict';

const deployment = require('./deployment.cjs');
const APP_VERSION = require('../package.json').version;
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
const RPC_HOSTS = new Set(deployment.rpcUrls.map(v=>new URL(v).hostname));
const EXTERNAL_HOSTS = new Set(['docs.ethers.org','docs.ollama.com',...[deployment.explorerUrl,deployment.faucetUrl].map(v=>new URL(v).hostname)]);
// DApps are system-browser destinations only; never grant their host app network access.
const EXTERNAL_DAPP_ROOT = 'https://app.remix.live/';
const EXTERNAL_INSTALL_PAGE = deployment.previewOrigin + '/install.html';
const CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${deployment.previewOrigin}/api/social/avatars/; media-src 'self' blob:; connect-src 'self' ${deployment.rpcUrls.map(v=>new URL(v).origin).join(' ')} ${deployment.previewOrigin}/api/social/; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'`;

function parsed(value) { try { return new URL(value); } catch { return null; } }
function isLocalUrl(value) {
  const url = parsed(value);
  return !!url && url.protocol === 'yubenzhe:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
}
function localAsset(value) {
  if (!isLocalUrl(value)) return null;
  const url = parsed(value);
  if (url.search && !(['/app.js','/app.css'].includes(url.pathname) && url.search === '?v=' + APP_VERSION)) return null;
  return Object.hasOwn(LOCAL_FILES, url.pathname) ? LOCAL_FILES[url.pathname] : null;
}
function isExternalUrl(value) {
  if (typeof value !== 'string') return false;
  const url = parsed(value);
  return !!url && url.protocol === 'https:' && (value === EXTERNAL_DAPP_ROOT || value === EXTERNAL_INSTALL_PAGE || EXTERNAL_HOSTS.has(url.hostname) || (value === deployment.ollamaDownloadUrl || value.startsWith(deployment.ollamaDownloadUrl+'/'))) && !url.port && !url.username && !url.password;
}
function remotePath(value) {
 if(typeof value !== 'string') return null;
 for(const origin of [deployment.previewOrigin,deployment.previewOrigin+':443']) if(value.startsWith(origin+'/')) return value.slice(origin.length);
 return null;
}
function isSocialApiUrl(value) {
  const url = parsed(value), path = remotePath(value);
  return path !== null && /^\/api\/social\/[A-Za-z0-9_/-]*(?:\?[^\s#]*)?$/.test(path) &&
    !!url && !url.port && !url.username && !url.password && !url.hash && !url.pathname.includes('//') && !url.pathname.startsWith('/api/social/avatars/');
}
function isSocialAvatarUrl(value) {
  const path=remotePath(value);
  return path !== null && /^\/api\/social\/avatars\/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(path);
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

module.exports = { validateArtifactExport, LOCAL_ORIGIN, CSP, isLocalUrl, localAsset, isExternalUrl, isSocialApiUrl, isSocialAvatarUrl, isAllowedRequest, validCameraRequest, validateJsonExport };

function validateArtifactExport(value){
  const types={txt:'text/plain',csv:'text/csv',md:'text/markdown',json:'application/json'};
  if(!value||typeof value!=='object')throw Error('交付文件无效。');
  const {filename,mimeType,bodyBase64}=value;
  const ext=typeof filename==='string'?filename.split('.').pop().toLowerCase():'';
  if(typeof filename!=='string'||filename.length>120||/^[. ]|[. ]$|[\\/:*?"<>|\x00-\x1f\x7f]/.test(filename)||!types[ext]||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)||mimeType!==types[ext])throw Error('交付文件名或类型无效。');
  if(typeof bodyBase64!=='string'||bodyBase64.length>22369624||bodyBase64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(bodyBase64))throw Error('交付文件无效或过大。');
  const bytes=Buffer.from(bodyBase64,'base64');
  if(bytes.length>16*1024*1024||bytes.toString('base64')!==bodyBase64)throw Error('交付文件无效或过大。');
  new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return {filename,ext,bytes};
}
